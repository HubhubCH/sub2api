<template>
  <AppLayout>
    <div class="online-creator-page" :class="{ 'overview-mode': activeTool === 'home' }">
      <CreatorToolRail :tools="tools" :active-tool="activeTool" :disabled="submitting" @select="selectTool" />

      <main class="creator-workspace">
        <CreatorHomePanel
          v-if="activeTool === 'home'"
          :tools="homeTools"
          :recent="recentItems"
          @select="selectTool"
          @open-history="selectTool('history')"
        />

        <CreatorHistoryPanel
          v-else-if="activeTool === 'history'"
          :backend-records="records"
          :local-records="localRecords"
          @restore-backend="restoreRecord"
          @restore-local="restoreLocalRecord"
        />

        <section v-else class="creator-form-card">
          <div class="tool-title">
            <h1>{{ activeToolConfig.label }}</h1>
            <span>{{ activeToolConfig.badge }}</span>
          </div>

          <CreatorKeyPicker v-model="selectedKeyId" :keys="usableKeys" :disabled="submitting" />

          <div v-if="activeTool === 'assistant'" class="assistant-log">
            <div v-for="message in assistantMessages" :key="message.id" :class="['message-row', message.role]">
              {{ message.content }}
            </div>
          </div>

          <div v-if="modelWarning" class="unsupported-note">
            <span>{{ modelWarning }}</span>
            <button v-if="activeModelLoadError" type="button" data-test="creator-retry-models" @click="loadModelsForSelectedKey">重试</button>
          </div>

          <div class="panel-block">
            <div class="form-grid">
              <label v-if="needsModel" class="field-block">
                <span>模型</span>
                <select v-model="selectedModel" class="field-control" :disabled="submitting || modelOptions.length === 0">
                  <option v-if="modelOptions.length === 0" value="">当前密钥暂无可用模型</option>
                  <option v-for="model in modelOptions" :key="model" :value="model">{{ model }}</option>
                </select>
              </label>

              <label v-if="isTextTool || isAudioTool || activeTool === 'image-translate' || activeTool === 'product-copy'" class="field-block">
                <span>语言</span>
                <select v-model="targetLanguage" class="field-control">
                  <option value="中文">中文</option>
                  <option value="英文">英文</option>
                  <option value="日文">日文</option>
                  <option value="韩文">韩文</option>
                </select>
              </label>

              <label v-if="isImageTool || activeTool === 'batch-main' || activeTool === 'batch-clone'" class="field-block">
                <span>画面尺寸</span>
                <select v-model="imageSize" class="field-control">
                  <option value="1024x1024">1024 x 1024</option>
                  <option value="1536x1024">1536 x 1024</option>
                  <option value="1024x1536">1024 x 1536</option>
                </select>
              </label>

              <label v-if="activeTool === 'video'" class="field-block">
                <span>视频时长</span>
                <select v-model.number="videoDuration" class="field-control">
                  <option :value="5">5 秒</option>
                  <option :value="10">10 秒</option>
                  <option :value="15">15 秒</option>
                </select>
              </label>

              <label v-if="activeTool === 'speech'" class="field-block">
                <span>音色</span>
                <select v-model="speechVoice" class="field-control">
                  <option value="alloy">alloy</option>
                  <option value="verse">verse</option>
                  <option value="aria">aria</option>
                  <option value="sage">sage</option>
                </select>
              </label>

              <label v-if="activeTool === 'speech'" class="field-block">
                <span>风格</span>
                <select v-model="speechStyle" class="field-control">
                  <option value="自然清晰">自然清晰</option>
                  <option value="电商促销">电商促销</option>
                  <option value="温和讲解">温和讲解</option>
                  <option value="短视频口播">短视频口播</option>
                </select>
              </label>

              <label v-if="activeTool === 'product-copy'" class="field-block">
                <span>目标平台</span>
                <select v-model="productPlatform" class="field-control">
                  <option value="闲鱼">闲鱼</option>
                  <option value="淘宝">淘宝</option>
                  <option value="小红书">小红书</option>
                  <option value="抖音">抖音</option>
                </select>
              </label>

              <label v-if="activeTool === 'watermark'" class="field-block">
                <span>水印模式</span>
                <select v-model="watermarkMode" class="field-control">
                  <option value="remove">去除水印</option>
                  <option value="text">添加文字水印</option>
                  <option value="logo">添加 logo</option>
                </select>
              </label>
            </div>
          </div>

          <div v-if="activeTool === 'product-copy'" class="panel-block">
            <div class="form-grid">
              <label class="field-block">
                <span>商品名</span>
                <input v-model.trim="productName" class="field-control" placeholder="例如：主动降噪蓝牙耳机" />
              </label>
              <label class="field-block">
                <span>商品信息</span>
                <textarea v-model.trim="productInfo" class="field-control textarea-control" placeholder="成色、规格、卖点、价格、注意事项" />
              </label>
            </div>
          </div>

          <div v-if="needsSingleImageUpload" class="panel-block">
            <label class="upload-box" for="creator-image-file">
              <input id="creator-image-file" type="file" accept="image/*" @change="handleImageFile" />
              <span>{{ selectedImageFile ? selectedImageFile.name : imageUploadLabel }}</span>
            </label>
          </div>

          <div v-if="activeTool === 'transcription'" class="panel-block">
            <label class="upload-box" for="creator-audio-file">
              <input id="creator-audio-file" data-test="creator-audio-file" type="file" accept="audio/wav,audio/mpeg,.wav,.mp3" @change="handleAudioFile" />
              <span>{{ selectedAudioFile ? selectedAudioFile.name : '上传 WAV / MP3 音频' }}</span>
            </label>
          </div>

          <div v-if="activeTool === 'batch-main' || activeTool === 'batch-clone'" class="panel-block">
            <label v-if="activeTool === 'batch-clone'" class="upload-box" for="creator-reference-file">
              <input id="creator-reference-file" type="file" accept="image/*" @change="handleReferenceFile" />
              <span>{{ referenceImageFile ? referenceImageFile.name : '上传克隆参考图' }}</span>
            </label>
            <label class="upload-box" for="creator-batch-files">
              <input id="creator-batch-files" type="file" accept="image/*" multiple @change="handleBatchFiles" />
              <span>{{ batchProductFiles.length ? `已选择 ${batchProductFiles.length} 张商品图` : '上传最多 6 张商品图' }}</span>
            </label>
          </div>

          <div v-if="activeTool === 'watermark' && watermarkMode !== 'remove'" class="panel-block">
            <label v-if="watermarkMode === 'text'" class="field-block">
              <span>水印文字</span>
              <input v-model.trim="watermarkText" class="field-control" placeholder="输入要添加的水印文字" />
            </label>
            <label v-else class="upload-box" for="creator-logo-file">
              <input id="creator-logo-file" type="file" accept="image/*" @change="handleLogoFile" />
              <span>{{ logoFile ? logoFile.name : '上传 logo 图片' }}</span>
            </label>
          </div>

          <form class="prompt-card" data-test="creator-submit" @submit.prevent="handleSubmit">
            <label class="field-block">
              <span>{{ promptLabel }}</span>
              <textarea
                v-model.trim="prompt"
                data-test="creator-prompt"
                class="prompt-input"
                :placeholder="activeToolConfig.placeholder"
              />
            </label>
            <div class="prompt-actions">
              <button type="button" class="secondary-button" :disabled="submitting" @click="resetCurrentInput">
                清空
              </button>
              <button type="submit" data-test="creator-submit-button" class="primary-button" :disabled="!canSubmit || submitting">
                <Icon v-if="submitting" name="refresh" size="sm" class="animate-spin" />
                <span>{{ submitting ? '处理中' : activeToolConfig.action }}</span>
              </button>
            </div>
          </form>
        </section>
      </main>

      <CreatorResultPanel
        :output="output"
        :records="records"
        :record-error="recordLoadError"
        :loading="submitting"
        :error="errorMessage"
        :status="statusMessage"
        @restore="restoreRecord"
        @copy="copyText"
        @download-audio="downloadAudio"
        @download-batch="downloadBatch"
        @download-video="downloadVideo"
        @reload-records="loadRecords"
      />
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppLayout from '@/components/layout/AppLayout.vue'
import Icon from '@/components/icons/Icon.vue'
import CreatorHomePanel, { type CreatorRecentItem } from '@/components/user/creator/CreatorHomePanel.vue'
import CreatorHistoryPanel, { type CreatorLocalRecord } from '@/components/user/creator/CreatorHistoryPanel.vue'
import CreatorKeyPicker from '@/components/user/creator/CreatorKeyPicker.vue'
import CreatorResultPanel from '@/components/user/creator/CreatorResultPanel.vue'
import CreatorToolRail from '@/components/user/creator/CreatorToolRail.vue'
import { keysAPI } from '@/api'
import { generationRecordsAPI, type GenerationRecord } from '@/api/generationRecords'
import { imageGenerationAPI } from '@/api/imageGeneration'
import { AGNES_VIDEO_MODEL, videoGenerationAPI, type GatewayVideoProvider } from '@/api/videoGeneration'
import * as batchImageAPI from '@/api/batchImage'
import { isUsableCreatorKey, onlineCreatorAPI } from '@/api/onlineCreator'
import type { ApiKey } from '@/types'

