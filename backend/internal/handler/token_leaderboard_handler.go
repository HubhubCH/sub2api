package handler

import (
	"context"
	"strings"

	"github.com/Wei-Shaw/sub2api/internal/pkg/response"
	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
)

type TokenLeaderboardHandler struct {
	service *service.TokenLeaderboardService
}

func NewTokenLeaderboardHandler(service *service.TokenLeaderboardService) *TokenLeaderboardHandler {
	return &TokenLeaderboardHandler{service: service}
}

func (h *TokenLeaderboardHandler) Get(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "用户未登录")
		return
	}
	data, err := h.service.Get(c.Request.Context(), subject.UserID, strings.TrimSpace(c.Query("date")))
	if err != nil {
		response.ErrorFrom(c, err)
		return
	}
	response.Success(c, data)
}

type tokenPointExchangeRequest struct {
	Points int64 `json:"points" binding:"required"`
}

func (h *TokenLeaderboardHandler) Exchange(c *gin.Context) {
	subject, ok := middleware2.GetAuthSubjectFromContext(c)
	if !ok {
		response.Unauthorized(c, "用户未登录")
		return
	}
	var req tokenPointExchangeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.BadRequest(c, "请输入要兑换的积分")
		return
	}
	executeUserIdempotentJSON(c, "user.token_leaderboard.exchange", req, service.DefaultWriteIdempotencyTTL(), func(ctx context.Context) (any, error) {
		return h.service.Exchange(ctx, subject.UserID, req.Points)
	})
}
