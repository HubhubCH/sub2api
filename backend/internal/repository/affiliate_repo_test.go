package repository

import (
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestAffiliateUserOverviewSQLIncludesMaturedFrozenQuota(t *testing.T) {
	query := strings.Join(strings.Fields(affiliateUserOverviewSQL), " ")

	require.Contains(t, query, "ua.aff_quota + COALESCE(matured.matured_frozen_quota, 0)")
	require.Contains(t, query, "frozen_until <= NOW()")
}

func TestAffiliateRecordQueriesUseLedgerAuditFields(t *testing.T) {
	source, err := os.ReadFile("affiliate_repo.go")
	require.NoError(t, err)
	content := string(source)

	require.Contains(t, content, "JOIN payment_orders po ON po.id = ual.source_order_id")
	require.Contains(t, content, "ual.amount::double precision")
	require.Contains(t, content, "ual.balance_after::double precision")
	require.NotContains(t, content, "parseAffiliateRebateAmount")
	require.NotContains(t, content, `"current_balance": "u.balance"`)
}

func TestAffiliateSupervisorQueryShowsDirectAndUnownedRootsWithPersistedCumulativeTotal(t *testing.T) {
	source, err := os.ReadFile("affiliate_repo.go")
	require.NoError(t, err)
	content := string(source)

	require.Contains(t, content, "ua.inviter_id = $1")
	require.Contains(t, content, "$3 AND ua.user_id <> $1 AND ua.inviter_id IS NULL")
	require.Contains(t, content, "agent_cumulative_recharge")
	require.Contains(t, content, "subtree_total_recharged")
	require.GreaterOrEqual(t, strings.Count(content, "AND value <> 2"), 2)
	require.Contains(t, content, "if item.Value != 2")
	require.Contains(t, content, "LIMIT NULLIF($2, 0)")
}

func TestRechargeTotalsExcludeSignupBonusAmount(t *testing.T) {
	source, err := os.ReadFile("redeem_code_repo.go")
	require.NoError(t, err)
	require.Contains(t, string(source), "redeemcode.ValueNEQ(2)")
}

func TestAffiliatePromotionQueryIsIdempotentAndKeepsDownstreamEdges(t *testing.T) {
	source, err := os.ReadFile("affiliate_repo.go")
	require.NoError(t, err)
	content := string(source)

	require.Contains(t, content, "ON CONFLICT (source_type, source_id) DO NOTHING")
	require.Contains(t, content, "agent_cumulative_recharge = ua.agent_cumulative_recharge + $2")
	require.Contains(t, content, "ua.agent_initial_level")
	require.Contains(t, content, "SET agent_level = $2, inviter_id = $3")
	require.Contains(t, content, "if oldInviterID == nil")
	require.Contains(t, content, "return nil, nil")
	require.Contains(t, content, "aff_count = GREATEST(aff_count - 1, 0)")
	require.Contains(t, content, "aff_count = aff_count + 1")
	require.NotContains(t, content, "SET inviter_id = $3 WHERE inviter_id")
}

func TestAffiliateBindingStartsFromInviterCurrentLevel(t *testing.T) {
	source, err := os.ReadFile("affiliate_repo.go")
	require.NoError(t, err)
	content := string(source)

	require.Contains(t, content, "agent_level = $3")
	require.Contains(t, content, "agent_initial_level = $3 + FLOOR(agent_cumulative_recharge / $4)")
	require.Contains(t, content, "queryAffiliateSupervisorMatch")
	require.Contains(t, content, "AffiliateInviteeInitialLevel(inviter.AgentLevel, inviterIsSupervisor)")
}
