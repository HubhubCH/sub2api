<template>
  <AppLayout>
    <div class="online-creator-page" :class="{ 'wide-mode': activeTool === 'home' || activeTool === 'history' }">
      <CreatorToolRail :tools="tools" :active-tool="activeTool" @select="selectTool" />

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
          @delete-backend="deleteBackendRecord"
          @delete-local="deleteLocalRecord"
        />

        <section v-else class="creator-form-card">
          <div class="tool-title">
            <h1>{{ activeToolConfig.label }}</h1>
            <span>{{ activeToolConfig.badge }}</span>
          </div>

          <CreatorKeyPicker v-model="selectedKeyId" :keys="usableKeys" :disabled="submitting" />
          <p v-if="selectedApiKey" class="key-context">
            当前分组：{{ selectedApiKey.group?.name || '默认分组' }}
            <span>平台：{{ selectedApiKey.group?.platform || '自动路由' }}</span>
          </p>
          <CreatorKeyPicker
            v-model="backupKeyId"
            :keys="backupKeys"
            :disabled="submitting"
            label="备用文本密钥"
            empty-label="不使用备用文本密钥"
            test-id="creator-backup-key"
          />
          <p v-if="backupApiKey" class="key-context">
            文本模型：{{ backupTextModels.length ? `${backupTextModels.length} 个可用` : backupTextModelError || '正在检测' }}
          </p>

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

              <label v-if="isTextTool" class="field-block">
                <span>语言</span>
                <select v-model="targetLanguage" class="field-control">
                  <option value="中文">中文</option>
                  <option value="英文">英文</option>
                  <option value="日文">日文</option>
                  <option value="韩文">韩文</option>
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

              <label v-if="activeTool === 'video'" class="field-block">
                <span>视频尺寸</span>
                <select v-model="videoSize" class="field-control" data-test="creator-video-size">
                  <option value="1280x720">1280 x 720（16:9）</option>
                  <option value="720x1280">720 x 1280（9:16）</option>
                  <option value="1024x1024">1024 x 1024（1:1）</option>
                </select>
              </label>

              <label v-if="activeTool === 'video'" class="field-block">
                <span>画质</span>
                <select v-model="videoQuality" class="field-control" data-test="creator-video-quality">
                  <option value="720p">标准（720p）</option>
                  <option value="1080p">高清（1080p）</option>
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

          <CreatorCanvasSizeControl
            v-if="isImageTool || activeTool === 'batch-main' || activeTool === 'batch-clone'"
            v-model="imageSize"
            :disabled="submitting"
          />

          <div v-if="activeTool === 'image'" class="panel-block image-settings">
            <div class="field-block">
              <span>场景模板</span>
              <div class="scene-options" role="group" aria-label="场景模板">
                <button
                  v-for="scene in imageSceneOptions"
                  :key="scene.id"
                  type="button"
                  :class="{ active: imageScene === scene.id }"
                  :data-test="`creator-image-scene-${scene.id}`"
                  @click="imageScene = scene.id"
                >
                  {{ scene.label }}
                </button>
              </div>
            </div>
            <div class="image-parameter-grid">
              <label class="field-block">
                <span>画质</span>
                <select v-model="imageQuality" class="field-control" data-test="creator-image-quality" :disabled="usesGrokImageModel">
                  <option value="high">高</option>
                  <option value="medium">标准</option>
                  <option value="low">快速</option>
                </select>
              </label>
              <label class="field-block">
                <span>风格</span>
                <select v-model="imageStyle" class="field-control" data-test="creator-image-style">
                  <option value="auto">自动</option>
                  <option value="natural">自然</option>
                  <option value="vivid">鲜明</option>
                </select>
              </label>
              <label class="field-block">
                <span>背景</span>
                <select v-model="imageBackground" class="field-control" data-test="creator-image-background" :disabled="usesGrokImageModel">
                  <option value="auto">自动</option>
                  <option value="opaque">不透明</option>
                  <option value="transparent">透明</option>
                </select>
              </label>
            </div>
            <div class="cost-estimate" data-test="creator-image-cost">
              <div><span>预计费用</span><strong>{{ estimatedImageCostLabel }}</strong></div>
              <p>{{ estimatedImageTier }} · 1 张 · 按当前分组估算，实际扣费以账单为准。</p>
            </div>
          </div>

          <div v-if="activeTool === 'outpaint'" class="panel-block">
            <div class="field-block">
              <span>扩图方向</span>
              <div class="scene-options" role="group" aria-label="扩图方向">
                <button
                  v-for="option in outpaintDirectionOptions"
                  :key="option.id"
                  type="button"
                  :class="{ active: outpaintDirection === option.id }"
                  :data-test="`creator-outpaint-${option.id}`"
                  @click="outpaintDirection = option.id"
                >
                  {{ option.label }}
                </button>
              </div>
            </div>
            <label class="field-block outpaint-ratio">
              <span>扩展比例</span>
              <select v-model.number="outpaintRatio" class="field-control" data-test="creator-outpaint-ratio">
                <option :value="0.25">25%</option>
                <option :value="0.5">50%</option>
                <option :value="1">100%</option>
              </select>
            </label>
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
            <CreatorImageUpload
              input-id="creator-image-file"
              data-test="creator-image-file"
              :files="selectedImageFile ? [selectedImageFile] : []"
              :label="imageUploadLabel"
              @update:files="setSelectedImageFiles"
            />
          </div>

          <div v-if="activeTool === 'video'" class="panel-block">
            <CreatorImageUpload
              input-id="creator-video-reference-file"
              data-test="creator-video-reference-file"
              :files="videoReferenceFile ? [videoReferenceFile] : []"
              label="视频参考图（可选）"
              hint="不上传为文生视频，上传后为图生视频"
              @update:files="setVideoReferenceFiles"
            />
          </div>

          <div v-if="activeTool === 'batch-main' || activeTool === 'batch-clone'" class="panel-block">
            <CreatorImageUpload
              v-if="activeTool === 'batch-clone'"
              input-id="creator-reference-file"
              data-test="creator-reference-file"
              :files="referenceImageFile ? [referenceImageFile] : []"
              label="克隆参考图"
              hint="点击或拖入一张参考图"
              @update:files="setReferenceImageFiles"
            />
            <CreatorImageUpload
              input-id="creator-batch-files"
              data-test="creator-batch-files"
              :files="batchProductFiles"
              label="商品图片"
              hint="点击或拖入图片，最多 6 张"
              multiple
              :max-files="6"
              @update:files="setBatchProductFiles"
            />
          </div>

          <div v-if="activeTool === 'watermark' && watermarkMode !== 'remove'" class="panel-block">
            <label v-if="watermarkMode === 'text'" class="field-block">
              <span>水印文字</span>
              <input v-model.trim="watermarkText" class="field-control" placeholder="输入要添加的水印文字" />
            </label>
            <CreatorImageUpload
              v-else
              input-id="creator-logo-file"
              data-test="creator-logo-file"
              :files="logoFile ? [logoFile] : []"
              label="水印 Logo"
              hint="点击或拖入一张透明 Logo"
              @update:files="setLogoFiles"
            />
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
            <p v-if="activePromptOptimization?.error" class="prompt-optimize-error">{{ activePromptOptimization.error }}</p>
            <div class="prompt-actions">
              <button
                type="button"
                class="secondary-button optimize-button"
                data-test="creator-optimize-prompt"
                :disabled="!canOptimizePrompt"
                :title="promptOptimizationHint"
                @click="optimizeCurrentPrompt"
              >
                <Icon :name="activePromptOptimization?.loading ? 'refresh' : 'sparkles'" size="sm" :class="{ 'animate-spin': activePromptOptimization?.loading }" />
                {{ activePromptOptimization?.loading ? '优化中' : '优化提示词' }}
              </button>
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
        v-if="activeTool !== 'home' && activeTool !== 'history'"
        :output="output"
        :records="recordsForActiveTool"
        :local-records="localRecordsForActiveTool"
        :record-error="recordLoadError"
        :loading="submitting"
        :error="errorMessage"
        :status="statusMessage"
        :canvas-size="resultCanvasSize"
        :estimate-seconds="estimatedWaitSeconds"
        @restore="restoreRecord"
        @restore-local="restoreLocalRecord"
        @copy="copyText"
        @download-batch="downloadBatch"
        @download-video="downloadVideo"
        @reload-records="loadRecords"
        @view-all="selectTool('history')"
      />
    </div>
  </AppLayout>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import AppLayout from '@/components/layout/AppLayout.vue'
