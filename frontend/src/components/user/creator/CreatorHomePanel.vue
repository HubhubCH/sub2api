<template>
  <div class="creator-home">
    <section class="home-section">
      <div class="section-heading">
        <h2>创作工具</h2>
        <span>{{ tools.length }} 个模块</span>
      </div>
      <div class="tool-grid">
        <button
          v-for="tool in tools"
          :key="tool.id"
          type="button"
          class="tool-card"
          @click="$emit('select', tool.id)"
        >
          <Icon :name="tool.icon" size="md" />
          <strong>{{ tool.label }}</strong>
          <span>{{ tool.badge }}</span>
        </button>
      </div>
    </section>

    <section class="home-section">
      <div class="section-heading">
        <h2>最近记录</h2>
        <div class="heading-actions">
          <span>{{ recent.length }}</span>
          <button type="button" @click="$emit('openHistory')">查看全部</button>
        </div>
      </div>
      <div v-if="recent.length === 0" class="empty-row">暂无生成记录</div>
      <button
        v-for="record in recent"
        :key="record.id"
        type="button"
        class="recent-row"
        @click="$emit('openHistory')"
      >
        <strong>{{ record.title }}</strong>
        <span>{{ record.kind }}</span>
        <p>{{ record.preview }}</p>
      </button>
    </section>
  </div>
</template>

<script setup lang="ts">
import Icon from '@/components/icons/Icon.vue'

export interface CreatorHomeTool {
  id: string
  label: string
  badge: string
  icon: 'home' | 'chat' | 'edit' | 'globe' | 'sparkles' | 'grid' | 'copy' | 'upload' | 'play' | 'cloud' | 'clock' | 'arrowsUpDown'
}

export interface CreatorRecentItem {
  id: string
  title: string
  kind: string
  preview: string
}

defineProps<{
  tools: CreatorHomeTool[]
  recent: CreatorRecentItem[]
}>()

defineEmits<{
  select: [toolId: string]
  openHistory: []
}>()
</script>

<style scoped>
.creator-home {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(300px, 0.75fr);
  align-items: start;
  gap: 24px;
}

.home-section {
  min-width: 0;
}

.section-heading {
  display: flex;
  min-height: 44px;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #e2e8f0;
  padding: 8px 2px 10px;
}

.section-heading h2 {
  margin: 0;
  color: #0f172a;
  font-size: 15px;
}

.section-heading span,
.heading-actions button {
  color: #0f766e;
  font-size: 12px;
  font-weight: 740;
}

.heading-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.heading-actions button {
  border: 0;
  background: transparent;
  cursor: pointer;
  padding: 4px 0;
}

.tool-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  padding: 12px 0;
}

.tool-card {
  display: grid;
  min-height: 72px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  border: 1px solid #dbe4ee;
  border-radius: 6px;
  background: #fff;
  color: #0f766e;
  cursor: pointer;
  padding: 12px;
  text-align: left;
}

.tool-card:hover {
  border-color: #99f6e4;
  background: #f0fdfa;
}

.tool-card strong {
  color: #0f172a;
  font-size: 14px;
}

.tool-card span,
.recent-row span {
  color: #64748b;
  font-size: 12px;
}

.empty-row,
.recent-row {
  padding: 11px 2px;
}

.empty-row {
  color: #94a3b8;
  font-size: 13px;
}

.recent-row {
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

.recent-row:last-child {
  border-bottom: 0;
}

.recent-row strong {
  color: #1e293b;
  font-size: 13px;
}

.recent-row p {
  grid-column: 1 / -1;
  margin: 0;
  color: #64748b;
  font-size: 12px;
}

@media (max-width: 980px) {
  .creator-home {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 560px) {
  .tool-grid {
    grid-template-columns: 1fr;
  }
}
</style>
