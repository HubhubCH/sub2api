//go:build unit

package service

import (
	"context"
	"math"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestResolveRebateRatePercent_PerUserOverride verifies that per-inviter
// AffRebateRatePercent overrides the global rate, that NULL falls back to the
// global rate, and that out-of-range exclusive rates are clamped silently.
//
// SettingService is left nil here so globalRebateRatePercent returns the
// documented default (AffiliateRebateRateDefault = 20%) — this exercises the
// fallback path without spinning up a settings stub.
func TestResolveRebateRatePercent_PerUserOverride(t *testing.T) {
	t.Parallel()
	svc := &AffiliateService{}

	// nil exclusive rate → falls back to global default (20%)
	require.InDelta(t, AffiliateRebateRateDefault,
		svc.resolveRebateRatePercent(context.Background(), &AffiliateSummary{}), 1e-9)

	// exclusive rate set → overrides global
	rate := 50.0
	require.InDelta(t, 50.0,
		svc.resolveRebateRatePercent(context.Background(), &AffiliateSummary{AffRebateRatePercent: &rate}), 1e-9)

	// exclusive rate 0 → returns 0 (no rebate, intentional)
	zero := 0.0
	require.InDelta(t, 0.0,
		svc.resolveRebateRatePercent(context.Background(), &AffiliateSummary{AffRebateRatePercent: &zero}), 1e-9)

	// exclusive rate above max → clamped to Max
	tooHigh := 250.0
	require.InDelta(t, AffiliateRebateRateMax,
		svc.resolveRebateRatePercent(context.Background(), &AffiliateSummary{AffRebateRatePercent: &tooHigh}), 1e-9)

	// exclusive rate below min → clamped to Min
	tooLow := -5.0
	require.InDelta(t, AffiliateRebateRateMin,
		svc.resolveRebateRatePercent(context.Background(), &AffiliateSummary{AffRebateRatePercent: &tooLow}), 1e-9)
}

// TestIsEnabled_NilSettingServiceReturnsDefault verifies that IsEnabled
// safely handles a nil settingService dependency by returning the default
// (off). This protects callers from nil-pointer crashes in misconfigured
// environments.
func TestIsEnabled_NilSettingServiceReturnsDefault(t *testing.T) {
	t.Parallel()
	svc := &AffiliateService{}
	require.False(t, svc.IsEnabled(context.Background()))
	require.Equal(t, AffiliateEnabledDefault, svc.IsEnabled(context.Background()))
}

// TestValidateExclusiveRate_BoundaryAndInvalid covers the validator used by
// admin-facing rate setters: nil is always valid (clear), in-range values
// are accepted, NaN/Inf and out-of-range values produce a typed BadRequest.
func TestValidateExclusiveRate_BoundaryAndInvalid(t *testing.T) {
	t.Parallel()
	require.NoError(t, validateExclusiveRate(nil))

	for _, v := range []float64{0, 0.01, 50, 99.99, 100} {
		v := v
		require.NoError(t, validateExclusiveRate(&v), "value %v should be valid", v)
	}

	for _, v := range []float64{-0.01, 100.01, -100, 200} {
		v := v
		require.Error(t, validateExclusiveRate(&v), "value %v should be rejected", v)
	}

	nan := math.NaN()
	require.Error(t, validateExclusiveRate(&nan))
	posInf := math.Inf(1)
	require.Error(t, validateExclusiveRate(&posInf))
	negInf := math.Inf(-1)
	require.Error(t, validateExclusiveRate(&negInf))
}

func TestMaskEmail(t *testing.T) {
	t.Parallel()
	require.Equal(t, "a***@g***.com", maskEmail("alice@gmail.com"))
	require.Equal(t, "x***@d***", maskEmail("x@domain"))
	require.Equal(t, "", maskEmail(""))
}

func TestIsValidAffiliateCodeFormat(t *testing.T) {
	t.Parallel()

	// 邀请码格式校验同时服务于：
	// 1) 系统自动生成的 12 位随机码（A-Z 去 I/O，2-9 去 0/1）
	// 2) 管理员设置的自定义专属码（如 "VIP2026"、"NEW_USER-1"）
	// 因此校验放宽到 [A-Z0-9_-]{4,32}（要求调用方先 ToUpper）。
	cases := []struct {
		name string
		in   string
		want bool
	}{
		{"valid canonical 12-char", "ABCDEFGHJKLM", true},
		{"valid all digits 2-9", "234567892345", true},
		{"valid mixed", "A2B3C4D5E6F7", true},
		{"valid admin custom short", "VIP1", true},
		{"valid admin custom with hyphen", "NEW-USER", true},
		{"valid admin custom with underscore", "VIP_2026", true},
		{"valid 32-char max", "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345", true},
		// Previously-excluded chars (I/O/0/1) are now allowed since admins may use them.
		{"letter I now allowed", "IBCDEFGHJKLM", true},
		{"letter O now allowed", "OBCDEFGHJKLM", true},
		{"digit 0 now allowed", "0BCDEFGHJKLM", true},
		{"digit 1 now allowed", "1BCDEFGHJKLM", true},
		{"too short (3 chars)", "ABC", false},
		{"too long (33 chars)", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456", false},
		{"lowercase rejected (caller must ToUpper first)", "abcdefghjklm", false},
		{"empty", "", false},
		{"utf8 non-ascii", "ÄÄÄÄÄÄ", false}, // bytes out of charset
		{"ascii punctuation .", "ABCDEFGHJK.M", false},
		{"whitespace", "ABCDEFGHJK M", false},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			require.Equal(t, tc.want, isValidAffiliateCodeFormat(tc.in))
		})
	}
}