import Icon from '@/components/icons/Icon.vue'
import CreatorHomePanel, { type CreatorRecentItem } from '@/components/user/creator/CreatorHomePanel.vue'
import CreatorHistoryPanel, { type CreatorLocalRecord } from '@/components/user/creator/CreatorHistoryPanel.vue'
import CreatorCanvasSizeControl from '@/components/user/creator/CreatorCanvasSizeControl.vue'
import CreatorImageUpload from '@/components/user/creator/CreatorImageUpload.vue'
import CreatorKeyPicker from '@/components/user/creator/CreatorKeyPicker.vue'
import CreatorResultPanel, { type CreatorOutput } from '@/components/user/creator/CreatorResultPanel.vue'
import CreatorToolRail from '@/components/user/creator/CreatorToolRail.vue'
import { keysAPI } from '@/api'
import { generationRecordsAPI, type GenerationRecord } from '@/api/generationRecords'
import { userGroupsAPI } from '@/api/groups'
import { imageGenerationAPI } from '@/api/imageGeneration'
import { AGNES_VIDEO_MODEL, videoGenerationAPI, type GatewayVideoProvider } from '@/api/videoGeneration'
import * as batchImageAPI from '@/api/batchImage'
import { isUsableCreatorKey, onlineCreatorAPI } from '@/api/onlineCreator'
import {
  claimCreatorRuntimeForCurrentUser,
  createCreatorObjectURL,
  creatorBatchAPIKeys,
  creatorBatchPollTimers,
  creatorBatchRecordContexts,
  creatorRecordRevision,
  creatorTaskStates,
  creatorVideoPollTimers,
  creatorVideoTasks,
  creatorWorkToolIds,
  estimateCreatorDuration,
  notifyCreatorRecordsChanged,
  recordCreatorDuration,
  type CreatorBatchRecordContext,
  type CreatorTaskState,
  type CreatorWorkToolId,
} from '@/composables/useCreatorRuntime'
import { createOutpaintFiles } from '@/utils/imageOutpaint'
import type { ApiKey } from '@/types'

type CreatorToolId = CreatorWorkToolId | 'home' | 'history'

const props = withDefaults(defineProps<{ initialTool?: string }>(), {
  initialTool: 'home',
})

interface CreatorToolConfig {
  id: CreatorToolId
  label: string
  badge: string
  icon: 'home' | 'chat' | 'edit' | 'globe' | 'sparkles' | 'grid' | 'copy' | 'upload' | 'play' | 'cloud' | 'clock' | 'arrowsUpDown'
  action: string
  placeholder: string
}

interface CreatorTaskContext {
  toolId: CreatorWorkToolId
  state: CreatorTaskState
  version: number
}

type CreatorModelCapability = 'text' | 'image' | 'video' | 'batch'

const tools: CreatorToolConfig[] = [
  { id: 'home', label: '首页', badge: '总览', icon: 'home', action: '进入', placeholder: '' },
  { id: 'image', label: 'AI 生图', badge: '图片', icon: 'sparkles', action: '生成图片', placeholder: '描述画面、主体、背景、光影和风格' },
  { id: 'edit', label: '图片编辑', badge: '图片编辑', icon: 'edit', action: '编辑图片', placeholder: '说明需要修改的区域、风格和目标效果' },
  { id: 'product-copy', label: '商品文案', badge: '电商', icon: 'edit', action: '生成文案', placeholder: '补充目标人群、价格策略或发布要求' },
  { id: 'outpaint', label: '图片扩图', badge: '扩图', icon: 'arrowsUpDown', action: '开始扩图', placeholder: '补充希望延展的场景、光影或环境（可选）' },
  { id: 'batch-main', label: '批量主图', badge: '批量', icon: 'grid', action: '提交批量任务', placeholder: '统一要求，例如白底、商业摄影、突出商品质感' },
  { id: 'batch-clone', label: '批量克隆', badge: '批量', icon: 'copy', action: '提交克隆任务', placeholder: '统一克隆要求，例如保留参考图构图与光影' },
  { id: 'watermark', label: '水印处理', badge: '水印', icon: 'upload', action: '处理水印', placeholder: '去除时说明水印位置；添加时可补充透明度/位置' },
  { id: 'video', label: 'AI 视频', badge: '视频', icon: 'play', action: '生成视频', placeholder: '描述镜头、运动、主体和画面风格' },
  { id: 'history', label: '历史记录', badge: '记录', icon: 'clock', action: '查看', placeholder: '' },
]

const workToolIds = creatorWorkToolIds

const imageSceneOptions = [
  { id: 'product', label: '商品白底图', directive: '电商商品白底主图，主体居中，边缘清晰，光线均匀，无多余装饰。' },
  { id: 'lifestyle', label: '商品场景图', directive: '真实生活方式场景，商品为视觉主体，环境与用途自然匹配。' },
  { id: 'poster', label: '社媒海报', directive: '适合社交媒体发布的海报构图，主体突出，留出清晰文案空间。' },
  { id: 'portrait', label: '人物摄影', directive: '自然人物摄影，肤色真实，光影柔和，背景简洁。' },
] as const

const outpaintDirectionOptions = [
  { id: 'all', label: '四周' },
  { id: 'left', label: '向左' },
  { id: 'right', label: '向右' },
  { id: 'top', label: '向上' },
  { id: 'bottom', label: '向下' },
] as const

function normalizeCreatorToolId(toolId?: string): CreatorToolId {
  return tools.some((tool) => tool.id === toolId) ? toolId as CreatorToolId : 'home'
}

const activeTool = ref<CreatorToolId>(normalizeCreatorToolId(props.initialTool))
const apiKeys = ref<ApiKey[]>([])
const userGroupRates = ref<Record<number, number>>({})
const selectedKeyId = ref('')
const backupKeyId = ref('')
const textModels = ref<string[]>([])
const backupTextModels = ref<string[]>([])
const backupTextModelError = ref('')
const imageModels = ref<string[]>([])
const videoModels = ref<string[]>([])
const batchModels = ref<string[]>([])
const batchAPIAvailable = ref(false)
const modelLoadErrors = ref<Partial<Record<CreatorModelCapability, string>>>({})
const selectedModel = ref('')

interface CreatorFormState {
  prompt: string
  targetLanguage: string
  imageSize: string
  imageScene: (typeof imageSceneOptions)[number]['id'] | ''
  imageQuality: string
  imageStyle: string
  imageBackground: string
  outpaintDirection: (typeof outpaintDirectionOptions)[number]['id']
  outpaintRatio: number
  videoDuration: number
  videoSize: string
  videoQuality: string
  productName: string
  productInfo: string
  productPlatform: string
  watermarkMode: 'remove' | 'text' | 'logo'
  watermarkText: string
  selectedImageFile: File | null
  referenceImageFile: File | null
  videoReferenceFile: File | null
  logoFile: File | null
  batchProductFiles: File[]
}

function createFormState(): CreatorFormState {
  return {
    prompt: '',
    targetLanguage: '中文',
    imageSize: '1024x1024',
    imageScene: '',
    imageQuality: 'high',
    imageStyle: 'auto',
    imageBackground: 'auto',
    outpaintDirection: 'all',
    outpaintRatio: 0.5,
    videoDuration: 5,
    videoSize: '1280x720',
    videoQuality: '720p',
    productName: '',
    productInfo: '',
    productPlatform: '闲鱼',
    watermarkMode: 'remove',
    watermarkText: '',
    selectedImageFile: null,
    referenceImageFile: null,
    videoReferenceFile: null,
    logoFile: null,
    batchProductFiles: [],
  }
}

const formStates = reactive<Record<CreatorWorkToolId, CreatorFormState>>(
  Object.fromEntries(workToolIds.map((toolId) => [toolId, createFormState()])) as Record<CreatorWorkToolId, CreatorFormState>,
)
const activeForm = computed(() => isWorkTool(activeTool.value) ? formStates[activeTool.value] : formStates.image)
function activeFormField<K extends keyof CreatorFormState>(key: K) {
  return computed({
    get: () => activeForm.value[key],
    set: (value: CreatorFormState[K]) => { activeForm.value[key] = value },
  })
}
const targetLanguage = activeFormField('targetLanguage')
const imageSize = activeFormField('imageSize')
const imageScene = activeFormField('imageScene')
const imageQuality = activeFormField('imageQuality')
const imageStyle = activeFormField('imageStyle')
const imageBackground = activeFormField('imageBackground')
const outpaintDirection = activeFormField('outpaintDirection')
const outpaintRatio = activeFormField('outpaintRatio')
const videoDuration = activeFormField('videoDuration')
const videoSize = activeFormField('videoSize')
const videoQuality = activeFormField('videoQuality')
const prompt = activeFormField('prompt')
const productName = activeFormField('productName')
const productInfo = activeFormField('productInfo')
const productPlatform = activeFormField('productPlatform')
const watermarkMode = activeFormField('watermarkMode')
const watermarkText = activeFormField('watermarkText')
const selectedImageFile = activeFormField('selectedImageFile')
const referenceImageFile = activeFormField('referenceImageFile')
const videoReferenceFile = activeFormField('videoReferenceFile')
const logoFile = activeFormField('logoFile')
const batchProductFiles = activeFormField('batchProductFiles')
const records = ref<GenerationRecord[]>([])
const recordLoadError = ref('')
const localRecords = ref<CreatorLocalRecord[]>([])
claimCreatorRuntimeForCurrentUser()
const taskStates = creatorTaskStates
let modelRequestVersion = 0
let backupModelRequestVersion = 0
let restoreRequestVersion = 0
let recordRequestVersion = 0
const videoPollTimers = creatorVideoPollTimers
const batchPollTimers = creatorBatchPollTimers
const batchAPIKeys = creatorBatchAPIKeys
const batchRecordContexts = creatorBatchRecordContexts
const videoTasks = creatorVideoTasks
const promptOptimizationStates = reactive<Record<CreatorWorkToolId, { loading: boolean; error: string; version: number }>>(
  Object.fromEntries(workToolIds.map((toolId) => [toolId, { loading: false, error: '', version: 0 }])) as Record<CreatorWorkToolId, { loading: boolean; error: string; version: number }>,
)
const POLL_INTERVAL_MS = 5000
const MAX_POLL_RETRIES = 3
const MAX_POLL_ATTEMPTS = 60
const GATEWAY_REQUEST_TIMEOUT_MS = 180000
const IMAGE_REQUEST_TIMEOUT_MS = 10 * 60 * 1000
const BATCH_REQUEST_TIMEOUT_MS = 10 * 60 * 1000
const GENERATION_RECORD_RETENTION_MS = 72 * 60 * 60 * 1000
const BATCH_RECORD_QUERY_CONCURRENCY = 4
const LOCAL_RECORD_STORAGE_PREFIX = 'online-creator-local-copy-v1'
let localRecordCleanupTimer = 0

