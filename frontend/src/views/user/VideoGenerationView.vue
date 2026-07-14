<template>
  <AppLayout>
    <div class="video-page">
    <aside class="video-panel">
      <section class="panel-section">
        <div class="section-heading">
          <h2>API 密钥</h2>
        </div>
        <label class="field-label" for="api-key-select">API 密钥</label>
        <select id="api-key-select" v-model="selectedKeyId" class="field-control">
          <option value="">请选择用于 AI 视频的 API 密钥</option>
          <option v-for="key in apiKeys" :key="key.id" :value="String(key.id)">
            {{ key.name }} · {{ maskKey(key.key) }}
          </option>
        </select>
        <div class="status-pill" :class="selectedApiKey ? 'status-ok' : 'status-muted'">
          {{ selectedApiKey ? '已选择' : '未选择' }}
        </div>
        <p class="field-hint">请选择已绑定当前视频供应商分组且启用媒体权限的 API 密钥。</p>
      </section>

      <section class="panel-section">
        <div class="section-heading">
          <h2>生成参数</h2>
          <button type="button" class="link-button" @click="resetDefaults">恢复推荐</button>
        </div>

        <label class="field-label" for="provider">生成引擎</label>
        <select id="provider" v-model="provider" class="field-control">
          <option
            v-for="item in availableProviders"
            :key="item.value"
            :value="item.value"
          >
            {{ item.label }}
          </option>
        </select>
        <p class="field-hint">{{ selectedProviderConfig?.note }}</p>

        <template v-if="provider !== 'comfyui'">
          <label class="field-label" for="model">模型</label>
          <select id="model" v-model="videoForm.model" class="field-control">
            <option v-for="model in availableProviderModels" :key="model.value" :value="model.value">
              {{ model.label }}
            </option>
          </select>

          <label class="field-label" for="aspect">画面比例</label>
          <select id="aspect" v-model="videoForm.aspectRatio" class="field-control">
            <option v-for="aspect in availableAspectPresets" :key="aspect.value" :value="aspect.value">
              {{ aspect.label }}
            </option>
          </select>

          <label class="field-label" for="size">输出尺寸</label>
          <select id="size" v-model="videoForm.size" class="field-control" @change="applySelectedSize">
            <option v-for="size in availableSizePresets" :key="size.value" :value="size.value">
              {{ size.label }}
            </option>
            <option value="custom">自定义尺寸</option>
          </select>
          <div class="size-grid">
            <input
              v-model.number="videoForm.width"
              class="field-control"
              type="number"
              min="256"
              max="4096"
              step="8"
              aria-label="宽度"
              @input="videoForm.size = 'custom'"
            />
            <span>×</span>
            <input
              v-model.number="videoForm.height"
              class="field-control"
              type="number"
              min="256"
              max="4096"
              step="8"
              aria-label="高度"
              @input="videoForm.size = 'custom'"
            />
          </div>

          <label class="field-label" for="duration">时长</label>
          <div class="duration-row">
            <input
              id="duration"
              v-model.number="videoForm.duration"
              class="field-control"
              type="number"
              min="1"
              :max="maxDuration"
              step="1"
            />
            <span>秒</span>
          </div>
          <p v-if="provider === 'agnes'" class="field-hint">
            24 fps · {{ agnesFrameCount }} 帧
          </p>
          <div class="quick-row">
            <button
              v-for="seconds in durationPresets"
              :key="seconds"
              type="button"
              class="preset-button"
              :class="{ active: videoForm.duration === seconds }"
              @click="videoForm.duration = seconds"
            >
              {{ seconds }}s
            </button>
          </div>

          <label class="field-label" for="image-url">参考图 URL</label>
          <input id="image-url" v-model.trim="videoForm.imageUrl" class="field-control" placeholder="可选，粘贴图片 URL 生成 AI 视频" />

          <label class="field-label" for="image-upload">上传参考图</label>
          <label class="upload-box" for="image-upload">
            <input id="image-upload" class="upload-input" type="file" accept="image/*" @change="handleReferenceUpload" />
            <img v-if="referenceImagePreview" :src="referenceImagePreview" alt="参考图预览" />
            <span v-else>点击上传 JPG / PNG / WebP 参考图</span>
          </label>
          <button v-if="referenceImagePreview" type="button" class="link-button clear-upload" @click="clearReferenceImage">
            移除上传图片
          </button>
        </template>

        <template v-else>
          <label class="field-label" for="comfy-url">ComfyUI 地址</label>
          <input id="comfy-url" v-model.trim="comfyForm.serverUrl" class="field-control" placeholder="例如：http://127.0.0.1:8188" />

          <label class="field-label" for="workflow">Workflow JSON</label>
          <textarea
            id="workflow"
            v-model="comfyForm.workflowJson"
            class="field-control workflow-input"
            placeholder="粘贴 ComfyUI API 格式 workflow JSON"
          />
          <p class="field-hint">此模式提交到 ComfyUI 的 /prompt；若跨域被浏览器拦截，需在服务器侧加反代。</p>
        </template>
      </section>
    </aside>

    <main class="video-workspace">
      <div class="workspace-card">
        <div class="workspace-toolbar">
          <span>视频预览</span>
          <div class="result-actions">
            <button type="button" class="open-button" @click="openResult" :disabled="!currentVideoUrl">
              <Icon name="externalLink" size="sm" />
              新窗口打开
            </button>
            <button type="button" class="open-button" @click="downloadResult" :disabled="!canDownload">
              <Icon name="download" size="sm" />
              下载
            </button>
          </div>
        </div>

        <div v-if="currentVideoUrl" class="result-stage">
          <video :src="currentVideoUrl" controls playsinline class="result-video" />
        </div>
        <div v-else class="empty-stage">
          <div class="empty-icon" aria-hidden="true">
            <Icon name="play" size="lg" />
          </div>
          <h1>直接在这里发起 AI 视频</h1>
          <p>支持文生视频、参考图生成 AI 视频和异步任务查询。</p>
        </div>

        <div v-if="requestId || taskStatus || errorMessage" class="task-strip">
          <span v-if="taskStatus" class="task-badge">{{ taskStatus }}</span>
          <span v-if="taskProgress !== null">进度 {{ taskProgress }}%</span>
          <span v-if="queuePosition !== null">队列位置 {{ queuePosition }}</span>
          <span v-if="estimatedRemainingSeconds !== null">预计剩余 {{ formatDuration(estimatedRemainingSeconds) }}</span>
          <span v-if="taskStartedAt && !isTerminalVideoStatus(taskStatus)">已等待 {{ formatDuration(elapsedSeconds) }}</span>
          <span v-if="requestId" class="task-id">任务：{{ requestId }}</span>
          <span v-if="actualSize">实际尺寸：{{ actualSize }}</span>
          <span v-if="actualSeconds">实际时长：{{ actualSeconds }} 秒</span>
          <span v-if="errorMessage" class="task-error">{{ errorMessage }}</span>
        </div>

        <div v-if="rawResponse" class="raw-response">
          <button type="button" class="link-button" @click="showRaw = !showRaw">
            {{ showRaw ? '收起响应' : '查看响应' }}
          </button>
          <pre v-if="showRaw">{{ rawResponse }}</pre>
        </div>

        <form class="prompt-bar" @submit.prevent="handleGenerate">
          <textarea
            v-model.trim="prompt"
            class="prompt-input"
            rows="3"
            placeholder="建议用英文描述镜头，例如：A cinematic tracking shot of a neon city street after rain, smooth camera movement."
          />
          <div class="prompt-actions">
            <button type="button" class="secondary-button" :disabled="!canPoll" @click="pollStatus()">
              查询结果
            </button>
            <button type="submit" class="primary-button" :disabled="submitting || !canSubmit">
              {{ submitting ? '生成中' : '开始生成' }}
            </button>
          </div>
        </form>
      </div>
    </main>
    <GenerationHistoryPanel media-type="video" @select="restoreVideoRecord" @pending="refreshVideoRecords" />
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import AppLayout from '@/components/layout/AppLayout.vue'
import Icon from '@/components/icons/Icon.vue'
import GenerationHistoryPanel from '@/components/user/GenerationHistoryPanel.vue'
import { generationRecordsAPI, type GenerationRecord } from '@/api/generationRecords'
import { keysAPI } from '@/api'
import {
  AGNES_VIDEO_MODEL,
  GROK_COMPATIBLE_VIDEO_MODELS,
  normalizeAgnesFrameCount,
  videoModelsForProvider,
  videoGenerationAPI,
  type GatewayVideoProvider,
  type VideoModel,
  type VideoProvider
} from '@/api/videoGeneration'
import type { ApiKey } from '@/types'

