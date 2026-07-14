package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/tidwall/gjson"
)

const (
	AgnesVideoModel           = "agnes-video-v2.0"
	AgnesVideoModelAlias      = "video-v2"
	AgnesVideoFrameRate       = 24
	AgnesVideoMaxFrames       = 441
	agnesVideoDefaultDuration = 6
)

type AgnesVideoEndpoint string

const (
	AgnesVideoEndpointGeneration AgnesVideoEndpoint = "generation"
	AgnesVideoEndpointStatus     AgnesVideoEndpoint = "status"
	AgnesVideoEndpointContent    AgnesVideoEndpoint = "content"
)

type AgnesVideoRequestInfo struct {
	Model     string
	Prompt    string
	Image     string
	Width     int
	Height    int
	NumFrames int
	FrameRate int
}

func (r AgnesVideoRequestInfo) ModerationBody() []byte {
	payload := make(map[string]any)
	if r.Prompt != "" {
		payload["prompt"] = r.Prompt
	}
	if r.Image != "" {
		payload["images"] = []map[string]string{{"image_url": r.Image}}
	}
	if len(payload) == 0 {
		return nil
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil
	}
	return body
}

func NormalizeAgnesVideoModel(model string) string {
	switch strings.ToLower(strings.TrimSpace(model)) {
	case AgnesVideoModel, AgnesVideoModelAlias:
		return AgnesVideoModel
	default:
		return strings.TrimSpace(model)
	}
}

func ParseAgnesVideoRequest(body []byte) (AgnesVideoRequestInfo, error) {
	_, info, err := PrepareAgnesVideoGenerationBody(body)
	return info, err
}

