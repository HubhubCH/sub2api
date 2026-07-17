import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import TokenLeaderboardShareDialog from '@/components/user/TokenLeaderboardShareDialog.vue'
import type { TokenLeaderboardData } from '@/types'

const mocks = vi.hoisted(() => ({
  copyAll: vi.fn(),
  copyPoster: vi.fn(),
  copyText: vi.fn(),
  createPoster: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: ref('zh-CN'),
    t: (key: string) => key,
  }),
}))

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({
    showError: mocks.showError,
    showSuccess: mocks.showSuccess,
  }),
}))

vi.mock('@/composables/useClipboard', () => ({
  useClipboard: () => ({ copyToClipboard: mocks.copyText }),
}))

vi.mock('@/utils/tokenLeaderboardPoster', () => ({
  copyPosterAndLinkToClipboard: mocks.copyAll,
  copyPosterToClipboard: mocks.copyPoster,
  createTokenLeaderboardPoster: mocks.createPoster,
}))

const leaderboardData = {
  current_user: {
    rank: 8,
    total_tokens: 123_000,
    reward_points: 5,
  },
  entries: [
    {
      rank: 1,
      user_id: 18,
      total_tokens: 22_233_000,
      reward_points: 20,
      is_current_user: false,
    },
  ],
} as unknown as TokenLeaderboardData

describe('TokenLeaderboardShareDialog', () => {
  const poster = new Blob(['poster'], { type: 'image/png' })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createPoster.mockResolvedValue(poster)
    mocks.copyPoster.mockResolvedValue(undefined)
    mocks.copyAll.mockResolvedValue(undefined)
    mocks.copyText.mockResolvedValue(true)
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:poster'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(URL, 'createObjectURL')
    Reflect.deleteProperty(URL, 'revokeObjectURL')
  })

  it('打开后生成海报，并分别执行三种复制动作', async () => {
    const wrapper = mount(TokenLeaderboardShareDialog, {
      props: {
        show: true,
        data: leaderboardData,
        viewMode: 'realtime',
      },
      global: {
        stubs: {
          BaseDialog: {
            props: ['show', 'title'],
            template: '<div v-if="show"><slot /></div>',
          },
          Icon: true,
        },
      },
    })
    await flushPromises()

    expect(mocks.createPoster).toHaveBeenCalledTimes(1)
    expect(wrapper.find('img').attributes('src')).toBe('blob:poster')

    const buttons = wrapper.findAll('button')
    await buttons.find((button) => button.text().includes('copyPoster'))!.trigger('click')
    await buttons.find((button) => button.text().includes('copyLink'))!.trigger('click')
    await buttons.find((button) => button.text().includes('copyAll'))!.trigger('click')
    await flushPromises()

    expect(mocks.copyPoster).toHaveBeenCalledWith(poster)
    expect(mocks.copyText).toHaveBeenCalledWith(
      'http://localhost:3000/token-leaderboard',
      'tokenLeaderboard.linkCopied',
    )
    expect(mocks.copyAll).toHaveBeenCalledWith(
      poster,
      'http://localhost:3000/token-leaderboard',
    )

    wrapper.unmount()
  })
})
