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

func TestNormalizeVideoProviderResponseBuildsStableContract(t *testing.T) {
	body := []byte(`{
		"id":"req-123",
		"state":"done",
		"progress":100,
		"size":"1280x720",
		"result":{
			"video_url":"https://cdn.example/video.mp4",
			"duration":10,
			"width":1280,
			"height":720
		}
	}`)

	normalized, responseID, err := normalizeVideoProviderResponse(body, "grok", "", VideoProviderEndpointStatus)
	require.NoError(t, err)
	require.Equal(t, "req-123", responseID)
	require.Equal(t, "req-123", gjson.GetBytes(normalized, "request_id").String())
	require.Equal(t, "grok", gjson.GetBytes(normalized, "provider").String())
	require.Equal(t, "completed", gjson.GetBytes(normalized, "status").String())
	require.Equal(t, "https://cdn.example/video.mp4", gjson.GetBytes(normalized, "url").String())
	require.Equal(t, "https://cdn.example/video.mp4", gjson.GetBytes(normalized, "video.url").String())
	require.Equal(t, int64(10), gjson.GetBytes(normalized, "video.duration").Int())
	require.Equal(t, int64(1280), gjson.GetBytes(normalized, "video.width").Int())
	require.Equal(t, int64(720), gjson.GetBytes(normalized, "video.height").Int())
}

func TestNormalizeVideoProviderGenerationResponseDefaultsQueued(t *testing.T) {
	normalized, responseID, err := normalizeVideoProviderResponse(
		[]byte(`{"data":{"request_id":"req-456"}}`),
		"grok",
		"",
		VideoProviderEndpointGeneration,
	)
	require.NoError(t, err)
	require.Equal(t, "req-456", responseID)
	require.Equal(t, "req-456", gjson.GetBytes(normalized, "request_id").String())
	require.Equal(t, "req-456", gjson.GetBytes(normalized, "id").String())
	require.Equal(t, "queued", gjson.GetBytes(normalized, "status").String())
}

func TestNormalizeVideoProviderResponseDefaultsCompletedWhenVideoURLExists(t *testing.T) {
	normalized, responseID, err := normalizeVideoProviderResponse(
		[]byte(`{"id":"req-789","video":{"url":"https://cdn.example/video.mp4"}}`),
		"grok",
		"",
		VideoProviderEndpointStatus,
	)
	require.NoError(t, err)
	require.Equal(t, "req-789", responseID)
	require.Equal(t, "completed", gjson.GetBytes(normalized, "status").String())
}

func TestGrokVideoContentURLPreservesSingleV1Prefix(t *testing.T) {
	got, err := GrokMediaEndpointVideoContent.upstreamURL("https://relay.example/v1", "request/123")
	require.NoError(t, err)
	require.Equal(t, "https://relay.example/v1/videos/request%2F123/content", got)
}

func TestGetVideoProviderAdapterReturnsGrokCompatibleAdapterForOpenAIAccounts(t *testing.T) {
	adapter, ok := (&OpenAIGatewayService{}).GetVideoProviderAdapter(" GROK ")
	require.True(t, ok)
	require.Equal(t, "grok", adapter.Provider())
	require.Equal(t, PlatformOpenAI, adapter.AccountPlatform())
}

func TestGetVideoProviderAdapterSelectsGrokAccountPlatform(t *testing.T) {
	svc := &OpenAIGatewayService{}
	for _, platform := range []string{PlatformOpenAI, PlatformGrok} {
		adapter, ok := svc.GetVideoProviderAdapterForPlatform("grok", platform)
		require.True(t, ok)
		require.Equal(t, platform, adapter.AccountPlatform())
		require.Equal(t, "grok", adapter.Provider())
	}

	_, ok := svc.GetVideoProviderAdapterForPlatform("agnes", PlatformGrok)
	require.False(t, ok)
}

