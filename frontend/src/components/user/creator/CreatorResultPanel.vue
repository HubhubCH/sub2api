<template>
  <aside class="creator-result-panel">
    <section class="result-section result-main">
      <div class="section-heading">
        <h2>创作结果</h2>
        <span v-if="status">{{ status }}</span>
      </div>
      <div v-if="loading" class="result-empty">正在请求网关...</div>
      <div v-else-if="error" class="result-error">{{ error }}</div>
      <div v-else-if="!output" class="result-empty">提交后结果会显示在这里。</div>
      <div v-else-if="output.type === 'text'" class="text-output">
        <button type="button" data-test="creator-copy-result" class="copy-button" @click="$emit('copy', output.content)">
          复制文本
        </button>
        {{ output.content }}
      </div>
      <div v-else-if="output.type === 'image' && output.url" class="media-output">
        <button
          type="button"
          data-test="creator-image-preview"
          class="image-preview-button"
          aria-label="放大预览创作结果"
          @click="openImagePreview(output.url, '创作结果', 'creator-image.png')"
        >
          <img class="image-output" :src="output.url" alt="创作结果" />
          <span class="preview-indicator" aria-hidden="true"><Icon name="eye" size="sm" /></span>
        </button>
        <a class="download-link" :href="output.url" download="creator-image.png">下载图片</a>
      </div>
      <div v-else-if="output.type === 'video'" class="media-output">
        <video v-if="output.url" class="video-output" :src="output.url" controls playsinline />
        <div v-else class="media-placeholder">{{ output.content }}</div>
        <button
          v-if="output.videoRequestId"
          type="button"
          data-test="creator-download-video"
          class="download-link button-link"
          @click="$emit('downloadVideo', output.videoRequestId)"
        >
          下载视频
        </button>
        <a v-else-if="output.url" data-test="creator-download-video" class="download-link" :href="output.url" download="creator-video.mp4">下载视频</a>
      </div>
      <div v-else-if="output.type === 'batch'" class="batch-output">
        <p class="batch-summary">{{ output.content }}</p>
        <button
          v-if="output.batchId && output.batchReady"
          type="button"
          data-test="creator-download-batch"
          class="download-link button-link"
          @click="$emit('downloadBatch', output.batchId)"
        >
          下载全部图片
        </button>
        <div v-for="item in output.items || []" :key="item.id" class="batch-item">
          <div class="batch-item-heading">
            <strong>{{ item.label }}</strong>
            <span>{{ statusText(item.status) }}</span>
          </div>
          <p v-if="item.error" class="batch-item-error">{{ item.error }}</p>
          <button
            v-if="item.url"
            type="button"
            class="batch-preview-button"
            :aria-label="`放大预览${item.label}`"
            @click="openImagePreview(item.url, item.label, item.filename || `${item.id}.png`)"
          >
            <img data-test="creator-batch-image" :src="item.url" :alt="item.label" />
            <span class="preview-indicator" aria-hidden="true"><Icon name="eye" size="sm" /></span>
          </button>
          <a v-if="item.url" class="download-link" :href="item.url" :download="item.filename || `${item.id}.png`">下载图片</a>
        </div>
      </div>
      <div v-else class="text-output">{{ output.content }}</div>
    </section>

    <section class="result-section recent-section">
      <div class="section-heading recent-heading">
        <div class="heading-title">
          <h2>最近记录</h2>
          <span>{{ totalRecordCount }}</span>
        </div>
        <button type="button" class="view-all-button" @click="$emit('viewAll')">查看全部</button>
      </div>
      <div v-if="recordError" class="record-error">
        <span>{{ recordError }}</span>
        <button type="button" @click="$emit('reloadRecords')">重试</button>
      </div>
      <div v-if="totalRecordCount === 0" class="result-empty compact">暂无本工具生成记录</div>
      <div v-else class="record-list">
        <button
          v-for="record in recentLocalRecords"
          :key="record.id"
          type="button"
          class="record-item"
          @click="$emit('restoreLocal', record)"
        >
          <div class="record-heading">
            <span class="record-type">文案</span>
            <strong>{{ record.title }}</strong>
          </div>
          <span class="record-status status-completed">已完成</span>
          <p>{{ record.preview || '未保存内容' }}</p>
          <time :datetime="record.createdAt">{{ formatTime(record.createdAt) }}</time>
        </button>
        <button
          v-for="record in recentRecords"
          :key="record.task_id"
          type="button"
          class="record-item"
          @click="$emit('restore', record)"
        >
          <div class="record-heading">
            <span class="record-type">{{ recordTypeText(record) }}</span>
            <strong>{{ record.model || record.provider || '生成任务' }}</strong>
          </div>
          <span :class="['record-status', `status-${statusTone(record.status)}`]">{{ statusText(record.status) }}</span>
          <p>{{ record.prompt_preview || '未保存提示词' }}</p>
          <time :datetime="record.created_at">{{ formatTime(record.created_at) }}</time>
        </button>
      </div>
    </section>

    <CreatorImagePreviewDialog
      :src="previewImage.src"
      :alt="previewImage.alt"
      :download-name="previewImage.downloadName"
      @close="closeImagePreview"
    />
  </aside>
