package service

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
)

type VideoProviderEndpoint string

const (
	VideoProviderEndpointGeneration VideoProviderEndpoint = "generation"
	VideoProviderEndpointEdit       VideoProviderEndpoint = "edit"
	VideoProviderEndpointExtension  VideoProviderEndpoint = "extension"
	VideoProviderEndpointStatus     VideoProviderEndpoint = "status"
	VideoProviderEndpointContent    VideoProviderEndpoint = "content"
)

func (e VideoProviderEndpoint) IsSubmission() bool {
	return e == VideoProviderEndpointGeneration || e == VideoProviderEndpointEdit || e == VideoProviderEndpointExtension
}

type VideoProviderRequestInfo struct {
	Model          string
	ModerationBody []byte
}

// VideoProviderAdapter 将供应商特有的请求和响应格式隔离在共享调度、计费和故障转移流程之外。
type VideoProviderAdapter interface {
	Provider() string
	AccountPlatform() string
	NormalizeModel(model string) string
	ParseGenerationRequest(body []byte) (VideoProviderRequestInfo, error)
	Forward(ctx context.Context, c *gin.Context, account *Account, endpoint VideoProviderEndpoint, requestID string, body []byte) (*OpenAIForwardResult, error)
	SessionHash(requestID string) string
	BindRequestAccount(ctx context.Context, groupID *int64, requestID string, accountID int64) error
}

type gatewayGenerationVideoStatusPoller struct {
	gateway     *OpenAIGatewayService
	accountRepo AccountRepository
}

func NewGatewayGenerationVideoStatusPoller(gateway *OpenAIGatewayService, accountRepo AccountRepository) GenerationVideoStatusPoller {
	return &gatewayGenerationVideoStatusPoller{gateway: gateway, accountRepo: accountRepo}
}

func (p *gatewayGenerationVideoStatusPoller) PollVideoStatus(ctx context.Context, record *GenerationRecord) ([]byte, error) {
	if p == nil || p.gateway == nil || p.accountRepo == nil || record == nil || record.AccountID <= 0 {
		return nil, fmt.Errorf("视频状态轮询服务不可用")
	}
	account, err := p.accountRepo.GetByID(ctx, record.AccountID)
	if err != nil {
		return nil, fmt.Errorf("视频任务原账号不可用: %w", err)
	}
	if account == nil || !account.IsActive() {
		return nil, fmt.Errorf("视频任务原账号不可用")
	}
	adapter, ok := p.gateway.GetVideoProviderAdapterForPlatform(record.Provider, account.Platform)
	if !ok || adapter.AccountPlatform() != account.Platform {
		return nil, fmt.Errorf("视频任务供应商不匹配")
	}
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	requestURL := "http://localhost/v1/videos/" + url.PathEscape(record.UpstreamTaskID)
	if model := strings.TrimSpace(record.Model); model != "" {
		requestURL += "?model=" + url.QueryEscape(model)
	}
	c.Request = httptest.NewRequest("GET", requestURL, nil).WithContext(ctx)
	if _, err := adapter.Forward(ctx, c, account, VideoProviderEndpointStatus, record.UpstreamTaskID, nil); err != nil {
		return nil, err
	}
	if recorder.Code < 200 || recorder.Code >= 300 {
		return nil, fmt.Errorf("视频状态上游返回 HTTP %d", recorder.Code)
	}
	return append([]byte(nil), recorder.Body.Bytes()...), nil
}

func (s *OpenAIGatewayService) GetVideoProviderAdapter(provider string) (VideoProviderAdapter, bool) {
	return s.GetVideoProviderAdapterForPlatform(provider, PlatformOpenAI)
}

func (s *OpenAIGatewayService) GetVideoProviderAdapterForPlatform(provider, accountPlatform string) (VideoProviderAdapter, bool) {
	accountPlatform = strings.TrimSpace(accountPlatform)
	if accountPlatform == "" {
		accountPlatform = PlatformOpenAI
	}
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "agnes":
		if accountPlatform != PlatformOpenAI {
			return nil, false
		}
		return &agnesVideoProviderAdapter{service: s}, true
	case "grok":
		if accountPlatform != PlatformOpenAI && accountPlatform != PlatformGrok {
			return nil, false
		}
		return &grokCompatibleVideoProviderAdapter{service: s, accountPlatform: accountPlatform}, true
	default:
		return nil, false
	}
}

// grokCompatibleVideoProviderAdapter 支持显式配置自定义 /v1 地址的第三方 Grok 兼容 API Key 账号。
type grokCompatibleVideoProviderAdapter struct {
	service         *OpenAIGatewayService
	accountPlatform string
}

func (a *grokCompatibleVideoProviderAdapter) Provider() string {
	return "grok"
}