interface ProviderModel {
  label: string
  value: VideoModel
}

interface ProviderConfig {
  value: VideoProvider
  label: string
  note: string
  models: ProviderModel[]
}

interface SizePreset {
  value: string
  label: string
  aspectRatio: string
  width: number
  height: number
  providers: GatewayVideoProvider[]
}

const videoProviders: ProviderConfig[] = [
  {
    value: 'grok',
    label: 'Grok 兼容视频',
    note: '使用绑定 Grok 分组的 API 密钥。',
    models: GROK_COMPATIBLE_VIDEO_MODELS.map((model) => ({ label: model, value: model }))
  },
  {
    value: 'agnes',
    label: 'Agnes Video V2.0',
    note: '使用绑定 Agnes 专用分组的 API 密钥。',
    models: [{ label: AGNES_VIDEO_MODEL, value: AGNES_VIDEO_MODEL }]
  },
  {
    value: 'comfyui',
    label: 'ComfyUI Workflow',
    note: '直接提交本地或服务器 ComfyUI workflow，适合自定义节点流。',
    models: []
  }
]

const aspectPresets = [
  { value: '16:9', label: '16:9 横屏' },
  { value: '9:16', label: '9:16 竖屏' },
  { value: '1:1', label: '1:1 方屏' },
  { value: '4:3', label: '4:3 横屏' },
  { value: '3:4', label: '3:4 竖屏' },
  { value: '3:2', label: '3:2 横屏' },
  { value: '2:3', label: '2:3 竖屏' }
]

