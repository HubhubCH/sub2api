<template>
  <AppLayout>
    <div class="leaderboard-page">
      <section class="leaderboard-hero card">
        <div class="leaderboard-hero-main">
          <span class="activity-badge">
            <Icon name="sparkles" size="xs" />
            {{ t('tokenLeaderboard.dailyActivity') }}
          </span>
          <h1>{{ t('tokenLeaderboard.title') }}</h1>
          <p>{{ t('tokenLeaderboard.description') }}</p>

          <div class="settlement-grid">
            <div class="settlement-item">
              <span>{{ t('tokenLeaderboard.lastSettlement') }}</span>
              <strong>{{ lastSettlementText }}</strong>
            </div>
            <div class="settlement-item">
              <span>{{ t('tokenLeaderboard.nextSettlement') }}</span>
              <strong>{{ formatDateTime(data?.next_settlement_at) }}</strong>
            </div>
          </div>

          <div class="hero-actions">
            <label class="date-control">
              <Icon name="calendar" size="sm" />
              <span>{{ t('tokenLeaderboard.statDate') }}</span>
              <input v-model="selectedDate" type="date" :min="minDate" :max="maxDate" @change="loadData()" />
            </label>
            <button class="btn btn-secondary" :disabled="loading" @click="loadData()">
              <Icon name="refresh" size="sm" :class="{ 'animate-spin': loading }" />
              <span>{{ t('common.refresh') }}</span>
            </button>
          </div>
        </div>

        <div class="my-rank-panel">
          <div class="my-rank-head">
            <div>
              <span>{{ t('tokenLeaderboard.myRank') }}</span>
              <strong>{{ data?.current_user ? `#${data.current_user.rank}` : t('tokenLeaderboard.unranked') }}</strong>
            </div>
            <div class="rank-seal"><Icon name="badge" size="lg" /></div>
          </div>
          <div class="my-rank-stats">
            <div>
              <span>{{ t('tokenLeaderboard.myTokens') }}</span>
              <strong>{{ data?.current_user ? formatTokens(data.current_user.total_tokens) : '-' }}</strong>
            </div>
            <div>
              <span>{{ t('tokenLeaderboard.myReward') }}</span>
              <strong>{{ data?.current_user?.reward_points ? `+${data.current_user.reward_points}` : '-' }}</strong>
            </div>
          </div>
        </div>
      </section>

      <div v-if="loading && !data" class="loading-state card">
        <span class="loading-spinner"></span>
      </div>

      <div v-else class="leaderboard-content">
        <section class="ranking-section card">
          <div class="section-heading">
            <div>
              <h2>{{ t('tokenLeaderboard.dailyRanking') }}</h2>
              <p>{{ t('tokenLeaderboard.historyLimit') }}</p>
            </div>
            <span class="settled-badge" :class="data?.settled ? 'is-settled' : 'is-pending'">
              {{ data?.settled ? t('tokenLeaderboard.settled') : t('tokenLeaderboard.pending') }}
            </span>
          </div>

          <div v-if="topThree.length" class="podium-grid">
            <article v-for="entry in topThree" :key="entry.anonymous_id" class="podium-card" :class="`rank-${entry.rank}`">
              <span class="podium-rank">#{{ entry.rank }}</span>
              <p>{{ userLabel(entry) }}</p>
              <strong>{{ formatTokens(entry.total_tokens) }}</strong>
              <small>{{ t('tokenLeaderboard.totalConsumed', { tokens: formatTokens(entry.total_tokens) }) }}</small>
              <span class="podium-reward">+{{ entry.reward_points }} {{ t('tokenLeaderboard.points') }}</span>
            </article>
          </div>

          <div v-if="remainingEntries.length" class="ranking-list">
            <div v-for="entry in remainingEntries" :key="entry.anonymous_id" class="ranking-row" :class="{ 'is-me': entry.is_current_user }">
              <span class="row-rank">{{ entry.rank }}</span>
              <div class="row-user">
                <strong>{{ userLabel(entry) }}</strong>
                <span>{{ t('tokenLeaderboard.totalConsumed', { tokens: formatTokens(entry.total_tokens) }) }}</span>
              </div>
              <div class="row-token">{{ formatTokens(entry.total_tokens) }}</div>
              <div class="row-reward">
                <span>{{ t('tokenLeaderboard.reward') }}</span>
                <strong v-if="entry.reward_points">+{{ entry.reward_points }} {{ t('tokenLeaderboard.points') }}</strong>
                <strong v-else>-</strong>
              </div>
            </div>
          </div>
          <div v-if="!data?.entries.length" class="empty-state">
            <Icon name="chart" size="xl" />
            <p>{{ t('tokenLeaderboard.empty') }}</p>
          </div>
        </section>

        <aside class="leaderboard-side">
          <section class="wallet-card card">
            <div class="side-title">
              <div>
                <h2>{{ t('tokenLeaderboard.wallet') }}</h2>
                <p>{{ t('tokenLeaderboard.walletDescription') }}</p>
              </div>
              <span><Icon name="gift" size="lg" /></span>
            </div>
            <div class="wallet-balance">
              <span>{{ t('tokenLeaderboard.availablePoints') }}</span>
              <strong>{{ data?.wallet.points ?? 0 }}</strong>
              <small>{{ t('tokenLeaderboard.exchangeRate') }}</small>
            </div>
            <button class="wallet-exchange" :disabled="!canExchange || exchanging" @click="exchangePoints">
              <Icon name="swap" size="sm" :class="{ 'animate-spin': exchanging }" />
              <span>{{ exchangeButtonText }}</span>
            </button>
          </section>

          <section class="rules-card card">
            <h2>{{ t('tokenLeaderboard.rewardRules') }}</h2>
            <div class="rule-list">
              <div v-for="(points, index) in data?.reward_rules ?? [20, 10, 5]" :key="index">
                <span>{{ t('tokenLeaderboard.rankRule', { rank: index + 1 }) }}</span>
                <strong>{{ points }} {{ t('tokenLeaderboard.points') }}</strong>
              </div>
            </div>
          </section>
        </aside>
      </div>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppLayout from '@/components/layout/AppLayout.vue'
