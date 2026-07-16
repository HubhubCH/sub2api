package service

import (
	"context"
	"encoding/json"
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

func TestTokenLeaderboardEntryExposesNumericUserID(t *testing.T) {
	payload, err := json.Marshal(TokenLeaderboardEntry{UserID: 42, AnonymousID: "anonymous"})
	require.NoError(t, err)
	require.JSONEq(t, `{"rank":0,"user_id":42,"anonymous_id":"anonymous","total_tokens":0,"reward_points":0,"is_current_user":false}`, string(payload))
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

type tokenLeaderboardRealtimeRepoStub struct {
	date  time.Time
	start time.Time
	end   time.Time
}

func (r *tokenLeaderboardRealtimeRepoStub) ListDaily(_ context.Context, date, start, end time.Time, currentUserID int64) ([]TokenLeaderboardEntry, bool, *time.Time, int64, error) {
	r.date = date
	r.start = start
	r.end = end
	return []TokenLeaderboardEntry{{Rank: 1, UserID: currentUserID, TotalTokens: 123}}, false, nil, 0, nil
}

func (r *tokenLeaderboardRealtimeRepoStub) SettleDaily(context.Context, time.Time, time.Time, time.Time) error {
	return nil
}

func (r *tokenLeaderboardRealtimeRepoStub) ExchangePoints(context.Context, int64, int64, float64) (int64, float64, error) {
	return 0, 0, nil
}

func TestTokenLeaderboardRealtimeUsesShanghaiTodayWithoutSettlement(t *testing.T) {
	t.Setenv("TOKEN_LEADERBOARD_ANON_SALT", "realtime-test-salt")
	repo := &tokenLeaderboardRealtimeRepoStub{}
	svc := NewTokenLeaderboardService(repo, nil, nil, true)
	svc.now = func() time.Time {
		return time.Date(2026, 7, 15, 12, 30, 0, 0, tokenLeaderboardLocation())
	}

	data, err := svc.GetRealtime(context.Background(), 42)
	require.NoError(t, err)
	require.True(t, data.Realtime)
	require.False(t, data.Settled)
	require.Equal(t, "2026-07-15", data.Date)
	require.Equal(t, "2026-07-14 16:00", repo.start.Format("2006-01-02 15:04"))
	require.Equal(t, "2026-07-15 16:00", repo.end.Format("2006-01-02 15:04"))
	require.Equal(t, 20, data.CurrentUser.RewardPoints)
}
