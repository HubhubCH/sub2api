<template>
  <div
    class="image-upload"
    :class="{ dragging: isDragging, filled: previews.length > 0 }"
    @dragenter.prevent="isDragging = true"
    @dragover.prevent="isDragging = true"
    @dragleave.prevent="handleDragLeave"
    @drop.prevent="handleDrop"
  >
    <input
      ref="inputRef"
      :id="inputId"
      class="sr-only"
      type="file"
      accept="image/*"
      :multiple="multiple"
      :data-test="dataTest"
      @change="handleInput"
    />

    <button v-if="previews.length === 0" type="button" class="upload-trigger" @click="openPicker">
      <Icon name="upload" size="md" />
      <strong>{{ label }}</strong>
      <span>{{ hintText }}</span>
    </button>

    <div v-else class="preview-area">
      <div class="preview-grid" :class="{ single: !multiple }">
        <figure v-for="(preview, index) in previews" :key="preview.key" class="preview-item">
          <img :src="preview.url" :alt="preview.file.name" />
          <button type="button" class="remove-button" :aria-label="`移除 ${preview.file.name}`" title="移除图片" @click="removeFile(index)">
            <Icon name="x" size="sm" />
          </button>
        </figure>
        <button v-if="multiple && files.length < maxFiles" type="button" class="add-button" title="继续添加图片" @click="openPicker">
          <Icon name="plus" size="md" />
          <span>添加图片</span>
        </button>
      </div>
      <button v-if="!multiple" type="button" class="replace-button" @click="openPicker">
        <Icon name="refresh" size="sm" />
        <span>替换图片</span>
      </button>
      <p v-else class="file-count">已选择 {{ files.length }} / {{ maxFiles }} 张，可拖入更多图片</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Icon from '@/components/icons/Icon.vue'

const props = withDefaults(defineProps<{
  files: File[]
  label: string
  hint?: string
  multiple?: boolean
  maxFiles?: number
  dataTest?: string
  inputId?: string
}>(), {
  hint: '',
  multiple: false,
  maxFiles: 1,
  dataTest: undefined,
  inputId: undefined,
})

const emit = defineEmits<{
  'update:files': [files: File[]]
}>()

interface ImagePreview {
  key: string
  file: File
  url: string
}

const inputRef = ref<HTMLInputElement | null>(null)
const isDragging = ref(false)
const previews = ref<ImagePreview[]>([])
const hintText = computed(() => props.hint || (props.multiple ? `点击或拖入图片，最多 ${props.maxFiles} 张` : '点击或拖入图片'))

function releasePreviews() {
  for (const preview of previews.value) URL.revokeObjectURL(preview.url)
  previews.value = []
}

function refreshPreviews(files: File[]) {
  releasePreviews()
  previews.value = files.map((file) => ({
    key: `${file.name}-${file.size}-${file.lastModified}`,
    file,
    url: URL.createObjectURL(file),
  }))
}

function openPicker() {
  inputRef.value?.click()
}

function normalizeFiles(incoming: File[]): File[] {
  const images = incoming.filter((file) => file.type.startsWith('image/'))
  if (!props.multiple) return images.slice(0, 1)
  const unique = new Map(props.files.map((file) => [`${file.name}-${file.size}-${file.lastModified}`, file]))
  for (const file of images) unique.set(`${file.name}-${file.size}-${file.lastModified}`, file)
  return Array.from(unique.values()).slice(0, props.maxFiles)
}

function applyFiles(incoming: File[]) {
  const next = normalizeFiles(incoming)
  if (next.length > 0 || props.multiple) emit('update:files', next)
  if (inputRef.value) inputRef.value.value = ''
}

function handleInput(event: Event) {
  applyFiles(Array.from((event.target as HTMLInputElement).files || []))
}

function handleDrop(event: DragEvent) {
  isDragging.value = false
  applyFiles(Array.from(event.dataTransfer?.files || []))
}

function handleDragLeave(event: DragEvent) {
  const current = event.currentTarget as HTMLElement
  if (!current.contains(event.relatedTarget as Node | null)) isDragging.value = false
}

function removeFile(index: number) {
  emit('update:files', props.files.filter((_, fileIndex) => fileIndex !== index))
}

watch(() => props.files, refreshPreviews, { immediate: true })
onBeforeUnmount(releasePreviews)
</script>

<style scoped>
.image-upload {
  min-height: 116px;
  border: 1px dashed #cbd5e1;
  border-radius: 6px;
  background: #f8fafc;
  transition: border-color 160ms ease, background-color 160ms ease;
}

.image-upload.dragging {
  border-color: #14b8a6;
  background: #f0fdfa;
}

.upload-trigger {
  width: 100%;
  min-height: 116px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 6px;
  border: 0;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  padding: 16px;
}

.upload-trigger strong {
  color: #334155;
  font-size: 13px;
}

.upload-trigger span,
.file-count {
  color: #94a3b8;
  font-size: 11px;
}

.preview-area {
  display: grid;
  gap: 8px;
  padding: 10px;
}

.preview-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.preview-grid.single {
  grid-template-columns: minmax(0, 1fr);
}

.preview-item {
  position: relative;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
}

.preview-item img {
  width: 100%;
  aspect-ratio: 4 / 3;
  display: block;
  object-fit: contain;
  background: #f1f5f9;
}

.remove-button {
  position: absolute;
  top: 5px;
  right: 5px;
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.75);
  border-radius: 50%;
  background: rgba(15, 23, 42, 0.78);
  color: #fff;
  cursor: pointer;
}

.add-button,
.replace-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid #dbe4ee;
  border-radius: 6px;
  background: #fff;
  color: #0f766e;
  cursor: pointer;
  font-size: 11px;
  font-weight: 700;
}

.add-button {
  min-height: 96px;
  flex-direction: column;
}

.replace-button {
  min-height: 34px;
  padding: 0 10px;
  justify-self: end;
}

.file-count {
  margin: 0;
}

:global(.dark) .image-upload {
  border-color: #475569;
  background: #111827;
}

:global(.dark) .preview-item,
:global(.dark) .add-button,
:global(.dark) .replace-button {
  border-color: #475569;
  background: #1e293b;
}

@media (max-width: 520px) {
  .preview-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
