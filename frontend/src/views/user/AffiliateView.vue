<template>
  <AppLayout>
    <div class="affiliate-page space-y-6">
      <div v-if="loading" class="flex justify-center py-12">
        <div
          class="h-8 w-8 animate-spin rounded-full border-2 border-primary-500 border-t-transparent"
        ></div>
      </div>

      <template v-else-if="detail">
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div class="card p-5">
            <p class="flex items-center gap-1.5 text-sm text-gray-500 dark:text-dark-400">
              <Icon name="dollar" size="sm" class="text-primary-500" />
              {{ t('affiliate.stats.rebateRate') }}
            </p>
            <p class="mt-2 text-2xl font-semibold text-primary-600 dark:text-primary-400">
              {{ formattedRebateRate }}<span class="ml-0.5 text-base font-medium">%</span>
            </p>
            <p class="mt-1 text-xs text-gray-400 dark:text-dark-500">
              {{ t('affiliate.stats.rebateRateHint') }}
            </p>
          </div>
          <div class="card p-5">
            <p class="text-sm text-gray-500 dark:text-dark-400">{{ t('affiliate.stats.invitedUsers') }}</p>
            <p class="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">
              {{ formatCount(detail.aff_count) }}
            </p>
          </div>
          <div class="card p-5">
            <p class="text-sm text-gray-500 dark:text-dark-400">{{ t('affiliate.stats.availableQuota') }}</p>
            <p class="mt-2 text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
              {{ formatCurrency(detail.aff_quota) }}
            </p>
          </div>
          <div class="card p-5">
            <p class="text-sm text-gray-500 dark:text-dark-400">{{ t('affiliate.stats.totalQuota') }}</p>
            <p class="mt-2 text-2xl font-semibold text-gray-900 dark:text-white">
              {{ formatCurrency(detail.aff_history_quota) }}
            </p>
            <p v-if="detail.aff_frozen_quota > 0" class="mt-1 text-xs text-amber-600 dark:text-amber-400">
              {{ t('affiliate.stats.frozenQuota') }}: {{ formatCurrency(detail.aff_frozen_quota) }}
            </p>
          </div>
        </div>

        <div class="affiliate-panel card p-6">
          <div class="affiliate-section-head">
            <div>
              <h3 class="text-base font-semibold text-gray-900 dark:text-white">{{ t('affiliate.title') }}</h3>
              <p class="mt-1 text-sm text-gray-500 dark:text-dark-400">{{ t('affiliate.description') }}</p>
            </div>
            <div class="affiliate-section-badge">
              最高返利 {{ formattedRebateRate }}%
            </div>
          </div>

          <div class="mt-5 grid gap-4">
            <div class="space-y-2">
              <p class="text-sm font-medium text-gray-700 dark:text-gray-300">{{ t('affiliate.inviteLink') }}</p>
              <div class="affiliate-link-box">
                <code class="affiliate-link-code">{{ inviteLink }}</code>
                <button class="btn btn-secondary btn-sm affiliate-copy-btn" @click="copyInviteLink">
                  <Icon name="copy" size="sm" />
                  <span>{{ t('affiliate.copyLink') }}</span>
                </button>
              </div>
            </div>
          </div>

          <div class="affiliate-tips mt-5">
            <p class="text-sm font-medium text-primary-800 dark:text-primary-200">{{ t('affiliate.tips.title') }}</p>
            <ul class="mt-2 space-y-1 text-sm text-primary-700 dark:text-primary-300">
              <li>1. {{ t('affiliate.tips.line1') }}</li>
              <li>2. {{ t('affiliate.tips.line2', { rate: `${formattedRebateRate}%` }) }}</li>
              <li>3. {{ t('affiliate.tips.line3') }}</li>
              <li v-if="detail.aff_frozen_quota > 0">4. {{ t('affiliate.tips.line4') }}</li>
            </ul>
          </div>
        </div>

        <div class="affiliate-transfer-card card p-6">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 class="text-base font-semibold text-gray-900 dark:text-white">{{ t('affiliate.transfer.title') }}</h3>
              <p class="mt-1 text-sm text-gray-500 dark:text-dark-400">{{ t('affiliate.transfer.description') }}</p>
              <p class="mt-3 text-2xl font-semibold text-primary-600 dark:text-primary-300">
                {{ formatCurrency(detail.aff_quota) }}
              </p>
            </div>
            <button
              class="btn btn-primary affiliate-transfer-btn"
              :disabled="transferring || detail.aff_quota <= 0"
              @click="transferQuota"
            >
              <Icon v-if="transferring" name="refresh" size="sm" class="animate-spin" />
              <Icon v-else name="dollar" size="sm" />
              <span>{{ transferring ? t('affiliate.transfer.transferring') : t('affiliate.transfer.button') }}</span>
            </button>
          </div>
          <p v-if="detail.aff_quota <= 0" class="mt-3 text-sm text-amber-600 dark:text-amber-400">
            {{ t('affiliate.transfer.empty') }}
          </p>
        </div>

        <div class="affiliate-invitees-card card p-6">
          <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <h3 class="text-base font-semibold text-gray-900 dark:text-white">{{ t('affiliate.invitees.title') }}</h3>
            <div class="w-full sm:max-w-sm">
              <input
                v-model="inviteeSearch"
                type="text"
                class="input h-10"
                placeholder="搜索邮箱"
              />
            </div>
          </div>
          <div v-if="visibleInvitees.length === 0" class="mt-4 rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-dark-700 dark:text-dark-400">
            {{ t('affiliate.invitees.empty') }}
          </div>
          <div v-else class="affiliate-table-scroll mt-4 overflow-x-auto">
            <table class="affiliate-invitees-table w-full min-w-[1040px] text-left text-sm">
              <thead>
                <tr class="border-b border-gray-200 text-gray-500 dark:border-dark-700 dark:text-dark-400">
                  <th class="px-3 py-2 font-medium">邮箱</th>
                  <th class="px-3 py-2 font-medium">层级</th>
                  <th class="px-3 py-2 font-medium text-right">消费</th>
                  <th class="px-3 py-2 font-medium text-right">累计充值</th>
                  <th class="px-3 py-2 font-medium text-right">返利明细</th>
                  <th class="px-3 py-2 font-medium text-right">最后一次充值金额</th>
                  <th class="px-3 py-2 font-medium">最近充值时间</th>
                  <th class="px-3 py-2 font-medium">注册时间</th>
                  <th class="px-3 py-2 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in visibleInvitees"
                  :key="item.user_id"
                  class="affiliate-invitee-row border-b border-gray-100 last:border-b-0 dark:border-dark-800"
                  :class="{
                    'affiliate-invitee-row-child': item.level > 1,
                    'affiliate-invitee-row-parent': hasInviteeChildren(item.user_id),
                  }"
                >
                  <td class="px-3 py-3 text-gray-900 dark:text-white">
                    <div
                      class="affiliate-email-tree min-h-6"
                      :style="emailIndentStyle(item.level)"
                    >
                      <button
                        v-if="hasInviteeChildren(item.user_id) && !isInviteeSearchActive"
                        type="button"
                        class="affiliate-disclosure"
                        :aria-expanded="!collapsedInviteeIds.has(item.user_id)"
                        :aria-label="collapsedInviteeIds.has(item.user_id) ? '展开下级代理' : '折叠下级代理'"
                        @click="toggleInvitee(item.user_id)"
                      >
                        <Icon
                          :name="collapsedInviteeIds.has(item.user_id) ? 'chevronRight' : 'chevronUp'"
                          size="xs"
                        />
                      </button>
                      <span v-else class="h-6 w-6 shrink-0" aria-hidden="true"></span>
                      <span class="affiliate-invitee-email">{{ item.email || '-' }}</span>
                    </div>
                  </td>
                  <td class="px-3 py-3">
                    <span class="affiliate-level-badge inline-flex items-center px-2.5 py-1 text-xs font-medium">
                      {{ formatAffiliateLevel(item.level) }}
                    </span>
                  </td>
                  <td class="px-3 py-3 text-right font-medium text-emerald-600 dark:text-emerald-400">{{ formatCurrency(item.total_consumed || 0) }}</td>
                  <td class="px-3 py-3 text-right font-medium text-emerald-600 dark:text-emerald-400">{{ formatCurrency(item.total_recharged || 0) }}</td>
                  <td class="px-3 py-3 text-right font-medium text-emerald-600 dark:text-emerald-400">{{ formatCurrency(item.total_rebate) }}</td>
                  <td class="px-3 py-3 text-right font-medium text-gray-700 dark:text-gray-300">
                    {{ item.last_recharged_amount > 0 ? formatCurrency(item.last_recharged_amount) : '-' }}
                  </td>
                  <td class="px-3 py-3 text-gray-700 dark:text-gray-300">{{ formatDateTime(item.last_recharged_at) || '-' }}</td>
                  <td class="px-3 py-3 text-gray-700 dark:text-gray-300">{{ formatDateTime(item.created_at) || '-' }}</td>
                  <td class="px-3 py-3 text-right">
                    <button class="affiliate-detail-button btn btn-secondary btn-sm" @click="openInviteeDetail(item.user_id)">
                      <Icon name="eye" size="sm" />
                      <span>{{ t('affiliate.invitees.detail') }}</span>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>

      <div
        v-if="detailDialogOpen"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        @click.self="closeInviteeDetail"
      >
        <div class="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-xl bg-white shadow-xl dark:bg-dark-900">
          <div class="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-dark-700">
            <div>
              <h3 class="text-base font-semibold text-gray-900 dark:text-white">
                {{ t('affiliate.inviteeDetail.title') }}
              </h3>
              <p class="mt-1 text-sm text-gray-500 dark:text-dark-400">
                {{ inviteeDetail?.email || '-' }}
              </p>
            </div>
            <button class="btn btn-ghost btn-sm" @click="closeInviteeDetail">
              <Icon name="x" size="sm" />
            </button>
          </div>

          <div class="max-h-[calc(90vh-76px)] overflow-y-auto p-6">
            <div v-if="inviteeDetailLoading" class="flex justify-center py-12">
              <div class="h-8 w-8 animate-spin rounded-full border-2 border-primary-500 border-t-transparent"></div>
            </div>

            <template v-else-if="inviteeDetail">
              <div class="grid gap-4 sm:grid-cols-2">
                <div class="rounded-lg border border-gray-200 p-4 dark:border-dark-700">
                  <p class="text-sm text-gray-500 dark:text-dark-400">{{ t('affiliate.inviteeDetail.totalRecharged') }}</p>
                  <p class="mt-2 text-2xl font-semibold text-primary-600 dark:text-primary-400">
                    {{ formatCurrency(inviteeDetail.total_recharged) }}
                  </p>
                </div>
                <div class="rounded-lg border border-gray-200 p-4 dark:border-dark-700">
                  <p class="text-sm text-gray-500 dark:text-dark-400">{{ t('affiliate.inviteeDetail.totalConsumed') }}</p>
                  <p class="mt-2 text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
                    {{ formatCurrency(inviteeDetail.total_consumed) }}
                  </p>
                </div>
              </div>

              <section class="mt-6">
                <h4 class="text-sm font-semibold text-gray-900 dark:text-white">{{ t('affiliate.inviteeDetail.rechargeRecords') }}</h4>
                <div class="mt-3 overflow-x-auto rounded-lg border border-gray-200 dark:border-dark-700">
                  <table class="w-full min-w-[520px] text-left text-sm">
                    <thead class="bg-gray-50 text-gray-500 dark:bg-dark-800 dark:text-dark-400">
                      <tr>
                        <th class="px-3 py-2 font-medium">{{ t('affiliate.inviteeDetail.columns.time') }}</th>
                        <th class="px-3 py-2 font-medium">{{ t('affiliate.inviteeDetail.columns.code') }}</th>
                        <th class="px-3 py-2 text-right font-medium">{{ t('affiliate.inviteeDetail.columns.amount') }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-if="inviteeDetail.recharge_records.length === 0">
                        <td colspan="3" class="px-3 py-6 text-center text-gray-500 dark:text-dark-400">
                          {{ t('affiliate.inviteeDetail.noRecharge') }}
                        </td>
                      </tr>
                      <tr
                        v-for="record in inviteeDetail.recharge_records"
                        :key="`${record.code}-${record.used_at}`"
                        class="border-t border-gray-100 dark:border-dark-800"
                      >
                        <td class="px-3 py-2 text-gray-700 dark:text-gray-300">{{ formatDateTime(record.used_at) }}</td>
                        <td class="px-3 py-2 font-mono text-xs text-gray-700 dark:text-gray-300">{{ maskCode(record.code) }}</td>
                        <td class="px-3 py-2 text-right font-medium text-primary-600 dark:text-primary-400">{{ formatCurrency(record.value) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>

              <section class="mt-6">
                <h4 class="text-sm font-semibold text-gray-900 dark:text-white">{{ t('affiliate.inviteeDetail.dailyUsage') }}</h4>
                <div class="mt-3 overflow-x-auto rounded-lg border border-gray-200 dark:border-dark-700">
                  <table class="w-full min-w-[720px] text-left text-sm">
                    <thead class="bg-gray-50 text-gray-500 dark:bg-dark-800 dark:text-dark-400">
                      <tr>
                        <th class="px-3 py-2 font-medium">{{ t('affiliate.inviteeDetail.columns.date') }}</th>
                        <th class="px-3 py-2 text-right font-medium">{{ t('affiliate.inviteeDetail.columns.inputTokens') }}</th>
                        <th class="px-3 py-2 text-right font-medium">{{ t('affiliate.inviteeDetail.columns.outputTokens') }}</th>
                        <th class="px-3 py-2 text-right font-medium">{{ t('affiliate.inviteeDetail.columns.totalTokens') }}</th>
                        <th class="px-3 py-2 text-right font-medium">{{ t('affiliate.inviteeDetail.columns.consumed') }}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-if="inviteeDetail.daily_usage.length === 0">
                        <td colspan="5" class="px-3 py-6 text-center text-gray-500 dark:text-dark-400">
                          {{ t('affiliate.inviteeDetail.noUsage') }}
                        </td>
                      </tr>
                      <tr
                        v-for="day in inviteeDetail.daily_usage"
                        :key="day.date"
                        class="border-t border-gray-100 dark:border-dark-800"
                      >
                        <td class="px-3 py-2 text-gray-700 dark:text-gray-300">{{ day.date }}</td>
                        <td class="px-3 py-2 text-right text-gray-700 dark:text-gray-300">{{ formatNumber(day.input_tokens) }}</td>
                        <td class="px-3 py-2 text-right text-gray-700 dark:text-gray-300">{{ formatNumber(day.output_tokens) }}</td>
                        <td class="px-3 py-2 text-right text-gray-700 dark:text-gray-300">{{ formatNumber(day.total_tokens) }}</td>
                        <td class="px-3 py-2 text-right font-medium text-emerald-600 dark:text-emerald-400">{{ formatCurrency(day.actual_cost) }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            </template>
          </div>
        </div>
      </div>
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppLayout from '@/components/layout/AppLayout.vue'
import Icon from '@/components/icons/Icon.vue'
import userAPI from '@/api/user'
import type { AffiliateInvitee, AffiliateInviteeDetail, UserAffiliateDetail } from '@/types'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import { useClipboard } from '@/composables/useClipboard'
import { formatCurrency, formatDateTime, formatNumber } from '@/utils/format'
import { extractApiErrorMessage } from '@/utils/apiError'

const { t } = useI18n()
const appStore = useAppStore()
const authStore = useAuthStore()
const { copyToClipboard } = useClipboard()

const loading = ref(true)
const transferring = ref(false)
const detail = ref<UserAffiliateDetail | null>(null)
const inviteeSearch = ref('')
const collapsedInviteeIds = ref(new Set<number>())
const inviteeTreeInitialized = ref(false)
const detailDialogOpen = ref(false)
const inviteeDetailLoading = ref(false)
const inviteeDetail = ref<AffiliateInviteeDetail | null>(null)

const inviteLink = computed(() => {
  if (!detail.value) return ''
  if (typeof window === 'undefined') return `/register?aff=${encodeURIComponent(detail.value.aff_code)}`
  return `${window.location.origin}/register?aff=${encodeURIComponent(detail.value.aff_code)}`
})

const formattedRebateRate = computed(() => {
  const v = detail.value?.effective_rebate_rate_percent ?? 0
  const rounded = Math.round(v * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toString()
})

const isInviteeSearchActive = computed(() => inviteeSearch.value.trim().length > 0)

const inviteeChildren = computed(() => {
  const items = detail.value?.invitees ?? []
  const children = new Map<number, AffiliateInvitee[]>()
  for (const item of items) {
    const siblings = children.get(item.inviter_id) ?? []
    siblings.push(item)
    children.set(item.inviter_id, siblings)
  }
  return children
})

const visibleInvitees = computed(() => {
  const items = detail.value?.invitees ?? []
  const keyword = inviteeSearch.value.trim().toLowerCase()
  if (keyword) {
    return items.filter((item) => (item.email || '').toLowerCase().includes(keyword))
  }

  const roots = items.filter((item) => item.level === 1)
  const visible: AffiliateInvitee[] = []
  const visited = new Set<number>()

  const prioritizeBranches = (branches: AffiliateInvitee[]): AffiliateInvitee[] => {
    return [...branches].sort((left, right) => {
      const leftHasChildren = inviteeChildren.value.has(left.user_id)
      const rightHasChildren = inviteeChildren.value.has(right.user_id)
      return Number(rightHasChildren) - Number(leftHasChildren)
    })
  }

  const appendBranch = (item: AffiliateInvitee): void => {
    if (visited.has(item.user_id)) return
    visited.add(item.user_id)
    visible.push(item)
    if (collapsedInviteeIds.value.has(item.user_id)) return
    for (const child of prioritizeBranches(inviteeChildren.value.get(item.user_id) ?? [])) {
      appendBranch(child)
    }
  }

  prioritizeBranches(roots).forEach(appendBranch)
  return visible
})

function formatCount(value: number): string {
  return value.toLocaleString()
}

function formatAffiliateLevel(level: number): string {
  const safeLevel = Number.isFinite(level) && level > 0 ? Math.floor(level) : 1
  const displayLevel = safeLevel + 1
  const labels = ['', '一级代理', '二级代理', '三级代理']
  if (displayLevel < labels.length) {
    return labels[displayLevel]
  }
  return `${displayLevel}级代理`
}

function hasInviteeChildren(userId: number): boolean {
  return (inviteeChildren.value.get(userId)?.length ?? 0) > 0
}

function toggleInvitee(userId: number): void {
  const next = new Set(collapsedInviteeIds.value)
  if (next.has(userId)) {
    next.delete(userId)
  } else {
    next.add(userId)
  }
  collapsedInviteeIds.value = next
}

function initializeCollapsedInviteeBranches(items: AffiliateInvitee[]): void {
  if (inviteeTreeInitialized.value) return
  const inviterIds = new Set(items.map((item) => item.inviter_id))
  collapsedInviteeIds.value = new Set(
    items
      .filter((item) => inviterIds.has(item.user_id))
      .map((item) => item.user_id)
  )
  inviteeTreeInitialized.value = true
}

function emailIndentStyle(level: number): Record<string, string> {
  const safeLevel = Number.isFinite(level) && level > 0 ? Math.floor(level) : 1
  const indent = Math.min((safeLevel - 1) * 1.5, 6)
  return { paddingLeft: `${0.75 + indent}rem` }
}

function maskCode(code: string): string {
  if (!code || code.length <= 8) return code || '-'
  return `${code.slice(0, 4)}...${code.slice(-4)}`
}

async function loadAffiliateDetail(silent = false): Promise<void> {
  if (!silent) {
    loading.value = true
  }
  try {
    const nextDetail = await userAPI.getAffiliateDetail()
    detail.value = nextDetail
    initializeCollapsedInviteeBranches(nextDetail.invitees ?? [])
  } catch (error) {
    appStore.showError(extractApiErrorMessage(error, t('affiliate.loadFailed')))
  } finally {
    if (!silent) {
      loading.value = false
    }
  }
}

async function copyInviteLink(): Promise<void> {
  if (!inviteLink.value) return
  await copyToClipboard(inviteLink.value, t('affiliate.linkCopied'))
}

async function transferQuota(): Promise<void> {
  if (!detail.value || detail.value.aff_quota <= 0 || transferring.value) return
  transferring.value = true
  try {
    const resp = await userAPI.transferAffiliateQuota()
    appStore.showSuccess(t('affiliate.transfer.success', { amount: formatCurrency(resp.transferred_quota) }))
    await Promise.all([
      loadAffiliateDetail(true),
      authStore.refreshUser().catch(() => undefined),
    ])
  } catch (error) {
    appStore.showError(extractApiErrorMessage(error, t('affiliate.transferFailed')))
  } finally {
    transferring.value = false
  }
}

async function openInviteeDetail(userId: number): Promise<void> {
  detailDialogOpen.value = true
  inviteeDetailLoading.value = true
  inviteeDetail.value = null
  try {
    inviteeDetail.value = await userAPI.getAffiliateInviteeDetail(userId, 30)
  } catch (error) {
    appStore.showError(extractApiErrorMessage(error, t('affiliate.inviteeDetail.loadFailed')))
  } finally {
    inviteeDetailLoading.value = false
  }
}

function closeInviteeDetail(): void {
  detailDialogOpen.value = false
}

onMounted(() => {
  void loadAffiliateDetail()
})
</script>

<style scoped>
.affiliate-page {
  position: relative;
}

.affiliate-invitees-card {
  overflow: hidden;
}

.affiliate-invitees-table {
  border-collapse: separate;
  border-spacing: 0;
}

.affiliate-invitee-row td {
  height: 4.25rem;
  transition: background-color 150ms ease;
}

.affiliate-invitee-row-child td {
  background-color: rgba(240, 253, 250, 0.48);
}

.affiliate-invitee-row-child td:first-child {
  box-shadow: inset 3px 0 0 rgba(45, 212, 191, 0.5);
}

.affiliate-invitee-row-parent .affiliate-invitee-email {
  font-weight: 700;
}

.affiliate-email-tree {
  display: grid;
  grid-template-columns: 1.5rem minmax(0, 1fr);
  column-gap: 0.5rem;
  align-items: center;
  padding-right: 0.5rem;
}

.affiliate-invitee-email {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.affiliate-level-badge {
  border-radius: 999px;
  background: rgb(238 252 249);
  color: rgb(13 148 136);
  white-space: nowrap;
}

.affiliate-disclosure {
  display: inline-flex;
  width: 1.5rem;
  height: 1.5rem;
  flex: 0 0 1.5rem;
  align-items: center;
  justify-content: center;
  border: 1px solid rgb(94 234 212);
  border-radius: 999px;
  background: rgb(240 253 250);
  color: rgb(13 148 136);
  transition: color 150ms ease, background-color 150ms ease, border-color 150ms ease;
}

.affiliate-disclosure:hover {
  border-color: rgb(20 184 166);
  background: rgb(204 251 241);
  color: rgb(15 118 110);
}

.affiliate-disclosure:focus-visible {
  outline: 2px solid rgb(14 165 233);
  outline-offset: 2px;
}

.dark .affiliate-disclosure:hover {
  background: rgba(19, 78, 74, 0.72);
  color: rgb(153 246 228);
}

.affiliate-detail-button {
  border-radius: 999px;
  padding-inline: 0.9rem;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06);
}

.dark .affiliate-invitee-row-child td {
  background-color: rgba(19, 78, 74, 0.14);
}

.dark .affiliate-level-badge {
  background: rgba(19, 78, 74, 0.42);
  color: rgb(153 246 228);
}

.affiliate-panel,
.affiliate-transfer-card {
  position: relative;
  overflow: hidden;
  border: 0;
  border-radius: 28px;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.96), rgba(248, 252, 255, 0.9)),
    radial-gradient(circle at 12% 0%, rgba(20, 184, 166, 0.12), transparent 34%),
    radial-gradient(circle at 96% 14%, rgba(59, 130, 246, 0.08), transparent 30%);
  box-shadow:
    0 22px 64px rgba(44, 72, 132, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.72);
}

.affiliate-panel::after,
.affiliate-transfer-card::after {
  content: '';
  position: absolute;
  right: -70px;
  top: -88px;
  width: 190px;
  height: 190px;
  border-radius: 999px;
  background: rgba(20, 184, 166, 0.1);
  pointer-events: none;
}

.affiliate-section-head {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.affiliate-section-badge {
  flex: 0 0 auto;
  border-radius: 999px;
  border: 1px solid rgba(45, 212, 191, 0.42);
  background: rgba(240, 253, 250, 0.86);
  padding: 0.5rem 0.85rem;
  color: rgb(13 148 136);
  font-size: 0.8rem;
  font-weight: 800;
  box-shadow: 0 10px 24px rgba(20, 184, 166, 0.12);
}

.affiliate-link-box {
  position: relative;
  z-index: 1;
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 0.85rem;
  border: 1px solid rgba(226, 232, 240, 0.92);
  border-radius: 18px;
  background: rgba(248, 250, 252, 0.82);
  padding: 0.7rem 0.75rem 0.7rem 1rem;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.78),
    0 12px 32px rgba(44, 72, 132, 0.06);
}

.affiliate-link-code {
  display: block;
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  color: rgb(51 65 85);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.92rem;
  font-weight: 700;
  line-height: 1.7;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.affiliate-copy-btn,
.affiliate-transfer-btn {
  flex: 0 0 auto;
  border-radius: 999px;
  padding-inline: 1.1rem;
  box-shadow: 0 10px 22px rgba(44, 72, 132, 0.1);
}

.affiliate-tips {
  position: relative;
  z-index: 1;
  border: 1px solid rgba(45, 212, 191, 0.42);
  border-radius: 20px;
  background:
    linear-gradient(145deg, rgba(240, 253, 250, 0.92), rgba(236, 254, 255, 0.78));
  padding: 1rem 1.1rem;
}

.affiliate-transfer-card {
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.96), rgba(249, 250, 251, 0.88)),
    radial-gradient(circle at 90% 20%, rgba(20, 184, 166, 0.14), transparent 30%),
    radial-gradient(circle at 16% 0%, rgba(59, 130, 246, 0.08), transparent 28%);
}

.dark .affiliate-panel,
.dark .affiliate-transfer-card {
  background:
    linear-gradient(145deg, rgba(15, 23, 42, 0.94), rgba(2, 8, 23, 0.92)),
    radial-gradient(circle at 12% 0%, rgba(20, 184, 166, 0.14), transparent 34%),
    radial-gradient(circle at 96% 14%, rgba(59, 130, 246, 0.12), transparent 30%);
  box-shadow:
    0 22px 64px rgba(2, 8, 23, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.dark .affiliate-section-badge {
  border-color: rgba(45, 212, 191, 0.28);
  background: rgba(15, 118, 110, 0.16);
  color: rgb(153 246 228);
}

.dark .affiliate-link-box {
  border-color: rgba(51, 65, 85, 0.9);
  background: rgba(15, 23, 42, 0.72);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    0 12px 32px rgba(2, 8, 23, 0.24);
}

.dark .affiliate-link-code {
  color: rgb(203 213 225);
}

.dark .affiliate-tips {
  border-color: rgba(45, 212, 191, 0.28);
  background:
    linear-gradient(145deg, rgba(20, 83, 75, 0.24), rgba(8, 47, 73, 0.16));
}

@media (max-width: 640px) {
  .affiliate-page {
    margin-inline: -0.25rem;
  }

  .affiliate-panel,
  .affiliate-transfer-card {
    border-radius: 24px;
    padding: 1.25rem;
  }

  .affiliate-section-head {
    flex-direction: column;
  }

  .affiliate-section-badge {
    width: fit-content;
  }

  .affiliate-link-box {
    flex-direction: column;
    align-items: stretch;
    gap: 0.75rem;
    padding: 0.85rem;
  }

  .affiliate-link-code {
    width: 100%;
    max-height: 4.2rem;
    overflow: auto;
    border-radius: 14px;
    background: rgba(255, 255, 255, 0.56);
    padding: 0.75rem;
    font-size: 0.82rem;
    line-height: 1.55;
    overflow-wrap: anywhere;
    text-overflow: unset;
    white-space: normal;
    word-break: break-all;
  }

  .dark .affiliate-link-code {
    background: rgba(2, 8, 23, 0.38);
  }

  .affiliate-copy-btn,
  .affiliate-transfer-btn {
    width: 100%;
    justify-content: center;
  }
}
</style>
