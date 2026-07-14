package service

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestTokenLeaderboardRewardPoints(t *testing.T) {
	require.Equal(t, 20, rewardPointsForRank(1))
	require.Equal(t, 10, rewardPointsForRank(2))
	require.Equal(t, 5, rewardPointsForRank(3))
	require.Zero(t, rewardPointsForRank(4))
}

func TestTokenLeaderboardDisabledHasNoFinancialSideEffects(t *testing.T) {
	svc := NewTokenLeaderboardService(nil, nil, nil, false)
	svc.Start()

	_, err := svc.Get(context.Background(), 1, "")
	require.ErrorIs(t, err, ErrTokenLeaderboardDisabled)
	_, err = svc.Exchange(context.Background(), 1, 100)
	require.ErrorIs(t, err, ErrTokenLeaderboardDisabled)
}

func TestTokenLeaderboardRequiresPrivateAnonymousSalt(t *testing.T) {
	t.Setenv("TOKEN_LEADERBOARD_ANON_SALT", "")
	t.Setenv("JWT_SECRET", "")
	svc := NewTokenLeaderboardService(nil, nil, nil, true)

	_, err := svc.Get(context.Background(), 1, "")
	require.ErrorIs(t, err, ErrTokenLeaderboardDisabled)
}

func TestTokenLeaderboardAnonymousIDUsesPrivateSalt(t *testing.T) {
	first := tokenLeaderboardAnonymousID(42, "private-salt-one")
	second := tokenLeaderboardAnonymousID(42, "private-salt-two")

	require.Len(t, first, 8)
	require.NotEqual(t, first, second)
}

func TestParseTokenLeaderboardDateLimitsToThirtyDays(t *testing.T) {
	now := time.Date(2026, 7, 14, 12, 0, 0, 0, tokenLeaderboardLocation())

	date, err := parseTokenLeaderboardDate("", now)
	require.NoError(t, err)
	require.Equal(t, "2026-07-13", date.Format("2006-01-02"))

	_, err = parseTokenLeaderboardDate("2026-06-13", now)
	require.ErrorIs(t, err, ErrTokenLeaderboardDateInvalid)

	_, err = parseTokenLeaderboardDate("2026-07-14", now)
	require.ErrorIs(t, err, ErrTokenLeaderboardDateInvalid)
}

func TestNextTokenLeaderboardSettlement(t *testing.T) {
	before := time.Date(2026, 7, 14, 0, 4, 0, 0, tokenLeaderboardLocation())
	after := time.Date(2026, 7, 14, 0, 6, 0, 0, tokenLeaderboardLocation())

	require.Equal(t, "2026-07-14 00:05", nextTokenLeaderboardSettlement(before).Format("2006-01-02 15:04"))
	require.Equal(t, "2026-07-15 00:05", nextTokenLeaderboardSettlement(after).Format("2006-01-02 15:04"))
}
