-- 异步视频任务的持久所有权和原上游账号绑定。
-- 可重复执行，不会重复创建表或索引。

CREATE TABLE IF NOT EXISTS video_tasks (
    id BIGSERIAL PRIMARY KEY,
    provider VARCHAR(32) NOT NULL,
    upstream_task_id VARCHAR(255) NOT NULL,
    account_id BIGINT NOT NULL,
    group_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL,
    api_key_id BIGINT NOT NULL,
    model VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'submitted',
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS video_tasks_provider_account_task_uq
    ON video_tasks (provider, account_id, upstream_task_id);

CREATE INDEX IF NOT EXISTS video_tasks_owner_lookup_idx
    ON video_tasks (user_id, api_key_id, provider, upstream_task_id);

CREATE INDEX IF NOT EXISTS video_tasks_expires_at_idx
    ON video_tasks (expires_at);

CREATE INDEX IF NOT EXISTS video_tasks_account_id_idx
    ON video_tasks (account_id);
