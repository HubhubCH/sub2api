<template>
  <div class="creator-history">
    <section class="history-section">
      <div class="section-heading">
        <h2>后端生成记录</h2>
        <span>{{ backendRecords.length }}</span>
      </div>
      <div v-if="backendRecords.length === 0" class="empty-row">暂无后端生成记录</div>
      <button
        v-for="record in backendRecords"
        :key="record.task_id"
        type="button"
        class="history-row"
        @click="$emit('restoreBackend', record)"
      >
        <strong>{{ record.model || record.provider }}</strong>
        <span>{{ record.status }}</span>
        <p>{{ record.prompt_preview || '未保存提示词' }}</p>
      </button>
    </section>

    <section class="history-section">
      <div class="section-heading">
        <h2>本地文本/音频记录</h2>
        <span>{{ localRecords.length }}</span>
      </div>
      <div v-if="localRecords.length === 0" class="empty-row">暂无本地记录</div>
      <button
        v-for="record in localRecords"
        :key="record.id"
        type="button"
        class="history-row"
        @click="$emit('restoreLocal', record)"
      >
        <strong>{{ record.title }}</strong>
        <span>{{ record.kind }}</span>
        <p>{{ record.preview }}</p>
      </button>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { GenerationRecord } from '@/api/generationRecords'

export interface CreatorLocalRecord {
  id: string
  title: string
  kind: string
  preview: string
  content: string
  outputType: 'text' | 'audio'
  blob?: Blob
}

defineProps<{
  backendRecords: GenerationRecord[]
  localRecords: CreatorLocalRecord[]
}>()

defineEmits<{
  restoreBackend: [record: GenerationRecord]
  restoreLocal: [record: CreatorLocalRecord]
}>()
</script>

<style scoped>
.creator-history {
  display: grid;
  gap: 12px;
}

.history-section {
  overflow: hidden;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.94);
}

.section-heading {
  display: flex;
  min-height: 44px;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #e2e8f0;
  padding: 8px 12px;
}

.section-heading h2 {
  margin: 0;
  color: #0f172a;
  font-size: 15px;
}

.section-heading span {
  color: #0f766e;
  font-size: 12px;
  font-weight: 740;
}

.empty-row,
.history-row {
  padding: 11px 12px;
}

.empty-row {
  color: #94a3b8;
  font-size: 13px;
}

.history-row {
  display: grid;
  width: 100%;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4px 10px;
  border: 0;
  border-bottom: 1px solid #edf1f5;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.history-row:last-child {
  border-bottom: 0;
}

.history-row strong {
  color: #1e293b;
  font-size: 13px;
}

.history-row span {
  color: #0f766e;
  font-size: 12px;
  font-weight: 740;
}

.history-row p {
  grid-column: 1 / -1;
  margin: 0;
  color: #64748b;
  font-size: 12px;
}
</style>
