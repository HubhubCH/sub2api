package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
	pkghttputil "github.com/Wei-Shaw/sub2api/internal/pkg/httputil"
	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

const videoTaskPersistenceTimeout = 5 * time.Second
const maxBufferedMediaResponseBytes = 64 << 20

const (
	videoTaskAccountIDContextKey = "video_task_account_id"
	videoTaskProviderContextKey  = "video_task_provider"
)

func (h *OpenAIGatewayHandler) VideoProviderGeneration(c *gin.Context, provider string) {
	h.handleVideoProvider(c, provider, service.VideoProviderEndpointGeneration, "")
}

func (h *OpenAIGatewayHandler) VideoProviderEdit(c *gin.Context, provider string) {
	h.handleVideoProvider(c, provider, service.VideoProviderEndpointEdit, "")
}

func (h *OpenAIGatewayHandler) VideoProviderExtension(c *gin.Context, provider string) {
	h.handleVideoProvider(c, provider, service.VideoProviderEndpointExtension, "")
}

func (h *OpenAIGatewayHandler) VideoProviderStatus(c *gin.Context, provider string) {
	h.handleVideoProvider(c, provider, service.VideoProviderEndpointStatus, c.Param("request_id"))
}

func (h *OpenAIGatewayHandler) VideoProviderContent(c *gin.Context, provider string) {
	h.handleVideoProvider(c, provider, service.VideoProviderEndpointContent, c.Param("request_id"))
}

func (h *OpenAIGatewayHandler) handleVideoProvider(
	c *gin.Context,
	provider string,
	endpoint service.VideoProviderEndpoint,
	requestID string,
) {
	streamStarted := false
	defer h.recoverResponsesPanic(c, &streamStarted)

	requestStart := time.Now()
	apiKey, ok := middleware2.GetAPIKeyFromContext(c)
	if !ok || apiKey == nil {
		h.errorResponse(c, http.StatusUnauthorized, "authentication_error", "Invalid API key")
		return
	}
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		h.errorResponse(c, http.StatusInternalServerError, "api_error", "User context not found")
		return
	}

	provider = strings.ToLower(strings.TrimSpace(provider))
	reqLog := requestLogger(
		c,
		"handler.openai_gateway.video_provider",
		zap.Int64("user_id", subject.UserID),
		zap.Int64("api_key_id", apiKey.ID),
		zap.Any("group_id", apiKey.GroupID),
		zap.String("provider", provider),
		zap.String("endpoint", string(endpoint)),
	)
	if !h.ensureResponsesDependencies(c, reqLog) {
		return
	}
	if h.videoTaskService == nil {
		videoTaskErrorResponse(c, service.ErrVideoTaskLookupFailed, "")
		return
	}

	if apiKey.GroupID == nil || *apiKey.GroupID <= 0 || apiKey.Group == nil {
		h.errorResponse(c, http.StatusForbidden, "permission_error", "The selected API key group does not support this video provider")
		return
	}

	if endpoint.IsSubmission() {
		adapter, supported := h.gatewayService.GetVideoProviderAdapterForPlatform(provider, apiKey.Group.Platform)
		if !supported {
			h.errorResponse(c, http.StatusBadRequest, "invalid_request_error", "Unsupported video provider: "+provider)
			return
		}
		if apiKey.Group.Platform != adapter.AccountPlatform() {
			h.errorResponse(c, http.StatusForbidden, "permission_error", "The selected API key group does not support this video provider")
			return
		}
		h.handleVideoProviderSubmissionRequest(c, adapter, endpoint, apiKey, subject, reqLog, requestStart, &streamStarted)
		return
	}
	h.handleBoundVideoProviderRequest(c, provider, endpoint, strings.TrimSpace(requestID), apiKey, subject, reqLog, requestStart, &streamStarted)
}

