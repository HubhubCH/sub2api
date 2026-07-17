import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { GenerationRecord } from '@/api/generationRecords'

const getRecordContent = vi.hoisted(() => vi.fn())

vi.mock('@/api/generationRecords', () => ({
  generationRecordsAPI: {
    content: getRecordContent,
  },
}))

import CreatorHistoryPanel from '../CreatorHistoryPanel.vue'
import CreatorResultPanel from '../CreatorResultPanel.vue'

function createRecord(overrides: Partial<GenerationRecord> = {}): GenerationRecord {
  return {
    task_id: 'task-1',
    api_key_id: 1,
    media_type: 'image',
    provider: 'openai',
    model: 'gpt-image-2',
    prompt_preview: '夕阳下的海岸',
    status: 'completed',
    result: null,
    created_at: '2026-07-17T08:30:00Z',
    ...overrides,
  }
}

describe('创作记录组件', () => {
  beforeEach(() => {
    getRecordContent.mockReset()
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:history-preview'),
      revokeObjectURL: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('历史页展示媒体缩略图、中文状态与错误，并释放文件预览地址', async () => {
    getRecordContent.mockResolvedValue(new Blob(['image'], { type: 'image/png' }))
    const records = [
      createRecord({ task_id: 'failed-image', status: 'failed', error_message: '上游生成失败' }),
      createRecord({ task_id: 'file-image', result: { files: ['image.png'] } }),
      createRecord({
        task_id: 'url-video',
        media_type: 'video',
        status: 'running',
        result: { urls: ['https://cdn.example/video.mp4'] },
      }),
    ]
    const wrapper = mount(CreatorHistoryPanel, {
      props: { backendRecords: records, localRecords: [] },
    })

    await flushPromises()

    expect(getRecordContent).toHaveBeenCalledWith('file-image', 0)
    expect(wrapper.find('img').attributes('src')).toBe('blob:history-preview')
    expect(wrapper.find('video').attributes('src')).toBe('https://cdn.example/video.mp4')
    expect(wrapper.find('video').attributes()).toHaveProperty('controls')
    expect(wrapper.text()).toContain('生成中')
    expect(wrapper.text()).toContain('失败')
    expect(wrapper.text()).toContain('上游生成失败')

    await wrapper.find('.record-preview-button').trigger('click')
    await flushPromises()
    expect(document.body.querySelector<HTMLImageElement>('.image-preview-dialog img')?.src).toContain('blob:history-preview')

    wrapper.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:history-preview')
  })

  it('服务端视频按需加载，避免历史页并发下载完整视频', async () => {
    getRecordContent.mockResolvedValue(new Blob(['video'], { type: 'video/mp4' }))
    const wrapper = mount(CreatorHistoryPanel, {
      props: {
        backendRecords: [createRecord({ task_id: 'file-video', media_type: 'video', result: { files: ['video.mp4'] } })],
        localRecords: [],
      },
    })

    await flushPromises()
    expect(getRecordContent).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('加载视频预览')

    await wrapper.find('.load-video-preview').trigger('click')
    await flushPromises()
    expect(getRecordContent).toHaveBeenCalledWith('file-video', 0)
    expect(wrapper.find('video').attributes('src')).toBe('blob:history-preview')
    wrapper.unmount()
  })

  it('直链图片失败时只回退鉴权文件一次', async () => {
    getRecordContent.mockResolvedValue(new Blob(['broken'], { type: 'image/png' }))
    const wrapper = mount(CreatorHistoryPanel, {
      props: {
        backendRecords: [createRecord({
          task_id: 'fallback-image',
          result: { urls: ['https://cdn.example/expired.png'], files: ['fallback.png'] },
        })],
        localRecords: [],
      },
    })

    await wrapper.find('img').trigger('error')
    await flushPromises()
    expect(getRecordContent).toHaveBeenCalledTimes(1)
    expect(wrapper.find('img').attributes('src')).toBe('blob:history-preview')

    await wrapper.find('img').trigger('error')
    await flushPromises()
    expect(getRecordContent).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('预览加载失败')
    wrapper.unmount()
  })

  it('工作页只显示三条最近记录并可进入全部记录', async () => {
    const records = Array.from({ length: 4 }, (_, index) => createRecord({
      task_id: `task-${index + 1}`,
      media_type: index === 0 ? 'video' : 'image',
      status: index === 1 ? 'queued' : 'completed',
    }))
    const wrapper = mount(CreatorResultPanel, {
      props: {
        output: null,
        records,
        recordError: '',
        loading: false,
        error: '',
        status: '',
      },
    })

    expect(wrapper.findAll('.record-item')).toHaveLength(3)
    expect(wrapper.text()).toContain('最近记录')
    expect(wrapper.text()).toContain('排队中')
    expect(wrapper.text()).toContain('视频')
    expect(wrapper.text()).not.toContain('task-4')

    await wrapper.find('.view-all-button').trigger('click')
    expect(wrapper.emitted('viewAll')).toHaveLength(1)
  })

  it('创作结果图片可点击放大并下载', async () => {
    const wrapper = mount(CreatorResultPanel, {
      props: {
        output: { type: 'image', content: '完成', url: 'https://cdn.example/result.png' },
        records: [],
        recordError: '',
        loading: false,
        error: '',
        status: '图片已生成',
      },
    })

    await wrapper.find('[data-test="creator-image-preview"]').trigger('click')
    await flushPromises()
    const dialogImage = document.body.querySelector<HTMLImageElement>('.image-preview-dialog img')
    const download = document.body.querySelector<HTMLAnchorElement>('.preview-download')
    expect(dialogImage?.src).toBe('https://cdn.example/result.png')
    expect(download?.download).toBe('creator-image.png')
    wrapper.unmount()
  })
})
