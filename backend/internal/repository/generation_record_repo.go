package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
)

type generationRecordRepository struct{ db *sql.DB }

const generationRecordLockBase int64 = -6100000000000000000

func NewGenerationRecordRepository(db *sql.DB) service.GenerationRecordRepository {
	return &generationRecordRepository{db: db}
}

func (r *generationRecordRepository) Create(ctx context.Context, p service.CreateGenerationRecordParams, cutoff time.Time, limit int) (*service.GenerationRecord, []string, error) {
	if limit <= 0 {
		return nil, nil, errors.New("生成记录保留数量必须大于 0")
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1)`, generationRecordLockBase+p.UserID); err != nil {
		return nil, nil, err
	}
	removedTaskIDs := make([]string, 0)
	expiredRows, err := tx.QueryContext(ctx, `DELETE FROM generation_records WHERE user_id=$1 AND created_at < $2 RETURNING task_id`, p.UserID, cutoff)
	if err != nil {
		return nil, nil, err
	}
	for expiredRows.Next() {
		var taskID string
		if err := expiredRows.Scan(&taskID); err != nil {
			expiredRows.Close()
			return nil, nil, err
		}
		removedTaskIDs = append(removedTaskIDs, taskID)
	}
	if err := expiredRows.Err(); err != nil {
		expiredRows.Close()
		return nil, nil, err
	}
	if err := expiredRows.Close(); err != nil {
		return nil, nil, err
	}
	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM generation_records WHERE user_id=$1`, p.UserID).Scan(&count); err != nil {
		return nil, nil, err
	}
	for count >= limit {
		var removedTaskID string
		err := tx.QueryRowContext(ctx, `
DELETE FROM generation_records
WHERE id = (
    SELECT id FROM generation_records
    WHERE user_id=$1 AND status IN ('completed','failed')
    ORDER BY created_at ASC,id ASC
    LIMIT 1
)
RETURNING task_id`, p.UserID).Scan(&removedTaskID)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil, service.ErrGenerationRecordLimit
		}
		if err != nil {
			return nil, nil, err
		}
		removedTaskIDs = append(removedTaskIDs, removedTaskID)
		count--
	}
	record := &service.GenerationRecord{}
	err = tx.QueryRowContext(ctx, `
INSERT INTO generation_records (task_id,user_id,api_key_id,media_type,creator_tool,provider,model,prompt_preview,status)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
RETURNING task_id,user_id,api_key_id,media_type,creator_tool,provider,model,prompt_preview,status,created_at,updated_at`,
		p.TaskID, p.UserID, p.APIKeyID, p.MediaType, p.CreatorTool, p.Provider, p.Model, p.PromptPreview, service.GenerationStatusRunning,
	).Scan(&record.TaskID, &record.UserID, &record.APIKeyID, &record.MediaType, &record.CreatorTool, &record.Provider, &record.Model, &record.PromptPreview, &record.Status, &record.CreatedAt, &record.UpdatedAt)
	if err != nil {
		return nil, nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, nil, err
	}
	return record, removedTaskIDs, nil
}

func (r *generationRecordRepository) Complete(ctx context.Context, taskID string, userID, accountID int64, status, upstream string, result json.RawMessage, failure string) error {
	execResult, err := r.db.ExecContext(ctx, `UPDATE generation_records SET account_id=NULLIF($3,0),status=$4::varchar,upstream_task_id=NULLIF($5,''),result_json=$6,error_message=NULLIF($7,''),updated_at=NOW(),finished_at=CASE WHEN $4::varchar IN ('completed','failed') THEN NOW() ELSE finished_at END WHERE task_id=$1 AND user_id=$2`, taskID, userID, accountID, status, upstream, nullableJSON(result), failure)
	if err != nil {
		return err
	}
	affected, err := execResult.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return fmt.Errorf("生成记录状态更新数量异常: %d", affected)
	}
	return nil
}

func (r *generationRecordRepository) CompleteByUpstream(ctx context.Context, userID, apiKeyID, accountID int64, provider, upstream, status string, result json.RawMessage, failure string) error {
	execResult, err := r.db.ExecContext(ctx, `UPDATE generation_records SET
status=CASE WHEN status IN ('completed','failed') THEN status ELSE $6::varchar END,
result_json=CASE WHEN status IN ('completed','failed') THEN result_json ELSE COALESCE($7,result_json) END,
error_message=CASE WHEN status IN ('completed','failed') THEN error_message ELSE NULLIF($8,'') END,
updated_at=NOW(),
finished_at=CASE WHEN status IN ('completed','failed') THEN finished_at WHEN $6::varchar IN ('completed','failed') THEN NOW() ELSE finished_at END
WHERE user_id=$1 AND api_key_id=$2 AND account_id=$3 AND provider=$4 AND upstream_task_id=$5`, userID, apiKeyID, accountID, provider, upstream, status, nullableJSON(result), failure)
	if err != nil {
		return err
	}
	affected, err := execResult.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return fmt.Errorf("生成记录状态更新数量异常: %d", affected)
	}
	return nil
}

func (r *generationRecordRepository) ListByUser(ctx context.Context, userID int64, limit int) ([]*service.GenerationRecord, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT task_id,user_id,api_key_id,COALESCE(account_id,0),media_type,creator_tool,provider,model,prompt_preview,status,COALESCE(upstream_task_id,''),COALESCE(result_json,'null'::jsonb),COALESCE(error_message,''),created_at,updated_at,finished_at FROM generation_records WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]*service.GenerationRecord, 0)
	for rows.Next() {
		record := &service.GenerationRecord{}
		var raw []byte
		var finished sql.NullTime
		if err := rows.Scan(&record.TaskID, &record.UserID, &record.APIKeyID, &record.AccountID, &record.MediaType, &record.CreatorTool, &record.Provider, &record.Model, &record.PromptPreview, &record.Status, &record.UpstreamTaskID, &raw, &record.ErrorMessage, &record.CreatedAt, &record.UpdatedAt, &finished); err != nil {
			return nil, err
		}
		record.Result = raw
		if finished.Valid {
			value := finished.Time
			record.FinishedAt = &value
		}
		result = append(result, record)
	}
	return result, rows.Err()
}

