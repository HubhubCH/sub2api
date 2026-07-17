package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/tidwall/gjson"
	"go.uber.org/zap"
)

const mediaGenerationTimeout = 20 * time.Minute

func (h *OpenAIGatewayHandler) SetGenerationRecordService(recordService *service.GenerationRecordService) {
	if h != nil {
		h.generationRecordService = recordService
	}
}

func (h *OpenAIGatewayHandler) PersistImageGeneration(c *gin.Context, next gin.HandlerFunc) {
	h.persistMediaGeneration(c, "image", next)
}

func (h *OpenAIGatewayHandler) PersistVideoGeneration(c *gin.Context, next gin.HandlerFunc) {
	h.persistMediaGeneration(c, "video", next)
}

func (h *OpenAIGatewayHandler) PersistVideoStatus(c *gin.Context, next gin.HandlerFunc) {
	if h == nil || h.generationRecordService == nil {
		next(c)
		return
	}
	apiKey, keyOK := middleware2.GetAPIKeyFromContext(c)
	subject, subjectOK := middleware2.GetAuthSubjectFromContext(c)
	if !keyOK || apiKey == nil || !subjectOK {
		next(c)
		return
	}
	originalWriter := c.Writer
	buffer := newVideoResponseBuffer(originalWriter)
	c.Writer = buffer
	next(c)
	c.Writer = originalWriter
	requestID := strings.TrimSpace(c.Param("request_id"))
	if buffer.Status() >= 200 && buffer.Status() < 300 && requestID != "" {
		responseStatus := strings.ToLower(firstJSONText(buffer.Bytes(), "status"))
		status := service.GenerationStatusSubmitted
		if responseStatus == "completed" || responseStatus == "succeeded" || responseStatus == "success" {
			status = service.GenerationStatusCompleted
		}
		failure := ""
		if responseStatus == "failed" || responseStatus == "error" || responseStatus == "cancelled" {
			status = service.GenerationStatusFailed
			failure = responseErrorMessage(buffer.Bytes())
		}
		persistCtx, cancel := context.WithTimeout(context.WithoutCancel(c.Request.Context()), 5*time.Second)
		_ = h.generationRecordService.FinishVideoByUpstream(
			persistCtx, subject.UserID, apiKey.ID, videoTaskAccountID(c), videoTaskProvider(c), requestID, status, buffer.Bytes(), failure,
		)
		cancel()
	}
	if commitErr := buffer.Commit(); commitErr != nil {
		_ = c.Error(commitErr)
	}
}

func (h *OpenAIGatewayHandler) persistMediaGeneration(c *gin.Context, mediaType string, next gin.HandlerFunc) {
	if c.GetHeader("X-Save-Generation-Record") != "1" {
		next(c)
		return
	}
	if h == nil || h.generationRecordService == nil {
		h.errorResponse(c, http.StatusServiceUnavailable, "api_error", "生成记录服务暂不可用")
		return
	}
	apiKey, keyOK := middleware2.GetAPIKeyFromContext(c)
	subject, subjectOK := middleware2.GetAuthSubjectFromContext(c)
	if !keyOK || apiKey == nil || !subjectOK {
		h.errorResponse(c, http.StatusUnauthorized, "authentication_error", "Invalid API key")
		return
	}
	body, err := io.ReadAll(io.LimitReader(c.Request.Body, maxBufferedMediaResponseBytes+1))
	if err != nil {
		h.errorResponse(c, http.StatusBadRequest, "invalid_request_error", "Failed to read request body")
		return
	}
	if len(body) > maxBufferedMediaResponseBytes {
		h.errorResponse(c, http.StatusRequestEntityTooLarge, "invalid_request_error", "Generation request body is too large")
		return
	}
	c.Request.Body = io.NopCloser(bytes.NewReader(body))
	c.Request.ContentLength = int64(len(body))

	taskID := "gen_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	model := strings.TrimSpace(gjson.GetBytes(body, "model").String())
	provider := inferMediaGenerationProvider(mediaType, gjson.GetBytes(body, "provider").String(), model)
	prompt := strings.TrimSpace(gjson.GetBytes(body, "prompt").String())
	creatorTool := normalizeCreatorTool(c.GetHeader("X-Creator-Tool"), mediaType)
	persistCtx, cancelPersist := context.WithTimeout(context.WithoutCancel(c.Request.Context()), 5*time.Second)
	_, err = h.generationRecordService.Create(persistCtx, service.CreateGenerationRecordParams{
		TaskID: taskID, UserID: subject.UserID, APIKeyID: apiKey.ID, MediaType: mediaType, CreatorTool: creatorTool,
		Provider: provider, Model: model, PromptPreview: prompt,
	})
	cancelPersist()
	if err != nil {
		h.errorResponse(c, http.StatusServiceUnavailable, "api_error", "无法创建生成记录，请稍后重试")
		return
	}
	c.Header("X-Generation-Task-Id", taskID)

	originalRequest := c.Request
	runCtx, cancelRun := context.WithTimeout(context.WithoutCancel(originalRequest.Context()), mediaGenerationTimeout)
	c.Request = originalRequest.WithContext(runCtx)
	originalWriter := c.Writer
	buffer := newVideoResponseBuffer(originalWriter)
	c.Writer = buffer
	next(c)
	c.Writer = originalWriter
	c.Request = originalRequest
	cancelRun()

	status := service.GenerationStatusFailed
	upstreamTaskID := firstJSONText(buffer.Bytes(), "request_id", "id")
	failure := "生成请求失败"
	if buffer.Status() >= 200 && buffer.Status() < 300 {
		status = service.GenerationStatusCompleted
		failure = ""
		if mediaType == "video" {
			status = service.GenerationStatusSubmitted
			responseStatus := strings.ToLower(firstJSONText(buffer.Bytes(), "status"))
			if responseStatus == "completed" || responseStatus == "succeeded" || responseStatus == "success" {
				status = service.GenerationStatusCompleted
			}
		}
	} else {
		if message := responseErrorMessage(buffer.Bytes()); message != "" {
			failure = message
		}
		if mediaType == "video" {
			upstreamTaskID = firstJSONText(buffer.Bytes(), "error.upstream_task_id")
			if upstreamTaskID != "" && videoTaskAccountID(c) > 0 && videoTaskProvider(c) != "" {
				status = service.GenerationStatusSubmitted
			}
		}
	}
	finishCtx, cancelFinish := context.WithTimeout(context.WithoutCancel(originalRequest.Context()), 10*time.Second)
	if finishErr := h.generationRecordService.Finish(finishCtx, taskID, subject.UserID, videoTaskAccountID(c), status, upstreamTaskID, buffer.Bytes(), failure); finishErr != nil {
		requestLogger(c, "handler.media_generation_record").Error("generation_record_finish_failed", zap.String("task_id", taskID), zap.Error(finishErr))
	}
	cancelFinish()
	if commitErr := buffer.Commit(); commitErr != nil {
		_ = c.Error(commitErr)
	}
}

