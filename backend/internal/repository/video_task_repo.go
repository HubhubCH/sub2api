package repository

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	dbent "github.com/Wei-Shaw/sub2api/ent"
	"github.com/Wei-Shaw/sub2api/internal/service"
)

const videoTaskColumns = `
id, provider, upstream_task_id, account_id, group_id, user_id, api_key_id,
model, status, expires_at, created_at, updated_at`

type videoTaskRepository struct {
	sql sqlExecutor
}

func NewVideoTaskRepository(_ *dbent.Client, sqlDB *sql.DB) service.VideoTaskRepository {
	return newVideoTaskRepositoryWithSQL(sqlDB)
}

func newVideoTaskRepositoryWithSQL(sqlq sqlExecutor) *videoTaskRepository {
	return &videoTaskRepository{sql: sqlq}
}

func (r *videoTaskRepository) Create(ctx context.Context, params service.CreateVideoTaskParams) (*service.VideoTask, error) {
	query := `
WITH expired_tasks AS (
    SELECT id
    FROM video_tasks
    WHERE expires_at <= NOW()
    ORDER BY expires_at
    LIMIT 100
), deleted_tasks AS (
    DELETE FROM video_tasks
    WHERE id IN (SELECT id FROM expired_tasks)
    RETURNING id
)
INSERT INTO video_tasks (
    provider, upstream_task_id, account_id, group_id, user_id, api_key_id,
    model, status, expires_at
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (provider, account_id, upstream_task_id) DO UPDATE SET
    group_id = EXCLUDED.group_id,
    user_id = EXCLUDED.user_id,
    api_key_id = EXCLUDED.api_key_id,
    model = EXCLUDED.model,
    status = EXCLUDED.status,
    expires_at = EXCLUDED.expires_at,
    updated_at = NOW()
WHERE video_tasks.expires_at <= NOW()
RETURNING ` + videoTaskColumns

	task, err := scanVideoTask(ctx, r.sql, query, []any{
		params.Provider,
		params.UpstreamTaskID,
		params.AccountID,
		params.GroupID,
		params.UserID,
		params.APIKeyID,
		params.Model,
		params.Status,
		params.ExpiresAt,
	})
	if err == nil {
		return task, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return nil, err
	}

	existing, lookupErr := r.getByBinding(ctx, params.Provider, params.AccountID, params.UpstreamTaskID)
	if lookupErr != nil {
		return nil, lookupErr
	}
	if !sameVideoTaskBinding(existing, params) {
		return nil, service.ErrVideoTaskConflict
	}
	return existing, nil
}

func (r *videoTaskRepository) GetForOwner(
	ctx context.Context,
	userID, apiKeyID int64,
	provider, upstreamTaskID string,
	now time.Time,
) (*service.VideoTask, error) {
	query := `
SELECT ` + videoTaskColumns + `
FROM video_tasks
WHERE user_id = $1
  AND api_key_id = $2
  AND provider = $3
  AND upstream_task_id = $4
	  AND expires_at > $5
  AND (
      SELECT COUNT(*)
      FROM video_tasks AS candidate
      WHERE candidate.user_id = $1
        AND candidate.api_key_id = $2
        AND candidate.provider = $3
        AND candidate.upstream_task_id = $4
        AND candidate.expires_at > $5
  ) = 1`
	args := []any{userID, apiKeyID, provider, upstreamTaskID, now}
	if strings.TrimSpace(provider) == "" {
		query = `
SELECT ` + videoTaskColumns + `
FROM video_tasks
WHERE user_id = $1
  AND api_key_id = $2
  AND upstream_task_id = $3
  AND expires_at > $4
  AND (
      SELECT COUNT(*)
      FROM video_tasks AS candidate
      WHERE candidate.user_id = $1
        AND candidate.api_key_id = $2
        AND candidate.upstream_task_id = $3
        AND candidate.expires_at > $4
  ) = 1`
		args = []any{userID, apiKeyID, upstreamTaskID, now}
	}
	task, err := scanVideoTask(ctx, r.sql, query, args)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, service.ErrVideoTaskNotFound.WithCause(err)
	}
	if err != nil {
		return nil, err
	}
	return task, nil
}

func (r *videoTaskRepository) getByBinding(ctx context.Context, provider string, accountID int64, upstreamTaskID string) (*service.VideoTask, error) {
	task, err := scanVideoTask(ctx, r.sql, `
SELECT `+videoTaskColumns+`
FROM video_tasks
WHERE provider = $1
  AND account_id = $2
	  AND upstream_task_id = $3`, []any{provider, accountID, upstreamTaskID})
	if errors.Is(err, sql.ErrNoRows) {
		return nil, service.ErrVideoTaskConflict.WithCause(err)
	}
	if err != nil {
		return nil, err
	}
	return task, nil
}

func scanVideoTask(ctx context.Context, sqlq sqlQueryer, query string, args []any) (*service.VideoTask, error) {
	task := &service.VideoTask{}
	err := scanSingleRow(
		ctx,
		sqlq,
		query,
		args,
		&task.ID,
		&task.Provider,
		&task.UpstreamTaskID,
		&task.AccountID,
		&task.GroupID,
		&task.UserID,
		&task.APIKeyID,
		&task.Model,
		&task.Status,
		&task.ExpiresAt,
		&task.CreatedAt,
		&task.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	return task, nil
}

func sameVideoTaskBinding(task *service.VideoTask, params service.CreateVideoTaskParams) bool {
	return task != nil &&
		strings.EqualFold(task.Provider, params.Provider) &&
		task.UpstreamTaskID == params.UpstreamTaskID &&
		task.AccountID == params.AccountID &&
		task.GroupID == params.GroupID &&
		task.UserID == params.UserID &&
		task.APIKeyID == params.APIKeyID &&
		task.Model == params.Model
}

var _ service.VideoTaskRepository = (*videoTaskRepository)(nil)
