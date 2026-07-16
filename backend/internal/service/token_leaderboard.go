package service

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	infraerrors "github.com/Wei-Shaw/sub2api/internal/pkg/errors"
	"github.com/Wei-Shaw/sub2api/internal/pkg/logger"
)

const (
	TokenLeaderboardTimezone      = "Asia/Shanghai"
	TokenLeaderboardHistoryDays   = 30
	TokenLeaderboardExchangePoint = int64(100)
	TokenLeaderboardExchangeQuota = 1.0
)

var (
	ErrTokenLeaderboardDateInvalid = infraerrors.BadRequest("TOKEN_LEADERBOARD_DATE_INVALID", "排行榜日期无效")
	ErrTokenPointsInvalid          = infraerrors.BadRequest("TOKEN_POINTS_INVALID", "兑换积分必须是 100 的正整数倍")
	ErrTokenPointsInsufficient     = infraerrors.BadRequest("TOKEN_POINTS_INSUFFICIENT", "可用积分不足")
	ErrTokenLeaderboardDisabled    = infraerrors.ServiceUnavailable("TOKEN_LEADERBOARD_DISABLED", "Token 排行榜暂未启用")
)

type TokenLeaderboardEntry struct {
	Rank          int    `json:"rank"`
	UserID        int64  `json:"user_id"`
	AnonymousID   string `json:"anonymous_id"`
	TotalTokens   int64  `json:"total_tokens"`
	RewardPoints  int    `json:"reward_points"`
	IsCurrentUser bool   `json:"is_current_user"`
}

type TokenPointWallet struct {
	Points             int64   `json:"points"`
	ExchangeRatePoints int64   `json:"exchange_rate_points"`
	ExchangeRateQuota  float64 `json:"exchange_rate_quota"`
	ExchangeableQuota  int64   `json:"exchangeable_quota"`
	ExchangeablePoints int64   `json:"exchangeable_points"`
}

type TokenLeaderboardData struct {
	Date             string                  `json:"date"`
	Timezone         string                  `json:"timezone"`
	Realtime         bool                    `json:"realtime"`
	Settled          bool                    `json:"settled"`
	SettledAt        *time.Time              `json:"settled_at,omitempty"`
	NextSettlementAt time.Time               `json:"next_settlement_at"`
	Entries          []TokenLeaderboardEntry `json:"entries"`
	CurrentUser      *TokenLeaderboardEntry  `json:"current_user,omitempty"`
	Wallet           TokenPointWallet        `json:"wallet"`
	RewardRules      []int                   `json:"reward_rules"`
}

type TokenPointExchangeResult struct {
	SpentPoints int64   `json:"spent_points"`
	Quota       float64 `json:"quota"`
	Points      int64   `json:"points"`
	Balance     float64 `json:"balance"`
}

type TokenLeaderboardRepository interface {
	ListDaily(ctx context.Context, date time.Time, start, end time.Time, currentUserID int64) ([]TokenLeaderboardEntry, bool, *time.Time, int64, error)
	SettleDaily(ctx context.Context, date time.Time, start, end time.Time) error
	ExchangePoints(ctx context.Context, userID, points int64, quota float64) (remainingPoints int64, balance float64, err error)
}

type TokenLeaderboardService struct {
	repo                 TokenLeaderboardRepository
	authCacheInvalidator APIKeyAuthCacheInvalidator
	billingCacheService  *BillingCacheService
	now                  func() time.Time
	stop                 chan struct{}
	stopOnce             sync.Once
	enabled              bool
	anonymousSalt        string
}

func NewTokenLeaderboardService(
	repo TokenLeaderboardRepository,
	authCacheInvalidator APIKeyAuthCacheInvalidator,
	billingCacheService *BillingCacheService,
	enabled ...bool,
) *TokenLeaderboardService {
	isEnabled := true
	if len(enabled) > 0 {
		isEnabled = enabled[0]
	}
	anonymousSalt := tokenLeaderboardAnonymousSalt()
	if isEnabled && anonymousSalt == "" {
		isEnabled = false
		logger.LegacyPrintf("service.token_leaderboard", "未配置 TOKEN_LEADERBOARD_ANON_SALT 或 JWT_SECRET，排行榜保持关闭")
	}
	return &TokenLeaderboardService{
		repo:                 repo,
		authCacheInvalidator: authCacheInvalidator,
		billingCacheService:  billingCacheService,
		now:                  time.Now,
		stop:                 make(chan struct{}),
		enabled:              isEnabled,
		anonymousSalt:        anonymousSalt,
	}
}

