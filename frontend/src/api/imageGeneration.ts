import { buildGatewayUrl } from './client'

export interface ImageGenerateRequest {
  apiKey: string
  model: string
  prompt: string
  size: string
  quality: string
  count: number
  background?: string
  outputFormat?: string
  creatorTool?: string
  signal?: AbortSignal
}

export interface ImageEditRequest extends ImageGenerateRequest {
  image: File
  mask?: File
}

export interface ImageGenerationItem {
  url?: string
  b64_json?: string
  revised_prompt?: string
  output_format?: string
  size?: string
  result?: string
  type?: string
}

export interface ImageGenerationResponse {
  created?: number
  data?: ImageGenerationItem[]
  output?: ImageGenerationItem[]
  revised_prompt?: string
  [key: string]: unknown
}

const IMAGE_GATEWAY_TIMEOUT_MS = 180_000

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

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError')
}

async function gatewayRequest<T>(
  path: string,
  init: RequestInit,
  handleResponse: (response: Response) => Promise<T>,
  callerSignal?: AbortSignal
): Promise<T> {
  const controller = new AbortController()
  let timedOut = false
  let cancelled = false
  const abortFromCaller = () => {
    cancelled = true
    controller.abort()
  }

  if (callerSignal?.aborted) abortFromCaller()
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true })

  const timeoutId = globalThis.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, IMAGE_GATEWAY_TIMEOUT_MS)

  try {
    const response = await fetch(buildGatewayUrl(path), {
      ...init,
      signal: controller.signal
    })
    return await handleResponse(response)
  } catch (error) {
    if (!isAbortError(error)) throw error
    if (timedOut) throw new Error('图片网关请求超时，请稍后重试')
    if (cancelled) throw new Error('图片请求已取消')
    throw new Error('图片网关请求已中止，请重试')
  } finally {
    globalThis.clearTimeout(timeoutId)
    callerSignal?.removeEventListener('abort', abortFromCaller)
  }
}

export function isImageModelName(model: string): boolean {
  const normalizedModel = model.trim().toLowerCase()
  return normalizedModel.startsWith('gpt-image-') ||
    normalizedModel === 'grok-imagine' ||
    normalizedModel === 'grok-imagine-edit' ||
    normalizedModel.startsWith('grok-imagine-image')
}

export async function listImageModels(apiKey: string): Promise<string[]> {
  return gatewayRequest('/v1/models', {
    headers: bearerHeaders(apiKey)
  }, async (response) => {
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      payload = null
    }

    if (!response.ok) {
      const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null
      const nestedError = body?.error && typeof body.error === 'object'
        ? body.error as Record<string, unknown>
        : null
      const message = String(nestedError?.message || body?.message || '').trim()
      throw new Error(message || `无法读取当前 API 密钥可用的图片模型（HTTP ${response.status}）`)
    }

    const body = payload && typeof payload === 'object' ? payload as { data?: unknown } : null
    const items = Array.isArray(payload) ? payload : body?.data
    if (!Array.isArray(items)) return []

    return Array.from(
      new Set(
        items
          .map((item) => item && typeof item === 'object' ? String((item as { id?: unknown }).id || '').trim() : '')
          .filter((model) => model && isImageModelName(model))
      )
    )
  })
}

interface ImageSizeParameters {
  size?: string
  aspect_ratio?: string
  resolution?: '1K' | '2K'
}

interface ImageDimensions {
  width: number
  height: number
}

const COMMON_ASPECT_RATIOS = [
  { value: '1:1', ratio: 1 },
  { value: '16:9', ratio: 16 / 9 },
  { value: '9:16', ratio: 9 / 16 },
  { value: '4:3', ratio: 4 / 3 },
  { value: '3:4', ratio: 3 / 4 },
  { value: '3:2', ratio: 3 / 2 },
  { value: '2:3', ratio: 2 / 3 },
  { value: '21:9', ratio: 21 / 9 }
] as const

function parseImageDimensions(size: string): ImageDimensions | null {
  const match = /^\s*(\d+)\s*x\s*(\d+)\s*$/i.exec(size)
  const width = Number(match?.[1])
  const height = Number(match?.[2])
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return null
  return { width, height }
}

function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y) {
    const remainder = x % y
    x = y
    y = remainder
  }
  return x || 1
}