const sizePresets: SizePreset[] = [
  { value: '1280x720', label: '1280 × 720', aspectRatio: '16:9', width: 1280, height: 720, providers: ['grok', 'agnes'] },
  { value: '854x480', label: '854 × 480', aspectRatio: '16:9', width: 854, height: 480, providers: ['grok', 'agnes'] },
  { value: '720x1280', label: '720 × 1280 竖屏', aspectRatio: '9:16', width: 720, height: 1280, providers: ['grok', 'agnes'] },
  { value: '480x854', label: '480 × 854 竖屏', aspectRatio: '9:16', width: 480, height: 854, providers: ['grok', 'agnes'] },
  { value: '720x720', label: '720 × 720 方屏', aspectRatio: '1:1', width: 720, height: 720, providers: ['grok', 'agnes'] },
  { value: '480x480', label: '480 × 480 方屏', aspectRatio: '1:1', width: 480, height: 480, providers: ['grok', 'agnes'] },
  { value: '960x720', label: '960 × 720 4:3', aspectRatio: '4:3', width: 960, height: 720, providers: ['grok', 'agnes'] },
  { value: '640x480', label: '640 × 480 4:3', aspectRatio: '4:3', width: 640, height: 480, providers: ['grok', 'agnes'] },
  { value: '720x960', label: '720 × 960 3:4', aspectRatio: '3:4', width: 720, height: 960, providers: ['grok', 'agnes'] },
  { value: '480x640', label: '480 × 640 3:4', aspectRatio: '3:4', width: 480, height: 640, providers: ['grok', 'agnes'] },
  { value: '1152x768', label: '1152 × 768 Agnes 推荐', aspectRatio: '3:2', width: 1152, height: 768, providers: ['agnes'] },
  { value: '1080x720', label: '1080 × 720 3:2', aspectRatio: '3:2', width: 1080, height: 720, providers: ['grok'] },
  { value: '720x480', label: '720 × 480 3:2', aspectRatio: '3:2', width: 720, height: 480, providers: ['grok'] },
  { value: '720x1080', label: '720 × 1080 2:3', aspectRatio: '2:3', width: 720, height: 1080, providers: ['grok'] },
  { value: '480x720', label: '480 × 720 2:3', aspectRatio: '2:3', width: 480, height: 720, providers: ['grok'] }
]

const apiKeys = ref<ApiKey[]>([])
const videoModelsByKeyId = ref<Record<string, string[]>>({})
const selectedKeyId = ref('')
const provider = ref<VideoProvider>('grok')
const discoveredVideoModels = ref<string[]>([])
const videoModelDiscovery = ref<'idle' | 'loading' | 'succeeded' | 'failed'>('idle')
const durationPresets = computed(() => (provider.value === 'agnes' ? [3, 5, 10, 18] : [5, 10, 15]))
const maxDuration = computed(() => (provider.value === 'agnes' ? 18 : 15))
const prompt = ref('')
const submitting = ref(false)
const errorMessage = ref('')
const taskStatus = ref('')
const requestId = ref('')
const taskProvider = ref<VideoProvider | ''>('')
const taskModel = ref('')
const taskKeyId = ref('')
const currentVideoUrl = ref('')
let localVideoObjectUrl = ''
const actualSize = ref('')
const actualSeconds = ref('')
const taskProgress = ref<number | null>(null)
const queuePosition = ref<number | null>(null)
const estimatedRemainingSeconds = ref<number | null>(null)
const taskStartedAt = ref(0)
const elapsedSeconds = ref(0)
const rawResponse = ref('')
const showRaw = ref(false)
const referenceImagePreview = ref('')
let modelRequestVersion = 0
let videoTaskVersion = 0
let videoPollTimer: number | null = null
let elapsedTimer: number | null = null
let videoPollAttempts = 0
const VIDEO_POLL_INTERVAL_MS = 5000
const VIDEO_POLL_MAX_ATTEMPTS = 60

const videoForm = reactive<{
  model: VideoModel
  aspectRatio: string
  duration: number
  imageUrl: string
  size: string
  width: number
  height: number
}>({
  model: 'grok-imagine-video',
  aspectRatio: '16:9',
  duration: 10,
  imageUrl: '',
  size: '1280x720',
  width: 1280,
  height: 720
})

const comfyForm = reactive({
  serverUrl: 'http://127.0.0.1:8188',
  workflowJson: ''
})