</template>

<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { GenerationRecord } from '@/api/generationRecords'
import Icon from '@/components/icons/Icon.vue'
import CreatorImagePreviewDialog from './CreatorImagePreviewDialog.vue'
import type { CreatorLocalRecord } from './CreatorHistoryPanel.vue'

export interface CreatorOutput {
  type: 'text' | 'image' | 'video' | 'batch'
  content: string
  url?: string
  batchId?: string
  batchReady?: boolean
  videoRequestId?: string
  items?: Array<{
    id: string
    label: string
    status: string
    url?: string
    filename?: string
    error?: string
  }>
}

const props = withDefaults(defineProps<{
  output: CreatorOutput | null
  records: GenerationRecord[]
  localRecords?: CreatorLocalRecord[]
  recordError: string
  loading: boolean
  error: string
  status: string
}>(), {
  localRecords: () => [],
})

defineEmits<{
  restore: [record: GenerationRecord]
  restoreLocal: [record: CreatorLocalRecord]
  copy: [content: string]
  downloadBatch: [batchId: string]
  downloadVideo: [requestId: string]
  reloadRecords: []
  viewAll: []
}>()

const recentLocalRecords = computed(() => props.localRecords.slice(0, 3))
const recentRecords = computed(() => props.records.slice(0, Math.max(0, 3 - recentLocalRecords.value.length)))
const totalRecordCount = computed(() => props.localRecords.length + props.records.length)
const previewImage = reactive({ src: '', alt: '', downloadName: 'creator-image.png' })

function openImagePreview(src: string, alt: string, downloadName: string): void {
  previewImage.src = src
  previewImage.alt = alt
  previewImage.downloadName = downloadName
}

function closeImagePreview(): void {
  previewImage.src = ''
}

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
    image: 'AI 生图', edit: '图片编辑', outpaint: '图片扩图',
    'batch-main': '批量主图', 'batch-clone': '批量克隆', watermark: '水印处理', video: 'AI 视频',
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
</script>

<style scoped>
.creator-result-panel {
  display: grid;
  height: 100%;
  min-height: 0;
  grid-template-rows: minmax(320px, 1fr) auto;
  align-content: start;
  gap: 12px;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.result-section {
  overflow: hidden;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.94);
}

.result-main {
  display: flex;
  min-height: 0;
  flex-direction: column;
}

.recent-section {
  display: flex;
  max-height: 254px;
  min-height: 0;
  flex-direction: column;
}

.section-heading {
  display: flex;
  min-height: 44px;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid #e2e8f0;
  padding: 8px 12px;
}

.section-heading h2 {
  margin: 0;
  color: #0f172a;
  font-size: 15px;
  font-weight: 780;
}

.section-heading > span,
.heading-title > span {
  color: #0f766e;
  font-size: 12px;
  font-weight: 740;
}

.heading-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.view-all-button {
  border: 0;
  background: transparent;
  color: #0f766e;
  cursor: pointer;
  font-size: 12px;
  font-weight: 740;
  padding: 5px 0;
}

.view-all-button:hover {
  color: #0d9488;
}

.view-all-button:focus-visible {
  border-radius: 4px;
  outline: 2px solid #14b8a6;
  outline-offset: 2px;
}

.result-empty,
.result-error,
.text-output {
  min-height: 180px;
  flex: 1;
  padding: 14px;
  color: #64748b;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.result-empty.compact {
  min-height: auto;
}

.result-error {
  color: #dc2626;
  font-weight: 700;
}

.text-output {
  color: #1e293b;
}

.copy-button {
  float: right;
  margin: 0 0 10px 12px;
  border: 1px solid #dbe4ee;
  border-radius: 6px;
  background: #fff;
  color: #2563eb;
  cursor: pointer;
  font-size: 12px;
  font-weight: 740;
  padding: 6px 9px;
}

