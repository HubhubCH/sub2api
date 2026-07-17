<template>
  <div class="creator-history">
    <section class="history-section" aria-labelledby="backend-history-title">
      <div class="section-heading">
        <div>
          <h2 id="backend-history-title">生成记录</h2>
          <p>图片与视频生成任务</p>
        </div>
        <span>{{ visibleBackendRecords.length }} 条</span>
      </div>

      <div v-if="visibleBackendRecords.length === 0" class="empty-row">暂无生成记录</div>
      <div v-else class="history-grid">
        <article
          v-for="record in visibleBackendRecords"
          :key="record.task_id"
          class="history-card"
        >
          <div v-if="hasPreviewSource(record)" class="record-preview">
            <button
              v-if="record.media_type === 'image' && previewUrls[record.task_id]"
              type="button"
              class="record-preview-button"
              :aria-label="`放大预览${record.prompt_preview || '生成图片'}`"
              @click="openImagePreview(record)"
            >
              <img
                :src="previewUrls[record.task_id]"
                :alt="record.prompt_preview || '生成图片预览'"
                loading="lazy"
                @error="handlePreviewError(record)"
              />
            </button>
            <video
              v-else-if="record.media_type === 'video' && previewUrls[record.task_id]"
              :src="previewUrls[record.task_id]"
              :aria-label="record.prompt_preview || '生成视频预览'"
              controls
              playsinline
              preload="metadata"
              @error="handlePreviewError(record)"
            />
            <button
              v-else-if="record.media_type === 'video' && record.result?.files?.[0] && !previewErrors[record.task_id]"
              type="button"
              class="load-video-preview"
              :disabled="previewLoading[record.task_id]"
              @click="loadFilePreview(record)"
            >
              {{ previewLoading[record.task_id] ? '正在加载视频' : '加载视频预览' }}
            </button>
            <span v-else class="preview-placeholder">
              {{ previewErrors[record.task_id] ? '预览加载失败' : '正在加载图片' }}
            </span>
            <span class="preview-type">{{ recordTypeText(record) }}</span>
          </div>

          <button type="button" class="history-card-action" @click="$emit('restoreBackend', record)">
            <div class="record-heading">
              <strong>{{ record.model || record.provider || '生成任务' }}</strong>
              <span :class="['status-badge', `status-${statusTone(record.status)}`]">
                {{ statusText(record.status) }}
              </span>
            </div>
            <div class="record-meta">
              <span>{{ recordTypeText(record) }}</span>
              <time :datetime="record.created_at">{{ formatTime(record.created_at) }}</time>
            </div>
            <p class="record-prompt">{{ record.prompt_preview || '未保存提示词' }}</p>
            <p v-if="record.error_message" class="record-error">{{ record.error_message }}</p>
          </button>
          <button
            type="button"
            class="delete-record-button"
            :aria-label="`删除${record.prompt_preview || '生成记录'}`"
            title="删除记录"
            data-test="creator-delete-backend-record"
            @click.stop="$emit('deleteBackend', record)"
          >
            <Icon name="trash" size="sm" />
          </button>
        </article>
      </div>
    </section>

    <section class="history-section" aria-labelledby="local-history-title">
      <div class="section-heading">
        <div>
          <h2 id="local-history-title">本地文案记录</h2>
          <p>最多 10 条，每条保留 3 天</p>
        </div>
        <span>{{ visibleLocalRecords.length }} 条</span>
      </div>

      <div v-if="visibleLocalRecords.length === 0" class="empty-row">暂无本地文案记录</div>
      <div v-else class="history-grid local-grid">
        <article
          v-for="record in visibleLocalRecords"
          :key="record.id"
          class="history-card local-card"
        >
          <button type="button" class="history-card-action" @click="$emit('restoreLocal', record)">
            <div class="record-heading">
              <strong>{{ record.title }}</strong>
              <span class="status-badge status-completed">本地保存</span>
            </div>
            <div class="record-meta">
              <span>{{ record.kind || '文本' }}</span>
              <time :datetime="record.createdAt">{{ formatLocalTime(record) }}</time>
            </div>
            <p class="record-prompt">{{ record.preview || record.content || '暂无内容预览' }}</p>
          </button>
          <button
            type="button"
            class="delete-record-button"
            :aria-label="`删除${record.title || '本地文案记录'}`"
            title="删除记录"
            data-test="creator-delete-local-record"
            @click.stop="$emit('deleteLocal', record)"
          >
            <Icon name="trash" size="sm" />
          </button>
        </article>
      </div>
    </section>

    <CreatorImagePreviewDialog
      :src="previewImage.src"
      :alt="previewImage.alt"
      :download-name="previewImage.downloadName"
      @close="previewImage.src = ''"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { generationRecordsAPI, type GenerationRecord } from '@/api/generationRecords'