const selectedApiKey = computed(() => apiKeys.value.find((key) => String(key.id) === selectedKeyId.value) ?? null)
const selectedProviderConfig = computed(() => videoProviders.find((item) => item.value === provider.value) ?? videoProviders[0])
const availableProviders = computed(() => videoProviders.filter((item) =>
  item.value !== 'comfyui' && videoModelsForProvider(discoveredVideoModels.value, item.value).length > 0
))
const availableProviderModels = computed<ProviderModel[]>(() => {
  const activeProvider = provider.value
  const staticModels = selectedProviderConfig.value?.models ?? []
  if (activeProvider === 'comfyui') return staticModels
  if (videoModelDiscovery.value !== 'succeeded') return []
  return videoModelsForProvider(discoveredVideoModels.value, activeProvider)
    .map((model) => ({ label: model, value: model }))
})
const availableAspectPresets = computed(() =>
  provider.value === 'agnes'
    ? aspectPresets.filter((aspect) => aspect.value !== '2:3')
    : aspectPresets
)
const availableSizePresets = computed(() => {
  const activeProvider = provider.value
  if (activeProvider === 'comfyui') return []
  return sizePresets.filter(
    (size) =>
      size.providers.includes(activeProvider) && size.aspectRatio === videoForm.aspectRatio
  )
})
const agnesFrameCount = computed(() => normalizeAgnesFrameCount(videoForm.duration))
const activeTaskKey = computed(() =>
  apiKeys.value.find((key) => String(key.id) === taskKeyId.value) ?? selectedApiKey.value
)
const canSubmit = computed(() => {
  if (provider.value !== 'comfyui') {
    return Boolean(
      selectedApiKey.value?.key &&
        prompt.value &&
        videoForm.model &&
        availableProviderModels.value.some((model) => model.value === videoForm.model) &&
        videoForm.duration >= 1 &&
        videoForm.duration <= maxDuration.value &&
        Number.isFinite(videoForm.width) &&
        Number.isFinite(videoForm.height) &&
        videoForm.width >= 256 &&
        videoForm.height >= 256
    )
  }
  return Boolean(comfyForm.serverUrl && comfyForm.workflowJson)
})

const canPoll = computed(() =>
  Boolean(
    requestId.value &&
      (taskProvider.value === 'comfyui' ? comfyForm.serverUrl : activeTaskKey.value?.key)
  )
)
const canDownload = computed(() =>
  Boolean(
    currentVideoUrl.value ||
      (requestId.value && taskProvider.value !== 'comfyui' && activeTaskKey.value?.key)
  )
)

function maskKey(key: string): string {
  if (!key) return ''
  if (key.length <= 14) return `${key.slice(0, 4)}***${key.slice(-4)}`
  return `${key.slice(0, 8)}...${key.slice(-6)}`
}

function resetDefaults() {
  invalidateVideoTask()
  submitting.value = false
  provider.value = 'grok'
  videoForm.model = 'grok-imagine-video'
  videoForm.aspectRatio = '16:9'
  videoForm.duration = 10
  videoForm.imageUrl = ''
  videoForm.size = '1280x720'
  videoForm.width = 1280
  videoForm.height = 720
  referenceImagePreview.value = ''
  taskStatus.value = ''
  errorMessage.value = ''
  requestId.value = ''
  taskProvider.value = ''
  taskModel.value = ''
  taskKeyId.value = ''
  currentVideoUrl.value = ''
  actualSize.value = ''
  actualSeconds.value = ''
  rawResponse.value = ''
}

function applySelectedSize() {
  const preset = sizePresets.find((size) => size.value === videoForm.size)
  if (!preset) return
  videoForm.aspectRatio = preset.aspectRatio
  videoForm.width = preset.width
  videoForm.height = preset.height
}

function ensureSizeForAspect() {
  if (videoForm.size === 'custom') return
  const current = availableSizePresets.value.find((size) => size.value === videoForm.size)
  if (current) return
  const next = availableSizePresets.value[0]
  if (!next) return
  videoForm.size = next.value
  videoForm.width = next.width
  videoForm.height = next.height
}

function handleReferenceUpload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    referenceImagePreview.value = typeof reader.result === 'string' ? reader.result : ''
  }
  reader.readAsDataURL(file)
}

