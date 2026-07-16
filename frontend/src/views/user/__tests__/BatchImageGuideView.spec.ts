import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const listKeys = vi.hoisted(() => vi.fn())
const listImageModels = vi.hoisted(() => vi.fn())
const generateImage = vi.hoisted(() => vi.fn())
const editImage = vi.hoisted(() => vi.fn())
const createOutpaintFiles = vi.hoisted(() => vi.fn())
const getGenerationRecordContent = vi.hoisted(() => vi.fn())
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

vi.mock('@/api/generationRecords', () => ({
  generationRecordsAPI: {
    content: getGenerationRecordContent,
  },
}))

vi.mock('@/utils/imageOutpaint', () => ({
  createOutpaintFiles,
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
    createOutpaintFiles.mockReset()
    getGenerationRecordContent.mockReset()
    showError.mockReset()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:https://88token.net/reference-image'),
    })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })

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
    createOutpaintFiles.mockResolvedValue({
      image: new File(['expanded-image'], 'outpaint-source.png', { type: 'image/png' }),
      mask: new File(['expanded-mask'], 'outpaint-mask.png', { type: 'image/png' }),
      width: 1536,
      height: 1024,
    })
    editImage.mockResolvedValue({
      data: [{ b64_json: 'ZXhwYW5kZWQ=', output_format: 'png' }],
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

  it('does not probe an active API key whose bound group is unavailable', async () => {
    listKeys.mockResolvedValue({
      items: [
        { id: 66, name: 'Deleted group key', key: 'sk-deleted-group', group_id: 166, status: 'active' },
        {
          id: 72,
          name: 'Image key',
          key: 'sk-image',
          group_id: 172,
          status: 'active',
          group: { status: 'active', allow_image_generation: true },
        },
      ],
    })

    const wrapper = mountView()
    await flushPromises()

    const keyOptions = wrapper.findAll('#image-api-key option')
    expect(keyOptions).toHaveLength(2)
    expect(keyOptions[1]?.text()).toContain('Image key')
    expect(keyOptions.map((option) => option.text()).join(' ')).not.toContain('Deleted group key')
    expect((wrapper.find('#image-api-key').element as HTMLSelectElement).value).toBe('72')
    expect(listImageModels).toHaveBeenCalledTimes(1)
    expect(listImageModels).toHaveBeenCalledWith('sk-image')
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

  it('扩图模式会生成透明大画布和遮罩后再调用图片编辑接口', async () => {
    const wrapper = mountView()
    await flushPromises()
    const source = new File(['source'], 'source.png', { type: 'image/png' })
    const upload = wrapper.find<HTMLInputElement>('#reference-upload')
    Object.defineProperty(upload.element, 'files', { configurable: true, value: [source] })
    await upload.trigger('change')
    await wrapper.find<HTMLInputElement>('#outpaint-enabled').setValue(true)
    await wrapper.find('.prompt-input').setValue('向画面两侧延伸山谷和天空')
    await wrapper.find('.prompt-bar').trigger('submit')
    await flushPromises()

    expect(createOutpaintFiles).toHaveBeenCalledWith(source, expect.objectContaining({
      mode: 'ratio',
      ratio: '3:2',
      maxEdge: 2048,
    }))
    expect(editImage).toHaveBeenCalledWith(expect.objectContaining({
      image: expect.objectContaining({ name: 'outpaint-source.png' }),
      mask: expect.objectContaining({ name: 'outpaint-mask.png' }),
    }))
    expect(wrapper.find('.task-badge').text()).toContain('扩图')
  })

  it('Grok 图片模型也会携带扩图画布和遮罩调用编辑接口', async () => {
    listKeys.mockResolvedValue({
      items: [{ id: 2, name: 'Grok key', key: 'sk-grok', status: 'active' }],
    })
    listImageModels.mockResolvedValue(['grok-imagine-image'])
    const wrapper = mountView()
    await flushPromises()
    const source = new File(['source'], 'grok-source.png', { type: 'image/png' })
    const upload = wrapper.find<HTMLInputElement>('#reference-upload')
    Object.defineProperty(upload.element, 'files', { configurable: true, value: [source] })
    await upload.trigger('change')
    await wrapper.find<HTMLInputElement>('#outpaint-enabled').setValue(true)
    await wrapper.find('.prompt-input').setValue('向左右扩展场景')
    await wrapper.find('.prompt-bar').trigger('submit')
    await flushPromises()

    expect(editImage).toHaveBeenCalledWith(expect.objectContaining({
      model: 'grok-imagine-image',
      image: expect.objectContaining({ name: 'outpaint-source.png' }),
      mask: expect.objectContaining({ name: 'outpaint-mask.png' }),
    }))
  })

  it('扩图面板提供等比、自由和常用比例三种模式', async () => {
    const wrapper = mountView()
    await flushPromises()
    const source = new File(['source'], 'source.png', { type: 'image/png' })
    const upload = wrapper.find<HTMLInputElement>('#reference-upload')
    Object.defineProperty(upload.element, 'files', { configurable: true, value: [source] })
    await upload.trigger('change')
    await wrapper.find<HTMLInputElement>('#outpaint-enabled').setValue(true)

    expect(wrapper.findAll('input[name="outpaint-mode"]').map((item) => item.attributes('value'))).toEqual([
      'scale',
      'free',
      'ratio',
    ])
    await wrapper.find<HTMLInputElement>('input[name="outpaint-mode"][value="free"]').setValue()
    await wrapper.find<HTMLInputElement>('#outpaint-top').setValue(96)
    await wrapper.find<HTMLInputElement>('#outpaint-right').setValue(320)
    await wrapper.find<HTMLInputElement>('#outpaint-bottom').setValue(160)
    await wrapper.find<HTMLInputElement>('#outpaint-left').setValue(224)
    await wrapper.find('.prompt-input').setValue('补全扩展区域')
    await wrapper.find('.prompt-bar').trigger('submit')
    await flushPromises()

    expect(createOutpaintFiles).toHaveBeenCalledWith(source, expect.objectContaining({
      mode: 'free',
      top: 96,
      right: 320,
      bottom: 160,
      left: 224,
    }))
  })

  it('支持把图片拖入参考图区并显示拖拽反馈', async () => {
    const wrapper = mountView()
    await flushPromises()
    const source = new File(['source'], 'dragged.png', { type: 'image/png' })
    const uploadBox = wrapper.find('.upload-box')

    await uploadBox.trigger('dragenter', { dataTransfer: { files: [source] } })
    expect(uploadBox.classes()).toContain('is-dragging')

    await uploadBox.trigger('drop', { dataTransfer: { files: [source] } })
    expect(uploadBox.classes()).not.toContain('is-dragging')
    expect(wrapper.find('.upload-box img').exists()).toBe(true)
  })

  it('可以把当前生成结果直接作为扩图原图', async () => {
    const wrapper = await generateResult()

    await wrapper.find('.outpaint-result-button').trigger('click')
    await flushPromises()

    expect((wrapper.find('#outpaint-enabled').element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.find('.upload-box img').exists()).toBe(true)
    expect(wrapper.find('.task-badge').text()).toContain('已进入扩图模式')
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

  it('restores a completed server image into the main preview', async () => {
    getGenerationRecordContent.mockResolvedValue(new Blob(['stored-image'], { type: 'image/png' }))
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:stored-image') })
    const historyRecord = {
      task_id: 'gen-image-1', api_key_id: 1, media_type: 'image', provider: 'openai', model: 'gpt-image-2',
      prompt_preview: '东方城市夜景', status: 'completed', result: { files: ['0.png'], urls: [] }, created_at: '2026-07-14T12:00:00Z',
    }
    const wrapper = mount(BatchImageGuideView, {
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

    expect(getGenerationRecordContent).toHaveBeenCalledWith('gen-image-1', 0)
    expect(wrapper.find('.result-stage img').attributes('src')).toBe('blob:stored-image')
  })
})