const activeToolConfig = computed(() => tools.find((tool) => tool.id === activeTool.value) || tools[0])
const activeTaskState = computed(() => isWorkTool(activeTool.value) ? taskStates[activeTool.value] : null)
const output = computed(() => activeTaskState.value?.output || null)
const submitting = computed(() => Boolean(activeTaskState.value?.loading || activeTaskState.value?.running))
const statusMessage = computed(() => submitting.value ? '正在创作中' : activeTaskState.value?.status || '')
const errorMessage = computed(() => activeTaskState.value?.error || '')
const homeTools = computed(() => tools.filter((tool) => tool.id !== 'home' && tool.id !== 'history'))
const usableKeys = computed(() => apiKeys.value.filter((key) => isUsableCreatorKey(key)))
const selectedApiKey = computed(() => usableKeys.value.find((key) => String(key.id) === selectedKeyId.value) || null)
const backupKeys = computed(() => usableKeys.value.filter((key) => String(key.id) !== selectedKeyId.value))
const backupApiKey = computed(() => backupKeys.value.find((key) => String(key.id) === backupKeyId.value) || null)
const effectiveTextApiKey = computed(() => backupApiKey.value || selectedApiKey.value)
const effectiveTextModels = computed(() => backupApiKey.value ? backupTextModels.value : textModels.value)
const submissionApiKey = computed(() => activeTool.value === 'product-copy' ? effectiveTextApiKey.value : selectedApiKey.value)
const usesGrokImageModel = computed(() => isGrokImageModelName(selectedModel.value))
const isTextTool = computed(() => activeTool.value === 'product-copy')
const isImageTool = computed(() => ['image', 'edit', 'outpaint', 'watermark'].includes(activeTool.value))
const needsModel = computed(() => !['home', 'history'].includes(activeTool.value) && !(activeTool.value === 'watermark' && watermarkMode.value !== 'remove'))
const needsSingleImageUpload = computed(() => ['edit', 'outpaint', 'watermark'].includes(activeTool.value))
const imageUploadLabel = computed(() => {
  if (activeTool.value === 'outpaint') return '上传需要扩展画布的原图'
  if (activeTool.value === 'watermark') return '上传需要处理水印的图片'
  return '上传需要编辑的图片'
})
const modelOptions = computed(() => {
  if (isTextTool.value) return effectiveTextModels.value
  if (isImageTool.value) return imageModels.value
  if (activeTool.value === 'video') return videoModels.value
  if (activeTool.value === 'batch-main' || activeTool.value === 'batch-clone') return batchModels.value
  return []
})
const activePromptOptimization = computed(() => isWorkTool(activeTool.value) ? promptOptimizationStates[activeTool.value] : null)
const canOptimizePrompt = computed(() => Boolean(
  isWorkTool(activeTool.value) &&
  prompt.value.trim() &&
  effectiveTextApiKey.value?.key &&
  effectiveTextModels.value.length > 0 &&
  !activePromptOptimization.value?.loading,
))
const promptOptimizationHint = computed(() => {
  if (!prompt.value.trim()) return '请先输入提示词'
  if (!effectiveTextApiKey.value?.key) return '请选择主密钥或备用文本密钥'
  if (effectiveTextModels.value.length === 0) return backupTextModelError.value || modelLoadErrors.value.text || '当前密钥没有文本模型'
  return '使用文本模型优化当前工具的提示词'
})
const resultCanvasSize = computed(() => {
  if (output.value?.size) return output.value.size
  if (isImageTool.value || activeTool.value === 'batch-main' || activeTool.value === 'batch-clone') return imageSize.value
  if (activeTool.value === 'video') return videoSize.value
  return ''
})
const estimatedWaitSeconds = computed(() => activeTaskState.value?.estimateSeconds || 0)
const promptLabel = computed(() => {
  if (activeTool.value === 'batch-main' || activeTool.value === 'batch-clone') return '统一要求'
  return '创作提示词'
})
const activeModelLoadError = computed(() => {
  let capability: CreatorModelCapability | null = null
  if (isTextTool.value && backupApiKey.value) return backupTextModelError.value
  if (isTextTool.value) capability = 'text'
  else if (isImageTool.value) capability = 'image'
  else if (activeTool.value === 'video') capability = 'video'
  else if (activeTool.value === 'batch-main' || activeTool.value === 'batch-clone') capability = 'batch'
  return capability ? modelLoadErrors.value[capability] || '' : ''
})
const modelWarning = computed(() => {
  if (!selectedApiKey.value) return '请先选择可用 API 密钥。'
  if (activeModelLoadError.value) return `模型加载失败：${activeModelLoadError.value}`
  if (needsModel.value && modelOptions.value.length === 0) return '当前密钥暂无该工具可用模型。'
  return ''
})
const canSubmit = computed(() => {
  if (!submissionApiKey.value?.key || submitting.value || activeTool.value === 'home' || activeTool.value === 'history') return false
  if (needsModel.value && !selectedModel.value && activeTool.value !== 'batch-main' && activeTool.value !== 'batch-clone') return false
  if (activeTool.value === 'product-copy') return Boolean(productName.value && productInfo.value)
  if (activeTool.value === 'image') return prompt.value.length > 0
  if (activeTool.value === 'edit') return Boolean(selectedImageFile.value && prompt.value)
  if (activeTool.value === 'outpaint') return Boolean(selectedImageFile.value)
  if (activeTool.value === 'batch-main') return batchProductFiles.value.length > 0 && batchModels.value.length > 0
  if (activeTool.value === 'batch-clone') return Boolean(referenceImageFile.value && batchProductFiles.value.length > 0 && batchModels.value.length > 0)
  if (activeTool.value === 'watermark') {
    if (!selectedImageFile.value) return false
    if (watermarkMode.value === 'text') return Boolean(watermarkText.value)
    if (watermarkMode.value === 'logo') return Boolean(logoFile.value)
    return Boolean(prompt.value)
  }
  if (activeTool.value === 'video') return prompt.value.length > 0
  return false
})
const recentItems = computed<CreatorRecentItem[]>(() => {
  const backend = records.value.slice(0, 3).map((record) => ({
    id: record.task_id,
    title: record.model || record.provider,
    kind: creatorToolLabel(record.creator_tool) || (record.media_type === 'video' ? '视频' : '图片'),
    preview: record.prompt_preview || '后端生成记录',
  }))
  return [...localRecords.value.slice(0, 3), ...backend].slice(0, 3)
})

function creatorToolLabel(toolId?: string): string {
  return tools.find((tool) => tool.id === toolId)?.label || ''
}
const recordsForActiveTool = computed(() => isWorkTool(activeTool.value)
  ? records.value.filter((record) => record.creator_tool === activeTool.value)
  : records.value)
const localRecordsForActiveTool = computed(() => isWorkTool(activeTool.value)
  ? localRecords.value.filter((record) => record.toolId === activeTool.value)
  : localRecords.value)
const estimatedImageTier = computed(() => {
  const [width, height] = imageSize.value.split('x').map(Number)
  return Math.max(width || 1024, height || 1024) > 1024 ? '2K' : '1K'
})
const estimatedImageCost = computed(() => {
  if (!selectedApiKey.value || !selectedModel.value) return null
  const group = selectedApiKey.value.group
  const configuredPrice = estimatedImageTier.value === '1K' ? group?.image_price_1k : group?.image_price_2k
  const unitPrice = typeof configuredPrice === 'number' && configuredPrice >= 0
    ? configuredPrice
    : defaultImageUnitPrice(selectedModel.value, estimatedImageTier.value)
  const groupRate = group ? (userGroupRates.value[group.id] ?? group.rate_multiplier) : 1
  const multiplier = group?.image_rate_independent ? group.image_rate_multiplier : groupRate
  return Math.max(0, unitPrice * Math.max(0, multiplier))
})
const estimatedImageCostLabel = computed(() => estimatedImageCost.value == null ? '--' : `约 $${estimatedImageCost.value.toFixed(4)}`)

function selectTool(toolId: string) {
  restoreRequestVersion += 1
  activeTool.value = normalizeCreatorToolId(toolId)
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
  videoReferenceFile.value = null
  logoFile.value = null
  batchProductFiles.value = []
  imageScene.value = ''
  imageQuality.value = 'high'
  imageStyle.value = 'auto'
  imageBackground.value = 'auto'
  outpaintDirection.value = 'all'
  outpaintRatio.value = 0.5
  if (activeTaskState.value) {
    activeTaskState.value.error = ''
    activeTaskState.value.status = ''
  }
}

