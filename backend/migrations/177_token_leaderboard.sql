CREATE TABLE IF NOT EXISTS token_leaderboard_settlements (
    settlement_date DATE PRIMARY KEY,
    settled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS token_leaderboard_daily (
    settlement_date DATE NOT NULL,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rank INTEGER NOT NULL,
    total_tokens BIGINT NOT NULL DEFAULT 0,
    reward_points INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (settlement_date, user_id),
    UNIQUE (settlement_date, rank),
    CHECK (rank > 0),
    CHECK (total_tokens >= 0),
    CHECK (reward_points >= 0)
);

CREATE INDEX IF NOT EXISTS token_leaderboard_daily_date_rank_idx
    ON token_leaderboard_daily (settlement_date, rank);

CREATE TABLE IF NOT EXISTS token_point_wallets (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    points BIGINT NOT NULL DEFAULT 0,
    total_earned BIGINT NOT NULL DEFAULT 0,
    total_redeemed BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (points >= 0),
    CHECK (total_earned >= 0),
    CHECK (total_redeemed >= 0)
);

CREATE TABLE IF NOT EXISTS token_point_ledger (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action VARCHAR(20) NOT NULL,
    points_delta BIGINT NOT NULL,
    points_after BIGINT NOT NULL,
    settlement_date DATE,
    rank INTEGER,
    total_tokens BIGINT,
    quota_amount NUMERIC(20, 8),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (action IN ('ranking_reward', 'quota_exchange')),
    CHECK (points_after >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS token_point_ledger_reward_once_idx
    ON token_point_ledger (settlement_date, user_id)
    WHERE action = 'ranking_reward';

CREATE INDEX IF NOT EXISTS token_point_ledger_user_created_idx
    ON token_point_ledger (user_id, created_at DESC);