import Icon from '@/components/icons/Icon.vue'
import tokenLeaderboardAPI from '@/api/tokenLeaderboard'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { extractApiErrorMessage } from '@/utils/apiError'
import type { TokenLeaderboardData, TokenLeaderboardEntry } from '@/types'

const { t } = useI18n()
const appStore = useAppStore()
const authStore = useAuthStore()
const data = ref<TokenLeaderboardData | null>(null)
const loading = ref(false)
const exchanging = ref(false)

function shanghaiDate(offsetDays: number): string {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000)
  now.setUTCDate(now.getUTCDate() + offsetDays)
  return now.toISOString().slice(0, 10)
}

const maxDate = shanghaiDate(-1)
const minDate = shanghaiDate(-30)
const selectedDate = ref(maxDate)
const topThree = computed(() => (data.value?.entries ?? []).filter((item) => item.rank <= 3))
const remainingEntries = computed(() => (data.value?.entries ?? []).filter((item) => item.rank > 3))
const canExchange = computed(() => (data.value?.wallet.exchangeable_points ?? 0) >= 100)
const exchangeButtonText = computed(() => {
  if (exchanging.value) return t('tokenLeaderboard.exchanging')
  const quota = data.value?.wallet.exchangeable_quota ?? 0
  return quota > 0
    ? t('tokenLeaderboard.exchangeQuota', { quota })
    : t('tokenLeaderboard.exchangeDisabled')
})
const lastSettlementText = computed(() => {
  if (!data.value?.settled_at) return t('tokenLeaderboard.notSettled')
  return formatDateTime(data.value.settled_at)
})

function formatTokens(value: number): string {
  if (value >= 100_000_000) return `${stripZero(value / 100_000_000)}亿 Tokens`
  if (value >= 10_000) return `${stripZero(value / 10_000)}万 Tokens`
  return `${new Intl.NumberFormat().format(value)} Tokens`
}

function stripZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '')
}