func (h *OpenAIGatewayHandler) handleVideoProviderSubmissionRequest(
	c *gin.Context,
	adapter service.VideoProviderAdapter,
	endpoint service.VideoProviderEndpoint,
	apiKey *service.APIKey,
	subject middleware2.AuthSubject,
	reqLog *zap.Logger,
	requestStart time.Time,
	streamStarted *bool,
) {
	body, err := pkghttputil.ReadRequestBodyWithPrealloc(c.Request)
	if err != nil {
		if maxErr, ok := extractMaxBytesError(err); ok {
			h.errorResponse(c, http.StatusRequestEntityTooLarge, "invalid_request_error", buildBodyTooLargeMessage(maxErr.Limit))
			return
		}
		h.errorResponse(c, http.StatusBadRequest, "invalid_request_error", "Failed to read request body")
		return
	}
	if len(body) == 0 {
		h.errorResponse(c, http.StatusBadRequest, "invalid_request_error", "Request body is empty")
		return
	}

	// provider 仅用于本地路由，不能转发到第三方 OpenAI 兼容端点。
	body = stripLocalVideoProviderField(body)
	requestInfo, err := adapter.ParseGenerationRequest(body)
	if err != nil {
		h.errorResponse(c, http.StatusBadRequest, "invalid_request_error", err.Error())
		return
	}
	requestModel := strings.TrimSpace(requestInfo.Model)
	if requestModel == "" {
		h.errorResponse(c, http.StatusBadRequest, "invalid_request_error", "model is required")
		return
	}
	reqLog = reqLog.With(zap.String("model", requestModel))
	setOpsRequestContext(c, requestModel, false)
	setOpsEndpointContext(c, "", int16(service.RequestTypeSync))

	if len(requestInfo.ModerationBody) > 0 {
		decision := h.checkContentModeration(c, reqLog, apiKey, subject, service.ContentModerationProtocolOpenAIImages, requestModel, requestInfo.ModerationBody)
		if decision != nil && decision.Blocked {
			h.errorResponse(c, contentModerationStatus(decision), contentModerationErrorCode(decision), decision.Message)
			return
		}
	}
	imageReleaseFunc, acquired := h.acquireImageGenerationSlot(c, *streamStarted)
	if !acquired {
		return
	}
	if imageReleaseFunc != nil {
		defer imageReleaseFunc()
	}

	if h.errorPassthroughService != nil {
		service.BindErrorPassthroughService(c, h.errorPassthroughService)
	}
	subscription, _ := middleware2.GetSubscriptionFromContext(c)
	service.SetOpsLatencyMs(c, service.OpsAuthLatencyMsKey, time.Since(requestStart).Milliseconds())

	userReleaseFunc, acquired := h.acquireResponsesUserSlot(c, subject.UserID, subject.Concurrency, false, streamStarted, reqLog)
	if !acquired {
		return
	}
	if userReleaseFunc != nil {
		defer userReleaseFunc()
	}

	if err := h.billingCacheService.CheckBillingEligibility(c.Request.Context(), apiKey.User, apiKey, apiKey.Group, subscription, service.QuotaPlatform(c.Request.Context(), apiKey)); err != nil {
		reqLog.Info("video_provider.billing_eligibility_check_failed", zap.Error(err))
		status, code, message, retryAfter := billingErrorDetails(err)
		if retryAfter > 0 {
			c.Header("Retry-After", strconv.Itoa(retryAfter))
		}
		h.errorResponse(c, status, code, message)
		return
	}

	requestCtx := c.Request.Context()
	sessionHash := h.gatewayService.GenerateExplicitSessionHash(c, body)
	failedAccountIDs := make(map[int64]struct{})
	sameAccountRetryCount := make(map[int64]int)
	var lastFailoverErr *service.UpstreamFailoverError
	switchCount := 0
	maxAccountSwitches := h.maxAccountSwitches
	if maxAccountSwitches <= 0 {
		maxAccountSwitches = 3
	}
	routingStart := time.Now()

	for {
		selection, scheduleDecision, selectErr := h.gatewayService.SelectAccountWithSchedulerForCapability(
			requestCtx,
			apiKey.GroupID,
			"",
			sessionHash,
			requestModel,
			failedAccountIDs,
			service.OpenAIUpstreamTransportHTTPSSE,
			"",
			false,
			false,
			false,
			adapter.AccountPlatform(),
		)
		if selectErr != nil {
			reqLog.Warn("video_provider.account_select_failed", zap.Error(selectErr), zap.Int("excluded_account_count", len(failedAccountIDs)))
			if len(failedAccountIDs) == 0 {
				cls := classifyNoAccountErrorFromGin(c, h.gatewayService, apiKey, requestModel, requestModel, adapter.AccountPlatform())
				if !cls.ModelNotFound {
					markOpsRoutingCapacityLimitedIfNoAvailable(c, selectErr)
				}
				h.errorResponse(c, cls.Status, cls.ErrType, cls.Message)
				return
			}
			if lastFailoverErr != nil {
				h.handleFailoverExhausted(c, lastFailoverErr, false)
			} else {
				h.errorResponse(c, http.StatusBadGateway, "api_error", "Upstream request failed")
			}
			return
		}
		if selection == nil || selection.Account == nil {
			cls := classifyNoAccountErrorFromGin(c, h.gatewayService, apiKey, requestModel, requestModel, adapter.AccountPlatform())
			if !cls.ModelNotFound {
				markOpsRoutingCapacityLimited(c)
			}
			h.errorResponse(c, cls.Status, cls.ErrType, cls.Message)
			return
		}

		reqLog.Debug("video_provider.account_schedule_decision",
			zap.String("layer", scheduleDecision.Layer),
			zap.Bool("sticky_session_hit", scheduleDecision.StickySessionHit),
			zap.Int("candidate_count", scheduleDecision.CandidateCount),
			zap.Int("top_k", scheduleDecision.TopK),
			zap.Int64("latency_ms", scheduleDecision.LatencyMs),
			zap.Float64("load_skew", scheduleDecision.LoadSkew),
		)

		account := selection.Account
		sessionHash = ensureOpenAIPoolModeSessionHash(sessionHash, account)
		setOpsSelectedAccount(c, account.ID, account.Platform)
		accountReleaseFunc, accountAcquired := h.acquireResponsesAccountSlot(c, apiKey.GroupID, sessionHash, selection, false, streamStarted, reqLog)
		if !accountAcquired {
			return
		}

		service.SetOpsLatencyMs(c, service.OpsRoutingLatencyMsKey, time.Since(routingStart).Milliseconds())
		forwardStart := time.Now()
		writerSizeBeforeForward := c.Writer.Size()
		result, responseBuffer, forwardErr := func() (*service.OpenAIForwardResult, *videoResponseBuffer, error) {
			defer func() {
				if accountReleaseFunc != nil {
					accountReleaseFunc()
				}
			}()
			return captureVideoGenerationResponse(c, func() (*service.OpenAIForwardResult, error) {
				return adapter.Forward(requestCtx, c, account, endpoint, "", body)
			})
		}()

		forwardDurationMs := time.Since(forwardStart).Milliseconds()
		upstreamLatencyMs, _ := getContextInt64(c, service.OpsUpstreamLatencyMsKey)
		responseLatencyMs := forwardDurationMs
		if upstreamLatencyMs > 0 && forwardDurationMs > upstreamLatencyMs {
			responseLatencyMs = forwardDurationMs - upstreamLatencyMs
		}
		service.SetOpsLatencyMs(c, service.OpsResponseLatencyMsKey, responseLatencyMs)

		if forwardErr != nil {
			if responseBuffer != nil && responseBuffer.Written() {
				if commitErr := responseBuffer.Commit(); commitErr != nil {
					reqLog.Warn("video_provider.error_response_commit_failed", zap.Error(commitErr))
				}
			}
			var failoverErr *service.UpstreamFailoverError
			if errors.As(forwardErr, &failoverErr) {
				h.gatewayService.ReportOpenAIAccountScheduleResult(account.ID, account.GetMappedModel(requestModel), false, nil)
				if c.Writer.Size() != writerSizeBeforeForward {
					h.handleFailoverExhausted(c, failoverErr, true)
					return
				}
				if failoverErr.RetryableOnSameAccount {
					retryLimit := account.GetPoolModeRetryCount()
					if sameAccountRetryCount[account.ID] < retryLimit {
						sameAccountRetryCount[account.ID]++
						select {
						case <-requestCtx.Done():
							return
						case <-time.After(sameAccountRetryDelay):
						}
						continue
					}
				}
				h.gatewayService.RecordOpenAIAccountSwitch()
				failedAccountIDs[account.ID] = struct{}{}
				lastFailoverErr = failoverErr
				if switchCount >= maxAccountSwitches {
					h.handleFailoverExhausted(c, failoverErr, false)
					return
				}
				switchCount++
				continue
			}
			h.gatewayService.ReportOpenAIAccountScheduleResult(account.ID, account.GetMappedModel(requestModel), false, nil)
			if c.Writer.Size() == writerSizeBeforeForward {
				h.errorResponse(c, http.StatusBadGateway, "upstream_error", "Upstream request failed")
			}
			reqLog.Warn("video_provider.forward_failed", zap.Int64("account_id", account.ID), zap.Error(forwardErr))
			return
		}

		h.gatewayService.ReportOpenAIAccountScheduleResult(account.ID, account.GetMappedModel(requestModel), true, nil)
		upstreamTaskID := ""
		if result != nil {
			upstreamTaskID = strings.TrimSpace(result.ResponseID)
		}
		if upstreamTaskID == "" {
			reqLog.Error("video_provider.binding_failed_missing_upstream_task_id",
				zap.Int64("account_id", account.ID),
				zap.Int64("group_id", *apiKey.GroupID),
			)
			videoTaskErrorResponse(c, service.ErrVideoTaskBindingFailed, "")
			return
		}

		persistCtx, cancelPersist := videoTaskPersistenceContext(requestCtx)
		_, persistErr := h.videoTaskService.Create(persistCtx, service.CreateVideoTaskParams{
			Provider:       adapter.Provider(),
			UpstreamTaskID: upstreamTaskID,
			AccountID:      account.ID,
			GroupID:        *apiKey.GroupID,
			UserID:         subject.UserID,
			APIKeyID:       apiKey.ID,
			Model:          requestModel,
			Status:         service.VideoTaskStatusSubmitted,
		})
		cancelPersist()
		if persistErr != nil {
			reqLog.Error("video_provider.durable_binding_failed",
				zap.String("provider", adapter.Provider()),
				zap.String("upstream_task_id", upstreamTaskID),
				zap.Int64("account_id", account.ID),
				zap.Int64("group_id", *apiKey.GroupID),
				zap.Int64("user_id", subject.UserID),
				zap.Int64("api_key_id", apiKey.ID),
				zap.Error(persistErr),
			)
			videoTaskErrorResponse(c, persistErr, upstreamTaskID)
			return
		}
		c.Set(videoTaskAccountIDContextKey, account.ID)
		c.Set(videoTaskProviderContextKey, adapter.Provider())

		// Redis 只作为尽力而为的加速层；数据库绑定才是所有权和原账号固定路由的权威来源。
		if bindErr := adapter.BindRequestAccount(requestCtx, apiKey.GroupID, upstreamTaskID, account.ID); bindErr != nil {
			reqLog.Warn("video_provider.bind_request_account_cache_failed", zap.Int64("account_id", account.ID), zap.String("request_id", upstreamTaskID), zap.Error(bindErr))
		}
		if result != nil {
			recordOpenAIMediaUsage(c, h, reqLog, apiKey, subject, subscription, account, result, requestModel, body, "")
		}
		if responseBuffer == nil || !responseBuffer.Written() {
			reqLog.Error("video_provider.success_response_missing", zap.String("upstream_task_id", upstreamTaskID))
			h.errorResponse(c, http.StatusBadGateway, "api_error", "Upstream response was empty")
			return
		}
		if commitErr := responseBuffer.Commit(); commitErr != nil {
			reqLog.Error("video_provider.success_response_commit_failed", zap.String("upstream_task_id", upstreamTaskID), zap.Error(commitErr))
			_ = c.Error(commitErr)
			return
		}
		reqLog.Debug("video_provider.request_completed", zap.Int64("account_id", account.ID), zap.Int("switch_count", switchCount))
		return
	}
}

