<template>
  <BaseDialog
    :show="show"
    :title="t('tokenLeaderboard.shareTitle')"
    width="wide"
    close-on-click-outside
    @close="emit('close')"
  >
    <div class="share-dialog-layout">
      <div class="poster-preview" :aria-busy="generating">
        <img v-if="posterPreviewUrl" :src="posterPreviewUrl" :alt="t('tokenLeaderboard.posterAlt')" />
        <div v-else-if="generating" class="poster-state" role="status">
          <span class="loading-spinner"></span>
          <span>{{ t('tokenLeaderboard.generatingPoster') }}</span>
        </div>
        <div v-else class="poster-state is-error">
          <span>{{ t('tokenLeaderboard.posterFailed') }}</span>
          <button type="button" class="btn btn-secondary" @click="generatePoster">
            <Icon name="refresh" size="sm" />
            {{ t('tokenLeaderboard.regeneratePoster') }}
          </button>
        </div>
      </div>

      <div class="share-controls">
        <label class="share-link-label" for="leaderboard-share-link">
          {{ t('tokenLeaderboard.shareLink') }}
        </label>
        <div class="share-link-field">
          <Icon name="link" size="sm" />
          <input id="leaderboard-share-link" :value="shareUrl" readonly />
        </div>

        <div class="share-actions">
          <button
            type="button"
            class="share-action"
            :disabled="!posterBlob || generating || copyingAction !== null"
            @click="copyPoster"
          >
            <Icon name="clipboard" size="md" />
            <span>{{ t('tokenLeaderboard.copyPoster') }}</span>
          </button>
          <button
            type="button"
            class="share-action"
            :disabled="copyingAction !== null"
            @click="copyLink"
          >
            <Icon name="link" size="md" />
            <span>{{ t('tokenLeaderboard.copyLink') }}</span>
          </button>
          <button
            type="button"
            class="share-action is-primary"
            :disabled="!posterBlob || generating || copyingAction !== null"
            @click="copyAll"
          >
            <Icon name="copy" size="md" />
            <span>{{ t('tokenLeaderboard.copyAll') }}</span>
          </button>
        </div>
      </div>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/common/BaseDialog.vue'
import Icon from '@/components/icons/Icon.vue'
import { useClipboard } from '@/composables/useClipboard'
import { useAppStore } from '@/stores/app'
import {
  copyPosterAndLinkToClipboard,
  copyPosterToClipboard,
  createTokenLeaderboardPoster,
  type TokenLeaderboardPosterData,
} from '@/utils/tokenLeaderboardPoster'
import type { TokenLeaderboardData, TokenLeaderboardEntry } from '@/types'

const props = defineProps<{
  show: boolean
  data: TokenLeaderboardData | null
  viewMode: 'realtime' | 'history'
}>()

const emit = defineEmits<{
  close: []
}>()

const { t, locale } = useI18n()
const appStore = useAppStore()
const { copyToClipboard } = useClipboard()
const posterBlob = ref<Blob | null>(null)
const posterPreviewUrl = ref('')
const generating = ref(false)
const copyingAction = ref<'poster' | 'link' | 'all' | null>(null)
let generationSequence = 0

const shareUrl = computed(() => new URL('/token-leaderboard', window.location.origin).toString())

function formatTokens(value: number): string {
  if (value >= 100_000_000) return `${stripZero(value / 100_000_000)}亿 Tokens`
  if (value >= 10_000) return `${stripZero(value / 10_000)}万 Tokens`
  return `${new Intl.NumberFormat(locale.value).format(value)} Tokens`
}

function stripZero(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '')
}

function userLabel(entry: TokenLeaderboardEntry): string {
  return entry.is_current_user
    ? t('tokenLeaderboard.me', { id: entry.user_id })
    : t('tokenLeaderboard.user', { id: entry.user_id })
}

function releasePreview(): void {
  if (posterPreviewUrl.value) URL.revokeObjectURL(posterPreviewUrl.value)
  posterPreviewUrl.value = ''
  posterBlob.value = null
}