.media-output,
.batch-output {
  display: grid;
  gap: 12px;
  padding-bottom: 14px;
}

.image-preview-button,
.batch-preview-button {
  position: relative;
  display: block;
  width: 100%;
  overflow: hidden;
  border: 0;
  background: transparent;
  cursor: zoom-in;
  padding: 0;
}

.image-preview-button:focus-visible,
.batch-preview-button:focus-visible {
  outline: 2px solid #14b8a6;
  outline-offset: -2px;
}

.preview-indicator {
  position: absolute;
  right: 10px;
  bottom: 10px;
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 6px;
  background: rgba(15, 23, 42, 0.76);
  color: #fff;
  opacity: 0;
  transition: opacity 150ms ease;
}

.image-preview-button:hover .preview-indicator,
.image-preview-button:focus-visible .preview-indicator,
.batch-preview-button:hover .preview-indicator,
.batch-preview-button:focus-visible .preview-indicator {
  opacity: 1;
}

.media-placeholder {
  display: grid;
  min-height: 220px;
  place-items: center;
  padding: 18px;
  color: #64748b;
  font-size: 13px;
  text-align: center;
}

.batch-output {
  padding: 14px;
}

.batch-summary {
  margin: 0;
  color: #475569;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
}

.record-error {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  background: #fff7ed;
  color: #c2410c;
  font-size: 12px;
}

.record-error button {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-weight: 760;
}

.batch-item {
  overflow: hidden;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
}

.batch-item-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 10px;
  color: #475569;
  font-size: 12px;
}

.batch-item img {
  display: block;
  width: 100%;
  max-height: 280px;
  object-fit: contain;
}

.batch-item-error {
  margin: 0;
  padding: 0 10px 10px;
  color: #dc2626;
  font-size: 12px;
}

.download-link {
  width: fit-content;
  margin: 0 14px;
  color: #2563eb;
  font-size: 12px;
  font-weight: 740;
  text-decoration: none;
}

.button-link {
  border: 0;
  background: transparent;
  cursor: pointer;
  margin: 0;
  padding: 0;
}

.image-output,
.video-output {
  display: block;
  width: 100%;
  max-height: min(520px, calc(100dvh - 300px));
  background: #f8fafc;
  object-fit: contain;
}

.record-list {
  min-height: 0;
  overflow-y: auto;
}

.record-item {
  display: grid;
  width: 100%;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 3px 10px;
  border: 0;
  border-bottom: 1px solid #edf1f5;
  background: transparent;
  cursor: pointer;
  padding: 8px 12px;
  text-align: left;
}

.record-item:last-child {
  border-bottom: 0;
}

.record-item:hover {
  background: #f8fafc;
}

.record-item:focus-visible {
  outline: 2px solid #14b8a6;
  outline-offset: -2px;
}

.record-heading {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
}

.record-heading strong {
  min-width: 0;
  overflow: hidden;
  color: #1e293b;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.record-type {
  flex: none;
  border-radius: 4px;
  background: #eef7f6;
  color: #0f766e;
  font-size: 10px;
  padding: 2px 5px;
}

.record-status {
  align-self: center;
  font-size: 11px;
  font-weight: 740;
}

.status-pending { color: #c2410c; }
.status-running { color: #2563eb; }
.status-completed { color: #0f766e; }
.status-failed { color: #dc2626; }
.status-muted { color: #64748b; }

.record-item p {
  min-width: 0;
  overflow: hidden;
  margin: 0;
  color: #64748b;
  font-size: 11px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.record-item time {
  color: #94a3b8;
  font-size: 10px;
  white-space: nowrap;
}

:global(.dark) .result-section {
  border-color: #334155;
  background: rgba(15, 23, 42, 0.92);
}

:global(.dark) .section-heading,
:global(.dark) .record-item {
  border-color: #334155;
}

:global(.dark) .section-heading h2,
:global(.dark) .text-output,
:global(.dark) .record-heading strong {
  color: #f8fafc;
}

:global(.dark) .result-empty,
:global(.dark) .record-item p,
:global(.dark) .record-item time {
  color: #94a3b8;
}

:global(.dark) .record-item:hover {
  background: #1e293b;
}

:global(.dark) .record-type {
  background: #193d3a;
  color: #7dd3c7;
}

:global(.dark) .copy-button {
  border-color: #334155;
  background: #0f172a;
}

@media (max-width: 1180px) {
  .creator-result-panel {
    height: auto;
    grid-template-rows: auto;
    overflow: visible;
  }

  .recent-section {
    max-height: none;
  }
}
</style>