function clearReferenceImage() {
  referenceImagePreview.value = ''
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  if (safeSeconds < 60) return `${safeSeconds} 秒`
  const minutes = Math.floor(safeSeconds / 60)
  const remainder = safeSeconds % 60
  return remainder > 0 ? `${minutes} 分 ${remainder} 秒` : `${minutes} 分钟`
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function firstFiniteNumber(values: unknown[]): number | null {
  for (const value of values) {
    const parsed = finiteNumber(value)
    if (parsed !== null) return parsed
  }
  return null
}

function stopElapsedTimer() {
  if (elapsedTimer !== null) {
    window.clearInterval(elapsedTimer)
    elapsedTimer = null
  }
}

function startElapsedTimer(startedAt = Date.now()) {
  stopElapsedTimer()
  taskStartedAt.value = Number.isFinite(startedAt) && startedAt > 0 ? startedAt : Date.now()
  const updateElapsed = () => {
    elapsedSeconds.value = Math.max(0, Math.floor((Date.now() - taskStartedAt.value) / 1000))
  }
  updateElapsed()
  elapsedTimer = window.setInterval(updateElapsed, 1000)
}

function resetTaskMetrics() {
  stopElapsedTimer()
  taskProgress.value = null
  queuePosition.value = null
  estimatedRemainingSeconds.value = null
  taskStartedAt.value = 0
  elapsedSeconds.value = 0
}

function updateTaskMetrics(data: Record<string, unknown>) {
  const nestedData = asRecord(data.data)
  const rootQueue = asRecord(data.queue)
  const nestedQueue = asRecord(nestedData?.queue)
  const progress = firstFiniteNumber([data.progress, nestedData?.progress])
  const queue = firstFiniteNumber([
    data.queue_position,
    data.position,
    rootQueue?.position,
    nestedData?.queue_position,
    nestedData?.position,
    nestedQueue?.position
  ])
  const eta = firstFiniteNumber([
    data.estimated_seconds,
    data.eta_seconds,
    data.remaining_seconds,
    nestedData?.estimated_seconds,
    nestedData?.eta_seconds,
    nestedData?.remaining_seconds
  ])

  taskProgress.value = progress === null
    ? null
    : Math.min(100, Math.max(0, Math.round(progress <= 1 ? progress * 100 : progress)))
  queuePosition.value = queue === null || queue < 0 ? null : Math.max(0, Math.floor(queue))
  estimatedRemainingSeconds.value = eta === null || eta < 0 ? null : Math.floor(eta)
}

function extractRequestId(data: Record<string, unknown>): string {
  return String(data.request_id || data.id || '')
}

function extractVideoUrl(data: Record<string, unknown>): string {
  const video = asRecord(data.video)
  const nestedData = asRecord(data.data)
  const nestedVideo = asRecord(nestedData?.video)
  const candidates = [video?.url, data.url, nestedVideo?.url]
  for (const key of ['data', 'output']) {
    const value = data[key]
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object' && 'url' in item) {
          candidates.push((item as { url?: string }).url)
        }
      }
    }
  }
  return String(candidates.find((value) => typeof value === 'string' && value.length > 0) ?? '')
}

function extractResponseError(data: Record<string, unknown>): string {
  const error = asRecord(data.error)
  const candidates = [error?.message, data.error, data.message, data.detail]
  return String(candidates.find((value) => typeof value === 'string' && value.trim()) || '').trim()
}

function updateActualOutput(data: Record<string, unknown>) {
  const video = asRecord(data.video)
  const seconds = video?.duration ?? data.seconds
  const width = Number(video?.width) || 0
  const height = Number(video?.height) || 0
  actualSeconds.value = seconds === undefined || seconds === null ? '' : String(seconds)
  actualSize.value =
    width > 0 && height > 0
      ? `${width}x${height}`
      : String(video?.size || data.size || '')
}

function applyGatewayResponse(data: Record<string, unknown>, fallbackStatus: string) {
	setRaw(data)
	releaseLocalVideoObjectUrl()
	currentVideoUrl.value = extractVideoUrl(data)
  updateActualOutput(data)
  updateTaskMetrics(data)
  taskStatus.value = String(data.status || (currentVideoUrl.value ? 'completed' : fallbackStatus))
  if (['failed', 'error', 'cancelled', 'canceled', 'expired'].includes(taskStatus.value.toLowerCase())) {
    errorMessage.value = extractResponseError(data) || '视频任务生成失败，请查看响应详情'
  }
  if (isTerminalVideoStatus(taskStatus.value)) stopElapsedTimer()
}

function isTerminalVideoStatus(status: string): boolean {
  return ['completed', 'success', 'succeeded', 'done', 'failed', 'error', 'cancelled', 'canceled', 'expired']
    .includes(status.trim().toLowerCase())
}

function stopAutoPolling() {
  if (videoPollTimer !== null) {
    window.clearTimeout(videoPollTimer)
    videoPollTimer = null
  }
}

function invalidateVideoTask() {
  videoTaskVersion += 1
  stopAutoPolling()
  stopElapsedTimer()
}

function releaseLocalVideoObjectUrl() {
	if (!localVideoObjectUrl) return
	URL.revokeObjectURL(localVideoObjectUrl)
	localVideoObjectUrl = ''
}

function scheduleAutoPolling(version = videoTaskVersion) {
  if (version !== videoTaskVersion) return
  stopAutoPolling()
  if (
    !requestId.value ||
    taskProvider.value === 'comfyui' ||
    currentVideoUrl.value ||
    isTerminalVideoStatus(taskStatus.value)
  ) return
  if (videoPollAttempts >= VIDEO_POLL_MAX_ATTEMPTS) {
    errorMessage.value = '视频任务仍在处理中，请稍后点击“查询结果”继续查看'
    return
  }

  videoPollTimer = window.setTimeout(async () => {
    videoPollTimer = null
    if (version !== videoTaskVersion) return
    videoPollAttempts += 1
    await pollStatus(true, version)
    scheduleAutoPolling(version)
  }, VIDEO_POLL_INTERVAL_MS)
}