function defaultImageUnitPrice(model: string, tier: string): number {
  const normalized = model.trim().toLowerCase()
  if (normalized === 'grok-imagine' || normalized === 'grok-imagine-image-quality') return tier === '1K' ? 0.05 : 0.07
  if (normalized === 'grok-imagine-image' || normalized === 'grok-imagine-edit') return 0.02
  return tier === '2K' ? 0.201 : 0.134
}

function isGrokImageModelName(model: string): boolean {
  return model.trim().toLowerCase().startsWith('grok-imagine')
}

function imageSizeTier(size: string): '1K' | '2K' {
  const [width, height] = size.split('x').map(Number)
  return Math.max(width || 1024, height || 1024) > 1024 ? '2K' : '1K'
}

function imageAspectRatio(size: string): string {
  const [width, height] = size.split('x').map(Number)
  if (!width || !height) return '1:1'
  const candidates = [
    { label: '1:1', ratio: 1 },
    { label: '4:3', ratio: 4 / 3 },
    { label: '3:4', ratio: 3 / 4 },
    { label: '16:9', ratio: 16 / 9 },
    { label: '9:16', ratio: 9 / 16 },
    { label: '3:2', ratio: 3 / 2 },
    { label: '2:3', ratio: 2 / 3 },
  ]
  const ratio = width / height
  return candidates.reduce((closest, candidate) => (
    Math.abs(candidate.ratio - ratio) < Math.abs(closest.ratio - ratio) ? candidate : closest
  )).label
}

function buildImagePrompt(sourcePrompt: string): string {
  const scene = imageSceneOptions.find((item) => item.id === imageScene.value)
  const styleDirective = imageStyle.value === 'natural'
    ? '整体风格自然写实。'
    : imageStyle.value === 'vivid'
      ? '整体风格鲜明，色彩和对比度更强。'
      : ''
  return [scene?.directive, sourcePrompt, styleDirective].filter(Boolean).join('\n')
}

function promptOptimizationReferenceImage(toolId: CreatorWorkToolId): File | null {
  const form = formStates[toolId]
  if (toolId === 'edit' || toolId === 'outpaint' || toolId === 'watermark') return form.selectedImageFile
  if (toolId === 'batch-clone') return form.referenceImageFile
  if (toolId === 'batch-main') return form.batchProductFiles[0] || null
  if (toolId === 'video') return form.videoReferenceFile
  return null
}

function promptOptimizationModel(models: string[], referenceImage: File | null): string {
  if (!referenceImage) return models[0] || ''
  const priorities = [
    /^gpt-4o-mini(?:$|[-.])/i,
    /^gpt-4\.1-mini(?:$|[-.])/i,
    /^gpt-4o(?:$|[-.])/i,
    /^gpt-4\.1(?:$|[-.])/i,
    /^gpt-5(?:$|[-.])/i,
    /^o(?:3|4)(?:$|[-.])/i,
  ]
  return priorities
    .map((pattern) => models.find((model) => pattern.test(model) && !/(codex|audio|realtime)/i.test(model)))
    .find(Boolean) || models[0] || ''
}

async function optimizeCurrentPrompt(): Promise<void> {
  if (!canOptimizePrompt.value || !isWorkTool(activeTool.value) || !effectiveTextApiKey.value) return
  const toolId = activeTool.value
  const state = promptOptimizationStates[toolId]
  const version = ++state.version
  const sourcePrompt = formStates[toolId].prompt.trim()
  const apiKey = effectiveTextApiKey.value.key
  const referenceImage = promptOptimizationReferenceImage(toolId)
  const model = promptOptimizationModel(effectiveTextModels.value, referenceImage)
  state.loading = true
  state.error = ''
  try {
    const result = await onlineCreatorAPI.createTextCompletion({
      apiKey,
      model,
      mode: 'prompt-optimize',
      prompt: [
        `创作工具：${creatorToolLabel(toolId)}`,
        referenceImage ? '参考图约束：必须以随请求提供的参考图为准，保持其主体、主题、构图、风格、色彩和关键元素，不得偏离。' : '',
        `原始提示词：${sourcePrompt}`,
      ].filter(Boolean).join('\n'),
      targetLanguage: '中文',
      ...(referenceImage ? { referenceImage } : {}),
    })
    if (state.version !== version) return
    if (formStates[toolId].prompt.trim() !== sourcePrompt) {
      state.error = '提示词已被修改，本次优化结果未自动覆盖。'
      return
    }
    formStates[toolId].prompt = result.content.trim()
  } catch (error) {
    if (state.version === version) state.error = extractErrorMessage(error, '提示词优化失败')
  } finally {
    if (state.version === version) state.loading = false
  }
}

function isWorkTool(toolId: CreatorToolId): toolId is CreatorWorkToolId {
  return toolId !== 'home' && toolId !== 'history'
}

function isTaskCurrent(task: CreatorTaskContext): boolean {
  return task.state.version === task.version
}

function finishTaskTiming(task: CreatorTaskContext): void {
  if (!task.state.startedAt) return
  recordCreatorDuration(task.toolId, task.state.timingKey, Date.now() - task.state.startedAt)
  task.state.estimateSeconds = estimateCreatorDuration(task.toolId, task.state.timingKey)
  task.state.startedAt = 0
}

function setSelectedImageFiles(files: File[]) {
  selectedImageFile.value = files[0] || null
}

function setReferenceImageFiles(files: File[]) {
  referenceImageFile.value = files[0] || null
}

function setVideoReferenceFiles(files: File[]) {
  videoReferenceFile.value = files[0] || null
}

function setLogoFiles(files: File[]) {
  logoFile.value = files[0] || null
}

function setBatchProductFiles(files: File[]) {
  batchProductFiles.value = files.slice(0, 6)
}

function extractErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  const record = error && typeof error === 'object' ? error as { message?: unknown } : null
  return String(record?.message || fallback)
}

function imageOutputFromResponse(response: unknown, size: string): CreatorOutput {
  const payload = response && typeof response === 'object' ? response as {
    data?: Array<{ b64_json?: string; url?: string }>
    output?: Array<{ b64_json?: string; url?: string }>
  } : {}
  const item = [...(payload.data || []), ...(payload.output || [])][0]
  if (!item) throw new Error('图片接口已返回，但没有找到可展示结果')
  const url = item.b64_json ? `data:image/png;base64,${item.b64_json}` : item.url
  if (!url) throw new Error('图片结果缺少 URL 或 base64 内容')
  return { type: 'image', url, content: '图片生成完成', size }
}

async function loadModelsForSelectedKey() {
  const apiKey = selectedApiKey.value?.key
  const requestVersion = ++modelRequestVersion
  textModels.value = []
  imageModels.value = []
  videoModels.value = []
  batchModels.value = []
  batchAPIAvailable.value = false
  modelLoadErrors.value = {}
  selectedModel.value = ''
  if (!apiKey) return

  const [texts, images, videos, batches] = await Promise.allSettled([
    onlineCreatorAPI.listTextModels(apiKey),
    imageGenerationAPI.listImageModels(apiKey),
    videoGenerationAPI.listVideoModels(apiKey),
    batchImageAPI.listBatchImageModels(apiKey),
  ])
  if (requestVersion !== modelRequestVersion || selectedApiKey.value?.key !== apiKey) return
  textModels.value = texts.status === 'fulfilled' ? texts.value : []
  imageModels.value = images.status === 'fulfilled' ? images.value : []
  videoModels.value = videos.status === 'fulfilled' ? videos.value : []
  batchAPIAvailable.value = batches.status === 'fulfilled'
  batchModels.value = batches.status === 'fulfilled'
    ? batches.value.data.map((item) => item.id)
    : images.status === 'fulfilled' ? images.value : []
  const errors: Partial<Record<CreatorModelCapability, string>> = {}
  if (texts.status === 'rejected') errors.text = extractErrorMessage(texts.reason, '文本模型加载失败')
  if (images.status === 'rejected') errors.image = extractErrorMessage(images.reason, '图片模型加载失败')
  if (videos.status === 'rejected') errors.video = extractErrorMessage(videos.reason, '视频模型加载失败')
  if (batches.status === 'rejected' && images.status === 'rejected') {
    errors.batch = extractErrorMessage(batches.reason, '批量与图片模型加载失败')
  }
  modelLoadErrors.value = errors
  syncSelectedModel()
}

async function loadBackupTextModels() {
  const apiKey = backupApiKey.value?.key
  const requestVersion = ++backupModelRequestVersion
  backupTextModels.value = []
  backupTextModelError.value = ''
  if (!apiKey) {
    if (isTextTool.value) syncSelectedModel()
    return
  }
  try {
    const models = await onlineCreatorAPI.listTextModels(apiKey)
    if (requestVersion !== backupModelRequestVersion || backupApiKey.value?.key !== apiKey) return
    backupTextModels.value = models
    if (models.length === 0) backupTextModelError.value = '该密钥没有文本模型'
  } catch (error) {
    if (requestVersion !== backupModelRequestVersion || backupApiKey.value?.key !== apiKey) return
    backupTextModelError.value = extractErrorMessage(error, '备用文本模型加载失败')
  } finally {
    if (requestVersion === backupModelRequestVersion && isTextTool.value) syncSelectedModel()
  }
}

