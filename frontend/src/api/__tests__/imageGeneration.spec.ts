import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { editImage, generateImage, listImageModels } from '@/api/imageGeneration'

const API_KEY = 'sk-test-image'

function streamResponse(events: string[]): Response {
  return new Response(events.join('\n\n') + '\n\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  })
}

describe('imageGeneration API streaming transport', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('streams image generation and returns the completed image', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(
      streamResponse([
        ': keepalive',
        'event: image_generation.partial_image\ndata: {"type":"image_generation.partial_image","b64_json":"cGFydGlhbA=="}',
        'event: image_generation.completed\ndata: {"type":"image_generation.completed","b64_json":"ZmluYWw=","output_format":"png","revised_prompt":"final prompt"}',
        'data: [DONE]',
      ])
    )

    const result = await generateImage({
      apiKey: API_KEY,
      model: 'gpt-image-2',
      prompt: 'draw a cat',
      size: '1280x720',
      quality: 'high',
      count: 1,
      outputFormat: 'png',
    })

    expect(result.data).toEqual([
      expect.objectContaining({
        b64_json: 'ZmluYWw=',
        output_format: 'png',
        revised_prompt: 'final prompt',
      }),
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [, init] = fetchMock.mock.calls[0]
    expect(init?.headers).toEqual(
      expect.objectContaining({
        Authorization: `Bearer ${API_KEY}`,
        Accept: 'text/event-stream',
      })
    )
    expect(JSON.parse(String(init?.body))).toEqual(
      expect.objectContaining({
        stream: true,
        partial_images: 1,
        response_format: 'b64_json',
      })
    )
  })

  it('keeps JSON responses compatible when an upstream ignores streaming', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: 'anNvbg==' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const result = await generateImage({
      apiKey: API_KEY,
      model: 'gpt-image-2',
      prompt: 'draw a cat',
      size: '1024x1024',
      quality: 'medium',
      count: 1,
    })

    expect(result.data?.[0]?.b64_json).toBe('anNvbg==')
  })

  it('loads only image endpoint models available to the selected API key', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({
        object: 'list',
        data: [
          { id: 'gpt-image-2' },
          { id: 'grok-imagine-image' },
          { id: 'gpt-5.4' },
          { id: 'grok-imagine-video' },
          { id: 'dall-e-3' },
          { id: 'gpt-image-2' }
        ]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    )

    const result = await listImageModels(API_KEY)

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/models$/)
    expect(init?.headers).toEqual(expect.objectContaining({ Authorization: `Bearer ${API_KEY}` }))
    expect(result).toEqual(['gpt-image-2', 'grok-imagine-image'])
  })

  it('maps gpt-image-2 dimensions to the upstream aspect and resolution contract', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: 'MmstaW1hZ2U=' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    await generateImage({
      apiKey: API_KEY,
      model: 'gpt-image-2',
      prompt: 'draw a landscape',
      size: '3840x2160',
      quality: 'high',
      count: 1,
    })

    const [, init] = vi.mocked(fetch).mock.calls[0]
    const body = JSON.parse(String(init?.body))
    expect(body).toEqual(
      expect.objectContaining({
        aspect_ratio: '16:9',
        resolution: '2K',
      })
    )
    expect(body).not.toHaveProperty('size')
  })

  it('normalizes legacy GPT Image sizes to a model-supported orientation', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: 'bGVnYWN5' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    await generateImage({
      apiKey: API_KEY,
      model: 'gpt-image-1.5',
      prompt: 'draw a wide landscape',
      size: '2560x1440',
      quality: 'high',
      count: 1,
    })

    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(JSON.parse(String(init?.body))).toEqual(
      expect.objectContaining({
        size: '1536x1024',
      })
    )
  })

  it('surfaces an SSE error message instead of a generic 524-style failure', async () => {
    vi.mocked(fetch).mockResolvedValue(
      streamResponse([
        'event: error\ndata: {"type":"error","error":{"message":"Image policy rejected the prompt"}}',
      ])
    )

    await expect(
      generateImage({
        apiKey: API_KEY,
        model: 'gpt-image-2',
        prompt: 'blocked prompt',
        size: '1024x1024',
        quality: 'high',
        count: 1,
      })
    ).rejects.toThrow('Image policy rejected the prompt')
  })

  it('enables streaming for image edits without changing the page contract', async () => {
    vi.mocked(fetch).mockResolvedValue(
      streamResponse([
        'event: image_edit.completed\ndata: {"type":"image_edit.completed","b64_json":"ZWRpdGVk","output_format":"webp"}',
        'data: [DONE]',
      ])
    )

    const image = new File(['image-bytes'], 'source.png', { type: 'image/png' })
    const mask = new File(['mask-bytes'], 'mask.png', { type: 'image/png' })
    const result = await editImage({
      apiKey: API_KEY,
      model: 'gpt-image-2',
      prompt: 'replace the background',
      size: '1024x1024',
      quality: 'high',
      count: 1,
      outputFormat: 'webp',
      image,
      mask,
    })

    expect(result.data?.[0]?.b64_json).toBe('ZWRpdGVk')
    const [, init] = vi.mocked(fetch).mock.calls[0]
    const body = init?.body as FormData
    expect(body.get('stream')).toBe('true')
    expect(body.get('partial_images')).toBe('1')
    expect(body.get('aspect_ratio')).toBe('1:1')
    expect(body.get('resolution')).toBe('1K')
    expect(body.get('size')).toBeNull()
    expect(body.get('image')).toBe(image)
    expect(body.get('mask')).toBe(mask)
  })
})
