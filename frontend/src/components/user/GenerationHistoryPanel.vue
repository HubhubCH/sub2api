<template>
  <aside class="generation-history">
    <div class="history-heading">
      <h2>
        生成记录
        <span class="history-count">{{ records.length }}</span>
      </h2>
      <button
        type="button"
        class="refresh-button"
        title="刷新生成记录"
        aria-label="刷新生成记录"
        :disabled="loading"
        @click="loadRecords"
      >
        <Icon name="refresh" size="sm" :class="{ 'animate-spin': loading }" />
      </button>
    </div>
    <div v-if="loading && records.length === 0" class="history-empty">正在加载记录…</div>
    <div v-else-if="records.length === 0" class="history-empty">暂无生成记录</div>
    <div v-else class="history-list">
      <article
        v-for="record in records"
        :key="record.task_id"
        class="history-item"
      >
        <button type="button" class="history-item-main" @click="openRecord(record)">
          <img
            v-if="mediaType === 'image' && previewUrls[record.task_id]"
            class="history-preview"
            :src="previewUrls[record.task_id]"
            :alt="record.prompt_preview || '生成图片预览'"
          />
          <div class="history-item-top">
            <strong>{{ record.model || (mediaType === 'image' ? '图片任务' : '视频任务') }}</strong>
            <span :class="`status-${record.status}`">{{ statusText(record.status) }}</span>
          </div>
          <p>{{ record.prompt_preview || '未保存提示词预览' }}</p>
          <time>{{ formatTime(record.created_at) }}</time>
          <small v-if="record.error_message">{{ record.error_message }}</small>
        </button>
        <button
          v-if="hasDownload(record)"
          type="button"
          class="history-download"
          :disabled="downloadingTaskId === record.task_id"
          title="下载生成结果"
          @click="downloadRecord(record)"
        >
          <Icon name="download" size="sm" />
          <span>{{ downloadingTaskId === record.task_id ? '下载中' : '下载' }}</span>
        </button>
      </article>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { generationRecordsAPI, type GenerationRecord } from '@/api/generationRecords'
import Icon from '@/components/icons/Icon.vue'

const props = defineProps<{ mediaType: 'image' | 'video' }>()
const emit = defineEmits<{ select: [record: GenerationRecord]; pending: [records: GenerationRecord[]] }>()
const allRecords = ref<GenerationRecord[]>([])
const loading = ref(false)
const previewUrls = ref<Record<string, string>>({})
const downloadingTaskId = ref('')
const ownedPreviewUrls = new Set<string>()
let refreshTimer: number | null = null
let initialImageSelectionDone = false
const records = computed(() => allRecords.value.filter((record) => record.media_type === props.mediaType))

function hasDownload(record: GenerationRecord): boolean {
  return record.status === 'completed' && Boolean(record.result?.files?.length || record.result?.urls?.length)
}

function releasePreview(url: string) {
  if (!ownedPreviewUrls.has(url)) return
  URL.revokeObjectURL(url)
  ownedPreviewUrls.delete(url)
}

async function syncImagePreviews(imageRecords: GenerationRecord[]) {
  const activeTaskIDs = new Set(imageRecords.map((record) => record.task_id))
  const next = { ...previewUrls.value }
  for (const [taskID, url] of Object.entries(next)) {
    if (activeTaskIDs.has(taskID)) continue
    releasePreview(url)
    delete next[taskID]
  }
  for (const record of imageRecords) {
    if (next[record.task_id] || !hasDownload(record)) continue
    try {
      if (record.result?.files?.length) {
        const blob = await generationRecordsAPI.content(record.task_id, 0)
        const url = URL.createObjectURL(blob)
        ownedPreviewUrls.add(url)
        next[record.task_id] = url
      } else if (record.result?.urls?.[0]) {
        next[record.task_id] = record.result.urls[0]
      }
    } catch {
      // 单个缩略图加载失败不影响其他生成记录。
    }
  }
  previewUrls.value = next
}

async function loadRecords() {
  loading.value = true
  try {
    allRecords.value = await generationRecordsAPI.list(5)
    if (props.mediaType === 'image') {
      await syncImagePreviews(records.value)
      if (!initialImageSelectionDone) {
        initialImageSelectionDone = true
        const latest = records.value.find(hasDownload)
        if (latest) emit('select', latest)
      }
    }
    if (props.mediaType === 'video') emit('pending', records.value.filter((record) => ['running', 'submitted'].includes(record.status)).slice(0, 5))
  }
  catch { allRecords.value = [] }
  finally { loading.value = false }
}

async function openRecord(record: GenerationRecord) {
  emit('select', record)
}

function recordFilename(record: GenerationRecord): string {
  return record.result?.files?.[0] || `${record.media_type}-${record.task_id}`
}

async function downloadRecord(record: GenerationRecord) {
  if (!hasDownload(record) || downloadingTaskId.value) return
  downloadingTaskId.value = record.task_id
  let objectURL = ''
  try {
    if (record.result?.files?.length) {
      const blob = await generationRecordsAPI.content(record.task_id, 0)
      objectURL = URL.createObjectURL(blob)
    }
    const url = objectURL || record.result?.urls?.[0]
    if (!url) return
    const link = document.createElement('a')
    link.href = url
    link.download = recordFilename(record)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  } finally {
    if (objectURL) URL.revokeObjectURL(objectURL)
    downloadingTaskId.value = ''
  }
}

