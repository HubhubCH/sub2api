<template>
  <nav class="creator-tool-rail" aria-label="在线创作工具">
    <button
      v-for="tool in tools"
      :key="tool.id"
      type="button"
      class="tool-button"
      :class="{ active: tool.id === activeTool }"
      :data-test="`creator-tool-${tool.id}`"
      @click="$emit('select', tool.id)"
    >
      <Icon :name="tool.icon" size="sm" />
      <span>{{ tool.label }}</span>
    </button>
  </nav>
</template>

<script setup lang="ts">
import Icon from '@/components/icons/Icon.vue'

export interface CreatorToolNavItem {
  id: string
  label: string
  icon: 'home' | 'chat' | 'edit' | 'globe' | 'sparkles' | 'grid' | 'copy' | 'upload' | 'play' | 'cloud' | 'clock'
}

defineProps<{
  tools: CreatorToolNavItem[]
  activeTool: string
}>()

defineEmits<{
  select: [toolId: string]
}>()
</script>

<style scoped>
.creator-tool-rail {
  display: grid;
  align-content: start;
  gap: 8px;
  border: 1px solid #e2e8f0;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.94);
  padding: 10px;
}

.tool-button {
  display: flex;
  min-height: 42px;
  width: 100%;
  align-items: center;
  gap: 9px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  font-size: 13px;
  font-weight: 720;
  padding: 0 11px;
  text-align: left;
}

.tool-button:hover,
.tool-button.active {
  background: #ccfbf1;
  color: #0f766e;
}

:global(.dark) .creator-tool-rail {
  border-color: #334155;
  background: rgba(15, 23, 42, 0.92);
}

:global(.dark) .tool-button {
  color: #94a3b8;
}

:global(.dark) .tool-button:hover,
:global(.dark) .tool-button.active {
  background: rgba(20, 184, 166, 0.18);
  color: #99f6e4;
}

@media (max-width: 760px) {
  .creator-tool-rail {
    display: flex;
    overflow-x: auto;
    padding: 8px;
  }

  .tool-button {
    flex: 0 0 auto;
    white-space: nowrap;
  }
}
</style>
