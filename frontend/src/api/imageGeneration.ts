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
  inputFidelity?: string
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
const IMAGE_GENERATION_TIMEOUT_MS = 10 * 60_000

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
  callerSignal?: AbortSignal,
  timeoutMs = IMAGE_GATEWAY_TIMEOUT_MS
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
  }, timeoutMs)

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
}

interface ImageDimensions {
  width: number
  height: number
}

function parseImageDimensions(size: string): ImageDimensions | null {
  const match = /^\s*(\d+)\s*x\s*(\d+)\s*$/i.exec(size)
  const width = Number(match?.[1])
  const height = Number(match?.[2])
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return null
  return { width, height }
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
    return { size: requestedSize }
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

function isGrokImageModel(model: string): boolean {
  const normalizedModel = model.trim().toLowerCase()
  return normalizedModel === 'grok-imagine' ||
    normalizedModel === 'grok-imagine-edit' ||
    normalizedModel.startsWith('grok-imagine-image')
}

function imageMimeType(format?: string): string {
  const normalizedFormat = String(format || '').trim().toLowerCase().replace(/^image\//, '')
  if (normalizedFormat === 'jpg' || normalizedFormat === 'jpeg') return 'image/jpeg'
  if (normalizedFormat === 'webp') return 'image/webp'
  return 'image/png'
}

function imageFormatFromMimeType(mimeType: string, requestedFormat?: string): string {
  const normalizedMimeType = mimeType.trim().toLowerCase()
  if (normalizedMimeType === 'image/jpeg') {
    return String(requestedFormat || '').trim().toLowerCase() === 'jpg' ? 'jpg' : 'jpeg'
  }
  if (normalizedMimeType === 'image/webp') return 'webp'
  return 'png'
}

function base64ImageBlob(value: string, mimeType: string): Blob {
  const dataUrlMatch = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/is.exec(value.trim())
  const binary = globalThis.atob((dataUrlMatch?.[2] || value).replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: dataUrlMatch?.[1] || mimeType })
}

async function imageBlobFromItem(item: ImageGenerationItem, signal?: AbortSignal): Promise<Blob | null> {
  const encodedImage = item.b64_json || item.result
  if (encodedImage) return base64ImageBlob(encodedImage, imageMimeType(item.output_format))
  if (!item.url) return null

  if (item.url.startsWith('data:')) return base64ImageBlob(item.url, imageMimeType(item.output_format))
  const response = await fetch(item.url, { signal })
  if (!response.ok) throw new Error(`无法读取图片结果（HTTP ${response.status}）`)
  return response.blob()
}

interface DecodedImage {
  source: CanvasImageSource
  width: number
  height: number
  dispose: () => void
}

async function decodeImageBlob(blob: Blob): Promise<DecodedImage> {
  if (typeof globalThis.createImageBitmap === 'function') {
    const bitmap = await globalThis.createImageBitmap(blob)
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      dispose: () => bitmap.close()
    }
  }

  const objectUrl = URL.createObjectURL(blob)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('无法解码图片结果'))
      element.src = objectUrl
    })
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      dispose: () => URL.revokeObjectURL(objectUrl)
    }
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('浏览器无法按目标尺寸导出图片'))
    }, mimeType)
  })
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').split(',', 2)[1] || '')
    reader.onerror = () => reject(new Error('无法读取调整尺寸后的图片'))
    reader.readAsDataURL(blob)
  })
}