import Icon from '@/components/icons/Icon.vue'
import CreatorImagePreviewDialog from './CreatorImagePreviewDialog.vue'

export interface CreatorLocalRecord {
  id: string
  toolId: 'product-copy'
  title: string
  kind: string
  preview: string
  content: string
  outputType: 'text'
  createdAt?: string
}

const props = defineProps<{
  backendRecords: GenerationRecord[]
  localRecords: CreatorLocalRecord[]
}>()

defineEmits<{
  restoreBackend: [record: GenerationRecord]
  restoreLocal: [record: CreatorLocalRecord]
  deleteBackend: [record: GenerationRecord]
  deleteLocal: [record: CreatorLocalRecord]
}>()

const visibleBackendRecords = computed(() => props.backendRecords.slice(0, 10))
const visibleLocalRecords = computed(() => props.localRecords.slice(0, 10))
const previewUrls = ref<Record<string, string>>({})
const previewErrors = ref<Record<string, boolean>>({})
const previewLoading = ref<Record<string, boolean>>({})
const previewImage = reactive({ src: '', alt: '', downloadName: 'creator-image.png' })
const previewSources = new Map<string, string>()
const ownedPreviewUrls = new Map<string, string>()
let previewDisposed = false

function hasPreviewSource(record: GenerationRecord): boolean {
  return Boolean(record.result?.urls?.[0] || record.result?.files?.[0])
}

function releaseOwnedPreview(taskId: string): void {
  const url = ownedPreviewUrls.get(taskId)
  if (url) URL.revokeObjectURL(url)
  ownedPreviewUrls.delete(taskId)
}

function openImagePreview(record: GenerationRecord): void {
  const src = previewUrls.value[record.task_id]
  if (!src) return
  previewImage.src = src
  previewImage.alt = record.prompt_preview || '生成图片预览'
  previewImage.downloadName = `${record.task_id}.png`
}

function setPreviewFlag(target: typeof previewErrors, taskId: string, value: boolean): void {
  target.value = { ...target.value, [taskId]: value }
}

async function loadFilePreview(record: GenerationRecord): Promise<void> {
  const file = record.result?.files?.[0]
  if (!file || previewLoading.value[record.task_id]) return
  const expectedSource = `file:${file}`
  setPreviewFlag(previewLoading, record.task_id, true)
  setPreviewFlag(previewErrors, record.task_id, false)
  try {
    const blob = await generationRecordsAPI.content(record.task_id, 0)
    const remainsVisible = visibleBackendRecords.value.some((item) => item.task_id === record.task_id)
    if (previewDisposed || !remainsVisible || previewSources.get(record.task_id) !== expectedSource) return
    releaseOwnedPreview(record.task_id)
    const objectUrl = URL.createObjectURL(blob)
    ownedPreviewUrls.set(record.task_id, objectUrl)
    previewUrls.value = { ...previewUrls.value, [record.task_id]: objectUrl }
  } catch {
    if (!previewDisposed && previewSources.get(record.task_id) === expectedSource) setPreviewFlag(previewErrors, record.task_id, true)
  } finally {
    if (!previewDisposed) setPreviewFlag(previewLoading, record.task_id, false)
  }
}

function handlePreviewError(record: GenerationRecord): void {
  const currentSource = previewSources.get(record.task_id) || ''
  const nextUrls = { ...previewUrls.value }
  delete nextUrls[record.task_id]
  previewUrls.value = nextUrls
  releaseOwnedPreview(record.task_id)
  const file = record.result?.files?.[0]
  if (!file) {
    setPreviewFlag(previewErrors, record.task_id, true)
    return
  }
  if (!currentSource.startsWith('url:')) {
    setPreviewFlag(previewErrors, record.task_id, true)
    return
  }
  previewSources.set(record.task_id, `file:${file}`)
  if (record.media_type === 'image') void loadFilePreview(record)
}

