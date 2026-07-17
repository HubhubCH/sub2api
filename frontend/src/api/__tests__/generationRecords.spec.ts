import { beforeEach, describe, expect, it, vi } from 'vitest'

const client = vi.hoisted(() => ({ delete: vi.fn() }))
vi.mock('../client', () => ({ apiClient: client }))

import { deleteGenerationRecord, generationRecordsAPI } from '../generationRecords'

describe('生成记录 API', () => {
  beforeEach(() => client.delete.mockReset())

  it('按编码后的任务 ID 删除当前用户的生成记录', async () => {
    client.delete.mockResolvedValue({ data: null })

    await deleteGenerationRecord('gen/a b')

    expect(client.delete).toHaveBeenCalledWith('/user/generation-records/gen%2Fa%20b')
    expect(generationRecordsAPI.delete).toBe(deleteGenerationRecord)
  })
})
