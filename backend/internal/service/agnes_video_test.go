package service

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

func TestPrepareAgnesVideoGenerationBodyMapsAliasAndPreservesOfficialFields(t *testing.T) {
	body := []byte(`{
		"provider":"agnes",
		"model":"video-v2",
		"prompt":"waves at sunset",
		"image_url":"https://example.com/frame.png",
		"duration":5,
		"frame_rate":24,
		"mode":"ti2vid",
		"seed":42,
		"negative_prompt":"blur"
	}`)

	prepared, info, err := PrepareAgnesVideoGenerationBody(body)
	require.NoError(t, err)
	require.Equal(t, AgnesVideoModel, info.Model)
	require.Equal(t, 121, info.NumFrames)
	require.Equal(t, 24, info.FrameRate)
	require.Equal(t, AgnesVideoModel, gjson.GetBytes(prepared, "model").String())
	require.Equal(t, "https://example.com/frame.png", gjson.GetBytes(prepared, "image").String())
	require.Equal(t, "ti2vid", gjson.GetBytes(prepared, "mode").String())
	require.Equal(t, int64(42), gjson.GetBytes(prepared, "seed").Int())
	require.Equal(t, "blur", gjson.GetBytes(prepared, "negative_prompt").String())
	require.False(t, gjson.GetBytes(prepared, "provider").Exists())
	require.False(t, gjson.GetBytes(prepared, "duration").Exists())
}

func TestPrepareAgnesVideoGenerationBodyCapsAndAlignsFrames(t *testing.T) {
	prepared, info, err := PrepareAgnesVideoGenerationBody([]byte(`{
		"model":"agnes-video-v2.0",
		"prompt":"long scene",
		"num_frames":999,
		"frame_rate":30
	}`))
	require.NoError(t, err)
	require.Equal(t, AgnesVideoMaxFrames, info.NumFrames)
	require.Equal(t, 30, info.FrameRate)
	require.Equal(t, int64(AgnesVideoMaxFrames), gjson.GetBytes(prepared, "num_frames").Int())
	require.Equal(t, int64(1152), gjson.GetBytes(prepared, "width").Int())
	require.Equal(t, int64(768), gjson.GetBytes(prepared, "height").Int())
}

func TestBuildAgnesVideoURLAvoidsDuplicateV1AndSupportsLegacyTaskID(t *testing.T) {
	generationURL, err := buildAgnesVideoURL("https://apihub.agnes-ai.com/v1", AgnesVideoEndpointGeneration, "", "")
	require.NoError(t, err)
	require.Equal(t, "https://apihub.agnes-ai.com/v1/videos", generationURL)

	videoURL, err := buildAgnesVideoURL("https://apihub.agnes-ai.com/v1", AgnesVideoEndpointStatus, "video-123", "video-v2")
	require.NoError(t, err)
	require.Equal(t, "https://apihub.agnes-ai.com/agnesapi?model_name=agnes-video-v2.0&video_id=video-123", videoURL)

	legacyURL, err := buildAgnesVideoURL("https://apihub.agnes-ai.com/v1", AgnesVideoEndpointStatus, "task_123", "agnes-video-v2.0")
	require.NoError(t, err)
	require.Equal(t, "https://apihub.agnes-ai.com/v1/videos/task_123", legacyURL)

	legacyHostURL, err := buildAgnesVideoURL("https://api.agnes-ai.com", AgnesVideoEndpointGeneration, "", "")
	require.NoError(t, err)
	require.Equal(t, "https://apihub.agnes-ai.com/v1/videos", legacyHostURL)
}

