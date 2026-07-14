<template>
  <AppLayout>
    <div class="image-page">
      <aside class="image-panel">
        <section class="panel-section">
          <div class="section-heading">
            <h2>API 密钥</h2>
          </div>
          <label class="field-label" for="image-api-key">API 密钥</label>
          <select id="image-api-key" v-model="selectedKeyId" class="field-control">
            <option value="">请选择用于 AI 生图的 API 密钥</option>
            <option v-for="key in apiKeys" :key="key.id" :value="String(key.id)">
              {{ key.name }} · {{ maskKey(key.key) }}
            </option>
          </select>
          <div class="status-pill" :class="selectedApiKey ? 'status-ok' : 'status-muted'">
            {{ selectedApiKey ? '已选择' : '未选择' }}
          </div>
          <p class="field-hint">请选择已开通图片生成权限的用户 API 密钥。</p>
        </section>

        <section class="panel-section">
          <div class="section-heading">
            <h2>生成参数</h2>
            <button type="button" class="link-button" @click="resetDefaults">恢复推荐</button>
          </div>

          <label class="field-label" for="image-model">图片模型</label>
          <select
            id="image-model"
            v-model="form.model"
            class="field-control"
            :disabled="!selectedApiKey || imageModelDiscovery === 'loading' || modelPresets.length === 0"
          >
            <option v-if="!selectedApiKey" value="">请先选择 API 密钥</option>
            <option v-else-if="imageModelDiscovery === 'loading'" value="">正在加载当前密钥的图片模型</option>
            <option v-else-if="imageModelDiscovery === 'failed'" value="">图片模型加载失败</option>
            <option v-else-if="modelPresets.length === 0" value="">当前密钥分组暂无图片模型</option>
            <option v-for="model in modelPresets" :key="model.value" :value="model.value">
              {{ model.label }}
            </option>
          </select>
          <p class="field-hint">仅显示当前 API 密钥所属分组实际可用的图片模型。</p>

          <label class="field-label" for="quality">清晰度</label>
          <select id="quality" v-model="form.quality" class="field-control">
            <option v-for="quality in qualityPresets" :key="quality.value" :value="quality.value">
              {{ quality.label }}
            </option>
          </select>

          <label class="field-label" for="ratio">画面比例</label>
          <select id="ratio" v-model="form.ratio" class="field-control" @change="applyRatioPreset">
            <option v-for="ratio in ratioPresets" :key="ratio.value" :value="ratio.value">
              {{ ratio.label }}
            </option>
            <option value="custom">自定义比例</option>
          </select>

          <label class="field-label" for="size">输出尺寸</label>
          <select id="size" v-model="form.sizePreset" class="field-control" @change="applySizePreset">
            <option v-for="size in availableSizePresets" :key="size.value" :value="size.value">
              {{ size.label }}
            </option>
            <option value="custom">自定义宽高</option>
          </select>
          <div class="size-grid">
            <input
              v-model.number="form.width"
              class="field-control"
              type="number"
              min="256"
              max="2048"
              step="16"
              aria-label="宽度"
              @input="markCustomSize"
            />
            <span>×</span>
            <input
              v-model.number="form.height"
              class="field-control"
              type="number"
              min="256"
              max="2048"
              step="16"
              aria-label="高度"
              @input="markCustomSize"
            />
          </div>

          <label class="field-label" for="image-count">张数</label>
          <input id="image-count" v-model.number="form.count" class="field-control" type="number" min="1" max="4" step="1" />

          <label class="field-label" for="output-format">图片格式</label>
          <select id="output-format" v-model="form.outputFormat" class="field-control">
            <option value="png">PNG</option>
            <option value="webp">WebP</option>
            <option value="jpeg">JPEG</option>
          </select>
        </section>

        <section class="panel-section">
          <div class="section-heading">
            <h2>参考图</h2>
            <button v-if="referencePreview" type="button" class="link-button" @click="clearReference">清除</button>
          </div>
          <label class="upload-box" for="reference-upload">
            <input id="reference-upload" class="upload-input" type="file" accept="image/*" @change="handleReferenceUpload" />
            <img v-if="referencePreview" :src="referencePreview" alt="参考图预览" />
            <span v-else>
              <Icon name="upload" size="lg" />
              上传参考图
            </span>
          </label>
          <p class="field-hint">上传参考图后会使用图片编辑接口；不上传时走文生图。</p>
        </section>
      </aside>

      <main class="image-workspace">
        <div class="workspace-card">
          <div class="workspace-toolbar">
            <span>图片预览</span>
            <button type="button" class="open-button" :disabled="!selectedResult" @click="openResult">
              <Icon name="externalLink" size="sm" />
              新窗口打开
            </button>
          </div>

          <div class="result-shell">
            <div v-if="selectedResult" class="result-stage" :style="previewAspectStyle">
              <img
                :src="selectedResult.src"
                alt="AI 生图结果"
                data-disable-visual-search="true"
                @load="syncResultDimensions($event, selectedResultIndex)"
              />
            </div>
            <div v-else class="empty-stage">
              <div class="empty-icon">
                <Icon name="sparkles" size="xl" />
              </div>
              <h1>AI 生图</h1>
              <p>选择清晰度、比例和尺寸，输入提示词后直接生成图片。</p>
            </div>
          </div>

          <div v-if="results.length > 1" class="result-strip">
            <button
              v-for="(result, index) in results"
              :key="`${result.src}-${index}`"
              type="button"
              class="thumb-button"
              :class="{ active: index === selectedResultIndex }"
              @click="selectedResultIndex = index"
            >
              <img :src="result.src" :alt="`结果 ${index + 1}`" data-disable-visual-search="true" />
            </button>
          </div>

          <div v-if="selectedResult" class="result-actions">
            <button type="button" class="secondary-button" @click="downloadResult">
              <Icon name="download" size="sm" />
              下载
            </button>
            <button type="button" class="secondary-button" @click="useResultPrompt">
              <Icon name="refresh" size="sm" />
              继续修改
            </button>
          </div>

          <div v-if="statusMessage || errorMessage" class="task-strip">
            <span v-if="statusMessage" class="task-badge">{{ statusMessage }}</span>
            <span v-if="submitting">已等待 {{ formatDuration(elapsedSeconds) }}</span>
            <span v-if="errorMessage" class="task-error">{{ errorMessage }}</span>
          </div>

          <form class="prompt-bar" @submit.prevent="handleGenerate">
            <textarea
              v-model.trim="prompt"
              class="prompt-input"
              rows="4"
              placeholder="例如：3D东方玄幻美学，长发女子，身穿光雾留仙裙，剑开天门，电影级光影，超高质感"
            />
            <div class="prompt-actions">
              <button type="button" class="secondary-button" :disabled="submitting" @click="quoteLastPrompt">
                引用最近结果
              </button>
              <button type="submit" class="primary-button" :disabled="!canSubmit || submitting">
                <Icon v-if="submitting" name="refresh" size="sm" class="animate-spin" />
                <span>{{ submitting ? '生成中' : '开始生成' }}</span>
              </button>
            </div>
          </form>
        </div>
      </main>
      <GenerationHistoryPanel media-type="image" />
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import AppLayout from '@/components/layout/AppLayout.vue'
import Icon from '@/components/icons/Icon.vue'
import GenerationHistoryPanel from '@/components/user/GenerationHistoryPanel.vue'
import { keysAPI } from '@/api'
import { imageGenerationAPI, type ImageGenerationItem } from '@/api/imageGeneration'
import type { ApiKey } from '@/types'
import { useAppStore } from '@/stores/app'
import { extractApiErrorMessage } from '@/utils/apiError'

