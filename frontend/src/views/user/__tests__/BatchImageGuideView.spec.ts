import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const listKeys = vi.hoisted(() => vi.fn())
const listImageModels = vi.hoisted(() => vi.fn())
const generateImage = vi.hoisted(() => vi.fn())
const editImage = vi.hoisted(() => vi.fn())
const showError = vi.hoisted(() => vi.fn())

vi.mock('@/api', () => ({
  keysAPI: {
    list: listKeys,
  },
}))

vi.mock('@/api/imageGeneration', () => ({
  imageGenerationAPI: {
    listImageModels,
    generateImage,
    editImage,
  },
}))

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({ showError }),
}))

import BatchImageGuideView from '../BatchImageGuideView.vue'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function mountView() {
  return mount(BatchImageGuideView, {
    global: {
      stubs: {
        AppLayout: { template: '<div><slot /></div>' },
        Icon: true,
        GenerationHistoryPanel: true,
      },
    },
  })
}

async function generateResult() {
  const wrapper = mountView()
  await flushPromises()
  await wrapper.find('.prompt-input').setValue('draw a portrait')
  await wrapper.find('.prompt-bar').trigger('submit')
  await flushPromises()
  return wrapper
}

describe('BatchImageGuideView generated image presentation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    listKeys.mockReset()
    listImageModels.mockReset()
    generateImage.mockReset()
    editImage.mockReset()
    showError.mockReset()

    listKeys.mockResolvedValue({
      items: [{ id: 1, name: 'Image key', key: 'sk-image-test', status: 'active' }],
    })
    listImageModels.mockResolvedValue(['gpt-image-2'])
    generateImage.mockResolvedValue({
      data: [{
        b64_json: 'ZmluYWw=',
        output_format: 'png',
        size: '1024x1536',
      }],
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows elapsed wait time while an image request is running', async () => {
    vi.useFakeTimers()
    const pending = deferred<Record<string, unknown>>()
    generateImage.mockReturnValue(pending.promise)
    const wrapper = mountView()
    await flushPromises()
    await wrapper.find('.prompt-input').setValue('draw a portrait')
    await wrapper.find('.prompt-bar').trigger('submit')

    expect(wrapper.find('.task-strip').text()).toContain('已等待 0 秒')
    vi.advanceTimersByTime(3000)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.task-strip').text()).toContain('已等待 3 秒')

    pending.resolve({ data: [{ b64_json: 'ZmluYWw=', output_format: 'png' }] })
    await flushPromises()
    expect(wrapper.find('.task-strip').text()).not.toContain('已等待')
    wrapper.unmount()
  })

  it('uses the image natural size for the preview instead of request or response metadata', async () => {
    const wrapper = await generateResult()

    expect(generateImage).toHaveBeenCalledWith(expect.objectContaining({ size: '1536x1024' }))
    expect(wrapper.find('.result-stage').attributes('style')).toContain('aspect-ratio: 1024 / 1536')

    const image = wrapper.find<HTMLImageElement>('.result-stage img')
    Object.defineProperty(image.element, 'naturalWidth', { configurable: true, value: 1600 })
    Object.defineProperty(image.element, 'naturalHeight', { configurable: true, value: 900 })
    await image.trigger('load')

    expect(wrapper.find('.result-stage').attributes('style')).toContain('aspect-ratio: 1600 / 900')
    expect(wrapper.find('.result-stage').attributes('style')).toContain('--result-aspect: 1.777')

    await wrapper.find('#ratio').setValue('16:9')
    expect(wrapper.find('.result-stage').attributes('style')).toContain('aspect-ratio: 1600 / 900')
  })

  it('shows only image models returned for the selected API key group', async () => {
    listKeys.mockResolvedValue({
      items: [
        { id: 1, name: 'OpenAI key', key: 'sk-openai', status: 'active' },
        { id: 2, name: 'Grok key', key: 'sk-grok', status: 'active' },
      ],
    })
    listImageModels.mockImplementation(async (key: string) =>
      key === 'sk-openai' ? ['gpt-image-2', 'gpt-image-1.5'] : ['grok-imagine-image']
    )

    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.findAll('#image-model option').map((option) => option.text())).toEqual([
      'gpt-image-2',
      'gpt-image-1.5',
    ])
    expect(wrapper.find('#custom-model').exists()).toBe(false)

    await wrapper.find('#image-api-key').setValue('2')
    await flushPromises()

    expect(listImageModels).toHaveBeenLastCalledWith('sk-grok')
    expect(wrapper.findAll('#image-model option').map((option) => option.text())).toEqual([
      'grok-imagine-image',
    ])
    expect((wrapper.find('#image-model').element as HTMLSelectElement).value).toBe('grok-imagine-image')
  })

  it('opts generated images out of Edge visual search and does not advertise unsupported resolutions', async () => {
    const wrapper = await generateResult()

    expect(wrapper.find('.result-stage img').attributes('data-disable-visual-search')).toBe('true')
    await wrapper.find('#ratio').setValue('16:9')
    const labels = wrapper.findAll('#size option').map((option) => option.text()).join(' ')
    expect(labels).not.toContain('4K')
    expect(labels).not.toContain('2.5K')
  })

  it('downscales oversized custom dimensions without changing the requested aspect', async () => {
    const wrapper = mountView()
    await flushPromises()
    await wrapper.find('input[aria-label="宽度"]').setValue(3840)
    await wrapper.find('input[aria-label="高度"]').setValue(2160)
    await wrapper.find('.prompt-input').setValue('draw a landscape')
    await wrapper.find('.prompt-bar').trigger('submit')
    await flushPromises()

    expect(generateImage).toHaveBeenCalledWith(expect.objectContaining({ size: '2048x1152' }))
  })

  it('opens base64 results through a browser-safe blob URL', async () => {
    const createObjectURL = vi.fn(() => 'blob:https://88token.net/generated-image')
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const wrapper = await generateResult()

    await wrapper.find('.open-button').trigger('click')

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    expect(open).toHaveBeenCalledWith(
      'blob:https://88token.net/generated-image',
      '_blank',
      'noopener,noreferrer',
    )
    expect(open.mock.calls[0]?.[0]).not.toMatch(/^data:/)
  })
})
