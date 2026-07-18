import { afterEach, describe, expect, it, vi } from 'vitest'

import { calculateOutpaintLayout, createOutpaintFiles } from '@/utils/imageOutpaint'

describe('扩图画布预处理', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('把原图居中放入目标尺寸，并生成同尺寸的透明 PNG 遮罩', async () => {
    const bitmap = { width: 800, height: 600, close: vi.fn() }
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap))

    const drawImage = vi.fn()
    const fillRect = vi.fn()
    const contexts = [
      { drawImage },
      { fillStyle: '', fillRect },
    ]
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => contexts.shift() as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback, type) {
      callback(new Blob([`${this.width}x${this.height}`], { type: type || 'image/png' }))
    })

    const source = new File(['source'], 'source.webp', { type: 'image/webp' })
    const result = await createOutpaintFiles(source, {
      mode: 'ratio',
      ratio: '16:9',
      maxEdge: 2048,
    })

    expect(drawImage).toHaveBeenCalledWith(bitmap, 240, 60, 800, 600)
    expect(fillRect).toHaveBeenCalledWith(240, 60, 800, 600)
    expect(result.image).toEqual(expect.objectContaining({ name: 'outpaint-source.png', type: 'image/png' }))
    expect(result.mask).toEqual(expect.objectContaining({ name: 'outpaint-mask.png', type: 'image/png' }))
    expect(result.width).toBe(1280)
    expect(result.height).toBe(720)
    expect(bitmap.close).toHaveBeenCalled()
  })

  it('支持等比扩展、自由扩展和常用比例三种画布计算', () => {
    expect(calculateOutpaintLayout(1024, 768, {
      mode: 'scale',
      scale: 1.5,
      maxEdge: 2048,
    })).toEqual(expect.objectContaining({
      width: 1536,
      height: 1152,
      drawX: 256,
      drawY: 192,
      drawWidth: 1024,
      drawHeight: 768,
    }))

    expect(calculateOutpaintLayout(1024, 768, {
      mode: 'free',
      top: 64,
      right: 320,
      bottom: 128,
      left: 160,
      maxEdge: 2048,
    })).toEqual(expect.objectContaining({
      width: 1504,
      height: 960,
      drawX: 160,
      drawY: 64,
      drawWidth: 1024,
      drawHeight: 768,
    }))

    expect(calculateOutpaintLayout(1024, 768, {
      mode: 'ratio',
      ratio: '16:9',
      maxEdge: 2048,
    })).toEqual(expect.objectContaining({
      width: 1536,
      height: 864,
      drawX: 256,
      drawY: 48,
      drawWidth: 1024,
      drawHeight: 768,
    }))

    expect(calculateOutpaintLayout(768, 1152, {
      mode: 'target',
      width: 1536,
      height: 1152,
      direction: 'right',
      expansionRatio: 1,
    })).toEqual({
      width: 1536,
      height: 1152,
      drawX: 0,
      drawY: 0,
      drawWidth: 768,
      drawHeight: 1152,
    })
  })
})