func PrepareAgnesVideoGenerationBody(body []byte) ([]byte, AgnesVideoRequestInfo, error) {
	var input struct {
		Model          string  `json:"model"`
		Prompt         string  `json:"prompt"`
		Image          string  `json:"image"`
		ImageURL       string  `json:"image_url"`
		ReferenceImage string  `json:"reference_image"`
		Duration       float64 `json:"duration"`
		Seconds        float64 `json:"seconds"`
		Width          int     `json:"width"`
		Height         int     `json:"height"`
		NumFrames      int     `json:"num_frames"`
		FrameRate      int     `json:"frame_rate"`
	}
	if len(body) == 0 || !json.Valid(body) {
		return nil, AgnesVideoRequestInfo{}, fmt.Errorf("invalid Agnes video request JSON")
	}
	if err := json.Unmarshal(body, &input); err != nil {
		return nil, AgnesVideoRequestInfo{}, fmt.Errorf("decode Agnes video request: %w", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, AgnesVideoRequestInfo{}, fmt.Errorf("decode Agnes video request fields: %w", err)
	}

	info := AgnesVideoRequestInfo{
		Model:  NormalizeAgnesVideoModel(input.Model),
		Prompt: strings.TrimSpace(input.Prompt),
		Image: firstNonEmpty(
			strings.TrimSpace(input.Image),
			strings.TrimSpace(input.ImageURL),
			strings.TrimSpace(input.ReferenceImage),
		),
		Width:     input.Width,
		Height:    input.Height,
		FrameRate: input.FrameRate,
	}
	if info.Model != AgnesVideoModel {
		return nil, AgnesVideoRequestInfo{}, fmt.Errorf("Agnes video model must be %s (alias %s is also accepted)", AgnesVideoModel, AgnesVideoModelAlias)
	}
	if info.Prompt == "" {
		return nil, AgnesVideoRequestInfo{}, fmt.Errorf("prompt is required")
	}
	if info.Width <= 0 {
		info.Width = 1152
	}
	if info.Height <= 0 {
		info.Height = 768
	}
	if info.FrameRate == 0 {
		info.FrameRate = AgnesVideoFrameRate
	}
	if info.FrameRate < 1 || info.FrameRate > 60 {
		return nil, AgnesVideoRequestInfo{}, fmt.Errorf("frame_rate must be between 1 and 60")
	}
	if input.NumFrames > 0 {
		info.NumFrames = normalizeAgnesFrameCount(input.NumFrames)
	} else {
		duration := input.Duration
		if duration <= 0 {
			duration = input.Seconds
		}
		info.NumFrames = agnesFramesForDuration(duration, info.FrameRate)
	}

	delete(payload, "provider")
	delete(payload, "duration")
	delete(payload, "seconds")
	delete(payload, "image_url")
	delete(payload, "reference_image")
	delete(payload, "aspect_ratio")
	delete(payload, "size")
	payload["model"] = info.Model
	payload["prompt"] = info.Prompt
	payload["width"] = info.Width
	payload["height"] = info.Height
	payload["frame_rate"] = info.FrameRate
	payload["num_frames"] = info.NumFrames
	if info.Image != "" {
		payload["image"] = info.Image
	} else {
		delete(payload, "image")
	}

	prepared, err := json.Marshal(payload)
	if err != nil {
		return nil, AgnesVideoRequestInfo{}, fmt.Errorf("encode Agnes video request: %w", err)
	}
	return prepared, info, nil
}

func agnesFramesForDuration(duration float64, frameRate int) int {
	if duration <= 0 {
		duration = agnesVideoDefaultDuration
	}
	if frameRate <= 0 {
		frameRate = AgnesVideoFrameRate
	}
	frames := int(math.Round(duration*float64(frameRate)/8))*8 + 1
	return normalizeAgnesFrameCount(frames)
}

func normalizeAgnesFrameCount(frames int) int {
	if frames < 9 {
		return 9
	}
	if frames > AgnesVideoMaxFrames {
		return AgnesVideoMaxFrames
	}
	return ((frames - 1) / 8 * 8) + 1
}

func AgnesVideoRequestSessionHash(requestID string) string {
	requestID = strings.TrimSpace(requestID)
	if requestID == "" {
		return ""
	}
	return "agnes-video:" + DeriveSessionHashFromSeed(requestID)
}

func (s *OpenAIGatewayService) BindAgnesVideoRequestAccount(ctx context.Context, groupID *int64, requestID string, accountID int64) error {
	return s.BindStickySession(ctx, groupID, AgnesVideoRequestSessionHash(requestID), accountID)
}

func buildAgnesVideoURL(baseURL string, endpoint AgnesVideoEndpoint, requestID, model string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("invalid Agnes base URL")
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return "", fmt.Errorf("invalid Agnes base URL scheme")
	}
	if strings.EqualFold(parsed.Hostname(), "api.agnes-ai.com") {
		port := parsed.Port()
		parsed.Host = "apihub.agnes-ai.com"
		if port != "" {
			parsed.Host += ":" + port
		}
	}
	basePath := strings.TrimRight(parsed.Path, "/")
	rootPath := strings.TrimSuffix(basePath, "/v1")
	parsed.RawPath = ""
	parsed.RawQuery = ""
	parsed.Fragment = ""

	switch endpoint {
	case AgnesVideoEndpointGeneration:
		parsed.Path = strings.TrimRight(rootPath, "/") + "/v1/videos"
	case AgnesVideoEndpointStatus, AgnesVideoEndpointContent:
		requestID = strings.TrimSpace(requestID)
		if requestID == "" {
			return "", fmt.Errorf("request_id is required")
		}
		if isAgnesLegacyTaskID(requestID) {
			parsed.Path = strings.TrimRight(rootPath, "/") + "/v1/videos/" + url.PathEscape(requestID)
			break
		}
		parsed.Path = strings.TrimRight(rootPath, "/") + "/agnesapi"
		query := url.Values{}
		query.Set("video_id", requestID)
		if normalizedModel := NormalizeAgnesVideoModel(model); normalizedModel == AgnesVideoModel {
			query.Set("model_name", normalizedModel)
		}
		parsed.RawQuery = query.Encode()
	default:
		return "", fmt.Errorf("unsupported Agnes video endpoint: %s", endpoint)
	}
	return parsed.String(), nil
}

