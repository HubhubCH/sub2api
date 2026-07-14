package repository

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/stretchr/testify/require"
)

func videoTaskTestRows(task service.VideoTask) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "provider", "upstream_task_id", "account_id", "group_id", "user_id", "api_key_id",
		"model", "status", "expires_at", "created_at", "updated_at",
	}).AddRow(
		task.ID, task.Provider, task.UpstreamTaskID, task.AccountID, task.GroupID, task.UserID, task.APIKeyID,
		task.Model, task.Status, task.ExpiresAt, task.CreatedAt, task.UpdatedAt,
	)
}

func videoTaskTestValue(now time.Time) service.VideoTask {
	return service.VideoTask{
		ID:             1,
		Provider:       "grok",
		UpstreamTaskID: "task-123",
		AccountID:      72,
		GroupID:        9,
		UserID:         10,
		APIKeyID:       11,
		Model:          "grok-imagine-video",
		Status:         service.VideoTaskStatusSubmitted,
		ExpiresAt:      now.Add(time.Hour),
		CreatedAt:      now,
		UpdatedAt:      now,
	}
}

func videoTaskCreateParams(task service.VideoTask) service.CreateVideoTaskParams {
	return service.CreateVideoTaskParams{
		Provider:       task.Provider,
		UpstreamTaskID: task.UpstreamTaskID,
		AccountID:      task.AccountID,
		GroupID:        task.GroupID,
		UserID:         task.UserID,
		APIKeyID:       task.APIKeyID,
		Model:          task.Model,
		Status:         task.Status,
		ExpiresAt:      task.ExpiresAt,
	}
}

func TestVideoTaskRepositoryCreateAndExactOwnerLookup(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	task := videoTaskTestValue(now)
	repo := newVideoTaskRepositoryWithSQL(db)

	mock.ExpectQuery("(?s)DELETE FROM video_tasks.*INSERT INTO video_tasks").
		WithArgs(task.Provider, task.UpstreamTaskID, task.AccountID, task.GroupID, task.UserID, task.APIKeyID, task.Model, task.Status, task.ExpiresAt).
		WillReturnRows(videoTaskTestRows(task))
	created, err := repo.Create(context.Background(), videoTaskCreateParams(task))
	require.NoError(t, err)
	require.Equal(t, &task, created)

	mock.ExpectQuery("FROM video_tasks").
		WithArgs(task.UserID, task.APIKeyID, task.Provider, task.UpstreamTaskID, now).
		WillReturnRows(videoTaskTestRows(task))
	got, err := repo.GetForOwner(context.Background(), task.UserID, task.APIKeyID, task.Provider, task.UpstreamTaskID, now)
	require.NoError(t, err)
	require.Equal(t, &task, got)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestVideoTaskRepositoryCreateReturnsIdenticalDuplicate(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	task := videoTaskTestValue(now)
	repo := newVideoTaskRepositoryWithSQL(db)

	mock.ExpectQuery("INSERT INTO video_tasks").
		WillReturnRows(sqlmock.NewRows([]string{"id", "provider", "upstream_task_id", "account_id", "group_id", "user_id", "api_key_id", "model", "status", "expires_at", "created_at", "updated_at"}))
	mock.ExpectQuery("FROM video_tasks").
		WithArgs(task.Provider, task.AccountID, task.UpstreamTaskID).
		WillReturnRows(videoTaskTestRows(task))

	got, err := repo.Create(context.Background(), videoTaskCreateParams(task))
	require.NoError(t, err)
	require.Equal(t, &task, got)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestVideoTaskRepositoryCreateRejectsConflictingDuplicate(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)
	task := videoTaskTestValue(now)
	conflicting := task
	conflicting.APIKeyID = 999
	repo := newVideoTaskRepositoryWithSQL(db)

	mock.ExpectQuery("INSERT INTO video_tasks").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("FROM video_tasks").
		WithArgs(task.Provider, task.AccountID, task.UpstreamTaskID).
		WillReturnRows(videoTaskTestRows(conflicting))

	got, err := repo.Create(context.Background(), videoTaskCreateParams(task))
	require.Nil(t, got)
	require.ErrorIs(t, err, service.ErrVideoTaskConflict)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestVideoTaskRepositoryGetForOwnerHidesOwnershipMismatch(t *testing.T) {
	tests := []struct {
		name     string
		userID   int64
		apiKeyID int64
		provider string
	}{
		{name: "wrong user", userID: 99, apiKeyID: 11, provider: "grok"},
		{name: "wrong api key", userID: 10, apiKeyID: 99, provider: "grok"},
		{name: "wrong provider", userID: 10, apiKeyID: 11, provider: "agnes"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			require.NoError(t, err)
			t.Cleanup(func() { _ = db.Close() })
			repo := newVideoTaskRepositoryWithSQL(db)
			now := time.Date(2026, 7, 13, 12, 0, 0, 0, time.UTC)

			mock.ExpectQuery("FROM video_tasks").
				WithArgs(tc.userID, tc.apiKeyID, tc.provider, "task-123", now).
				WillReturnRows(sqlmock.NewRows([]string{"id"}))

			got, err := repo.GetForOwner(context.Background(), tc.userID, tc.apiKeyID, tc.provider, "task-123", now)
			require.Nil(t, got)
			require.ErrorIs(t, err, service.ErrVideoTaskNotFound)
			require.NoError(t, mock.ExpectationsWereMet())
		})
	}
}
