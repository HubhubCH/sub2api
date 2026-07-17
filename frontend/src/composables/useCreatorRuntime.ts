import { reactive, ref } from 'vue'
import type { GatewayVideoProvider } from '@/api/videoGeneration'
import type * as batchImageAPI from '@/api/batchImage'
import type { CreatorOutput } from '@/components/user/creator/CreatorResultPanel.vue'

export type CreatorWorkToolId =
  | 'image'
  | 'edit'
  | 'product-copy'
  | 'outpaint'
  | 'batch-main'
  | 'batch-clone'
  | 'watermark'
  | 'video'

export interface CreatorTaskState {
  output: CreatorOutput | null
  loading: boolean
  running: boolean
  status: string
  error: string
  version: number
  controller: AbortController | null
  startedAt: number
  estimateSeconds: number
  timingKey: string
}

export interface CreatorBatchRecordContext {
  apiKey: string
  job: batchImageAPI.BatchImageJob
  toolId: 'batch-main' | 'batch-clone'
}

export const creatorWorkToolIds: CreatorWorkToolId[] = [
  'image',
  'edit',
  'product-copy',
  'outpaint',
  'batch-main',
  'batch-clone',
  'watermark',
  'video',
]

export const creatorTaskStates = reactive<Record<CreatorWorkToolId, CreatorTaskState>>(
  Object.fromEntries(creatorWorkToolIds.map((toolId) => [toolId, {
    output: null,
    loading: false,
    running: false,
    status: '',
    error: '',
    version: 0,
    controller: null,
    startedAt: 0,
    estimateSeconds: 0,
    timingKey: '',
  }])) as Record<CreatorWorkToolId, CreatorTaskState>,
)

export const creatorVideoPollTimers = new Map<CreatorWorkToolId, number>()
export const creatorBatchPollTimers = new Map<CreatorWorkToolId, number>()
export const creatorBatchAPIKeys = new Map<string, string>()
export const creatorBatchRecordContexts = new Map<string, CreatorBatchRecordContext>()
export const creatorVideoTasks = new Map<string, { apiKey: string; provider: GatewayVideoProvider; model: string }>()
export const creatorRecordRevision = ref(0)

const creatorObjectUrls = new Set<string>()
let creatorRuntimeOwnerKey = ''
const TIMING_STORAGE_KEY = 'online-creator-duration-samples-v1'
const MAX_TIMING_SAMPLES = 10

const DEFAULT_ESTIMATES: Record<CreatorWorkToolId, number> = {
  image: 60,
  edit: 75,
  'product-copy': 20,
  outpaint: 90,
  'batch-main': 150,
  'batch-clone': 150,
  watermark: 60,
  video: 180,
}

function currentCreatorOwnerKey(): string {
  try {
    const user = JSON.parse(globalThis.localStorage?.getItem('auth_user') || '{}') as { id?: unknown }
    return String(user.id || 'anonymous')
  } catch {
    return 'anonymous'
  }
}

function resetCreatorRuntime(): void {
  for (const timer of creatorVideoPollTimers.values()) globalThis.clearTimeout(timer)
  for (const timer of creatorBatchPollTimers.values()) globalThis.clearTimeout(timer)
  creatorVideoPollTimers.clear()
  creatorBatchPollTimers.clear()
  creatorBatchAPIKeys.clear()
  creatorBatchRecordContexts.clear()
  creatorVideoTasks.clear()
  for (const state of Object.values(creatorTaskStates)) {
    state.controller?.abort()
    state.version += 1
    state.output = null
    state.loading = false
    state.running = false
    state.status = ''
    state.error = ''
    state.controller = null
    state.startedAt = 0
    state.estimateSeconds = 0
    state.timingKey = ''
  }
  for (const url of creatorObjectUrls) URL.revokeObjectURL(url)
  creatorObjectUrls.clear()
}

export function claimCreatorRuntimeForCurrentUser(): void {
  const ownerKey = currentCreatorOwnerKey()
  if (!creatorRuntimeOwnerKey) {
    creatorRuntimeOwnerKey = ownerKey
    return
  }
  if (creatorRuntimeOwnerKey === ownerKey) return
  resetCreatorRuntime()
  creatorRuntimeOwnerKey = ownerKey
  creatorRecordRevision.value += 1
}

export function notifyCreatorRecordsChanged(): void {
  creatorRecordRevision.value += 1
}

function timingStorageKey(): string {
  try {
    const user = JSON.parse(globalThis.localStorage?.getItem('auth_user') || '{}') as { id?: unknown }
    return `${TIMING_STORAGE_KEY}:${String(user.id || 'anonymous')}`
  } catch {
    return `${TIMING_STORAGE_KEY}:anonymous`
  }
}

function readTimingSamples(): Record<string, number[]> {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(timingStorageKey()) || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).map(([key, samples]) => [
      key,
      Array.isArray(samples)
        ? samples.map(Number).filter((sample) => Number.isFinite(sample) && sample > 0).slice(-MAX_TIMING_SAMPLES)
        : [],
    ]))
  } catch {
    return {}
  }
}

function writeTimingSamples(samples: Record<string, number[]>): void {
  try {
    globalThis.localStorage?.setItem(timingStorageKey(), JSON.stringify(samples))
  } catch {
    // 浏览器禁用本地存储时仍可继续创作。
  }
}

export function creatorTimingKey(toolId: CreatorWorkToolId, model: string): string {
  return `${toolId}:${model.trim().toLowerCase() || 'default'}`
}

export function estimateCreatorDuration(toolId: CreatorWorkToolId, model: string): number {
  const samples = readTimingSamples()[creatorTimingKey(toolId, model)] || []
  if (samples.length === 0) return DEFAULT_ESTIMATES[toolId]
  return Math.max(1, Math.round(samples.reduce((sum, sample) => sum + sample, 0) / samples.length))
}

export function recordCreatorDuration(toolId: CreatorWorkToolId, model: string, durationMs: number): void {
  const seconds = Math.max(1, Math.round(durationMs / 1000))
  if (!Number.isFinite(seconds)) return
  const samples = readTimingSamples()
  const key = creatorTimingKey(toolId, model)
  samples[key] = [...(samples[key] || []), seconds].slice(-MAX_TIMING_SAMPLES)
  writeTimingSamples(samples)
}

export function createCreatorObjectURL(blob: Blob): string {
  const url = URL.createObjectURL(blob)
  creatorObjectUrls.add(url)
  return url
}

export function releaseCreatorObjectURL(url?: string): void {
  if (!url || !creatorObjectUrls.has(url)) return
  URL.revokeObjectURL(url)
  creatorObjectUrls.delete(url)
}
