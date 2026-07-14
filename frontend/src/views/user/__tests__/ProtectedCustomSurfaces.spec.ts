import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  const path = fileURLToPath(new URL(relativePath, import.meta.url))
  return readFileSync(path, 'utf8')
}

function readView(name: string): string {
  return readSource(`../${name}`)
}

function normalizedSha256(source: string): string {
  return createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex')
}

describe('88token protected custom surfaces', () => {
  it('keeps the production affiliate tree and collapse behavior', () => {
    const source = readView('AffiliateView.vue')

    expect(source).toContain('affiliate-invitees-card')
    expect(source).toContain('visibleInvitees')
    expect(source).toContain('collapsedInviteeIds')
    expect(source).toContain('initializeCollapsedInviteeBranches')
    expect(source).toContain('affiliate-disclosure')
  })

  it('keeps the production recharge iframe shell and crop', () => {
    const source = readView('CustomPageView.vue')

    expect(source).toContain('custom-page-layout-recharge')
    expect(source).toContain('custom-embed-shell-recharge')
    expect(source).toContain('custom-embed-footer-mask')
    expect(source).toContain('height: calc(100% + 142px)')
    expect(source).toContain('transform: translateY(-128px)')
    expect(source).not.toContain("import UserPageHero from '@/components/layout/UserPageHero.vue'")
  })

  it('keeps protected production layouts byte-for-byte apart from line endings', () => {
    const recoveredHashes: Record<string, string> = {
      '../AffiliateView.vue': '1c12efabe28cfd13128c8a07a39f9c5cba1f175766dbd7dde4dfc79d166383eb',
      '../CustomPageView.vue': 'ad5ac7251ec58231e0ccf81a126e78667686314720d27a663150fca102bda48c',
      '../../../App.vue': '798a197f9dde990c7a6bb29a6b451b5ad131de6ac276146d5844ba9b5fb36f95',
      '../../../components/layout/AppLayout.vue': 'b70d197cd962465baa3b063eaba12aef45ebbe61ebf2d0f28f249f43d45487fa',
      '../../../style.css': '7c7e934ada144d09215d4697aff33303dab0545e054e4085cfec10f290db867f'
    }

    for (const [relativePath, expectedHash] of Object.entries(recoveredHashes)) {
      expect(normalizedSha256(readSource(relativePath)), relativePath).toBe(expectedHash)
    }
  })

  it('keeps protected navigation while adding the approved media and leaderboard entries', () => {
    const sidebar = readSource('../../../components/layout/AppSidebar.vue')
    const router = readSource('../../../router/index.ts')

    for (const path of ['/batch-image', '/video-generation', '/token-leaderboard', '/affiliate']) {
      expect(sidebar).toContain(`path: '${path}'`)
      expect(router).toContain(`path: '${path}'`)
    }
    expect(sidebar).toContain('affiliate-plan-card')
    expect(router).toContain("path: '/custom/:id'")
  })

  it('shows the numeric user ID on the token leaderboard', () => {
    const source = readView('TokenLeaderboardView.vue')
    expect(source).toContain("{ id: entry.user_id }")
    expect(source).not.toContain("{ id: entry.anonymous_id }")
  })
})