func tokenLeaderboardAnonymousSalt() string {
	secret := strings.TrimSpace(os.Getenv("TOKEN_LEADERBOARD_ANON_SALT"))
	if secret == "" {
		secret = strings.TrimSpace(os.Getenv("JWT_SECRET"))
	}
	return secret
}

func tokenLeaderboardEnabledFromEnvironment() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("TOKEN_LEADERBOARD_ENABLED")), "true") && tokenLeaderboardAnonymousSalt() != ""
}

func (s *TokenLeaderboardService) Start() {
	if s == nil || !s.enabled {
		return
	}
	go s.runSettlementLoop()
}

func (s *TokenLeaderboardService) Stop() {
	s.stopOnce.Do(func() { close(s.stop) })
}

func (s *TokenLeaderboardService) Get(ctx context.Context, userID int64, dateText string) (*TokenLeaderboardData, error) {
	if s != nil && !s.enabled {
		return nil, ErrTokenLeaderboardDisabled
	}
	if s == nil || s.repo == nil {
		return nil, infraerrors.ServiceUnavailable("SERVICE_UNAVAILABLE", "排行榜服务不可用")
	}

	now := s.now().In(tokenLeaderboardLocation())
	date, err := parseTokenLeaderboardDate(dateText, now)
	if err != nil {
		return nil, err
	}
	if err := s.settleYesterdayIfDue(ctx, now); err != nil {
		logger.LegacyPrintf("service.token_leaderboard", "排行榜补偿结算失败: %v", err)
	}
	return s.getForDate(ctx, userID, date, now, false)
}

// GetRealtime 返回上海时区当天的实时排名，仅供展示，不触发结算或积分发放。
func (s *TokenLeaderboardService) GetRealtime(ctx context.Context, userID int64) (*TokenLeaderboardData, error) {
	if s != nil && !s.enabled {
		return nil, ErrTokenLeaderboardDisabled
	}
	if s == nil || s.repo == nil {
		return nil, infraerrors.ServiceUnavailable("SERVICE_UNAVAILABLE", "排行榜服务不可用")
	}

	now := s.now().In(tokenLeaderboardLocation())
	if err := s.settleYesterdayIfDue(ctx, now); err != nil {
		logger.LegacyPrintf("service.token_leaderboard", "排行榜补偿结算失败: %v", err)
	}
	date := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, tokenLeaderboardLocation())
	return s.getForDate(ctx, userID, date, now, true)
}

func (s *TokenLeaderboardService) getForDate(ctx context.Context, userID int64, date, now time.Time, realtime bool) (*TokenLeaderboardData, error) {
	start := date.In(tokenLeaderboardLocation()).UTC()
	end := date.AddDate(0, 0, 1).In(tokenLeaderboardLocation()).UTC()
	entries, settled, settledAt, points, err := s.repo.ListDaily(ctx, date, start, end, userID)
	if err != nil {
		return nil, fmt.Errorf("查询 Token 排行榜: %w", err)
	}

	var currentUser *TokenLeaderboardEntry
	for i := range entries {
		entries[i].RewardPoints = rewardPointsForRank(entries[i].Rank)
		entries[i].AnonymousID = tokenLeaderboardAnonymousID(entries[i].UserID, s.anonymousSalt)
		entries[i].IsCurrentUser = entries[i].UserID == userID
		if entries[i].IsCurrentUser {
			item := entries[i]
			currentUser = &item
		}
	}

	exchangeablePoints := points / TokenLeaderboardExchangePoint * TokenLeaderboardExchangePoint
	return &TokenLeaderboardData{
		Date:             date.Format("2006-01-02"),
		Timezone:         TokenLeaderboardTimezone,
		Realtime:         realtime,
		Settled:          settled,
		SettledAt:        settledAt,
		NextSettlementAt: nextTokenLeaderboardSettlement(now),
		Entries:          entries,
		CurrentUser:      currentUser,
		Wallet: TokenPointWallet{
			Points:             points,
			ExchangeRatePoints: TokenLeaderboardExchangePoint,
			ExchangeRateQuota:  TokenLeaderboardExchangeQuota,
			ExchangeableQuota:  exchangeablePoints / TokenLeaderboardExchangePoint,
			ExchangeablePoints: exchangeablePoints,
		},
		RewardRules: []int{20, 10, 5},
	}, nil
}

