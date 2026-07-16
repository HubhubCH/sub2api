package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type generationRecordRepoStub struct {
	record                *GenerationRecord
	cleanupIDs            []string
	cleanupUser           int64
	cleanupLimit          int
	cleanupCutoff         time.Time
	listLimit             int
	pending               []*GenerationRecord
	completeByUpstreamErr error
	taskExists            map[string]bool
	taskExistsFunc        func(context.Context, string) (bool, error)
	cleanupFunc           func(context.Context, int64, time.Time, int) ([]string, error)
}

func (r *generationRecordRepoStub) Create(_ context.Context, p CreateGenerationRecordParams, _ time.Time, _ int) (*GenerationRecord, []string, error) {
	r.record = &GenerationRecord{TaskID: p.TaskID, UserID: p.UserID, APIKeyID: p.APIKeyID, MediaType: p.MediaType}
	return r.record, nil, nil
}
func (r *generationRecordRepoStub) Complete(_ context.Context, taskID string, userID, accountID int64, status, upstream string, result json.RawMessage, failure string) error {
	r.record.AccountID, r.record.Status, r.record.UpstreamTaskID, r.record.Result, r.record.ErrorMessage = accountID, status, upstream, result, failure
	return nil
}
func (r *generationRecordRepoStub) CompleteByUpstream(_ context.Context, userID, apiKeyID, accountID int64, provider, upstream, status string, result json.RawMessage, failure string) error {
	if r.completeByUpstreamErr != nil {
		return r.completeByUpstreamErr
	}
	r.record.AccountID, r.record.Provider, r.record.Status, r.record.UpstreamTaskID, r.record.Result, r.record.ErrorMessage = accountID, provider, status, upstream, result, failure
	return nil
}
func (r *generationRecordRepoStub) ListByUser(_ context.Context, _ int64, limit int) ([]*GenerationRecord, error) {
	r.listLimit = limit
	return []*GenerationRecord{r.record}, nil
}
func (r *generationRecordRepoStub) GetByUser(context.Context, int64, string) (*GenerationRecord, error) {
	return r.record, nil
}
func (r *generationRecordRepoStub) GetByUpstream(context.Context, int64, int64, int64, string, string) (*GenerationRecord, error) {
	return r.record, nil
}
func (r *generationRecordRepoStub) TaskExists(ctx context.Context, taskID string) (bool, error) {
	if r.taskExistsFunc != nil {
		return r.taskExistsFunc(ctx, taskID)
	}
	return r.taskExists[taskID], nil
}
func (r *generationRecordRepoStub) Cleanup(ctx context.Context, userID int64, cutoff time.Time, limit int) ([]string, error) {
	if r.cleanupFunc != nil {
		return r.cleanupFunc(ctx, userID, cutoff, limit)
	}
	r.cleanupUser, r.cleanupCutoff, r.cleanupLimit = userID, cutoff, limit
	return r.cleanupIDs, nil
}

func TestGenerationRecordServiceStopWaitsForWorkers(t *testing.T) {
	cleanupStarted := make(chan struct{})
	releaseCleanup := make(chan struct{})
	repo := &generationRecordRepoStub{}
	repo.cleanupFunc = func(context.Context, int64, time.Time, int) ([]string, error) {
		close(cleanupStarted)
		<-releaseCleanup
		return nil, nil
	}
	svc := NewGenerationRecordService(repo)
	svc.dataDir = t.TempDir()
	svc.Start()
	<-cleanupStarted

	stopped := make(chan struct{})
	go func() {
		svc.Stop()
		close(stopped)
	}()
	select {
	case <-stopped:
		close(releaseCleanup)
		t.Fatal("Stop 在清理 worker 退出前返回")
	case <-time.After(50 * time.Millisecond):
	}
	close(releaseCleanup)
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("Stop 未等待清理 worker 退出")
	}
	require.NotPanics(t, svc.Stop)
}

