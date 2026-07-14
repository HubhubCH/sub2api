import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const listRecords = vi.hoisted(() => vi.fn())
const getRecordContent = vi.hoisted(() => vi.fn())

vi.mock('@/api/generationRecords', () => ({
  generationRecordsAPI: {
    list: listRecords,
    content: getRecordContent,
  },
}))

import GenerationHistoryPanel from '../GenerationHistoryPanel.vue'

describe('GenerationHistoryPanel', () => {
  beforeEach(() => {
    listRecords.mockReset()
    getRecordContent.mockReset()
    listRecords.mockResolvedValue([{
      task_id: 'gen-image-1',
      api_key_id: 1,
      media_type: 'image',
      provider: 'openai',
      model: 'gpt-image-2',
      prompt_preview: '东方城市夜景',
      status: 'completed',
      result: { files: ['0.png'], urls: [] },
      created_at: '2026-07-14T12:00:00Z',
    }])
    getRecordContent.mockResolvedValue(new Blob(['image'], { type: 'image/png' }))
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:history-image') })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  })

  it('shows a persistent image preview and restores the latest completed record', async () => {
    const wrapper = mount(GenerationHistoryPanel, {
      props: { mediaType: 'image' },
      global: { stubs: { Icon: true } },
    })
    await flushPromises()

    expect(wrapper.find('.history-preview').attributes('src')).toBe('blob:history-image')
    expect(wrapper.emitted('select')?.[0]?.[0]).toMatchObject({ task_id: 'gen-image-1' })
  })

  it('downloads a completed image again from the server record', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const wrapper = mount(GenerationHistoryPanel, {
      props: { mediaType: 'image' },
      global: { stubs: { Icon: true } },
    })
    await flushPromises()
    await wrapper.find('.history-download').trigger('click')
    await flushPromises()

    expect(getRecordContent).toHaveBeenCalledWith('gen-image-1', 0)
    expect(click).toHaveBeenCalled()
  })
})
