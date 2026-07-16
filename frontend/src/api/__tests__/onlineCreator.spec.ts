import { beforeEach, describe, expect, it, vi } from 'vitest'

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

    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/v1/chat/completions'), {
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
    })
    expect(result.content).toBe('生成好的商品标题')
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

  it('筛选音频兼容模型', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: 'gpt-4o-mini' },
          { id: 'gpt-4o-audio-preview' },
          { id: 'tts-1' },
          { id: 'whisper-1' },
          { id: 'realtime-preview' },
        ],
      }),
    })

    await expect(onlineCreatorAPI.listAudioModels('sk-audio')).resolves.toEqual([
      'gpt-4o-audio-preview',
      'tts-1',
      'whisper-1',
      'realtime-preview',
    ])
  })

  it('用 input_audio content 提交音频转写请求', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '这是一段转写文本' } }],
      }),
    })
    const file = new File([new Uint8Array([1, 2, 3])], 'voice.mp3', { type: 'audio/mpeg' })

    const result = await onlineCreatorAPI.transcribeCreatorAudio({
      apiKey: 'sk-audio',
      model: 'gpt-4o-audio-preview',
      file,
      language: '中文',
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toMatchObject({
      model: 'gpt-4o-audio-preview',
      stream: false,
    })
    expect(body.messages[1].content).toEqual([
      {
        type: 'input_audio',
        input_audio: {
          data: 'AQID',
          format: 'mp3',
        },
      },
    ])
    expect(result.content).toBe('这是一段转写文本')
  })

  it('解析配音音频 base64 为 Blob', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            audio: {
              data: 'AQID',
              transcript: '试听文案',
            },
          },
        }],
      }),
    })

    const result = await onlineCreatorAPI.synthesizeCreatorSpeech({
      apiKey: 'sk-audio',
      model: 'gpt-4o-audio-preview',
      text: '生成一段配音',
      language: '中文',
      style: '自然清晰',
      voice: 'alloy',
      format: 'mp3',
    })

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toMatchObject({
      model: 'gpt-4o-audio-preview',
      modalities: ['text', 'audio'],
      audio: { voice: 'alloy', format: 'mp3' },
    })
    expect(result.transcript).toBe('试听文案')
    expect(result.blob.type).toBe('audio/mpeg')
    expect(result.blob.size).toBe(3)
  })
})