interface ModelPreset {
  label: string
  value: string
}

interface QualityPreset {
  label: string
  value: string
}

interface RatioPreset {
  label: string
  value: string
  width: number
  height: number
}

interface SizePreset {
  label: string
  value: string
  ratio: string
  width: number
  height: number
}

interface ImageResult {
  src: string
  filename: string
  mimeType: string
  width: number
  height: number
  b64?: string
  url?: string
  revisedPrompt?: string
}

const appStore = useAppStore()

const modelPresets = ref<ModelPreset[]>([])

const qualityPresets: QualityPreset[] = [
  { label: '高', value: 'high' },
  { label: '标准', value: 'medium' },
  { label: '快速', value: 'low' },
  { label: '自动', value: 'auto' }
]

const ratioPresets: RatioPreset[] = [
  { label: '1:1 方图', value: '1:1', width: 1024, height: 1024 },
  { label: '16:9 横图', value: '16:9', width: 1536, height: 864 },
  { label: '9:16 竖图', value: '9:16', width: 864, height: 1536 },
  { label: '4:3 横图', value: '4:3', width: 1024, height: 768 },
  { label: '3:4 竖图', value: '3:4', width: 768, height: 1024 },
  { label: '3:2 横图', value: '3:2', width: 1536, height: 1024 },
  { label: '2:3 竖图', value: '2:3', width: 1024, height: 1536 },
  { label: '21:9 超宽', value: '21:9', width: 1792, height: 768 }
]