type CreatorToolId =
  | 'home'
  | 'image'
  | 'edit'
  | 'assistant'
  | 'product-copy'
  | 'image-translate'
  | 'batch-main'
  | 'batch-clone'
  | 'watermark'
  | 'video'
  | 'transcription'
  | 'speech'
  | 'history'

const props = withDefaults(defineProps<{ initialTool?: string }>(), {
  initialTool: 'home',
})

interface CreatorToolConfig {
  id: CreatorToolId
  label: string
  badge: string
  icon: 'home' | 'chat' | 'edit' | 'globe' | 'sparkles' | 'grid' | 'copy' | 'upload' | 'play' | 'cloud' | 'clock'
  action: string
  placeholder: string
}

interface CreatorOutput {
  type: 'text' | 'image' | 'video' | 'audio' | 'batch'
  content: string
  url?: string
  batchId?: string
  batchReady?: boolean
  videoRequestId?: string
  items?: Array<{
    id: string
    label: string
    status: string
    url?: string
    filename?: string
    error?: string
  }>
}

interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

type CreatorModelCapability = 'text' | 'image' | 'video' | 'batch' | 'transcription' | 'speech'

const tools: CreatorToolConfig[] = [
  { id: 'home', label: '首页', badge: '总览', icon: 'home', action: '进入', placeholder: '' },
  { id: 'image', label: 'AI 生图', badge: '图片', icon: 'sparkles', action: '生成图片', placeholder: '描述画面、主体、背景、光影和风格' },
  { id: 'edit', label: '图片编辑', badge: '图片编辑', icon: 'edit', action: '编辑图片', placeholder: '说明需要修改的区域、风格和目标效果' },
  { id: 'assistant', label: 'AI 助手', badge: '对话', icon: 'chat', action: '发送', placeholder: '继续当前对话' },
  { id: 'product-copy', label: '商品文案', badge: '电商', icon: 'edit', action: '生成文案', placeholder: '补充目标人群、价格策略或发布要求' },
  { id: 'image-translate', label: '图片翻译', badge: '本地化', icon: 'globe', action: '翻译图片', placeholder: '保留构图/风格，仅将图中文字本地化为目标语言' },
  { id: 'batch-main', label: '批量主图', badge: '批量', icon: 'grid', action: '提交批量任务', placeholder: '统一要求，例如白底、商业摄影、突出商品质感' },
  { id: 'batch-clone', label: '批量克隆', badge: '批量', icon: 'copy', action: '提交克隆任务', placeholder: '统一克隆要求，例如保留参考图构图与光影' },
  { id: 'watermark', label: '水印处理', badge: '水印', icon: 'upload', action: '处理水印', placeholder: '去除时说明水印位置；添加时可补充透明度/位置' },
  { id: 'video', label: 'AI 视频', badge: '视频', icon: 'play', action: '生成视频', placeholder: '描述镜头、运动、主体和画面风格' },
  { id: 'transcription', label: '语音转写', badge: '音频', icon: 'cloud', action: '开始转写', placeholder: '可补充说话人、领域词或格式要求' },
  { id: 'speech', label: 'AI 配音', badge: '音频', icon: 'cloud', action: '生成配音', placeholder: '输入需要配音的文本' },
  { id: 'history', label: '历史记录', badge: '记录', icon: 'clock', action: '查看', placeholder: '' },
]

function normalizeCreatorToolId(toolId?: string): CreatorToolId {
  return tools.some((tool) => tool.id === toolId) ? toolId as CreatorToolId : 'home'
}