func TestGenerationRecordServiceStartIsIdempotent(t *testing.T) {
	cleanupCalls := make(chan struct{}, 2)
	repo := &generationRecordRepoStub{
		cleanupFunc: func(context.Context, int64, time.Time, int) ([]string, error) {
			cleanupCalls <- struct{}{}
			return nil, nil
		},
	}
	svc := NewGenerationRecordService(repo)
	svc.dataDir = t.TempDir()
	svc.Start()
	svc.Start()
	defer svc.Stop()

	select {
	case <-cleanupCalls:
	case <-time.After(time.Second):
		t.Fatal("Start 未启动清理 worker")
	}
	select {
	case <-cleanupCalls:
		t.Fatal("重复 Start 启动了第二个清理 worker")
	case <-time.After(50 * time.Millisecond):
	}
}

func TestGenerationRecordServiceDoesNotStartAfterStop(t *testing.T) {
	cleanupCalls := make(chan struct{}, 1)
	repo := &generationRecordRepoStub{
		cleanupFunc: func(context.Context, int64, time.Time, int) ([]string, error) {
			cleanupCalls <- struct{}{}
			return nil, nil
		},
	}
	svc := NewGenerationRecordService(repo)
	svc.dataDir = t.TempDir()
	svc.Stop()
	svc.Start()

	select {
	case <-cleanupCalls:
		t.Fatal("Stop 后 Start 仍启动了清理 worker")
	case <-time.After(50 * time.Millisecond):
	}
}

func TestGenerationRecordServiceConcurrentStartStop(t *testing.T) {
	for i := 0; i < 100; i++ {
		svc := NewGenerationRecordService(&generationRecordRepoStub{})
		svc.dataDir = t.TempDir()
		start := make(chan struct{})
		var wg sync.WaitGroup
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			svc.Start()
		}()
		go func() {
			defer wg.Done()
			<-start
			svc.Stop()
		}()
		close(start)
		wg.Wait()
		svc.Stop()
	}
}

func (r *generationRecordRepoStub) ListPendingVideos(context.Context, time.Time, int) ([]*GenerationRecord, error) {
	return r.pending, nil
}

type generationVideoPollerStub struct{ payload []byte }

func (p *generationVideoPollerStub) PollVideoStatus(context.Context, *GenerationRecord) ([]byte, error) {
	return p.payload, nil
}

type generationAccountRepoStub struct {
	AccountRepository
	account *Account
}

func (r *generationAccountRepoStub) GetByID(context.Context, int64) (*Account, error) {
	return r.account, nil
}

func TestGenerationRecordServicePersistsCompletedSSEImage(t *testing.T) {
	repo := &generationRecordRepoStub{}
	svc := NewGenerationRecordService(repo)
	svc.dataDir = t.TempDir()
	_, err := svc.Create(context.Background(), CreateGenerationRecordParams{TaskID: "gen_test", UserID: 1, APIKeyID: 2, MediaType: "image"})
	require.NoError(t, err)

	payload := []byte("event: image_generation.completed\ndata: {\"type\":\"image_generation.completed\",\"b64_json\":\"aW1hZ2U=\",\"output_format\":\"png\"}\n\n")
	require.NoError(t, svc.Finish(context.Background(), "gen_test", 1, 0, GenerationStatusCompleted, "", payload, ""))

	path, err := svc.ContentPath(context.Background(), 1, "gen_test", 0)
	require.NoError(t, err)
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	require.Equal(t, []byte("image"), data)
	require.Equal(t, filepath.Join(svc.dataDir, "gen_test", "0.png"), path)
}

func TestGenerationRecordServicePassesSelectedAccountToRemoteImageDownload(t *testing.T) {
	repo := &generationRecordRepoStub{}
	svc := NewGenerationRecordService(repo)
	svc.dataDir = t.TempDir()
	var downloadedWithAccountID int64
	svc.download = func(_ context.Context, accountID int64, _ string, dir string, index int) (string, error) {
		downloadedWithAccountID = accountID
		require.NoError(t, os.MkdirAll(dir, 0o750))
		name := "0.png"
		require.Equal(t, 0, index)
		require.NoError(t, os.WriteFile(filepath.Join(dir, name), []byte("image"), 0o640))
		return name, nil
	}
	_, err := svc.Create(context.Background(), CreateGenerationRecordParams{TaskID: "gen_remote", UserID: 1, APIKeyID: 2, MediaType: "image"})
	require.NoError(t, err)

	err = svc.Finish(context.Background(), "gen_remote", 1, 42, GenerationStatusCompleted, "", []byte(`{"data":[{"url":"https://cdn.example/image.png"}]}`), "")

	require.NoError(t, err)
	require.Equal(t, int64(42), downloadedWithAccountID)
	require.Contains(t, string(repo.record.Result), `"files":["0.png"]`)
}

