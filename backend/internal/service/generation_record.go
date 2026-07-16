package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/pkg/logger"
	"github.com/Wei-Shaw/sub2api/internal/pkg/proxyurl"
	"github.com/Wei-Shaw/sub2api/internal/pkg/proxyutil"
	"github.com/tidwall/gjson"
)

const (
	GenerationStatusRunning   = "running"
	GenerationStatusSubmitted = "submitted"
	GenerationStatusCompleted = "completed"
	GenerationStatusFailed    = "failed"
	GenerationRecordMaxItems  = 5
	GenerationRecordRetention = 72 * time.Hour
	generationCleanupInterval = time.Hour
	generationStatusInterval  = 30 * time.Second
	generationStatusBatchSize = 20
	generationMediaMaxBytes   = 128 << 20
	generationMediaTimeout    = 2 * time.Minute
	generationOrphanGrace     = 10 * time.Minute
)

var ErrGenerationRecordLimit = errors.New("正在生成的任务已达到 5 条上限，请等待任务完成后重试")

type GenerationRecord struct {
	TaskID         string          `json:"task_id"`
	UserID         int64           `json:"-"`
	APIKeyID       int64           `json:"api_key_id"`
	AccountID      int64           `json:"-"`
	MediaType      string          `json:"media_type"`
	Provider       string          `json:"provider"`
	Model          string          `json:"model"`
	PromptPreview  string          `json:"prompt_preview"`
	Status         string          `json:"status"`
	UpstreamTaskID string          `json:"upstream_task_id,omitempty"`
	Result         json.RawMessage `json:"result,omitempty"`
	ErrorMessage   string          `json:"error_message,omitempty"`
	CreatedAt      time.Time       `json:"created_at"`
	UpdatedAt      time.Time       `json:"updated_at"`
	FinishedAt     *time.Time      `json:"finished_at,omitempty"`
}

type CreateGenerationRecordParams struct {
	TaskID, MediaType, Provider, Model, PromptPreview string
	UserID, APIKeyID                                  int64
}

type GenerationRecordRepository interface {
	Create(context.Context, CreateGenerationRecordParams, time.Time, int) (*GenerationRecord, []string, error)
	Complete(context.Context, string, int64, int64, string, string, json.RawMessage, string) error
	CompleteByUpstream(context.Context, int64, int64, int64, string, string, string, json.RawMessage, string) error
	ListByUser(context.Context, int64, int) ([]*GenerationRecord, error)
	GetByUser(context.Context, int64, string) (*GenerationRecord, error)
	GetByUpstream(context.Context, int64, int64, int64, string, string) (*GenerationRecord, error)
	TaskExists(context.Context, string) (bool, error)
	Cleanup(context.Context, int64, time.Time, int) ([]string, error)
	ListPendingVideos(context.Context, time.Time, int) ([]*GenerationRecord, error)
}

type GenerationVideoStatusPoller interface {
	PollVideoStatus(context.Context, *GenerationRecord) ([]byte, error)
}

func (s *GenerationRecordService) FinishVideoByUpstream(ctx context.Context, userID, apiKeyID, accountID int64, provider, upstreamTaskID, status string, payload []byte, failure string) error {
	if s == nil || s.repo == nil || userID <= 0 || apiKeyID <= 0 || accountID <= 0 || strings.TrimSpace(provider) == "" || strings.TrimSpace(upstreamTaskID) == "" {
		return errors.New("生成记录服务不可用")
	}
	s.videoFinishMu.Lock()
	defer s.videoFinishMu.Unlock()
	record, err := s.repo.GetByUpstream(ctx, userID, apiKeyID, accountID, strings.ToLower(strings.TrimSpace(provider)), upstreamTaskID)
	if err != nil {
		return err
	}
	if isTerminalGenerationStatus(record.Status) {
		return nil
	}
	result, err := s.persistResultFiles(ctx, record.TaskID, accountID, payload, status == GenerationStatusCompleted)
	if err != nil {
		if status == GenerationStatusCompleted {
			status = GenerationStatusSubmitted
		}
		failure = "视频已生成，但保存到服务器失败，将自动重试: " + err.Error()
	}
	if err := s.repo.CompleteByUpstream(ctx, userID, apiKeyID, accountID, strings.ToLower(strings.TrimSpace(provider)), upstreamTaskID, status, result, truncateRunes(failure, 1000)); err != nil {
		s.removeTaskFiles([]string{record.TaskID})
		return err
	}
	return nil
}