function setRaw(data: unknown) {
  rawResponse.value = JSON.stringify(data, null, 2)
}

async function loadApiKeys() {
  const response = await keysAPI.list(1, 50, { status: 'active' })
  const checked = await Promise.all(response.items.map(async (key) => {
    try { return { key, models: await videoGenerationAPI.listVideoModels(key.key) } }
    catch { return { key, models: [] as string[] } }
  }))
  const supported = checked.filter((item) => item.models.length > 0)
  videoModelsByKeyId.value = Object.fromEntries(supported.map((item) => [String(item.key.id), item.models]))
  apiKeys.value = supported.map((item) => item.key)
  if (!apiKeys.value.some((key) => String(key.id) === selectedKeyId.value)) {
    selectedKeyId.value = apiKeys.value[0] ? String(apiKeys.value[0].id) : ''
  }
}

async function loadVideoModelsForSelectedKey() {
  const version = ++modelRequestVersion
  discoveredVideoModels.value = []
  const keyID = selectedKeyId.value
  videoModelDiscovery.value = keyID ? 'loading' : 'idle'
  if (!keyID) return

  try {
    const models = videoModelsByKeyId.value[keyID] ?? []
    if (version !== modelRequestVersion) return
    discoveredVideoModels.value = models
    videoModelDiscovery.value = 'succeeded'

    const hasAgnes = videoModelsForProvider(models, 'agnes').length > 0
    const hasGrokCompatible = videoModelsForProvider(models, 'grok').length > 0
    if (hasAgnes && !hasGrokCompatible) provider.value = 'agnes'
    if (hasGrokCompatible && !hasAgnes) provider.value = 'grok'
    if (!availableProviderModels.value.some((model) => model.value === videoForm.model)) {
      videoForm.model = availableProviderModels.value[0]?.value ?? ''
    }
  } catch {
    if (version !== modelRequestVersion) return
    videoModelDiscovery.value = 'failed'
    discoveredVideoModels.value = []
  }
}

async function restoreVideoRecord(record: GenerationRecord) {
	invalidateVideoTask()
	releaseLocalVideoObjectUrl()
	const version = videoTaskVersion
	errorMessage.value = ''
	currentVideoUrl.value = ''
	requestId.value = record.upstream_task_id || ''
	taskKeyId.value = ''
	taskProvider.value = record.provider === 'agnes' ? 'agnes' : 'grok'
	taskModel.value = record.model
	taskStatus.value = record.status
	resetTaskMetrics()
	setRaw(record.result || {})
	if (record.result?.files?.length) {
		try {
			const blob = await generationRecordsAPI.content(record.task_id, 0)
			if (version !== videoTaskVersion) return
			localVideoObjectUrl = URL.createObjectURL(blob)
			currentVideoUrl.value = localVideoObjectUrl
			stopElapsedTimer()
			return
		} catch {
			if (version !== videoTaskVersion) return
			errorMessage.value = '服务端视频文件已不可用'
		}
	}
	const fallbackURL = record.result?.urls?.[0]
	if (fallbackURL) {
		currentVideoUrl.value = fallbackURL
		stopElapsedTimer()
		return
	}
	const key = apiKeys.value.find((item) => item.id === record.api_key_id)
	if (!key || !record.upstream_task_id) { errorMessage.value = '原任务密钥已不可用或任务尚未提交'; return }
	selectedKeyId.value = String(key.id)
	taskKeyId.value = String(key.id)
	const createdAt = Date.parse(record.created_at)
	if (!isTerminalVideoStatus(record.status)) startElapsedTimer(createdAt)
	void pollStatus()
}

async function refreshVideoRecords(records: GenerationRecord[]) {
  await Promise.all(records.map(async (record) => {
    const key = apiKeys.value.find((item) => item.id === record.api_key_id)
    if (!key || !record.upstream_task_id || (record.provider !== 'grok' && record.provider !== 'agnes')) return
    try { await videoGenerationAPI.getVideoStatus(key.key, record.upstream_task_id, record.provider, record.model || undefined) }
    catch { /* 单条历史任务失败不影响其他记录 */ }
  }))
}