function buildPosterData(): TokenLeaderboardPosterData {
  const currentUser = props.data?.current_user
  const rewardLabel = props.viewMode === 'realtime'
    ? t('tokenLeaderboard.estimatedReward')
    : t('tokenLeaderboard.myReward')
  return {
    brand: '88TOKEN.NET',
    title: t('tokenLeaderboard.title'),
    subtitle: t('tokenLeaderboard.posterSubtitle'),
    viewLabel: props.viewMode === 'realtime'
      ? t('tokenLeaderboard.realtimeRanking')
      : t('tokenLeaderboard.dailyRanking'),
    myRankLabel: t('tokenLeaderboard.myRank'),
    myRank: currentUser ? `#${currentUser.rank}` : t('tokenLeaderboard.unranked'),
    myTokensLabel: t('tokenLeaderboard.myTokens'),
    myTokens: currentUser ? formatTokens(currentUser.total_tokens) : '-',
    rewardLabel,
    reward: currentUser?.reward_points ? `+${currentUser.reward_points}` : '-',
    topThreeLabel: t('tokenLeaderboard.posterTopThree'),
    emptyLabel: t('tokenLeaderboard.empty'),
    scanHint: t('tokenLeaderboard.posterScanHint'),
    generatedAt: t('tokenLeaderboard.posterGeneratedAt', {
      time: new Intl.DateTimeFormat(locale.value, {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date()),
    }),
    shareUrl: shareUrl.value,
    entries: (props.data?.entries ?? [])
      .filter((entry) => entry.rank <= 3)
      .map((entry) => ({
        rank: entry.rank,
        user: userLabel(entry),
        tokens: formatTokens(entry.total_tokens),
        reward: entry.reward_points ? `+${entry.reward_points} ${t('tokenLeaderboard.points')}` : '-',
      })),
  }
}

async function generatePoster(): Promise<void> {
  const sequence = ++generationSequence
  generating.value = true
  releasePreview()
  try {
    const blob = await createTokenLeaderboardPoster(buildPosterData())
    if (sequence !== generationSequence || !props.show) return
    posterBlob.value = blob
    posterPreviewUrl.value = URL.createObjectURL(blob)
  } catch {
    if (sequence === generationSequence) appStore.showError(t('tokenLeaderboard.posterFailed'))
  } finally {
    if (sequence === generationSequence) generating.value = false
  }
}

async function copyPoster(): Promise<void> {
  if (!posterBlob.value) return
  copyingAction.value = 'poster'
  try {
    await copyPosterToClipboard(posterBlob.value)
    appStore.showSuccess(t('tokenLeaderboard.posterCopied'))
  } catch {
    appStore.showError(t('tokenLeaderboard.posterCopyFailed'))
  } finally {
    copyingAction.value = null
  }
}

async function copyLink(): Promise<void> {
  copyingAction.value = 'link'
  try {
    await copyToClipboard(shareUrl.value, t('tokenLeaderboard.linkCopied'))
  } finally {
    copyingAction.value = null
  }
}

async function copyAll(): Promise<void> {
  if (!posterBlob.value) return
  copyingAction.value = 'all'
  try {
    await copyPosterAndLinkToClipboard(posterBlob.value, shareUrl.value)
    appStore.showSuccess(t('tokenLeaderboard.allCopied'))
  } catch {
    appStore.showError(t('tokenLeaderboard.allCopyFailed'))
  } finally {
    copyingAction.value = null
  }
}

watch(
  () => props.show,
  (show) => {
    if (show) void generatePoster()
    else {
      generationSequence += 1
      generating.value = false
      releasePreview()
    }
  },
  { immediate: true },
)

onUnmounted(() => {
  generationSequence += 1
  releasePreview()
})
</script>

<style scoped>
.share-dialog-layout { display: grid; grid-template-columns: minmax(260px, 360px) minmax(0, 1fr); gap: 24px; align-items: start; }
.poster-preview { display: flex; min-height: 480px; align-items: center; justify-content: center; overflow: hidden; border: 1px solid rgb(226 232 240); border-radius: 8px; background: rgb(241 245 249); }
.poster-preview img { display: block; width: 100%; aspect-ratio: 3 / 4; object-fit: contain; }
.poster-state { display: flex; min-height: 320px; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 24px; color: rgb(100 116 139); font-size: 13px; text-align: center; }
.poster-state.is-error { color: rgb(185 28 28); }
.loading-spinner { width: 28px; height: 28px; border: 2px solid rgb(203 213 225); border-top-color: rgb(13 148 136); border-radius: 50%; animation: spin 1s linear infinite; }
.share-controls { min-width: 0; }
.share-link-label { display: block; margin-bottom: 8px; color: rgb(51 65 85); font-size: 13px; font-weight: 700; }
.share-link-field { display: flex; min-height: 44px; align-items: center; gap: 10px; padding: 0 12px; border: 1px solid rgb(226 232 240); border-radius: 7px; background: rgb(248 250 252); color: rgb(100 116 139); }
.share-link-field input { min-width: 0; flex: 1; color: rgb(30 41 59); background: transparent; font-size: 13px; outline: none; }
.share-actions { display: grid; gap: 10px; margin-top: 18px; }
.share-action { display: flex; width: 100%; min-height: 48px; align-items: center; justify-content: center; gap: 9px; border: 1px solid rgb(203 213 225); border-radius: 7px; color: rgb(51 65 85); background: white; font-size: 13px; font-weight: 750; transition: border-color 150ms ease, background-color 150ms ease, color 150ms ease; }
.share-action:hover:not(:disabled) { border-color: rgb(94 234 212); color: rgb(15 118 110); background: rgb(240 253 250); }
.share-action.is-primary { color: white; border-color: rgb(13 148 136); background: rgb(13 148 136); }
.share-action.is-primary:hover:not(:disabled) { color: white; border-color: rgb(15 118 110); background: rgb(15 118 110); }
.share-action:disabled { cursor: not-allowed; opacity: .5; }
.share-action:focus-visible { outline: 2px solid rgb(20 184 166); outline-offset: 2px; }
.dark .poster-preview { border-color: rgb(51 65 85); background: rgb(15 23 42); }
.dark .share-link-label { color: rgb(226 232 240); }
.dark .share-link-field { border-color: rgb(51 65 85); background: rgb(15 23 42); }
.dark .share-link-field input { color: rgb(226 232 240); }
.dark .share-action { color: rgb(226 232 240); border-color: rgb(71 85 105); background: rgb(30 41 59); }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 700px) { .share-dialog-layout { grid-template-columns: 1fr; } .poster-preview { width: min(100%, 320px); min-height: 0; margin: 0 auto; } }
</style>