const activeTool = ref<CreatorToolId>(normalizeCreatorToolId(props.initialTool))
const apiKeys = ref<ApiKey[]>([])
const selectedKeyId = ref('')
const textModels = ref<string[]>([])
const imageModels = ref<string[]>([])
const videoModels = ref<string[]>([])
const batchModels = ref<string[]>([])
const transcriptionModels = ref<string[]>([])
const speechModels = ref<string[]>([])
const modelLoadErrors = ref<Partial<Record<CreatorModelCapability, string>>>({})
const selectedModel = ref('')
const targetLanguage = ref('中文')
const imageSize = ref('1024x1024')
const videoDuration = ref(5)
const prompt = ref('')
const productName = ref('')
const productInfo = ref('')
const productPlatform = ref('闲鱼')
const speechVoice = ref('alloy')
const speechStyle = ref('自然清晰')
const watermarkMode = ref<'remove' | 'text' | 'logo'>('remove')
const watermarkText = ref('')
const selectedImageFile = ref<File | null>(null)
const referenceImageFile = ref<File | null>(null)
const logoFile = ref<File | null>(null)
const batchProductFiles = ref<File[]>([])
const selectedAudioFile = ref<File | null>(null)
const output = ref<CreatorOutput | null>(null)
const records = ref<GenerationRecord[]>([])
const recordLoadError = ref('')
const localRecords = ref<CreatorLocalRecord[]>([])
const assistantMessages = ref<AssistantMessage[]>([])
const submitting = ref(false)
const statusMessage = ref('')
const errorMessage = ref('')
const audioOutputUrl = ref('')
let audioOutputBlob: Blob | null = null
let modelRequestVersion = 0
let operationVersion = 0
let videoPollTimer: number | null = null
let batchPollTimer: number | null = null
const objectUrls = new Set<string>()
const batchAPIKeys = new Map<string, string>()
const videoTasks = new Map<string, { apiKey: string; provider: GatewayVideoProvider; model: string }>()
const POLL_INTERVAL_MS = 5000
const MAX_POLL_RETRIES = 3
const MAX_POLL_ATTEMPTS = 60

const activeToolConfig = computed(() => tools.find((tool) => tool.id === activeTool.value) || tools[0])
const homeTools = computed(() => tools.filter((tool) => tool.id !== 'home' && tool.id !== 'history'))
const selectedApiKey = computed(() => usableKeys.value.find((key) => String(key.id) === selectedKeyId.value) || null)
const usableKeys = computed(() => apiKeys.value.filter((key) => isUsableCreatorKey(key)))
const isTextTool = computed(() => activeTool.value === 'assistant' || activeTool.value === 'product-copy')
const isImageTool = computed(() => ['image', 'edit', 'image-translate', 'watermark'].includes(activeTool.value))
const isAudioTool = computed(() => ['transcription', 'speech'].includes(activeTool.value))
const needsModel = computed(() => !['home', 'history'].includes(activeTool.value) && !(activeTool.value === 'watermark' && watermarkMode.value !== 'remove'))
const needsSingleImageUpload = computed(() => ['edit', 'image-translate', 'watermark'].includes(activeTool.value))
const imageUploadLabel = computed(() => {
  if (activeTool.value === 'image-translate') return '上传需要图片翻译的原图'
  if (activeTool.value === 'watermark') return '上传需要处理水印的图片'
  return '上传需要编辑的图片'
})
const modelOptions = computed(() => {
  if (isTextTool.value) return textModels.value
  if (isImageTool.value) return imageModels.value
  if (activeTool.value === 'video') return videoModels.value
  if (activeTool.value === 'batch-main' || activeTool.value === 'batch-clone') return batchModels.value
  if (activeTool.value === 'transcription') return transcriptionModels.value
  if (activeTool.value === 'speech') return speechModels.value
  return []
})
const promptLabel = computed(() => {
  if (activeTool.value === 'assistant') return '对话内容'
  if (activeTool.value === 'speech') return '配音文本'
  if (activeTool.value === 'batch-main' || activeTool.value === 'batch-clone') return '统一要求'
  return '创作提示词'
})
const activeModelLoadError = computed(() => {
  let capability: CreatorModelCapability | null = null
  if (isTextTool.value) capability = 'text'
  else if (isImageTool.value) capability = 'image'
  else if (activeTool.value === 'video') capability = 'video'
  else if (activeTool.value === 'batch-main' || activeTool.value === 'batch-clone') capability = 'batch'
  else if (activeTool.value === 'transcription') capability = 'transcription'
  else if (activeTool.value === 'speech') capability = 'speech'
  return capability ? modelLoadErrors.value[capability] || '' : ''
})
const modelWarning = computed(() => {
  if (!selectedApiKey.value) return '请先选择可用 API 密钥。'
  if (activeModelLoadError.value) return `模型加载失败：${activeModelLoadError.value}`
  if (activeTool.value === 'transcription' && transcriptionModels.value.length === 0) return '当前密钥暂无可用转写模型。'
  if (activeTool.value === 'speech' && speechModels.value.length === 0) return '当前密钥暂无可用配音模型。'
  if (needsModel.value && modelOptions.value.length === 0) return '当前密钥暂无该工具可用模型。'
  return ''
})
const canSubmit = computed(() => {
  if (!selectedApiKey.value?.key || submitting.value || activeTool.value === 'home' || activeTool.value === 'history') return false
  if (needsModel.value && !selectedModel.value && activeTool.value !== 'batch-main' && activeTool.value !== 'batch-clone') return false
  if (activeTool.value === 'assistant') return prompt.value.length > 0
  if (activeTool.value === 'product-copy') return Boolean(productName.value && productInfo.value)
  if (activeTool.value === 'image') return prompt.value.length > 0
  if (activeTool.value === 'edit' || activeTool.value === 'image-translate') return Boolean(selectedImageFile.value && prompt.value)
  if (activeTool.value === 'batch-main') return batchProductFiles.value.length > 0 && batchModels.value.length > 0
  if (activeTool.value === 'batch-clone') return Boolean(referenceImageFile.value && batchProductFiles.value.length > 0 && batchModels.value.length > 0)
  if (activeTool.value === 'watermark') {
    if (!selectedImageFile.value) return false
    if (watermarkMode.value === 'text') return Boolean(watermarkText.value)
    if (watermarkMode.value === 'logo') return Boolean(logoFile.value)
    return Boolean(prompt.value)
  }
  if (activeTool.value === 'video') return prompt.value.length > 0
  if (activeTool.value === 'transcription') return Boolean(selectedAudioFile.value)
  if (activeTool.value === 'speech') return prompt.value.length > 0
  return false
})
const recentItems = computed<CreatorRecentItem[]>(() => {
  const backend = records.value.slice(0, 4).map((record) => ({
    id: record.task_id,
    title: record.model || record.provider,
    kind: record.media_type,
    preview: record.prompt_preview || '后端生成记录',
  }))
  return [...localRecords.value.slice(0, 4), ...backend].slice(0, 6)
})

function selectTool(toolId: string) {
  if (submitting.value) return
  operationVersion += 1
  clearPollingTimers()
  releaseObjectUrls()
  activeTool.value = normalizeCreatorToolId(toolId)
  errorMessage.value = ''
  statusMessage.value = ''
  output.value = null
  syncSelectedModel()
}

function syncSelectedModel() {
  selectedModel.value = modelOptions.value[0] || ''
}

function resetCurrentInput() {
  prompt.value = ''
  productName.value = ''
  productInfo.value = ''
  watermarkText.value = ''
  selectedImageFile.value = null
  referenceImageFile.value = null
  logoFile.value = null
  batchProductFiles.value = []
  selectedAudioFile.value = null
  errorMessage.value = ''
  statusMessage.value = ''
}

