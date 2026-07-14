package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
	"go.uber.org/zap"
)

func TestStripLocalVideoProviderFieldPreservesUpstreamPayload(t *testing.T) {
	cleaned := stripLocalVideoProviderField([]byte(`{
		"provider":"grok",
		"model":"grok-imagine-video",
		"prompt":"waves"
	}`))

	require.False(t, gjson.GetBytes(cleaned, "provider").Exists())
	require.Equal(t, "grok-imagine-video", gjson.GetBytes(cleaned, "model").String())
	require.Equal(t, "waves", gjson.GetBytes(cleaned, "prompt").String())
}

func TestCaptureVideoGenerationResponseDefersClientCommit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)

	result, buffered, err := captureVideoGenerationResponse(c, func() (*service.OpenAIForwardResult, error) {
		c.JSON(http.StatusAccepted, gin.H{"id": "task-123"})
		return &service.OpenAIForwardResult{ResponseID: "task-123"}, nil
	})

	require.NoError(t, err)
	require.Equal(t, "task-123", result.ResponseID)
	require.Empty(t, recorder.Body.String(), "upstream success must remain hidden until the durable binding succeeds")
	require.NoError(t, buffered.Commit())
	require.Equal(t, http.StatusAccepted, recorder.Code)
	require.Equal(t, "task-123", gjson.Get(recorder.Body.String(), "id").String())
}

func TestVideoResponseBufferRejectsOversizedMediaPayload(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	buffer := newVideoResponseBuffer(c.Writer)
	buffer.limit = 8

	written, err := buffer.Write([]byte("123456789"))
	require.NoError(t, err)
	require.Equal(t, 9, written)
	require.Equal(t, http.StatusBadGateway, buffer.Status())
	require.Contains(t, string(buffer.Bytes()), "response is too large")
}

func TestVideoResponseBufferWriteStringRejectsOversizedMediaPayload(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	buffer := newVideoResponseBuffer(c.Writer)
	buffer.limit = 8

	written, err := buffer.WriteString("123456789")
	require.NoError(t, err)
	require.Equal(t, 9, written)
	require.Equal(t, http.StatusBadGateway, buffer.Status())
	require.Contains(t, string(buffer.Bytes()), "response is too large")
}

func TestVideoTaskBindingFailureIncludesRecoverableUpstreamTaskID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)

	videoTaskErrorResponse(c, service.ErrVideoTaskBindingFailed, "task-123")

	require.Equal(t, http.StatusBadGateway, recorder.Code)
	require.Equal(t, "VIDEO_TASK_BINDING_FAILED", gjson.Get(recorder.Body.String(), "error.code").String())
	require.Equal(t, "task-123", gjson.Get(recorder.Body.String(), "error.upstream_task_id").String())
}

func TestVideoTaskPersistenceContextSurvivesClientCancellation(t *testing.T) {
	parent, cancelParent := context.WithCancel(context.Background())
	cancelParent()

	ctx, cancel := videoTaskPersistenceContext(parent)
	defer cancel()

	require.NoError(t, ctx.Err())
	deadline, ok := ctx.Deadline()
	require.True(t, ok)
	require.WithinDuration(t, time.Now().Add(videoTaskPersistenceTimeout), deadline, time.Second)
}

func TestVideoProviderSubmissionDoesNotRequireImageGenerationPermission(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos/generations", strings.NewReader(`{
		"model":"agnes-video-v2.0",
		"prompt":"waves",
		"width":854,
		"height":480,
		"num_frames":73,
		"frame_rate":24
	}`))

	cache := &helperConcurrencyCacheStub{waitAllowed: false}
	h := &OpenAIGatewayHandler{
		concurrencyHelper: NewConcurrencyHelper(service.NewConcurrencyService(cache), "", 0),
	}
	adapter, ok := (&service.OpenAIGatewayService{}).GetVideoProviderAdapter("agnes")
	require.True(t, ok)

	groupID := int64(37)
	apiKey := &service.APIKey{
		ID:      78,
		GroupID: &groupID,
		Group: &service.Group{
			ID:                   groupID,
			Platform:             service.PlatformOpenAI,
			AllowImageGeneration: false,
		},
	}
	streamStarted := false
	h.handleVideoProviderSubmissionRequest(
		c,
		adapter,
		service.VideoProviderEndpointGeneration,
		apiKey,
		middleware2.AuthSubject{UserID: 1, Concurrency: 1},
		zap.NewNop(),
		time.Now(),
		&streamStarted,
	)

	require.Equal(t, http.StatusTooManyRequests, recorder.Code)
	require.NotContains(t, recorder.Body.String(), service.ImageGenerationPermissionMessage())
	require.Equal(t, 1, cache.userAcquireCalls)
}