func (h *OpenAIGatewayHandler) handleBoundVideoProviderRequest(
	c *gin.Context,
	provider string,
	endpoint service.VideoProviderEndpoint,
	requestID string,
	apiKey *service.APIKey,
	subject middleware2.AuthSubject,
	reqLog *zap.Logger,
	requestStart time.Time,
	streamStarted *bool,
) {
	if requestID == "" {
		h.errorResponse(c, http.StatusBadRequest, "invalid_request_error", "request_id is required")
		return
	}
	if provider != "" {
		if _, supported := h.gatewayService.GetVideoProviderAdapterForPlatform(provider, apiKey.Group.Platform); !supported {
			h.errorResponse(c, http.StatusBadRequest, "invalid_request_error", "Unsupported video provider: "+provider)
			return
		}
	}
	routingStart := time.Now()
	task, account, err := h.videoTaskService.ResolveBoundAccount(
		c.Request.Context(),
		service.VideoTaskOwner{UserID: subject.UserID, APIKeyID: apiKey.ID, GroupID: *apiKey.GroupID},
		provider,
		requestID,
		apiKey.Group.Platform,
	)
	if err != nil {
		reqLog.Warn("video_provider.task_resolve_failed", zap.String("request_id", requestID), zap.Error(err))
		videoTaskErrorResponse(c, err, "")
		return
	}
	provider = strings.ToLower(strings.TrimSpace(task.Provider))
	c.Set(videoTaskAccountIDContextKey, task.AccountID)
	c.Set(videoTaskProviderContextKey, provider)
	adapter, supported := h.gatewayService.GetVideoProviderAdapterForPlatform(provider, apiKey.Group.Platform)
	if !supported || apiKey.Group.Platform != adapter.AccountPlatform() || account.Platform != adapter.AccountPlatform() {
		reqLog.Warn("video_provider.bound_account_contract_mismatch",
			zap.String("stored_provider", provider),
			zap.String("account_platform", account.Platform),
		)
		videoTaskErrorResponse(c, service.ErrVideoTaskBoundAccountUnavailable, "")
		return
	}

	requestModel := strings.TrimSpace(task.Model)
	setVideoTaskModelQuery(c, requestModel)
	reqLog = reqLog.With(zap.String("provider", provider), zap.String("model", requestModel), zap.Int64("bound_account_id", account.ID))
	setOpsRequestContext(c, requestModel, false)
	setOpsEndpointContext(c, "", int16(service.RequestTypeSync))
	setOpsSelectedAccount(c, account.ID, account.Platform)
	service.SetOpsLatencyMs(c, service.OpsAuthLatencyMsKey, time.Since(requestStart).Milliseconds())
	service.SetOpsLatencyMs(c, service.OpsRoutingLatencyMsKey, time.Since(routingStart).Milliseconds())
	if h.errorPassthroughService != nil {
		service.BindErrorPassthroughService(c, h.errorPassthroughService)
	}

	userReleaseFunc, acquired := h.acquireResponsesUserSlot(c, subject.UserID, subject.Concurrency, false, streamStarted, reqLog)
	if !acquired {
		return
	}
	if userReleaseFunc != nil {
		defer userReleaseFunc()
	}

	accountWaitTimeout := 30 * time.Second
	if h.cfg != nil && h.cfg.Gateway.Scheduling.FallbackWaitTimeout > 0 {
		accountWaitTimeout = h.cfg.Gateway.Scheduling.FallbackWaitTimeout
	}
	accountReleaseFunc, acquireErr := h.concurrencyHelper.AcquireAccountSlotWithWaitTimeout(
		c,
		account.ID,
		account.Concurrency,
		accountWaitTimeout,
		false,
		streamStarted,
	)
	if acquireErr != nil {
		reqLog.Warn("video_provider.bound_account_slot_failed", zap.Error(acquireErr))
		videoTaskErrorResponse(c, service.ErrVideoTaskBoundAccountUnavailable.WithCause(acquireErr), "")
		return
	}
	if accountReleaseFunc != nil {
		defer accountReleaseFunc()
	}

	forwardStart := time.Now()
	writerSizeBeforeForward := c.Writer.Size()
	result, forwardErr := adapter.Forward(c.Request.Context(), c, account, endpoint, task.UpstreamTaskID, nil)
	forwardDurationMs := time.Since(forwardStart).Milliseconds()
	upstreamLatencyMs, _ := getContextInt64(c, service.OpsUpstreamLatencyMsKey)
	responseLatencyMs := forwardDurationMs
	if upstreamLatencyMs > 0 && forwardDurationMs > upstreamLatencyMs {
		responseLatencyMs = forwardDurationMs - upstreamLatencyMs
	}
	service.SetOpsLatencyMs(c, service.OpsResponseLatencyMsKey, responseLatencyMs)

	if forwardErr != nil {
		h.gatewayService.ReportOpenAIAccountScheduleResult(account.ID, account.GetMappedModel(requestModel), false, nil)
		reqLog.Warn("video_provider.bound_account_forward_failed", zap.Error(forwardErr))
		if c.Writer.Size() == writerSizeBeforeForward {
			videoTaskErrorResponse(c, service.ErrVideoTaskBoundAccountUnavailable.WithCause(forwardErr), "")
		}
		return
	}
	h.gatewayService.ReportOpenAIAccountScheduleResult(account.ID, account.GetMappedModel(requestModel), true, nil)
	reqLog.Debug("video_provider.bound_request_completed",
		zap.String("request_id", requestID),
		zap.Bool("has_result", result != nil),
	)
}