function handleImageFile(event: Event) {
  selectedImageFile.value = fileFromEvent(event)
}

function handleReferenceFile(event: Event) {
  referenceImageFile.value = fileFromEvent(event)
}

function handleLogoFile(event: Event) {
  logoFile.value = fileFromEvent(event)
}

function handleAudioFile(event: Event) {
  selectedAudioFile.value = fileFromEvent(event)
}

function handleBatchFiles(event: Event) {
  const input = event.target as HTMLInputElement
  batchProductFiles.value = Array.from(input.files || []).slice(0, 6)
}

function fileFromEvent(event: Event): File | null {
  const input = event.target as HTMLInputElement
  return input.files?.[0] || null
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  const record = error && typeof error === 'object' ? error as { message?: unknown } : null
  return String(record?.message || fallback)
}

function imageOutputFromResponse(response: unknown): CreatorOutput {
  const payload = response && typeof response === 'object' ? response as {
    data?: Array<{ b64_json?: string; url?: string }>
    output?: Array<{ b64_json?: string; url?: string }>
  } : {}
  const item = [...(payload.data || []), ...(payload.output || [])][0]
  if (!item) throw new Error('图片接口已返回，但没有找到可展示结果')
  const url = item.b64_json ? `data:image/png;base64,${item.b64_json}` : item.url
  if (!url) throw new Error('图片结果缺少 URL 或 base64 内容')
  return { type: 'image', url, content: '图片生成完成' }
}

async function loadModelsForSelectedKey() {
  const apiKey = selectedApiKey.value?.key
  const requestVersion = ++modelRequestVersion
  textModels.value = []
  imageModels.value = []
  videoModels.value = []
  batchModels.value = []
  transcriptionModels.value = []
  speechModels.value = []
  modelLoadErrors.value = {}
  selectedModel.value = ''
  if (!apiKey) return

  const [texts, images, videos, batches, transcriptions, speeches] = await Promise.allSettled([
    onlineCreatorAPI.listTextModels(apiKey),
    imageGenerationAPI.listImageModels(apiKey),
    videoGenerationAPI.listVideoModels(apiKey),
    batchImageAPI.listBatchImageModels(apiKey),
    onlineCreatorAPI.listTranscriptionModels(apiKey),
    onlineCreatorAPI.listSpeechModels(apiKey),
  ])
  if (requestVersion !== modelRequestVersion || selectedApiKey.value?.key !== apiKey) return
  textModels.value = texts.status === 'fulfilled' ? texts.value : []
  imageModels.value = images.status === 'fulfilled' ? images.value : []
  videoModels.value = videos.status === 'fulfilled' ? videos.value : []
  batchModels.value = batches.status === 'fulfilled' ? batches.value.data.map((item) => item.id) : []
  transcriptionModels.value = transcriptions.status === 'fulfilled' ? transcriptions.value : []
  speechModels.value = speeches.status === 'fulfilled' ? speeches.value : []
  const errors: Partial<Record<CreatorModelCapability, string>> = {}
  if (texts.status === 'rejected') errors.text = extractErrorMessage(texts.reason, '文本模型加载失败')
  if (images.status === 'rejected') errors.image = extractErrorMessage(images.reason, '图片模型加载失败')
  if (videos.status === 'rejected') errors.video = extractErrorMessage(videos.reason, '视频模型加载失败')
  if (batches.status === 'rejected') errors.batch = extractErrorMessage(batches.reason, '批量模型加载失败')
  if (transcriptions.status === 'rejected') errors.transcription = extractErrorMessage(transcriptions.reason, '转写模型加载失败')
  if (speeches.status === 'rejected') errors.speech = extractErrorMessage(speeches.reason, '配音模型加载失败')
  modelLoadErrors.value = errors
  syncSelectedModel()
}

async function loadApiKeys() {
  const response = await keysAPI.list(1, 100, { status: 'active' })
  apiKeys.value = response.items.filter((key) => isUsableCreatorKey(key))
  if (!apiKeys.value.some((key) => String(key.id) === selectedKeyId.value)) {
    selectedKeyId.value = apiKeys.value[0] ? String(apiKeys.value[0].id) : ''
  }
}

async function loadRecords() {
  try {
    records.value = await generationRecordsAPI.list(8)
    recordLoadError.value = ''
  } catch (error) {
    recordLoadError.value = extractErrorMessage(error, '创作记录加载失败')
  }
}

function addLocalRecord(record: Omit<CreatorLocalRecord, 'id'>) {
  localRecords.value = [{ ...record, id: `local-${Date.now()}` }, ...localRecords.value].slice(0, 20)
}

