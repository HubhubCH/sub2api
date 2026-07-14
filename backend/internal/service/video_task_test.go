package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type videoTaskRepositoryStub struct {
	createParams CreateVideoTaskParams
	createResult *VideoTask
	createErr    error
	task         *VideoTask
	getErr       error
	gotUserID    int64
	gotAPIKeyID  int64
	gotProvider  string
	gotTaskID    string
}

func (r *videoTaskRepositoryStub) Create(_ context.Context, params CreateVideoTaskParams) (*VideoTask, error) {
	r.createParams = params
	return r.createResult, r.createErr
}

func (r *videoTaskRepositoryStub) GetForOwner(
	_ context.Context,
	userID, apiKeyID int64,
	provider, upstreamTaskID string,
	_ time.Time,
) (*VideoTask, error) {
	r.gotUserID = userID
	r.gotAPIKeyID = apiKeyID
	r.gotProvider = provider
	r.gotTaskID = upstreamTaskID
	return r.task, r.getErr
}

type videoTaskAccountRepositoryStub struct {
	AccountRepository
	account *Account
	err     error
	gotID   int64
}

func (r *videoTaskAccountRepositoryStub) GetByID(_ context.Context, id int64) (*Account, error) {
	r.gotID = id
	return r.account, r.err
}

func validVideoTask(now time.Time) *VideoTask {
	return &VideoTask{
		ID:             1,
		Provider:       "grok",
		UpstreamTaskID: "task-123",
		AccountID:      72,
		GroupID:        9,
		UserID:         10,
		APIKeyID:       11,
		Model:          "grok-imagine-video",
		Status:         VideoTaskStatusSubmitted,
		ExpiresAt:      now.Add(time.Hour),
		CreatedAt:      now,
		UpdatedAt:      now,
	}
}

func validBoundVideoAccount() *Account {
	return &Account{
		ID:          72,
		Platform:    PlatformOpenAI,
		Status:      StatusActive,
		Schedulable: true,
		GroupIDs:    []int64{9},
	}
}

func TestVideoTaskServiceCreateReturnsExplicitBindingFailure(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	dbErr := errors.New("database unavailable")
	repo := &videoTaskRepositoryStub{createErr: dbErr}
	svc := NewVideoTaskService(repo, nil)
	svc.now = func() time.Time { return now }

	_, err := svc.Create(context.Background(), CreateVideoTaskParams{
		Provider:       "grok",
		UpstreamTaskID: "task-123",
		AccountID:      72,
		GroupID:        9,
		UserID:         10,
		APIKeyID:       11,
		Model:          "grok-imagine-video",
	})

	require.ErrorIs(t, err, ErrVideoTaskBindingFailed)
	require.ErrorIs(t, err, dbErr)
	require.Equal(t, VideoTaskStatusSubmitted, repo.createParams.Status)
	require.Equal(t, now.Add(DefaultVideoTaskTTL), repo.createParams.ExpiresAt)
}

func TestVideoTaskServiceResolveBoundAccountEnforcesOwnerAndOriginalAccount(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	task := validVideoTask(now)
	repo := &videoTaskRepositoryStub{task: task}
	accounts := &videoTaskAccountRepositoryStub{account: validBoundVideoAccount()}
	svc := NewVideoTaskService(repo, accounts)
	svc.now = func() time.Time { return now }

	gotTask, gotAccount, err := svc.ResolveBoundAccount(
		context.Background(),
		VideoTaskOwner{UserID: 10, APIKeyID: 11, GroupID: 9},
		" GROK ",
		" task-123 ",
		PlatformOpenAI,
	)

	require.NoError(t, err)
	require.Equal(t, task, gotTask)
	require.Equal(t, accounts.account, gotAccount)
	require.Equal(t, int64(10), repo.gotUserID)
	require.Equal(t, int64(11), repo.gotAPIKeyID)
	require.Equal(t, "grok", repo.gotProvider)
	require.Equal(t, "task-123", repo.gotTaskID)
	require.Equal(t, int64(72), accounts.gotID)
}

