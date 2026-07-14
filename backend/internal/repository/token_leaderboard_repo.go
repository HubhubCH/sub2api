package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/Wei-Shaw/sub2api/internal/service"
)

type tokenLeaderboardRepository struct {
	db *sql.DB
}

func NewTokenLeaderboardRepository(db *sql.DB) service.TokenLeaderboardRepository {
	return &tokenLeaderboardRepository{db: db}
}

func (r *tokenLeaderboardRepository) ListDaily(
	ctx context.Context,
	date time.Time,
	start time.Time,
	end time.Time,
	currentUserID int64,
) ([]service.TokenLeaderboardEntry, bool, *time.Time, int64, error) {
	settled, settledAt, err := r.settlementStatus(ctx, date)
	if err != nil {
		return nil, false, nil, 0, err
	}

	var rows *sql.Rows
	if settled {
		rows, err = r.db.QueryContext(ctx, `
SELECT d.rank, d.user_id, d.total_tokens, d.reward_points
FROM token_leaderboard_daily d
JOIN users u ON u.id = d.user_id AND u.deleted_at IS NULL AND u.role <> 'admin'
WHERE d.settlement_date = $1
  AND (d.rank <= 100 OR d.user_id = $2)
ORDER BY d.rank`, date.Format("2006-01-02"), currentUserID)
	} else {
		rows, err = r.db.QueryContext(ctx, `
WITH totals AS (
    SELECT ul.user_id,
           SUM(ul.input_tokens + ul.output_tokens + ul.cache_creation_tokens + ul.cache_read_tokens)::bigint AS total_tokens
    FROM usage_logs ul
    JOIN users u ON u.id = ul.user_id AND u.deleted_at IS NULL AND u.role <> 'admin'
    WHERE ul.created_at >= $1 AND ul.created_at < $2
    GROUP BY ul.user_id
), ranked AS (
    SELECT user_id,
           total_tokens,
           ROW_NUMBER() OVER (ORDER BY total_tokens DESC, user_id ASC)::integer AS rank
    FROM totals
    WHERE total_tokens > 0
)
SELECT rank,
       user_id,
       total_tokens,
       CASE rank WHEN 1 THEN 20 WHEN 2 THEN 10 WHEN 3 THEN 5 ELSE 0 END AS reward_points
FROM ranked
WHERE rank <= 100 OR user_id = $3
ORDER BY rank`, start, end, currentUserID)
	}
	if err != nil {
		return nil, false, nil, 0, err
	}
	defer func() { _ = rows.Close() }()

	entries := make([]service.TokenLeaderboardEntry, 0)
	for rows.Next() {
		var item service.TokenLeaderboardEntry
		if err := rows.Scan(&item.Rank, &item.UserID, &item.TotalTokens, &item.RewardPoints); err != nil {
			return nil, false, nil, 0, err
		}
		entries = append(entries, item)
	}
	if err := rows.Err(); err != nil {
		return nil, false, nil, 0, err
	}

	points, err := r.walletPoints(ctx, currentUserID)
	if err != nil {
		return nil, false, nil, 0, err
	}
	return entries, settled, settledAt, points, nil
}