async function handleGenerate() {
	invalidateVideoTask()
	releaseLocalVideoObjectUrl()
  resetTaskMetrics()
  startElapsedTimer()
  const version = videoTaskVersion
  videoPollAttempts = 0
  errorMessage.value = ''
  taskStatus.value = ''
  currentVideoUrl.value = ''
  actualSize.value = ''
  actualSeconds.value = ''
  rawResponse.value = ''
  requestId.value = ''
  taskProvider.value = ''
  taskModel.value = ''
  taskKeyId.value = ''
  submitting.value = true

  try {
    if (provider.value !== 'comfyui') {
      if (!selectedApiKey.value) throw new Error('请先选择 API 密钥')
      const activeProvider: GatewayVideoProvider = provider.value
      const data = await videoGenerationAPI.generateVideo({
        apiKey: selectedApiKey.value.key,
        provider: activeProvider,
        prompt: prompt.value,
        model: videoForm.model,
        aspectRatio: videoForm.aspectRatio,
        duration: videoForm.duration,
        imageUrl: videoForm.imageUrl,
        referenceImage: referenceImagePreview.value,
        size: videoForm.size === 'custom' ? undefined : videoForm.size,
        width: videoForm.width,
        height: videoForm.height
      })
      if (version !== videoTaskVersion) return
      requestId.value = extractRequestId(data)
      taskProvider.value = data.provider === 'grok' || data.provider === 'agnes' ? data.provider : activeProvider
      taskModel.value = videoForm.model
      taskKeyId.value = selectedKeyId.value
      applyGatewayResponse(data, 'submitted')
      if (!requestId.value && !currentVideoUrl.value) {
        throw new Error('视频服务未返回 request_id，无法查询异步任务')
      }
      scheduleAutoPolling()
      return
    }

    const workflow = JSON.parse(comfyForm.workflowJson) as Record<string, unknown>
    const data = await videoGenerationAPI.submitComfyPrompt({
      serverUrl: comfyForm.serverUrl,
      workflow,
      clientId: `auric-video-${Date.now()}`
    })
    if (version !== videoTaskVersion) return
    setRaw(data)
    requestId.value = data.prompt_id || ''
    taskProvider.value = 'comfyui'
    taskStatus.value = data.prompt_id ? 'submitted' : 'unknown'
  } catch (error) {
    if (version !== videoTaskVersion) return
    errorMessage.value = error instanceof Error ? error.message : '生成失败，请检查参数或接口配置'
    stopElapsedTimer()
  } finally {
    if (version === videoTaskVersion) submitting.value = false
  }
}

async function pollStatus(automatic = false, version = videoTaskVersion) {
  if (!requestId.value) return
  const pollingRequestID = requestId.value
  const pollingProvider = taskProvider.value || provider.value
  const pollingModel = taskModel.value || undefined
  const pollingKey = activeTaskKey.value
  if (!automatic) {
    errorMessage.value = ''
    submitting.value = true
  }
  try {
    if (pollingProvider !== 'comfyui') {
      if (!pollingKey) throw new Error('找不到创建该任务时使用的 API 密钥')
      const data = await videoGenerationAPI.getVideoStatus(
        pollingKey.key,
        pollingRequestID,
        pollingProvider,
        pollingModel
      )
      if (version !== videoTaskVersion || pollingRequestID !== requestId.value) return
      applyGatewayResponse(data, 'processing')
      return
    }

    const data = await videoGenerationAPI.getComfyHistory(comfyForm.serverUrl, pollingRequestID)
    if (version !== videoTaskVersion || pollingRequestID !== requestId.value) return
    setRaw(data)
    taskStatus.value = Object.keys(data).length > 0 ? 'history_loaded' : 'processing'
  } catch (error) {
    if (version !== videoTaskVersion || pollingRequestID !== requestId.value) return
    errorMessage.value = error instanceof Error ? error.message : '查询失败，请稍后重试'
  } finally {
    if (!automatic && version === videoTaskVersion) submitting.value = false
  }
}

function openResult() {
  if (currentVideoUrl.value) {
    window.open(currentVideoUrl.value, '_blank', 'noopener,noreferrer')
  }
}

function triggerDownload(url: string) {
  const link = document.createElement('a')
  link.href = url
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.download = `video-${requestId.value || Date.now()}.mp4`
  document.body.appendChild(link)
  link.click()
  link.remove()
}

async function downloadResult() {
  errorMessage.value = ''
  if (currentVideoUrl.value) {
    triggerDownload(currentVideoUrl.value)
    return
  }
  const providerForTask = taskProvider.value
  if (!requestId.value || providerForTask === 'comfyui' || !providerForTask) return
  if (!activeTaskKey.value) {
    errorMessage.value = '找不到创建该任务时使用的 API 密钥'
    return
  }

  submitting.value = true
  try {
    const blob = await videoGenerationAPI.downloadVideoContent(
      activeTaskKey.value.key,
      requestId.value,
      providerForTask,
      taskModel.value || undefined
    )
    const objectUrl = URL.createObjectURL(blob)
    triggerDownload(objectUrl)
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '视频下载失败，请先查询任务结果'
  } finally {
    submitting.value = false
  }
}

watch(provider, () => {
  videoForm.model = availableProviderModels.value[0]?.value ?? ''
  if (provider.value === 'agnes') {
    videoForm.aspectRatio = '3:2'
    videoForm.duration = 5
    videoForm.size = '1152x768'
    videoForm.width = 1152
    videoForm.height = 768
  } else if (provider.value === 'grok') {
    videoForm.aspectRatio = '16:9'
    videoForm.duration = 10
    videoForm.size = '1280x720'
    videoForm.width = 1280
    videoForm.height = 720
  }
})