async function resizeImageItem(
  item: ImageGenerationItem,
  target: ImageDimensions,
  outputFormat?: string,
  signal?: AbortSignal
): Promise<ImageGenerationItem> {
  const blob = await imageBlobFromItem(item, signal)
  if (!blob) return item
  if (signal?.aborted) throw new DOMException('图片请求已取消', 'AbortError')

  const decoded = await decodeImageBlob(blob)
  try {
    if (decoded.width === target.width && decoded.height === target.height) {
      return { ...item, size: `${target.width}x${target.height}` }
    }

    const canvas = document.createElement('canvas')
    canvas.width = target.width
    canvas.height = target.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法创建图片尺寸处理画布')

    const scale = Math.max(target.width / decoded.width, target.height / decoded.height)
    const sourceWidth = target.width / scale
    const sourceHeight = target.height / scale
    const sourceX = (decoded.width - sourceWidth) / 2
    const sourceY = (decoded.height - sourceHeight) / 2
    context.drawImage(
      decoded.source,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      target.width,
      target.height
    )

    const requestedFormat = outputFormat || item.output_format
    const resizedBlob = await canvasToBlob(canvas, imageMimeType(requestedFormat))
    const resizedBase64 = await blobToBase64(resizedBlob)
    return {
      ...item,
      b64_json: resizedBase64,
      result: item.result === undefined ? undefined : resizedBase64,
      output_format: imageFormatFromMimeType(resizedBlob.type, requestedFormat),
      size: `${target.width}x${target.height}`
    }
  } finally {
    decoded.dispose()
  }
}

async function normalizeImageResponse(
  response: ImageGenerationResponse,
  request: ImageGenerateRequest
): Promise<ImageGenerationResponse> {
  const creatorTool = request.creatorTool?.trim().toLowerCase() || ''
  const needsExactCanvas = isGrokImageModel(request.model) || ['image', 'edit', 'outpaint', 'watermark', 'batch-main', 'batch-clone'].includes(creatorTool)
  if (!needsExactCanvas) return response
  const target = parseImageDimensions(request.size)
  if (!target) return response

  const normalizedResponse = { ...response }
  if (response.data) {
    normalizedResponse.data = await Promise.all(
      response.data.map((item) => resizeImageItem(item, target, request.outputFormat, request.signal))
    )
  }
  if (response.output) {
    normalizedResponse.output = await Promise.all(
      response.output.map((item) => resizeImageItem(item, target, request.outputFormat, request.signal))
    )
  }
  return normalizedResponse
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
  let payload: ImageStreamEventPayload
  try {
    payload = JSON.parse(body) as ImageStreamEventPayload
  } catch {
    throw imageRequestError('Image endpoint returned an invalid response', response.status)
  }
  if (payload.error) {
    throw imageRequestError(payload.error.message || payload.message || 'Image generation failed', response.status, payload)
  }
  return payload as ImageGenerationResponse
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
    Accept: 'application/json',
    'X-Save-Generation-Record': '1'
  }
  if (contentType) headers['Content-Type'] = contentType
  if (creatorTool) headers['X-Creator-Tool'] = creatorTool

  return gatewayRequest(path, {
    method: 'POST',
    headers,
    body
  }, parseImageResponse, signal, IMAGE_GENERATION_TIMEOUT_MS)
}

export async function generateImage(request: ImageGenerateRequest): Promise<ImageGenerationResponse> {
  const payload = cleanPayload({
    model: request.model,
    prompt: request.prompt,
    ...imageSizeParameters(request.model, request.size),
    quality: request.quality,
    n: request.count,
    response_format: 'b64_json',
    stream: false,
    background: request.background,
    output_format: request.outputFormat
  })

  const response = await streamImageRequest(
    '/v1/images/generations',
    request.apiKey,
    JSON.stringify(payload),
    'application/json',
    request.signal,
    request.creatorTool
  )
  return normalizeImageResponse(response, request)
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
  form.append('stream', 'false')
  if (request.background) form.append('background', request.background)
  if (request.outputFormat) form.append('output_format', request.outputFormat)
  if (request.inputFidelity) form.append('input_fidelity', request.inputFidelity)
  form.append('image', request.image)
  if (request.mask) form.append('mask', request.mask)

  const response = await streamImageRequest(
    '/v1/images/edits',
    request.apiKey,
    form,
    undefined,
    request.signal,
    request.creatorTool
  )
  return normalizeImageResponse(response, request)
}

export const imageGenerationAPI = {
  listImageModels,
  generateImage,
  editImage
}

export default imageGenerationAPI