async function loadApiKeys() {
  const response = await keysAPI.list(1, 100, { status: 'active' })
  apiKeys.value = response.items.filter((key) => isUsableCreatorKey(key))
  if (!apiKeys.value.some((key) => String(key.id) === selectedKeyId.value)) {
    selectedKeyId.value = apiKeys.value[0] ? String(apiKeys.value[0].id) : ''
  }
  if (!backupKeys.value.some((key) => String(key.id) === backupKeyId.value)) backupKeyId.value = ''
}

async function loadUserGroupRates() {
  try {
    userGroupRates.value = await userGroupsAPI.getUserGroupRates()
  } catch {
    userGroupRates.value = {}
  }
}

function batchRecordTool(job: batchImageAPI.BatchImageJob): 'batch-main' | 'batch-clone' | null {
  const taskName = job.task_name.trim().toLowerCase()
  if (taskName.startsWith('batch-main-')) return 'batch-main'
  if (taskName.startsWith('batch-clone-')) return 'batch-clone'
  return null
}

function batchRecordCreatedAt(value: number): string {
  const timestamp = Number(value)
  const milliseconds = timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000
  const date = new Date(milliseconds)
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString()
}

function generationRecordFromBatch(job: batchImageAPI.BatchImageJob, apiKeyID: number, toolId: 'batch-main' | 'batch-clone'): GenerationRecord {
  return {
    task_id: job.id,
    api_key_id: apiKeyID,
    media_type: 'image',
    creator_tool: toolId,
    provider: job.provider,
    model: job.model,
    prompt_preview: `${toolId === 'batch-clone' ? '批量克隆' : '批量主图'}，共 ${job.item_count} 张`,
    status: job.status,
    result: null,
    created_at: batchRecordCreatedAt(job.created_at),
  }
}

async function loadBatchRecordContexts(
  keys: ApiKey[],
  from: string,
  cutoffTime: number,
  requestVersion: number,
): Promise<CreatorBatchRecordContext[]> {
  const contexts: CreatorBatchRecordContext[] = []
  for (let offset = 0; offset < keys.length; offset += BATCH_RECORD_QUERY_CONCURRENCY) {
    const keyGroup = keys.slice(offset, offset + BATCH_RECORD_QUERY_CONCURRENCY)
    const results = await Promise.allSettled(keyGroup.map(async (key) => ({
      key,
      response: await batchImageAPI.listBatchImageJobs(key.key, { limit: 10, from }),
    })))
    if (requestVersion !== recordRequestVersion) return []
    for (const result of results) {
      if (result.status !== 'fulfilled') continue
      for (const job of result.value.response.data) {
        const toolId = batchRecordTool(job)
        if (!toolId || Date.parse(batchRecordCreatedAt(job.created_at)) < cutoffTime) continue
        contexts.push({ apiKey: result.value.key.key, job, toolId })
      }
    }
  }
  return contexts
}

async function loadRecords() {
  const requestVersion = ++recordRequestVersion
  const keySnapshot = [...usableKeys.value]
  const cutoffTime = Date.now() - GENERATION_RECORD_RETENTION_MS
  const from = new Date(cutoffTime).toISOString()
  const generationRequest = generationRecordsAPI.list(10).then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason: unknown) => ({ status: 'rejected' as const, reason }),
  )
  const batchRequest = loadBatchRecordContexts(keySnapshot, from, cutoffTime, requestVersion)
  const [generationResult, loadedBatchContexts] = await Promise.all([generationRequest, batchRequest])
  if (requestVersion !== recordRequestVersion) return

  const generationItems = generationResult.status === 'fulfilled' ? generationResult.value : []
  const batchItems: GenerationRecord[] = []
  batchRecordContexts.clear()
  for (const context of loadedBatchContexts) {
    const key = keySnapshot.find((item) => item.key === context.apiKey)
    batchAPIKeys.set(context.job.id, context.apiKey)
    batchRecordContexts.set(context.job.id, context)
    batchItems.push(generationRecordFromBatch(context.job, Number(key?.id) || 0, context.toolId))
  }
  records.value = [...generationItems, ...batchItems]
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
    .slice(0, 10)
  recordLoadError.value = generationResult.status === 'rejected'
    ? extractErrorMessage(generationResult.reason, '创作记录加载失败')
    : ''
}

function localRecordStorageKey(): string {
  try {
    const user = JSON.parse(globalThis.localStorage?.getItem('auth_user') || '{}') as { id?: unknown }
    return `${LOCAL_RECORD_STORAGE_PREFIX}:${String(user.id || 'anonymous')}`
  } catch {
    return `${LOCAL_RECORD_STORAGE_PREFIX}:anonymous`
  }
}

function pruneLocalRecords(recordsToPrune: CreatorLocalRecord[], now = Date.now()): CreatorLocalRecord[] {
  const cutoff = now - GENERATION_RECORD_RETENTION_MS
  return recordsToPrune
    .filter((record) => {
      const createdAt = Date.parse(record.createdAt || '')
      return Number.isFinite(createdAt) && createdAt >= cutoff
    })
    .sort((left, right) => Date.parse(right.createdAt || '') - Date.parse(left.createdAt || ''))
    .slice(0, 10)
}

function persistLocalRecords(): void {
  try {
    globalThis.localStorage?.setItem(localRecordStorageKey(), JSON.stringify(localRecords.value))
  } catch {
    // 浏览器禁用本地存储时保留本次页面内记录。
  }
}

function loadLocalRecords(): void {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(localRecordStorageKey()) || '[]')
    localRecords.value = pruneLocalRecords(Array.isArray(value) ? value : [])
  } catch {
    localRecords.value = []
  }
  persistLocalRecords()
}

function cleanupLocalRecords(): void {
  const next = pruneLocalRecords(localRecords.value)
  if (next.length === localRecords.value.length && next.every((record, index) => record.id === localRecords.value[index]?.id)) return
  localRecords.value = next
  persistLocalRecords()
}

function addLocalRecord(record: Omit<CreatorLocalRecord, 'id'>) {
  const createdAt = new Date().toISOString()
  localRecords.value = pruneLocalRecords([{ ...record, createdAt, id: `local-${Date.now()}` }, ...localRecords.value])
  persistLocalRecords()
}

async function submitProductCopy(apiKey: string, signal: AbortSignal, task: CreatorTaskContext) {
  const submittedName = productName.value
  const submittedInfo = productInfo.value
  const content = `商品名：${submittedName}\n商品信息：${submittedInfo}\n目标平台：${productPlatform.value}\n补充要求：${prompt.value || '无'}`
  const result = await onlineCreatorAPI.createTextCompletion({
    apiKey,
    model: selectedModel.value,
    mode: 'product-copy',
    prompt: content,
    targetLanguage: targetLanguage.value,
    signal,
  })
  if (!isTaskCurrent(task)) return
  task.state.output = { type: 'text', content: result.content }
  addLocalRecord({ toolId: 'product-copy', title: submittedName, kind: '商品文案', preview: submittedInfo, content: result.content, outputType: 'text' })
  task.state.status = '商品文案已生成'
}

async function submitImage(apiKey: string, signal: AbortSignal, task: CreatorTaskContext) {
  const submittedSize = imageSize.value
  const request = {
    apiKey,
    model: selectedModel.value,
    prompt: buildImagePrompt(prompt.value),
    size: submittedSize,
    quality: imageQuality.value,
    count: 1,
    outputFormat: 'png',
    creatorTool: task.toolId,
    signal,
    ...(imageBackground.value === 'auto' ? {} : { background: imageBackground.value }),
  }
  const response = await imageGenerationAPI.generateImage(request)
  if (!isTaskCurrent(task)) return
  task.state.output = imageOutputFromResponse(response, submittedSize)
  task.state.status = '图片已生成'
}

async function submitEdit(apiKey: string, signal: AbortSignal, task: CreatorTaskContext) {
  const sourceFile = selectedImageFile.value
  const model = selectedModel.value
  const submittedPrompt = prompt.value
  const submittedSize = imageSize.value
  const submittedDirection = outpaintDirection.value
  const submittedRatio = outpaintRatio.value
  if (!sourceFile) throw new Error('请先上传图片')
  let sourceImage = sourceFile
  let mask: File | undefined
  let requestedSize = submittedSize
  let editPrompt = `请基于上传原图完成编辑，严格保持未明确要求修改的主体身份、主题、构图、风格、色彩和关键细节不变。编辑要求：${submittedPrompt}`
  if (task.toolId === 'outpaint') {
    const expanded = await createDirectionalOutpaintFiles(sourceImage, submittedDirection, submittedRatio)
    if (!isTaskCurrent(task)) return
    sourceImage = expanded.image
    mask = expanded.mask
    requestedSize = `${expanded.width}x${expanded.height}`
    const directionLabel = outpaintDirectionOptions.find((option) => option.id === submittedDirection)?.label || '四周'
    editPrompt = `扩展原图画布，严格保持原图已有区域的主体、构图、文字、色彩和细节不变，仅自然补全透明扩展区域。扩图方向：${directionLabel}；补充要求：${submittedPrompt || '延续原有场景、光影和透视'}`
  }
  const response = await imageGenerationAPI.editImage({
    apiKey,
    model,
    prompt: editPrompt,
    size: requestedSize,
    quality: 'high',
    count: 1,
    outputFormat: 'png',
    image: sourceImage,
    mask,
    inputFidelity: 'high',
    creatorTool: task.toolId,
    signal,
  })
  if (!isTaskCurrent(task)) return
  task.state.output = imageOutputFromResponse(response, requestedSize)
  task.state.status = task.toolId === 'outpaint' ? '图片扩展完成' : '图片编辑完成'
}

