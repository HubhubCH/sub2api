<template>
  <aside class="creator-result-panel">
    <section class="result-section">
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
        <img class="image-output" :src="output.url" alt="创作结果" />
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
      <div v-else-if="output.type === 'audio' && output.url" class="audio-output">
        <audio :src="output.url" controls />
        <div class="audio-actions">
          <button type="button" class="copy-button" @click="$emit('downloadAudio')">下载音频</button>
          <button v-if="output.content" type="button" data-test="creator-copy-result" class="copy-button" @click="$emit('copy', output.content)">
            复制文稿
          </button>
        </div>
        <p v-if="output.content">{{ output.content }}</p>
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
            <span>{{ item.status }}</span>
          </div>
          <p v-if="item.error" class="batch-item-error">{{ item.error }}</p>
          <img v-if="item.url" data-test="creator-batch-image" :src="item.url" :alt="item.label" />
          <a v-if="item.url" class="download-link" :href="item.url" :download="item.filename || `${item.id}.png`">下载图片</a>
        </div>
      </div>
      <div v-else class="text-output">{{ output.content }}</div>
    </section>

    <section class="result-section">
      <div class="section-heading">
        <h2>创作记录</h2>
        <span>{{ records.length }}</span>
      </div>
      <div v-if="recordError" class="record-error">
        <span>{{ recordError }}</span>
        <button type="button" @click="$emit('reloadRecords')">重试</button>
      </div>
      <div v-if="records.length === 0" class="result-empty compact">暂无创作记录</div>
      <button
        v-for="record in records"
        :key="record.task_id"
        type="button"
        class="record-item"
        @click="$emit('restore', record)"
      >
        <strong>{{ record.model || record.provider }}</strong>
        <span>{{ record.status }}</span>
        <p>{{ record.prompt_preview || '未保存提示词' }}</p>
      </button>
    </section>
  </aside>
</template>

<script setup lang="ts">
import type { GenerationRecord } from '@/api/generationRecords'

export interface CreatorOutput {
  type: 'text' | 'image' | 'video' | 'audio' | 'batch'
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

defineProps<{
  output: CreatorOutput | null
  records: GenerationRecord[]
  recordError: string
  loading: boolean
  error: string
  status: string
}>()

defineEmits<{
  restore: [record: GenerationRecord]
  copy: [content: string]
  downloadAudio: []
  downloadBatch: [batchId: string]
  downloadVideo: [requestId: string]
  reloadRecords: []
}>()
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

.result-section:first-child {
  display: flex;
  min-height: 0;
  flex-direction: column;
}

.section-heading {
  display: flex;
  min-height: 44px;
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

.section-heading span {
  color: #0f766e;
  font-size: 12px;
  font-weight: 740;
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

.audio-output {
  display: grid;
  gap: 12px;
  padding: 14px;
}

.media-output,
.batch-output {
  display: grid;
  gap: 12px;
  padding-bottom: 14px;
}

.media-placeholder {
  min-height: 220px;
  display: grid;
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
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
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

.audio-output audio {
  width: 100%;
}

.audio-output p {
  margin: 0;
  color: #475569;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
}

.audio-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.image-output,
.video-output {
  display: block;
  width: 100%;
  max-height: min(520px, calc(100dvh - 300px));
  background: #f8fafc;
  object-fit: contain;
}

.record-item {
  display: grid;
  width: 100%;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px 10px;
  border: 0;
  border-bottom: 1px solid #edf1f5;
  background: transparent;
  cursor: pointer;
  padding: 11px 12px;
  text-align: left;
}

.record-item:last-child {
  border-bottom: 0;
}

.record-item:hover {
  background: #f8fafc;
}

.record-item strong {
  min-width: 0;
  overflow: hidden;
  color: #1e293b;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.record-item span {
  color: #0f766e;
  font-size: 11px;
  font-weight: 740;
}

.record-item p {
  grid-column: 1 / -1;
  margin: 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.45;
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
:global(.dark) .record-item strong {
  color: #f8fafc;
}

:global(.dark) .result-empty,
:global(.dark) .record-item p {
  color: #94a3b8;
}

:global(.dark) .record-item:hover {
  background: #1e293b;
}

@media (max-width: 1180px) {
  .creator-result-panel {
    height: auto;
    grid-template-rows: auto;
    overflow: visible;
  }
}
</style>
