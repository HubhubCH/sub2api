-- 持久化代理起始层级、当前层级与不归零的累计充值进度。
-- 每累计满 500 元，从账户原有层级晋升一级，一级封顶。

ALTER TABLE user_affiliates
    ADD COLUMN IF NOT EXISTS agent_level SMALLINT NOT NULL DEFAULT 10;

ALTER TABLE user_affiliates
    ADD COLUMN IF NOT EXISTS agent_initial_level SMALLINT NOT NULL DEFAULT 10;

ALTER TABLE user_affiliates
    ADD COLUMN IF NOT EXISTS agent_cumulative_recharge DECIMAL(20,8) NOT NULL DEFAULT 0;

COMMENT ON COLUMN user_affiliates.agent_level IS '当前代理层级：数字越小层级越高，1 级封顶，只升不降';
COMMENT ON COLUMN user_affiliates.agent_initial_level IS '累充晋级规则生效时的起始代理层级';
COMMENT ON COLUMN user_affiliates.agent_cumulative_recharge IS '本人及充值发生当时全部下游贡献的历史累充金额；晋级后不归零';

CREATE INDEX IF NOT EXISTS idx_user_affiliates_agent_level
    ON user_affiliates(agent_level, updated_at DESC);

-- 10 级默认值只用于上线后新建的自主注册账户。
-- 已有账户按现有邀请树回填起始层级：树根为 1 级，每向下一层加 1。
WITH RECURSIVE hierarchy AS (
    SELECT ua.user_id,
           1 AS agent_level,
           ARRAY[ua.user_id]::bigint[] AS path
    FROM user_affiliates ua
    LEFT JOIN user_affiliates parent ON parent.user_id = ua.inviter_id
    WHERE (ua.inviter_id IS NULL OR parent.user_id IS NULL)
    UNION ALL
    SELECT child.user_id,
           hierarchy.agent_level + 1,
           hierarchy.path || child.user_id
    FROM hierarchy
    JOIN user_affiliates child ON child.inviter_id = hierarchy.user_id
    WHERE hierarchy.agent_level < 100
      AND NOT child.user_id = ANY(hierarchy.path)
)
UPDATE user_affiliates ua
SET agent_level = hierarchy.agent_level,
    agent_initial_level = hierarchy.agent_level,
    updated_at = NOW()
FROM hierarchy
WHERE ua.user_id = hierarchy.user_id;

-- 每条余额兑换记录只累计一次；第三方支付也以其最终使用的兑换记录为准。
CREATE TABLE IF NOT EXISTS user_affiliate_recharge_events (
    id BIGSERIAL PRIMARY KEY,
    source_type VARCHAR(32) NOT NULL,
    source_id BIGINT NOT NULL,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount DECIMAL(20,8) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(source_type, source_id)
);

COMMENT ON TABLE user_affiliate_recharge_events IS '代理晋级累充事件去重表';

-- 回填已经计入历史累充的来源，避免上线后旧兑换记录被重复累计。
INSERT INTO user_affiliate_recharge_events (source_type, source_id, user_id, amount, created_at)
SELECT 'redeem_code', id, used_by, value, COALESCE(used_at, NOW())
FROM redeem_codes
WHERE status = 'used'
  AND used_by IS NOT NULL
  AND value > 0
  AND value <> 2
  AND type IN ('balance', 'admin_balance')
