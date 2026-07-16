import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const listKeys = vi.hoisted(() => vi.fn())
const listTextModels = vi.hoisted(() => vi.fn())
const listTranscriptionModels = vi.hoisted(() => vi.fn())
const listSpeechModels = vi.hoisted(() => vi.fn())
const createTextCompletion = vi.hoisted(() => vi.fn())
const transcribeCreatorAudio = vi.hoisted(() => vi.fn())
const synthesizeCreatorSpeech = vi.hoisted(() => vi.fn())
const listImageModels = vi.hoisted(() => vi.fn())
const generateImage = vi.hoisted(() => vi.fn())
const editImage = vi.hoisted(() => vi.fn())
const listVideoModels = vi.hoisted(() => vi.fn())
const generateVideo = vi.hoisted(() => vi.fn())
const getVideoStatus = vi.hoisted(() => vi.fn())
const downloadVideoContent = vi.hoisted(() => vi.fn())
const submitBatchImageJob = vi.hoisted(() => vi.fn())
const listBatchImageModels = vi.hoisted(() => vi.fn())
const getBatchImageJob = vi.hoisted(() => vi.fn())
const listBatchImageItems = vi.hoisted(() => vi.fn())
const getBatchImageItemContent = vi.hoisted(() => vi.fn())
const downloadBatchImageZip = vi.hoisted(() => vi.fn())
const saveBlob = vi.hoisted(() => vi.fn())
const listRecords = vi.hoisted(() => vi.fn())
const getRecordContent = vi.hoisted(() => vi.fn())

vi.mock('@/api', () => ({
  keysAPI: {
    list: listKeys,
  },
}))

vi.mock('@/api/onlineCreator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/onlineCreator')>()
  return {
    ...actual,
    onlineCreatorAPI: {
      ...actual.onlineCreatorAPI,
      listTextModels,
      listTranscriptionModels,
      listSpeechModels,
      createTextCompletion,
      transcribeCreatorAudio,
      synthesizeCreatorSpeech,
    },
  }
})

vi.mock('@/api/imageGeneration', () => ({
  imageGenerationAPI: {
    listImageModels,
    generateImage,
    editImage,
  },
}))

vi.mock('@/api/videoGeneration', () => ({
  AGNES_VIDEO_MODEL: 'agnes-video-v2.0',
  videoGenerationAPI: {
    listVideoModels,
    generateVideo,
    getVideoStatus,
    downloadVideoContent,
  },
}))

vi.mock('@/api/batchImage', () => ({
  listBatchImageModels,
  submitBatchImageJob,
  getBatchImageJob,
  listBatchImageItems,
  getBatchImageItemContent,
  downloadBatchImageZip,
  saveBlob,
}))

vi.mock('@/api/generationRecords', () => ({
  generationRecordsAPI: {
    list: listRecords,
    content: getRecordContent,
  },
}))

import OnlineCreatorView from '../OnlineCreatorView.vue'

async function mountReadyView() {
  const wrapper = mount(OnlineCreatorView, {
    global: {
      stubs: {
        AppLayout: { template: '<div><slot /></div>' },
        Icon: true,
      },
    },
  })
  await flushPromises()
  return wrapper
}

async function setInputFiles(wrapper: ReturnType<typeof mount>, selector: string, files: File[]) {
  const input = wrapper.find(selector).element as HTMLInputElement
  const fileList = Object.assign(files, {
    item: (index: number) => files[index] || null,
  })
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: fileList,
  })
  input.dispatchEvent(new Event('change', { bubbles: true }))
  await wrapper.vm.$nextTick()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

function installCanvasImageMocks() {
  const drawImage = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as never)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (callback) {
    callback(new Blob([new Uint8Array([7, 8, 9])], { type: 'image/png' }))
  })
  vi.stubGlobal('Image', class {
    onload: null | (() => void) = null
    onerror: null | (() => void) = null
    naturalWidth = 100
    naturalHeight = 100
    width = 100
    height = 100
    set src(_value: string) {
      queueMicrotask(() => this.onload?.())
    }
  })
  return drawImage
}