function syncPreviews(records: GenerationRecord[]): void {
  const activeTaskIds = new Set(records.map((record) => record.task_id))
  const nextUrls: Record<string, string> = {}

  for (const taskId of [...previewSources.keys()]) {
    if (activeTaskIds.has(taskId)) continue
    releaseOwnedPreview(taskId)
    previewSources.delete(taskId)
  }

  for (const record of records) {
    const directUrl = record.result?.urls?.[0]
    const file = record.result?.files?.[0]
    const source = directUrl ? `url:${directUrl}` : file ? `file:${file}` : ''
    if (!source) {
      releaseOwnedPreview(record.task_id)
      previewSources.delete(record.task_id)
      continue
    }

    const existingUrl = previewUrls.value[record.task_id]
    if (previewSources.get(record.task_id) === source && existingUrl) {
      nextUrls[record.task_id] = existingUrl
      continue
    }

    releaseOwnedPreview(record.task_id)
    previewSources.set(record.task_id, source)
    setPreviewFlag(previewErrors, record.task_id, false)
    if (directUrl) {
      nextUrls[record.task_id] = directUrl
      continue
    }
    if (record.media_type === 'image') void loadFilePreview(record)
  }

  previewUrls.value = nextUrls
}

watch(visibleBackendRecords, syncPreviews, { immediate: true, deep: true })

onBeforeUnmount(() => {
  previewDisposed = true
  for (const taskId of ownedPreviewUrls.keys()) releaseOwnedPreview(taskId)
  previewSources.clear()
})

const STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  pending: '排队中',
  submitted: '已提交',
  running: '生成中',
  processing: '生成中',
  completed: '已完成',
  succeeded: '已完成',
  success: '已完成',
  done: '已完成',
  failed: '失败',
  error: '失败',
  cancelled: '已取消',
  canceled: '已取消',
  expired: '已过期',
}

function statusText(status: string): string {
  return STATUS_LABELS[status.toLowerCase()] || status || '未知状态'
}

function statusTone(status: string): 'pending' | 'running' | 'completed' | 'failed' | 'muted' {
  const value = status.toLowerCase()
  if (['queued', 'pending', 'submitted'].includes(value)) return 'pending'
  if (['running', 'processing'].includes(value)) return 'running'
  if (['completed', 'succeeded', 'success', 'done'].includes(value)) return 'completed'
  if (['failed', 'error'].includes(value)) return 'failed'
  return 'muted'
}

function mediaTypeText(mediaType: GenerationRecord['media_type']): string {
  return mediaType === 'video' ? '视频' : '图片'
}

function recordTypeText(record: GenerationRecord): string {
  const labels: Record<string, string> = {
    image: 'AI 生图',
    edit: '图片编辑',
    outpaint: '图片扩图',
    'batch-main': '批量主图',
    'batch-clone': '批量克隆',
    watermark: '水印处理',
    video: 'AI 视频',
  }
  return labels[record.creator_tool || ''] || mediaTypeText(record.media_type)
}

function formatTime(value?: string): string {
  if (!value) return '时间未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function formatLocalTime(record: CreatorLocalRecord): string {
  if (record.createdAt) return formatTime(record.createdAt)
  const timestamp = Number(record.id.match(/^local-(\d+)/)?.[1])
  return Number.isFinite(timestamp) && timestamp > 0 ? formatTime(new Date(timestamp).toISOString()) : '本地记录'
}
</script>

<style scoped>
.creator-history {
  display: grid;
  width: 100%;
  min-width: 0;
  align-content: start;
  gap: 24px;
}

.history-section {
  min-width: 0;
}

.section-heading {
  display: flex;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
  border-bottom: 1px solid #dbe4ee;
  padding: 0 2px 10px;
}

.section-heading h2,
.section-heading p {
  margin: 0;
}

.section-heading h2 {
  color: #0f172a;
  font-size: 16px;
  font-weight: 780;
}

.section-heading p {
  margin-top: 3px;
  color: #94a3b8;
  font-size: 12px;
}

.section-heading > span {
  flex: none;
  color: #0f766e;
  font-size: 12px;
  font-weight: 740;
}

.history-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.history-card {
  position: relative;
  display: flex;
  min-width: 0;
  overflow: hidden;
  flex-direction: column;
  border: 1px solid #dbe4ee;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.94);
  color: inherit;
}