function aspectRatioForDimensions({ width, height }: ImageDimensions): string {
  const ratio = width / height
  const common = COMMON_ASPECT_RATIOS.find((item) => Math.abs(item.ratio - ratio) < 0.005)
  if (common) return common.value
  const divisor = greatestCommonDivisor(width, height)
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`
}

function orientationSize(dimensions: ImageDimensions, landscape: string, portrait: string, square: string): string {
  const ratio = dimensions.width / dimensions.height
  if (ratio > 1.05) return landscape
  if (ratio < 0.95) return portrait
  return square
}

function imageSizeParameters(model: string, requestedSize: string): ImageSizeParameters {
  const normalizedModel = model.trim().toLowerCase()
  const dimensions = parseImageDimensions(requestedSize) || { width: 1024, height: 1024 }

  if (/^gpt-image-2(?:$|[-.])/.test(normalizedModel)) {
    return {
      aspect_ratio: aspectRatioForDimensions(dimensions),
      resolution: Math.max(dimensions.width, dimensions.height) > 1024 ? '2K' : '1K'
    }
  }

  if (/^gpt-image-(?:1(?:\.5)?|1-mini)(?:$|[-.])/.test(normalizedModel)) {
    return {
      size: orientationSize(dimensions, '1536x1024', '1024x1536', '1024x1024')
    }
  }

  if (/^dall-e-3(?:$|[-.])/.test(normalizedModel)) {
    return {
      size: orientationSize(dimensions, '1792x1024', '1024x1792', '1024x1024')
    }
  }

  return { size: requestedSize }
}

interface ImageStreamEventPayload extends ImageGenerationItem {
  created?: number
  message?: string
  error?: {
    message?: string
    code?: number | string
    type?: string
  }
  data?: ImageGenerationItem[]
  output?: ImageGenerationItem[]
}

interface ImageRequestError extends Error {
  status?: number
  code?: number | string
  response?: {
    data?: unknown
  }
}

function imageRequestError(message: string, status?: number, payload?: ImageStreamEventPayload): ImageRequestError {
  const error = new Error(message) as ImageRequestError
  error.status = status
  error.code = payload?.error?.code
  error.response = { data: payload }
  return error
}

function imageItemsFromCompletedPayload(payload: ImageStreamEventPayload): ImageGenerationItem[] {
  const nestedItems = [...(payload.data || []), ...(payload.output || [])]
  if (nestedItems.length > 0) return nestedItems
  if (payload.b64_json || payload.url || payload.result) return [payload]
  return []
}

function parseImageStreamBody(body: string): ImageGenerationResponse {
  const completedItems: ImageGenerationItem[] = []
  let created: number | undefined

  for (const block of body.split(/\r?\n\r?\n/)) {
    let eventName = ''
    const dataLines: string[] = []

    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) eventName = line.slice('event:'.length).trim()
      if (line.startsWith('data:')) dataLines.push(line.slice('data:'.length).trimStart())
    }

    const rawData = dataLines.join('\n').trim()
    if (!rawData || rawData === '[DONE]') continue

    let payload: ImageStreamEventPayload
    try {
      payload = JSON.parse(rawData) as ImageStreamEventPayload
    } catch {
      continue
    }

    const eventType = eventName || payload.type || ''
    if (eventType === 'error' || payload.error) {
      throw imageRequestError(payload.error?.message || payload.message || 'Image generation failed', undefined, payload)
    }
    if (!eventType.endsWith('.completed')) continue

    if (payload.created !== undefined) created = payload.created
    completedItems.push(...imageItemsFromCompletedPayload(payload))
  }

  if (completedItems.length === 0) {
    throw imageRequestError('Image stream completed without a final image')
  }
  return { created, data: completedItems }
}

async function parseImageResponse(response: Response): Promise<ImageGenerationResponse> {
  const contentType = response.headers.get('Content-Type')?.toLowerCase() || ''
  const body = await response.text()

  if (!response.ok) {
    let payload: ImageStreamEventPayload | undefined
    try {
      payload = JSON.parse(body) as ImageStreamEventPayload
    } catch {
      payload = undefined
    }
    throw imageRequestError(
      payload?.error?.message || payload?.message || `Image request failed with status ${response.status}`,
      response.status,
      payload
    )
  }

  if (contentType.includes('text/event-stream')) return parseImageStreamBody(body)
  try {
    return JSON.parse(body) as ImageGenerationResponse
  } catch {
    throw imageRequestError('Image endpoint returned an invalid response', response.status)
  }
}

async function streamImageRequest(
  path: string,
  apiKey: string,
  body: BodyInit,
  contentType?: string,
  signal?: AbortSignal,
  creatorTool?: string
): Promise<ImageGenerationResponse> {
  const headers: Record<string, string> = {
    ...bearerHeaders(apiKey),
    Accept: 'text/event-stream',
    'X-Save-Generation-Record': '1'
  }
  if (contentType) headers['Content-Type'] = contentType
  if (creatorTool) headers['X-Creator-Tool'] = creatorTool

  return gatewayRequest(path, {
    method: 'POST',
    headers,
    body
  }, parseImageResponse, signal)
}

export async function generateImage(request: ImageGenerateRequest): Promise<ImageGenerationResponse> {
  const payload = cleanPayload({
    model: request.model,
    prompt: request.prompt,
    ...imageSizeParameters(request.model, request.size),
    quality: request.quality,
    n: request.count,
    response_format: 'b64_json',
    stream: true,
    partial_images: 1,
    background: request.background,
    output_format: request.outputFormat
  })

  return streamImageRequest(
    '/v1/images/generations',
    request.apiKey,
    JSON.stringify(payload),
    'application/json',
    request.signal,
    request.creatorTool
  )
}

export async function editImage(request: ImageEditRequest): Promise<ImageGenerationResponse> {
  const form = new FormData()
  form.append('model', request.model)
  form.append('prompt', request.prompt)
  for (const [key, value] of Object.entries(imageSizeParameters(request.model, request.size))) {
    if (value) form.append(key, value)
  }
  form.append('quality', request.quality)
  form.append('n', String(request.count))
  form.append('response_format', 'b64_json')
  form.append('stream', 'true')
  form.append('partial_images', '1')
  if (request.background) form.append('background', request.background)
  if (request.outputFormat) form.append('output_format', request.outputFormat)
  form.append('image', request.image)
  if (request.mask) form.append('mask', request.mask)

  return streamImageRequest('/v1/images/edits', request.apiKey, form, undefined, request.signal, request.creatorTool)
}

export const imageGenerationAPI = {
  listImageModels,
  generateImage,
  editImage
}

export default imageGenerationAPI