async function submitBatch(apiKey: string, task: CreatorTaskContext, signal: AbortSignal) {
  const toolId = task.toolId as 'batch-main' | 'batch-clone'
  const referenceFile = referenceImageFile.value
  const productFiles = [...batchProductFiles.value]
  const taskPrompt = prompt.value
  const taskImageSize = imageSize.value
  const taskModel = selectedModel.value || batchModels.value[0] || imageModels.value[0]
  if (!taskModel) throw new Error('当前密钥暂无可用图片模型')
  if (!batchAPIAvailable.value) {
    await fallbackBatchWithImageEdits(apiKey, new Error('批量接口未启用'), toolId, referenceFile, productFiles, taskPrompt, taskImageSize, taskModel, task, signal)
    return
  }
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
  if (!isTaskCurrent(task)) return
  const idempotencyKey = `${toolId}-${Date.now()}`
  try {
    const job = await batchImageAPI.submitBatchImageJob(apiKey, {
      model: taskModel,
      task_name: idempotencyKey,
      image_size: imageSizeTier(taskImageSize),
      aspect_ratio: imageAspectRatio(taskImageSize),
      items,
      metadata: { source: 'online-creator', tool: toolId },
    }, idempotencyKey)
    batchAPIKeys.set(job.id, apiKey)
    task.state.output = {
      type: 'batch',
      content: `批量任务已提交：${job.id}\n状态：${job.status}\n数量：${job.item_count}`,
      batchId: job.id,
      batchReady: false,
    }
    task.state.status = '批量任务已提交'
    task.state.running = true
    scheduleBatchPoll(apiKey, job.id, task)
  } catch (error) {
    if (!isTaskCurrent(task)) return
    if (!isExplicitBatchUnsupported(error)) throw error
    await fallbackBatchWithImageEdits(apiKey, error, toolId, referenceFile, productFiles, taskPrompt, taskImageSize, taskModel, task, signal)
  }
}

function isExplicitBatchUnsupported(error: unknown): boolean {
  const record = error && typeof error === 'object' ? error as { status?: unknown; message?: unknown } : null
  const status = Number(record?.status || 0)
  const message = String(record?.message || '')
  if ([404, 405, 501].includes(status)) return true
  if (status === 403 && /(batch|批量|disabled|未启用|不支持)/i.test(message)) return true
  if (![400, 422].includes(status)) return /(batch image API is disabled|批量接口未启用)/i.test(message)
  return /(reference|参考图|not supported|unsupported|不支持|disabled|未启用)/i.test(message)
}

async function fallbackBatchWithImageEdits(
  apiKey: string,
  cause: unknown,
  toolId: 'batch-main' | 'batch-clone',
  referenceFile: File | null,
  productFiles: File[],
  taskPrompt: string,
  taskImageSize: string,
  taskModel: string,
  task: CreatorTaskContext,
  signal: AbortSignal,
) {
  if (toolId === 'batch-clone' && !referenceFile) throw new Error('请先上传克隆参考图')
  const lines: string[] = [`批量接口不可用，已自动改用逐张图片编辑。原因：${extractErrorMessage(cause, '批量接口提交失败')}`]
  const outputItems: NonNullable<CreatorOutput['items']> = []
  for (const [index, file] of productFiles.entries()) {
    if (!isTaskCurrent(task)) return
    try {
      const sourceImage = toolId === 'batch-clone' && referenceFile
        ? await createCloneComposite(referenceFile, file, index)
        : file
      if (!isTaskCurrent(task)) return
      const response = await imageGenerationAPI.editImage({
        apiKey,
        model: imageModels.value[0] || taskModel,
        prompt: toolId === 'batch-clone'
          ? `合成图左侧是参考图、右侧是商品图。请按左侧构图与风格克隆右侧商品主图，只输出右侧商品。统一要求：${taskPrompt || '保持电商主图质感'}`
          : `将上传商品图优化为统一的电商主图，保留商品本身外观与细节。统一要求：${taskPrompt || '白底、商业摄影、突出商品质感'}`,
        size: taskImageSize,
        quality: 'high',
        count: 1,
        outputFormat: 'png',
        image: sourceImage,
        creatorTool: task.toolId,
        signal,
      })
      if (!isTaskCurrent(task)) return
      const result = imageOutputFromResponse(response, taskImageSize)
      lines.push(`第 ${index + 1} 张：成功`)
      outputItems.push({ id: `fallback-${index + 1}`, label: file.name, status: 'completed', url: result.url, filename: `${toolId === 'batch-clone' ? 'clone' : 'main'}-${index + 1}.png` })
    } catch (itemError) {
      if (!isTaskCurrent(task)) return
      if (signal.aborted) throw itemError
      const message = extractErrorMessage(itemError, '图片编辑失败')
      lines.push(`第 ${index + 1} 张：失败，${message}`)
      outputItems.push({ id: `fallback-${index + 1}`, label: file.name, status: 'failed', error: message })
    }
  }
  if (!isTaskCurrent(task)) return
  task.state.output = { type: 'batch', content: lines.join('\n'), items: outputItems }
  task.state.status = '已完成逐张兜底处理'
}

function scheduleBatchPoll(apiKey: string, batchId: string, task: CreatorTaskContext, attempt = 0, retryCount = 0) {
  const currentTimer = batchPollTimers.get(task.toolId)
  if (currentTimer !== undefined) window.clearTimeout(currentTimer)
  const timer = window.setTimeout(() => {
    batchPollTimers.delete(task.toolId)
    void pollBatchStatus(apiKey, batchId, task, attempt, retryCount)
  }, POLL_INTERVAL_MS)
  batchPollTimers.set(task.toolId, timer)
}

async function pollBatchStatus(apiKey: string, batchId: string, task: CreatorTaskContext, attempt: number, retryCount: number) {
  if (!isTaskCurrent(task)) return
  if (attempt >= MAX_POLL_ATTEMPTS) {
    task.state.error = '批量任务查询超时，请稍后从创作记录恢复'
    task.state.status = ''
    task.state.running = false
    return
  }
  try {
    const job = await batchImageAPI.getBatchImageJob(apiKey, batchId)
    if (!isTaskCurrent(task)) return
    task.state.output = {
      type: 'batch',
      batchId,
      batchReady: false,
      content: `批量任务：${batchId}\n状态：${job.status}\n成功：${job.success_count || 0}，失败：${job.fail_count || 0}`,
      items: task.state.output?.type === 'batch' ? task.state.output.items : undefined,
    }
    if (['completed', 'failed', 'cancelled', 'output_deleted'].includes(job.status)) {
      task.state.status = job.status === 'completed' ? '批量任务已完成' : `批量任务已结束：${job.status}`
      if (job.status === 'completed') await loadBatchItems(apiKey, batchId, task)
      task.state.running = false
      if (job.status === 'completed') finishTaskTiming(task)
      notifyCreatorRecordsChanged()
      return
    }
    task.state.status = `批量任务处理中：${job.status}`
    if (attempt + 1 >= MAX_POLL_ATTEMPTS) {
      task.state.error = '批量任务查询超时，请稍后从创作记录恢复'
      task.state.status = ''
      task.state.running = false
      return
    }
    scheduleBatchPoll(apiKey, batchId, task, attempt + 1)
  } catch (error) {
    if (!isTaskCurrent(task)) return
    if (retryCount < MAX_POLL_RETRIES && attempt + 1 < MAX_POLL_ATTEMPTS) {
      task.state.status = `批量任务状态查询重试中（${retryCount + 1}/${MAX_POLL_RETRIES}）`
      scheduleBatchPoll(apiKey, batchId, task, attempt + 1, retryCount + 1)
      return
    }
    task.state.error = extractErrorMessage(error, '批量任务状态查询失败')
    task.state.status = ''
    task.state.running = false
  }
}

async function loadBatchItems(apiKey: string, batchId: string, task: CreatorTaskContext) {
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
      if (!isTaskCurrent(task)) return result
      result.url = createCreatorObjectURL(blob)
      result.filename = `${item.custom_id}.${item.file_extension || 'png'}`
    }
    return result
  }))
  if (!isTaskCurrent(task)) return
  task.state.output = { type: 'batch', batchId, batchReady: true, content: `批量任务 ${batchId} 已完成`, items }
}

