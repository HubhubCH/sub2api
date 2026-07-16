import { buildGatewayUrl } from './client'

export type CreatorTextMode = 'chat' | 'product-copy' | 'translate'

export interface CreatorKeyLike {
  status?: string
  expires_at?: string | null
  quota?: number
  quota_used?: number
}

export interface CreatorChatMessage {
  role: 'system' | 'user'
  content: string
}

export interface CreatorTextCompletionRequest {
  apiKey: string
  model: string
  mode: CreatorTextMode
  prompt: string
  targetLanguage?: string
}

export interface CreatorTextCompletionResult {
  content: string
  raw: unknown
}

export interface CreatorAudioTranscribeRequest {
  apiKey: string
  model: string
  file: File
  language: string
}

export interface CreatorSpeechRequest {
  apiKey: string
  model: string
  text: string
  language: string
  style: string
  voice: string
  format: 'mp3' | 'wav'
}

export interface CreatorSpeechResult {
  blob: Blob
  transcript: string
  raw: unknown
}

function bearerHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey.trim()}`,
    'Content-Type': 'application/json',
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

async function parseGatewayError(response: Response): Promise<Error> {
  try {
    const body = await response.json()
    const root = asRecord(body)
    const nestedError = asRecord(root?.error)
    const message = String(nestedError?.message || root?.message || response.statusText || '').trim()
    return new Error(message || `文本创作请求失败（HTTP ${response.status}）`)
  } catch {
    return new Error(response.statusText || `文本创作请求失败（HTTP ${response.status}）`)
  }
}

function extractTextContent(payload: unknown): string {
  const root = asRecord(payload)
  const outputText = String(root?.output_text || '').trim()
  if (outputText) return outputText

  const choices = Array.isArray(root?.choices) ? root?.choices : []
  for (const choice of choices) {
    const choiceRecord = asRecord(choice)
    const message = asRecord(choiceRecord?.message)
    const content = String(message?.content || choiceRecord?.text || '').trim()
    if (content) return content
  }

  return ''
}

function extractAudioData(payload: unknown): { data: string; transcript: string } {
  const root = asRecord(payload)
  const choices = Array.isArray(root?.choices) ? root?.choices : []
  for (const choice of choices) {
    const message = asRecord(asRecord(choice)?.message)
    const audio = asRecord(message?.audio)
    const data = String(audio?.data || '').trim()
    if (data) {
      return {
        data,
        transcript: String(audio?.transcript || message?.content || '').trim(),
      }
    }
  }
  return { data: '', transcript: '' }
}

function isTextModelName(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  if (!normalized) return false
  return !/(image|imagine|video|sora|audio|speech|tts|whisper|transcrib)/i.test(normalized)
}

function isTranscriptionModelName(model: string): boolean {
  const normalized = model.trim()
  if (/realtime|tts|speech|asr|transcribe|transcription|whisper/i.test(normalized)) return false
  return /(?:gpt.*audio|audio.*preview)/i.test(normalized)
}

function isSpeechModelName(model: string): boolean {
  const normalized = model.trim()
  if (/realtime|tts|speech|asr|transcribe|transcription|whisper/i.test(normalized)) return false
  return /(?:gpt.*audio|audio.*preview)/i.test(normalized)
}

function audioFormatForFile(file: File): 'mp3' | 'wav' {
  const name = file.name.toLowerCase()
  const type = file.type.toLowerCase()
  if (name.endsWith('.wav') || type.includes('wav')) return 'wav'
  if (name.endsWith('.mp3') || type.includes('mpeg') || type.includes('mp3')) return 'mp3'
  throw new Error('仅支持上传 WAV 或 MP3 音频文件')
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize))
  }
  return btoa(binary)
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: mimeType })
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = typeof file.arrayBuffer === 'function'
    ? await file.arrayBuffer()
    : await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.onerror = () => reject(new Error('音频文件读取失败'))
        reader.readAsArrayBuffer(file)
      })
  return bytesToBase64(new Uint8Array(buffer))
}

export function isUsableCreatorKey(key: CreatorKeyLike, now = new Date()): boolean {
  if (key.status !== 'active') return false
  if (key.expires_at && Date.parse(key.expires_at) <= now.getTime()) return false
  const quota = Number(key.quota || 0)
  const used = Number(key.quota_used || 0)
  if (quota > 0 && used >= quota) return false
  return true
}

export function buildCreatorTextMessages(request: Pick<CreatorTextCompletionRequest, 'mode' | 'prompt' | 'targetLanguage'>): CreatorChatMessage[] {
  const targetLanguage = request.targetLanguage || '中文'
  const systemPrompt = {
    chat: `你是在线创作工作台里的中文创作助手。直接给出可执行结果，避免空泛解释，输出语言为${targetLanguage}。`,
    'product-copy': `你是电商商品文案助手。根据用户素材生成标题、卖点、详情页短文案和适合闲鱼/电商发布的描述，输出语言为${targetLanguage}。`,
    translate: `你是专业翻译助手。保留原意、语气和格式，只输出${targetLanguage}译文。`,
  }[request.mode]

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: request.prompt },
  ]
}

export async function listTextModels(apiKey: string): Promise<string[]> {
  const response = await fetch(buildGatewayUrl('/v1/models'), {
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
    },
  })
  if (!response.ok) throw await parseGatewayError(response)

  const payload = await response.json()
  const root = asRecord(payload)
  const items = Array.isArray(payload) ? payload : root?.data
  if (!Array.isArray(items)) return []

  return Array.from(new Set(
    items
      .map((item) => String(asRecord(item)?.id || '').trim())
      .filter(isTextModelName)
  ))
}

async function listModelsByCapability(apiKey: string, predicate: (model: string) => boolean): Promise<string[]> {
  const response = await fetch(buildGatewayUrl('/v1/models'), {
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
    },
  })
  if (!response.ok) throw await parseGatewayError(response)

  const payload = await response.json()
  const root = asRecord(payload)
  const items = Array.isArray(payload) ? payload : root?.data
  if (!Array.isArray(items)) return []

  return Array.from(new Set(
    items
      .map((item) => String(asRecord(item)?.id || '').trim())
      .filter(predicate)
  ))
}

export function listTranscriptionModels(apiKey: string): Promise<string[]> {
  return listModelsByCapability(apiKey, isTranscriptionModelName)
}

export function listSpeechModels(apiKey: string): Promise<string[]> {
  return listModelsByCapability(apiKey, isSpeechModelName)
}

export async function createTextCompletion(request: CreatorTextCompletionRequest): Promise<CreatorTextCompletionResult> {
  const payload = {
    model: request.model,
    messages: buildCreatorTextMessages(request),
    temperature: 0.4,
    stream: false,
  }

  const response = await fetch(buildGatewayUrl('/v1/chat/completions'), {
    method: 'POST',
    headers: bearerHeaders(request.apiKey),
    body: JSON.stringify(payload),
  })

  if (!response.ok) throw await parseGatewayError(response)

  const body = await response.json()
  const content = extractTextContent(body)
  if (!content) throw new Error('文本接口已返回，但没有可展示的内容')
  return { content, raw: body }
}

export async function transcribeCreatorAudio(request: CreatorAudioTranscribeRequest): Promise<CreatorTextCompletionResult> {
  const format = audioFormatForFile(request.file)
  const data = await fileToBase64(request.file)
  const payload = {
    model: request.model,
    messages: [
      {
        role: 'system',
        content: `请转写用户上传的音频，只输出${request.language || '中文'}文本。`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_audio',
            input_audio: { data, format },
          },
        ],
      },
    ],
    temperature: 0,
    stream: false,
  }

  const response = await fetch(buildGatewayUrl('/v1/chat/completions'), {
    method: 'POST',
    headers: bearerHeaders(request.apiKey),
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw await parseGatewayError(response)

  const body = await response.json()
  const content = extractTextContent(body)
  if (!content) throw new Error('转写接口已返回，但没有可展示的文本')
  return { content, raw: body }
}

export async function synthesizeCreatorSpeech(request: CreatorSpeechRequest): Promise<CreatorSpeechResult> {
  const payload = {
    model: request.model,
    modalities: ['text', 'audio'],
    audio: {
      voice: request.voice,
      format: request.format,
    },
    messages: [
      {
        role: 'system',
        content: `请用${request.language || '中文'}生成配音，风格要求：${request.style || '自然清晰'}。`,
      },
      {
        role: 'user',
        content: request.text,
      },
    ],
    stream: false,
  }

  const response = await fetch(buildGatewayUrl('/v1/chat/completions'), {
    method: 'POST',
    headers: bearerHeaders(request.apiKey),
    body: JSON.stringify(payload),
  })
  if (!response.ok) throw await parseGatewayError(response)

  const body = await response.json()
  const audio = extractAudioData(body)
  if (!audio.data) throw new Error('配音接口已返回，但没有音频数据')
  const mimeType = request.format === 'wav' ? 'audio/wav' : 'audio/mpeg'
  return {
    blob: base64ToBlob(audio.data, mimeType),
    transcript: audio.transcript,
    raw: body,
  }
}

export const onlineCreatorAPI = {
  listTextModels,
  createTextCompletion,
  listTranscriptionModels,
  listSpeechModels,
  transcribeCreatorAudio,
  synthesizeCreatorSpeech,
}