type GenerationRecordService struct {
	repo          GenerationRecordRepository
	dataDir       string
	now           func() time.Time
	stop          chan struct{}
	stopOnce      sync.Once
	workerWG      sync.WaitGroup
	poller        GenerationVideoStatusPoller
	download      func(context.Context, int64, string, string, int) (string, error)
	videoFinishMu sync.Mutex
}

func isTerminalGenerationStatus(status string) bool {
	return status == GenerationStatusCompleted || status == GenerationStatusFailed
}

func NewGenerationRecordService(repo GenerationRecordRepository) *GenerationRecordService {
	dataDir := strings.TrimSpace(os.Getenv("DATA_DIR"))
	if dataDir == "" {
		if info, err := os.Stat("/app/data"); err == nil && info.IsDir() {
			dataDir = "/app/data"
		} else {
			dataDir = "./data"
		}
	}
	return &GenerationRecordService{
		repo: repo, dataDir: filepath.Join(dataDir, "generation-records"), now: time.Now, stop: make(chan struct{}),
		download: func(ctx context.Context, _ int64, rawURL, dir string, index int) (string, error) {
			return downloadGenerationMedia(ctx, rawURL, dir, index)
		},
	}
}

func (s *GenerationRecordService) Start() {
	if s == nil || s.repo == nil {
		return
	}
	s.workerWG.Add(1)
	go func() {
		defer s.workerWG.Done()
		s.runCleanupLoop()
	}()
	if s.poller != nil {
		s.workerWG.Add(1)
		go func() {
			defer s.workerWG.Done()
			s.runVideoStatusLoop()
		}()
	}
}

func (s *GenerationRecordService) SetVideoStatusPoller(poller GenerationVideoStatusPoller) {
	if s != nil {
		s.poller = poller
	}
}

func (s *GenerationRecordService) SetMediaDownloader(downloader func(context.Context, int64, string, string, int) (string, error)) {
	if s != nil && downloader != nil {
		s.download = downloader
	}
}

func (s *GenerationRecordService) Stop() {
	if s == nil {
		return
	}
	s.stopOnce.Do(func() { close(s.stop) })
	s.workerWG.Wait()
}

func (s *GenerationRecordService) Create(ctx context.Context, params CreateGenerationRecordParams) (*GenerationRecord, error) {
	if s == nil || s.repo == nil || params.UserID <= 0 || params.APIKeyID <= 0 || strings.TrimSpace(params.TaskID) == "" {
		return nil, errors.New("生成记录服务不可用")
	}
	params.PromptPreview = truncateRunes(strings.TrimSpace(params.PromptPreview), 240)
	now := time.Now()
	if s.now != nil {
		now = s.now()
	}
	record, removedTaskIDs, err := s.repo.Create(ctx, params, now.Add(-GenerationRecordRetention), GenerationRecordMaxItems)
	if err != nil {
		return nil, err
	}
	s.removeTaskFiles(removedTaskIDs)
	return record, nil
}

func (s *GenerationRecordService) Finish(ctx context.Context, taskID string, userID, accountID int64, status, upstreamTaskID string, payload []byte, failure string) error {
	if s == nil || s.repo == nil {
		return errors.New("生成记录服务不可用")
	}
	result, err := s.persistResultFiles(ctx, taskID, accountID, payload, status == GenerationStatusCompleted)
	if err != nil && strings.TrimSpace(failure) == "" {
		failure = err.Error()
		status = GenerationStatusFailed
	}
	if err := s.repo.Complete(ctx, taskID, userID, accountID, status, upstreamTaskID, result, truncateRunes(failure, 1000)); err != nil {
		s.removeTaskFiles([]string{taskID})
		return err
	}
	return nil
}

