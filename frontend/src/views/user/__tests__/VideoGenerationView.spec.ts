import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const listKeys = vi.hoisted(() => vi.fn())
const listVideoModels = vi.hoisted(() => vi.fn())
const generateVideo = vi.hoisted(() => vi.fn())
const getVideoStatus = vi.hoisted(() => vi.fn())
const getGenerationRecordContent = vi.hoisted(() => vi.fn())

vi.mock('@/api', () => ({
  keysAPI: {
    list: listKeys,
  },
}))

vi.mock('@/api/videoGeneration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/videoGeneration')>()
  return {
    ...actual,
    videoGenerationAPI: {
      ...actual.videoGenerationAPI,
      listVideoModels,
      generateVideo,
      getVideoStatus,
    },
  }
})

vi.mock('@/api/generationRecords', () => ({
  generationRecordsAPI: {
    content: getGenerationRecordContent,
  },
}))

import VideoGenerationView from '../VideoGenerationView.vue'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function mountReadyView() {
  const wrapper = mount(VideoGenerationView, {
    global: {
      stubs: {
        AppLayout: { template: '<div><slot /></div>' },
        Icon: true,
        GenerationHistoryPanel: true,
      },
    },
  })
  await flushPromises()
  await wrapper.find('.prompt-input').setValue('A cinematic tracking shot')
  return wrapper
}