func TestAccountGenerationMediaDownloaderUsesAccountProxyWithoutLeakingAuthorization(t *testing.T) {
	proxy := &Proxy{Protocol: "http", Host: "proxy.example", Port: 8080, Username: "user", Password: "secret"}
	downloader := &accountGenerationMediaDownloader{
		accountRepo: &generationAccountRepoStub{account: &Account{
			ID: 42, Platform: PlatformGrok, Type: AccountTypeOAuth, ProxyID: func() *int64 { value := int64(7); return &value }(), Proxy: proxy,
		}},
	}
	var gotOptions generationMediaDownloadOptions
	downloader.download = func(_ context.Context, _ string, _ string, _ int, options generationMediaDownloadOptions) (string, error) {
		gotOptions = options
		return "0.png", nil
	}

	name, err := downloader.Download(context.Background(), 42, "https://cdn.example/image.png", t.TempDir(), 0)

	require.NoError(t, err)
	require.Equal(t, "0.png", name)
	require.Equal(t, proxy.URL(), gotOptions.proxyURL)
	require.Equal(t, grokUpstreamUserAgent, gotOptions.headers.Get("User-Agent"))
	require.Empty(t, gotOptions.headers.Get("Authorization"))
}

func TestDownloadGenerationMediaWithOptionsUsesConfiguredProxy(t *testing.T) {
	var gotHost string
	var gotAuthorization string
	proxyServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotHost = r.Host
		gotAuthorization = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write([]byte("proxied-image"))
	}))
	defer proxyServer.Close()
	dir := t.TempDir()

	name, err := downloadGenerationMediaWithOptions(context.Background(), "http://1.1.1.1/image.png", dir, 0, generationMediaDownloadOptions{
		proxyURL: proxyServer.URL,
		headers:  http.Header{"User-Agent": []string{grokUpstreamUserAgent}},
	})

	require.NoError(t, err)
	require.Equal(t, "1.1.1.1", gotHost)
	require.Empty(t, gotAuthorization)
	require.Equal(t, "0.png", name)
	require.Equal(t, []byte("proxied-image"), mustReadGenerationFile(t, filepath.Join(dir, name)))
}

func TestValidateGenerationMediaResolvedHostRejectsPrivateIP(t *testing.T) {
	require.ErrorContains(t, validateGenerationMediaResolvedHost(context.Background(), "127.0.0.1"), "私有网络")
}

func TestGenerationRecordServiceKeepsFiveItemsForThreeDays(t *testing.T) {
	repo := &generationRecordRepoStub{record: &GenerationRecord{TaskID: "latest"}, cleanupIDs: []string{"expired"}}
	svc := NewGenerationRecordService(repo)
	svc.dataDir = t.TempDir()
	now := time.Date(2026, 7, 14, 12, 0, 0, 0, time.UTC)
	svc.now = func() time.Time { return now }
	require.NoError(t, os.MkdirAll(filepath.Join(svc.dataDir, "expired"), 0o750))
	require.NoError(t, os.WriteFile(filepath.Join(svc.dataDir, "expired", "0.png"), []byte("old"), 0o640))

	_, err := svc.List(context.Background(), 7, 50)
	require.NoError(t, err)
	require.Equal(t, int64(7), repo.cleanupUser)
	require.Equal(t, GenerationRecordMaxItems, repo.cleanupLimit)
	require.Equal(t, GenerationRecordMaxItems, repo.listLimit)
	require.Equal(t, now.Add(-GenerationRecordRetention), repo.cleanupCutoff)
	_, err = os.Stat(filepath.Join(svc.dataDir, "expired"))
	require.ErrorIs(t, err, os.ErrNotExist)
}

