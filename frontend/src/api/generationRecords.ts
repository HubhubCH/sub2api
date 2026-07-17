import { apiClient } from './client'

export interface GenerationRecord {
  task_id: string
  api_key_id: number
  media_type: 'image' | 'video'
  creator_tool?: string
  provider: string
  model: string
  prompt_preview: string
  status: string
  upstream_task_id?: string
  result?: { files?: string[]; urls?: string[] } | null
  error_message?: string
  created_at: string
}

export async function listGenerationRecords(limit = 10): Promise<GenerationRecord[]> {
  const response = await apiClient.get<{ data: GenerationRecord[] }>('/user/generation-records', { params: { limit } })
  return response.data.data || []
}

export async function getGenerationRecordContent(taskId: string, index = 0): Promise<Blob> {
  const response = await apiClient.get(`/user/generation-records/${encodeURIComponent(taskId)}/content/${index}`, {
    responseType: 'blob'
  })
  return response.data as Blob
}

export async function deleteGenerationRecord(taskId: string): Promise<void> {
  await apiClient.delete(`/user/generation-records/${encodeURIComponent(taskId)}`)
}

export const generationRecordsAPI = {
  list: listGenerationRecords,
  content: getGenerationRecordContent,
  delete: deleteGenerationRecord
}
