import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const listKeys = vi.hoisted(() => vi.fn())
const getUserGroupRates = vi.hoisted(() => vi.fn())
const listTextModels = vi.hoisted(() => vi.fn())
const createTextCompletion = vi.hoisted(() => vi.fn())
const listImageModels = vi.hoisted(() => vi.fn())
const generateImage = vi.hoisted(() => vi.fn())
const editImage = vi.hoisted(() => vi.fn())
const listVideoModels = vi.hoisted(() => vi.fn())
const generateVideo = vi.hoisted(() => vi.fn())
const getVideoStatus = vi.hoisted(() => vi.fn())
const downloadVideoContent = vi.hoisted(() => vi.fn())
const submitBatchImageJob = vi.hoisted(() => vi.fn())
const listBatchImageModels = vi.hoisted(() => vi.fn())
const listBatchImageJobs = vi.hoisted(() => vi.fn())
const getBatchImageJob = vi.hoisted(() => vi.fn())
const listBatchImageItems = vi.hoisted(() => vi.fn())
const getBatchImageItemContent = vi.hoisted(() => vi.fn())
const downloadBatchImageZip = vi.hoisted(() => vi.fn())
const deleteBatchImageJobRecord = vi.hoisted(() => vi.fn())
const saveBlob = vi.hoisted(() => vi.fn())
const listRecords = vi.hoisted(() => vi.fn())
const getRecordContent = vi.hoisted(() => vi.fn())
const deleteGenerationRecord = vi.hoisted(() => vi.fn())

vi.mock('@/api', () => ({
  keysAPI: {
    list: listKeys,
  },
}))

vi.mock('@/api/groups', () => ({
  userGroupsAPI: {
    getUserGroupRates,
  },
}))

vi.mock('@/api/onlineCreator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/onlineCreator')>()
  return {
    ...actual,
    onlineCreatorAPI: {
      ...actual.onlineCreatorAPI,
      listTextModels,
      createTextCompletion,
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
  listBatchImageJobs,
  submitBatchImageJob,
  getBatchImageJob,
  listBatchImageItems,
  getBatchImageItemContent,
  downloadBatchImageZip,
  deleteBatchImageJobRecord,
  saveBlob,
}))

vi.mock('@/api/generationRecords', () => ({
  generationRecordsAPI: {
    list: listRecords,
    content: getRecordContent,
    delete: deleteGenerationRecord,
  },
}))

import OnlineCreatorView from '../OnlineCreatorView.vue'
import {
  creatorBatchAPIKeys,
  creatorBatchPollTimers,
  creatorBatchRecordContexts,
  creatorTaskStates,
  creatorVideoPollTimers,
  creatorVideoTasks,
  estimateCreatorDuration,
  recordCreatorDuration,
} from '@/composables/useCreatorRuntime'

async function mountReadyView(initialTool?: string) {
  const wrapper = mount(OnlineCreatorView, {
    props: { initialTool },
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

function batchJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'batch-history-1',
    object: 'image.batch',
    task_name: 'batch-clone-1784250000000',
    status: 'completed',
    model: 'gemini-2.5-flash-image',
    provider: 'gemini_api',
    item_count: 2,
    success_count: 2,
    fail_count: 0,
    estimated_cost: 0.1,
    hold_amount: 0.1,
    actual_cost: 0.1,
    created_at: Math.floor(Date.now() / 1000) - 60,
    submitted_at: Math.floor(Date.now() / 1000) - 59,
    settled_at: Math.floor(Date.now() / 1000) - 50,
    ...overrides,
  }
}

function installCanvasImageMocks() {
  const drawImage = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
    fillStyle: '#000000',
  } as never)
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
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 100, height: 100, close: vi.fn() }))
  return drawImage
}

function resetCreatorRuntime() {
  for (const timer of creatorVideoPollTimers.values()) window.clearTimeout(timer)
  for (const timer of creatorBatchPollTimers.values()) window.clearTimeout(timer)
  creatorVideoPollTimers.clear()
  creatorBatchPollTimers.clear()
  creatorBatchAPIKeys.clear()
  creatorBatchRecordContexts.clear()
  creatorVideoTasks.clear()
  for (const state of Object.values(creatorTaskStates)) {
    state.controller?.abort()
    state.output = null
    state.loading = false
    state.running = false
    state.status = ''
    state.error = ''
    state.version = 0
    state.controller = null
    state.startedAt = 0
    state.estimateSeconds = 0
    state.timingKey = ''
  }
}