async function submitWatermark(apiKey: string, task: CreatorTaskContext, signal: AbortSignal) {
  const sourceFile = selectedImageFile.value
  const mode = watermarkMode.value
  const submittedText = watermarkText.value
  const submittedLogo = logoFile.value
  const submittedPrompt = prompt.value
  const submittedSize = imageSize.value
  const submittedModel = selectedModel.value
  if (!sourceFile) throw new Error('请先上传图片')
  if (mode === 'remove') {
    const response = await imageGenerationAPI.editImage({
      apiKey,
      model: submittedModel,
      prompt: `去除图片中的水印、遮挡或不需要文字，尽量自然补全背景。位置说明：${submittedPrompt}`,
      size: submittedSize,
      quality: 'high',
      count: 1,
      outputFormat: 'png',
      image: sourceFile,
      creatorTool: task.toolId,
      signal,
    })
    if (!isTaskCurrent(task)) return
    task.state.output = imageOutputFromResponse(response, submittedSize)
    task.state.status = '水印去除完成'
    return
  }
  const blob = mode === 'text'
    ? await renderTextWatermark(sourceFile, submittedText)
    : await renderLogoWatermark(sourceFile, submittedLogo)
  if (!isTaskCurrent(task)) return
  const url = createCreatorObjectURL(blob)
  task.state.output = { type: 'image', url, content: '水印图片已生成', size: submittedSize }
  task.state.status = '水印已添加，可直接下载'
}

async function submitVideo(apiKey: string, task: CreatorTaskContext) {
  const model = selectedModel.value
  const submittedPrompt = prompt.value
  const submittedDuration = videoDuration.value
  const submittedSize = videoSize.value
  const submittedQuality = videoQuality.value as '480p' | '720p' | '1080p'
  const submittedReference = videoReferenceFile.value
  const [width, height] = submittedSize.split('x').map(Number)
  const referenceImage = submittedReference
    ? `data:${submittedReference.type || 'image/png'};base64,${await fileToBase64(submittedReference)}`
    : undefined
  const provider: GatewayVideoProvider = model === AGNES_VIDEO_MODEL || model.toLowerCase().includes('agnes') ? 'agnes' : 'grok'
  const data = await videoGenerationAPI.generateVideo({
    apiKey,
    provider,
    prompt: submittedPrompt,
    model,
    duration: submittedDuration,
    size: submittedSize,
    width,
    height,
    quality: submittedQuality,
    referenceImage,
    creatorTool: task.toolId,
  })
  if (!isTaskCurrent(task)) return
  const videoUrl = data.video?.url || data.url
  const requestId = data.request_id || data.id
  if (requestId) videoTasks.set(requestId, { apiKey, provider, model })
  task.state.output = { type: 'video', url: videoUrl, videoRequestId: requestId, content: `视频任务已提交：${requestId || '未返回任务 ID'}`, size: submittedSize }
  if (videoUrl || ['completed', 'succeeded', 'success', 'done'].includes(String(data.status || '').toLowerCase())) {
    task.state.status = '视频已生成'
    finishTaskTiming(task)
    return
  }
  if (!requestId) throw new Error('视频接口未返回任务 ID')
  task.state.status = '视频任务处理中'
  task.state.running = true
  scheduleVideoPoll(apiKey, requestId, provider, model, task)
}

function scheduleVideoPoll(apiKey: string, requestId: string, provider: GatewayVideoProvider, model: string, task: CreatorTaskContext, attempt = 0, retryCount = 0) {
  const currentTimer = videoPollTimers.get(task.toolId)
  if (currentTimer !== undefined) window.clearTimeout(currentTimer)
  const timer = window.setTimeout(() => {
    videoPollTimers.delete(task.toolId)
    void pollVideoStatus(apiKey, requestId, provider, model, task, attempt, retryCount)
  }, POLL_INTERVAL_MS)
  videoPollTimers.set(task.toolId, timer)
}

async function pollVideoStatus(apiKey: string, requestId: string, provider: GatewayVideoProvider, model: string, task: CreatorTaskContext, attempt: number, retryCount: number) {
  if (!isTaskCurrent(task)) return
  if (attempt >= MAX_POLL_ATTEMPTS) {
    task.state.error = '视频任务查询超时，请稍后从创作记录恢复'
    task.state.status = ''
    task.state.running = false
    return
  }
  try {
    const data = await videoGenerationAPI.getVideoStatus(apiKey, requestId, provider, model)
    if (!isTaskCurrent(task)) return
    const status = String(data.status || 'processing').toLowerCase()
    const videoUrl = data.video?.url || data.url
    task.state.output = { type: 'video', url: videoUrl, videoRequestId: requestId, content: `视频任务 ${requestId}：${status}`, size: task.state.output?.size }
    if (['completed', 'succeeded', 'success', 'done'].includes(status)) {
      task.state.status = '视频已生成'
      task.state.running = false
      finishTaskTiming(task)
      notifyCreatorRecordsChanged()
      return
    }
    if (['failed', 'cancelled', 'canceled', 'error', 'expired'].includes(status)) {
      task.state.error = extractErrorMessage(data.error, '视频生成失败')
      task.state.status = ''
      task.state.running = false
      notifyCreatorRecordsChanged()
      return
    }
    task.state.status = `视频生成中：${status}`
    if (attempt + 1 >= MAX_POLL_ATTEMPTS) {
      task.state.error = '视频任务查询超时，请稍后从创作记录恢复'
      task.state.status = ''
      task.state.running = false
      return
    }
    scheduleVideoPoll(apiKey, requestId, provider, model, task, attempt + 1)
  } catch (error) {
    if (!isTaskCurrent(task)) return
    if (retryCount < MAX_POLL_RETRIES && attempt + 1 < MAX_POLL_ATTEMPTS) {
      task.state.status = `视频状态查询重试中（${retryCount + 1}/${MAX_POLL_RETRIES}）`
      scheduleVideoPoll(apiKey, requestId, provider, model, task, attempt + 1, retryCount + 1)
      return
    }
    task.state.error = extractErrorMessage(error, '视频状态查询失败')
    task.state.status = ''
    task.state.running = false
  }
}

async function handleSubmit() {
  if (!canSubmit.value || !submissionApiKey.value || !isWorkTool(activeTool.value)) return
  const toolId = activeTool.value
  const fullRecordCount = toolId === 'product-copy' ? localRecords.value.length : records.value.length
  if (fullRecordCount >= 10 && !window.confirm('生成记录已满 10 条，继续创作将删除时间最早的一条记录。是否继续？')) return
  const recordToReplace = fullRecordCount >= 10 && (toolId === 'batch-main' || toolId === 'batch-clone')
    ? records.value[records.value.length - 1] || null
    : null
  const state = taskStates[toolId]
  const version = ++state.version
  const task: CreatorTaskContext = { toolId, state, version }
  const apiKey = submissionApiKey.value.key
  const controller = new AbortController()
  state.controller = controller
  let timedOut = false
  const timeoutMs = toolId === 'batch-main' || toolId === 'batch-clone'
    ? BATCH_REQUEST_TIMEOUT_MS
    : toolId === 'image' || toolId === 'edit' || toolId === 'outpaint'
      ? IMAGE_REQUEST_TIMEOUT_MS
      : GATEWAY_REQUEST_TIMEOUT_MS
  const timeoutId = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  state.loading = true
  state.running = false
  state.error = ''
  state.status = '正在创作中'
  state.output = null
  state.startedAt = Date.now()
  state.timingKey = selectedModel.value
  state.estimateSeconds = estimateCreatorDuration(toolId, selectedModel.value)
  try {
    if (toolId === 'product-copy') await submitProductCopy(apiKey, controller.signal, task)
    else if (toolId === 'image') await submitImage(apiKey, controller.signal, task)
    else if (toolId === 'edit' || toolId === 'outpaint') await submitEdit(apiKey, controller.signal, task)
    else if (toolId === 'batch-main' || toolId === 'batch-clone') {
      await submitBatch(apiKey, task, controller.signal)
      const submittedBatchId = (task.state.output as CreatorOutput | null)?.batchId
      if (recordToReplace && isTaskCurrent(task) && submittedBatchId) {
        try {
          await removeBackendRecord(recordToReplace)
        } catch (error) {
          recordLoadError.value = extractErrorMessage(error, '最早的生成记录清理失败，请稍后手动删除')
        }
      }
    }
    else if (toolId === 'watermark') await submitWatermark(apiKey, task, controller.signal)
    else if (toolId === 'video') await submitVideo(apiKey, task)
    if (isTaskCurrent(task) && !state.running) finishTaskTiming(task)
    if (isTaskCurrent(task)) notifyCreatorRecordsChanged()
  } catch (error) {
    if (!isTaskCurrent(task)) return
    state.error = timedOut
      ? `网关请求超过 ${Math.round(timeoutMs / 1000)} 秒，已自动取消；可切换工具或稍后重试`
      : extractErrorMessage(error, '创作失败，请检查密钥、模型或参数')
    state.status = ''
    state.running = false
    state.startedAt = 0
  } finally {
    window.clearTimeout(timeoutId)
    if (state.controller === controller) state.controller = null
    if (isTaskCurrent(task)) state.loading = false
  }
}

