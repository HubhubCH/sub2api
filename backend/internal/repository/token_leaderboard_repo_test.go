package repository

import (
	"context"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/stretchr/testify/require"
)

func TestTokenLeaderboardListDailyExcludesAdminUsers(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	repo := NewTokenLeaderboardRepository(db)
	date := time.Date(2026, 7, 13, 0, 0, 0, 0, time.UTC)

	mock.ExpectQuery("SELECT settled_at FROM token_leaderboard_settlements").
		WillReturnRows(sqlmock.NewRows([]string{"settled_at"}))
	mock.ExpectQuery("JOIN users u ON u.id = ul.user_id AND u.deleted_at IS NULL AND u.role <> 'admin'").
		WillReturnRows(sqlmock.NewRows([]string{"rank", "user_id", "total_tokens", "reward_points"}))
	mock.ExpectQuery("SELECT points FROM token_point_wallets").
		WillReturnRows(sqlmock.NewRows([]string{"points"}))

	_, settled, _, _, err := repo.ListDaily(context.Background(), date, date, date.Add(24*time.Hour), 42)

	require.NoError(t, err)
	require.False(t, settled)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestTokenLeaderboardSettledListExcludesAdminUsers(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	repo := NewTokenLeaderboardRepository(db)
	date := time.Date(2026, 7, 13, 0, 0, 0, 0, time.UTC)

	mock.ExpectQuery("SELECT settled_at FROM token_leaderboard_settlements").
		WillReturnRows(sqlmock.NewRows([]string{"settled_at"}).AddRow(date.Add(time.Hour)))
	mock.ExpectQuery("FROM token_leaderboard_daily d\\s+JOIN users u ON u.id = d.user_id AND u.deleted_at IS NULL AND u.role <> 'admin'").
		WillReturnRows(sqlmock.NewRows([]string{"rank", "user_id", "total_tokens", "reward_points"}))
	mock.ExpectQuery("SELECT points FROM token_point_wallets").
		WillReturnRows(sqlmock.NewRows([]string{"points"}))

	_, settled, _, _, err := repo.ListDaily(context.Background(), date, date, date.Add(24*time.Hour), 42)

	require.NoError(t, err)
	require.True(t, settled)
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestTokenLeaderboardSettlementExcludesAdminUsers(t *testing.T) {
	db, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer db.Close()
	repo := NewTokenLeaderboardRepository(db)
	date := time.Date(2026, 7, 13, 0, 0, 0, 0, time.UTC)

	mock.ExpectBegin()
	mock.ExpectExec("SELECT pg_advisory_xact_lock").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT EXISTS").WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectExec("JOIN users u ON u.id = ul.user_id AND u.deleted_at IS NULL AND u.role <> 'admin'").
		WillReturnResult(sqlmock.NewResult(0, 3))
	mock.ExpectExec("INSERT INTO token_point_wallets").WillReturnResult(sqlmock.NewResult(0, 3))
	mock.ExpectExec("INSERT INTO token_point_ledger").WillReturnResult(sqlmock.NewResult(0, 3))
	mock.ExpectExec("INSERT INTO token_leaderboard_settlements").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	err = repo.SettleDaily(context.Background(), date, date, date.Add(24*time.Hour))

	require.NoError(t, err)
	require.NoError(t, mock.ExpectationsWereMet())
}