func (r *tokenLeaderboardRepository) SettleDaily(ctx context.Context, date, start, end time.Time) error {
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	dateText := date.Format("2006-01-02")
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtext($1))", "token_leaderboard:"+dateText); err != nil {
		return fmt.Errorf("锁定排行榜结算: %w", err)
	}

	var exists bool
	if err := tx.QueryRowContext(ctx,
		"SELECT EXISTS (SELECT 1 FROM token_leaderboard_settlements WHERE settlement_date = $1)",
		dateText,
	).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return tx.Commit()
	}

	if _, err := tx.ExecContext(ctx, `
WITH totals AS (
    SELECT ul.user_id,
           SUM(ul.input_tokens + ul.output_tokens + ul.cache_creation_tokens + ul.cache_read_tokens)::bigint AS total_tokens
    FROM usage_logs ul
    JOIN users u ON u.id = ul.user_id AND u.deleted_at IS NULL AND u.role <> 'admin'
    WHERE ul.created_at >= $2 AND ul.created_at < $3
    GROUP BY ul.user_id
), ranked AS (
    SELECT user_id,
           total_tokens,
           ROW_NUMBER() OVER (ORDER BY total_tokens DESC, user_id ASC)::integer AS rank
    FROM totals
    WHERE total_tokens > 0
)
INSERT INTO token_leaderboard_daily (settlement_date, user_id, rank, total_tokens, reward_points)
SELECT $1,
       user_id,
       rank,
       total_tokens,
       CASE rank WHEN 1 THEN 20 WHEN 2 THEN 10 WHEN 3 THEN 5 ELSE 0 END
FROM ranked
ON CONFLICT (settlement_date, user_id) DO NOTHING`, dateText, start, end); err != nil {
		return fmt.Errorf("保存排行榜快照: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
INSERT INTO token_point_wallets (user_id, points, total_earned, created_at, updated_at)
SELECT user_id, reward_points, reward_points, NOW(), NOW()
FROM token_leaderboard_daily
WHERE settlement_date = $1 AND reward_points > 0
ON CONFLICT (user_id) DO UPDATE
SET points = token_point_wallets.points + EXCLUDED.points,
    total_earned = token_point_wallets.total_earned + EXCLUDED.total_earned,
    updated_at = NOW()`, dateText); err != nil {
		return fmt.Errorf("发放排行榜积分: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
INSERT INTO token_point_ledger (
    user_id, action, points_delta, points_after, settlement_date, rank, total_tokens, created_at
)
SELECT d.user_id,
       'ranking_reward',
       d.reward_points,
       w.points,
       d.settlement_date,
       d.rank,
       d.total_tokens,
       NOW()
FROM token_leaderboard_daily d
JOIN token_point_wallets w ON w.user_id = d.user_id
WHERE d.settlement_date = $1 AND d.reward_points > 0
ON CONFLICT DO NOTHING`, dateText); err != nil {
		return fmt.Errorf("记录排行榜积分流水: %w", err)
	}

	if _, err := tx.ExecContext(ctx,
		"INSERT INTO token_leaderboard_settlements (settlement_date, settled_at) VALUES ($1, NOW()) ON CONFLICT DO NOTHING",
		dateText,
	); err != nil {
		return fmt.Errorf("完成排行榜结算: %w", err)
	}
	return tx.Commit()
}

func (r *tokenLeaderboardRepository) ExchangePoints(
	ctx context.Context,
	userID int64,
	points int64,
	quota float64,
) (int64, float64, error) {
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return 0, 0, err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `
INSERT INTO token_point_wallets (user_id, points, total_earned, total_redeemed)
VALUES ($1, 0, 0, 0)
ON CONFLICT (user_id) DO NOTHING`, userID); err != nil {
		return 0, 0, err
	}

	var remaining int64
	err = tx.QueryRowContext(ctx, `
UPDATE token_point_wallets
SET points = points - $2,
    total_redeemed = total_redeemed + $2,
    updated_at = NOW()
WHERE user_id = $1 AND points >= $2
RETURNING points`, userID, points).Scan(&remaining)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, 0, service.ErrTokenPointsInsufficient
	}
	if err != nil {
		return 0, 0, err
	}

	var balance float64
	if err := tx.QueryRowContext(ctx, `
UPDATE users
SET balance = balance + $2,
    updated_at = NOW()
WHERE id = $1 AND deleted_at IS NULL
RETURNING balance::double precision`, userID, quota).Scan(&balance); err != nil {
		return 0, 0, err
	}

	if _, err := tx.ExecContext(ctx, `
INSERT INTO token_point_ledger (
    user_id, action, points_delta, points_after, quota_amount, created_at
)
VALUES ($1, 'quota_exchange', $2, $3, $4, NOW())`, userID, -points, remaining, quota); err != nil {
		return 0, 0, err
	}

	if err := tx.Commit(); err != nil {
		return 0, 0, err
	}
	return remaining, balance, nil
}

func (r *tokenLeaderboardRepository) settlementStatus(ctx context.Context, date time.Time) (bool, *time.Time, error) {
	var settledAt time.Time
	err := r.db.QueryRowContext(ctx,
		"SELECT settled_at FROM token_leaderboard_settlements WHERE settlement_date = $1",
		date.Format("2006-01-02"),
	).Scan(&settledAt)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil, nil
	}
	if err != nil {
		return false, nil, err
	}
	return true, &settledAt, nil
}

func (r *tokenLeaderboardRepository) walletPoints(ctx context.Context, userID int64) (int64, error) {
	var points int64
	err := r.db.QueryRowContext(ctx,
		"SELECT points FROM token_point_wallets WHERE user_id = $1",
		userID,
	).Scan(&points)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return points, err
}