func tokenLeaderboardAnonymousID(userID int64, secret string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(strconv.FormatInt(userID, 10)))
	return fmt.Sprintf("%x", mac.Sum(nil)[:4])
}

func (s *TokenLeaderboardService) Exchange(ctx context.Context, userID, points int64) (*TokenPointExchangeResult, error) {
	if s != nil && !s.enabled {
		return nil, ErrTokenLeaderboardDisabled
	}
	if s == nil || s.repo == nil {
		return nil, infraerrors.ServiceUnavailable("SERVICE_UNAVAILABLE", "排行榜服务不可用")
	}
	if points <= 0 || points%TokenLeaderboardExchangePoint != 0 {
		return nil, ErrTokenPointsInvalid
	}

	quota := float64(points) / float64(TokenLeaderboardExchangePoint) * TokenLeaderboardExchangeQuota
	remaining, balance, err := s.repo.ExchangePoints(ctx, userID, points, quota)
	if err != nil {
		if errors.Is(err, ErrTokenPointsInsufficient) {
			return nil, ErrTokenPointsInsufficient
		}
		return nil, fmt.Errorf("兑换排行榜积分: %w", err)
	}

	if s.authCacheInvalidator != nil {
		s.authCacheInvalidator.InvalidateAuthCacheByUserID(ctx, userID)
	}
	if s.billingCacheService != nil {
		if err := s.billingCacheService.InvalidateUserBalance(ctx, userID); err != nil {
			logger.LegacyPrintf("service.token_leaderboard", "清理用户余额缓存失败 user_id=%d: %v", userID, err)
		}
	}

	return &TokenPointExchangeResult{
		SpentPoints: points,
		Quota:       quota,
		Points:      remaining,
		Balance:     balance,
	}, nil
}

func (s *TokenLeaderboardService) runSettlementLoop() {
	for {
		now := s.now().In(tokenLeaderboardLocation())
		if err := s.settleYesterdayIfDue(context.Background(), now); err != nil {
			logger.LegacyPrintf("service.token_leaderboard", "Token 排行榜每日结算失败: %v", err)
		}
		delay := time.Until(nextTokenLeaderboardSettlement(now))
		if delay <= 0 {
			delay = time.Minute
		}
		timer := time.NewTimer(delay)
		select {
		case <-timer.C:
		case <-s.stop:
			if !timer.Stop() {
				<-timer.C
			}
			return
		}
	}
}

func (s *TokenLeaderboardService) settleYesterdayIfDue(ctx context.Context, now time.Time) error {
	todaySettlement := time.Date(now.Year(), now.Month(), now.Day(), 0, 5, 0, 0, tokenLeaderboardLocation())
	if now.Before(todaySettlement) {
		return nil
	}
	date := time.Date(now.Year(), now.Month(), now.Day()-1, 0, 0, 0, 0, tokenLeaderboardLocation())
	return s.repo.SettleDaily(ctx, date, date.UTC(), date.AddDate(0, 0, 1).UTC())
}

func parseTokenLeaderboardDate(dateText string, now time.Time) (time.Time, error) {
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, tokenLeaderboardLocation())
	latest := today.AddDate(0, 0, -1)
	date := latest
	var err error
	if dateText != "" {
		date, err = time.ParseInLocation("2006-01-02", dateText, tokenLeaderboardLocation())
		if err != nil {
			return time.Time{}, ErrTokenLeaderboardDateInvalid
		}
	}
	earliest := latest.AddDate(0, 0, -(TokenLeaderboardHistoryDays - 1))
	if date.Before(earliest) || date.After(latest) {
		return time.Time{}, ErrTokenLeaderboardDateInvalid
	}
	return date, nil
}

func rewardPointsForRank(rank int) int {
	switch rank {
	case 1:
		return 20
	case 2:
		return 10
	case 3:
		return 5
	default:
		return 0
	}
}

func nextTokenLeaderboardSettlement(now time.Time) time.Time {
	next := time.Date(now.Year(), now.Month(), now.Day(), 0, 5, 0, 0, tokenLeaderboardLocation())
	if !now.Before(next) {
		next = next.AddDate(0, 0, 1)
	}
	return next
}

func tokenLeaderboardLocation() *time.Location {
	return time.FixedZone(TokenLeaderboardTimezone, 8*60*60)
}