func TestGenerationRecordServiceRemovesOrphanDirectories(t *testing.T) {
	repo := &generationRecordRepoStub{taskExists: map[string]bool{"gen_active": true}}
	svc := NewGenerationRecordService(repo)
	svc.dataDir = t.TempDir()
	now := time.Now()
	svc.now = func() time.Time { return now }
	for _, taskID := range []string{"gen_active", "gen_orphan"} {
		require.NoError(t, os.MkdirAll(filepath.Join(svc.dataDir, taskID), 0o750))
		require.NoError(t, os.WriteFile(filepath.Join(svc.dataDir, taskID, "0.png"), []byte("image"), 0o640))
		require.NoError(t, os.Chtimes(filepath.Join(svc.dataDir, taskID), now.Add(-time.Hour), now.Add(-time.Hour)))
	}

	require.NoError(t, svc.cleanup(context.Background(), 0))

	_, err := os.Stat(filepath.Join(svc.dataDir, "gen_active"))
	require.NoError(t, err)
	_, err = os.Stat(filepath.Join(svc.dataDir, "gen_orphan"))
	require.ErrorIs(t, err, os.ErrNotExist)
}

func TestGenerationRecordServiceOrphanScanDoesNotDeleteDirectoryCreatedAfterEnumeration(t *testing.T) {
	lookupStarted := make(chan struct{})
	continueLookup := make(chan struct{})
	repo := &generationRecordRepoStub{}
	repo.taskExistsFunc = func(_ context.Context, _ string) (bool, error) {
		close(lookupStarted)
		<-continueLookup
		return false, nil
	}
	svc := NewGenerationRecordService(repo)
	svc.dataDir = t.TempDir()
	now := time.Now()
	svc.now = func() time.Time { return now }
	orphanDir := filepath.Join(svc.dataDir, "gen_orphan")
	require.NoError(t, os.MkdirAll(orphanDir, 0o750))
	require.NoError(t, os.Chtimes(orphanDir, now.Add(-time.Hour), now.Add(-time.Hour)))

	done := make(chan error, 1)
	go func() { done <- svc.removeOrphanTaskFiles(context.Background()) }()
	<-lookupStarted
	newDir := filepath.Join(svc.dataDir, "gen_new")
	require.NoError(t, os.MkdirAll(newDir, 0o750))
	close(continueLookup)
	require.NoError(t, <-done)

	_, err := os.Stat(orphanDir)
	require.ErrorIs(t, err, os.ErrNotExist)
	_, err = os.Stat(newDir)
	require.NoError(t, err)
}

func TestGenerationRecordServiceConvergesVideoWithoutBrowserPolling(t *testing.T) {
	record := &GenerationRecord{
		TaskID: "gen_video", UserID: 1, APIKeyID: 2, AccountID: 3, MediaType: "video",
		Provider: "grok", UpstreamTaskID: "upstream-1", Status: GenerationStatusSubmitted,
	}
	repo := &generationRecordRepoStub{record: record, pending: []*GenerationRecord{record}}
	svc := NewGenerationRecordService(repo)
	svc.dataDir = t.TempDir()
	svc.download = func(_ context.Context, _ int64, _ string, dir string, index int) (string, error) {
		require.NoError(t, os.MkdirAll(dir, 0o750))
		name := "0.mp4"
		require.Equal(t, 0, index)
		require.NoError(t, os.WriteFile(filepath.Join(dir, name), []byte("video"), 0o640))
		return name, nil
	}
	svc.SetVideoStatusPoller(&generationVideoPollerStub{payload: []byte(`{"status":"completed","video":{"url":"https://cdn.example/video.mp4"}}`)})

	svc.reconcilePendingVideos(context.Background())

	require.Equal(t, GenerationStatusCompleted, repo.record.Status)
	require.Contains(t, string(repo.record.Result), `"files":["0.mp4"]`)
	require.NotContains(t, string(repo.record.Result), "https://cdn.example/video.mp4")
	path, err := svc.ContentPath(context.Background(), 1, "gen_video", 0)
	require.NoError(t, err)
	require.Equal(t, []byte("video"), mustReadGenerationFile(t, path))
}