func (s *GenerationRecordService) List(ctx context.Context, userID int64, limit int) ([]*GenerationRecord, error) {
	if err := s.cleanup(ctx, userID); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > GenerationRecordMaxItems {
		limit = GenerationRecordMaxItems
	}
	return s.repo.ListByUser(ctx, userID, limit)
}

func (s *GenerationRecordService) runCleanupLoop() {
	_ = s.cleanup(context.Background(), 0)
	ticker := time.NewTicker(generationCleanupInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			if err := s.cleanup(context.Background(), 0); err != nil {
				logger.LegacyPrintf("service.generation_record", "定时清理生成记录失败: %v", err)
			}
		case <-s.stop:
			return
		}
	}
}

func (s *GenerationRecordService) runVideoStatusLoop() {
	ticker := time.NewTicker(generationStatusInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			s.reconcilePendingVideos(context.Background())
		case <-s.stop:
			return
		}
	}
}

func (s *GenerationRecordService) reconcilePendingVideos(ctx context.Context) {
	if s == nil || s.repo == nil || s.poller == nil {
		return
	}
	now := time.Now()
	if s.now != nil {
		now = s.now()
	}
	records, err := s.repo.ListPendingVideos(ctx, now.Add(-GenerationRecordRetention), generationStatusBatchSize)
	if err != nil {
		logger.LegacyPrintf("service.generation_record", "查询待收敛视频任务失败: %v", err)
		return
	}
	for _, record := range records {
		pollCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		payload, pollErr := s.poller.PollVideoStatus(pollCtx, record)
		cancel()
		if pollErr != nil {
			continue
		}
		upstreamStatus := strings.ToLower(strings.TrimSpace(gjson.GetBytes(payload, "status").String()))
		status := ""
		failure := ""
		switch upstreamStatus {
		case "completed", "success", "succeeded", "done":
			status = GenerationStatusCompleted
		case "failed", "error", "cancelled", "canceled", "expired":
			status = GenerationStatusFailed
			failure = firstGenerationError(payload)
		}
		if status == "" {
			continue
		}
		finishCtx, finishCancel := context.WithTimeout(ctx, generationMediaTimeout)
		err = s.FinishVideoByUpstream(finishCtx, record.UserID, record.APIKeyID, record.AccountID, record.Provider, record.UpstreamTaskID, status, payload, failure)
		finishCancel()
		if err != nil {
			logger.LegacyPrintf("service.generation_record", "收敛视频生成记录失败 task_id=%s: %v", record.TaskID, err)
		}
	}
}

func firstGenerationError(payload []byte) string {
	for _, path := range []string{"error.message", "message", "detail"} {
		if value := strings.TrimSpace(gjson.GetBytes(payload, path).String()); value != "" {
			return value
		}
	}
	return "视频任务生成失败"
}

func (s *GenerationRecordService) cleanup(ctx context.Context, userID int64) error {
	if s == nil || s.repo == nil {
		return errors.New("生成记录服务不可用")
	}
	now := time.Now()
	if s.now != nil {
		now = s.now()
	}
	taskIDs, err := s.repo.Cleanup(ctx, userID, now.Add(-GenerationRecordRetention), GenerationRecordMaxItems)
	if err != nil {
		return err
	}
	s.removeTaskFiles(taskIDs)
	if userID == 0 {
		if err := s.removeOrphanTaskFiles(ctx); err != nil {
			return err
		}
	}
	return nil
}

