export interface OutpaintFiles {
  image: File
  mask: File
  width: number
  height: number
}

interface OutpaintBaseOptions {
  maxEdge?: number
}

export interface OutpaintScaleOptions extends OutpaintBaseOptions {
  mode: 'scale'
  scale: number
}

export interface OutpaintFreeOptions extends OutpaintBaseOptions {
  mode: 'free'
  top: number
  right: number
  bottom: number
  left: number
}

export interface OutpaintRatioOptions extends OutpaintBaseOptions {
  mode: 'ratio'
  ratio: string
}

export type OutpaintOptions = OutpaintScaleOptions | OutpaintFreeOptions | OutpaintRatioOptions

export interface OutpaintLayout {
  width: number
  height: number
  drawX: number
  drawY: number
  drawWidth: number
  drawHeight: number
}

function alignTo16(value: number): number {
  return Math.max(16, Math.ceil(value / 16) * 16)
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

function parseRatio(value: string): { width: number; height: number } {
  const match = /^\s*(\d+)\s*:\s*(\d+)\s*$/.exec(value)
  const width = Number(match?.[1])
  const height = Number(match?.[2])
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error('扩图比例无效')
  }
  const divisor = greatestCommonDivisor(width, height)
  return { width: width / divisor, height: height / divisor }
}

export function calculateOutpaintLayout(
  sourceWidth: number,
  sourceHeight: number,
  options: OutpaintOptions
): OutpaintLayout {
  if (sourceWidth <= 0 || sourceHeight <= 0) throw new Error('无法读取扩图原图尺寸')
  const maxEdge = alignTo16(Math.max(256, Number(options.maxEdge) || 2048))

  if (options.mode === 'ratio') {
    const ratio = parseRatio(options.ratio)
    const requiredUnit = Math.max(sourceWidth / ratio.width, sourceHeight / ratio.height) * 1.1
    const maxUnit = Math.max(16, Math.floor(maxEdge / Math.max(ratio.width, ratio.height) / 16) * 16)
    const unit = Math.min(alignTo16(requiredUnit), maxUnit)
    const width = ratio.width * unit
    const height = ratio.height * unit
    const drawScale = Math.min(1, width / sourceWidth, height / sourceHeight)
    const drawWidth = Math.max(1, Math.round(sourceWidth * drawScale))
    const drawHeight = Math.max(1, Math.round(sourceHeight * drawScale))
    return {
      width,
      height,
      drawX: Math.round((width - drawWidth) / 2),
      drawY: Math.round((height - drawHeight) / 2),
      drawWidth,
      drawHeight,
    }
  }

  if (options.mode === 'free') {
    const top = Math.max(0, Number(options.top) || 0)
    const right = Math.max(0, Number(options.right) || 0)
    const bottom = Math.max(0, Number(options.bottom) || 0)
    const left = Math.max(0, Number(options.left) || 0)
    if (top + right + bottom + left <= 0) throw new Error('自由扩展至少需要设置一个方向')
    const rawWidth = sourceWidth + left + right
    const rawHeight = sourceHeight + top + bottom
    const canvasScale = Math.min(1, maxEdge / rawWidth, maxEdge / rawHeight)
    const width = Math.min(maxEdge, alignTo16(rawWidth * canvasScale))
    const height = Math.min(maxEdge, alignTo16(rawHeight * canvasScale))
    return {
      width,
      height,
      drawX: Math.round(left * canvasScale),
      drawY: Math.round(top * canvasScale),
      drawWidth: Math.max(1, Math.round(sourceWidth * canvasScale)),
      drawHeight: Math.max(1, Math.round(sourceHeight * canvasScale)),
    }
  }

  const expansionScale = Number(options.scale) > 1 ? Number(options.scale) : 1.25
  const rawWidth = sourceWidth * expansionScale
  const rawHeight = sourceHeight * expansionScale
  const canvasScale = Math.min(1, maxEdge / rawWidth, maxEdge / rawHeight)
  const width = Math.min(maxEdge, alignTo16(rawWidth * canvasScale))
  const height = Math.min(maxEdge, alignTo16(rawHeight * canvasScale))
  const drawWidth = Math.max(1, Math.round(sourceWidth * canvasScale))
  const drawHeight = Math.max(1, Math.round(sourceHeight * canvasScale))
  return {
    width,
    height,
    drawX: Math.round((width - drawWidth) / 2),
    drawY: Math.round((height - drawHeight) / 2),
    drawWidth,
    drawHeight,
  }
}

function canvasToPngFile(canvas: HTMLCanvasElement, filename: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('扩图画布导出失败，请更换图片后重试'))
        return
      }
      resolve(new File([blob], filename, { type: 'image/png', lastModified: Date.now() }))
    }, 'image/png')
  })
}

export async function createOutpaintFiles(source: File, options: OutpaintOptions): Promise<OutpaintFiles> {
  const bitmap = await createImageBitmap(source)
  try {
    const layout = calculateOutpaintLayout(bitmap.width, bitmap.height, options)

    const imageCanvas = document.createElement('canvas')
    imageCanvas.width = layout.width
    imageCanvas.height = layout.height
    const imageContext = imageCanvas.getContext('2d')
    if (!imageContext) throw new Error('浏览器无法创建扩图画布')
    imageContext.imageSmoothingEnabled = true
    imageContext.imageSmoothingQuality = 'high'
    imageContext.drawImage(bitmap, layout.drawX, layout.drawY, layout.drawWidth, layout.drawHeight)

    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = layout.width
    maskCanvas.height = layout.height
    const maskContext = maskCanvas.getContext('2d')
    if (!maskContext) throw new Error('浏览器无法创建扩图遮罩')
    maskContext.fillStyle = '#000000'
    maskContext.fillRect(layout.drawX, layout.drawY, layout.drawWidth, layout.drawHeight)

    const [image, mask] = await Promise.all([
      canvasToPngFile(imageCanvas, 'outpaint-source.png'),
      canvasToPngFile(maskCanvas, 'outpaint-mask.png'),
    ])
    return { image, mask, width: layout.width, height: layout.height }
  } finally {
    bitmap.close()
  }
}
