//go:build unit

package handler

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	middleware2 "github.com/Wei-Shaw/sub2api/internal/server/middleware"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func TestGrokImagesStoresSuccessfulAccountForGenerationRecordDownload(t *testing.T) {
	h, _, _, router, cleanup := newGrokCredentialFailoverHandler(t, "first_429")
	defer cleanup()
	var selectedAccountID int64
	var selectedProvider string
	router.POST("/openai/v1/images/generations", func(c *gin.Context) {
		apiKey, ok := middleware2.GetAPIKeyFromContext(c)
		require.True(t, ok)
		apiKey.Group.AllowImageGeneration = true
		h.GrokImages(c)
		selectedAccountID = videoTaskAccountID(c)
		selectedProvider = videoTaskProvider(c)
	})
	request := httptest.NewRequest(http.MethodPost, "/openai/v1/images/generations", bytes.NewBufferString(`{"model":"grok-4.5","prompt":"test"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	require.Equal(t, int64(802), selectedAccountID)
	require.Equal(t, "grok", selectedProvider)
}