func TestVideoTaskServiceResolveBoundAccountIgnoresSchedulerOnlyState(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name   string
		mutate func(*Account)
	}{
		{
			name: "manual scheduling disabled",
			mutate: func(account *Account) {
				account.Schedulable = false
			},
		},
		{
			name: "temporary scheduling cooldown",
			mutate: func(account *Account) {
				until := now.Add(time.Hour)
				account.TempUnschedulableUntil = &until
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			account := validBoundVideoAccount()
			tc.mutate(account)
			svc := NewVideoTaskService(
				&videoTaskRepositoryStub{task: validVideoTask(now)},
				&videoTaskAccountRepositoryStub{account: account},
			)
			svc.now = func() time.Time { return now }

			_, gotAccount, err := svc.ResolveBoundAccount(context.Background(), VideoTaskOwner{UserID: 10, APIKeyID: 11, GroupID: 9}, "grok", "task-123", PlatformOpenAI)
			require.NoError(t, err)
			require.Equal(t, account, gotAccount)
		})
	}
}

func TestVideoTaskServiceResolveBoundAccountRejectsExpiredTask(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	task := validVideoTask(now)
	task.ExpiresAt = now
	svc := NewVideoTaskService(
		&videoTaskRepositoryStub{task: task},
		&videoTaskAccountRepositoryStub{account: validBoundVideoAccount()},
	)
	svc.now = func() time.Time { return now }

	_, _, err := svc.ResolveBoundAccount(context.Background(), VideoTaskOwner{UserID: 10, APIKeyID: 11, GroupID: 9}, "grok", "task-123", PlatformOpenAI)
	require.ErrorIs(t, err, ErrVideoTaskNotFound)
}

func TestVideoTaskServiceResolveBoundAccountRejectsBindingDriftWithoutFailover(t *testing.T) {
	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name    string
		owner   VideoTaskOwner
		account *Account
		err     error
	}{
		{name: "current api key group changed", owner: VideoTaskOwner{UserID: 10, APIKeyID: 11, GroupID: 99}, account: validBoundVideoAccount()},
		{name: "account missing", owner: VideoTaskOwner{UserID: 10, APIKeyID: 11, GroupID: 9}, err: ErrAccountNotFound},
		{name: "account platform changed", owner: VideoTaskOwner{UserID: 10, APIKeyID: 11, GroupID: 9}, account: func() *Account { a := validBoundVideoAccount(); a.Platform = PlatformGrok; return a }()},
		{name: "account left group", owner: VideoTaskOwner{UserID: 10, APIKeyID: 11, GroupID: 9}, account: func() *Account { a := validBoundVideoAccount(); a.GroupIDs = []int64{8}; return a }()},
		{name: "account disabled", owner: VideoTaskOwner{UserID: 10, APIKeyID: 11, GroupID: 9}, account: func() *Account { a := validBoundVideoAccount(); a.Status = StatusDisabled; return a }()},
		{name: "account credentials expired", owner: VideoTaskOwner{UserID: 10, APIKeyID: 11, GroupID: 9}, account: func() *Account {
			a := validBoundVideoAccount()
			a.AutoPauseOnExpired = true
			a.ExpiresAt = &now
			return a
		}()},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := NewVideoTaskService(
				&videoTaskRepositoryStub{task: validVideoTask(now)},
				&videoTaskAccountRepositoryStub{account: tc.account, err: tc.err},
			)
			svc.now = func() time.Time { return now }

			_, account, err := svc.ResolveBoundAccount(context.Background(), tc.owner, "grok", "task-123", PlatformOpenAI)
			require.Nil(t, account)
			require.ErrorIs(t, err, ErrVideoTaskBoundAccountUnavailable)
		})
	}
}

func TestVideoTaskServiceResolveBoundAccountHidesWrongOwner(t *testing.T) {
	svc := NewVideoTaskService(
		&videoTaskRepositoryStub{getErr: ErrVideoTaskNotFound},
		&videoTaskAccountRepositoryStub{account: validBoundVideoAccount()},
	)

	_, _, err := svc.ResolveBoundAccount(context.Background(), VideoTaskOwner{UserID: 999, APIKeyID: 11, GroupID: 9}, "grok", "task-123", PlatformOpenAI)
	require.ErrorIs(t, err, ErrVideoTaskNotFound)
}
