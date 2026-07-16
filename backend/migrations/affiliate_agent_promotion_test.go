package migrations

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestAffiliateAgentPromotionMigrationPersistsCumulativeProgress(t *testing.T) {
	content, err := FS.ReadFile("178_affiliate_agent_promotion.sql")
	require.NoError(t, err)
	sql := string(content)

	require.Contains(t, sql, "agent_level SMALLINT NOT NULL DEFAULT 10")
	require.Contains(t, sql, "agent_initial_level SMALLINT NOT NULL DEFAULT 10")
	require.Contains(t, sql, "agent_cumulative_recharge DECIMAL(20,8) NOT NULL DEFAULT 0")
	require.Contains(t, sql, "UNIQUE(source_type, source_id)")
	require.Contains(t, sql, "SELECT 'redeem_code', id, used_by, value")
	require.NotContains(t, sql, "SELECT 'payment_order'")
	require.Equal(t, 2, strings.Count(sql, "AND value <> 2"))
	require.Contains(t, sql, "agent_initial_level - FLOOR(ua.agent_cumulative_recharge / 500)")
	require.Contains(t, sql, "new_level := candidate.agent_level - 1")
	require.Contains(t, sql, "ELSIF candidate.inviter_id IS NULL THEN")
	require.Contains(t, sql, "new_inviter_id := NULL")
	require.Contains(t, sql, "hierarchy.agent_level + 1")
	require.NotContains(t, sql, "旧邀请树中已有下游的一级代理")
	require.Equal(t, 1, strings.Count(sql, "ADD COLUMN IF NOT EXISTS agent_cumulative_recharge"))
	require.Equal(t, 1, strings.Count(sql, "ADD COLUMN IF NOT EXISTS agent_initial_level"))
}
