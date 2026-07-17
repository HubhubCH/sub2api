import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildCreatorTextMessages,
  isUsableCreatorKey,
  onlineCreatorAPI,
} from '../onlineCreator'

const fetchMock = vi.fn()

describe('onlineCreatorAPI', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('过滤停用、过期和额度耗尽的密钥', () => {
    const now = new Date('2026-07-16T00:00:00Z')

    expect(isUsableCreatorKey({ status: 'active', expires_at: null, quota: 0, quota_used: 0 }, now)).toBe(true)
    expect(isUsableCreatorKey({ status: 'inactive', expires_at: null, quota: 0, quota_used: 0 }, now)).toBe(false)
    expect(isUsableCreatorKey({ status: 'active', expires_at: '2026-07-15T23:59:59Z', quota: 0, quota_used: 0 }, now)).toBe(false)
    expect(isUsableCreatorKey({ status: 'active', expires_at: null, quota: 10, quota_used: 10 }, now)).toBe(false)
  })

  it('按商品文案模式构造中文系统提示', () => {
    const messages = buildCreatorTextMessages({
      mode: 'product-copy',
      prompt: '蓝牙耳机，主打降噪和续航',
      targetLanguage: '中文',
    })

    expect(messages[0]).toMatchObject({
      role: 'system',
    })
    expect(messages[0].content).toContain('电商商品文案')
    expect(messages[1]).toEqual({
      role: 'user',
      content: '蓝牙耳机，主打降噪和续航',
    })
  })

  it('通过 OpenAI 兼容文本接口提交非流式请求并解析结果', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '生成好的商品标题' } }],
      }),
    })

    const result = await onlineCreatorAPI.createTextCompletion({
      apiKey: 'sk-text',
      model: 'gpt-4o-mini',
      mode: 'translate',
      prompt: 'hello',
      targetLanguage: '中文',
    })

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/v1/chat/completions'), expect.objectContaining({
      method: 'POST',
      headers: {
        Authorization: 'Bearer sk-text',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: buildCreatorTextMessages({
          mode: 'translate',
          prompt: 'hello',
          targetLanguage: '中文',
        }),
        temperature: 0.4,
        stream: false,
      }),
      signal: expect.any(AbortSignal),
    }))
    expect(result.content).toBe('生成好的商品标题')
  })

  it('gpt-5 模型通过 Responses 接口提交请求并解析 output_text', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ output_text: 'Responses 顶层文本' }),
    })

    const result = await onlineCreatorAPI.createTextCompletion({
      apiKey: 'sk-responses',
      model: 'gpt-5.6',
      mode: 'product-copy',
      prompt: '生成耳机文案',
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/v1/responses')
    expect(JSON.parse(init.body)).toEqual({
      model: 'gpt-5.6',
      input: buildCreatorTextMessages({
        mode: 'product-copy',
        prompt: '生成耳机文案',
      }),
      stream: false,
    })
    expect(result.content).toBe('Responses 顶层文本')
  })

  it.each([
    'gpt-5-codex',
    'codex-mini-latest',
    'o1-mini',
    'o3',
    'o4-mini',
  ])('%s 模型通过 Responses 接口并解析 output content 文本', async (model) => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        output: [{ content: [{ type: 'output_text', text: `${model} 返回内容` }] }],
      }),
    })

    const result = await onlineCreatorAPI.createTextCompletion({
      apiKey: 'sk-responses',
      model,
      mode: 'chat',
      prompt: '测试',
    })

    expect(fetchMock.mock.calls[0][0]).toContain('/v1/responses')
    expect(result.content).toBe(`${model} 返回内容`)
  })

  it('保留网关错误信息', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: '余额不足' } }),
    })

    await expect(onlineCreatorAPI.createTextCompletion({
      apiKey: 'sk-text',
      model: 'gpt-4o-mini',
      mode: 'chat',
      prompt: '测试',
    })).rejects.toThrow('余额不足')
  })

  it('把调用方取消信号传递到文本请求并返回中文取消信息', async () => {
    let forwardedSignal: AbortSignal | undefined
    fetchMock.mockImplementation((_url, init: RequestInit) => {
      forwardedSignal = init.signal || undefined
      return new Promise((_resolve, reject) => {
        forwardedSignal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      })
    })
    const controller = new AbortController()

    const request = onlineCreatorAPI.createTextCompletion({
      apiKey: 'sk-text',
      model: 'gpt-4o-mini',
      mode: 'chat',
      prompt: '测试取消',
      signal: controller.signal,
    })
    controller.abort()

    expect(forwardedSignal?.aborted).toBe(true)
    await expect(request).rejects.toThrow('请求已取消')
  })

  it('网关长时间无响应时返回明确的中文超时信息', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const error = new Error('aborted')
        error.name = 'AbortError'
        reject(error)
      }, { once: true })
    }))

    const request = onlineCreatorAPI.createTextCompletion({
      apiKey: 'sk-text',
      model: 'gpt-4o-mini',
      mode: 'chat',
      prompt: '测试超时',
    })
    const expectation = expect(request).rejects.toThrow('网关请求超时，请稍后重试')
    await vi.runAllTimersAsync()
    await expectation
  })
})