func isAgnesLegacyTaskID(requestID string) bool {
	lower := strings.ToLower(strings.TrimSpace(requestID))
	return strings.HasPrefix(lower, "task_") || strings.HasPrefix(lower, "task-")
}

func (s *OpenAIGatewayService) ForwardAgnesVideo(
	ctx context.Context,
	c *gin.Context,
	account *Account,
	endpoint AgnesVideoEndpoint,
	requestID string,
	body []byte,
) (*OpenAIForwardResult, error) {
	startTime := time.Now()
	if account == nil {
		return nil, fmt.Errorf("Agnes account is required")
	}
	if account.Platform != PlatformOpenAI || !account.IsOpenAIApiKey() {
		return nil, fmt.Errorf("Agnes video requires an OpenAI API-key account")
	}
	if strings.TrimSpace(account.GetCredential("base_url")) == "" {
		return nil, fmt.Errorf("Agnes account requires a custom base_url")
	}

	token, _, err := s.GetAccessToken(ctx, account)
	if err != nil {
		return nil, err
	}
	queryModel := ""
	if c != nil {
		queryModel = c.Query("model")
	}
	targetURL, err := buildAgnesVideoURL(account.GetOpenAIBaseURL(), endpoint, requestID, queryModel)
	if err != nil {
		return nil, err
	}

	requestInfo := AgnesVideoRequestInfo{}
	var requestBody io.Reader
	if endpoint == AgnesVideoEndpointGeneration {
		body, requestInfo, err = PrepareAgnesVideoGenerationBody(body)
		if err != nil {
			return nil, err
		}
		requestBody = bytes.NewReader(body)
	}

	method := http.MethodGet
	if endpoint == AgnesVideoEndpointGeneration {
		method = http.MethodPost
	}
	upstreamCtx, releaseUpstreamCtx := detachUpstreamContext(ctx)
	defer releaseUpstreamCtx()
	upstreamReq, err := http.NewRequestWithContext(upstreamCtx, method, targetURL, requestBody)
	if err != nil {
		return nil, err
	}
	upstreamReq.Header.Set("Authorization", "Bearer "+token)
	upstreamReq.Header.Set("Accept", "application/json")
	upstreamReq.Header.Set("User-Agent", "sub2api-agnes/1.0")
	if endpoint == AgnesVideoEndpointGeneration {
		upstreamReq.Header.Set("Content-Type", "application/json")
	}

	proxyURL := ""
	if account.ProxyID != nil && account.Proxy != nil {
		proxyURL = account.Proxy.URL()
	}
	upstreamStart := time.Now()
	resp, err := s.httpUpstream.Do(upstreamReq, proxyURL, account.ID, account.Concurrency)
	SetOpsLatencyMs(c, OpsUpstreamLatencyMsKey, time.Since(upstreamStart).Milliseconds())
	if err != nil {
		return nil, s.handleOpenAIUpstreamTransportError(ctx, c, account, err, false)
	}
	defer func() { _ = resp.Body.Close() }()

	requestIDHeader := firstNonEmpty(resp.Header.Get("x-request-id"), resp.Header.Get("request-id"))
	if resp.StatusCode >= 400 {
		return s.handleAgnesVideoErrorResponse(ctx, resp, c, account, requestIDHeader)
	}
	respBody, err := ReadUpstreamResponseBodyWithLimit(resp.Body, mediaUpstreamResponseReadMaxBytes, c, openAITooLargeError)
	if err != nil {
		return nil, err
	}
	providerEndpoint := VideoProviderEndpointStatus
	if endpoint == AgnesVideoEndpointGeneration {
		providerEndpoint = VideoProviderEndpointGeneration
	} else if endpoint == AgnesVideoEndpointContent {
		providerEndpoint = VideoProviderEndpointContent
	}
	normalizedBody, responseID, err := normalizeVideoProviderResponse(respBody, "agnes", requestID, providerEndpoint)
	if err != nil {
		return nil, err
	}

	if endpoint == AgnesVideoEndpointContent {
		videoURL := strings.TrimSpace(gjson.GetBytes(normalizedBody, "video.url").String())
		if err := validateAgnesContentURL(videoURL); err != nil {
			MarkResponseCommitted(c)
			writeGrokMediaErrorResponse(c, http.StatusConflict, "video_not_ready", "Agnes video content is not available until generation completes")
			return nil, fmt.Errorf("Agnes video content unavailable: %w", err)
		}
		c.Redirect(http.StatusFound, videoURL)
	} else {
		writeOpenAIPassthroughResponseHeaders(c.Writer.Header(), resp.Header, s.responseHeaderFilter)
		c.Data(resp.StatusCode, "application/json", normalizedBody)
	}

	resultModel := requestInfo.Model
	if resultModel == "" {
		resultModel = NormalizeAgnesVideoModel(queryModel)
	}
	result := &OpenAIForwardResult{
		RequestID:       requestIDHeader,
		ResponseID:      responseID,
		Model:           resultModel,
		BillingModel:    resultModel,
		UpstreamModel:   resultModel,
		ResponseHeaders: resp.Header.Clone(),
		Duration:        time.Since(startTime),
	}
	if endpoint == AgnesVideoEndpointGeneration {
		result.ImageCount = 1
		result.VideoCount = 1
		result.VideoResolution = agnesVideoBillingResolution(requestInfo.Width, requestInfo.Height)
		result.VideoDurationSeconds = int(math.Ceil(float64(requestInfo.NumFrames-1) / float64(requestInfo.FrameRate)))
	}
	return result, nil
}