async function restoreRecord(record: GenerationRecord) {
  const batchContext = batchRecordContexts.get(record.task_id)
  if (batchContext) {
    await restoreBatchRecord(batchContext)
    return
  }
  const version = ++restoreRequestVersion
  const creatorTool = record.creator_tool as CreatorWorkToolId | undefined
  const targetTool: CreatorWorkToolId = creatorTool && workToolIds.includes(creatorTool)
    ? creatorTool
    : record.media_type === 'video' ? 'video' : 'image'
  const state = taskStates[targetTool]
  try {
    let url: string | undefined
    if (record.result?.files?.length) {
      const blob = await generationRecordsAPI.content(record.task_id, 0)
      if (version !== restoreRequestVersion) return
      url = createCreatorObjectURL(blob)
    } else url = record.result?.urls?.[0]
    if (version !== restoreRequestVersion) return
    if (url && record.media_type === 'image') state.output = { type: 'image', url, content: record.prompt_preview || '已从创作记录恢复图片' }
    else if (url && record.media_type === 'video') state.output = { type: 'video', url, content: record.prompt_preview || '已从创作记录恢复视频' }
    else state.output = { type: 'text', content: record.prompt_preview || '该记录没有可直接展示的结果' }
    activeTool.value = targetTool
    syncSelectedModel()
    state.status = '已从创作记录恢复'
    state.error = ''
  } catch (error) {
    if (version !== restoreRequestVersion) return
    state.error = extractErrorMessage(error, '创作记录内容读取失败')
  }
}

async function restoreBatchRecord(context: CreatorBatchRecordContext) {
  const { apiKey, job, toolId } = context
  const state = taskStates[toolId]
  const version = ++state.version
  const task: CreatorTaskContext = { toolId, state, version }
  const terminal = ['completed', 'failed', 'cancelled', 'output_deleted'].includes(job.status)
  batchAPIKeys.set(job.id, apiKey)
  activeTool.value = toolId
  syncSelectedModel()
  state.error = ''
  state.loading = job.status === 'completed'
  state.running = !terminal
  state.status = job.status === 'completed' ? '正在加载批量结果' : `批量任务状态：${job.status}`
  state.output = {
    type: 'batch',
    batchId: job.id,
    batchReady: job.status === 'completed',
    content: `批量任务：${job.id}\n状态：${job.status}\n数量：${job.item_count}`,
  }
  try {
    if (job.status === 'completed') await loadBatchItems(apiKey, job.id, task)
    else if (!terminal) scheduleBatchPoll(apiKey, job.id, task)
  } catch (error) {
    if (!isTaskCurrent(task)) return
    state.error = extractErrorMessage(error, '批量记录内容读取失败')
    state.status = ''
    state.running = false
  } finally {
    if (isTaskCurrent(task)) state.loading = false
  }
}

function restoreLocalRecord(record: CreatorLocalRecord) {
  const state = taskStates['product-copy']
  state.output = { type: 'text', content: record.content }
  activeTool.value = 'product-copy'
  syncSelectedModel()
  state.status = '已从本地记录恢复'
  state.error = ''
}

async function deleteBackendRecord(record: GenerationRecord): Promise<void> {
  if (!window.confirm('确定删除这条生成记录吗？删除后无法恢复。')) return
  recordLoadError.value = ''
  try {
    await removeBackendRecord(record)
  } catch (error) {
    recordLoadError.value = extractErrorMessage(error, '生成记录删除失败')
  }
}

async function removeBackendRecord(record: GenerationRecord): Promise<void> {
  const batchContext = batchRecordContexts.get(record.task_id)
  if (batchContext) {
    await batchImageAPI.deleteBatchImageJobRecord(batchContext.apiKey, record.task_id)
    batchRecordContexts.delete(record.task_id)
    batchAPIKeys.delete(record.task_id)
  } else {
    await generationRecordsAPI.delete(record.task_id)
  }
  records.value = records.value.filter((item) => item.task_id !== record.task_id)
  for (const state of Object.values(taskStates)) {
    if (state.output?.batchId === record.task_id || state.output?.videoRequestId === record.task_id) state.output = null
  }
}

function deleteLocalRecord(record: CreatorLocalRecord): void {
  if (!window.confirm('确定删除这条文案记录吗？删除后无法恢复。')) return
  localRecords.value = localRecords.value.filter((item) => item.id !== record.id)
  persistLocalRecords()
}

async function copyText(content: string) {
  const state = activeTaskState.value
  await navigator.clipboard?.writeText(content)
  if (state) state.status = '已复制'
}

async function downloadBatch(batchId: string) {
  const state = activeTaskState.value
  const apiKey = batchAPIKeys.get(batchId) || selectedApiKey.value?.key
  if (!apiKey) return
  try {
    const blob = await batchImageAPI.downloadBatchImageZip(apiKey, batchId)
    batchImageAPI.saveBlob(blob, `${batchId}.zip`)
  } catch (error) {
    if (state) state.error = extractErrorMessage(error, '批量图片下载失败')
  }
}

async function downloadVideo(requestId: string) {
  const state = activeTaskState.value
  const task = videoTasks.get(requestId)
  if (!task) {
    if (state) state.error = '缺少视频任务上下文，请重新查询或生成视频后再下载'
    return
  }
  try {
    const blob = await videoGenerationAPI.downloadVideoContent(task.apiKey, requestId, task.provider, task.model)
    batchImageAPI.saveBlob(blob, `${requestId}.mp4`)
  } catch (error) {
    if (state) state.error = extractErrorMessage(error, '视频下载失败')
  }
}

async function createDirectionalOutpaintFiles(
  file: File,
  direction: (typeof outpaintDirectionOptions)[number]['id'],
  ratio: number,
): Promise<Awaited<ReturnType<typeof createOutpaintFiles>>> {
  const safeRatio = Math.min(1, Math.max(0.25, Number(ratio) || 0.5))
  if (direction === 'all') {
    return createOutpaintFiles(file, { mode: 'scale', scale: 1 + safeRatio })
  }

  const image = await loadImageElement(file)
  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height
  return createOutpaintFiles(file, {
    mode: 'free',
    top: direction === 'top' ? Math.round(sourceHeight * safeRatio) : 0,
    right: direction === 'right' ? Math.round(sourceWidth * safeRatio) : 0,
    bottom: direction === 'bottom' ? Math.round(sourceHeight * safeRatio) : 0,
    left: direction === 'left' ? Math.round(sourceWidth * safeRatio) : 0,
  })
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
  if (backupKeyId.value === selectedKeyId.value) backupKeyId.value = ''
  void loadModelsForSelectedKey()
})
watch(backupKeyId, () => {
  void loadBackupTextModels()
})
watch(creatorRecordRevision, () => {
  void loadRecords()
})
watch(() => props.initialTool, (toolId) => selectTool(normalizeCreatorToolId(toolId)))
watch(activeTool, syncSelectedModel)
watch(watermarkMode, syncSelectedModel)
watch(selectedModel, (model) => {
  if (!isGrokImageModelName(model)) return
  imageQuality.value = 'high'
  imageBackground.value = 'auto'
})

onMounted(async () => {
  loadLocalRecords()
  localRecordCleanupTimer = window.setInterval(cleanupLocalRecords, 60 * 60 * 1000)
  await Promise.all([loadApiKeys(), loadUserGroupRates()])
  await loadRecords()
})

onBeforeUnmount(() => {
  restoreRequestVersion += 1
  modelRequestVersion += 1
  backupModelRequestVersion += 1
  if (localRecordCleanupTimer) window.clearInterval(localRecordCleanupTimer)
  localRecordCleanupTimer = 0
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
  grid-template-columns: 184px minmax(420px, 470px) minmax(520px, 1fr);
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

.online-creator-page.wide-mode .creator-workspace {
  grid-column: 2 / -1;
}

.online-creator-page.wide-mode > :deep(.creator-result-panel) {
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

.key-context {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin: -4px 0 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}

.image-settings {
  display: grid;
  gap: 12px;
}

.scene-options {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.scene-options button {
  min-height: 32px;
  border: 1px solid #dbe4ee;
  border-radius: 6px;
  background: #fff;
  color: #475569;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  padding: 0 10px;
}

.scene-options button:hover,
.scene-options button.active {
  border-color: #5eead4;
  background: #f0fdfa;
  color: #0f766e;
}

.image-parameter-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 9px;
}

.cost-estimate {
  display: grid;
  gap: 5px;
  border: 1px solid #bae6fd;
  border-radius: 6px;
  background: rgba(240, 249, 255, 0.86);
  padding: 10px 12px;
}

.cost-estimate div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: #475569;
  font-size: 12px;
}

.cost-estimate strong {
  color: #0f172a;
  font-size: 13px;
}

.cost-estimate p {
  margin: 0;
  color: #64748b;
  font-size: 11px;
  line-height: 1.5;
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

.panel-block > :deep(.image-upload + .image-upload) {
  margin-top: 10px;
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

.prompt-card {
  display: grid;
  gap: 12px;
}

.prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.optimize-button {
  margin-right: auto;
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

  .online-creator-page.wide-mode .creator-workspace,
  .online-creator-page > :deep(.creator-result-panel) {
    grid-column: 1;
  }

  .form-grid {
    grid-template-columns: 1fr;
  }

  .image-parameter-grid {
    grid-template-columns: 1fr;
  }

  .prompt-actions {
    flex-direction: column;
  }

  .optimize-button {
    margin-right: 0;
  }
}
</style>