func TestForwardAgnesVideoGenerationNormalizesVideoID(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	body := []byte(`{"provider":"agnes","model":"video-v2","prompt":"waves","duration":5}`)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos/generations", bytes.NewReader(body))

	account := newAgnesTestAccount("https://apihub.agnes-ai.com/v1")
	upstream := &httpUpstreamRecorder{resp: &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(`{"id":"task_123","task_id":"task_123","video_id":"video-123","status":"queued","seconds":"5.0","size":"1152x768"}`)),
	}}
	svc := &OpenAIGatewayService{httpUpstream: upstream}

	result, err := svc.ForwardAgnesVideo(context.Background(), c, account, AgnesVideoEndpointGeneration, "", body)
	require.NoError(t, err)
	require.Equal(t, "https://apihub.agnes-ai.com/v1/videos", upstream.lastReq.URL.String())
	require.Equal(t, http.MethodPost, upstream.lastReq.Method)
	require.Equal(t, "Bearer agnes-key", upstream.lastReq.Header.Get("Authorization"))
	require.Equal(t, AgnesVideoModel, gjson.GetBytes(upstream.lastBody, "model").String())
	require.False(t, gjson.GetBytes(upstream.lastBody, "provider").Exists())
	require.Equal(t, "video-123", result.ResponseID)
	require.Equal(t, AgnesVideoModel, result.BillingModel)
	require.Equal(t, 1, result.VideoCount)
	require.Equal(t, VideoBillingResolution720P, result.VideoResolution)
	require.Equal(t, 5, result.VideoDurationSeconds)
	require.Equal(t, "video-123", gjson.Get(recorder.Body.String(), "request_id").String())
	require.Equal(t, "agnes", gjson.Get(recorder.Body.String(), "provider").String())
	require.Equal(t, "queued", gjson.Get(recorder.Body.String(), "status").String())
}

func TestForwardAgnesVideoStatusUsesVideoIDAndNormalizesResult(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/v1/videos/video-123?provider=agnes&model=video-v2", nil)

	account := newAgnesTestAccount("https://apihub.agnes-ai.com")
	upstream := &httpUpstreamRecorder{resp: &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(`{"id":"task_123","video_id":"video-123","status":"in_progress","progress":60,"seconds":"5.0","size":"1280x720","url":"https://cdn.example/video.mp4"}`)),
	}}
	svc := &OpenAIGatewayService{httpUpstream: upstream}

	result, err := svc.ForwardAgnesVideo(context.Background(), c, account, AgnesVideoEndpointStatus, "video-123", nil)
	require.NoError(t, err)
	require.Equal(t, "https://apihub.agnes-ai.com/agnesapi?model_name=agnes-video-v2.0&video_id=video-123", upstream.lastReq.URL.String())
	require.Equal(t, "video-123", result.ResponseID)
	require.Equal(t, "processing", gjson.Get(recorder.Body.String(), "status").String())
	require.Equal(t, "https://cdn.example/video.mp4", gjson.Get(recorder.Body.String(), "video.url").String())
	require.Equal(t, int64(1280), gjson.Get(recorder.Body.String(), "video.width").Int())
	require.Equal(t, int64(720), gjson.Get(recorder.Body.String(), "video.height").Int())
}

func TestForwardAgnesVideoContentRedirectsCompletedURL(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/v1/videos/video-123/content?provider=agnes&model=agnes-video-v2.0", nil)

	account := newAgnesTestAccount("https://apihub.agnes-ai.com")
	upstream := &httpUpstreamRecorder{resp: &http.Response{
		StatusCode: http.StatusOK,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(`{"video_id":"video-123","status":"completed","url":"https://cdn.example/video.mp4"}`)),
	}}
	svc := &OpenAIGatewayService{httpUpstream: upstream}

	result, err := svc.ForwardAgnesVideo(context.Background(), c, account, AgnesVideoEndpointContent, "video-123", nil)
	require.NoError(t, err)
	require.Equal(t, "video-123", result.ResponseID)
	require.Equal(t, http.StatusFound, recorder.Code)
	require.Equal(t, "https://cdn.example/video.mp4", recorder.Header().Get("Location"))
}

func newAgnesTestAccount(baseURL string) *Account {
	return &Account{
		ID:          71,
		Name:        "agnes",
		Platform:    PlatformOpenAI,
		Type:        AccountTypeAPIKey,
		Concurrency: 1,
		Credentials: map[string]any{
			"api_key":  "agnes-key",
			"base_url": baseURL,
		},
	}
}
