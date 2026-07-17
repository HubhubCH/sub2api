package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

type mediaGenerationRecordRepoStub struct {
	created service.CreateGenerationRecordParams
	record  *service.GenerationRecord
}

func (r *mediaGenerationRecordRepoStub) Create(_ context.Context, params service.CreateGenerationRecordParams, _ time.Time, _ int) (*service.GenerationRecord, []string, error) {
	r.created = params
	r.record = &service.GenerationRecord{TaskID: params.TaskID, UserID: params.UserID, APIKeyID: params.APIKeyID, MediaType: params.MediaType, CreatorTool: params.CreatorTool, Provider: params.Provider, Model: params.Model}
	return r.record, nil, nil
}

func (r *mediaGenerationRecordRepoStub) Complete(_ context.Context, _ string, _ int64, accountID int64, status, upstreamTaskID string, result json.RawMessage, failure string) error {
	r.record.AccountID = accountID
	r.record.Status = status
	r.record.UpstreamTaskID = upstreamTaskID
	r.record.Result = result
	r.record.ErrorMessage = failure
	return nil
}

func (r *mediaGenerationRecordRepoStub) CompleteByUpstream(context.Context, int64, int64, int64, string, string, string, json.RawMessage, string) error {
	return nil
}
func (r *mediaGenerationRecordRepoStub) ListByUser(context.Context, int64, int) ([]*service.GenerationRecord, error) {
	return nil, nil
}
func (r *mediaGenerationRecordRepoStub) GetByUser(context.Context, int64, string) (*service.GenerationRecord, error) {
	return r.record, nil
}
func (r *mediaGenerationRecordRepoStub) GetByUpstream(context.Context, int64, int64, int64, string, string) (*service.GenerationRecord, error) {
	return r.record, nil
}
func (r *mediaGenerationRecordRepoStub) TaskExists(context.Context, string) (bool, error) {
	return true, nil
}
func (r *mediaGenerationRecordRepoStub) Cleanup(context.Context, int64, time.Time, int) ([]string, error) {
	return nil, nil
}
func (r *mediaGenerationRecordRepoStub) ListPendingVideos(context.Context, time.Time, int) ([]*service.GenerationRecord, error) {
	return nil, nil
}

func TestPersistVideoGenerationInfersAndPersistsProvider(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, test := range []struct {
		name, model, provider string
	}{
		{name: "Agnes", model: service.AgnesVideoModel, provider: "agnes"},
		{name: "Grok", model: "grok-imagine-video", provider: "grok"},
	} {
		t.Run(test.name, func(t *testing.T) {
			repo := &mediaGenerationRecordRepoStub{}
			h := &OpenAIGatewayHandler{generationRecordService: service.NewGenerationRecordService(repo)}
			groupID := int64(3)
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos/generations", strings.NewReader(`{"model":"`+test.model+`","prompt":"waves"}`))
			c.Request.Header.Set("X-Save-Generation-Record", "1")
			c.Request.Header.Set("X-Creator-Tool", "video")
			c.Set(string(middleware2.ContextKeyAPIKey), &service.APIKey{ID: 9, UserID: 7, GroupID: &groupID})
			c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: 7})

			h.PersistVideoGeneration(c, func(c *gin.Context) {
				c.JSON(http.StatusAccepted, gin.H{"id": "upstream-1", "status": "processing"})
			})

			require.Equal(t, http.StatusAccepted, recorder.Code)
			require.Equal(t, test.provider, repo.created.Provider)
			require.Equal(t, "video", repo.created.CreatorTool)
		})
	}
}

func TestNormalizeCreatorToolRejectsMismatchedMediaType(t *testing.T) {
	require.Equal(t, "outpaint", normalizeCreatorTool("OUTPAINT", "image"))
	require.Equal(t, "video", normalizeCreatorTool("video", "video"))
	require.Empty(t, normalizeCreatorTool("video", "image"))
	require.Empty(t, normalizeCreatorTool("unknown", "image"))
}

func TestPersistVideoGenerationKeepsRecoverableBindingFailureSubmitted(t *testing.T) {
	gin.SetMode(gin.TestMode)
	repo := &mediaGenerationRecordRepoStub{}
	h := &OpenAIGatewayHandler{generationRecordService: service.NewGenerationRecordService(repo)}
	groupID := int64(3)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos/generations", strings.NewReader(`{"model":"grok-imagine-video","prompt":"waves"}`))
	c.Request.Header.Set("X-Save-Generation-Record", "1")
	c.Set(string(middleware2.ContextKeyAPIKey), &service.APIKey{ID: 9, UserID: 7, GroupID: &groupID})
	c.Set(string(middleware2.ContextKeyUser), middleware2.AuthSubject{UserID: 7})

	h.PersistVideoGeneration(c, func(c *gin.Context) {
		c.Set(videoTaskAccountIDContextKey, int64(42))
		c.Set(videoTaskProviderContextKey, "grok")
		videoTaskErrorResponse(c, service.ErrVideoTaskBindingFailed, "upstream-1")
	})

	require.Equal(t, http.StatusBadGateway, recorder.Code)
	require.Equal(t, service.GenerationStatusSubmitted, repo.record.Status)
	require.Equal(t, int64(42), repo.record.AccountID)
	require.Equal(t, "grok", repo.record.Provider)
	require.Equal(t, "upstream-1", repo.record.UpstreamTaskID)
	require.Contains(t, repo.record.ErrorMessage, "本地跟踪记录创建失败")
}