func (r *generationRecordRepository) GetByUser(ctx context.Context, userID int64, taskID string) (*service.GenerationRecord, error) {
	record := &service.GenerationRecord{}
	var raw []byte
	err := r.db.QueryRowContext(ctx, `SELECT task_id,user_id,api_key_id,COALESCE(account_id,0),media_type,creator_tool,provider,model,prompt_preview,status,COALESCE(upstream_task_id,''),COALESCE(result_json,'null'::jsonb),COALESCE(error_message,''),created_at,updated_at FROM generation_records WHERE user_id=$1 AND task_id=$2`, userID, taskID).Scan(&record.TaskID, &record.UserID, &record.APIKeyID, &record.AccountID, &record.MediaType, &record.CreatorTool, &record.Provider, &record.Model, &record.PromptPreview, &record.Status, &record.UpstreamTaskID, &raw, &record.ErrorMessage, &record.CreatedAt, &record.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, os.ErrNotExist
	}
	record.Result = raw
	return record, err
}

func (r *generationRecordRepository) GetByUpstream(ctx context.Context, userID, apiKeyID, accountID int64, provider, upstream string) (*service.GenerationRecord, error) {
	record := &service.GenerationRecord{}
	var raw []byte
	err := r.db.QueryRowContext(ctx, `SELECT task_id,user_id,api_key_id,COALESCE(account_id,0),media_type,creator_tool,provider,model,prompt_preview,status,COALESCE(upstream_task_id,''),COALESCE(result_json,'null'::jsonb),COALESCE(error_message,''),created_at,updated_at FROM generation_records WHERE user_id=$1 AND api_key_id=$2 AND account_id=$3 AND provider=$4 AND upstream_task_id=$5`, userID, apiKeyID, accountID, provider, upstream).Scan(&record.TaskID, &record.UserID, &record.APIKeyID, &record.AccountID, &record.MediaType, &record.CreatorTool, &record.Provider, &record.Model, &record.PromptPreview, &record.Status, &record.UpstreamTaskID, &raw, &record.ErrorMessage, &record.CreatedAt, &record.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, os.ErrNotExist
	}
	record.Result = raw
	return record, err
}

func (r *generationRecordRepository) TaskExists(ctx context.Context, taskID string) (bool, error) {
	var exists bool
	err := r.db.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM generation_records WHERE task_id=$1)`, taskID).Scan(&exists)
	return exists, err
}

func (r *generationRecordRepository) Cleanup(ctx context.Context, userID int64, cutoff time.Time, limit int) ([]string, error) {
	rows, err := r.db.QueryContext(ctx, `
WITH ranked AS (
    SELECT id,
           task_id,
           created_at,
           ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC, id DESC) AS row_number
    FROM generation_records
    WHERE $1 = 0 OR user_id = $1
), deleted AS (
    DELETE FROM generation_records AS records
    USING ranked
    WHERE records.id = ranked.id
      AND (ranked.created_at < $2 OR (ranked.row_number > $3 AND records.status IN ('completed','failed')))
    RETURNING records.task_id
)
SELECT task_id FROM deleted`, userID, cutoff, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	taskIDs := make([]string, 0)
	for rows.Next() {
		var taskID string
		if err := rows.Scan(&taskID); err != nil {
			return nil, err
		}
		taskIDs = append(taskIDs, taskID)
	}
	return taskIDs, rows.Err()
}

func (r *generationRecordRepository) ListPendingVideos(ctx context.Context, cutoff time.Time, limit int) ([]*service.GenerationRecord, error) {
	rows, err := r.db.QueryContext(ctx, `
WITH selected AS (
    SELECT id
    FROM generation_records
    WHERE media_type='video'
      AND status IN ('running','submitted')
      AND account_id IS NOT NULL
      AND upstream_task_id IS NOT NULL
      AND created_at >= $1
    ORDER BY updated_at ASC
    LIMIT $2
    FOR UPDATE SKIP LOCKED
), claimed AS (
    UPDATE generation_records AS records
    SET updated_at=NOW()
    FROM selected
    WHERE records.id=selected.id
    RETURNING records.*
)
SELECT task_id,user_id,api_key_id,account_id,media_type,creator_tool,provider,model,prompt_preview,status,
       upstream_task_id,COALESCE(result_json,'null'::jsonb),COALESCE(error_message,''),created_at,updated_at
FROM claimed
ORDER BY updated_at ASC`, cutoff, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	records := make([]*service.GenerationRecord, 0)
	for rows.Next() {
		record := &service.GenerationRecord{}
		var raw []byte
		if err := rows.Scan(
			&record.TaskID, &record.UserID, &record.APIKeyID, &record.AccountID, &record.MediaType, &record.CreatorTool,
			&record.Provider, &record.Model, &record.PromptPreview, &record.Status, &record.UpstreamTaskID,
			&raw, &record.ErrorMessage, &record.CreatedAt, &record.UpdatedAt,
		); err != nil {
			return nil, err
		}
		record.Result = raw
		records = append(records, record)
	}
	return records, rows.Err()
}

func nullableJSON(value json.RawMessage) any {
	if len(value) == 0 {
		return nil
	}
	return string(value)
}