describe('OnlineCreatorView', () => {
  beforeEach(() => {
    listKeys.mockReset()
    listTextModels.mockReset()
    listTranscriptionModels.mockReset()
    listSpeechModels.mockReset()
    createTextCompletion.mockReset()
    transcribeCreatorAudio.mockReset()
    synthesizeCreatorSpeech.mockReset()
    listImageModels.mockReset()
    generateImage.mockReset()
    editImage.mockReset()
    listVideoModels.mockReset()
    generateVideo.mockReset()
    getVideoStatus.mockReset()
    downloadVideoContent.mockReset()
    submitBatchImageJob.mockReset()
    listBatchImageModels.mockReset()
    getBatchImageJob.mockReset()
    listBatchImageItems.mockReset()
    getBatchImageItemContent.mockReset()
    downloadBatchImageZip.mockReset()
    saveBlob.mockReset()
    listRecords.mockReset()
    getRecordContent.mockReset()

    listKeys.mockResolvedValue({
      items: [
        { id: 1, name: '可用密钥', key: 'sk-live', status: 'active', quota: 0, quota_used: 0, expires_at: null },
        { id: 2, name: '停用密钥', key: 'sk-off', status: 'inactive', quota: 0, quota_used: 0, expires_at: null },
        { id: 3, name: '过期密钥', key: 'sk-expired', status: 'active', quota: 0, quota_used: 0, expires_at: '2026-07-01T00:00:00Z' },
      ],
    })
    listTextModels.mockResolvedValue(['gpt-4o-mini'])
    listTranscriptionModels.mockResolvedValue(['gpt-4o-audio-preview'])
    listSpeechModels.mockResolvedValue(['gpt-4o-audio-preview'])
    listImageModels.mockResolvedValue(['gpt-image-1'])
    listVideoModels.mockResolvedValue(['grok-imagine-video'])
    listBatchImageModels.mockResolvedValue({ data: [{ id: 'gemini-2.5-flash-image', provider: 'gemini_api' }] })
    listRecords.mockResolvedValue([
      {
        task_id: 'record-image-1',
        api_key_id: 1,
        media_type: 'image',
        provider: 'openai',
        model: 'gpt-image-1',
        prompt_preview: '最近的主图',
        status: 'completed',
        result: { urls: ['https://cdn.example/image.png'] },
        created_at: '2026-07-16T00:00:00Z',
      },
    ])
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('显示完整工具导航、首页矩阵并过滤不可用密钥', async () => {
    const wrapper = await mountReadyView()

    for (const id of ['home', 'image', 'edit', 'assistant', 'product-copy', 'image-translate', 'batch-main', 'batch-clone', 'watermark', 'video', 'transcription', 'speech', 'history']) {
      expect(wrapper.find(`[data-test="creator-tool-${id}"]`).exists()).toBe(true)
    }
    expect(wrapper.find('[data-test="creator-tool-home"]').classes()).toContain('active')
    expect(wrapper.text()).toContain('工具矩阵')
    expect(wrapper.text()).toContain('最近创作')

    await wrapper.find('[data-test="creator-tool-image"]').trigger('click')
    expect(wrapper.find('[data-test="creator-tool-image"]').classes()).toContain('active')

    const keyText = wrapper.find('[data-test="creator-key"]').text()
    expect(keyText).toContain('可用密钥')
    expect(keyText).not.toContain('停用密钥')
    expect(keyText).not.toContain('过期密钥')
  })

  it('提交文本工具请求并展示结果', async () => {
    createTextCompletion.mockResolvedValue({ content: '一段可直接使用的中文文案' })
    const wrapper = await mountReadyView()

    await wrapper.find('[data-test="creator-tool-assistant"]').trigger('click')
    await wrapper.find('[data-test="creator-prompt"]').setValue('写一个耳机商品标题')
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await flushPromises()

    expect(createTextCompletion).toHaveBeenCalledWith({
      apiKey: 'sk-live',
      model: 'gpt-4o-mini',
      mode: 'chat',
      prompt: '用户：写一个耳机商品标题',
      targetLanguage: '中文',
    })
    expect(wrapper.text()).toContain('一段可直接使用的中文文案')
    expect(wrapper.text()).toContain('写一个耳机商品标题')
  })

  it('商品文案使用商品名、商品信息、平台和语言字段', async () => {
    createTextCompletion.mockResolvedValue({ content: '闲鱼商品文案' })
    const wrapper = await mountReadyView()

    await wrapper.find('[data-test="creator-tool-product-copy"]').trigger('click')
    const inputs = wrapper.findAll('input.field-control')
    await inputs[0].setValue('蓝牙耳机')
    await wrapper.find('textarea.field-control').setValue('九成新，主动降噪，续航 30 小时')
    await wrapper.find('[data-test="creator-prompt"]').setValue('语气真实，不夸张')
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await flushPromises()

    expect(createTextCompletion.mock.calls[0][0]).toMatchObject({
      mode: 'product-copy',
      targetLanguage: '中文',
    })
    expect(createTextCompletion.mock.calls[0][0].prompt).toContain('商品名：蓝牙耳机')
    expect(createTextCompletion.mock.calls[0][0].prompt).toContain('目标平台：闲鱼')
    expect(wrapper.text()).toContain('闲鱼商品文案')
  })

  it('按图片工具提交真实图片生成载荷', async () => {
    generateImage.mockResolvedValue({
      data: [{ b64_json: 'aW1hZ2U=', revised_prompt: '修订提示词' }],
    })
    const wrapper = await mountReadyView()

    await wrapper.find('[data-test="creator-tool-image"]').trigger('click')
    await wrapper.find('[data-test="creator-prompt"]').setValue('白底产品主图')
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await flushPromises()

    expect(generateImage).toHaveBeenCalledWith({
      apiKey: 'sk-live',
      model: 'gpt-image-1',
      prompt: '白底产品主图',
      size: '1024x1024',
      quality: 'high',
      count: 1,
      outputFormat: 'png',
    })
    expect(wrapper.find('img[alt="创作结果"]').attributes('src')).toContain('data:image/png;base64,aW1hZ2U=')
  })

  it('图片翻译上传原图后调用 editImage 并保留构图风格提示', async () => {
    editImage.mockResolvedValue({ data: [{ b64_json: 'aW1hZ2U=' }] })
    const wrapper = await mountReadyView()
    const file = new File([new Uint8Array([1])], 'poster.png', { type: 'image/png' })

    await wrapper.find('[data-test="creator-tool-image-translate"]').trigger('click')
    await setInputFiles(wrapper, '#creator-image-file', [file])
    await wrapper.find('[data-test="creator-prompt"]').setValue('翻译成适合日本市场的表达')
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await flushPromises()

    expect(editImage.mock.calls[0][0]).toMatchObject({
      apiKey: 'sk-live',
      model: 'gpt-image-1',
      image: file,
    })
    expect(editImage.mock.calls[0][0].prompt).toContain('保留原图构图、风格')
    expect(editImage.mock.calls[0][0].prompt).toContain('本地化为中文')
  })

  it('批量主图界面最多接收 6 张商品图', async () => {
    submitBatchImageJob.mockResolvedValue({ id: 'batch-1', status: 'queued', item_count: 6 })
    const wrapper = await mountReadyView()
    const files = Array.from({ length: 7 }, (_, index) => new File([new Uint8Array([index + 1])], `sku-${index}.png`, { type: 'image/png' }))

    await wrapper.find('[data-test="creator-tool-batch-main"]').trigger('click')
    await flushPromises()
    await setInputFiles(wrapper, '#creator-batch-files', files)
    expect(wrapper.text()).toContain('已选择 6 张商品图')
  })

  it('批量克隆提供参考图和商品图入口', async () => {
    submitBatchImageJob.mockResolvedValue({ id: 'batch-clone-1', status: 'queued', item_count: 1 })
    const wrapper = await mountReadyView()
    const reference = new File([new Uint8Array([9])], 'ref.png', { type: 'image/png' })
    const product = new File([new Uint8Array([1])], 'sku.png', { type: 'image/png' })

    await wrapper.find('[data-test="creator-tool-batch-clone"]').trigger('click')
    await flushPromises()
    await setInputFiles(wrapper, '#creator-reference-file', [reference])
    await setInputFiles(wrapper, '#creator-batch-files', [product])
    expect(wrapper.text()).toContain('ref.png')
    expect(wrapper.text()).toContain('已选择 1 张商品图')
  })

  it('批量克隆仅在端点明确不支持时用参考图和商品图合成后逐张兜底', async () => {
    const drawImage = installCanvasImageMocks()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:input') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    submitBatchImageJob.mockRejectedValue(Object.assign(new Error('reference_images is not supported'), { status: 422 }))
    editImage.mockResolvedValue({ data: [{ b64_json: 'ZmFsbGJhY2s=' }] })
    const wrapper = await mountReadyView()
    const reference = new File([new Uint8Array([9])], 'ref.png', { type: 'image/png' })
    const product = new File([new Uint8Array([1])], 'sku.png', { type: 'image/png' })

    await wrapper.find('[data-test="creator-tool-batch-clone"]').trigger('click')
    await setInputFiles(wrapper, '#creator-reference-file', [reference])
    await setInputFiles(wrapper, '#creator-batch-files', [product])
    await wrapper.find('[data-test="creator-prompt"]').setValue('保持参考图构图')
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await vi.waitFor(() => expect(editImage).toHaveBeenCalledTimes(1))

    expect(editImage.mock.calls[0][0].image).toBeInstanceOf(File)
    expect(editImage.mock.calls[0][0].image).not.toBe(product)
    expect(editImage.mock.calls[0][0].image.name).toContain('clone-composite')
    expect(drawImage).toHaveBeenCalledTimes(2)
    expect(wrapper.findAll('[data-test="creator-batch-image"]')).toHaveLength(1)
    expect(wrapper.text()).toContain('第 1 张：成功')
  })

  it('批量克隆遇到认证、网络或服务端错误时不重复调用图片编辑', async () => {
    submitBatchImageJob.mockRejectedValue(Object.assign(new Error('上游服务不可用'), { status: 500 }))
    const wrapper = await mountReadyView()
    const reference = new File([new Uint8Array([9])], 'ref.png', { type: 'image/png' })
    const product = new File([new Uint8Array([1])], 'sku.png', { type: 'image/png' })

    await wrapper.find('[data-test="creator-tool-batch-clone"]').trigger('click')
    await setInputFiles(wrapper, '#creator-reference-file', [reference])
    await setInputFiles(wrapper, '#creator-batch-files', [product])
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await vi.waitFor(() => expect(wrapper.text()).toContain('上游服务不可用'))

    expect(editImage).not.toHaveBeenCalled()
  })

  it('批量任务轮询到终态后展示逐项状态、图片和下载入口', async () => {
    vi.useFakeTimers()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:batch-result') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    submitBatchImageJob.mockResolvedValue({ id: 'batch-poll', status: 'queued', item_count: 1 })
    getBatchImageJob.mockResolvedValue({ id: 'batch-poll', status: 'completed', item_count: 1, success_count: 1, fail_count: 0 })
    listBatchImageItems.mockResolvedValue({
      data: [{ custom_id: 'creator-item-1', status: 'completed', image_count: 1, mime_type: 'image/png', file_extension: 'png' }],
    })
    getBatchImageItemContent.mockResolvedValue(new Blob([new Uint8Array([1])], { type: 'image/png' }))
    const wrapper = await mountReadyView()
    const product = new File([new Uint8Array([1])], 'sku.png', { type: 'image/png' })

    await wrapper.find('[data-test="creator-tool-batch-main"]').trigger('click')
    await setInputFiles(wrapper, '#creator-batch-files', [product])
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await vi.waitFor(() => expect(submitBatchImageJob).toHaveBeenCalledTimes(1))
    expect(wrapper.find('[data-test="creator-download-batch"]').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()

    expect(getBatchImageJob).toHaveBeenCalledWith('sk-live', 'batch-poll')
    expect(listBatchImageItems).toHaveBeenCalledWith('sk-live', 'batch-poll')
    expect(getBatchImageItemContent).toHaveBeenCalledWith('sk-live', 'batch-poll', 'creator-item-1', 0)
    expect(wrapper.find('[data-test="creator-batch-image"]').attributes('src')).toBe('blob:batch-result')
    expect(wrapper.find('[data-test="creator-download-batch"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('批量图片仍在 base64 预处理时卸载不会提交收费任务', async () => {
    const pendingBuffer = deferred<ArrayBuffer>()
    submitBatchImageJob.mockResolvedValue({ id: 'batch-stale-preprocess', status: 'queued', item_count: 1 })
    const wrapper = await mountReadyView()
    const product = new File([new Uint8Array([1])], 'stale.png', { type: 'image/png' })
    Object.defineProperty(product, 'arrayBuffer', { configurable: true, value: vi.fn(() => pendingBuffer.promise) })

    await wrapper.find('[data-test="creator-tool-batch-main"]').trigger('click')
    await setInputFiles(wrapper, '#creator-batch-files', [product])
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await Promise.resolve()
    wrapper.unmount()
    pendingBuffer.resolve(new Uint8Array([1]).buffer)
    await flushPromises()

    expect(submitBatchImageJob).not.toHaveBeenCalled()
    expect(editImage).not.toHaveBeenCalled()
  })

  it('批量提交返回 unsupported 前卸载不会继续逐张收费兜底', async () => {
    installCanvasImageMocks()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:stale-clone') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    const pendingSubmit = deferred<never>()
    submitBatchImageJob.mockReturnValue(pendingSubmit.promise)
    const wrapper = await mountReadyView()
    const reference = new File([new Uint8Array([9])], 'ref.png', { type: 'image/png' })
    const product = new File([new Uint8Array([1])], 'sku.png', { type: 'image/png' })
    Object.defineProperty(reference, 'arrayBuffer', { configurable: true, value: vi.fn(async () => new Uint8Array([9]).buffer) })
    Object.defineProperty(product, 'arrayBuffer', { configurable: true, value: vi.fn(async () => new Uint8Array([1]).buffer) })

    await wrapper.find('[data-test="creator-tool-batch-clone"]').trigger('click')
    await setInputFiles(wrapper, '#creator-reference-file', [reference])
    await setInputFiles(wrapper, '#creator-batch-files', [product])
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await vi.waitFor(() => expect(submitBatchImageJob).toHaveBeenCalledTimes(1))
    wrapper.unmount()
    pendingSubmit.reject(Object.assign(new Error('reference_images is not supported'), { status: 422 }))
    await flushPromises()

    expect(editImage).not.toHaveBeenCalled()
  })

  it('去除水印走图片编辑，添加水印走 Canvas', async () => {
    editImage.mockResolvedValue({ data: [{ b64_json: 'cmVtb3ZlZA==' }] })
    const wrapper = await mountReadyView()
    const file = new File([new Uint8Array([1])], 'watermark.png', { type: 'image/png' })

    await wrapper.find('[data-test="creator-tool-watermark"]').trigger('click')
    await setInputFiles(wrapper, '#creator-image-file', [file])
    await wrapper.find('[data-test="creator-prompt"]').setValue('右下角')
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await flushPromises()

    expect(editImage.mock.calls[0][0].prompt).toContain('去除图片中的水印')
  })

  it('展示失败状态并保留生成记录', async () => {
    createTextCompletion.mockRejectedValue(new Error('模型不可用'))
    const wrapper = await mountReadyView()

    await wrapper.find('[data-test="creator-tool-assistant"]').trigger('click')
    await wrapper.find('[data-test="creator-prompt"]').setValue('测试失败')
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('模型不可用')
    expect(listRecords).toHaveBeenCalledWith(8)
    expect(wrapper.text()).toContain('最近的主图')
    expect(wrapper.findAll('.message-row')).toHaveLength(0)
  })

  it('请求期间禁用工具、密钥和模型切换', async () => {
    const pending = deferred<{ content: string }>()
    createTextCompletion.mockReturnValue(pending.promise)
    const wrapper = await mountReadyView()

    await wrapper.find('[data-test="creator-tool-assistant"]').trigger('click')
    await wrapper.find('[data-test="creator-prompt"]').setValue('等待中的请求')
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await Promise.resolve()

    expect(wrapper.find('[data-test="creator-tool-image"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-test="creator-key"] select').attributes('disabled')).toBeDefined()
    expect(wrapper.find('select.field-control').attributes('disabled')).toBeDefined()
    pending.resolve({ content: '完成' })
    await flushPromises()
  })

  it('按 Agnes 模型推断供应商并轮询视频结果到可播放下载状态', async () => {
    vi.useFakeTimers()
    listVideoModels.mockResolvedValue(['agnes-video-v2.0'])
    generateVideo.mockResolvedValue({ request_id: 'video-agnes', status: 'queued' })
    getVideoStatus.mockResolvedValue({
      request_id: 'video-agnes',
      status: 'completed',
      video: { url: 'https://cdn.example/agnes.mp4' },
    })
    const wrapper = await mountReadyView()

    await wrapper.find('[data-test="creator-tool-video"]').trigger('click')
    await wrapper.find('[data-test="creator-prompt"]').setValue('商品旋转展示')
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await flushPromises()
    expect(generateVideo.mock.calls[0][0]).toMatchObject({ provider: 'agnes', model: 'agnes-video-v2.0' })

    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()
    expect(getVideoStatus).toHaveBeenCalledWith('sk-live', 'video-agnes', 'agnes', 'agnes-video-v2.0')
    expect(wrapper.find('video').attributes('src')).toBe('https://cdn.example/agnes.mp4')
    expect(wrapper.find('[data-test="creator-download-video"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('视频 done 视为成功终态且不再继续轮询', async () => {
    vi.useFakeTimers()
    listVideoModels.mockResolvedValue(['agnes-video-v2.0'])
    generateVideo.mockResolvedValue({ request_id: 'video-done', status: 'queued' })
    getVideoStatus.mockResolvedValue({
      request_id: 'video-done',
      status: 'done',
      video: { url: 'https://cdn.example/video-done.mp4' },
    })
    const wrapper = await mountReadyView()

    await wrapper.find('[data-test="creator-tool-video"]').trigger('click')
    await wrapper.find('[data-test="creator-prompt"]').setValue('done 终态视频')
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()

    expect(wrapper.find('video').attributes('src')).toBe('https://cdn.example/video-done.mp4')
    expect(wrapper.text()).toContain('视频已生成')
    await vi.advanceTimersByTimeAsync(5000)
    expect(getVideoStatus).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('视频 expired 视为失败终态且不再继续轮询', async () => {
    vi.useFakeTimers()
    generateVideo.mockResolvedValue({ request_id: 'video-expired', status: 'queued' })
    getVideoStatus.mockResolvedValue({ request_id: 'video-expired', status: 'expired' })
    const wrapper = await mountReadyView()

    await wrapper.find('[data-test="creator-tool-video"]').trigger('click')
    await wrapper.find('[data-test="creator-prompt"]').setValue('过期视频任务')
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()

    expect(wrapper.find('.result-error').exists()).toBe(true)
    await vi.advanceTimersByTimeAsync(5000)
    expect(getVideoStatus).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('视频 queued 连续查询 60 次后停止轮询', async () => {
    vi.useFakeTimers()
    generateVideo.mockResolvedValue({ request_id: 'video-timeout', status: 'queued' })
    getVideoStatus.mockResolvedValue({ request_id: 'video-timeout', status: 'queued' })
    const wrapper = await mountReadyView()

    await wrapper.find('[data-test="creator-tool-video"]').trigger('click')
    await wrapper.find('[data-test="creator-prompt"]').setValue('持续排队的视频')
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await flushPromises()
    for (let index = 0; index < 60; index += 1) {
      await vi.advanceTimersByTimeAsync(5000)
      await flushPromises()
    }

    expect(getVideoStatus).toHaveBeenCalledTimes(60)
    expect(wrapper.find('.result-error').exists()).toBe(true)
    await vi.advanceTimersByTimeAsync(5000)
    expect(getVideoStatus).toHaveBeenCalledTimes(60)
    wrapper.unmount()
  })

  it('视频下载通过鉴权内容接口获取 Blob 并调用保存方法', async () => {
    listVideoModels.mockResolvedValue(['agnes-video-v2.0'])
    generateVideo.mockResolvedValue({
      request_id: 'video-download',
      status: 'completed',
    })
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' })
    downloadVideoContent.mockResolvedValue(blob)
    const wrapper = await mountReadyView()

    await wrapper.find('[data-test="creator-tool-video"]').trigger('click')
    await wrapper.find('[data-test="creator-prompt"]').setValue('下载测试视频')
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await flushPromises()
    await wrapper.find('[data-test="creator-download-video"]').trigger('click')
    await flushPromises()

    expect(downloadVideoContent).toHaveBeenCalledWith(
      'sk-live',
      'video-download',
      'agnes',
      'agnes-video-v2.0',
    )
    expect(saveBlob).toHaveBeenCalledWith(blob, expect.stringMatching(/\.mp4$/))
  })

  it('视频状态首次瞬时查询失败后有限重试并最终成功', async () => {
    vi.useFakeTimers()
    listVideoModels.mockResolvedValue(['agnes-video-v2.0'])
    generateVideo.mockResolvedValue({ request_id: 'video-retry', status: 'queued' })
    getVideoStatus
      .mockRejectedValueOnce(new Error('临时网络错误'))
      .mockResolvedValueOnce({
        request_id: 'video-retry',
        status: 'completed',
        video: { url: 'https://cdn.example/video-retry.mp4' },
      })
    const wrapper = await mountReadyView()

    await wrapper.find('[data-test="creator-tool-video"]').trigger('click')
    await wrapper.find('[data-test="creator-prompt"]').setValue('允许瞬时错误重试')
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await flushPromises()
    await vi.runAllTimersAsync()
    await flushPromises()

    expect(getVideoStatus).toHaveBeenCalledTimes(2)
    expect(getVideoStatus).toHaveBeenNthCalledWith(2, 'sk-live', 'video-retry', 'agnes', 'agnes-video-v2.0')
    expect(wrapper.find('video').attributes('src')).toBe('https://cdn.example/video-retry.mp4')
    expect(wrapper.text()).not.toContain('临时网络错误')
    wrapper.unmount()
  })

  it('切换工具或卸载时取消视频轮询', async () => {
    vi.useFakeTimers()
    generateVideo.mockResolvedValue({ request_id: 'video-pending', status: 'queued' })
    const wrapper = await mountReadyView()

    await wrapper.find('[data-test="creator-tool-video"]').trigger('click')
    await wrapper.find('[data-test="creator-prompt"]').setValue('等待中的视频')
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await flushPromises()
    await wrapper.find('[data-test="creator-tool-image"]').trigger('click')
    await vi.advanceTimersByTimeAsync(5000)
    expect(getVideoStatus).not.toHaveBeenCalled()

    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(5000)
    expect(getVideoStatus).not.toHaveBeenCalled()
  })

  it('从 files 记录读取 Blob 并在切换时释放历史预览 URL', async () => {
    const createObjectURL = vi.fn(() => 'blob:history-image')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    listRecords.mockResolvedValue([{
      task_id: 'record-file-1', api_key_id: 1, media_type: 'image', provider: 'openai', model: 'gpt-image-1',
      prompt_preview: '服务端文件', status: 'completed', result: { files: ['history.png'] }, created_at: '2026-07-16T00:00:00Z',
    }])
    getRecordContent.mockResolvedValue(new Blob([new Uint8Array([1])], { type: 'image/png' }))
    const wrapper = await mountReadyView()

    await wrapper.find('button.record-item').trigger('click')
    await flushPromises()
    expect(getRecordContent).toHaveBeenCalledWith('record-file-1', 0)
    expect(wrapper.find('img[alt="创作结果"]').attributes('src')).toBe('blob:history-image')
    await wrapper.find('[data-test="creator-tool-image"]').trigger('click')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:history-image')
  })

  it('恢复记录失败前切换工具时不写入旧请求错误', async () => {
    listRecords.mockResolvedValue([{
      task_id: 'record-stale-error', api_key_id: 1, media_type: 'image', provider: 'openai', model: 'gpt-image-1',
      prompt_preview: '稍后失败的记录', status: 'completed', result: { files: ['stale.png'] }, created_at: '2026-07-16T00:00:00Z',
    }])
    let rejectContent!: (error: unknown) => void
    getRecordContent.mockReturnValue(new Promise((_resolve, reject) => {
      rejectContent = reject
    }))
    const wrapper = await mountReadyView()

    await wrapper.find('button.record-item').trigger('click')
    expect(getRecordContent).toHaveBeenCalledWith('record-stale-error', 0)
    await wrapper.find('[data-test="creator-tool-image"]').trigger('click')
    rejectContent(new Error('旧记录读取失败'))
    await flushPromises()

    expect(wrapper.find('[data-test="creator-tool-image"]').classes()).toContain('active')
    expect(wrapper.text()).not.toContain('旧记录读取失败')
  })

  it('语音工具按转写和配音能力分别启用', async () => {
    listSpeechModels.mockResolvedValue([])
    const wrapper = await mountReadyView()

    await wrapper.find('[data-test="creator-tool-speech"]').trigger('click')
    expect(wrapper.find('[data-test="creator-submit-button"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('当前密钥暂无可用配音模型')

    await wrapper.find('[data-test="creator-tool-transcription"]').trigger('click')
    expect(wrapper.text()).not.toContain('当前密钥暂无可用转写模型')
  })

  it('模型加载失败时显示原因并可重试恢复模型列表', async () => {
    listImageModels.mockRejectedValue(new Error('图片模型加载失败，请重试'))
    const wrapper = await mountReadyView()

    await wrapper.find('[data-test="creator-tool-image"]').trigger('click')
    expect(wrapper.text()).toContain('图片模型加载失败，请重试')
    expect(wrapper.find('[data-test="creator-retry-models"]').exists()).toBe(true)

    listImageModels.mockResolvedValue(['gpt-image-1'])
    await wrapper.find('[data-test="creator-retry-models"]').trigger('click')
    await flushPromises()

    expect(listImageModels).toHaveBeenCalledTimes(2)
    const modelSelect = wrapper.findAll('select.field-control').find((select) =>
      Array.from((select.element as HTMLSelectElement).options).some((option) => option.value === 'gpt-image-1'))
    expect((modelSelect?.element as HTMLSelectElement | undefined)?.value).toBe('gpt-image-1')
    expect(wrapper.text()).not.toContain('图片模型加载失败，请重试')
  })

  it('提交 WAV/MP3 音频转写并展示复制按钮', async () => {
    transcribeCreatorAudio.mockResolvedValue({ content: '转写后的文本' })
    const wrapper = await mountReadyView()

    await wrapper.find('[data-test="creator-tool-transcription"]').trigger('click')
    const file = new File([new Uint8Array([1, 2, 3])], 'voice.wav', { type: 'audio/wav' })
    await setInputFiles(wrapper, '[data-test="creator-audio-file"]', [file])
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await flushPromises()

    expect(transcribeCreatorAudio).toHaveBeenCalledWith({
      apiKey: 'sk-live',
      model: 'gpt-4o-audio-preview',
      file,
      language: '中文',
    })
    expect(wrapper.text()).toContain('转写后的文本')
    expect(wrapper.find('[data-test="creator-copy-result"]').exists()).toBe(true)
  })

  it('提交 AI 配音并生成可播放音频', async () => {
    synthesizeCreatorSpeech.mockResolvedValue({
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }),
      transcript: '配音稿',
    })
    const createObjectURL = vi.fn(() => 'blob:voiceover')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })

    const wrapper = await mountReadyView()
    await wrapper.find('[data-test="creator-tool-speech"]').trigger('click')
    await wrapper.find('[data-test="creator-prompt"]').setValue('生成一段商品介绍配音')
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await flushPromises()

    expect(synthesizeCreatorSpeech).toHaveBeenCalledWith({
      apiKey: 'sk-live',
      model: 'gpt-4o-audio-preview',
      text: '生成一段商品介绍配音',
      language: '中文',
      style: '自然清晰',
      voice: 'alloy',
      format: 'mp3',
    })
    expect(wrapper.find('audio').attributes('src')).toBe('blob:voiceover')
    wrapper.unmount()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:voiceover')
  })

  it('配音请求在页面卸载后返回时不再创建 Blob URL', async () => {
    const pending = deferred<{ blob: Blob; transcript: string }>()
    synthesizeCreatorSpeech.mockReturnValue(pending.promise)
    const createObjectURL = vi.fn(() => 'blob:stale-voiceover')
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    const wrapper = await mountReadyView()

    await wrapper.find('[data-test="creator-tool-speech"]').trigger('click')
    await wrapper.find('[data-test="creator-prompt"]').setValue('卸载后的配音')
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    wrapper.unmount()
    pending.resolve({
      blob: new Blob([new Uint8Array([1])], { type: 'audio/mpeg' }),
      transcript: '不应展示',
    })
    await flushPromises()

    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('本地音频历史保存各自 Blob，恢复旧记录不会指向最新音频', async () => {
    const firstBlob = new Blob([new Uint8Array([1])], { type: 'audio/mpeg' })
    const secondBlob = new Blob([new Uint8Array([2])], { type: 'audio/mpeg' })
    synthesizeCreatorSpeech
      .mockResolvedValueOnce({ blob: firstBlob, transcript: '第一段' })
      .mockResolvedValueOnce({ blob: secondBlob, transcript: '第二段' })
    let firstCount = 0
    const createObjectURL = vi.fn((blob: Blob) => {
      if (blob === firstBlob) return `blob:first-${++firstCount}`
      return 'blob:second-1'
    })
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    const wrapper = await mountReadyView()

    await wrapper.find('[data-test="creator-tool-speech"]').trigger('click')
    await wrapper.find('[data-test="creator-prompt"]').setValue('第一段文案')
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await flushPromises()
    await wrapper.find('[data-test="creator-prompt"]').setValue('第二段文案')
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await flushPromises()
    await wrapper.find('[data-test="creator-tool-history"]').trigger('click')
    const firstRecord = wrapper.findAll('button.history-row').find((item) => item.text().includes('第一段文案'))
    expect(firstRecord).toBeDefined()
    await firstRecord!.trigger('click')
    await flushPromises()

    expect(wrapper.find('audio').attributes('src')).toBe('blob:first-2')
  })
})