const sizePresets: SizePreset[] = [
  { label: '1024 × 1024 1K', value: '1024x1024', ratio: '1:1', width: 1024, height: 1024 },
  { label: '1536 x 1536 高清方图', value: '1536x1536', ratio: '1:1', width: 1536, height: 1536 },
  { label: '2048 × 2048 2K', value: '2048x2048', ratio: '1:1', width: 2048, height: 2048 },
  { label: '1280 x 720 横屏封面', value: '1280x720', ratio: '16:9', width: 1280, height: 720 },
  { label: '1536 × 864 高清横图', value: '1536x864', ratio: '16:9', width: 1536, height: 864 },
  { label: '2048 × 1152 2K 横图', value: '2048x1152', ratio: '16:9', width: 2048, height: 1152 },
  { label: '720 x 1280 手机竖图', value: '720x1280', ratio: '9:16', width: 720, height: 1280 },
  { label: '864 × 1536 高清竖图', value: '864x1536', ratio: '9:16', width: 864, height: 1536 },
  { label: '1152 × 2048 2K 竖图', value: '1152x2048', ratio: '9:16', width: 1152, height: 2048 },
  { label: '1024 × 768 4:3', value: '1024x768', ratio: '4:3', width: 1024, height: 768 },
  { label: '1600 x 1200 4:3', value: '1600x1200', ratio: '4:3', width: 1600, height: 1200 },
  { label: '768 × 1024 3:4', value: '768x1024', ratio: '3:4', width: 768, height: 1024 },
  { label: '1200 x 1600 3:4', value: '1200x1600', ratio: '3:4', width: 1200, height: 1600 },
  { label: '1200 x 800 3:2', value: '1200x800', ratio: '3:2', width: 1200, height: 800 },
  { label: '1536 × 1024 3:2', value: '1536x1024', ratio: '3:2', width: 1536, height: 1024 },
  { label: '800 x 1200 2:3', value: '800x1200', ratio: '2:3', width: 800, height: 1200 },
  { label: '1024 × 1536 2:3', value: '1024x1536', ratio: '2:3', width: 1024, height: 1536 },
  { label: '1792 × 768 21:9', value: '1792x768', ratio: '21:9', width: 1792, height: 768 }
]