func TestAffiliateAgentLevelForCumulativeRechargeDoesNotReset(t *testing.T) {
	t.Parallel()

	tests := []struct {
		initialLevel int
		total        float64
		level        int
	}{
		{initialLevel: 5, total: 0, level: 5},
		{initialLevel: 5, total: 499.99, level: 5},
		{initialLevel: 5, total: 500, level: 4},
		{initialLevel: 5, total: 999.99, level: 4},
		{initialLevel: 5, total: 1000, level: 3},
		{initialLevel: 5, total: 1500, level: 2},
		{initialLevel: 5, total: 2000, level: 1},
		{initialLevel: 5, total: 2500, level: 1},
		{initialLevel: 7, total: 0, level: 7},
		{initialLevel: 7, total: 500, level: 6},
		{initialLevel: 7, total: 2500, level: 2},
		{initialLevel: 7, total: 3000, level: 1},
		{initialLevel: 7, total: 5000, level: 1},
		{initialLevel: 8, total: 3500, level: 1},
		{initialLevel: 9, total: 4000, level: 1},
		{initialLevel: 10, total: 0, level: 10},
		{initialLevel: 10, total: 500, level: 9},
		{initialLevel: 10, total: 4499.99, level: 2},
		{initialLevel: 10, total: 4500, level: 1},
		{initialLevel: 10, total: 10000, level: 1},
		{initialLevel: 1, total: 500, level: 1},
	}
	for _, tt := range tests {
		require.Equal(t, tt.level, AffiliateAgentLevelForCumulativeRecharge(tt.initialLevel, tt.total))
	}
}

func TestAffiliateInviteeInitialLevel(t *testing.T) {
	t.Parallel()

	require.Equal(t, 1, AffiliateInviteeInitialLevel(0, true))
	require.Equal(t, 1, AffiliateInviteeInitialLevel(7, true))
	require.Equal(t, 10, AffiliateInviteeInitialLevel(0, false))
	require.Equal(t, 2, AffiliateInviteeInitialLevel(1, false))
	require.Equal(t, 8, AffiliateInviteeInitialLevel(7, false))
	require.Equal(t, 10, AffiliateInviteeInitialLevel(9, false))
	require.Equal(t, 10, AffiliateInviteeInitialLevel(10, false))
}

func TestAffiliateSignupBonusRedeemAmount(t *testing.T) {
	t.Parallel()

	require.True(t, isAffiliateSignupBonusRedeemAmount(2))
	require.True(t, isAffiliateSignupBonusRedeemAmount(2.000000001))
	require.False(t, isAffiliateSignupBonusRedeemAmount(1.99))
	require.False(t, isAffiliateSignupBonusRedeemAmount(2.01))
}
