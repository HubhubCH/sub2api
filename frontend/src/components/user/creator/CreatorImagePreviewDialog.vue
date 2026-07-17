<template>
  <BaseDialog
    :show="Boolean(src)"
    title="图片预览"
    width="full"
    :close-on-click-outside="true"
    @close="$emit('close')"
  >
    <div class="image-preview-dialog">
      <img v-if="src" :src="src" :alt="alt" />
      <a v-if="src" class="preview-download" :href="src" :download="downloadName">
        <Icon name="download" size="sm" />
        <span>下载图片</span>
      </a>
    </div>
  </BaseDialog>
</template>

<script setup lang="ts">
import BaseDialog from '@/components/common/BaseDialog.vue'
import Icon from '@/components/icons/Icon.vue'

withDefaults(defineProps<{
  src: string
  alt?: string
  downloadName?: string
}>(), {
  alt: '图片放大预览',
  downloadName: 'creator-image.png',
})

defineEmits<{
  close: []
}>()
</script>

<style scoped>
.image-preview-dialog {
  position: relative;
  display: grid;
  min-height: 240px;
  place-items: center;
  gap: 12px;
}

.image-preview-dialog img {
  display: block;
  width: auto;
  max-width: 100%;
  height: auto;
  max-height: calc(100dvh - 190px);
  object-fit: contain;
}

.preview-download {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 6px;
  color: #2563eb;
  font-size: 13px;
  font-weight: 740;
  text-decoration: none;
}

.preview-download:focus-visible {
  outline: 2px solid #14b8a6;
  outline-offset: 3px;
}

@media (max-width: 640px) {
  .image-preview-dialog img {
    max-height: calc(100dvh - 220px);
  }
}
</style>