func normalizeCreatorTool(value, mediaType string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	allowed := map[string]string{
		"image": "image", "edit": "image", "outpaint": "image",
		"batch-main": "image", "batch-clone": "image", "watermark": "image", "video": "video",
	}
	if allowed[value] == mediaType {
		return value
	}
	return ""
}

func inferMediaGenerationProvider(mediaType, provider, model string) string {
	if provider = strings.ToLower(strings.TrimSpace(provider)); provider != "" {
		return provider
	}
	model = strings.ToLower(strings.TrimSpace(model))
	if mediaType != "video" {
		if strings.Contains(model, "grok") {
			return "grok"
		}
		return ""
	}
	switch model {
	case service.AgnesVideoModel, service.AgnesVideoModelAlias:
		return "agnes"
	case "grok-imagine-video", "grok-imagine-video-1.5", "sora-2", "sora-2-pro":
		return "grok"
	}
	if strings.Contains(model, "video") || strings.Contains(model, "sora") {
		return "grok"
	}
	return ""
}

func videoTaskAccountID(c *gin.Context) int64 {
	if c == nil {
		return 0
	}
	value, ok := c.Get(videoTaskAccountIDContextKey)
	if !ok {
		return 0
	}
	accountID, _ := value.(int64)
	return accountID
}

func videoTaskProvider(c *gin.Context) string {
	if c == nil {
		return ""
	}
	value, ok := c.Get(videoTaskProviderContextKey)
	if !ok {
		return ""
	}
	provider, _ := value.(string)
	return strings.ToLower(strings.TrimSpace(provider))
}

func firstJSONText(body []byte, paths ...string) string {
	for _, path := range paths {
		if value := strings.TrimSpace(gjson.GetBytes(body, path).String()); value != "" {
			return value
		}
	}
	return ""
}

func responseErrorMessage(body []byte) string {
	return firstJSONText(body, "error.message", "message", "detail")
}

func (h *OpenAIGatewayHandler) ListGenerationRecords(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "未登录"})
		return
	}
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "10"))
	records, err := h.generationRecordService.List(c.Request.Context(), subject.UserID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "加载生成记录失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": records})
}

func (h *OpenAIGatewayHandler) GenerationRecordContent(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		c.Status(http.StatusUnauthorized)
		return
	}
	index, err := strconv.Atoi(c.Param("index"))
	if err != nil || index < 0 {
		c.Status(http.StatusBadRequest)
		return
	}
	path, err := h.generationRecordService.ContentPath(c.Request.Context(), subject.UserID, c.Param("task_id"), index)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}
	c.File(path)
}

func generationRecordResultURLs(raw json.RawMessage) []string {
	var value struct {
		URLs []string `json:"urls"`
	}
	_ = json.Unmarshal(raw, &value)
	return value.URLs
}
