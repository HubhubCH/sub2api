import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import CreatorImageUpload from '../CreatorImageUpload.vue'

describe('CreatorImageUpload', () => {
  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((file: File) => `blob:${file.name}`),
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('支持拖入图片并提交文件列表', async () => {
    const wrapper = mount(CreatorImageUpload, {
      props: { files: [], label: '商品图片', multiple: true, maxFiles: 6 },
      global: { stubs: { Icon: true } },
    })
    const first = new File([new Uint8Array([1])], 'first.png', { type: 'image/png' })
    const second = new File([new Uint8Array([2])], 'second.jpg', { type: 'image/jpeg' })

    await wrapper.trigger('drop', { dataTransfer: { files: [first, second] } })

    expect(wrapper.emitted('update:files')?.[0]?.[0]).toEqual([first, second])
  })

  it('显示图片缩略图而不显示文件名，并支持移除', async () => {
    const file = new File([new Uint8Array([1])], 'preview.png', { type: 'image/png' })
    const wrapper = mount(CreatorImageUpload, {
      props: { files: [file], label: '原图' },
      global: { stubs: { Icon: true } },
    })

    expect(wrapper.get('img').attributes('src')).toBe('blob:preview.png')
    expect(wrapper.get('img').attributes('alt')).toBe('preview.png')
    expect(wrapper.text()).not.toContain('preview.png')
    await wrapper.get('.remove-button').trigger('click')
    expect(wrapper.emitted('update:files')?.[0]?.[0]).toEqual([])

    wrapper.unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview.png')
  })

  it('批量拖入时去重并限制最大数量', async () => {
    const existing = new File([new Uint8Array([1])], 'existing.png', { type: 'image/png', lastModified: 1 })
    const duplicate = new File([new Uint8Array([1])], 'existing.png', { type: 'image/png', lastModified: 1 })
    const extra = new File([new Uint8Array([2])], 'extra.png', { type: 'image/png', lastModified: 2 })
    const overflow = new File([new Uint8Array([3])], 'overflow.png', { type: 'image/png', lastModified: 3 })
    const wrapper = mount(CreatorImageUpload, {
      props: { files: [existing], label: '商品图片', multiple: true, maxFiles: 2 },
      global: { stubs: { Icon: true } },
    })

    await wrapper.trigger('drop', { dataTransfer: { files: [duplicate, extra, overflow] } })

    expect(wrapper.emitted('update:files')?.[0]?.[0]).toEqual([duplicate, extra])
  })
})