func TestGrokCompatibleVideoParseGenerationRequestNormalizesSchedulingAliases(t *testing.T) {
	adapter, ok := (&OpenAIGatewayService{}).GetVideoProviderAdapter("grok")
	require.True(t, ok)

	for _, alias := range []string{"sora-2", "sora-2-pro"} {
		info, err := adapter.ParseGenerationRequest([]byte(`{"model":"` + alias + `","prompt":"waves"}`))
		require.NoError(t, err)
		require.Equal(t, "grok-imagine-video", info.Model)
	}
}

func TestForwardGrokCompatibleVideoWithOpenAICompatibleAccount(t *testing.T) {
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	body := []byte(`{"provider":"grok","model":"grok-imagine-video-1.5","prompt":"animate this exact reference","image":{"url":"data:image/png;base64,AAAA"},"duration":5,"resolution":"1080p"}`)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos/generations", bytes.NewReader(body))

	account := &Account{
		ID:          72,
		Name:        "grok-compatible",
		Platform:    PlatformOpenAI,
		Type:        AccountTypeAPIKey,
		Concurrency: 1,
		Credentials: map[string]any{
			"api_key":  "grok-compatible-key",
			"base_url": "https://relay.example/v1",
		},
	}
	upstream := &httpUpstreamRecorder{resp: &http.Response{
		StatusCode: http.StatusAccepted,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(`{"id":"request-123","status":"pending"}`)),
	}}
	svc := &OpenAIGatewayService{httpUpstream: upstream}

	result, err := svc.ForwardGrokMedia(context.Background(), c, account, GrokMediaEndpointVideosGenerations, "", body, "application/json")
	require.NoError(t, err)
	require.Equal(t, "https://relay.example/v1/videos/generations", upstream.lastReq.URL.String())
	require.Equal(t, "Bearer grok-compatible-key", upstream.lastReq.Header.Get("Authorization"))
	require.False(t, gjson.GetBytes(upstream.lastBody, "provider").Exists())
	require.Equal(t, "animate this exact reference", gjson.GetBytes(upstream.lastBody, "prompt").String())
	require.Equal(t, "data:image/png;base64,AAAA", gjson.GetBytes(upstream.lastBody, "image.url").String())
	require.Equal(t, "1080p", gjson.GetBytes(upstream.lastBody, "resolution").String())
	require.Equal(t, "request-123", result.ResponseID)
	require.Equal(t, "request-123", gjson.Get(recorder.Body.String(), "request_id").String())
	require.Equal(t, "grok", gjson.Get(recorder.Body.String(), "provider").String())
	require.Equal(t, "queued", gjson.Get(recorder.Body.String(), "status").String())
}

func TestForwardGrokCompatibleVideoRejectsNonCustomOpenAIBaseURL(t *testing.T) {
	gin.SetMode(gin.TestMode)
	body := []byte(`{"provider":"grok","model":"grok-imagine-video","prompt":"waves"}`)

	for _, tt := range []struct {
		name    string
		baseURL string
	}{
		{name: "missing base URL"},
		{name: "official OpenAI base URL", baseURL: "https://api.openai.com/v1"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos/generations", bytes.NewReader(body))
			account := &Account{
				ID:       73,
				Platform: PlatformOpenAI,
				Type:     AccountTypeAPIKey,
				Credentials: map[string]any{
					"api_key":  "third-party-key",
					"base_url": tt.baseURL,
				},
			}
			upstream := &httpUpstreamRecorder{resp: &http.Response{
				StatusCode: http.StatusAccepted,
				Header:     http.Header{"Content-Type": []string{"application/json"}},
				Body:       io.NopCloser(strings.NewReader(`{"id":"unexpected"}`)),
			}}
			svc := &OpenAIGatewayService{httpUpstream: upstream}

			_, err := svc.ForwardGrokMedia(context.Background(), c, account, GrokMediaEndpointVideosGenerations, "", body, "application/json")

			require.ErrorContains(t, err, "custom base_url")
			require.Nil(t, upstream.lastReq)
		})
	}
}