func (s *GenerationRecordService) removeOrphanTaskFiles(ctx context.Context) error {
	entries, err := os.ReadDir(s.dataDir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	now := time.Now()
	if s.now != nil {
		now = s.now()
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		taskID := entry.Name()
		if filepath.Base(taskID) != taskID {
			continue
		}
		info, err := entry.Info()
		if err != nil || now.Sub(info.ModTime()) < generationOrphanGrace {
			continue
		}
		exists, err := s.repo.TaskExists(ctx, taskID)
		if err != nil {
			return err
		}
		if exists {
			continue
		}
		if err := os.RemoveAll(filepath.Join(s.dataDir, taskID)); err != nil {
			logger.LegacyPrintf("service.generation_record", "删除孤儿生成记录文件失败 task_id=%s: %v", taskID, err)
		}
	}
	return nil
}

func (s *GenerationRecordService) removeTaskFiles(taskIDs []string) {
	for _, taskID := range taskIDs {
		if taskID == "" || filepath.Base(taskID) != taskID {
			continue
		}
		if err := os.RemoveAll(filepath.Join(s.dataDir, taskID)); err != nil {
			logger.LegacyPrintf("service.generation_record", "删除生成记录文件失败 task_id=%s: %v", taskID, err)
		}
	}
}

func (s *GenerationRecordService) ContentPath(ctx context.Context, userID int64, taskID string, index int) (string, error) {
	record, err := s.repo.GetByUser(ctx, userID, taskID)
	if err != nil {
		return "", err
	}
	var result struct {
		Files []string `json:"files"`
	}
	if err := json.Unmarshal(record.Result, &result); err != nil || index < 0 || index >= len(result.Files) {
		return "", os.ErrNotExist
	}
	base := filepath.Clean(s.dataDir)
	path := filepath.Clean(filepath.Join(base, taskID, filepath.Base(result.Files[index])))
	if !strings.HasPrefix(path, base+string(os.PathSeparator)) {
		return "", os.ErrPermission
	}
	return path, nil
}

func (s *GenerationRecordService) persistResultFiles(ctx context.Context, taskID string, accountID int64, payload []byte, saveRemote bool) (json.RawMessage, error) {
	if len(payload) == 0 {
		return nil, nil
	}
	roots := make([]map[string]any, 0, 2)
	if json.Valid(payload) {
		var root map[string]any
		if err := json.Unmarshal(payload, &root); err != nil {
			return nil, err
		}
		roots = append(roots, root)
	} else {
		for _, line := range strings.Split(string(payload), "\n") {
			line = strings.TrimSpace(line)
			if !strings.HasPrefix(line, "data:") {
				continue
			}
			data := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
			if data == "" || data == "[DONE]" || !json.Valid([]byte(data)) {
				continue
			}
			var root map[string]any
			if json.Unmarshal([]byte(data), &root) == nil && strings.HasSuffix(strings.TrimSpace(fmt.Sprint(root["type"])), ".completed") {
				roots = append(roots, root)
			}
		}
	}
	files := make([]string, 0)
	remoteURLs := make([]string, 0)
	seenURLs := make(map[string]struct{})
	addURL := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" {
			return
		}
		if _, exists := seenURLs[value]; exists {
			return
		}
		seenURLs[value] = struct{}{}
		remoteURLs = append(remoteURLs, value)
	}
	for _, root := range roots {
		items := make([]any, 0)
		if root["b64_json"] != nil || root["result"] != nil || root["url"] != nil {
			items = append(items, root)
		}
		for _, key := range []string{"data", "output"} {
			nested, _ := root[key].([]any)
			items = append(items, nested...)
		}
		for _, raw := range items {
			item, _ := raw.(map[string]any)
			if item == nil {
				continue
			}
			if value, _ := item["url"].(string); value != "" {
				addURL(value)
			}
			encoded, _ := item["b64_json"].(string)
			if encoded == "" {
				encoded, _ = item["result"].(string)
			}
			if encoded == "" {
				continue
			}
			binary, err := base64.StdEncoding.DecodeString(encoded)
			if err != nil {
				return nil, fmt.Errorf("保存生成图片失败: %w", err)
			}
			ext := strings.TrimSpace(fmt.Sprint(item["output_format"]))
			switch ext {
			case "png", "webp", "jpg", "jpeg":
			default:
				ext = "png"
			}
			if ext == "jpeg" {
				ext = "jpg"
			}
			name := fmt.Sprintf("%d.%s", len(files), ext)
			dir := filepath.Join(s.dataDir, taskID)
			if err := os.MkdirAll(dir, 0o750); err != nil {
				return nil, err
			}
			if err := os.WriteFile(filepath.Join(dir, name), binary, 0o640); err != nil {
				return nil, err
			}
			files = append(files, name)
		}
		if video, _ := root["video"].(map[string]any); video != nil {
			if value, _ := video["url"].(string); value != "" {
				addURL(value)
			}
		}
	}
	remainingURLs := remoteURLs
	if saveRemote && len(remoteURLs) > 0 {
		remainingURLs = make([]string, 0)
		var downloadErrors []string
		downloader := s.download
		if downloader == nil {
			downloader = func(ctx context.Context, _ int64, rawURL, dir string, index int) (string, error) {
				return downloadGenerationMedia(ctx, rawURL, dir, index)
			}
		}
		for _, remoteURL := range remoteURLs {
			name, err := downloader(ctx, accountID, remoteURL, filepath.Join(s.dataDir, taskID), len(files))
			if err != nil {
				remainingURLs = append(remainingURLs, remoteURL)
				downloadErrors = append(downloadErrors, err.Error())
				continue
			}
			files = append(files, name)
		}
		result, marshalErr := json.Marshal(map[string]any{"files": files, "urls": remainingURLs})
		if marshalErr != nil {
			return nil, marshalErr
		}
		if len(downloadErrors) > 0 {
			return result, errors.New(strings.Join(downloadErrors, "; "))
		}
		return result, nil
	}
	return json.Marshal(map[string]any{"files": files, "urls": remainingURLs})
}

