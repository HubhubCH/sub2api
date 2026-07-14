import { apiClient } from './client'
import type { TokenLeaderboardData, TokenPointExchangeResult } from '@/types'

export async function getTokenLeaderboard(date?: string): Promise<TokenLeaderboardData> {
  const { data } = await apiClient.get<TokenLeaderboardData>('/token-leaderboard', {
    params: date ? { date } : undefined,
  })
  return data
}

export async function exchangeTokenPoints(points: number): Promise<TokenPointExchangeResult> {
  const { data } = await apiClient.post<TokenPointExchangeResult>('/token-leaderboard/exchange', {
    points,
  }, {
    headers: {
      'Idempotency-Key': globalThis.crypto?.randomUUID?.() ?? `token-exchange-${Date.now()}`,
    },
  })
  return data
}

export const tokenLeaderboardAPI = {
  get: getTokenLeaderboard,
  exchange: exchangeTokenPoints,
}

export default tokenLeaderboardAPI
