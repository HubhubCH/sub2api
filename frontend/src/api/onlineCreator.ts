import { buildGatewayUrl } from './client'

export type CreatorTextMode = 'chat' | 'product-copy' | 'translate' | 'prompt-optimize'

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
  referenceImage?: File
  signal?: AbortSignal
}

export interface CreatorTextCompletionResult {
  content: string
  raw: unknown
}

const GATEWAY_TIMEOUT_MS = 60_000

function bearerHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey.trim()}`,
    'Content-Type': 'application/json',
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function isAbortError(error: unknown): boolean {
  return asRecord(error)?.name === 'AbortError'
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
  }, GATEWAY_TIMEOUT_MS)

  try {
    const response = await fetch(buildGatewayUrl(path), {
      ...init,
      signal: controller.signal,
    })
    return await handleResponse(response)
  } catch (error) {
    if (!isAbortError(error)) throw error
    if (timedOut) throw new Error('网关请求超时，请稍后重试')
    if (cancelled) throw new Error('请求已取消')
    throw new Error('网关请求已中止，请重试')
  } finally {
    globalThis.clearTimeout(timeoutId)
    callerSignal?.removeEventListener('abort', abortFromCaller)
  }
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

  const output = Array.isArray(root?.output) ? root.output : []
  for (const item of output) {
    const content = asRecord(item)?.content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      const text = String(asRecord(part)?.text || '').trim()
      if (text) return text
    }
  }

  const choices = Array.isArray(root?.choices) ? root?.choices : []
  for (const choice of choices) {
    const choiceRecord = asRecord(choice)
    const message = asRecord(choiceRecord?.message)
    const content = String(message?.content || choiceRecord?.text || '').trim()
    if (content) return content
  }

  return ''
}
function isTextModelName(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  if (!normalized) return false
  return !/(image|imagine|video|sora|audio|speech|tts|whisper|transcrib)/i.test(normalized)
}

function usesResponsesEndpoint(model: string): boolean {
  const normalized = model.trim().toLowerCase()
  return /^gpt-5(?:$|[-.])/.test(normalized) ||
    /^o(?:1|3|4)(?:$|[-.])/.test(normalized) ||
    normalized.includes('codex')
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
    'prompt-optimize': `你是专业 AI 创作提示词优化助手。保留用户原始意图；如果提供了参考图，必须以参考图为最高优先级，准确保持其主体身份、主题、构图、风格、色彩和关键元素，只补充与参考图一致的必要细节，禁止改换主题或凭空增加冲突元素。不要解释，不要添加标题，只输出一段可直接提交的${targetLanguage}提示词。`,
  }[request.mode]

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: request.prompt },
  ]
}

function fileToDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('参考图读取失败，请重新上传'))
    reader.readAsDataURL(file)
  })
}

async function buildCreatorRequestMessages(request: CreatorTextCompletionRequest): Promise<{
  chat: unknown[]
  responses: unknown[]
}> {
  const messages = buildCreatorTextMessages(request)
  if (!request.referenceImage) return { chat: messages, responses: messages }

  const imageURL = await fileToDataURL(request.referenceImage)
  const systemText = messages[0]?.content || ''
  const userText = messages[1]?.content || request.prompt
  return {
    chat: [
      { role: 'system', content: systemText },
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: imageURL } },
        ],
      },
    ],
    responses: [
      { role: 'system', content: [{ type: 'input_text', text: systemText }] },
      {
        role: 'user',
        content: [
          { type: 'input_text', text: userText },
          { type: 'input_image', image_url: imageURL },
        ],
      },
    ],
  }
}

export async function listTextModels(apiKey: string): Promise<string[]> {
  return gatewayRequest('/v1/models', {
    headers: {
      Authorization: `Bearer ${apiKey.trim()}`,
    },
  }, async (response) => {
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
  })
}

export async function createTextCompletion(request: CreatorTextCompletionRequest): Promise<CreatorTextCompletionResult> {
  const plainMessages = buildCreatorTextMessages(request)
  const messages = request.referenceImage
    ? await buildCreatorRequestMessages(request)
    : { chat: plainMessages, responses: plainMessages }
  const useResponses = usesResponsesEndpoint(request.model)
  const payload = useResponses
    ? {
        model: request.model,
        input: messages.responses,
        stream: false,
      }
    : {
        model: request.model,
        messages: messages.chat,
        temperature: 0.4,
        stream: false,
      }

  return gatewayRequest(useResponses ? '/v1/responses' : '/v1/chat/completions', {
    method: 'POST',
    headers: bearerHeaders(request.apiKey),
    body: JSON.stringify(payload),
  }, async (response) => {
    if (!response.ok) throw await parseGatewayError(response)

    const body = await response.json()
    const content = extractTextContent(body)
    if (!content) throw new Error('文本接口已返回，但没有可展示的内容')
    return { content, raw: body }
  }, request.signal)
}

export const onlineCreatorAPI = {
  listTextModels,
  createTextCompletion,
}