func videoTaskPersistenceContext(parent context.Context) (context.Context, context.CancelFunc) {
	base := context.Background()
	if parent != nil {
		base = context.WithoutCancel(parent)
	}
	return context.WithTimeout(base, videoTaskPersistenceTimeout)
}

func stripLocalVideoProviderField(body []byte) []byte {
	if len(body) == 0 || !json.Valid(body) {
		return body
	}
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(body, &payload); err != nil {
		return body
	}
	removed := false
	for key := range payload {
		if strings.EqualFold(strings.TrimSpace(key), "provider") {
			delete(payload, key)
			removed = true
		}
	}
	if !removed {
		return body
	}
	cleaned, err := json.Marshal(payload)
	if err != nil {
		return body
	}
	return cleaned
}

func setVideoTaskModelQuery(c *gin.Context, model string) {
	if c == nil || c.Request == nil || c.Request.URL == nil || strings.TrimSpace(model) == "" {
		return
	}
	query := c.Request.URL.Query()
	query.Set("model", strings.TrimSpace(model))
	c.Request.URL.RawQuery = query.Encode()
}

func videoTaskErrorResponse(c *gin.Context, err error, upstreamTaskID string) {
	status := infraerrors.Code(err)
	code := infraerrors.Reason(err)
	message := infraerrors.Message(err)
	if status <= 0 {
		status = http.StatusInternalServerError
	}
	if strings.TrimSpace(code) == "" {
		code = "VIDEO_TASK_INTERNAL_ERROR"
	}
	if strings.TrimSpace(message) == "" {
		message = "video task request failed"
	}
	payload := gin.H{
		"type":    "api_error",
		"code":    code,
		"message": message,
	}
	if upstreamTaskID = strings.TrimSpace(upstreamTaskID); upstreamTaskID != "" {
		payload["upstream_task_id"] = upstreamTaskID
	}
	c.JSON(status, gin.H{"error": payload})
}

