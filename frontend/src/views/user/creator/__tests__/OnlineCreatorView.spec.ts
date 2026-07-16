import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const listKeys = vi.hoisted(() => vi.fn())
const listTextModels = vi.hoisted(() => vi.fn())
const listAudioModels = vi.hoisted(() => vi.fn())
const createTextCompletion = vi.hoisted(() => vi.fn())
const transcribeCreatorAudio = vi.hoisted(() => vi.fn())
const synthesizeCreatorSpeech = vi.hoisted(() => vi.fn())
const listImageModels = vi.hoisted(() => vi.fn())
const generateImage = vi.hoisted(() => vi.fn())
const editImage = vi.hoisted(() => vi.fn())
const listVideoModels = vi.hoisted(() => vi.fn())
const generateVideo = vi.hoisted(() => vi.fn())
const submitBatchImageJob = vi.hoisted(() => vi.fn())
const listBatchImageModels = vi.hoisted(() => vi.fn())
const listRecords = vi.hoisted(() => vi.fn())

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
      listAudioModels,
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
  videoGenerationAPI: {
    listVideoModels,
    generateVideo,
  },
}))

vi.mock('@/api/batchImage', () => ({
  listBatchImageModels,
  submitBatchImageJob,
}))

vi.mock('@/api/generationRecords', () => ({
  generationRecordsAPI: {
    list: listRecords,
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

describe('OnlineCreatorView', () => {
  beforeEach(() => {
    listKeys.mockReset()
    listTextModels.mockReset()
    listAudioModels.mockReset()
    createTextCompletion.mockReset()
    transcribeCreatorAudio.mockReset()
    synthesizeCreatorSpeech.mockReset()
    listImageModels.mockReset()
    generateImage.mockReset()
    editImage.mockReset()
    listVideoModels.mockReset()
    generateVideo.mockReset()
    submitBatchImageJob.mockReset()
    listBatchImageModels.mockReset()
    listRecords.mockReset()

    listKeys.mockResolvedValue({
      items: [
        { id: 1, name: '可用密钥', key: 'sk-live', status: 'active', quota: 0, quota_used: 0, expires_at: null },
        { id: 2, name: '停用密钥', key: 'sk-off', status: 'inactive', quota: 0, quota_used: 0, expires_at: null },
        { id: 3, name: '过期密钥', key: 'sk-expired', status: 'active', quota: 0, quota_used: 0, expires_at: '2026-07-01T00:00:00Z' },
      ],
    })
    listTextModels.mockResolvedValue(['gpt-4o-mini'])
    listAudioModels.mockResolvedValue(['gpt-4o-audio-preview'])
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
  })

  it('语音工具在当前密钥没有音频模型时才禁用', async () => {
    listAudioModels.mockResolvedValue([])
    const wrapper = await mountReadyView()

    await wrapper.find('[data-test="creator-tool-speech"]').trigger('click')
    expect(wrapper.find('[data-test="creator-submit-button"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('当前密钥暂无可用音频兼容模型')
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
})