function formatDateTime(value?: string): string {
  if (!value) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function userLabel(entry: TokenLeaderboardEntry): string {
  return entry.is_current_user
    ? t('tokenLeaderboard.me', { id: entry.anonymous_id })
    : t('tokenLeaderboard.user', { id: entry.anonymous_id })
}

async function loadData(): Promise<void> {
  loading.value = true
  try {
    data.value = await tokenLeaderboardAPI.get(selectedDate.value)
  } catch (error) {
    appStore.showError(extractApiErrorMessage(error, t('tokenLeaderboard.loadFailed')))
  } finally {
    loading.value = false
  }
}

async function exchangePoints(): Promise<void> {
  const points = data.value?.wallet.exchangeable_points ?? 0
  if (points < 100 || exchanging.value) return
  exchanging.value = true
  try {
    const result = await tokenLeaderboardAPI.exchange(points)
    appStore.showSuccess(t('tokenLeaderboard.exchangeSuccess', { points: result.spent_points, quota: result.quota }))
    await Promise.all([loadData(), authStore.refreshUser().catch(() => undefined)])
  } catch (error) {
    appStore.showError(extractApiErrorMessage(error, t('tokenLeaderboard.exchangeFailed')))
  } finally {
    exchanging.value = false
  }
}

onMounted(() => {
  void loadData()
})
</script>

<style scoped>
.leaderboard-page { display: flex; flex-direction: column; gap: 18px; max-width: 1240px; margin: 0 auto; }
.leaderboard-hero { display: grid; grid-template-columns: minmax(0, 1fr) 330px; gap: 28px; padding: 24px; }
.leaderboard-hero h1 { margin-top: 10px; color: rgb(17 24 39); font-size: 28px; font-weight: 800; line-height: 1.2; }
.leaderboard-hero-main > p { margin-top: 6px; color: rgb(107 114 128); font-size: 14px; }
.activity-badge { display: inline-flex; align-items: center; gap: 6px; padding: 5px 9px; color: rgb(79 70 229); border: 1px solid rgb(199 210 254); border-radius: 999px; background: rgb(238 242 255); font-size: 12px; font-weight: 700; }
.settlement-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 18px; }
.settlement-item { padding: 10px 12px; border: 1px solid rgb(229 231 235); border-radius: 7px; background: rgb(249 250 251); }
.settlement-item span, .my-rank-head span, .my-rank-stats span { display: block; color: rgb(107 114 128); font-size: 12px; }
.settlement-item strong { display: block; margin-top: 3px; color: rgb(31 41 55); font-size: 13px; }
.hero-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
.date-control { display: flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 10px; color: rgb(75 85 99); border: 1px solid rgb(229 231 235); border-radius: 7px; background: white; font-size: 13px; }
.date-control input { min-width: 124px; color: rgb(31 41 55); background: transparent; outline: none; }
.my-rank-panel { padding: 20px; border: 1px solid rgb(253 230 138); border-radius: 8px; background: rgb(255 251 235); }
.my-rank-head { display: flex; align-items: flex-start; justify-content: space-between; }
.my-rank-head > div > span { color: rgb(180 83 9); }
.my-rank-head strong { display: block; margin-top: 4px; color: rgb(17 24 39); font-size: 28px; }
.rank-seal { display: flex; width: 46px; height: 46px; align-items: center; justify-content: center; color: rgb(245 158 11); border: 1px solid rgb(254 243 199); border-radius: 8px; background: white; box-shadow: 0 4px 12px rgba(180, 83, 9, .08); }
.my-rank-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 16px; }
.my-rank-stats > div { min-height: 64px; padding: 11px; border-radius: 7px; background: rgba(255, 255, 255, .8); }
.my-rank-stats strong { display: block; margin-top: 6px; color: rgb(31 41 55); font-size: 15px; }
.leaderboard-content { display: grid; grid-template-columns: minmax(0, 1fr) 330px; gap: 18px; align-items: start; }
.ranking-section { overflow: hidden; }
.section-heading { display: flex; align-items: center; justify-content: space-between; padding: 20px; border-bottom: 1px solid rgb(243 244 246); }
.section-heading h2, .side-title h2, .rules-card h2 { color: rgb(17 24 39); font-size: 17px; font-weight: 750; }
.section-heading p, .side-title p { margin-top: 4px; color: rgb(107 114 128); font-size: 12px; }
.settled-badge { padding: 5px 9px; border-radius: 999px; font-size: 12px; font-weight: 700; }
.is-settled { color: rgb(4 120 87); background: rgb(209 250 229); }
.is-pending { color: rgb(180 83 9); background: rgb(254 243 199); }
.podium-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; padding: 16px 20px 0; }
.podium-card { position: relative; min-height: 152px; padding: 56px 14px 14px; border: 1px solid rgb(229 231 235); border-radius: 7px; background: rgb(249 250 251); }
.podium-card.rank-1 { border-color: rgb(253 230 138); background: rgb(255 251 235); }
.podium-card.rank-3 { border-color: rgb(167 243 208); background: rgb(236 253 245); }
.podium-rank { position: absolute; top: 14px; left: 14px; display: flex; width: 38px; height: 38px; align-items: center; justify-content: center; border-radius: 7px; color: rgb(31 41 55); background: white; font-size: 17px; font-weight: 800; }
.podium-card p { color: rgb(31 41 55); font-size: 13px; font-weight: 700; }
.podium-card > strong { display: block; margin-top: 6px; color: rgb(17 24 39); font-size: 20px; }
.podium-card small { display: block; margin-top: 4px; color: rgb(107 114 128); font-size: 11px; }
.podium-reward { position: absolute; top: 17px; right: 14px; color: rgb(234 88 12); font-size: 12px; font-weight: 800; }
.ranking-list { margin-top: 14px; border-top: 1px solid rgb(243 244 246); }
.ranking-row { display: grid; grid-template-columns: 48px minmax(0, 1fr) minmax(120px, auto) 100px; gap: 12px; align-items: center; min-height: 70px; padding: 10px 20px; border-bottom: 1px solid rgb(243 244 246); }
.ranking-row:last-child { border-bottom: 0; }
.ranking-row.is-me { background: rgb(240 253 250); }
.row-rank { display: flex; width: 38px; height: 38px; align-items: center; justify-content: center; border-radius: 7px; color: rgb(75 85 99); background: rgb(243 244 246); font-weight: 800; }
.row-user strong { display: block; color: rgb(31 41 55); font-size: 14px; }
.row-user span { display: block; margin-top: 3px; color: rgb(107 114 128); font-size: 11px; }
.row-token { color: rgb(55 65 81); font-size: 13px; font-weight: 650; text-align: right; }
.row-reward { text-align: right; }
.row-reward span { display: block; color: rgb(156 163 175); font-size: 11px; }
.row-reward strong { display: block; margin-top: 2px; color: rgb(234 88 12); font-size: 13px; }
.leaderboard-side { display: flex; flex-direction: column; gap: 18px; }
.wallet-card { padding: 20px; border-color: rgb(167 243 208); background: rgb(236 253 245); }
.side-title { display: flex; justify-content: space-between; gap: 12px; }
.side-title > span { display: flex; width: 44px; height: 44px; flex: 0 0 44px; align-items: center; justify-content: center; color: rgb(5 150 105); border-radius: 7px; background: white; }
.wallet-balance { margin-top: 16px; padding: 14px; border-radius: 7px; background: rgba(255, 255, 255, .78); }
.wallet-balance span, .wallet-balance small { display: block; color: rgb(107 114 128); font-size: 12px; }
.wallet-balance strong { display: block; margin: 4px 0 8px; color: rgb(17 24 39); font-size: 28px; }
.wallet-exchange { display: flex; width: 100%; min-height: 42px; align-items: center; justify-content: center; gap: 8px; margin-top: 12px; border-radius: 7px; color: white; background: rgb(5 150 105); font-size: 13px; font-weight: 750; }
.wallet-exchange:disabled { cursor: not-allowed; color: rgb(100 116 139); background: rgb(203 213 225); }
.rules-card { padding: 20px; }
.rule-list { display: grid; gap: 10px; margin-top: 14px; }
.rule-list > div { display: flex; align-items: center; justify-content: space-between; min-height: 42px; padding: 0 12px; border-radius: 7px; background: rgb(249 250 251); color: rgb(75 85 99); font-size: 13px; }
.rule-list strong { color: rgb(234 88 12); }
.empty-state, .loading-state { display: flex; min-height: 260px; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: rgb(156 163 175); }
.loading-spinner { width: 30px; height: 30px; border: 2px solid rgb(209 213 219); border-top-color: rgb(20 184 166); border-radius: 50%; animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.dark .leaderboard-hero h1, .dark .section-heading h2, .dark .side-title h2, .dark .rules-card h2, .dark .my-rank-head strong, .dark .podium-card > strong, .dark .row-user strong, .dark .wallet-balance strong { color: white; }
.dark .settlement-item, .dark .podium-card, .dark .rule-list > div, .dark .row-rank { border-color: rgb(55 65 81); background: rgb(31 41 55); }
.dark .date-control { border-color: rgb(55 65 81); background: rgb(31 41 55); }
.dark .date-control input { color: rgb(229 231 235); }
.dark .my-rank-panel { border-color: rgb(120 53 15); background: rgba(120, 53, 15, .2); }
.dark .wallet-card { border-color: rgb(6 78 59); background: rgba(6, 78, 59, .25); }
.dark .wallet-balance, .dark .side-title > span, .dark .rank-seal, .dark .my-rank-stats > div { background: rgba(17, 24, 39, .78); }
.dark .ranking-row, .dark .section-heading, .dark .ranking-list { border-color: rgb(31 41 55); }
.dark .ranking-row.is-me { background: rgba(19, 78, 74, .24); }
@media (max-width: 1024px) { .leaderboard-hero, .leaderboard-content { grid-template-columns: 1fr; } .leaderboard-side { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 640px) { .leaderboard-page { gap: 12px; } .leaderboard-hero { padding: 18px; } .leaderboard-hero h1 { font-size: 24px; } .settlement-grid, .podium-grid, .leaderboard-side { grid-template-columns: 1fr; } .hero-actions, .hero-actions .btn, .date-control { width: 100%; } .date-control input { min-width: 0; flex: 1; } .podium-grid { padding: 14px 14px 0; } .section-heading { padding: 16px; } .ranking-row { grid-template-columns: 40px minmax(0, 1fr) 76px; padding: 10px 14px; } .row-token { display: none; } }
</style>