type videoResponseBuffer struct {
	gin.ResponseWriter
	header    http.Header
	body      bytes.Buffer
	status    int
	written   bool
	committed bool
	overflow  bool
	limit     int
}

func newVideoResponseBuffer(writer gin.ResponseWriter) *videoResponseBuffer {
	header := make(http.Header)
	if writer != nil {
		header = writer.Header().Clone()
	}
	return &videoResponseBuffer{
		ResponseWriter: writer,
		header:         header,
		status:         http.StatusOK,
		limit:          maxBufferedMediaResponseBytes,
	}
}

func (w *videoResponseBuffer) Header() http.Header {
	return w.header
}

func (w *videoResponseBuffer) WriteHeader(code int) {
	if w.written {
		return
	}
	w.status = code
	w.written = true
}

func (w *videoResponseBuffer) WriteHeaderNow() {
	if !w.written {
		w.WriteHeader(w.status)
	}
}

func (w *videoResponseBuffer) Write(data []byte) (int, error) {
	if w.overflow {
		return len(data), nil
	}
	if w.limit > 0 && w.body.Len()+len(data) > w.limit {
		w.body.Reset()
		w.status = http.StatusBadGateway
		w.written = true
		w.overflow = true
		_, _ = w.body.WriteString(`{"error":{"type":"upstream_error","message":"Upstream media response is too large"}}`)
		w.header.Set("Content-Type", "application/json; charset=utf-8")
		return len(data), nil
	}
	w.WriteHeaderNow()
	return w.body.Write(data)
}