func validateAgnesContentURL(raw string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return fmt.Errorf("missing or invalid video URL")
	}
	return nil
}

func agnesVideoBillingResolution(width, height int) string {
	shortEdge := width
	if height < shortEdge {
		shortEdge = height
	}
	switch {
	case shortEdge >= 1080:
		return VideoBillingResolution1080P
	case shortEdge >= 720:
		return VideoBillingResolution720P
	default:
		return VideoBillingResolution480P
	}
}

func (s *OpenAIGatewayService) handleAgnesVideoErrorResponse(
	ctx context.Context,
	resp *http.Response,
	c *gin.Context,
	account *Account,
	requestIDHeader string,
) (*OpenAIForwardResult, error) {
	body := s.readUpstreamErrorBody(resp)
	upstreamMsg := sanitizeUpstreamErrorMessage(strings.TrimSpace(extractUpstreamErrorMessage(body)))
	if upstreamMsg == "" {
		upstreamMsg = fmt.Sprintf("Agnes upstream returned status %d", resp.StatusCode)
	}
	setOpsUpstreamError(c, resp.StatusCode, upstreamMsg, "")
	s.handleOpenAIAccountUpstreamError(ctx, account, resp.StatusCode, resp.Header, body)

	if s.shouldFailoverUpstreamError(resp.StatusCode) {
		return nil, &UpstreamFailoverError{
			StatusCode:             resp.StatusCode,
			ResponseBody:           body,
			RetryableOnSameAccount: account.IsPoolMode() && account.IsPoolModeRetryableStatus(resp.StatusCode),
		}
	}
	appendOpsUpstreamError(c, OpsUpstreamErrorEvent{
		Platform:           account.Platform,
		AccountID:          account.ID,
		AccountName:        account.Name,
		UpstreamStatusCode: resp.StatusCode,
		UpstreamRequestID:  requestIDHeader,
		Kind:               "http_error",
		Message:            upstreamMsg,
	})
	MarkResponseCommitted(c)
	writeGrokMediaErrorResponse(c, resp.StatusCode, grokMediaErrorType(resp.StatusCode), upstreamMsg)
	return nil, fmt.Errorf("Agnes upstream error: %d %s", resp.StatusCode, upstreamMsg)
}
