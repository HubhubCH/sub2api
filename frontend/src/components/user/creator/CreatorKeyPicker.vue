<template>
  <section class="creator-key-picker" :data-test="testId || 'creator-key'">
    <div class="picker-heading">
      <strong>{{ label || 'API 密钥' }}</strong>
      <span>{{ keys.length }} 个可用</span>
    </div>
    <select
      :value="modelValue"
      :disabled="disabled"
      class="field-control"
      @change="$emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option value="">{{ emptyLabel || '请选择 API 密钥' }}</option>
      <option v-for="key in keys" :key="key.id" :value="String(key.id)">
        {{ key.name }} · {{ maskKey(key.key) }}
      </option>
    </select>
  </section>
</template>

<script setup lang="ts">
import type { ApiKey } from '@/types'

defineProps<{
  keys: ApiKey[]
  modelValue: string
  disabled?: boolean
  label?: string
  emptyLabel?: string
  testId?: string
}>()

defineEmits<{
  'update:modelValue': [value: string]
}>()

function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 14) return `${key.slice(0, 4)}***${key.slice(-4)}`
  return `${key.slice(0, 8)}...${key.slice(-6)}`
}
</script>

<style scoped>
.creator-key-picker {
  display: grid;
  gap: 8px;
}

.picker-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.picker-heading strong {
  color: #0f172a;
  font-size: 15px;
}

.picker-heading span {
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.field-control {
  width: 100%;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
  color: #0f172a;
  font-size: 14px;
  outline: none;
  padding: 9px 10px;
}

.field-control:focus {
  border-color: #67e8f9;
  box-shadow: 0 0 0 3px rgba(103, 232, 249, 0.18);
}

:global(.dark) .picker-heading strong {
  color: #f8fafc;
}

:global(.dark) .picker-heading span {
  color: #94a3b8;
}

:global(.dark) .field-control {
  border-color: #334155;
  background: #0f172a;
  color: #f8fafc;
}
</style>
