import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { editImage, generateImage, listImageModels } from '@/api/imageGeneration'

const API_KEY = 'sk-test-image'

function streamResponse(events: string[]): Response {
  return new Response(events.join('\n\n') + '\n\n', {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  })
}

function stubImageCanvas(sourceWidth: number, sourceHeight: number, encodedBytes = 'resized-image') {
  const decodedImage = {
    width: sourceWidth,
    height: sourceHeight,
    close: vi.fn(),
  }
  const drawImage = vi.fn()
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({ drawImage })),
    toBlob: vi.fn((callback: BlobCallback, mimeType?: string) => {
      callback(new Blob([encodedBytes], { type: mimeType || 'image/png' }))
    }),
  }
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(decodedImage))
  vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLCanvasElement)
  return { canvas, decodedImage, drawImage }
}

describe('imageGeneration API transport', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('uses non-streaming image generation while remaining compatible with SSE responses', async () => {
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
      creatorTool: 'outpaint',
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
        Accept: 'application/json',
        'X-Creator-Tool': 'outpaint',
      })
    )
    expect(JSON.parse(String(init?.body))).toEqual(
      expect.objectContaining({
        stream: false,
        response_format: 'b64_json',
      })
    )
    expect(JSON.parse(String(init?.body))).not.toHaveProperty('partial_images')
  })

  it('parses normal JSON image responses', async () => {
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

  it('surfaces a JSON error committed as HTTP 200 after a keepalive heartbeat', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(' \n{"error":{"message":"Image policy rejected the prompt","code":"policy_rejected"}}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    await expect(generateImage({
      apiKey: API_KEY,
      model: 'gpt-image-2',
      prompt: 'blocked prompt',
      size: '1024x1024',
      quality: 'medium',
      count: 1,
    })).rejects.toThrow('Image policy rejected the prompt')
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

  it('passes exact gpt-image-2 dimensions to preserve custom and outpaint canvases', async () => {
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
        size: '3840x2160',
      })
    )
    expect(body).not.toHaveProperty('aspect_ratio')
    expect(body).not.toHaveProperty('resolution')
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

  it('resizes Grok base64 results to the requested pixel dimensions', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({
        data: [{ b64_json: 'c291cmNlLWltYWdl', output_format: 'png' }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const { canvas, decodedImage, drawImage } = stubImageCanvas(1024, 1024)

    const result = await generateImage({
      apiKey: API_KEY,
      model: 'grok-imagine-image',
      prompt: 'draw a wide landscape',
      size: '1920x1080',
      quality: 'high',
      count: 1,
      outputFormat: 'png',
    })

    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(JSON.parse(String(init?.body))).toEqual(expect.objectContaining({ size: '1920x1080' }))
    expect(canvas.width).toBe(1920)
    expect(canvas.height).toBe(1080)
    expect(drawImage).toHaveBeenCalledWith(
      decodedImage,
      0,
      224,
      1024,
      576,
      0,
      0,
      1920,
      1080
    )
    expect(decodedImage.close).toHaveBeenCalledTimes(1)
    expect(result.data?.[0]).toEqual(expect.objectContaining({
      b64_json: 'cmVzaXplZC1pbWFnZQ==',
      output_format: 'png',
      size: '1920x1080',
    }))
  })

  it('downloads and resizes Grok URL results while keeping the image response contract', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ url: 'https://images.example/result.png' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(new Blob(['source-image'], { type: 'image/png' }), { status: 200 })
      )
    const { canvas } = stubImageCanvas(1024, 1024, 'portrait-image')

    const result = await generateImage({
      apiKey: API_KEY,
      model: 'grok-imagine-image-quality',
      prompt: 'draw a portrait',
      size: '800x1200',
      quality: 'high',
      count: 1,
      outputFormat: 'webp',
    })

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe('https://images.example/result.png')
    expect(canvas.width).toBe(800)
    expect(canvas.height).toBe(1200)
    expect(result.data?.[0]).toEqual(expect.objectContaining({
      url: 'https://images.example/result.png',
      b64_json: 'cG9ydHJhaXQtaW1hZ2U=',
      output_format: 'webp',
      size: '800x1200',
    }))
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

  it('uses non-streaming high-fidelity edits and preserves the exact target size', async () => {
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
      size: '2048x3072',
      quality: 'high',
      count: 1,
      outputFormat: 'webp',
      image,
      mask,
      inputFidelity: 'high',
    })

    expect(result.data?.[0]?.b64_json).toBe('ZWRpdGVk')
    const [, init] = vi.mocked(fetch).mock.calls[0]
    const body = init?.body as FormData
    expect(body.get('stream')).toBe('false')
    expect(body.get('partial_images')).toBeNull()
    expect(body.get('size')).toBe('2048x3072')
    expect(body.get('aspect_ratio')).toBeNull()
    expect(body.get('resolution')).toBeNull()
    expect(body.get('input_fidelity')).toBe('high')
    expect(body.get('image')).toBe(image)
    expect(body.get('mask')).toBe(mask)
  })

  it('图片生成请求支持调用方取消信号', async () => {
    let forwardedSignal: AbortSignal | undefined
    vi.mocked(fetch).mockImplementation((_url, init) => {
      forwardedSignal = init?.signal || undefined
      return new Promise((_resolve, reject) => {
        forwardedSignal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      })
    })
    const controller = new AbortController()

    const request = generateImage({
      apiKey: API_KEY,
      model: 'gpt-image-2',
      prompt: 'draw a cat',
      size: '1024x1024',
      quality: 'high',
      count: 1,
      signal: controller.signal,
    })
    controller.abort()

    expect(forwardedSignal?.aborted).toBe(true)
    await expect(request).rejects.toThrow('图片请求已取消')
  })

  it('图片编辑请求支持调用方取消信号', async () => {
    let forwardedSignal: AbortSignal | undefined
    vi.mocked(fetch).mockImplementation((_url, init) => {
      forwardedSignal = init?.signal || undefined
      return new Promise((_resolve, reject) => {
        forwardedSignal?.addEventListener('abort', () => {
          const error = new Error('aborted')
          error.name = 'AbortError'
          reject(error)
        }, { once: true })
      })
    })
    const controller = new AbortController()

    const request = editImage({
      apiKey: API_KEY,
      model: 'gpt-image-2',
      prompt: 'replace the background',
      size: '1024x1024',
      quality: 'high',
      count: 1,
      image: new File(['image-bytes'], 'source.png', { type: 'image/png' }),
      signal: controller.signal,
    })
    controller.abort()

    expect(forwardedSignal?.aborted).toBe(true)
    await expect(request).rejects.toThrow('图片请求已取消')
  })
})
