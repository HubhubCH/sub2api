import QRCode from 'qrcode'

export interface TokenLeaderboardPosterEntry {
  rank: number
  user: string
  tokens: string
  reward: string
}

export interface TokenLeaderboardPosterData {
  brand: string
  title: string
  subtitle: string
  viewLabel: string
  myRankLabel: string
  myRank: string
  myTokensLabel: string
  myTokens: string
  rewardLabel: string
  reward: string
  topThreeLabel: string
  emptyLabel: string
  scanHint: string
  generatedAt: string
  shareUrl: string
  entries: TokenLeaderboardPosterEntry[]
}

const POSTER_WIDTH = 900
const POSTER_HEIGHT = 1200

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string,
  stroke?: string,
): void {
  const safeRadius = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + safeRadius, y)
  context.lineTo(x + width - safeRadius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius)
  context.lineTo(x + width, y + height - safeRadius)
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height)
  context.lineTo(x + safeRadius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius)
  context.lineTo(x, y + safeRadius)
  context.quadraticCurveTo(x, y, x + safeRadius, y)
  context.closePath()
  context.fillStyle = fill
  context.fill()
  if (stroke) {
    context.strokeStyle = stroke
    context.lineWidth = 2
    context.stroke()
  }
}

function fitText(context: CanvasRenderingContext2D, value: string, maxWidth: number): string {
  if (context.measureText(value).width <= maxWidth) return value
  let result = value
  while (result.length && context.measureText(`${result}...`).width > maxWidth) {
    result = result.slice(0, -1)
  }
  return `${result}...`
}

function drawPoster(context: CanvasRenderingContext2D, data: TokenLeaderboardPosterData): void {
  context.fillStyle = '#f1f7f6'
  context.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT)
  context.fillStyle = '#0f766e'
  context.fillRect(0, 0, POSTER_WIDTH, 16)

  context.fillStyle = '#0f766e'
  context.font = '700 26px Arial, "Microsoft YaHei", sans-serif'
  context.fillText(data.brand, 64, 88)

  roundedRect(context, 64, 122, 176, 44, 22, '#ccfbf1')
  context.fillStyle = '#0f766e'
  context.font = '700 20px Arial, "Microsoft YaHei", sans-serif'
  context.fillText(fitText(context, data.viewLabel, 136), 84, 151)

  context.fillStyle = '#0f172a'
  context.font = '800 54px Arial, "Microsoft YaHei", sans-serif'
  context.fillText(fitText(context, data.title, 772), 64, 235)
  context.fillStyle = '#64748b'
  context.font = '400 23px Arial, "Microsoft YaHei", sans-serif'
  context.fillText(fitText(context, data.subtitle, 772), 64, 278)

  roundedRect(context, 64, 326, 772, 208, 18, '#ffffff', '#dbe7e5')
  context.fillStyle = '#b45309'
  context.font = '700 21px Arial, "Microsoft YaHei", sans-serif'
  context.fillText(data.myRankLabel, 94, 374)
  context.fillStyle = '#0f172a'
  context.font = '800 62px Arial, "Microsoft YaHei", sans-serif'
  context.fillText(fitText(context, data.myRank, 240), 94, 451)

  context.fillStyle = '#64748b'
  context.font = '400 19px Arial, "Microsoft YaHei", sans-serif'
  context.fillText(data.myTokensLabel, 382, 380)
  context.fillText(data.rewardLabel, 620, 380)
  context.fillStyle = '#0f172a'
  context.font = '700 25px Arial, "Microsoft YaHei", sans-serif'
  context.fillText(fitText(context, data.myTokens, 210), 382, 424)
  context.fillText(fitText(context, data.reward, 170), 620, 424)

  roundedRect(context, 64, 566, 772, 326, 18, '#ffffff', '#dbe7e5')
  context.fillStyle = '#0f172a'
  context.font = '800 28px Arial, "Microsoft YaHei", sans-serif'
  context.fillText(data.topThreeLabel, 94, 618)

  if (!data.entries.length) {
    context.fillStyle = '#94a3b8'
    context.font = '400 22px Arial, "Microsoft YaHei", sans-serif'
    context.fillText(data.emptyLabel, 94, 690)
  } else {
    data.entries.slice(0, 3).forEach((entry, index) => {
      const y = 654 + index * 72
      const rankBackground = index === 0 ? '#fef3c7' : (index === 2 ? '#d1fae5' : '#f1f5f9')
      const rankColor = index === 0 ? '#b45309' : (index === 2 ? '#047857' : '#475569')
      roundedRect(context, 94, y, 48, 48, 12, rankBackground)
      context.fillStyle = rankColor
      context.font = '800 21px Arial, "Microsoft YaHei", sans-serif'
      context.fillText(`#${entry.rank}`, 103, y + 32)

      context.fillStyle = '#0f172a'
      context.font = '700 21px Arial, "Microsoft YaHei", sans-serif'
      context.fillText(fitText(context, entry.user, 190), 166, y + 22)
      context.fillStyle = '#64748b'
      context.font = '400 17px Arial, "Microsoft YaHei", sans-serif'
      context.fillText(fitText(context, entry.tokens, 260), 166, y + 46)

      context.textAlign = 'right'
      context.fillStyle = '#ea580c'
      context.font = '700 19px Arial, "Microsoft YaHei", sans-serif'
      context.fillText(fitText(context, entry.reward, 170), 806, y + 32)
      context.textAlign = 'left'
    })
  }

  roundedRect(context, 64, 924, 772, 212, 18, '#0f766e')
  context.fillStyle = '#ffffff'
  context.font = '800 30px Arial, "Microsoft YaHei", sans-serif'
  context.fillText(data.scanHint, 94, 980)
  context.fillStyle = '#ccfbf1'
  context.font = '400 18px Arial, "Microsoft YaHei", sans-serif'
  context.fillText(fitText(context, data.shareUrl, 480), 94, 1022)
  context.fillText(data.generatedAt, 94, 1094)
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('海报图片生成失败'))
    }, 'image/png')
  })
}

export async function createTokenLeaderboardPoster(data: TokenLeaderboardPosterData): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = POSTER_WIDTH
  canvas.height = POSTER_HEIGHT
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器不支持海报生成')

  drawPoster(context, data)

  const qrCanvas = document.createElement('canvas')
  await QRCode.toCanvas(qrCanvas, data.shareUrl, {
    width: 164,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#0f172a', light: '#ffffff' },
  })
  roundedRect(context, 636, 948, 176, 176, 14, '#ffffff')
  context.drawImage(qrCanvas, 642, 954, 164, 164)

  return canvasToBlob(canvas)
}

function canWriteClipboardItems(): boolean {
  const clipboard = navigator.clipboard as Partial<Clipboard> | undefined
  return Boolean(window.isSecureContext && typeof clipboard?.write === 'function' && typeof ClipboardItem !== 'undefined')
}

export async function copyPosterToClipboard(poster: Blob): Promise<void> {
  if (!canWriteClipboardItems()) throw new Error('当前浏览器不支持复制图片')
  await navigator.clipboard.write([
    new ClipboardItem({ 'image/png': poster }),
  ])
}

export async function copyPosterAndLinkToClipboard(poster: Blob, shareUrl: string): Promise<void> {
  if (!canWriteClipboardItems()) throw new Error('当前浏览器不支持同时复制海报和链接')
  await navigator.clipboard.write([
    new ClipboardItem({
      'image/png': poster,
      'text/plain': new Blob([shareUrl], { type: 'text/plain' }),
    }),
  ])
}
