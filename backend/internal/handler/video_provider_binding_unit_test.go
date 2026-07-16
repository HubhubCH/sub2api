//go:build unit

package handler

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

type failingVideoTaskRepository struct {
	createCalls int
}

func (r *failingVideoTaskRepository) Create(context.Context, service.CreateVideoTaskParams) (*service.VideoTask, error) {
	r.createCalls++
	return nil, errors.New("数据库写入失败")
}

func (r *failingVideoTaskRepository) GetForOwner(context.Context, int64, int64, string, string, time.Time) (*service.VideoTask, error) {
	return nil, service.ErrVideoTaskNotFound
}

func TestVideoProviderBindingFailureRecordsUsageExactlyOnce(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h, _, _, router, cleanup := newGrokCredentialFailoverHandler(t, "first_429")
	defer cleanup()
	repo := &failingVideoTaskRepository{}
	h.videoTaskService = service.NewVideoTaskService(repo, nil)
	pool := newUsageRecordTestPool(t)
	h.usageRecordWorkerPool = pool
	router.POST("/openai/v1/videos/generations", func(c *gin.Context) {
		h.VideoProviderGeneration(c, "grok")
	})

	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/openai/v1/videos/generations", strings.NewReader(`{"model":"grok-imagine-video","prompt":"waves"}`))
	req.Header.Set("Content-Type", "application/json")
	router.ServeHTTP(recorder, req)

	require.Equal(t, http.StatusBadGateway, recorder.Code, recorder.Body.String())
	require.Equal(t, "VIDEO_TASK_BINDING_FAILED", gjson.Get(recorder.Body.String(), "error.code").String())
	require.NotEmpty(t, gjson.Get(recorder.Body.String(), "error.upstream_task_id").String())
	require.Equal(t, 1, repo.createCalls)
	require.Eventually(t, func() bool {
		return pool.Stats().SubmittedTasks == 1
	}, time.Second, 10*time.Millisecond)
	require.Equal(t, uint64(1), pool.Stats().SubmittedTasks, "绑定失败只能记录一次用量")
}