func TestGenerationRecordServiceRetriesCompletedVideoWhenServerSaveFails(t *testing.T) {
	record := &GenerationRecord{
		TaskID: "gen_video", UserID: 1, APIKeyID: 2, AccountID: 3, MediaType: "video",
		Provider: "grok", UpstreamTaskID: "upstream-1", Status: GenerationStatusSubmitted,
	}
	repo := &generationRecordRepoStub{record: record}
	svc := NewGenerationRecordService(repo)
	svc.dataDir = t.TempDir()
	svc.download = func(context.Context, int64, string, string, int) (string, error) {
		return "", errors.New("临时下载失败")
	}

	err := svc.FinishVideoByUpstream(context.Background(), 1, 2, 3, "grok", "upstream-1", GenerationStatusCompleted, []byte(`{"status":"completed","video":{"url":"https://cdn.example/video.mp4"}}`), "")

	require.NoError(t, err)
	require.Equal(t, GenerationStatusSubmitted, repo.record.Status)
	require.Contains(t, repo.record.ErrorMessage, "将自动重试")
}

func TestGenerationRecordServiceDoesNotRegressCompletedVideo(t *testing.T) {
	record := &GenerationRecord{
		TaskID: "gen_video", UserID: 1, APIKeyID: 2, AccountID: 3, MediaType: "video",
		Provider: "grok", UpstreamTaskID: "upstream-1", Status: GenerationStatusCompleted,
		Result: json.RawMessage(`{"files":["0.mp4"],"urls":[]}`),
	}
	repo := &generationRecordRepoStub{record: record}
	svc := NewGenerationRecordService(repo)
	downloadCalled := false
	svc.download = func(context.Context, int64, string, string, int) (string, error) {
		downloadCalled = true
		return "", nil
	}

	err := svc.FinishVideoByUpstream(context.Background(), 1, 2, 3, "grok", "upstream-1", GenerationStatusSubmitted, []byte(`{"status":"processing"}`), "")

	require.NoError(t, err)
	require.False(t, downloadCalled)
	require.Equal(t, GenerationStatusCompleted, repo.record.Status)
	require.JSONEq(t, `{"files":["0.mp4"],"urls":[]}`, string(repo.record.Result))
}

func TestGenerationRecordServiceRemovesVideoFilesWhenDatabaseUpdateFails(t *testing.T) {
	record := &GenerationRecord{
		TaskID: "gen_video", UserID: 1, APIKeyID: 2, AccountID: 3, MediaType: "video",
		Provider: "grok", UpstreamTaskID: "upstream-1", Status: GenerationStatusSubmitted,
	}
	repo := &generationRecordRepoStub{record: record, completeByUpstreamErr: errors.New("数据库更新失败")}
	svc := NewGenerationRecordService(repo)
	svc.dataDir = t.TempDir()
	svc.download = func(_ context.Context, _ int64, _ string, dir string, _ int) (string, error) {
		require.NoError(t, os.MkdirAll(dir, 0o750))
		require.NoError(t, os.WriteFile(filepath.Join(dir, "0.mp4"), []byte("video"), 0o640))
		return "0.mp4", nil
	}

	err := svc.FinishVideoByUpstream(context.Background(), 1, 2, 3, "grok", "upstream-1", GenerationStatusCompleted, []byte(`{"status":"completed","video":{"url":"https://cdn.example/video.mp4"}}`), "")

	require.ErrorContains(t, err, "数据库更新失败")
	_, statErr := os.Stat(filepath.Join(svc.dataDir, "gen_video"))
	require.ErrorIs(t, statErr, os.ErrNotExist)
}

func mustReadGenerationFile(t *testing.T, path string) []byte {
	t.Helper()
	data, err := os.ReadFile(path)
	require.NoError(t, err)
	return data
}
