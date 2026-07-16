<template>
  <div class="creator-home">
    <section class="home-section">
      <div class="section-heading">
        <h2>工具矩阵</h2>
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
        <h2>最近创作</h2>
        <span>{{ recent.length }}</span>
      </div>
      <div v-if="recent.length === 0" class="empty-row">暂无最近创作</div>
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
  icon: 'home' | 'chat' | 'edit' | 'globe' | 'sparkles' | 'grid' | 'copy' | 'upload' | 'play' | 'cloud' | 'clock'
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
  gap: 14px;
}

.home-section {
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
  border-bottom: 1px solid #e2e8f0;
  padding: 10px 16px;
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

.tool-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  padding: 16px;
}

.tool-card {
  display: grid;
  min-height: 112px;
  align-content: center;
  justify-items: start;
  gap: 9px;
  border: 1px solid #edf1f5;
  border-radius: 14px;
  background: #fff;
  color: #0f766e;
  cursor: pointer;
  padding: 15px;
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
  padding: 14px 16px;
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
  .tool-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .tool-grid {
    grid-template-columns: 1fr;
  }
}
</style>
