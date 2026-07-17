package repository

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/Wei-Shaw/sub2api/internal/service"
	"github.com/stretchr/testify/require"
)

func TestGenerationRecordCompleteRejectsMissingRecord(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	repo := NewGenerationRecordRepository(db)
	mock.ExpectExec("status=\\$4::varchar.*WHEN \\$4::varchar IN").WillReturnResult(sqlmock.NewResult(0, 0))

	err = repo.Complete(context.Background(), "gen_missing", 1, 0, service.GenerationStatusCompleted, "", nil, "")

	require.ErrorContains(t, err, "更新数量异常")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestGenerationRecordCompleteByUpstreamKeepsTerminalStateImmutable(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	repo := NewGenerationRecordRepository(db)
	mock.ExpectExec("status=CASE WHEN status IN \\('completed','failed'\\) THEN status ELSE \\$6::varchar END").
		WillReturnResult(sqlmock.NewResult(0, 1))

	err = repo.CompleteByUpstream(context.Background(), 1, 2, 3, "grok", "upstream-1", service.GenerationStatusSubmitted, nil, "")

	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestGenerationRecordTaskExistsChecksCurrentDatabaseState(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	repo := NewGenerationRecordRepository(db)
	mock.ExpectQuery("SELECT EXISTS").WithArgs("gen_active").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	exists, err := repo.TaskExists(context.Background(), "gen_active")

	require.NoError(t, err)
	require.True(t, exists)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestGenerationRecordCreateRejectsWhenAllTasksAreRunning(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	repo := NewGenerationRecordRepository(db)
	now := time.Now()
	mock.ExpectBegin()
	mock.ExpectExec("SELECT pg_advisory_xact_lock").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("DELETE FROM generation_records WHERE user_id").WillReturnRows(sqlmock.NewRows([]string{"task_id"}))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\) FROM generation_records").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(5))
	mock.ExpectQuery("WHERE user_id=\\$1 AND status IN \\(.*completed.*failed.*\\)\\s+ORDER BY created_at ASC").
		WillReturnRows(sqlmock.NewRows([]string{"task_id"}))
	mock.ExpectRollback()

	record, removed, err := repo.Create(context.Background(), generationRecordCreateParams(), now.Add(-72*time.Hour), 5)

	require.ErrorIs(t, err, service.ErrGenerationRecordLimit)
	require.Nil(t, record)
	require.Nil(t, removed)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestGenerationRecordCreateEvictsOldestFinishedTask(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	repo := NewGenerationRecordRepository(db)
	now := time.Now()
	mock.ExpectBegin()
	mock.ExpectExec("SELECT pg_advisory_xact_lock").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("DELETE FROM generation_records WHERE user_id").WillReturnRows(sqlmock.NewRows([]string{"task_id"}))
	mock.ExpectQuery("SELECT COUNT\\(\\*\\) FROM generation_records").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(5))
	mock.ExpectQuery("WHERE user_id=\\$1 AND status IN \\(.*completed.*failed.*\\)\\s+ORDER BY created_at ASC").
		WillReturnRows(sqlmock.NewRows([]string{"task_id"}).AddRow("gen_old"))
	mock.ExpectQuery("INSERT INTO generation_records").WillReturnRows(sqlmock.NewRows([]string{
		"task_id", "user_id", "api_key_id", "media_type", "creator_tool", "provider", "model", "prompt_preview", "status", "created_at", "updated_at",
	}).AddRow("gen_new", int64(1), int64(2), "image", "image", "grok", "grok-image", "prompt", service.GenerationStatusRunning, now, now))
	mock.ExpectCommit()

	record, removed, err := repo.Create(context.Background(), generationRecordCreateParams(), now.Add(-72*time.Hour), 5)

	require.NoError(t, err)
	require.Equal(t, "gen_new", record.TaskID)
	require.Equal(t, []string{"gen_old"}, removed)
	require.NoError(t, mock.ExpectationsWereMet())
}

func generationRecordCreateParams() service.CreateGenerationRecordParams {
	return service.CreateGenerationRecordParams{
		TaskID: "gen_new", UserID: 1, APIKeyID: 2, MediaType: "image",
		CreatorTool: "image", Provider: "grok", Model: "grok-image", PromptPreview: "prompt",
	}
}
