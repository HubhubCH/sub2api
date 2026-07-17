<template>
  <section class="canvas-size-control" data-test="creator-canvas-size">
    <div class="size-heading">
      <strong>画布尺寸</strong>
      <span>{{ width }} x {{ height }}</span>
    </div>

    <div class="dimension-row">
      <label>
        <span>宽</span>
        <input :value="width" type="number" min="256" max="2048" step="16" :disabled="disabled" @change="updateDimension('width', $event)" />
      </label>
      <span aria-hidden="true">x</span>
      <label>
        <span>高</span>
        <input :value="height" type="number" min="256" max="2048" step="16" :disabled="disabled" @change="updateDimension('height', $event)" />
      </label>
    </div>

    <div class="ratio-options" role="group" aria-label="画布宽高比">
      <button
        v-for="option in ratioOptions"
        :key="option.label"
        type="button"
        :class="{ active: selectedRatio === option.label }"
        :disabled="disabled"
        :data-test="`creator-ratio-${option.label.replace(':', '-')}`"
        @click="selectRatio(option)"
      >
        <span class="ratio-shape" :style="{ aspectRatio: `${option.width} / ${option.height}` }" aria-hidden="true" />
        <span>{{ option.label }}</span>
      </button>
      <button type="button" :class="{ active: selectedRatio === '自定义' }" :disabled="disabled" @click="focusCustomSize">
        <span class="custom-shape" aria-hidden="true">+</span>
        <span>自定义</span>
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface RatioOption {
  label: string
  width: number
  height: number
}

const props = defineProps<{
  modelValue: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const ratioOptions: RatioOption[] = [
  { label: '1:1', width: 1024, height: 1024 },
  { label: '4:3', width: 1536, height: 1152 },
  { label: '3:4', width: 1152, height: 1536 },
  { label: '16:9', width: 1536, height: 864 },
  { label: '9:16', width: 864, height: 1536 },
  { label: '3:2', width: 1536, height: 1024 },
  { label: '2:3', width: 1024, height: 1536 },
]

const dimensions = computed(() => {
  const match = /^(\d+)x(\d+)$/.exec(props.modelValue)
  return {
    width: Number(match?.[1]) || 1024,
    height: Number(match?.[2]) || 1024,
  }
})
const width = computed(() => dimensions.value.width)
const height = computed(() => dimensions.value.height)
const selectedRatio = computed(() => {
  const ratio = width.value / height.value
  return ratioOptions.find((option) => Math.abs(option.width / option.height - ratio) < 0.005)?.label || '自定义'
})

function clampDimension(value: number): number {
  if (!Number.isFinite(value)) return 1024
  return Math.min(2048, Math.max(256, Math.round(value / 16) * 16))
}

function updateDimension(field: 'width' | 'height', event: Event): void {
  const value = clampDimension(Number((event.target as HTMLInputElement).value))
  const nextWidth = field === 'width' ? value : width.value
  const nextHeight = field === 'height' ? value : height.value
  emit('update:modelValue', `${nextWidth}x${nextHeight}`)
}

function selectRatio(option: RatioOption): void {
  emit('update:modelValue', `${option.width}x${option.height}`)
}

function focusCustomSize(event: Event): void {
  const section = (event.currentTarget as HTMLElement).closest('.canvas-size-control')
  section?.querySelector<HTMLInputElement>('input')?.focus()
}
</script>

<style scoped>
.canvas-size-control {
  display: grid;
  gap: 10px;
  border-top: 1px solid #edf1f5;
  padding-top: 12px;
}

.size-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.size-heading strong {
  color: #475569;
  font-size: 13px;
}

.size-heading > span {
  color: #0f766e;
  font-size: 12px;
  font-weight: 740;
}

.dimension-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: end;
  gap: 8px;
}

.dimension-row label {
  display: grid;
  gap: 5px;
}

.dimension-row label span {
  color: #64748b;
  font-size: 11px;
}

.dimension-row > span {
  color: #94a3b8;
  padding-bottom: 9px;
}

.dimension-row input {
  width: 100%;
  min-width: 0;
  border: 1px solid #dbe4ee;
  border-radius: 6px;
  background: #fff;
  color: #0f172a;
  font-size: 13px;
  padding: 8px 9px;
}

.ratio-options {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 7px;
}

.ratio-options button {
  display: grid;
  min-width: 0;
  min-height: 58px;
  place-items: center;
  gap: 4px;
  border: 1px solid #dbe4ee;
  border-radius: 6px;
  background: #fff;
  color: #64748b;
  cursor: pointer;
  font-size: 10px;
  padding: 6px 4px;
}

.ratio-options button:hover,
.ratio-options button.active {
  border-color: #14b8a6;
  background: #f0fdfa;
  color: #0f766e;
}

.ratio-shape {
  display: block;
  width: 24px;
  max-height: 25px;
  border: 2px solid currentColor;
  border-radius: 3px;
}

.custom-shape {
  display: grid;
  width: 25px;
  height: 25px;
  place-items: center;
  font-size: 20px;
  line-height: 1;
}

.ratio-options button:disabled,
.dimension-row input:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

:global(.dark) .dimension-row input,
:global(.dark) .ratio-options button {
  border-color: #334155;
  background: #0f172a;
  color: #cbd5e1;
}

@media (max-width: 420px) {
  .ratio-options {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
</style>