describe('OnlineCreatorView', () => {
  beforeEach(() => {
    resetCreatorRuntime()
    localStorage.clear()
    listKeys.mockReset()
    getUserGroupRates.mockReset()
    listTextModels.mockReset()
    createTextCompletion.mockReset()
    listImageModels.mockReset()
    generateImage.mockReset()
    editImage.mockReset()
    listVideoModels.mockReset()
    generateVideo.mockReset()
    getVideoStatus.mockReset()
    downloadVideoContent.mockReset()
    submitBatchImageJob.mockReset()
    listBatchImageModels.mockReset()
    listBatchImageJobs.mockReset()
    getBatchImageJob.mockReset()
    listBatchImageItems.mockReset()
    getBatchImageItemContent.mockReset()
    downloadBatchImageZip.mockReset()
    deleteBatchImageJobRecord.mockReset()
    saveBlob.mockReset()
    listRecords.mockReset()
    getRecordContent.mockReset()
    deleteGenerationRecord.mockReset()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((file: File) => `blob:${file.name || 'preview'}`) })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })

    listKeys.mockResolvedValue({
      items: [
        { id: 1, name: '可用密钥', key: 'sk-live', status: 'active', quota: 0, quota_used: 0, expires_at: null },
        { id: 2, name: '停用密钥', key: 'sk-off', status: 'inactive', quota: 0, quota_used: 0, expires_at: null },
        { id: 3, name: '过期密钥', key: 'sk-expired', status: 'active', quota: 0, quota_used: 0, expires_at: '2026-07-01T00:00:00Z' },
      ],
    })
    getUserGroupRates.mockResolvedValue({})
    listTextModels.mockResolvedValue(['gpt-4o-mini'])
    listImageModels.mockResolvedValue(['gpt-image-1'])
    listVideoModels.mockResolvedValue(['grok-imagine-video'])
    listBatchImageModels.mockResolvedValue({ data: [{ id: 'gemini-2.5-flash-image', provider: 'gemini_api' }] })
    listBatchImageJobs.mockResolvedValue({ object: 'list', data: [], has_more: false })
    deleteBatchImageJobRecord.mockResolvedValue(undefined)
    deleteGenerationRecord.mockResolvedValue(undefined)
    listRecords.mockResolvedValue([
      {
        task_id: 'record-image-1',
        api_key_id: 1,
        media_type: 'image',
        creator_tool: 'image',
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
    resetCreatorRuntime()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('显示完整工具导航、首页矩阵并过滤不可用密钥', async () => {
    const wrapper = await mountReadyView()

    for (const id of ['home', 'image', 'edit', 'product-copy', 'outpaint', 'batch-main', 'batch-clone', 'watermark', 'video', 'history']) {
      expect(wrapper.find(`[data-test="creator-tool-${id}"]`).exists()).toBe(true)
    }
    expect(wrapper.find('[data-test="creator-tool-assistant"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="creator-tool-transcription"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="creator-tool-speech"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="creator-tool-home"]').classes()).toContain('active')
    expect(wrapper.text()).toContain('创作工具')
    expect(wrapper.text()).toContain('最近记录')

    await wrapper.find('[data-test="creator-tool-image"]').trigger('click')
    expect(wrapper.find('[data-test="creator-tool-image"]').classes()).toContain('active')

    const keyText = wrapper.find('[data-test="creator-key"]').text()
    expect(keyText).toContain('可用密钥')
    expect(keyText).not.toContain('停用密钥')
    expect(keyText).not.toContain('过期密钥')
  })

  it('按路由参数初始化对应工具', async () => {
    const wrapper = await mountReadyView('video')

    expect(wrapper.find('[data-test="creator-tool-video"]').classes()).toContain('active')
    expect(wrapper.find('[data-test="creator-tool-home"]').classes()).not.toContain('active')
  })

  it('预计等待时间使用当前用户同工具同模型最近生成耗时均值', () => {
    localStorage.setItem('auth_user', JSON.stringify({ id: 7 }))
    recordCreatorDuration('image', 'gpt-image-1', 10_000)
    recordCreatorDuration('image', 'gpt-image-1', 20_000)

    expect(estimateCreatorDuration('image', 'gpt-image-1')).toBe(15)
    expect(estimateCreatorDuration('video', 'gpt-image-1')).toBe(180)
  })

  it('各工具页只显示本工具记录，首页和历史页合并显示', async () => {
    listRecords.mockResolvedValue([
      {
        task_id: 'record-image', api_key_id: 1, media_type: 'image', creator_tool: 'image', provider: 'openai', model: 'gpt-image-1',
        prompt_preview: '生图页面记录', status: 'completed', result: null, created_at: '2026-07-17T05:00:00Z',
      },
      {
        task_id: 'record-edit', api_key_id: 1, media_type: 'image', creator_tool: 'edit', provider: 'openai', model: 'gpt-image-1',
        prompt_preview: '编辑页面记录', status: 'completed', result: null, created_at: '2026-07-17T04:00:00Z',
      },
    ])
    const wrapper = await mountReadyView()

    expect(wrapper.text()).toContain('生图页面记录')
    expect(wrapper.text()).toContain('编辑页面记录')
    await wrapper.find('[data-test="creator-tool-image"]').trigger('click')
    expect(wrapper.text()).toContain('生图页面记录')
    expect(wrapper.text()).not.toContain('编辑页面记录')
    await wrapper.find('[data-test="creator-tool-edit"]').trigger('click')
    expect(wrapper.text()).toContain('编辑页面记录')
    expect(wrapper.text()).not.toContain('生图页面记录')
    await wrapper.find('[data-test="creator-tool-history"]').trigger('click')
    expect(wrapper.text()).toContain('生图页面记录')
    expect(wrapper.text()).toContain('编辑页面记录')
    const editRecord = wrapper.findAll('.history-card-action').find((item) => item.text().includes('编辑页面记录'))
    await editRecord?.trigger('click')
    expect(wrapper.find('[data-test="creator-tool-edit"]').classes()).toContain('active')
  })

  it('首页最多显示三条最近记录并可进入历史记录', async () => {
    listRecords.mockResolvedValue(Array.from({ length: 4 }, (_, index) => ({
      task_id: `home-record-${index + 1}`,
      api_key_id: 1,
      media_type: 'image',
      creator_tool: 'image',
      provider: 'openai',
      model: 'gpt-image-1',
      prompt_preview: `首页记录 ${index + 1}`,
      status: 'completed',
      result: null,
      created_at: `2026-07-17T0${5 - index}:00:00Z`,
    })))
    const wrapper = await mountReadyView()

    expect(wrapper.findAll('.recent-row')).toHaveLength(3)
    expect(wrapper.text()).not.toContain('首页记录 4')
    await wrapper.find('.heading-actions button').trigger('click')
    expect(wrapper.find('[data-test="creator-tool-history"]').classes()).toContain('active')
  })

  it('刷新后把当前密钥的原生批量任务合并到首页、对应工具和历史记录', async () => {
    listRecords.mockResolvedValue([])
    listBatchImageJobs.mockResolvedValue({
      object: 'list',
      has_more: false,
      data: [
        batchJob(),
        batchJob({ id: 'batch-expired', task_name: 'batch-main-expired', item_count: 99, created_at: Math.floor(Date.now() / 1000) - (73 * 60 * 60) }),
      ],
    })
    const wrapper = await mountReadyView()

    expect(listBatchImageJobs).toHaveBeenCalledWith('sk-live', { limit: 10, from: expect.any(String) })
    expect(wrapper.text()).toContain('批量克隆，共 2 张')
    expect(wrapper.text()).not.toContain('批量主图，共 99 张')
    await wrapper.find('[data-test="creator-tool-batch-clone"]').trigger('click')
    expect(wrapper.text()).toContain('批量克隆，共 2 张')
    await wrapper.find('[data-test="creator-tool-batch-main"]').trigger('click')
    expect(wrapper.text()).not.toContain('批量克隆，共 2 张')
    await wrapper.find('[data-test="creator-tool-history"]').trigger('click')
    expect(wrapper.text()).toContain('批量克隆，共 2 张')
  })

  it('合并多个密钥的批量记录且单个密钥失败不影响其他记录', async () => {
    listKeys.mockResolvedValue({
      items: [
        { id: 1, name: '密钥一', key: 'sk-one', status: 'active', quota: 0, quota_used: 0, expires_at: null },
        { id: 2, name: '密钥二', key: 'sk-failed', status: 'active', quota: 0, quota_used: 0, expires_at: null },
        { id: 3, name: '密钥三', key: 'sk-three', status: 'active', quota: 0, quota_used: 0, expires_at: null },
      ],
    })
    listRecords.mockResolvedValue([{
      task_id: 'record-image', api_key_id: 1, media_type: 'image', creator_tool: 'image', provider: 'openai', model: 'gpt-image-1',
      prompt_preview: '普通生成记录', status: 'completed', result: null, created_at: new Date().toISOString(),
    }])
    listBatchImageJobs.mockImplementation(async (apiKey: string) => {
      if (apiKey === 'sk-failed') throw new Error('该密钥批量接口不可用')
      return {
        object: 'list',
        has_more: false,
        data: [batchJob({
          id: apiKey === 'sk-one' ? 'batch-one' : 'batch-three',
          task_name: apiKey === 'sk-one' ? 'batch-main-one' : 'batch-clone-three',
          item_count: apiKey === 'sk-one' ? 1 : 3,
        })],
      }
    })

    const wrapper = await mountReadyView()

    expect(listBatchImageJobs).toHaveBeenCalledTimes(3)
    expect(wrapper.text()).toContain('普通生成记录')
    expect(wrapper.text()).toContain('批量主图，共 1 张')
    expect(wrapper.text()).toContain('批量克隆，共 3 张')
    expect(wrapper.text()).not.toContain('该密钥批量接口不可用')
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

  it('备用文本密钥只用于文案与提示词优化，图片仍使用主密钥', async () => {
    listKeys.mockResolvedValue({
      items: [
        { id: 1, name: '图片密钥', key: 'sk-image-only', status: 'active', quota: 0, quota_used: 0, expires_at: null },
        { id: 2, name: '文本密钥', key: 'sk-text-only', status: 'active', quota: 0, quota_used: 0, expires_at: null },
      ],
    })
    listTextModels.mockImplementation(async (apiKey: string) => apiKey === 'sk-text-only' ? ['gpt-4o-mini'] : [])
    createTextCompletion.mockResolvedValue({ content: '备用密钥生成的文案' })
    generateImage.mockResolvedValue({ data: [{ b64_json: 'aW1hZ2U=' }] })
    const wrapper = await mountReadyView('product-copy')

    await wrapper.find('[data-test="creator-backup-key"] select').setValue('2')
    await flushPromises()
    await wrapper.find('input.field-control').setValue('咖啡机')
    await wrapper.find('textarea.field-control').setValue('九成新')
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await flushPromises()

    expect(createTextCompletion.mock.calls[0][0]).toMatchObject({ apiKey: 'sk-text-only', model: 'gpt-4o-mini' })

    await wrapper.find('[data-test="creator-tool-image"]').trigger('click')
    await wrapper.find('[data-test="creator-prompt"]').setValue('白底咖啡机')
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await flushPromises()
    expect(generateImage.mock.calls[0][0].apiKey).toBe('sk-image-only')
  })

  it('提示词优化不会覆盖请求期间的手动修改且各工具输入隔离', async () => {
    const optimization = deferred<{ content: string }>()
    createTextCompletion.mockReturnValue(optimization.promise)
    const wrapper = await mountReadyView('image')

    await wrapper.find('[data-test="creator-prompt"]').setValue('原始图片提示词')
    await wrapper.find('[data-test="creator-optimize-prompt"]').trigger('click')
    await wrapper.find('[data-test="creator-prompt"]').setValue('我手动修改后的提示词')
    optimization.resolve({ content: '异步返回的优化提示词' })
    await flushPromises()

    expect((wrapper.find('[data-test="creator-prompt"]').element as HTMLTextAreaElement).value).toBe('我手动修改后的提示词')
    expect(wrapper.text()).toContain('本次优化结果未自动覆盖')
    expect(createTextCompletion.mock.calls[0][0]).toMatchObject({ mode: 'prompt-optimize', apiKey: 'sk-live' })

    await wrapper.find('[data-test="creator-tool-edit"]').trigger('click')
    expect((wrapper.find('[data-test="creator-prompt"]').element as HTMLTextAreaElement).value).toBe('')
    await wrapper.find('[data-test="creator-tool-image"]').trigger('click')
    expect((wrapper.find('[data-test="creator-prompt"]').element as HTMLTextAreaElement).value).toBe('我手动修改后的提示词')
  })

  it('图片工具优化提示词时携带上传的参考图并限制主题偏移', async () => {
    listTextModels.mockResolvedValue(['codex-mini-latest', 'gpt-4o-mini'])
    createTextCompletion.mockResolvedValue({ content: '保持原图主体的优化提示词' })
    const wrapper = await mountReadyView('outpaint')
    const referenceImage = new File([new Uint8Array([1])], 'reference.png', { type: 'image/png' })

    await setInputFiles(wrapper, '#creator-image-file', [referenceImage])
    await wrapper.find('[data-test="creator-prompt"]').setValue('向左延展背景')
    await wrapper.find('[data-test="creator-optimize-prompt"]').trigger('click')
    await flushPromises()

    expect(createTextCompletion.mock.calls[0][0]).toMatchObject({
      mode: 'prompt-optimize',
      model: 'gpt-4o-mini',
      referenceImage,
    })
    expect(createTextCompletion.mock.calls[0][0].prompt).toContain('必须以随请求提供的参考图为准')
    expect((wrapper.find('[data-test="creator-prompt"]').element as HTMLTextAreaElement).value).toBe('保持原图主体的优化提示词')
  })

  it('本地文案按用户清理三天前记录、限制十条并支持手动删除', async () => {
    const now = Date.now()
    localStorage.setItem('auth_user', JSON.stringify({ id: 99 }))
    const records = [
      ...Array.from({ length: 11 }, (_, index) => ({
        id: `local-valid-${index}`,
        toolId: 'product-copy',
        title: `文案 ${index}`,
        kind: '商品文案',
        preview: `预览 ${index}`,
        content: `内容 ${index}`,
        outputType: 'text',
        createdAt: new Date(now - index * 1000).toISOString(),
      })),
      {
        id: 'local-expired',
        toolId: 'product-copy',
        title: '过期文案',
        kind: '商品文案',
        preview: '过期',
        content: '过期',
        outputType: 'text',
        createdAt: new Date(now - 73 * 60 * 60 * 1000).toISOString(),
      },
    ]
    localStorage.setItem('online-creator-local-copy-v1:99', JSON.stringify(records))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = await mountReadyView('history')

    expect(wrapper.findAll('[data-test="creator-delete-local-record"]')).toHaveLength(10)
    expect(wrapper.text()).not.toContain('过期文案')
    await wrapper.find('[data-test="creator-delete-local-record"]').trigger('click')

    const stored = JSON.parse(localStorage.getItem('online-creator-local-copy-v1:99') || '[]')
    expect(stored).toHaveLength(9)
  })

  it('生成记录支持确认后手动删除', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = await mountReadyView('history')

    await wrapper.find('[data-test="creator-delete-backend-record"]').trigger('click')
    await flushPromises()

    expect(deleteGenerationRecord).toHaveBeenCalledWith('record-image-1')
    expect(wrapper.text()).not.toContain('最近的主图')
  })

  it('记录达到十条时提交前提醒用户', async () => {
    listRecords.mockResolvedValue(Array.from({ length: 10 }, (_, index) => ({
      task_id: `record-${index}`,
      api_key_id: 1,
      media_type: 'image',
      creator_tool: 'image',
      provider: 'openai',
      model: 'gpt-image-1',
      prompt_preview: `记录 ${index}`,
      status: 'completed',
      result: null,
      created_at: new Date(Date.now() - index * 1000).toISOString(),
    })))
    generateImage.mockResolvedValue({ data: [{ b64_json: 'aW1hZ2U=' }] })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const wrapper = await mountReadyView('image')

    await wrapper.find('[data-test="creator-prompt"]').setValue('满记录测试')
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    expect(generateImage).not.toHaveBeenCalled()
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await flushPromises()

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('删除时间最早的一条记录'))
    expect(generateImage).toHaveBeenCalledTimes(1)
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
      creatorTool: 'image',
      signal: expect.any(Object),
    })
    expect(wrapper.find('img[alt="创作结果"]').attributes('src')).toContain('data:image/png;base64,aW1hZ2U=')
  })

  it('生图场景、画质、风格、背景和分组费用估算同步到请求', async () => {
    getUserGroupRates.mockResolvedValue({ 8: 3 })
    listKeys.mockResolvedValue({
      items: [{
        id: 1,
        name: '生图密钥',
        key: 'sk-image',
        status: 'active',
        quota: 0,
        quota_used: 0,
        expires_at: null,
        group: {
          id: 8,
          name: '生图分组',
          platform: 'openai',
          rate_multiplier: 2,
          image_rate_independent: false,
          image_rate_multiplier: 1,
          image_price_1k: 0.1,
          image_price_2k: 0.2,
        },
      }],
    })
    generateImage.mockResolvedValue({ data: [{ b64_json: 'aW1hZ2U=' }] })
    const wrapper = await mountReadyView('image')

    expect(wrapper.text()).toContain('当前分组：生图分组')
    expect(wrapper.find('[data-test="creator-image-cost"]').text()).toContain('约 $0.3000')
    await wrapper.find('[data-test="creator-image-scene-product"]').trigger('click')
    await wrapper.find('[data-test="creator-ratio-3-2"]').trigger('click')
    await wrapper.find('[data-test="creator-image-quality"]').setValue('medium')
    await wrapper.find('[data-test="creator-image-style"]').setValue('vivid')
    await wrapper.find('[data-test="creator-image-background"]').setValue('transparent')
    await wrapper.find('[data-test="creator-prompt"]').setValue('一台银色咖啡机')

    expect(wrapper.find('[data-test="creator-image-cost"]').text()).toContain('2K')
    expect(wrapper.find('[data-test="creator-image-cost"]').text()).toContain('约 $0.6000')
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await flushPromises()

    expect(generateImage).toHaveBeenCalledWith({
      apiKey: 'sk-image',
      model: 'gpt-image-1',
      prompt: '电商商品白底主图，主体居中，边缘清晰，光线均匀，无多余装饰。\n一台银色咖啡机\n整体风格鲜明，色彩和对比度更强。',
      size: '1536x1024',
      quality: 'medium',
      count: 1,
      outputFormat: 'png',
      creatorTool: 'image',
      background: 'transparent',
      signal: expect.any(Object),
    })
  })

  it('Grok 生图别名按质量版估算并禁用不兼容参数', async () => {
    listImageModels.mockResolvedValue(['grok-imagine'])
    const wrapper = await mountReadyView('image')

    expect(wrapper.find('[data-test="creator-image-cost"]').text()).toContain('约 $0.0500')
    expect(wrapper.find('[data-test="creator-image-quality"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-test="creator-image-background"]').attributes('disabled')).toBeDefined()
    await wrapper.find('[data-test="creator-ratio-3-2"]').trigger('click')
    expect(wrapper.find('[data-test="creator-image-cost"]').text()).toContain('约 $0.0700')
  })

  it('图片扩图生成透明扩展画布并调用图片编辑', async () => {
    installCanvasImageMocks()
    editImage.mockResolvedValue({ data: [{ b64_json: 'aW1hZ2U=' }] })
    const wrapper = await mountReadyView()
    const file = new File([new Uint8Array([1])], 'poster.png', { type: 'image/png' })

    await wrapper.find('[data-test="creator-tool-outpaint"]').trigger('click')
    await wrapper.find('[data-test="creator-outpaint-right"]').trigger('click')
    await wrapper.find('[data-test="creator-outpaint-ratio"]').setValue('1')
    await setInputFiles(wrapper, '#creator-image-file', [file])
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await flushPromises()

    expect(editImage.mock.calls[0][0]).toMatchObject({
      apiKey: 'sk-live',
      model: 'gpt-image-1',
      size: '208x112',
      creatorTool: 'outpaint',
    })
    expect(editImage.mock.calls[0][0].image.name).toBe('outpaint-source.png')
    expect(editImage.mock.calls[0][0].mask.name).toBe('outpaint-mask.png')
    expect(editImage.mock.calls[0][0].inputFidelity).toBe('high')
    expect(editImage.mock.calls[0][0].prompt).toContain('仅自然补全透明扩展区域')
    expect(editImage.mock.calls[0][0].prompt).toContain('扩图方向：向右')
  })

  it('扩图预处理期间切换工具仍使用提交时的模型和提示词', async () => {
    installCanvasImageMocks()
    let finishImageLoad: (() => void) | undefined
    vi.stubGlobal('Image', class {
      onload: null | (() => void) = null
      onerror: null | (() => void) = null
      naturalWidth = 100
      naturalHeight = 100
      width = 100
      height = 100
      set src(_value: string) {
        finishImageLoad = () => this.onload?.()
      }
    })
    editImage.mockResolvedValue({ data: [{ b64_json: 'aW1hZ2U=' }] })
    const wrapper = await mountReadyView()
    const file = new File([new Uint8Array([1])], 'outpaint.png', { type: 'image/png' })

    await wrapper.find('[data-test="creator-tool-outpaint"]').trigger('click')
    await wrapper.find('[data-test="creator-outpaint-right"]').trigger('click')
    await wrapper.find('[data-test="creator-prompt"]').setValue('延展原图天空')
    await setInputFiles(wrapper, '#creator-image-file', [file])
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    expect(finishImageLoad).toBeTypeOf('function')

    await wrapper.find('[data-test="creator-tool-product-copy"]').trigger('click')
    await wrapper.find('[data-test="creator-prompt"]').setValue('另一工具的新提示词')
    finishImageLoad?.()
    await flushPromises()

    expect(editImage.mock.calls[0][0]).toMatchObject({ model: 'gpt-image-1', creatorTool: 'outpaint' })
    expect(editImage.mock.calls[0][0].prompt).toContain('扩图方向：向右')
    expect(editImage.mock.calls[0][0].prompt).toContain('补充要求：延展原图天空')
    expect(editImage.mock.calls[0][0].prompt).not.toContain('另一工具的新提示词')
  })

  it('批量主图界面最多接收 6 张商品图', async () => {
    submitBatchImageJob.mockResolvedValue({ id: 'batch-1', status: 'queued', item_count: 6 })
    const wrapper = await mountReadyView()
    const files = Array.from({ length: 7 }, (_, index) => new File([new Uint8Array([index + 1])], `sku-${index}.png`, { type: 'image/png' }))

    await wrapper.find('[data-test="creator-tool-batch-main"]').trigger('click')
    await flushPromises()
    await setInputFiles(wrapper, '#creator-batch-files', files)
    expect(wrapper.text()).toContain('已选择 6 / 6 张')
  })

  it('批量任务按所选画布同步提交比例和清晰度档位', async () => {
    submitBatchImageJob.mockResolvedValue({ id: 'batch-wide', status: 'queued', item_count: 1 })
    const wrapper = await mountReadyView('batch-main')
    const product = new File([new Uint8Array([1])], 'wide.png', { type: 'image/png' })

    await wrapper.find('[data-test="creator-ratio-16-9"]').trigger('click')
    await setInputFiles(wrapper, '#creator-batch-files', [product])
    await vi.waitFor(() => expect(wrapper.find('[data-test="creator-submit-button"]').attributes('disabled')).toBeUndefined())
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await vi.waitFor(() => expect(submitBatchImageJob).toHaveBeenCalledTimes(1))

    expect(submitBatchImageJob.mock.calls[0][1]).toMatchObject({ aspect_ratio: '16:9', image_size: '2K' })
  })

  it('批量任务在记录满十条后提交成功会删除最早记录', async () => {
    listRecords.mockResolvedValue(Array.from({ length: 10 }, (_, index) => ({
      task_id: `full-record-${index}`,
      api_key_id: 1,
      media_type: 'image',
      creator_tool: 'image',
      provider: 'openai',
      model: 'gpt-image-1',
      prompt_preview: `满额记录 ${index}`,
      status: 'completed',
      result: null,
      created_at: new Date(Date.now() - index * 1000).toISOString(),
    })))
    submitBatchImageJob.mockResolvedValue({ id: 'batch-replace-oldest', status: 'queued', item_count: 1 })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const wrapper = await mountReadyView('batch-main')
    const product = new File([new Uint8Array([1])], 'replace.png', { type: 'image/png' })

    await setInputFiles(wrapper, '#creator-batch-files', [product])
    await vi.waitFor(() => expect(wrapper.find('[data-test="creator-submit-button"]').attributes('disabled')).toBeUndefined())
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await vi.waitFor(() => expect(deleteGenerationRecord).toHaveBeenCalledWith('full-record-9'))
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
    expect(wrapper.find('img[alt="ref.png"]').exists()).toBe(true)
    expect(wrapper.find('img[alt="sku.png"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('ref.png')
    expect(wrapper.text()).not.toContain('sku.png')
    expect(wrapper.text()).toContain('已选择 1 / 6 张')
  })

  it('批量 API 未启用时使用普通图片模型逐张处理', async () => {
    listBatchImageModels.mockRejectedValue(Object.assign(new Error('batch image API is disabled'), { status: 403 }))
    editImage.mockResolvedValue({ data: [{ b64_json: 'ZmFsbGJhY2s=' }] })
    const wrapper = await mountReadyView('batch-main')
    const product = new File([new Uint8Array([1])], 'sku.png', { type: 'image/png' })

    expect(wrapper.text()).not.toContain('模型加载失败')
    await setInputFiles(wrapper, '#creator-batch-files', [product])
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await vi.waitFor(() => expect(editImage).toHaveBeenCalledTimes(1))

    expect(submitBatchImageJob).not.toHaveBeenCalled()
    expect(editImage.mock.calls[0][0]).toMatchObject({
      apiKey: 'sk-live',
      model: 'gpt-image-1',
      image: product,
    })
    await vi.waitFor(() => expect(wrapper.text()).toContain('已自动改用逐张图片编辑'))
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

  it('批量图片在 base64 预处理时离开页面仍会继续提交', async () => {
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

    expect(submitBatchImageJob).toHaveBeenCalledTimes(1)
    expect(editImage).not.toHaveBeenCalled()
  })

  it('批量提交返回 unsupported 前离开页面仍会继续逐张兜底', async () => {
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

    expect(editImage).toHaveBeenCalledTimes(1)
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

    await wrapper.find('[data-test="creator-tool-product-copy"]').trigger('click')
    const inputs = wrapper.findAll('input.field-control')
    await inputs[0].setValue('失败商品')
    await wrapper.find('textarea.field-control').setValue('失败测试信息')
    await wrapper.find('[data-test="creator-prompt"]').setValue('测试失败')
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('模型不可用')
    expect(listRecords).toHaveBeenCalledWith(10)
    expect(wrapper.text()).not.toContain('最近的主图')
  })

  it('切换工具后旧请求继续，且各工具结果互不覆盖', async () => {
    const pending = deferred<{ content: string }>()
    createTextCompletion.mockReturnValue(pending.promise)
    generateImage.mockResolvedValue({ data: [{ b64_json: 'aW1hZ2U=' }] })
    const wrapper = await mountReadyView()

    await wrapper.find('[data-test="creator-tool-product-copy"]').trigger('click')
    const inputs = wrapper.findAll('input.field-control')
    await inputs[0].setValue('等待商品')
    await wrapper.find('textarea.field-control').setValue('等待中的商品信息')
    await wrapper.find('[data-test="creator-prompt"]').setValue('等待中的请求')
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await Promise.resolve()

    const requestSignal = createTextCompletion.mock.calls[0][0].signal as AbortSignal
    expect(wrapper.find('[data-test="creator-tool-image"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-test="creator-key"] select').attributes('disabled')).toBeDefined()
    expect(wrapper.find('select.field-control').attributes('disabled')).toBeDefined()
    await wrapper.find('[data-test="creator-tool-image"]').trigger('click')
    expect(requestSignal.aborted).toBe(false)
    expect(wrapper.find('[data-test="creator-tool-image"]').classes()).toContain('active')
    expect(wrapper.find('[data-test="creator-key"] select').attributes('disabled')).toBeUndefined()
    await wrapper.find('[data-test="creator-prompt"]').setValue('并行生成图片')
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await flushPromises()
    expect(wrapper.find('img[alt="创作结果"]').exists()).toBe(true)

    pending.resolve({ content: '完成' })
    await flushPromises()
    expect(wrapper.find('.text-output').exists()).toBe(false)
    expect(wrapper.find('img[alt="创作结果"]').exists()).toBe(true)

    await wrapper.find('[data-test="creator-tool-product-copy"]').trigger('click')
    expect(wrapper.find('.text-output').text()).toContain('完成')
  })

  it('切换账号时清除上一账号的共享结果和密钥任务上下文', async () => {
    localStorage.setItem('auth_user', JSON.stringify({ id: 101 }))
    generateImage.mockResolvedValue({ data: [{ b64_json: 'YWNjb3VudC0x' }] })
    const firstWrapper = await mountReadyView('image')

    await firstWrapper.find('[data-test="creator-prompt"]').setValue('账号一结果')
    await firstWrapper.find('[data-test="creator-submit"]').trigger('submit')
    await flushPromises()
    expect(firstWrapper.find('img[alt="创作结果"]').exists()).toBe(true)
    firstWrapper.unmount()

    localStorage.setItem('auth_user', JSON.stringify({ id: 202 }))
    const secondWrapper = await mountReadyView('image')
    expect(secondWrapper.find('img[alt="创作结果"]').exists()).toBe(false)
    expect(creatorVideoTasks.size).toBe(0)
    expect(creatorBatchAPIKeys.size).toBe(0)
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
    await vi.advanceTimersByTimeAsync(10000)
    await flushPromises()

    expect(getVideoStatus).toHaveBeenCalledTimes(2)
    expect(getVideoStatus).toHaveBeenNthCalledWith(2, 'sk-live', 'video-retry', 'agnes', 'agnes-video-v2.0')
    expect(wrapper.find('video').attributes('src')).toBe('https://cdn.example/video-retry.mp4')
    expect(wrapper.text()).not.toContain('临时网络错误')
    wrapper.unmount()
  })

  it('切换工具和离开页面后仍继续视频轮询', async () => {
    vi.useFakeTimers()
    generateVideo.mockResolvedValue({ request_id: 'video-pending', status: 'queued' })
    getVideoStatus.mockResolvedValue({ request_id: 'video-pending', status: 'processing' })
    const wrapper = await mountReadyView()

    await wrapper.find('[data-test="creator-tool-video"]').trigger('click')
    await wrapper.find('[data-test="creator-prompt"]').setValue('等待中的视频')
    await wrapper.find('[data-test="creator-submit"]').trigger('submit')
    await flushPromises()
    await wrapper.find('[data-test="creator-tool-image"]').trigger('click')
    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()
    expect(getVideoStatus).toHaveBeenCalledTimes(1)

    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(5000)
    expect(getVideoStatus).toHaveBeenCalledTimes(2)
  })

  it('后台任务完成后会刷新重新进入页面的历史记录', async () => {
    vi.useFakeTimers()
    let completed = false
    listRecords.mockImplementation(async () => completed ? [{
      task_id: 'video-remount',
      api_key_id: 1,
      media_type: 'video',
      creator_tool: 'video',
      provider: 'grok',
      model: 'grok-imagine-video',
      prompt_preview: '重新进入后可见的视频',
      status: 'completed',
      result: { urls: ['https://cdn.example/remount.mp4'] },
      created_at: new Date().toISOString(),
    }] : [])
    generateVideo.mockResolvedValue({ request_id: 'video-remount', status: 'queued' })
    getVideoStatus.mockImplementation(async () => {
      completed = true
      return { request_id: 'video-remount', status: 'completed', video: { url: 'https://cdn.example/remount.mp4' } }
    })
    const firstWrapper = await mountReadyView('video')
    await firstWrapper.find('[data-test="creator-prompt"]').setValue('后台完成测试')
    await firstWrapper.find('[data-test="creator-submit"]').trigger('submit')
    await flushPromises()
    firstWrapper.unmount()

    const secondWrapper = await mountReadyView('history')
    expect(secondWrapper.text()).not.toContain('重新进入后可见的视频')
    await vi.advanceTimersByTimeAsync(5000)
    await flushPromises()

    expect(secondWrapper.text()).toContain('重新进入后可见的视频')
  })

  it('从 files 记录读取 Blob，切换工具和离开页面后保留预览 URL', async () => {
    const createObjectURL = vi.fn(() => 'blob:history-image')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    listRecords.mockResolvedValue([{
      task_id: 'record-file-1', api_key_id: 1, media_type: 'image', creator_tool: 'image', provider: 'openai', model: 'gpt-image-1',
      prompt_preview: '服务端文件', status: 'completed', result: { urls: ['https://cdn.example/expired.png'], files: ['history.png'] }, created_at: '2026-07-16T00:00:00Z',
    }])
    getRecordContent.mockResolvedValue(new Blob([new Uint8Array([1])], { type: 'image/png' }))
    const wrapper = await mountReadyView('image')

    await wrapper.find('button.record-item').trigger('click')
    await flushPromises()
    expect(getRecordContent).toHaveBeenCalledWith('record-file-1', 0)
    expect(wrapper.find('img[alt="创作结果"]').attributes('src')).toBe('blob:history-image')
    await wrapper.find('[data-test="creator-tool-image"]').trigger('click')
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:history-image')
    wrapper.unmount()
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:history-image')
  })

  it('恢复记录失败前切换工具时不写入旧请求错误', async () => {
    listRecords.mockResolvedValue([{
      task_id: 'record-stale-error', api_key_id: 1, media_type: 'image', creator_tool: 'image', provider: 'openai', model: 'gpt-image-1',
      prompt_preview: '稍后失败的记录', status: 'completed', result: { files: ['stale.png'] }, created_at: '2026-07-16T00:00:00Z',
    }])
    let rejectContent!: (error: unknown) => void
    getRecordContent.mockReturnValue(new Promise((_resolve, reject) => {
      rejectContent = reject
    }))
    const wrapper = await mountReadyView('image')

    await wrapper.find('button.record-item').trigger('click')
    expect(getRecordContent).toHaveBeenCalledWith('record-stale-error', 0)
    await wrapper.find('[data-test="creator-tool-image"]').trigger('click')
    rejectContent(new Error('旧记录读取失败'))
    await flushPromises()

    expect(wrapper.find('[data-test="creator-tool-image"]').classes()).toContain('active')
    expect(wrapper.text()).not.toContain('旧记录读取失败')
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

})
