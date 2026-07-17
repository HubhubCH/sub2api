import { beforeEach, describe, expect, it, vi } from 'vitest'

const { gatewayGet, gatewayPost } = vi.hoisted(() => ({
  gatewayGet: vi.fn(),
  gatewayPost: vi.fn()
}))

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      get: gatewayGet,
      post: gatewayPost
    })),
    get: vi.fn(),
    post: vi.fn()
  }
}))

import {
  downloadVideoContent,
  generateVideo,
  getVideoStatus,
  listVideoModels,
  normalizeAgnesFrameCount,
  parseVideoSize,
  videoAspectRatioForDimensions,
  videoGenerationModeForReference,
  videoQualityForDimensions,
  videoModelsForProvider
} from '@/api/videoGeneration'

const API_KEY = ' sk-test-video '

describe('videoGeneration gateway contract', () => {
  beforeEach(() => {
    gatewayGet.mockReset()
    gatewayPost.mockReset()
  })

  it.each(['grok-imagine-video', 'sora-2', 'sora-2-pro'] as const)(
    'submits Grok-compatible model %s with canonical video fields',
    async (model) => {
      gatewayPost.mockResolvedValue({
        data: { request_id: 'relay-request-1', provider: 'grok', status: 'queued' }
      })

      await generateVideo({
        apiKey: API_KEY,
        provider: 'grok',
        model,
        prompt: 'cinematic waves',
        duration: 10,
        aspectRatio: '16:9',
        width: 1280,
        height: 720,
        imageUrl: 'https://example.com/first.png',
        referenceImage: 'https://example.com/reference.png',
        creatorTool: 'video'
      })

      const [url, payload, config] = gatewayPost.mock.calls[0]
      expect(String(url)).toMatch(/\/v1\/videos\/generations$/)
      expect(payload).toEqual({
        provider: 'grok',
        model,
        prompt: 'cinematic waves',
        duration: 10,
        aspect_ratio: '16:9',
        resolution: '720p',
        image: { url: 'https://example.com/first.png' },
        reference_images: [{ url: 'https://example.com/reference.png' }]
      })
      expect(payload).not.toHaveProperty('size')
      expect(config.headers.Authorization).toBe('Bearer sk-test-video')
      expect(config.headers['X-Creator-Tool']).toBe('video')
    }
  )

  it('maps Agnes seconds to 24fps frames and sends only Agnes generation fields', async () => {
    gatewayPost.mockResolvedValue({
      data: { request_id: 'site-request-1', provider: 'agnes', status: 'queued' }
    })

    await generateVideo({
      apiKey: API_KEY,
      provider: 'agnes',
      model: 'agnes-video-v2.0',
      prompt: 'slow tracking shot',
      duration: 6,
      aspectRatio: '3:2',
      size: '1152x768',
      quality: '1080p',
      mode: 'image-to-video',
      referenceImage: 'data:image/png;base64,AAAA'
    })

    const [, payload] = gatewayPost.mock.calls[0]
    expect(payload).toEqual({
      provider: 'agnes',
      model: 'agnes-video-v2.0',
      prompt: 'slow tracking shot',
      image: 'data:image/png;base64,AAAA',
      width: 1620,
      height: 1080,
      num_frames: 145,
      frame_rate: 24
    })
    expect(payload).not.toHaveProperty('duration')
    expect(payload).not.toHaveProperty('aspect_ratio')
    expect(payload).not.toHaveProperty('quality')
    expect(payload).not.toHaveProperty('resolution')
    expect(payload).not.toHaveProperty('size')
    expect(payload).not.toHaveProperty('mode')
  })

  it.each([
    { quality: '480p', size: '1280x720', width: 854, height: 480 },
    { quality: '720p', size: '720x1280', width: 720, height: 1280 },
    { quality: '1080p', size: '720x720', width: 1080, height: 1080 }
  ] as const)(
    'maps Agnes $quality and $size to effective $width x $height dimensions',
    async ({ quality, size, width, height }) => {
      gatewayPost.mockResolvedValue({ data: { request_id: 'site-quality-request' } })

      await generateVideo({
        apiKey: API_KEY,
        provider: 'agnes',
        model: 'agnes-video-v2.0',
        prompt: 'quality-sensitive video',
        size,
        quality
      })

      const [, payload] = gatewayPost.mock.calls[0]
      expect(payload).toMatchObject({ width, height })
      expect(payload).not.toHaveProperty('quality')
      expect(payload).not.toHaveProperty('resolution')
    }
  )

  it('keeps explicit Agnes dimensions when no quality is selected', async () => {
    gatewayPost.mockResolvedValue({ data: { request_id: 'site-explicit-size-request' } })

    await generateVideo({
      apiKey: API_KEY,
      provider: 'agnes',
      model: 'agnes-video-v2.0',
      prompt: 'explicit dimensions',
      width: 1000,
      height: 600
    })

    const [, payload] = gatewayPost.mock.calls[0]
    expect(payload).toMatchObject({ width: 1000, height: 600 })
  })

  it('maps a Grok custom size and quality without sending unsupported dimension fields', async () => {
    gatewayPost.mockResolvedValue({
      data: { request_id: 'relay-request-2', provider: 'grok', status: 'queued' }
    })

    await generateVideo({
      apiKey: API_KEY,
      provider: 'grok',
      model: 'grok-imagine-video',
      prompt: 'vertical city walk',
      size: '1080×1920',
      quality: '1080p',
      referenceImage: ' https://example.com/reference.png '
    })

    const [, payload] = gatewayPost.mock.calls[0]
    expect(payload).toEqual({
      provider: 'grok',
      model: 'grok-imagine-video',
      prompt: 'vertical city walk',
      aspect_ratio: '9:16',
      resolution: '1080p',
      image: { url: 'https://example.com/reference.png' }
    })
    expect(payload).not.toHaveProperty('size')
    expect(payload).not.toHaveProperty('width')
    expect(payload).not.toHaveProperty('height')
    expect(payload).not.toHaveProperty('quality')
  })

  it('omits image fields for text-to-video requests', async () => {
    gatewayPost.mockResolvedValue({
      data: { request_id: 'relay-request-3', provider: 'grok', status: 'queued' }
    })

    await generateVideo({
      apiKey: API_KEY,
      provider: 'grok',
      model: 'grok-imagine-video',
      prompt: 'clouds moving over a mountain',
      size: '1280x720',
      referenceImage: '   '
    })

    const [, payload] = gatewayPost.mock.calls[0]
    expect(payload).not.toHaveProperty('image')
    expect(payload).not.toHaveProperty('images')
    expect(payload).not.toHaveProperty('reference_images')
    expect(payload).toMatchObject({ aspect_ratio: '16:9', resolution: '720p' })
  })

  it('exposes stable helpers for page size, quality and generation mode controls', () => {
    expect(parseVideoSize(' 1920 × 1080 ')).toEqual({ width: 1920, height: 1080 })
    expect(parseVideoSize('auto')).toBeNull()
    expect(videoAspectRatioForDimensions({ width: 1280, height: 720 })).toBe('16:9')
    expect(videoQualityForDimensions({ width: 1280, height: 720 })).toBe('720p')
    expect(videoGenerationModeForReference()).toBe('text-to-video')
    expect(videoGenerationModeForReference('data:image/png;base64,AAAA')).toBe('image-to-video')
  })

  it('keeps Agnes frames within the 8n+1 and 441-frame limits', () => {
    expect(normalizeAgnesFrameCount(6)).toBe(145)
    expect(normalizeAgnesFrameCount(30)).toBe(441)
    expect(normalizeAgnesFrameCount(0)).toBe(145)

    for (const seconds of [1, 3, 5, 10, 18, 60]) {
      const frames = normalizeAgnesFrameCount(seconds)
      expect(frames).toBeLessThanOrEqual(441)
      expect((frames - 1) % 8).toBe(0)
    }
  })

  it('polls with the site request_id plus the original provider and model', async () => {
    gatewayGet.mockResolvedValue({
      data: {
        request_id: 'video/request 1',
        provider: 'agnes',
        status: 'completed',
        video: { url: 'https://cdn.example/video.mp4', duration: 10, width: 1280, height: 768 },
        seconds: '10.0',
        size: '1280x768'
      }
    })

    const result = await getVideoStatus(
      API_KEY,
      'video/request 1',
      'agnes',
      'agnes-video-v2.0'
    )

    const [url, config] = gatewayGet.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/videos\/video%2Frequest%201$/)
    expect(config.params).toEqual({ provider: 'agnes', model: 'agnes-video-v2.0' })
    expect(config.headers.Authorization).toBe('Bearer sk-test-video')
    expect(result.video).toEqual(
      expect.objectContaining({ url: 'https://cdn.example/video.mp4', duration: 10 })
    )
    expect(result.size).toBe('1280x768')
  })

  it('uses the optional same-site content route only as a download fallback', async () => {
    const blob = new Blob(['video'], { type: 'video/mp4' })
    gatewayGet.mockResolvedValue({ data: blob })

    const result = await downloadVideoContent(
      API_KEY,
      'relay-request-1',
      'grok',
      'sora-2'
    )

    const [url, config] = gatewayGet.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/videos\/relay-request-1\/content$/)
    expect(config.params).toEqual({ provider: 'grok', model: 'sora-2' })
    expect(config.responseType).toBe('blob')
    expect(result).toBe(blob)
  })

  it('loads only video and Sora models from the selected key model list', async () => {
    gatewayGet.mockResolvedValue({
      data: {
        object: 'list',
        data: [
          { id: 'grok-imagine-video' },
          { id: 'sora-2' },
          { id: 'agnes-video-v2.0' },
          { id: 'grok-4' },
          { id: 'grok-imagine-image' },
          { id: '' }
        ]
      }
    })

    const result = await listVideoModels(API_KEY)

    const [url, config] = gatewayGet.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/models$/)
    expect(config.headers.Authorization).toBe('Bearer sk-test-video')
    expect(result).toEqual(['grok-imagine-video', 'sora-2', 'agnes-video-v2.0'])
  })

  it('keeps discovered models inside their actual video provider', () => {
    const models = ['grok-imagine-video', 'sora-2', 'agnes-video-v2.0', 'gpt-5.4']

    expect(videoModelsForProvider(models, 'grok')).toEqual(['grok-imagine-video', 'sora-2'])
    expect(videoModelsForProvider(models, 'agnes')).toEqual(['agnes-video-v2.0'])
  })

  it('surfaces the backend error message instead of a generic Axios 404', async () => {
    gatewayPost.mockRejectedValue({
      response: {
        status: 404,
        data: { error: { message: 'agnes-video-v2.0 is not enabled for this group' } }
      }
    })

    await expect(
      generateVideo({
        apiKey: API_KEY,
        provider: 'agnes',
        model: 'agnes-video-v2.0',
        prompt: 'waves',
        duration: 5,
        width: 1152,
        height: 768
      })
    ).rejects.toThrow('agnes-video-v2.0 is not enabled for this group')
  })
})