watch(() => videoForm.aspectRatio, ensureSizeForAspect)
watch(selectedKeyId, () => {
  void loadVideoModelsForSelectedKey()
})

onMounted(() => {
  loadApiKeys().catch((error) => {
    errorMessage.value = error instanceof Error ? error.message : '加载 API 密钥失败'
  })
})

onBeforeUnmount(() => {
	invalidateVideoTask()
	releaseLocalVideoObjectUrl()
})
</script>

<style scoped>
.video-page {
  width: 100%;
  max-width: 1760px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(280px, 320px) minmax(480px, 1fr) minmax(240px, 280px);
  align-items: start;
  gap: 16px;
  min-height: calc(100vh - 128px);
}

.video-panel,
.workspace-card {
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.08);
}

.video-panel {
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

.field-control:focus {
  border-color: #67e8f9;
  box-shadow: 0 0 0 4px rgba(103, 232, 249, 0.18);
}

.workflow-input {
  min-height: 172px;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

.size-grid,
.duration-row {
  display: grid;
  align-items: center;
  gap: 8px;
}

.size-grid {
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  margin-top: 8px;
  color: #64748b;
  font-weight: 760;
}

.duration-row {
  grid-template-columns: minmax(0, 1fr) auto;
}

.quick-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.preset-button {
  min-width: 44px;
  border: 1px solid #e2e8f0;
  border-radius: 999px;
  background: #fff;
  color: #64748b;
  font-size: 12px;
  font-weight: 760;
  padding: 8px 10px;
}

.preset-button.active {
  border-color: #14b8a6;
  background: #ccfbf1;
  color: #0f766e;
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

.upload-input {
  display: none;
}

.upload-box img {
  width: 100%;
  max-height: 180px;
  object-fit: contain;
}

.clear-upload {
  margin-top: 8px;
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
  align-items: center;
  justify-content: center;
  min-height: 28px;
  margin-top: 12px;
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

.result-actions {
  display: flex;
  gap: 8px;
}

.open-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
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

.empty-stage,
.result-stage {
  display: flex;
  min-height: clamp(400px, calc(100vh - 390px), 620px);
  flex: 1;
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
  margin-bottom: 28px;
  place-items: center;
  border-radius: 20px;
  background: #dbeafe;
  color: #2563eb;
}

.empty-stage h1 {
  margin: 0;
  color: #0f172a;
  font-size: 24px;
  font-weight: 820;
}

.empty-stage p {
  margin: 16px 0 0;
  max-width: 540px;
  color: #64748b;
  font-size: 14px;
}

.result-stage {
  background: #020617;
  padding: 36px;
}

.result-video {
  max-width: 100%;
  max-height: 64vh;
  border-radius: 16px;
  background: #020617;
}

.task-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  border-top: 1px solid #e2e8f0;
  padding: 12px 18px;
  color: #64748b;
  font-size: 13px;
}

.task-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.task-error {
  color: #dc2626;
  font-weight: 700;
}

.raw-response {
  border-top: 1px solid #e2e8f0;
  padding: 12px 18px;
}

.raw-response pre {
  max-height: 220px;
  overflow: auto;
  margin: 10px 0 0;
  border-radius: 12px;
  background: #0f172a;
  color: #dbeafe;
  font-size: 12px;
  padding: 14px;
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
  border-radius: 999px;
  padding: 12px 18px;
}

.primary-button {
  background: #5eead4;
  color: #0f766e;
}

.secondary-button {
  background: #f8fafc;
  color: #64748b;
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

:global(.dark) .video-panel,
:global(.dark) .workspace-card {
  border-color: rgba(51, 65, 85, 0.9);
  background: rgba(15, 23, 42, 0.9);
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

:global(.dark) .preset-button {
  border-color: #334155;
  background: #0f172a;
  color: #94a3b8;
}

:global(.dark) .preset-button.active {
  border-color: #2dd4bf;
  background: rgba(20, 184, 166, 0.18);
  color: #99f6e4;
}

:global(.dark) .upload-box {
  border-color: #475569;
  background: #0f172a;
  color: #94a3b8;
}

@media (max-width: 1500px) {
  .video-page {
    grid-template-columns: minmax(280px, 320px) minmax(0, 1fr);
  }

  .video-page > :deep(.generation-history) {
    grid-column: 1 / -1;
  }
}

@media (max-width: 1180px) {
  .video-page {
    grid-template-columns: 1fr;
  }

  .video-panel {
    position: static;
    max-height: none;
    overflow: visible;
  }

  .empty-stage,
  .result-stage {
    min-height: 420px;
  }
}

@media (max-width: 640px) {
  .video-panel {
    padding: 16px;
  }

  .empty-stage,
  .result-stage {
    min-height: 340px;
  }

  .workspace-card {
    min-height: auto;
  }

  .workspace-toolbar {
    align-items: flex-start;
    flex-direction: column;
  }

  .result-actions {
    width: 100%;
  }

  .result-actions .open-button {
    flex: 1;
  }

  .prompt-actions {
    flex-direction: column;
  }
}
</style>
