CREATE TABLE IF NOT EXISTS generation_records (
    id BIGSERIAL PRIMARY KEY,
    task_id VARCHAR(64) NOT NULL UNIQUE,
    user_id BIGINT NOT NULL,
    api_key_id BIGINT NOT NULL,
    account_id BIGINT,
    media_type VARCHAR(16) NOT NULL,
    provider VARCHAR(32) NOT NULL DEFAULT '',
    model VARCHAR(128) NOT NULL DEFAULT '',
    prompt_preview TEXT NOT NULL DEFAULT '',
    status VARCHAR(32) NOT NULL DEFAULT 'running',
    upstream_task_id VARCHAR(255),
    result_json JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS generation_records_user_created_idx
    ON generation_records (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS generation_records_created_idx
    ON generation_records (created_at);

CREATE INDEX IF NOT EXISTS generation_records_upstream_idx
    ON generation_records (user_id, api_key_id, provider, account_id, upstream_task_id)
    WHERE upstream_task_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS generation_records_provider_task_uq
    ON generation_records (provider, account_id, upstream_task_id)
    WHERE account_id IS NOT NULL AND upstream_task_id IS NOT NULL;