type generationMediaDownloadOptions struct {
	proxyURL string
	headers  http.Header
}

type accountGenerationMediaDownloader struct {
	accountRepo AccountRepository
	download    func(context.Context, string, string, int, generationMediaDownloadOptions) (string, error)
}

func NewAccountGenerationMediaDownloader(accountRepo AccountRepository) func(context.Context, int64, string, string, int) (string, error) {
	downloader := &accountGenerationMediaDownloader{accountRepo: accountRepo, download: downloadGenerationMediaWithOptions}
	return downloader.Download
}

func (d *accountGenerationMediaDownloader) Download(ctx context.Context, accountID int64, rawURL, dir string, index int) (string, error) {
	options := generationMediaDownloadOptions{headers: make(http.Header)}
	options.headers.Set("Accept", "image/avif,image/webp,image/*,video/*,*/*;q=0.8")
	if accountID > 0 {
		if d == nil || d.accountRepo == nil {
			return "", errors.New("生成媒体下载账号服务不可用")
		}
		account, err := d.accountRepo.GetByID(ctx, accountID)
		if err != nil {
			return "", fmt.Errorf("读取生成媒体下载账号失败: %w", err)
		}
		if account == nil {
			return "", errors.New("生成媒体下载账号不存在")
		}
		if account.ProxyID != nil && account.Proxy != nil {
			options.proxyURL = account.Proxy.URL()
		}
		if account.Platform == PlatformGrok {
			options.headers.Set("User-Agent", grokUpstreamUserAgent)
			if account.IsGrokOAuth() {
				applyGrokCLIHeaders(options.headers)
			}
		}
	}
	download := downloadGenerationMediaWithOptions
	if d != nil && d.download != nil {
		download = d.download
	}
	return download(ctx, rawURL, dir, index, options)
}

func downloadGenerationMedia(ctx context.Context, rawURL, dir string, index int) (string, error) {
	return downloadGenerationMediaWithOptions(ctx, rawURL, dir, index, generationMediaDownloadOptions{})
}