.delete-record-button {
  position: absolute;
  z-index: 2;
  right: 8px;
  bottom: 8px;
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid #fecaca;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.94);
  color: #dc2626;
  cursor: pointer;
}

.delete-record-button:hover,
.delete-record-button:focus-visible {
  border-color: #ef4444;
  background: #fef2f2;
  outline: none;
}

.history-card:hover,
.history-card:focus-within {
  border-color: #9edbd3;
  background: #f8fffd;
}

.history-card-action {
  display: flex;
  width: 100%;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0;
  text-align: left;
}

.history-card-action:focus-visible {
  outline: 2px solid #14b8a6;
  outline-offset: -2px;
}

.record-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-bottom: 1px solid #e2e8f0;
  background: #f1f5f9;
}

.record-preview-button {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: transparent;
  cursor: zoom-in;
  padding: 0;
}

.record-preview-button:focus-visible {
  outline: 2px solid #14b8a6;
  outline-offset: -2px;
}

.record-preview img,
.record-preview video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.load-video-preview {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  border: 0;
  background: transparent;
  color: #0f766e;
  cursor: pointer;
  font-size: 12px;
  font-weight: 740;
}

.load-video-preview:disabled {
  cursor: wait;
  opacity: 0.7;
}

.load-video-preview:focus-visible {
  outline: 2px solid #14b8a6;
  outline-offset: -2px;
}

.preview-placeholder {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  color: #94a3b8;
  font-size: 12px;
}

.preview-type {
  position: absolute;
  right: 8px;
  top: 8px;
  pointer-events: none;
  border-radius: 4px;
  background: rgba(15, 23, 42, 0.78);
  color: #fff;
  font-size: 11px;
  padding: 3px 6px;
}

.record-heading,
.record-meta {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-right: 12px;
  padding-left: 12px;
}

.record-heading {
  padding-top: 12px;
}

.record-heading strong {
  min-width: 0;
  overflow: hidden;
  color: #1e293b;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-badge {
  flex: none;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 740;
  padding: 3px 7px;
}

.status-pending { background: #fff7ed; color: #c2410c; }
.status-running { background: #eff6ff; color: #2563eb; }
.status-completed { background: #e6f9f4; color: #0f766e; }
.status-failed { background: #fef2f2; color: #dc2626; }
.status-muted { background: #f1f5f9; color: #64748b; }

.record-meta {
  margin-top: 7px;
  color: #94a3b8;
  font-size: 11px;
}

.record-meta time {
  white-space: nowrap;
}

.record-prompt,
.record-error {
  display: -webkit-box;
  overflow: hidden;
  margin: 9px 48px 12px 12px;
  -webkit-box-orient: vertical;
  color: #64748b;
  font-size: 12px;
  -webkit-line-clamp: 2;
  line-height: 1.5;
}

.record-error {
  margin-top: -4px;
  color: #dc2626;
}

.local-card {
  min-height: 132px;
  cursor: pointer;
  padding: 0;
  text-align: left;
}

.local-card:focus-visible {
  outline: 2px solid #14b8a6;
  outline-offset: 2px;
}

.empty-row {
  display: grid;
  min-height: 120px;
  place-items: center;
  border: 1px dashed #cbd5e1;
  border-radius: 8px;
  color: #94a3b8;
  font-size: 13px;
}

:global(.dark) .section-heading {
  border-color: #334155;
}

:global(.dark) .section-heading h2,
:global(.dark) .record-heading strong {
  color: #f8fafc;
}

:global(.dark) .history-card {
  border-color: #334155;
  background: rgba(15, 23, 42, 0.92);
}

:global(.dark) .history-card:hover {
  border-color: #3b827b;
  background: #172033;
}

:global(.dark) .delete-record-button {
  border-color: #7f1d1d;
  background: rgba(15, 23, 42, 0.94);
  color: #fca5a5;
}

:global(.dark) .record-preview {
  border-color: #334155;
  background: #0f172a;
}

:global(.dark) .record-prompt,
:global(.dark) .record-meta,
:global(.dark) .section-heading p {
  color: #94a3b8;
}

:global(.dark) .empty-row {
  border-color: #475569;
}

@media (max-width: 720px) {
  .creator-history {
    gap: 20px;
  }

  .history-grid {
    grid-template-columns: 1fr;
  }
}
</style>
