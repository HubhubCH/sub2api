import QRCode from 'qrcode'
import {
  copyPosterAndLinkToClipboard,
  copyPosterToClipboard,
  createTokenLeaderboardPoster,
  type TokenLeaderboardPosterData,
} from '@/utils/tokenLeaderboardPoster'

vi.mock('qrcode', () => ({
  default: {
    toCanvas: vi.fn(),
  },
}))

const posterData: TokenLeaderboardPosterData = {
  brand: '88TOKEN.NET',
  title: 'Token 排行榜',
  subtitle: '每日 Token 消耗榜',
  viewLabel: '实时榜单',
  myRankLabel: '我的排名',
  myRank: '#8',
  myTokensLabel: '我的 Token',
  myTokens: '12.3万 Tokens',
  rewardLabel: '预计奖励',
  reward: '+5',
  topThreeLabel: '榜单前三名',
  emptyLabel: '暂无数据',
  scanHint: '扫码查看最新榜单',
  generatedAt: '生成于 2026/07/17 20:00',
  shareUrl: 'https://88token.net/token-leaderboard',
  entries: [
    { rank: 1, user: '用户 #18', tokens: '2223.3万 Tokens', reward: '+20 积分' },
  ],
}

class ClipboardItemMock {
  readonly data: Record<string, Blob>

  constructor(data: Record<string, Blob>) {
    this.data = data
  }
}

describe('tokenLeaderboardPoster', () => {
  const writeMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { write: writeMock },
    })
    vi.stubGlobal('ClipboardItem', ClipboardItemMock)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('生成包含二维码的 PNG 海报', async () => {
    const context = {
      beginPath: vi.fn(),
      closePath: vi.fn(),
      drawImage: vi.fn(),
      fill: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      lineTo: vi.fn(),
      measureText: vi.fn((value: string) => ({ width: value.length * 12 })),
      moveTo: vi.fn(),
      quadraticCurveTo: vi.fn(),
      stroke: vi.fn(),
      fillStyle: '',
      font: '',
      lineWidth: 0,
      strokeStyle: '',
      textAlign: 'left',
    } as unknown as CanvasRenderingContext2D
    const blob = new Blob(['poster'], { type: 'image/png' })

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => callback(blob))

    await expect(createTokenLeaderboardPoster(posterData)).resolves.toBe(blob)
    expect(QRCode.toCanvas).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      posterData.shareUrl,
      expect.objectContaining({ width: 164, errorCorrectionLevel: 'M' }),
    )
    expect(context.drawImage).toHaveBeenCalled()
  })

  it('单独复制 PNG 海报', async () => {
    const poster = new Blob(['poster'], { type: 'image/png' })

    await copyPosterToClipboard(poster)

    expect(writeMock).toHaveBeenCalledTimes(1)
    const item = writeMock.mock.calls[0][0][0] as ClipboardItemMock
    expect(item.data['image/png']).toBe(poster)
    expect(item.data['text/plain']).toBeUndefined()
  })

  it('一键复制时将海报和链接写入同一个剪贴板项目', async () => {
    const poster = new Blob(['poster'], { type: 'image/png' })

    await copyPosterAndLinkToClipboard(poster, posterData.shareUrl)

    const item = writeMock.mock.calls[0][0][0] as ClipboardItemMock
    expect(item.data['image/png']).toBe(poster)
    expect(item.data['text/plain']).toBeInstanceOf(Blob)
    expect(item.data['text/plain'].type).toBe('text/plain')
  })

  it('非安全上下文不把复制操作报告为成功', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })

    await expect(copyPosterToClipboard(new Blob(['poster'], { type: 'image/png' }))).rejects.toThrow()
    expect(writeMock).not.toHaveBeenCalled()
  })
})