const apiKeys = ref<ApiKey[]>([])
const selectedKeyId = ref('')
const imageModelDiscovery = ref<'idle' | 'loading' | 'succeeded' | 'failed'>('idle')
const prompt = ref('')
const lastPrompt = ref('')
const submitting = ref(false)
const statusMessage = ref('')
const errorMessage = ref('')
const referenceFile = ref<File | null>(null)
const referencePreview = ref('')
const results = ref<ImageResult[]>([])
const selectedResultIndex = ref(0)
const elapsedSeconds = ref(0)
const openResultUrlTimers = new Map<string, number>()
let modelRequestVersion = 0
let elapsedTimer: number | null = null
let generationStartedAt = 0

const form = reactive({
  model: '',
  quality: 'high',
  ratio: '3:2',
  sizePreset: '1536x1024',
  width: 1536,
  height: 1024,
  count: 1,
  outputFormat: 'png'
})

const selectedApiKey = computed(() => apiKeys.value.find((key) => String(key.id) === selectedKeyId.value) ?? null)
const availableSizePresets = computed(() => sizePresets.filter((item) => item.ratio === form.ratio))
const selectedResult = computed(() => results.value[selectedResultIndex.value] ?? null)
const canSubmit = computed(() => Boolean(
  selectedApiKey.value?.key &&
  prompt.value &&
  modelPresets.value.some((model) => model.value === form.model)
))
const previewAspectStyle = computed(() => {
  const requested = safeDimensions(form.width, form.height)
  const width = selectedResult.value?.width ?? requested.width
  const height = selectedResult.value?.height ?? requested.height
  const aspect = Math.max(1, width) / Math.max(1, height)
  return {
    aspectRatio: `${Math.max(1, width)} / ${Math.max(1, height)}`,
    '--result-aspect': String(aspect),
    '--result-max-width': `${62 * aspect}vh`
  }
})

function safeDimensions(width: number, height: number): { width: number; height: number } {
  let safeWidth = Number.isFinite(width) && width > 0 ? width : 1024
  let safeHeight = Number.isFinite(height) && height > 0 ? height : 1024
  const downscale = Math.min(1, 2048 / Math.max(safeWidth, safeHeight))
  safeWidth *= downscale
  safeHeight *= downscale

  const shortEdge = Math.min(safeWidth, safeHeight)
  const upscale = shortEdge < 256 ? 256 / shortEdge : 1
  if (Math.max(safeWidth, safeHeight) * upscale <= 2048) {
    safeWidth *= upscale
    safeHeight *= upscale
  }

  return {
    width: Math.min(2048, Math.max(256, Math.round(safeWidth / 16) * 16)),
    height: Math.min(2048, Math.max(256, Math.round(safeHeight / 16) * 16))
  }
}

