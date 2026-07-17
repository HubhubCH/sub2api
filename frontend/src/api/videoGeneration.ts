import axios from 'axios'
import { buildGatewayUrl } from './url'

export const GROK_COMPATIBLE_VIDEO_MODELS = ['grok-imagine-video', 'sora-2', 'sora-2-pro'] as const
export const AGNES_VIDEO_MODEL = 'agnes-video-v2.0' as const
export const AGNES_VIDEO_FRAME_RATE = 24
export const AGNES_VIDEO_MAX_FRAMES = 441

export type GrokCompatibleVideoModel = (typeof GROK_COMPATIBLE_VIDEO_MODELS)[number]
export type AgnesVideoModel = typeof AGNES_VIDEO_MODEL
export type GatewayVideoProvider = 'grok' | 'agnes'
export type VideoProvider = GatewayVideoProvider | 'comfyui'
export type VideoModel = string
export type VideoResolution = '480p' | '720p' | '1080p'

export interface VideoGenerateRequest {
  apiKey: string
  provider: GatewayVideoProvider
  prompt: string
  model: VideoModel
  imageUrl?: string
  referenceImage?: string
  duration?: number
  aspectRatio?: string
  size?: string
  width?: number
  height?: number
  resolution?: VideoResolution
  mode?: string
  creatorTool?: string
}

export type GrokVideoGenerateRequest = Omit<VideoGenerateRequest, 'provider'> & {
  provider?: 'grok'
  model: string
}

export interface NormalizedVideoOutput {
  url?: string
  duration?: number | string
  width?: number
  height?: number
  size?: string
}

export interface VideoGenerateResponse {
  request_id?: string
  id?: string
  provider?: GatewayVideoProvider
  model?: string
  status?: string
  progress?: number
  video?: NormalizedVideoOutput
  url?: string
  seconds?: number | string
  size?: string
  error?: unknown
  data?: Array<{
    url?: string
    b64_json?: string
    revised_prompt?: string
  }> | Record<string, unknown>
  output?: Array<{
    url?: string
    b64_json?: string
    type?: string
  }>
  [key: string]: unknown
}

export type GrokVideoGenerateResponse = VideoGenerateResponse
export type VideoStatusResponse = VideoGenerateResponse
export type GrokVideoStatusResponse = VideoStatusResponse

export interface ComfyPromptRequest {
  serverUrl: string
  workflow: Record<string, unknown>
  clientId: string
}

export interface ComfyPromptResponse {
  prompt_id?: string
  number?: number
  node_errors?: Record<string, unknown>
  [key: string]: unknown
}

const gatewayClient = axios.create({
  timeout: 120000,
  headers: {
    'Content-Type': 'application/json'
  }
})

function bearerHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey.trim()}`
  }
}

function cleanPayload(payload: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== null && value !== '')
  )
}

function normalizeComfyServerUrl(serverUrl: string): string {
  return serverUrl.trim().replace(/\/+$/, '')
}

function isGrokCompatibleVideoModel(model: string): model is GrokCompatibleVideoModel {
  return (GROK_COMPATIBLE_VIDEO_MODELS as readonly string[]).includes(model)
}

function isVideoModelName(model: string): boolean {
  return /(video|sora)/i.test(model.trim())
}

export function videoModelsForProvider(
  models: readonly string[],
  provider: GatewayVideoProvider
): string[] {
  return Array.from(
    new Set(
      models
        .map((model) => model.trim())
        .filter((model) =>
          provider === 'agnes'
            ? model === AGNES_VIDEO_MODEL
            : model !== AGNES_VIDEO_MODEL && isVideoModelName(model)
        )
    )
  )
}

function inferGrokCompatibleResolution(request: VideoGenerateRequest): VideoResolution {
  if (request.resolution) return request.resolution
  const width = Number(request.width) || 0
  const height = Number(request.height) || 0
  const shortEdge = width > 0 && height > 0 ? Math.min(width, height) : Math.max(width, height)
  if (shortEdge >= 1080) return '1080p'
  if (shortEdge >= 720) return '720p'
  return '480p'
}

export function normalizeAgnesFrameCount(durationSeconds?: number): number {
  const parsed = Number(durationSeconds)
  const seconds = Number.isFinite(parsed) && parsed > 0 ? parsed : 6
  const frames = Math.round((seconds * AGNES_VIDEO_FRAME_RATE) / 8) * 8 + 1
  return Math.min(AGNES_VIDEO_MAX_FRAMES, Math.max(9, frames))
}

function buildGrokCompatiblePayload(request: VideoGenerateRequest): Record<string, unknown> {
  if (
    request.model === AGNES_VIDEO_MODEL ||
    (!isGrokCompatibleVideoModel(request.model) && !isVideoModelName(request.model))
  ) {
    throw new Error(`Grok 兼容视频模型不受支持：${request.model}`)
  }

  const images = [request.imageUrl, request.referenceImage]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))

  return cleanPayload({
    provider: 'grok',
    model: request.model,
    prompt: request.prompt.trim(),
    duration: request.duration,
    aspect_ratio: request.aspectRatio,
    resolution: inferGrokCompatibleResolution(request),
    image: images[0] ? { url: images[0] } : undefined,
    reference_images: images.length > 1 ? images.slice(1).map((url) => ({ url })) : undefined
  })
}

function buildAgnesPayload(request: VideoGenerateRequest): Record<string, unknown> {
  if (request.model !== AGNES_VIDEO_MODEL) {
    throw new Error(`Agnes 视频模型必须为 ${AGNES_VIDEO_MODEL}`)
  }

  const image = request.imageUrl?.trim() || request.referenceImage?.trim()
  const width = Number.isFinite(Number(request.width)) && Number(request.width) > 0 ? Number(request.width) : 1152
  const height = Number.isFinite(Number(request.height)) && Number(request.height) > 0 ? Number(request.height) : 768

  return cleanPayload({
    provider: 'agnes',
    model: AGNES_VIDEO_MODEL,
    prompt: request.prompt.trim(),
    image,
    width,
    height,
    num_frames: normalizeAgnesFrameCount(request.duration),
    frame_rate: AGNES_VIDEO_FRAME_RATE,
    mode: request.mode
  })
}

function buildVideoPayload(request: VideoGenerateRequest): Record<string, unknown> {
  return request.provider === 'agnes' ? buildAgnesPayload(request) : buildGrokCompatiblePayload(request)
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function responseErrorMessage(error: unknown): string {
  const errorRecord = recordValue(error)
  const response = recordValue(errorRecord?.response)
  const data = recordValue(response?.data)
  const nestedError = recordValue(data?.error)
  const candidates = [nestedError?.message, data?.message, data?.detail, data?.error, errorRecord?.message]
  return String(candidates.find((value) => typeof value === 'string' && value.trim()) || '').trim()
}

function normalizeVideoRequestError(error: unknown, fallback: string): Error {
  const errorRecord = recordValue(error)
  const response = recordValue(errorRecord?.response)
  const status = Number(response?.status) || 0
  const message = responseErrorMessage(error)
  if (message && !/^request failed with status code/i.test(message)) {
    return new Error(message)
  }
  return new Error(`${fallback}${status ? `（HTTP ${status}）` : ''}`)
}

export async function generateVideo(request: VideoGenerateRequest): Promise<VideoGenerateResponse> {
  const payload = buildVideoPayload(request)

  try {
    const { data } = await gatewayClient.post<VideoGenerateResponse>(
      buildGatewayUrl('/v1/videos/generations'),
      payload,
      { headers: { ...bearerHeaders(request.apiKey), 'X-Save-Generation-Record': '1', ...(request.creatorTool ? { 'X-Creator-Tool': request.creatorTool } : {}) } }
    )
    return data
  } catch (error) {
    throw normalizeVideoRequestError(
      error,
      '视频生成请求失败，请确认模型已加入当前 API 密钥绑定的供应商分组'
    )
  }
}

export async function generateGrokVideo(request: GrokVideoGenerateRequest): Promise<GrokVideoGenerateResponse> {
  return generateVideo({
    ...request,
    provider: request.provider ?? 'grok'
  })
}

export async function listVideoModels(apiKey: string): Promise<string[]> {
  try {
    const { data } = await gatewayClient.get<
      { data?: Array<{ id?: string }> } | Array<{ id?: string }>
    >(buildGatewayUrl('/v1/models'), { headers: bearerHeaders(apiKey) })
    const items = Array.isArray(data) ? data : data.data
    if (!Array.isArray(items)) return []
    return Array.from(
      new Set(
        items
          .map((item) => String(item?.id || '').trim())
          .filter((model) => model && isVideoModelName(model))
      )
    )
  } catch (error) {
    throw normalizeVideoRequestError(error, '无法读取当前 API 密钥可用的视频模型')
  }
}

function providerParams(provider: GatewayVideoProvider, model?: string) {
  return cleanPayload({ provider, model })
}

export async function getVideoStatus(
  apiKey: string,
  requestId: string,
  provider: GatewayVideoProvider,
  model?: string
): Promise<VideoStatusResponse> {
  try {
    const { data } = await gatewayClient.get<VideoStatusResponse>(
      buildGatewayUrl(`/v1/videos/${encodeURIComponent(requestId)}`),
      {
        headers: bearerHeaders(apiKey),
        params: providerParams(provider, model)
      }
    )
    return data
  } catch (error) {
    throw normalizeVideoRequestError(
      error,
      '视频任务查询失败，请确认使用创建任务时返回的 request_id、原 API 密钥和原供应商'
    )
  }
}

export async function getGrokVideoStatus(
  apiKey: string,
  requestId: string,
  model: GrokCompatibleVideoModel = 'grok-imagine-video'
): Promise<GrokVideoStatusResponse> {
  return getVideoStatus(apiKey, requestId, 'grok', model)
}

export async function downloadVideoContent(
  apiKey: string,
  requestId: string,
  provider: GatewayVideoProvider,
  model?: string
): Promise<Blob> {
  try {
    const { data } = await gatewayClient.get<Blob>(
      buildGatewayUrl(`/v1/videos/${encodeURIComponent(requestId)}/content`),
      {
        headers: bearerHeaders(apiKey),
        params: providerParams(provider, model),
        responseType: 'blob'
      }
    )
    return data
  } catch (error) {
    throw normalizeVideoRequestError(
      error,
      '视频下载暂不可用，请先查询任务并使用响应中的视频地址'
    )
  }
}

export async function submitComfyPrompt(request: ComfyPromptRequest): Promise<ComfyPromptResponse> {
  const serverUrl = normalizeComfyServerUrl(request.serverUrl)
  const { data } = await axios.post<ComfyPromptResponse>(
    `${serverUrl}/prompt`,
    {
      prompt: request.workflow,
      client_id: request.clientId
    },
    {
      timeout: 120000,
      headers: {
        'Content-Type': 'application/json'
      }
    }
  )
  return data
}

export async function getComfyHistory(serverUrl: string, promptId: string): Promise<Record<string, unknown>> {
  const base = normalizeComfyServerUrl(serverUrl)
  const { data } = await axios.get<Record<string, unknown>>(`${base}/history/${encodeURIComponent(promptId)}`, {
    timeout: 30000
  })
  return data
}

export const videoGenerationAPI = {
  generateVideo,
  generateGrokVideo,
  listVideoModels,
  getVideoStatus,
  getGrokVideoStatus,
  downloadVideoContent,
  submitComfyPrompt,
  getComfyHistory
}

export default videoGenerationAPI