describe('VideoGenerationView polling lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    listKeys.mockReset()
    listVideoModels.mockReset()
    generateVideo.mockReset()
    getVideoStatus.mockReset()
	getGenerationRecordContent.mockReset()

    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'Video key', key: 'sk-video-test', status: 'active' }],
    })
    listVideoModels.mockResolvedValue(['grok-imagine-video'])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ignores an old in-flight status response after a new task starts', async () => {
    const oldStatus = deferred<Record<string, unknown>>()
    generateVideo
      .mockResolvedValueOnce({ request_id: 'task-old', provider: 'grok', status: 'queued' })
      .mockResolvedValueOnce({ request_id: 'task-new', provider: 'grok', status: 'queued' })
    getVideoStatus
      .mockReturnValueOnce(oldStatus.promise)
      .mockResolvedValueOnce({ request_id: 'task-new', provider: 'grok', status: 'processing' })

    const wrapper = await mountReadyView()
    await wrapper.find('.prompt-bar').trigger('submit')
    await flushPromises()
    expect(wrapper.find('.task-id').text()).toContain('task-old')

    vi.advanceTimersByTime(5000)
    await Promise.resolve()
    expect(getVideoStatus).toHaveBeenCalledWith('sk-video-test', 'task-old', 'grok', 'grok-imagine-video')

    await wrapper.find('.prompt-bar').trigger('submit')
    await flushPromises()
    expect(wrapper.find('.task-id').text()).toContain('task-new')

    oldStatus.resolve({
      request_id: 'task-old',
      provider: 'grok',
      status: 'completed',
      url: 'https://cdn.example/old-task.mp4',
    })
    await flushPromises()

    expect(wrapper.find('.task-id').text()).toContain('task-new')
    expect(wrapper.find('.task-badge').text()).toBe('queued')
    expect(wrapper.find('.result-stage').exists()).toBe(false)

    vi.advanceTimersByTime(5000)
    await flushPromises()
    expect(getVideoStatus).toHaveBeenLastCalledWith('sk-video-test', 'task-new', 'grok', 'grok-imagine-video')
  })

  it('cancels scheduled polling when the view unmounts', async () => {
    generateVideo.mockResolvedValue({ request_id: 'task-unmount', provider: 'grok', status: 'queued' })
    const wrapper = await mountReadyView()
    await wrapper.find('.prompt-bar').trigger('submit')
    await flushPromises()

    wrapper.unmount()
    vi.advanceTimersByTime(5000)
    await flushPromises()

    expect(getVideoStatus).not.toHaveBeenCalled()
  })

  it('shows upstream progress, queue position, ETA, and elapsed wait time when available', async () => {
    generateVideo.mockResolvedValue({
      request_id: 'task-metrics',
      provider: 'grok',
      status: 'queued',
      data: {
        progress: 0.42,
        queue: { position: 3 },
        remaining_seconds: 80,
      },
    })
    const wrapper = await mountReadyView()
    await wrapper.find('.prompt-bar').trigger('submit')
    await flushPromises()

    const taskText = wrapper.find('.task-strip').text()
    expect(taskText).toContain('进度 42%')
    expect(taskText).toContain('队列位置 3')
    expect(taskText).toContain('预计剩余 1 分 20 秒')
    expect(taskText).toContain('已等待 0 秒')

    vi.advanceTimersByTime(2000)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.task-strip').text()).toContain('已等待 2 秒')
    wrapper.unmount()
  })

  it('does not show estimated progress or queue information when upstream omits it', async () => {
    generateVideo.mockResolvedValue({ request_id: 'task-no-metrics', provider: 'grok', status: 'queued' })
    const wrapper = await mountReadyView()
    await wrapper.find('.prompt-bar').trigger('submit')
    await flushPromises()

    const taskText = wrapper.find('.task-strip').text()
    expect(taskText).toContain('已等待 0 秒')
    expect(taskText).not.toContain('进度')
    expect(taskText).not.toContain('队列位置')
    expect(taskText).not.toContain('预计剩余')
    wrapper.unmount()
  })

  it('hides keys without video models and only shows engines owned by the selected key group', async () => {
    listKeys.mockResolvedValue({
      items: [
        { id: 1, name: 'Image only', key: 'sk-image', status: 'active' },
        { id: 2, name: 'Grok video', key: 'sk-grok', status: 'active' },
        { id: 3, name: 'Agnes video', key: 'sk-agnes', status: 'active' },
      ],
    })
    listVideoModels.mockImplementation(async (key: string) => ({
      'sk-image': [],
      'sk-grok': ['grok-imagine-video'],
      'sk-agnes': ['agnes-video-v2.0'],
    })[key] || [])

    const wrapper = mount(VideoGenerationView, {
      global: {
        stubs: {
          AppLayout: { template: '<div><slot /></div>' },
          Icon: true,
          GenerationHistoryPanel: true,
        },
      },
    })
    await flushPromises()

    const keyOptions = wrapper.find('#api-key-select').findAll('option').map((option) => option.text())
    expect(keyOptions.join(' ')).not.toContain('Image only')
    expect(keyOptions.join(' ')).toContain('Grok video')
    expect(keyOptions.join(' ')).toContain('Agnes video')
    expect(wrapper.find('#provider').findAll('option').map((option) => option.text())).toEqual(['Grok 兼容视频'])

    await wrapper.find('#api-key-select').setValue('3')
    await flushPromises()
    expect(wrapper.find('#provider').findAll('option').map((option) => option.text())).toEqual(['Agnes Video V2.0'])
  })

	it('restores a completed video from the server record without the original key', async () => {
		listKeys.mockResolvedValue({ items: [] })
		getGenerationRecordContent.mockResolvedValue(new Blob(['stored-video'], { type: 'video/mp4' }))
		const createObjectURL = vi.fn(() => 'blob:stored-video')
		const revokeObjectURL = vi.fn()
		Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
		Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
		const historyRecord = {
			task_id: 'gen-video-1', api_key_id: 99, media_type: 'video', provider: 'grok', model: 'grok-imagine-video',
			prompt_preview: 'waves', status: 'completed', upstream_task_id: 'upstream-1',
			result: { files: ['0.mp4'], urls: [] }, created_at: '2026-07-14T00:00:00Z',
		}
		const wrapper = mount(VideoGenerationView, {
			global: {
				stubs: {
					AppLayout: { template: '<div><slot /></div>' },
					Icon: true,
					GenerationHistoryPanel: {
						template: '<button class="restore-history" @click="$emit(\'select\', record)">恢复</button>',
						data: () => ({ record: historyRecord }),
					},
				},
			},
		})
		await flushPromises()
		await wrapper.find('.restore-history').trigger('click')
		await flushPromises()

		expect(getGenerationRecordContent).toHaveBeenCalledWith('gen-video-1', 0)
		expect(getVideoStatus).not.toHaveBeenCalled()
		expect(wrapper.find('video').attributes('src')).toBe('blob:stored-video')
		wrapper.unmount()
		expect(revokeObjectURL).toHaveBeenCalledWith('blob:stored-video')
	})
})