ON CONFLICT (source_type, source_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_affiliate_promotion_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_level SMALLINT NOT NULL,
    to_level SMALLINT NOT NULL,
    old_inviter_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
    new_inviter_id BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
    cumulative_recharge DECIMAL(20,8) NOT NULL,
    source_type VARCHAR(32) NOT NULL,
    source_id BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_affiliate_promotion_logs_user
    ON user_affiliate_promotion_logs(user_id, created_at DESC);

-- 首次上线按现有代理树与历史余额类兑换记录回填不归零累充。
WITH RECURSIVE subtree AS (
    SELECT ua.user_id AS ancestor_user_id,
           ua.user_id AS descendant_user_id,
           0 AS depth,
           ARRAY[ua.user_id]::bigint[] AS path
    FROM user_affiliates ua
    UNION ALL
    SELECT subtree.ancestor_user_id,
           child.user_id,
           subtree.depth + 1,
           subtree.path || child.user_id
    FROM subtree
    JOIN user_affiliates child ON child.inviter_id = subtree.descendant_user_id
    WHERE subtree.depth < 100
      AND NOT child.user_id = ANY(subtree.path)
), recharge_by_user AS (
    SELECT used_by AS user_id,
           SUM(value)::numeric AS total_recharged
    FROM redeem_codes
    WHERE status = 'used'
      AND value > 0
      AND value <> 2
      AND type IN ('balance', 'admin_balance')
    GROUP BY used_by
), totals AS (
    SELECT subtree.ancestor_user_id,
           COALESCE(SUM(recharge_by_user.total_recharged), 0)::numeric AS total_recharged
    FROM subtree
    LEFT JOIN recharge_by_user ON recharge_by_user.user_id = subtree.descendant_user_id
    GROUP BY subtree.ancestor_user_id
)
UPDATE user_affiliates ua
SET agent_cumulative_recharge = GREATEST(ua.agent_cumulative_recharge, totals.total_recharged),
    updated_at = NOW()
FROM totals
WHERE ua.user_id = totals.ancestor_user_id;

-- 历史累充可以一次跨越多个 500 元门槛，逐级重挂以保留每一次关系变更。
DO $$
DECLARE
    admin_id BIGINT;
    candidate RECORD;
    new_level INTEGER;
    new_inviter_id BIGINT;
BEGIN
    SELECT id INTO admin_id
    FROM users
    WHERE LOWER(email) = LOWER('17636470647@163.com')
      AND role = 'admin'
      AND deleted_at IS NULL
    LIMIT 1;

    IF admin_id IS NOT NULL THEN
        UPDATE user_affiliates
        SET agent_level = 1,
            agent_initial_level = 1,
            inviter_id = NULL,
            updated_at = NOW()
        WHERE user_id = admin_id;

    END IF;

    LOOP
        SELECT ua.user_id,
               ua.agent_level,
               ua.agent_initial_level,
               ua.inviter_id,
               ua.agent_cumulative_recharge
        INTO candidate
        FROM user_affiliates ua
        WHERE ua.user_id <> COALESCE(admin_id, 0)
          AND ua.agent_level > GREATEST(
              1,
              ua.agent_initial_level - FLOOR(ua.agent_cumulative_recharge / 500)::integer
          )
        ORDER BY ua.user_id
        LIMIT 1;

        EXIT WHEN NOT FOUND;

        new_level := candidate.agent_level - 1;

        IF new_level <= 1 THEN
            new_inviter_id := admin_id;
        ELSIF candidate.inviter_id IS NULL THEN
            new_inviter_id := NULL;
        ELSIF candidate.inviter_id = admin_id THEN
            new_inviter_id := admin_id;
        ELSE
            SELECT inviter_id INTO new_inviter_id
            FROM user_affiliates
            WHERE user_id = candidate.inviter_id;
            new_inviter_id := COALESCE(new_inviter_id, admin_id);
        END IF;

        UPDATE user_affiliates
        SET agent_level = new_level,
            inviter_id = new_inviter_id,
            updated_at = NOW()
        WHERE user_id = candidate.user_id;

        INSERT INTO user_affiliate_promotion_logs (
            user_id, from_level, to_level, old_inviter_id, new_inviter_id,
            cumulative_recharge, source_type, source_id, created_at
        ) VALUES (
            candidate.user_id, candidate.agent_level, new_level,
            candidate.inviter_id, new_inviter_id, candidate.agent_cumulative_recharge,
            'migration', 0, NOW()
        );
    END LOOP;
END $$;

-- 重挂完成后以实际直接下游关系重算发生变化的邀请人数。
WITH direct_counts AS (
    SELECT parent.user_id,
           COUNT(child.user_id)::integer AS aff_count
    FROM user_affiliates parent
    LEFT JOIN user_affiliates child ON child.inviter_id = parent.user_id
    GROUP BY parent.user_id
)
UPDATE user_affiliates ua
SET aff_count = direct_counts.aff_count,
    updated_at = NOW()
FROM direct_counts
WHERE ua.user_id = direct_counts.user_id
  AND ua.aff_count IS DISTINCT FROM direct_counts.aff_count;