func (a *grokCompatibleVideoProviderAdapter) AccountPlatform() string {
	if strings.TrimSpace(a.accountPlatform) == "" {
		return PlatformOpenAI
	}
	return a.accountPlatform
}

func (a *grokCompatibleVideoProviderAdapter) NormalizeModel(model string) string {
	model = strings.TrimSpace(model)
	if model == "sora-2" || model == "sora-2-pro" {
		return "grok-imagine-video"
	}
	return model
}

func (a *grokCompatibleVideoProviderAdapter) ParseGenerationRequest(body []byte) (VideoProviderRequestInfo, error) {
	if len(body) == 0 || !json.Valid(body) {
		return VideoProviderRequestInfo{}, fmt.Errorf("invalid Grok video request JSON")
	}
	info := ParseGrokMediaRequest("application/json", body)
	return VideoProviderRequestInfo{
		Model:          a.NormalizeModel(info.Model),
		ModerationBody: info.ModerationBody(),
	}, nil
}

func (a *grokCompatibleVideoProviderAdapter) Forward(
	ctx context.Context,
	c *gin.Context,
	account *Account,
	endpoint VideoProviderEndpoint,
	requestID string,
	body []byte,
) (*OpenAIForwardResult, error) {
	grokEndpoint := GrokMediaEndpointVideoStatus
	switch endpoint {
	case VideoProviderEndpointGeneration:
		grokEndpoint = GrokMediaEndpointVideosGenerations
	case VideoProviderEndpointEdit:
		grokEndpoint = GrokMediaEndpointVideosEdits
	case VideoProviderEndpointExtension:
		grokEndpoint = GrokMediaEndpointVideosExtensions
	case VideoProviderEndpointContent:
		grokEndpoint = GrokMediaEndpointVideoContent
	case VideoProviderEndpointStatus:
	default:
		return nil, fmt.Errorf("unsupported Grok video endpoint: %s", endpoint)
	}
	return a.service.ForwardGrokMedia(ctx, c, account, grokEndpoint, requestID, body, "application/json")
}

func (a *grokCompatibleVideoProviderAdapter) SessionHash(requestID string) string {
	return GrokMediaVideoRequestSessionHash(requestID)
}

func (a *grokCompatibleVideoProviderAdapter) BindRequestAccount(ctx context.Context, groupID *int64, requestID string, accountID int64) error {
	return a.service.BindGrokMediaVideoRequestAccount(ctx, groupID, requestID, accountID)
}

type agnesVideoProviderAdapter struct {
	service *OpenAIGatewayService
}

func (a *agnesVideoProviderAdapter) Provider() string {
	return "agnes"
}

func (a *agnesVideoProviderAdapter) AccountPlatform() string {
	return PlatformOpenAI
}

func (a *agnesVideoProviderAdapter) NormalizeModel(model string) string {
	return NormalizeAgnesVideoModel(model)
}

func (a *agnesVideoProviderAdapter) ParseGenerationRequest(body []byte) (VideoProviderRequestInfo, error) {
	info, err := ParseAgnesVideoRequest(body)
	if err != nil {
		return VideoProviderRequestInfo{}, err
	}
	return VideoProviderRequestInfo{
		Model:          info.Model,
		ModerationBody: info.ModerationBody(),
	}, nil
}

func (a *agnesVideoProviderAdapter) Forward(
	ctx context.Context,
	c *gin.Context,
	account *Account,
	endpoint VideoProviderEndpoint,
	requestID string,
	body []byte,
) (*OpenAIForwardResult, error) {
	agnesEndpoint := AgnesVideoEndpointStatus
	switch endpoint {
	case VideoProviderEndpointGeneration:
		agnesEndpoint = AgnesVideoEndpointGeneration
	case VideoProviderEndpointContent:
		agnesEndpoint = AgnesVideoEndpointContent
	case VideoProviderEndpointStatus:
	default:
		return nil, fmt.Errorf("unsupported Agnes video endpoint: %s", endpoint)
	}
	return a.service.ForwardAgnesVideo(ctx, c, account, agnesEndpoint, requestID, body)
}

func (a *agnesVideoProviderAdapter) SessionHash(requestID string) string {
	return AgnesVideoRequestSessionHash(requestID)
}

func (a *agnesVideoProviderAdapter) BindRequestAccount(ctx context.Context, groupID *int64, requestID string, accountID int64) error {
	return a.service.BindAgnesVideoRequestAccount(ctx, groupID, requestID, accountID)
}