function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 14) return `${key.slice(0, 4)}***${key.slice(-4)}`
  return `${key.slice(0, 8)}...${key.slice(-6)}`
}

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  if (safeSeconds < 60) return `${safeSeconds} 秒`
  const minutes = Math.floor(safeSeconds / 60)
  const remainder = safeSeconds % 60
  return remainder > 0 ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`
}

function stopElapsedTimer() {
  if (elapsedTimer !== null) {
    window.clearInterval(elapsedTimer)
    elapsedTimer = null
  }
}

function startElapsedTimer() {
  stopElapsedTimer()
  generationStartedAt = Date.now()
  elapsedSeconds.value = 0
  elapsedTimer = window.setInterval(() => {
    elapsedSeconds.value = Math.max(0, Math.floor((Date.now() - generationStartedAt) / 1000))
  }, 1000)
}

function resetDefaults() {
  form.model = modelPresets.value[0]?.value ?? ''
  form.quality = 'high'
  form.ratio = '3:2'
  form.sizePreset = '1536x1024'
  form.width = 1536
  form.height = 1024
  form.count = 1
  form.outputFormat = 'png'
}

function applyRatioPreset() {
  const ratio = ratioPresets.find((item) => item.value === form.ratio)
  if (ratio) {
    form.width = ratio.width
    form.height = ratio.height
  }
  const firstSize = sizePresets.find((item) => item.ratio === form.ratio)
  form.sizePreset = firstSize?.value ?? 'custom'
  if (firstSize) {
    form.width = firstSize.width
    form.height = firstSize.height
  }
}

function applySizePreset() {
  const preset = sizePresets.find((item) => item.value === form.sizePreset)
  if (!preset) return
  form.ratio = preset.ratio
  form.width = preset.width
  form.height = preset.height
}

function markCustomSize() {
  form.sizePreset = 'custom'
  const ratio = approximateRatio(form.width, form.height)
  form.ratio = ratioPresets.some((item) => item.value === ratio) ? ratio : 'custom'
}

function approximateRatio(width: number, height: number): string {
  const { width: w, height: h } = safeDimensions(width, height)
  const gcd = greatestCommonDivisor(w, h)
  return `${Math.round(w / gcd)}:${Math.round(h / gcd)}`
}

function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y) {
    const t = y
    y = x % y
    x = t
  }
  return x || 1
}

function handleReferenceUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  referenceFile.value = file
  if (referencePreview.value) URL.revokeObjectURL(referencePreview.value)
  referencePreview.value = URL.createObjectURL(file)
}

function clearReference() {
  referenceFile.value = null
  if (referencePreview.value) URL.revokeObjectURL(referencePreview.value)
  referencePreview.value = ''
}

function parseResultDimensions(size: string | undefined, fallbackWidth: number, fallbackHeight: number) {
  const match = /^\s*(\d+)\s*x\s*(\d+)\s*$/i.exec(size || '')
  const width = Number(match?.[1])
  const height = Number(match?.[2])
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return { width, height }
  }
  return { width: fallbackWidth, height: fallbackHeight }
}

function imageSourceFromItem(
  item: ImageGenerationItem,
  index: number,
  fallbackWidth: number,
  fallbackHeight: number
): ImageResult | null {
  const b64 = item.b64_json || item.result
  const url = item.url
  const outputFormat = item.output_format || form.outputFormat || 'png'
  const mimeType = `image/${outputFormat === 'jpg' ? 'jpeg' : outputFormat}`
  const dimensions = parseResultDimensions(item.size, fallbackWidth, fallbackHeight)
  const filename = `ai-image-${Date.now()}-${index + 1}.${outputFormat}`
  if (b64) {
    return {
      src: `data:image/${outputFormat};base64,${b64}`,
      filename,
      mimeType,
      ...dimensions,
      b64,
      revisedPrompt: item.revised_prompt
    }
  }
  if (url) {
    return {
      src: url,
      filename,
      mimeType,
      ...dimensions,
      url,
      revisedPrompt: item.revised_prompt
    }
  }
  return null
}

function extractResults(response: unknown, fallbackWidth: number, fallbackHeight: number): ImageResult[] {
  const payload = response as { data?: ImageGenerationItem[]; output?: ImageGenerationItem[] }
  const items = [...(payload.data || []), ...(payload.output || [])]
  return items
    .map((item, index) => imageSourceFromItem(item, index, fallbackWidth, fallbackHeight))
    .filter((item): item is ImageResult => Boolean(item))
}

function syncResultDimensions(event: Event, resultIndex: number) {
  const image = event.currentTarget as HTMLImageElement
  const result = results.value[resultIndex]
  if (!result || image.naturalWidth <= 0 || image.naturalHeight <= 0) return
  result.width = image.naturalWidth
  result.height = image.naturalHeight
}

async function loadApiKeys() {
  const response = await keysAPI.list(1, 50, { status: 'active' })
  apiKeys.value = response.items
  if (!selectedKeyId.value && response.items.length > 0) {
    selectedKeyId.value = String(response.items[0].id)
  }
}

async function loadImageModelsForSelectedKey() {
  const version = ++modelRequestVersion
  modelPresets.value = []
  form.model = ''
  const key = selectedApiKey.value?.key
  imageModelDiscovery.value = key ? 'loading' : 'idle'
  if (!key) return

  try {
    const models = await imageGenerationAPI.listImageModels(key)
    if (version !== modelRequestVersion) return
    modelPresets.value = models.map((model) => ({ label: model, value: model }))
    form.model = modelPresets.value[0]?.value ?? ''
    imageModelDiscovery.value = 'succeeded'
  } catch (error) {
    if (version !== modelRequestVersion) return
    imageModelDiscovery.value = 'failed'
    appStore.showError(extractApiErrorMessage(error, '加载当前密钥的图片模型失败'))
  }
}

async function handleGenerate() {
  if (!selectedApiKey.value) {
    appStore.showError('请先选择 API 密钥')
    return
  }

  submitting.value = true
  errorMessage.value = ''
  statusMessage.value = referenceFile.value ? '正在按参考图修改' : '正在生成图片'
  startElapsedTimer()

  try {
    const { width: requestedWidth, height: requestedHeight } = safeDimensions(form.width, form.height)
    form.width = requestedWidth
    form.height = requestedHeight
    const payload = {
      apiKey: selectedApiKey.value.key,
      model: form.model,
      prompt: prompt.value,
      size: `${requestedWidth}x${requestedHeight}`,
      quality: form.quality,
      count: Math.min(4, Math.max(1, Number(form.count) || 1)),
      outputFormat: form.outputFormat
    }
    const response = referenceFile.value
      ? await imageGenerationAPI.editImage({ ...payload, image: referenceFile.value })
      : await imageGenerationAPI.generateImage(payload)
    const extracted = extractResults(response, requestedWidth, requestedHeight)
    if (extracted.length === 0) {
      throw new Error('接口已返回，但没有找到可展示的图片结果')
    }
    results.value = extracted
    selectedResultIndex.value = 0
    lastPrompt.value = prompt.value
    statusMessage.value = `已生成 ${extracted.length} 张图片`
  } catch (error) {
    const message = extractApiErrorMessage(error, '生成失败，请检查密钥、模型或尺寸参数')
    errorMessage.value = message
    appStore.showError(message)
  } finally {
    submitting.value = false
    stopElapsedTimer()
  }
}

async function downloadResult() {
  const result = selectedResult.value
  if (!result) return
  try {
    const blob = result.b64
      ? base64ToBlob(result.b64, `image/${form.outputFormat || 'png'}`)
      : await fetch(result.src).then((response) => response.blob())
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = result.filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  } catch (error) {
    appStore.showError(extractApiErrorMessage(error, '下载图片失败'))
  }
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new Blob([bytes], { type: mimeType })
}

function openResult() {
  const result = selectedResult.value
  if (!result) return

  let openUrl = result.src
  if (result.b64) {
    const blob = base64ToBlob(result.b64, result.mimeType)
    openUrl = URL.createObjectURL(blob)
    const timer = window.setTimeout(() => {
      URL.revokeObjectURL(openUrl)
      openResultUrlTimers.delete(openUrl)
    }, 60_000)
    openResultUrlTimers.set(openUrl, timer)
  }
  window.open(openUrl, '_blank', 'noopener,noreferrer')
}

function useResultPrompt() {
  const revised = selectedResult.value?.revisedPrompt
  if (revised) {
    prompt.value = revised
    return
  }
  if (lastPrompt.value) {
    prompt.value = `${lastPrompt.value}，继续优化画面细节和构图`
  }
}

function quoteLastPrompt() {
  if (!lastPrompt.value) return
  prompt.value = lastPrompt.value
}

watch(selectedResultIndex, (index) => {
  if (index < 0 || index >= results.value.length) {
    selectedResultIndex.value = 0
  }
})

watch(selectedKeyId, () => {
  void loadImageModelsForSelectedKey()
})

onMounted(() => {
  loadApiKeys().catch((error) => {
    appStore.showError(extractApiErrorMessage(error, '加载 API 密钥失败'))
  })
})

onBeforeUnmount(() => {
  modelRequestVersion += 1
  stopElapsedTimer()
  if (referencePreview.value) URL.revokeObjectURL(referencePreview.value)
  for (const [url, timer] of openResultUrlTimers) {
    window.clearTimeout(timer)
    URL.revokeObjectURL(url)
  }
  openResultUrlTimers.clear()
})
</script>

<style scoped>
.image-page {
  width: 100%;
  max-width: 1760px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(280px, 320px) minmax(480px, 1fr) minmax(240px, 280px);
  align-items: start;
  gap: 16px;
  min-height: calc(100vh - 128px);
}

.image-panel,
.workspace-card {
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.08);
}

.image-panel {
  position: sticky;
  top: 88px;
  max-height: calc(100vh - 112px);
  overflow-y: auto;
  scrollbar-gutter: stable;
  padding: 18px;
}

.panel-section + .panel-section {
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid rgba(148, 163, 184, 0.18);
}

.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.section-heading h2 {
  margin: 0;
  color: #0f172a;
  font-size: 16px;
  font-weight: 760;
}

.field-label {
  display: block;
  margin: 12px 0 6px;
  color: #475569;
  font-size: 13px;
  font-weight: 680;
}

.field-control {
  width: 100%;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  background: #fff;
  color: #0f172a;
  font-size: 14px;
  line-height: 1.4;
  outline: none;
  padding: 10px 12px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.field-control:focus,
.prompt-input:focus {
  border-color: #67e8f9;
  box-shadow: 0 0 0 4px rgba(103, 232, 249, 0.18);
}

.size-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  color: #64748b;
  font-weight: 760;
}

.field-hint {
  margin: 10px 0 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.6;
}

.status-pill,
.task-badge {
  display: inline-flex;
  min-height: 28px;
  margin-top: 12px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  padding: 5px 12px;
  font-size: 12px;
  font-weight: 760;
}

.status-ok,
.task-badge {
  background: #ccfbf1;
  color: #0f766e;
}

.status-muted {
  background: #f1f5f9;
  color: #64748b;
}

.upload-box {
  display: grid;
  min-height: 132px;
  place-items: center;
  overflow: hidden;
  border: 1px dashed #cbd5e1;
  border-radius: 16px;
  background: #f8fafc;
  color: #64748b;
  cursor: pointer;
  font-size: 13px;
  font-weight: 700;
  padding: 12px;
  text-align: center;
}

.upload-box span {
  display: grid;
  gap: 8px;
  justify-items: center;
}

.upload-input {
  display: none;
}

.upload-box img {
  width: 100%;
  max-height: 180px;
  object-fit: contain;
}

.workspace-card {
  position: relative;
  display: flex;
  min-height: calc(100vh - 128px);
  overflow: hidden;
  flex-direction: column;
}

.workspace-toolbar {
  display: flex;
  min-height: 58px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid #e2e8f0;
  padding: 10px 16px;
  color: #334155;
  font-size: 14px;
  font-weight: 760;
}

.open-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  color: #64748b;
  font-size: 13px;
  font-weight: 700;
  padding: 10px 16px;
}

.open-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.result-shell {
  display: grid;
  min-height: clamp(400px, calc(100vh - 390px), 620px);
  flex: 1;
  place-items: center;
  background: #fff;
  padding: 28px;
}

.empty-stage,
.result-stage {
  display: flex;
  align-items: center;
  justify-content: center;
}

.empty-stage {
  flex-direction: column;
  padding: 56px 28px;
  text-align: center;
}

.empty-icon {
  display: grid;
  width: 72px;
  height: 72px;
  margin-bottom: 36px;
  place-items: center;
  border-radius: 20px;
  background: #ccfbf1;
  color: #0f766e;
}

.empty-stage h1 {
  margin: 0;
  color: #0f172a;
  font-size: 28px;
  font-weight: 820;
}

.empty-stage p {
  margin: 18px 0 0;
  max-width: 540px;
  color: #64748b;
  font-size: 14px;
}

.result-stage {
  width: min(100%, 960px, var(--result-max-width));
  max-height: 62vh;
  overflow: hidden;
  border: 1px solid #e2e8f0;
  border-radius: 18px;
  background: #fff;
}

.result-stage img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
}

.thumb-button img {
  pointer-events: none;
  user-select: none;
}

.result-strip {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  border-top: 1px solid #e2e8f0;
  padding: 12px 18px;
}

.thumb-button {
  width: 88px;
  height: 64px;
  flex: 0 0 auto;
  overflow: hidden;
  border: 2px solid transparent;
  border-radius: 12px;
  background: #f8fafc;
  padding: 0;
}

.thumb-button.active {
  border-color: #14b8a6;
}

.thumb-button img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.result-actions,
.task-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  border-top: 1px solid #e2e8f0;
  padding: 12px 18px;
}

.task-strip {
  color: #64748b;
  font-size: 13px;
}

.task-error {
  color: #dc2626;
  font-weight: 700;
}

.prompt-bar {
  display: grid;
  gap: 12px;
  border-top: 1px solid #e2e8f0;
  padding: 18px;
}

.prompt-input {
  width: 100%;
  min-height: 84px;
  resize: vertical;
  border: 1px solid #e2e8f0;
  border-radius: 18px;
  color: #0f172a;
  font-size: 15px;
  outline: none;
  padding: 16px 18px;
}

.prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.primary-button,
.secondary-button,
.link-button {
  border: 0;
  font-weight: 760;
}

.primary-button,
.secondary-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 999px;
  padding: 12px 18px;
}

.primary-button {
  background: #14b8a6;
  color: #fff;
  box-shadow: 0 14px 30px rgba(20, 184, 166, 0.24);
}

.secondary-button {
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #475569;
}

.link-button {
  background: transparent;
  color: #2563eb;
  font-size: 12px;
}

.primary-button:disabled,
.secondary-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

:global(.dark) .image-panel,
:global(.dark) .workspace-card {
  border-color: rgba(51, 65, 85, 0.9);
  background: rgba(15, 23, 42, 0.92);
}

:global(.dark) .section-heading h2,
:global(.dark) .empty-stage h1,
:global(.dark) .workspace-toolbar {
  color: #f8fafc;
}

:global(.dark) .field-label,
:global(.dark) .field-hint,
:global(.dark) .empty-stage p,
:global(.dark) .task-strip {
  color: #94a3b8;
}

:global(.dark) .field-control,
:global(.dark) .prompt-input {
  border-color: #334155;
  background: #0f172a;
  color: #f8fafc;
}

:global(.dark) .upload-box,
:global(.dark) .result-shell,
:global(.dark) .result-stage,
:global(.dark) .thumb-button {
  border-color: #334155;
  background: #0f172a;
  color: #94a3b8;
}

:global(.dark) .secondary-button,
:global(.dark) .open-button {
  border-color: #334155;
  background: rgba(15, 23, 42, 0.92);
  color: #cbd5e1;
}

@media (max-width: 1500px) {
  .image-page {
    grid-template-columns: minmax(280px, 320px) minmax(0, 1fr);
  }

  .image-page > :deep(.generation-history) {
    grid-column: 1 / -1;
  }
}

@media (max-width: 1180px) {
  .image-page {
    grid-template-columns: 1fr;
  }

  .image-panel {
    position: static;
    max-height: none;
    overflow: visible;
  }

  .result-shell {
    min-height: 420px;
  }
}

@media (max-width: 640px) {
  .image-panel {
    padding: 16px;
  }

  .result-shell {
    min-height: 340px;
    padding: 16px;
  }

  .workspace-card {
    min-height: auto;
  }

  .workspace-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .prompt-actions,
  .result-actions {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
