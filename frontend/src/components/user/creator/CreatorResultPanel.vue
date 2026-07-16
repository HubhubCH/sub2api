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
      <img
        v-else-if="output.type === 'image' && output.url"
        class="image-output"
        :src="output.url"
        alt="创作结果"
      />
      <video
        v-else-if="output.type === 'video' && output.url"
        class="video-output"
        :src="output.url"
        controls
        playsinline
      />
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
      <div v-else class="text-output">{{ output.content }}</div>
    </section>

    <section class="result-section">
      <div class="section-heading">
        <h2>创作记录</h2>
        <span>{{ records.length }}</span>
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
}

defineProps<{
  output: CreatorOutput | null
  records: GenerationRecord[]
  loading: boolean
  error: string
  status: string
}>()

defineEmits<{
  restore: [record: GenerationRecord]
  copy: [content: string]
  downloadAudio: []
}>()
</script>

<style scoped>
.creator-result-panel {
  display: grid;
  align-content: start;
  gap: 14px;
}

.result-section {
  overflow: hidden;
  border: 1px solid #e2e8f0;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.94);
}

.section-heading {
  display: flex;
  min-height: 52px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid #e2e8f0;
  padding: 10px 14px;
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
  min-height: 220px;
  padding: 18px;
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
  border-radius: 999px;
  background: #fff;
  color: #2563eb;
  cursor: pointer;
  font-size: 12px;
  font-weight: 740;
  padding: 7px 11px;
}

.audio-output {
  display: grid;
  gap: 12px;
  padding: 18px;
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
  max-height: 420px;
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
  padding: 13px 14px;
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
</style>