function statusText(status: string) {
  return ({ running: '生成中', queued: '排队中', submitted: '处理中', processing: '生成中', completed: '已完成', failed: '失败' } as Record<string, string>)[status] || status
}
function formatTime(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }) }

onMounted(() => {
  void loadRecords()
  refreshTimer = window.setInterval(() => { if (records.value.some((item) => ['running', 'submitted'].includes(item.status))) void loadRecords() }, 5000)
})
onBeforeUnmount(() => {
  if (refreshTimer !== null) window.clearInterval(refreshTimer)
  for (const url of ownedPreviewUrls) URL.revokeObjectURL(url)
  ownedPreviewUrls.clear()
})
</script>

<style scoped>
.generation-history {
  position: sticky;
  top: 88px;
  display: flex;
  min-width: 0;
  max-height: calc(100vh - 112px);
  overflow: hidden;
  flex-direction: column;
  border: 1px solid #e2e8f0;
  border-radius: 20px;
  background: #fff;
  box-shadow: 0 16px 35px rgba(24, 39, 75, 0.08);
}

.history-heading,
.history-item-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.history-heading {
  min-height: 58px;
  flex: 0 0 auto;
  border-bottom: 1px solid #e2e8f0;
  padding: 10px 14px 10px 16px;
}

.history-heading h2 {
  display: flex;
  margin: 0;
  align-items: center;
  gap: 8px;
  color: #0f172a;
  font-size: 16px;
  font-weight: 760;
}

.history-count {
  display: inline-flex;
  min-width: 22px;
  height: 22px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: #f1f5f9;
  color: #64748b;
  font-size: 11px;
}

.refresh-button {
  display: inline-grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fff;
  color: #2563eb;
  cursor: pointer;
}

.refresh-button:disabled {
  cursor: wait;
  opacity: 0.55;
}

.history-list {
  min-height: 0;
  overflow-y: auto;
  padding: 0 14px 8px;
}

.history-item {
  position: relative;
  width: 100%;
  border-bottom: 1px solid #edf1f5;
  background: transparent;
  padding: 14px 2px;
}

.history-item:last-child {
  border-bottom: 0;
}

.history-item:hover {
  background: #f8fafc;
}

.history-item-main {
  display: block;
  width: 100%;
  border: 0;
  background: transparent;
  cursor: pointer;
  padding: 0;
  text-align: left;
}

.history-preview {
  width: 100%;
  height: 132px;
  margin-bottom: 10px;
  border-radius: 10px;
  object-fit: cover;
}

.history-download {
  display: inline-flex;
  min-height: 34px;
  margin-top: 10px;
  align-items: center;
  gap: 6px;
  border: 1px solid #dbe4ee;
  border-radius: 9px;
  background: #fff;
  color: #2563eb;
  cursor: pointer;
  padding: 6px 10px;
  font-size: 12px;
}

.history-download:disabled {
  cursor: wait;
  opacity: 0.55;
}

.history-item strong {
  min-width: 0;
  overflow: hidden;
  color: #1e293b;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-item-top > span {
  flex: none;
  border-radius: 999px;
  background: #eef3f7;
  padding: 3px 7px;
  font-size: 11px;
}

.history-item p {
  display: -webkit-box;
  overflow: hidden;
  margin: 7px 0;
  -webkit-box-orient: vertical;
  color: #526174;
  font-size: 12px;
  -webkit-line-clamp: 2;
  line-height: 1.45;
}

.history-item time,
.history-item small {
  display: block;
  color: #99a4b2;
  font-size: 11px;
}

.history-item small {
  margin-top: 6px;
  color: #d64b4b;
}

.status-completed { color: #11856f !important; background: #dcfaf4 !important; }
.status-failed { color: #c33 !important; background: #fff0f0 !important; }
.status-running,
.status-queued,
.status-submitted,
.status-processing { color: #2563eb !important; background: #edf4ff !important; }

.history-empty {
  padding: 40px 16px;
  color: #99a4b2;
  font-size: 13px;
  text-align: center;
}

:global(.dark) .generation-history {
  border-color: #2b3647;
  background: #111827;
}

:global(.dark) .history-heading,
:global(.dark) .history-item {
  border-color: #2b3647;
}

:global(.dark) .history-heading h2,
:global(.dark) .history-item strong {
  color: #f8fafc;
}

:global(.dark) .refresh-button {
  border-color: #334155;
  background: #0f172a;
}

:global(.dark) .history-download {
  border-color: #334155;
  background: #0f172a;
}

:global(.dark) .history-item:hover,
:global(.dark) .history-count {
  background: #1e293b;
}

:global(.dark) .history-item p {
  color: #b8c2d0;
}

@media (max-width: 1500px) {
  .generation-history {
    position: static;
    max-height: none;
  }

  .history-list {
    display: grid;
    overflow: visible;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    column-gap: 18px;
  }
}

@media (max-width: 900px) {
  .history-list {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .history-list {
    grid-template-columns: 1fr;
  }
}
</style>