func (w *videoResponseBuffer) WriteString(data string) (int, error) {
	return w.Write([]byte(data))
}

func (w *videoResponseBuffer) Status() int {
	return w.status
}

func (w *videoResponseBuffer) Size() int {
	if !w.written {
		return -1
	}
	return w.body.Len()
}

func (w *videoResponseBuffer) Written() bool {
	return w.written
}

func (w *videoResponseBuffer) Bytes() []byte {
	if w == nil {
		return nil
	}
	return w.body.Bytes()
}

func (w *videoResponseBuffer) Flush() {
	w.WriteHeaderNow()
}

func (w *videoResponseBuffer) Commit() error {
	if w == nil || w.ResponseWriter == nil || !w.written || w.committed {
		return nil
	}
	w.committed = true
	destinationHeader := w.ResponseWriter.Header()
	for key, values := range w.header {
		destinationHeader[key] = append([]string(nil), values...)
	}
	w.ResponseWriter.WriteHeader(w.status)
	if w.body.Len() == 0 {
		w.ResponseWriter.WriteHeaderNow()
		return nil
	}
	_, err := w.ResponseWriter.Write(w.body.Bytes())
	return err
}

func captureVideoGenerationResponse(
	c *gin.Context,
	forward func() (*service.OpenAIForwardResult, error),
) (result *service.OpenAIForwardResult, buffer *videoResponseBuffer, err error) {
	originalWriter := c.Writer
	buffer = newVideoResponseBuffer(originalWriter)
	c.Writer = buffer
	defer func() {
		c.Writer = originalWriter
	}()
	result, err = forward()
	return result, buffer, err
}