async function submitAssistant(apiKey: string) {
  const userMessage: AssistantMessage = { id: `user-${Date.now()}`, role: 'user', content: prompt.value }
  assistantMessages.value.push(userMessage)
  try {
    const result = await onlineCreatorAPI.createTextCompletion({
      apiKey,
      model: selectedModel.value,
      mode: 'chat',
      prompt: assistantMessages.value.map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.content}`).join('\n'),
      targetLanguage: targetLanguage.value,
    })
    assistantMessages.value.push({ id: `assistant-${Date.now()}`, role: 'assistant', content: result.content })
    output.value = { type: 'text', content: result.content }
    addLocalRecord({ title: 'AI 助手', kind: '文本', preview: prompt.value, content: result.content, outputType: 'text' })
    prompt.value = ''
    statusMessage.value = '回复已生成'
  } catch (error) {
    assistantMessages.value = assistantMessages.value.filter((message) => message.id !== userMessage.id)
    throw error
  }
}

async function submitProductCopy(apiKey: string) {
  const content = `商品名：${productName.value}\n商品信息：${productInfo.value}\n目标平台：${productPlatform.value}\n补充要求：${prompt.value || '无'}`
  const result = await onlineCreatorAPI.createTextCompletion({
    apiKey,
    model: selectedModel.value,
    mode: 'product-copy',
    prompt: content,
    targetLanguage: targetLanguage.value,
  })
  output.value = { type: 'text', content: result.content }
  addLocalRecord({ title: productName.value, kind: '商品文案', preview: productInfo.value, content: result.content, outputType: 'text' })
  statusMessage.value = '商品文案已生成'
}

async function submitImage(apiKey: string) {
  output.value = imageOutputFromResponse(await imageGenerationAPI.generateImage({
    apiKey,
    model: selectedModel.value,
    prompt: prompt.value,
    size: imageSize.value,
    quality: 'high',
    count: 1,
    outputFormat: 'png',
  }))
  statusMessage.value = '图片已生成'
}

async function submitEdit(apiKey: string) {
  if (!selectedImageFile.value) throw new Error('请先上传图片')
  const editPrompt = activeTool.value === 'image-translate'
    ? `保留原图构图、风格、主体、色彩和材质，仅将图中文字本地化为${targetLanguage.value}。补充要求：${prompt.value}`
    : prompt.value
  output.value = imageOutputFromResponse(await imageGenerationAPI.editImage({
    apiKey,
    model: selectedModel.value,
    prompt: editPrompt,
    size: imageSize.value,
    quality: 'high',
    count: 1,
    outputFormat: 'png',
    image: selectedImageFile.value,
  }))
  statusMessage.value = activeTool.value === 'image-translate' ? '图片文字已本地化' : '图片编辑完成'
}

async function submitBatch(apiKey: string, toolId: 'batch-main' | 'batch-clone', version: number) {
  const referenceFile = referenceImageFile.value
  const productFiles = [...batchProductFiles.value]
  const taskPrompt = prompt.value
  const taskImageSize = imageSize.value
  const taskModel = selectedModel.value || batchModels.value[0]
  const referenceImages = referenceFile
    ? [await fileToBatchReference(referenceFile)]
    : []
  const items = await Promise.all(productFiles.map(async (file, index) => ({
    custom_id: `creator-${Date.now()}-${index + 1}`,
    prompt: `${taskPrompt || '生成电商商品主图'}\n商品图：${file.name}`,
    output_count: 1,
    reference_images: [
      ...(referenceImages.length ? referenceImages : []),
      await fileToBatchReference(file),
    ],
  })))
  if (version !== operationVersion) return
  const idempotencyKey = `${toolId}-${Date.now()}`
  try {
    const job = await batchImageAPI.submitBatchImageJob(apiKey, {
      model: taskModel,
      task_name: idempotencyKey,
      image_size: taskImageSize === '1024x1024' ? '1K' : '2K',
      aspect_ratio: '1:1',
      items,
      metadata: { source: 'online-creator', tool: toolId },
    }, idempotencyKey)
    batchAPIKeys.set(job.id, apiKey)
    output.value = {
      type: 'batch',
      content: `批量任务已提交：${job.id}\n状态：${job.status}\n数量：${job.item_count}`,
      batchId: job.id,
      batchReady: false,
    }
    statusMessage.value = '批量任务已提交'
    scheduleBatchPoll(apiKey, job.id, version)
  } catch (error) {
    if (version !== operationVersion) return
    if (toolId !== 'batch-clone' || !referenceFile || !isExplicitBatchUnsupported(error)) throw error
    await fallbackBatchCloneWithImageEdits(apiKey, error, referenceFile, productFiles, taskPrompt, taskImageSize, version)
  }
}

function isExplicitBatchUnsupported(error: unknown): boolean {
  const record = error && typeof error === 'object' ? error as { status?: unknown; message?: unknown } : null
  const status = Number(record?.status || 0)
  if ([404, 405, 501].includes(status)) return true
  if (![400, 422].includes(status)) return false
  return /(reference|参考图|not supported|unsupported|不支持)/i.test(String(record?.message || ''))
}

async function fallbackBatchCloneWithImageEdits(
  apiKey: string,
  cause: unknown,
  referenceFile: File,
  productFiles: File[],
  taskPrompt: string,
  taskImageSize: string,
  version: number,
) {
  const lines: string[] = [`批量接口不可用，已改用逐张图片编辑。原因：${extractErrorMessage(cause, '批量接口提交失败')}`]
  const outputItems: NonNullable<CreatorOutput['items']> = []
  for (const [index, file] of productFiles.entries()) {
    if (version !== operationVersion) return
    try {
      const composite = await createCloneComposite(referenceFile, file, index)
      if (version !== operationVersion) return
      const response = await imageGenerationAPI.editImage({
        apiKey,
        model: imageModels.value[0] || selectedModel.value,
        prompt: `合成图左侧是参考图、右侧是商品图。请按左侧构图与风格克隆右侧商品主图，只输出右侧商品。统一要求：${taskPrompt || '保持电商主图质感'}`,
        size: taskImageSize,
        quality: 'high',
        count: 1,
        outputFormat: 'png',
        image: composite,
      })
      if (version !== operationVersion) return
      const result = imageOutputFromResponse(response)
      lines.push(`第 ${index + 1} 张：成功`)
      outputItems.push({ id: `fallback-${index + 1}`, label: file.name, status: 'completed', url: result.url, filename: `clone-${index + 1}.png` })
    } catch (itemError) {
      if (version !== operationVersion) return
      const message = extractErrorMessage(itemError, '图片编辑失败')
      lines.push(`第 ${index + 1} 张：失败，${message}`)
      outputItems.push({ id: `fallback-${index + 1}`, label: file.name, status: 'failed', error: message })
    }
  }
  if (version !== operationVersion) return
  output.value = { type: 'batch', content: lines.join('\n'), items: outputItems }
  statusMessage.value = '已完成逐张兜底处理'
}

function scheduleBatchPoll(apiKey: string, batchId: string, version: number, attempt = 0, retryCount = 0) {
  if (batchPollTimer !== null) window.clearTimeout(batchPollTimer)
  batchPollTimer = window.setTimeout(() => {
    batchPollTimer = null
    void pollBatchStatus(apiKey, batchId, version, attempt, retryCount)
  }, POLL_INTERVAL_MS)
}

async function pollBatchStatus(apiKey: string, batchId: string, version: number, attempt: number, retryCount: number) {
  if (version !== operationVersion) return
  if (attempt >= MAX_POLL_ATTEMPTS) {
    errorMessage.value = '批量任务查询超时，请稍后从创作记录恢复'
    statusMessage.value = ''
    return
  }
  try {
    const job = await batchImageAPI.getBatchImageJob(apiKey, batchId)
    if (version !== operationVersion) return
    output.value = {
      type: 'batch',
      batchId,
      batchReady: false,
      content: `批量任务：${batchId}\n状态：${job.status}\n成功：${job.success_count || 0}，失败：${job.fail_count || 0}`,
      items: output.value?.type === 'batch' ? output.value.items : undefined,
    }
    if (['completed', 'failed', 'cancelled', 'output_deleted'].includes(job.status)) {
      statusMessage.value = job.status === 'completed' ? '批量任务已完成' : `批量任务已结束：${job.status}`
      if (job.status === 'completed') await loadBatchItems(apiKey, batchId, version)
      return
    }
    statusMessage.value = `批量任务处理中：${job.status}`
    if (attempt + 1 >= MAX_POLL_ATTEMPTS) {
      errorMessage.value = '批量任务查询超时，请稍后从创作记录恢复'
      statusMessage.value = ''
      return
    }
    scheduleBatchPoll(apiKey, batchId, version, attempt + 1)
  } catch (error) {
    if (version !== operationVersion) return
    if (retryCount < MAX_POLL_RETRIES && attempt + 1 < MAX_POLL_ATTEMPTS) {
      statusMessage.value = `批量任务状态查询重试中（${retryCount + 1}/${MAX_POLL_RETRIES}）`
      scheduleBatchPoll(apiKey, batchId, version, attempt + 1, retryCount + 1)
      return
    }
    errorMessage.value = extractErrorMessage(error, '批量任务状态查询失败')
    statusMessage.value = ''
  }
}

async function loadBatchItems(apiKey: string, batchId: string, version: number) {
  const response = await batchImageAPI.listBatchImageItems(apiKey, batchId)
  const items = await Promise.all(response.data.map(async (item, index) => {
    const result: NonNullable<CreatorOutput['items']>[number] = {
      id: item.custom_id,
      label: item.custom_id || `第 ${index + 1} 项`,
      status: item.status,
    }
    if (item.error?.message) result.error = item.error.message
    if (item.status === 'completed' && item.image_count > 0) {
      const blob = await batchImageAPI.getBatchImageItemContent(apiKey, batchId, item.custom_id, 0)
      if (version !== operationVersion) return result
      result.url = createTrackedObjectURL(blob)
      result.filename = `${item.custom_id}.${item.file_extension || 'png'}`
    }
    return result
  }))
  if (version !== operationVersion) return
  output.value = { type: 'batch', batchId, batchReady: true, content: `批量任务 ${batchId} 已完成`, items }
}

async function submitWatermark(apiKey: string, version: number) {
  if (!selectedImageFile.value) throw new Error('请先上传图片')
  if (watermarkMode.value === 'remove') {
    output.value = imageOutputFromResponse(await imageGenerationAPI.editImage({
      apiKey,
      model: selectedModel.value,
      prompt: `去除图片中的水印、遮挡或不需要文字，尽量自然补全背景。位置说明：${prompt.value}`,
      size: imageSize.value,
      quality: 'high',
      count: 1,
      outputFormat: 'png',
      image: selectedImageFile.value,
    }))
    statusMessage.value = '水印去除完成'
    return
  }
  const blob = watermarkMode.value === 'text'
    ? await renderTextWatermark(selectedImageFile.value, watermarkText.value)
    : await renderLogoWatermark(selectedImageFile.value, logoFile.value)
  if (version !== operationVersion) return
  const url = createTrackedObjectURL(blob)
  output.value = { type: 'image', url, content: '水印图片已生成' }
  statusMessage.value = '水印已添加，可直接下载'
}

async function submitVideo(apiKey: string, version: number) {
  const model = selectedModel.value
  const provider: GatewayVideoProvider = model === AGNES_VIDEO_MODEL || model.toLowerCase().includes('agnes') ? 'agnes' : 'grok'
  const data = await videoGenerationAPI.generateVideo({
    apiKey,
    provider,
    prompt: prompt.value,
    model,
    duration: videoDuration.value,
    aspectRatio: '16:9',
    size: '1280x720',
    width: 1280,
    height: 720,
  })
  if (version !== operationVersion) return
  const videoUrl = data.video?.url || data.url
  const requestId = data.request_id || data.id
  if (requestId) videoTasks.set(requestId, { apiKey, provider, model })
  output.value = { type: 'video', url: videoUrl, videoRequestId: requestId, content: `视频任务已提交：${requestId || '未返回任务 ID'}` }
  if (videoUrl || ['completed', 'succeeded', 'success', 'done'].includes(String(data.status || '').toLowerCase())) {
    statusMessage.value = '视频已生成'
    return
  }
  if (!requestId) throw new Error('视频接口未返回任务 ID')
  statusMessage.value = '视频任务处理中'
  scheduleVideoPoll(apiKey, requestId, provider, model, version)
}

function scheduleVideoPoll(apiKey: string, requestId: string, provider: GatewayVideoProvider, model: string, version: number, attempt = 0, retryCount = 0) {
  if (videoPollTimer !== null) window.clearTimeout(videoPollTimer)
  videoPollTimer = window.setTimeout(() => {
    videoPollTimer = null
    void pollVideoStatus(apiKey, requestId, provider, model, version, attempt, retryCount)
  }, POLL_INTERVAL_MS)
}

async function pollVideoStatus(apiKey: string, requestId: string, provider: GatewayVideoProvider, model: string, version: number, attempt: number, retryCount: number) {
  if (version !== operationVersion) return
  if (attempt >= MAX_POLL_ATTEMPTS) {
    errorMessage.value = '视频任务查询超时，请稍后从创作记录恢复'
    statusMessage.value = ''
    return
  }
  try {
    const data = await videoGenerationAPI.getVideoStatus(apiKey, requestId, provider, model)
    if (version !== operationVersion) return
    const status = String(data.status || 'processing').toLowerCase()
    const videoUrl = data.video?.url || data.url
    output.value = { type: 'video', url: videoUrl, videoRequestId: requestId, content: `视频任务 ${requestId}：${status}` }
    if (['completed', 'succeeded', 'success', 'done'].includes(status)) {
      statusMessage.value = '视频已生成'
      return
    }
    if (['failed', 'cancelled', 'canceled', 'error', 'expired'].includes(status)) {
      errorMessage.value = extractErrorMessage(data.error, '视频生成失败')
      statusMessage.value = ''
      return
    }
    statusMessage.value = `视频生成中：${status}`
    if (attempt + 1 >= MAX_POLL_ATTEMPTS) {
      errorMessage.value = '视频任务查询超时，请稍后从创作记录恢复'
      statusMessage.value = ''
      return
    }
    scheduleVideoPoll(apiKey, requestId, provider, model, version, attempt + 1)
  } catch (error) {
    if (version !== operationVersion) return
    if (retryCount < MAX_POLL_RETRIES && attempt + 1 < MAX_POLL_ATTEMPTS) {
      statusMessage.value = `视频状态查询重试中（${retryCount + 1}/${MAX_POLL_RETRIES}）`
      scheduleVideoPoll(apiKey, requestId, provider, model, version, attempt + 1, retryCount + 1)
      return
    }
    errorMessage.value = extractErrorMessage(error, '视频状态查询失败')
    statusMessage.value = ''
  }
}

async function submitTranscription(apiKey: string) {
  if (!selectedAudioFile.value) throw new Error('请先上传 WAV 或 MP3 音频')
  const result = await onlineCreatorAPI.transcribeCreatorAudio({
    apiKey,
    model: selectedModel.value,
    file: selectedAudioFile.value,
    language: targetLanguage.value,
  })
  output.value = { type: 'text', content: result.content }
  addLocalRecord({ title: selectedAudioFile.value.name, kind: '语音转写', preview: result.content.slice(0, 60), content: result.content, outputType: 'text' })
  statusMessage.value = '转写完成'
}

async function submitSpeech(apiKey: string, version: number) {
  const result = await onlineCreatorAPI.synthesizeCreatorSpeech({
    apiKey,
    model: selectedModel.value,
    text: prompt.value,
    language: targetLanguage.value,
    style: speechStyle.value,
    voice: speechVoice.value,
    format: 'mp3',
  })
  if (version !== operationVersion) return
  audioOutputBlob = result.blob
  audioOutputUrl.value = createTrackedObjectURL(result.blob)
  output.value = { type: 'audio', url: audioOutputUrl.value, content: result.transcript || prompt.value }
  addLocalRecord({ title: 'AI 配音', kind: '音频', preview: prompt.value.slice(0, 60), content: result.transcript || prompt.value, outputType: 'audio', blob: result.blob })
  statusMessage.value = '配音已生成'
}

async function handleSubmit() {
  if (!canSubmit.value || !selectedApiKey.value) return
  clearPollingTimers()
  releaseObjectUrls()
  const version = ++operationVersion
  const toolId = activeTool.value
  const apiKey = selectedApiKey.value.key
  submitting.value = true
  errorMessage.value = ''
  statusMessage.value = '正在请求网关'
  output.value = null
  try {
    if (toolId === 'assistant') await submitAssistant(apiKey)
    else if (toolId === 'product-copy') await submitProductCopy(apiKey)
    else if (toolId === 'image') await submitImage(apiKey)
    else if (toolId === 'edit' || toolId === 'image-translate') await submitEdit(apiKey)
    else if (toolId === 'batch-main' || toolId === 'batch-clone') await submitBatch(apiKey, toolId, version)
    else if (toolId === 'watermark') await submitWatermark(apiKey, version)
    else if (toolId === 'video') await submitVideo(apiKey, version)
    else if (toolId === 'transcription') await submitTranscription(apiKey)
    else if (toolId === 'speech') await submitSpeech(apiKey, version)
    await loadRecords()
  } catch (error) {
    errorMessage.value = extractErrorMessage(error, '创作失败，请检查密钥、模型或参数')
    statusMessage.value = ''
  } finally {
    submitting.value = false
  }
}

async function restoreRecord(record: GenerationRecord) {
  clearPollingTimers()
  releaseObjectUrls()
  const version = ++operationVersion
  try {
    let url = record.result?.urls?.[0]
    if (!url && record.result?.files?.length) {
      const blob = await generationRecordsAPI.content(record.task_id, 0)
      if (version !== operationVersion) return
      url = createTrackedObjectURL(blob)
    }
    if (version !== operationVersion) return
    if (url && record.media_type === 'image') output.value = { type: 'image', url, content: record.prompt_preview || '已从创作记录恢复图片' }
    else if (url && record.media_type === 'video') output.value = { type: 'video', url, content: record.prompt_preview || '已从创作记录恢复视频' }
    else output.value = { type: 'text', content: record.prompt_preview || '该记录没有可直接展示的结果' }
    statusMessage.value = '已从创作记录恢复'
    errorMessage.value = ''
  } catch (error) {
    if (version !== operationVersion) return
    errorMessage.value = extractErrorMessage(error, '创作记录内容读取失败')
  }
}

function restoreLocalRecord(record: CreatorLocalRecord) {
  releaseObjectUrls()
  if (record.outputType === 'audio' && record.blob) {
    audioOutputBlob = record.blob
    audioOutputUrl.value = createTrackedObjectURL(record.blob)
    output.value = { type: 'audio', url: audioOutputUrl.value, content: record.content }
  } else {
    output.value = { type: 'text', content: record.content }
  }
  statusMessage.value = '已从本地记录恢复'
  errorMessage.value = ''
}

async function copyText(content: string) {
  await navigator.clipboard?.writeText(content)
  statusMessage.value = '已复制'
}

function downloadAudio() {
  if (!audioOutputBlob || !audioOutputUrl.value) return
  const link = document.createElement('a')
  link.href = audioOutputUrl.value
  link.download = `creator-speech-${Date.now()}.mp3`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

async function downloadBatch(batchId: string) {
  const apiKey = batchAPIKeys.get(batchId) || selectedApiKey.value?.key
  if (!apiKey) return
  try {
    const blob = await batchImageAPI.downloadBatchImageZip(apiKey, batchId)
    batchImageAPI.saveBlob(blob, `${batchId}.zip`)
  } catch (error) {
    errorMessage.value = extractErrorMessage(error, '批量图片下载失败')
  }
}

async function downloadVideo(requestId: string) {
  const task = videoTasks.get(requestId)
  if (!task) {
    errorMessage.value = '缺少视频任务上下文，请重新查询或生成视频后再下载'
    return
  }
  try {
    const blob = await videoGenerationAPI.downloadVideoContent(task.apiKey, requestId, task.provider, task.model)
    batchImageAPI.saveBlob(blob, `${requestId}.mp4`)
  } catch (error) {
    errorMessage.value = extractErrorMessage(error, '视频下载失败')
  }
}

function createTrackedObjectURL(blob: Blob): string {
  const url = URL.createObjectURL(blob)
  objectUrls.add(url)
  return url
}

function releaseObjectUrls() {
  for (const url of objectUrls) URL.revokeObjectURL(url)
  objectUrls.clear()
  audioOutputUrl.value = ''
  audioOutputBlob = null
}

function clearPollingTimers() {
  if (videoPollTimer !== null) window.clearTimeout(videoPollTimer)
  if (batchPollTimer !== null) window.clearTimeout(batchPollTimer)
  videoPollTimer = null
  batchPollTimer = null
}

async function createCloneComposite(referenceFile: File, productFile: File, index: number): Promise<File> {
  const [referenceImage, productImage] = await Promise.all([
    loadImageElement(referenceFile),
    loadImageElement(productFile),
  ])
  const referenceWidth = referenceImage.naturalWidth || referenceImage.width
  const referenceHeight = referenceImage.naturalHeight || referenceImage.height
  const productWidth = productImage.naturalWidth || productImage.width
  const productHeight = productImage.naturalHeight || productImage.height
  const panelHeight = Math.max(referenceHeight, productHeight)
  const referencePanelWidth = Math.max(1, Math.round(referenceWidth * (panelHeight / referenceHeight)))
  const productPanelWidth = Math.max(1, Math.round(productWidth * (panelHeight / productHeight)))
  const canvas = document.createElement('canvas')
  canvas.width = referencePanelWidth + productPanelWidth
  canvas.height = panelHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持参考图合成')
  ctx.drawImage(referenceImage, 0, 0, referencePanelWidth, panelHeight)
  ctx.drawImage(productImage, referencePanelWidth, 0, productPanelWidth, panelHeight)
  const blob = await canvasToBlob(canvas)
  return new File([blob], `clone-composite-${index + 1}.png`, { type: 'image/png' })
}

async function fileToBatchReference(file: File): Promise<batchImageAPI.BatchImageReferenceImage> {
  return {
    mime_type: file.type || 'image/png',
    data: await fileToBase64(file),
  }
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = typeof file.arrayBuffer === 'function'
    ? await file.arrayBuffer()
    : await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.onerror = () => reject(new Error('图片文件读取失败'))
        reader.readAsArrayBuffer(file)
      })
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index])
  return btoa(binary)
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片读取失败'))
    }
    image.src = url
  })
}

async function renderTextWatermark(file: File, text: string): Promise<Blob> {
  const image = await loadImageElement(file)
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth || image.width
  canvas.height = image.naturalHeight || image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas 水印处理')
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  ctx.font = `${Math.max(24, Math.round(canvas.width * 0.04))}px sans-serif`
  ctx.fillStyle = 'rgba(255,255,255,0.72)'
  ctx.strokeStyle = 'rgba(15,23,42,0.28)'
  ctx.lineWidth = 3
  const x = Math.round(canvas.width * 0.06)
  const y = Math.round(canvas.height * 0.9)
  ctx.strokeText(text, x, y)
  ctx.fillText(text, x, y)
  return canvasToBlob(canvas)
}

async function renderLogoWatermark(file: File, logo: File | null): Promise<Blob> {
  if (!logo) throw new Error('请先上传 logo 图片')
  const [image, logoImage] = await Promise.all([loadImageElement(file), loadImageElement(logo)])
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth || image.width
  canvas.height = image.naturalHeight || image.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas 水印处理')
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
  const width = Math.round(canvas.width * 0.18)
  const height = Math.round(width * ((logoImage.naturalHeight || logoImage.height) / (logoImage.naturalWidth || logoImage.width)))
  ctx.globalAlpha = 0.72
  ctx.drawImage(logoImage, canvas.width - width - 32, canvas.height - height - 32, width, height)
  ctx.globalAlpha = 1
  return canvasToBlob(canvas)
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Canvas 导出失败'))
    }, 'image/png')
  })
}

watch(selectedKeyId, () => {
  void loadModelsForSelectedKey()
})
watch(() => props.initialTool, (toolId) => selectTool(normalizeCreatorToolId(toolId)))
watch(activeTool, syncSelectedModel)
watch(watermarkMode, syncSelectedModel)

onMounted(async () => {
  await loadApiKeys()
  await loadRecords()
})

onBeforeUnmount(() => {
  operationVersion += 1
  modelRequestVersion += 1
  clearPollingTimers()
  releaseObjectUrls()
})
</script>

<style scoped>
.online-creator-page {
  width: 100%;
  max-width: 1760px;
  height: calc(100dvh - 64px - 4rem);
  min-height: 620px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 160px minmax(340px, 420px) minmax(360px, 1fr);
  align-items: stretch;
  gap: 12px;
  overflow: hidden;
}

.creator-workspace,
.creator-form-card {
  min-width: 0;
}

.creator-workspace,
.online-creator-page > :deep(.creator-result-panel) {
  min-height: 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

.online-creator-page.overview-mode .creator-workspace {
  grid-column: 2 / -1;
}

.online-creator-page.overview-mode > :deep(.creator-result-panel) {
  display: none;
}

.creator-form-card {
  display: grid;
  min-height: 100%;
  align-content: start;
  gap: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.94);
  padding: 14px;
}

.tool-title {
  display: flex;
  min-height: 42px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.tool-title h1 {
  margin: 0;
  color: #0f172a;
  font-size: 19px;
  font-weight: 820;
}

.tool-title span {
  border-radius: 999px;
  background: #ccfbf1;
  color: #0f766e;
  font-size: 12px;
  font-weight: 780;
  padding: 5px 9px;
}

.panel-block {
  border-top: 1px solid #edf1f5;
  padding-top: 12px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.field-block {
  display: grid;
  gap: 6px;
}

.field-block > span {
  color: #475569;
  font-size: 13px;
  font-weight: 720;
}

.field-control,
.prompt-input {
  width: 100%;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
  color: #0f172a;
  font-size: 14px;
  outline: none;
  padding: 9px 10px;
}

.field-control:focus,
.prompt-input:focus {
  border-color: #67e8f9;
  box-shadow: 0 0 0 3px rgba(103, 232, 249, 0.18);
}

.textarea-control,
.prompt-input {
  min-height: 104px;
  resize: vertical;
  line-height: 1.65;
}

.upload-box {
  display: grid;
  min-height: 78px;
  place-items: center;
  border: 1px dashed #cbd5e1;
  border-radius: 6px;
  background: #f8fafc;
  color: #64748b;
  cursor: pointer;
  font-size: 13px;
  font-weight: 720;
  padding: 12px;
  text-align: center;
}

.upload-box + .upload-box {
  margin-top: 10px;
}

.upload-box input {
  display: none;
}

.unsupported-note {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid #fed7aa;
  border-radius: 6px;
  background: #fff7ed;
  color: #c2410c;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.6;
  padding: 10px 12px;
}

.unsupported-note button {
  flex: 0 0 auto;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font-weight: 760;
}

.assistant-log {
  display: grid;
  max-height: 260px;
  overflow: auto;
  gap: 8px;
  border: 1px solid #edf1f5;
  border-radius: 6px;
  background: #f8fafc;
  padding: 12px;
}

.message-row {
  width: fit-content;
  max-width: min(680px, 92%);
  border-radius: 6px;
  padding: 10px 12px;
  color: #1e293b;
  font-size: 13px;
  line-height: 1.6;
}

.message-row.user {
  justify-self: end;
  background: #ccfbf1;
}

.message-row.assistant {
  justify-self: start;
  background: #fff;
}

.prompt-card {
  display: grid;
  gap: 12px;
}

.prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.primary-button,
.secondary-button {
  display: inline-flex;
  min-height: 38px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 760;
  padding: 0 18px;
}

.primary-button {
  border: 0;
  background: #14b8a6;
  color: #fff;
  box-shadow: none;
}

.secondary-button {
  border: 1px solid #e2e8f0;
  background: #fff;
  color: #475569;
}

.primary-button:disabled,
.secondary-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

@media (max-width: 1180px) {
  .online-creator-page {
    height: auto;
    min-height: calc(100dvh - 64px - 3rem);
    grid-template-columns: minmax(150px, 190px) minmax(0, 1fr);
    overflow: visible;
  }

  .online-creator-page > :deep(.creator-result-panel) {
    grid-column: 1 / -1;
  }

  .creator-workspace,
  .online-creator-page > :deep(.creator-result-panel) {
    overflow: visible;
  }
}

@media (max-width: 760px) {
  .online-creator-page {
    grid-template-columns: 1fr;
    min-height: auto;
  }

  .online-creator-page.overview-mode .creator-workspace,
  .online-creator-page > :deep(.creator-result-panel) {
    grid-column: 1;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }

  .prompt-actions {
    flex-direction: column;
  }
}
</style>