func downloadGenerationMediaWithOptions(ctx context.Context, rawURL, dir string, index int, options generationMediaDownloadOptions) (string, error) {
	parsed, err := validateGenerationMediaURL(rawURL)
	if err != nil {
		return "", err
	}
	if err := validateGenerationMediaResolvedHost(ctx, parsed.Hostname()); err != nil {
		return "", err
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	if strings.TrimSpace(options.proxyURL) == "" {
		transport.DialContext = generationMediaDialContext
	} else {
		_, parsedProxy, proxyErr := proxyurl.Parse(options.proxyURL)
		if proxyErr != nil {
			return "", fmt.Errorf("生成媒体下载代理无效: %w", proxyErr)
		}
		transport.DialContext = nil
		if proxyErr := proxyutil.ConfigureTransportProxy(transport, parsedProxy); proxyErr != nil {
			return "", fmt.Errorf("配置生成媒体下载代理失败: %w", proxyErr)
		}
	}
	client := &http.Client{
		Transport: transport,
		Timeout:   generationMediaTimeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return errors.New("生成媒体重定向次数过多")
			}
			redirectURL, err := validateGenerationMediaURL(req.URL.String())
			if err != nil {
				return err
			}
			return validateGenerationMediaResolvedHost(req.Context(), redirectURL.Hostname())
		},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return "", fmt.Errorf("创建生成媒体下载请求失败: %w", err)
	}
	for key, values := range options.headers {
		for _, value := range values {
			req.Header.Add(key, value)
		}
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("下载生成媒体失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("下载生成媒体失败: HTTP %d", resp.StatusCode)
	}
	if resp.ContentLength > generationMediaMaxBytes {
		return "", fmt.Errorf("生成媒体超过 %d MiB 限制", generationMediaMaxBytes>>20)
	}
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", err
	}
	extension := generationMediaExtension(resp.Header.Get("Content-Type"), parsed.Path)
	name := fmt.Sprintf("%d%s", index, extension)
	temporary, err := os.CreateTemp(dir, ".generation-media-*")
	if err != nil {
		return "", err
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	written, copyErr := io.Copy(temporary, io.LimitReader(resp.Body, generationMediaMaxBytes+1))
	closeErr := temporary.Close()
	if copyErr != nil {
		return "", fmt.Errorf("保存生成媒体失败: %w", copyErr)
	}
	if closeErr != nil {
		return "", fmt.Errorf("关闭生成媒体文件失败: %w", closeErr)
	}
	if written > generationMediaMaxBytes {
		return "", fmt.Errorf("生成媒体超过 %d MiB 限制", generationMediaMaxBytes>>20)
	}
	target := filepath.Join(dir, name)
	if err := os.Remove(target); err != nil && !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	if err := os.Rename(temporaryName, target); err != nil {
		return "", err
	}
	if err := os.Chmod(target, 0o640); err != nil {
		return "", err
	}
	return name, nil
}

func validateGenerationMediaResolvedHost(ctx context.Context, host string) error {
	host = strings.TrimSpace(host)
	if host == "" {
		return errors.New("生成媒体地址无效")
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return fmt.Errorf("解析生成媒体主机失败: %w", err)
	}
	if len(addresses) == 0 {
		return errors.New("生成媒体主机没有可用地址")
	}
	for _, address := range addresses {
		if !isPublicGenerationMediaIP(address.IP) {
			return errors.New("生成媒体地址不允许访问私有网络")
		}
	}
	return nil
}

func validateGenerationMediaURL(rawURL string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.User != nil {
		return nil, errors.New("生成媒体地址无效")
	}
	return parsed, nil
}

func generationMediaDialContext(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return nil, fmt.Errorf("解析生成媒体地址失败: %w", err)
	}
	addresses, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, fmt.Errorf("解析生成媒体主机失败: %w", err)
	}
	dialer := &net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}
	for _, address := range addresses {
		if !isPublicGenerationMediaIP(address.IP) {
			continue
		}
		conn, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(address.IP.String(), port))
		if dialErr == nil {
			return conn, nil
		}
		err = dialErr
	}
	if err != nil {
		return nil, fmt.Errorf("连接生成媒体主机失败: %w", err)
	}
	return nil, errors.New("生成媒体地址不允许访问私有网络")
}

func isPublicGenerationMediaIP(ip net.IP) bool {
	return ip != nil && ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() && !ip.IsLinkLocalMulticast()
}

func generationMediaExtension(contentType, path string) string {
	contentType = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	byType := map[string]string{
		"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif",
		"video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
	}
	if extension := byType[contentType]; extension != "" {
		return extension
	}
	switch extension := strings.ToLower(filepath.Ext(path)); extension {
	case ".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov":
		return extension
	default:
		return ".bin"
	}
}

func truncateRunes(value string, max int) string {
	runes := []rune(value)
	if len(runes) <= max {
		return value
	}
	return string(runes[:max])
}