// normalizeVideoProviderResponse 保留供应商字段，同时补充本站视频页使用的稳定响应字段。
func normalizeVideoProviderResponse(body []byte, provider, fallbackID string, endpoint VideoProviderEndpoint) ([]byte, string, error) {
	if len(body) == 0 || !json.Valid(body) {
		return nil, "", fmt.Errorf("%s returned invalid JSON", strings.TrimSpace(provider))
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, "", fmt.Errorf("decode %s video response: %w", strings.TrimSpace(provider), err)
	}

	responseID := firstVideoJSONValue(body,
		"request_id", "video_id", "id", "task_id",
		"data.request_id", "data.video_id", "data.id", "data.task_id",
		"result.request_id", "result.video_id", "result.id", "result.task_id",
		"video.request_id", "video.video_id", "video.id",
	)
	if responseID == "" {
		responseID = strings.TrimSpace(fallbackID)
	}
	if responseID != "" {
		payload["request_id"] = responseID
		if _, exists := payload["id"]; !exists && endpoint == VideoProviderEndpointGeneration {
			payload["id"] = responseID
		}
	}
	payload["provider"] = strings.ToLower(strings.TrimSpace(provider))

	videoURL := firstVideoJSONValue(body,
		"video.url", "url", "video_url",
		"data.video.url", "data.url", "data.video_url",
		"result.video.url", "result.url", "result.video_url",
		"output.video.url", "output.url", "output.video_url",
		"data.output.0.url", "output.0.url",
	)
	status := NormalizeVideoProviderStatus(firstVideoJSONValue(body,
		"status", "state", "data.status", "data.state", "result.status", "result.state",
	))
	if status == "" {
		if videoURL != "" {
			status = "completed"
		} else if endpoint == VideoProviderEndpointGeneration {
			status = "queued"
		} else {
			status = "processing"
		}
	}
	payload["status"] = status

	if progress, ok := firstVideoJSONAny(body, "progress", "data.progress", "result.progress"); ok {
		payload["progress"] = progress
	}

	video := make(map[string]any)
	if existing, ok := payload["video"].(map[string]any); ok {
		for key, value := range existing {
			video[key] = value
		}
	}
	if videoURL != "" {
		video["url"] = videoURL
		payload["url"] = videoURL
	}
	if duration, ok := firstVideoJSONAny(body,
		"video.duration", "duration", "seconds",
		"data.video.duration", "data.duration", "data.seconds",
		"result.video.duration", "result.duration", "result.seconds",
	); ok {
		video["duration"] = normalizeVideoNumber(duration)
	}
	if width, ok := firstVideoJSONAny(body, "video.width", "width", "data.width", "result.width"); ok {
		video["width"] = normalizeVideoNumber(width)
	}
	if height, ok := firstVideoJSONAny(body, "video.height", "height", "data.height", "result.height"); ok {
		video["height"] = normalizeVideoNumber(height)
	}
	if _, widthExists := video["width"]; !widthExists {
		if width, height, ok := videoDimensionsFromSize(firstVideoJSONValue(body, "size", "data.size", "result.size")); ok {
			video["width"] = width
			video["height"] = height
		}
	}
	if len(video) > 0 {
		payload["video"] = video
	}

	normalized, err := json.Marshal(payload)
	if err != nil {
		return nil, "", fmt.Errorf("encode %s video response: %w", strings.TrimSpace(provider), err)
	}
	return normalized, responseID, nil
}

func firstVideoJSONValue(body []byte, paths ...string) string {
	for _, path := range paths {
		if value := strings.TrimSpace(gjson.GetBytes(body, path).String()); value != "" {
			return value
		}
	}
	return ""
}

func firstVideoJSONAny(body []byte, paths ...string) (any, bool) {
	for _, path := range paths {
		result := gjson.GetBytes(body, path)
		if !result.Exists() || result.Type == gjson.Null {
			continue
		}
		var value any
		if err := json.Unmarshal([]byte(result.Raw), &value); err == nil {
			return value, true
		}
	}
	return nil, false
}

func normalizeVideoNumber(value any) any {
	switch typed := value.(type) {
	case string:
		number, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		if err != nil {
			return value
		}
		if number == float64(int64(number)) {
			return int64(number)
		}
		return number
	default:
		return value
	}
}

func videoDimensionsFromSize(size string) (int, int, bool) {
	parts := strings.FieldsFunc(strings.ToLower(strings.TrimSpace(size)), func(r rune) bool {
		return r == 'x' || r == '×'
	})
	if len(parts) != 2 {
		return 0, 0, false
	}
	width, widthErr := strconv.Atoi(strings.TrimSpace(parts[0]))
	height, heightErr := strconv.Atoi(strings.TrimSpace(parts[1]))
	if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 {
		return 0, 0, false
	}
	return width, height, true
}

func NormalizeVideoProviderStatus(status string) string {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "success", "succeeded", "completed", "complete", "done", "finished":
		return "completed"
	case "failed", "failure", "error", "cancelled", "canceled", "expired":
		return "failed"
	case "queued", "pending", "waiting", "submitted", "created":
		return "queued"
	case "running", "processing", "generating", "in_progress":
		return "processing"
	default:
		return strings.TrimSpace(status)
	}
}
