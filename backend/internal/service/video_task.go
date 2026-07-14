package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
)

const (
	VideoTaskStatusSubmitted = "submitted"
	DefaultVideoTaskTTL      = 7 * 24 * time.Hour
)

var (
	ErrVideoTaskNotFound = infraerrors.New(
		http.StatusNotFound,
		"VIDEO_TASK_NOT_FOUND",
		"视频任务不存在或无权访问",
	)
	ErrVideoTaskConflict = infraerrors.New(
		http.StatusConflict,
		"VIDEO_TASK_CONFLICT",
		"视频任务绑定与现有记录冲突",
	)
	ErrVideoTaskBindingFailed = infraerrors.New(
		http.StatusBadGateway,
		"VIDEO_TASK_BINDING_FAILED",
		"上游已接受视频任务，但本地跟踪记录创建失败",
	)
	ErrVideoTaskLookupFailed = infraerrors.New(
		http.StatusServiceUnavailable,
		"VIDEO_TASK_LOOKUP_FAILED",
		"视频任务跟踪服务暂不可用",
	)
	ErrVideoTaskBoundAccountUnavailable = infraerrors.New(
		http.StatusServiceUnavailable,
		"VIDEO_TASK_BOUND_ACCOUNT_UNAVAILABLE",
		"原视频任务绑定的上游账号不可用",
	)
)

type VideoTask struct {
	ID             int64
	Provider       string
	UpstreamTaskID string
	AccountID      int64
	GroupID        int64
	UserID         int64
	APIKeyID       int64
	Model          string
	Status         string
	ExpiresAt      time.Time
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type CreateVideoTaskParams struct {
	Provider       string
	UpstreamTaskID string
	AccountID      int64
	GroupID        int64
	UserID         int64
	APIKeyID       int64
	Model          string
	Status         string
	ExpiresAt      time.Time
}

type VideoTaskOwner struct {
	UserID   int64
	APIKeyID int64
	GroupID  int64
}

type VideoTaskRepository interface {
	Create(ctx context.Context, params CreateVideoTaskParams) (*VideoTask, error)
	GetForOwner(ctx context.Context, userID, apiKeyID int64, provider, upstreamTaskID string, now time.Time) (*VideoTask, error)
}

type VideoTaskService struct {
	repo        VideoTaskRepository
	accountRepo AccountRepository
	now         func() time.Time
}

func NewVideoTaskService(repo VideoTaskRepository, accountRepo AccountRepository) *VideoTaskService {
	return &VideoTaskService{
		repo:        repo,
		accountRepo: accountRepo,
		now:         time.Now,
	}
}

func (s *VideoTaskService) Create(ctx context.Context, params CreateVideoTaskParams) (*VideoTask, error) {
	params.Provider = strings.ToLower(strings.TrimSpace(params.Provider))
	params.UpstreamTaskID = strings.TrimSpace(params.UpstreamTaskID)
	params.Model = strings.TrimSpace(params.Model)
	params.Status = strings.ToLower(strings.TrimSpace(params.Status))
	if params.Status == "" {
		params.Status = VideoTaskStatusSubmitted
	}

	now := time.Now()
	if s != nil && s.now != nil {
		now = s.now()
	}
	if params.ExpiresAt.IsZero() {
		params.ExpiresAt = now.Add(DefaultVideoTaskTTL)
	}
	if s == nil || s.repo == nil || !validCreateVideoTaskParams(params, now) {
		return nil, ErrVideoTaskBindingFailed
	}

	task, err := s.repo.Create(ctx, params)
	if err != nil {
		if errors.Is(err, ErrVideoTaskConflict) {
			return nil, err
		}
		return nil, ErrVideoTaskBindingFailed.WithCause(err)
	}
	if task == nil {
		return nil, ErrVideoTaskBindingFailed
	}
	return task, nil
}

func validCreateVideoTaskParams(params CreateVideoTaskParams, now time.Time) bool {
	return params.Provider != "" &&
		params.UpstreamTaskID != "" &&
		params.AccountID > 0 &&
		params.GroupID > 0 &&
		params.UserID > 0 &&
		params.APIKeyID > 0 &&
		params.Model != "" &&
		params.Status != "" &&
		params.ExpiresAt.After(now)
}

func (s *VideoTaskService) ResolveBoundAccount(
	ctx context.Context,
	owner VideoTaskOwner,
	provider, upstreamTaskID, accountPlatform string,
) (*VideoTask, *Account, error) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	upstreamTaskID = strings.TrimSpace(upstreamTaskID)
	accountPlatform = strings.TrimSpace(accountPlatform)
	if s == nil || s.repo == nil || owner.UserID <= 0 || owner.APIKeyID <= 0 || owner.GroupID <= 0 || upstreamTaskID == "" {
		return nil, nil, ErrVideoTaskNotFound
	}

	now := time.Now()
	if s.now != nil {
		now = s.now()
	}
	task, err := s.repo.GetForOwner(ctx, owner.UserID, owner.APIKeyID, provider, upstreamTaskID, now)
	if err != nil {
		if errors.Is(err, ErrVideoTaskNotFound) {
			return nil, nil, ErrVideoTaskNotFound
		}
		return nil, nil, ErrVideoTaskLookupFailed.WithCause(err)
	}
	if task == nil ||
		task.UserID != owner.UserID ||
		task.APIKeyID != owner.APIKeyID ||
		(provider != "" && task.Provider != provider) ||
		strings.TrimSpace(task.Provider) == "" ||
		task.UpstreamTaskID != upstreamTaskID ||
		!now.Before(task.ExpiresAt) {
		return nil, nil, ErrVideoTaskNotFound
	}
	if task.GroupID != owner.GroupID || s.accountRepo == nil {
		return task, nil, ErrVideoTaskBoundAccountUnavailable
	}

	account, err := s.accountRepo.GetByID(ctx, task.AccountID)
	if err != nil || !boundVideoAccountUsable(account, task, accountPlatform, now) {
		return task, nil, ErrVideoTaskBoundAccountUnavailable.WithCause(err)
	}
	return task, account, nil
}

func boundVideoAccountUsable(account *Account, task *VideoTask, accountPlatform string, now time.Time) bool {
	if account == nil || task == nil || account.ID != task.AccountID {
		return false
	}
	if accountPlatform != "" && account.Platform != accountPlatform {
		return false
	}
	if !account.IsActive() {
		return false
	}
	if account.AutoPauseOnExpired && account.ExpiresAt != nil && !now.Before(*account.ExpiresAt) {
		return false
	}
	for _, groupID := range account.GroupIDs {
		if groupID == task.GroupID {
			return true
		}
	}
	return false
}
