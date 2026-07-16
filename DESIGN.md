# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-07-16
- Primary product surfaces: existing 88token Sub2API console, unified online creator, affiliate, Token leaderboard, and recharge custom page.
- Evidence reviewed: fourteen approved online-creator references under `.omx/artifacts/visual-ralph/online-creator-v158/`; user screenshots for Token leaderboard and affiliate hierarchy; `frontend/src/views/user/BatchImageGuideView.vue`; `frontend/src/views/user/VideoGenerationView.vue`; `frontend/src/views/user/TokenLeaderboardView.vue`; `frontend/src/views/user/AffiliateView.vue`; `frontend/src/components/layout/AppSidebar.vue`; `frontend/src/router/index.ts`; upstream tag `v0.1.158`.

## Brand
- Personality: quiet, operational, trustworthy, compact.
- Trust signals: stable navigation, preserved balances and account context, clear status and errors.
- Avoid: marketing-style heroes, decorative cards, layout rewrites, and unrelated color or spacing changes.

## Product goals
- Goals: upgrade safely to v0.1.158; consolidate AI image and video into one online-creator workspace; make AI image, image edit, assistant, product copy, image translation, batch product images, batch clone, watermark processing, AI video, transcription, dubbing, and creation history operational through compatible user API keys; retain the five-minute realtime Token ranking and all cumulative-recharge agent promotion behavior.
- Non-goals: replace the existing global sidebar or brand language; invent successful results for unsupported upstream models; reset cumulative recharge after promotion; permit demotion; exceed level 1; change reward settlement; expose credentials; or remove the existing direct media routes before the unified workspace is accepted.
- Success signals: every 500 eligible accumulated balance-redemption units advances one level from the account's existing level; cumulative progress never resets; registration-bonus redemptions with value 2 are excluded from rebate and cumulative totals; newly self-registered accounts start at level 10, newly administrator-invited accounts start at level 1, and existing accounts retain their pre-migration tree-derived starting level; promotion moves only the promoted node's upstream edge; the administrator view shows every direct branch plus every no-upstream root and reveals their lower levels through the existing disclosure control.

## Personas and jobs
- Primary personas: end users generating media; administrators managing accounts and channels.
- User jobs: enter one creator workspace, select a compatible key/model, switch between text/image/video/audio tools, submit valid requests, inspect progress, restore/download outputs, manage referrals, and recharge.
- Key contexts of use: desktop-first console with responsive mobile support and repeated operational use.

## Information architecture
- Primary navigation: preserve the current sidebar and ordering; replace the separate AI image/video sidebar entries with one `在线创作` entry after the unified route passes acceptance.
- Core routes/screens: `/online-creator` with internal tool navigation; compatibility redirects from `/batch-image` and `/video-generation`; protected `/token-leaderboard`, `/affiliate`, and `/custom/0270c67cf5b175db`.
- Content hierarchy: the creator route has a compact internal tool rail, a bounded parameter column, and the largest flexible result area. The creator home shows the tool matrix and recent creations; creation history uses the result area full width.

## Design principles
- Preserve before improving: protected routes and shared layout are immutable unless explicitly approved.
- Provider truth: show only supported models, dimensions, durations, and states for the selected provider.
- Functional truth: every enabled command must invoke a real local transform or gateway request and expose loading, success, failure, and retry/download states.
- Tradeoffs: prefer small provider-specific controls over a misleading universal form; audio tools remain unavailable when the selected key has no compatible audio model.

## Visual language
- Color: reuse existing tokens and current cyan/teal accents; no palette replacement.
- Typography: reuse current type scale; no viewport-scaled font sizes.
- Spacing/layout rhythm: use the outer `AppLayout` gutter once; keep 12-16px gaps between creator rail, parameters, and result area; keep controls dense and aligned; avoid nested cards.
- Shape/radius/elevation: use restrained 6-8px radii for tools and panels, with one border/elevation layer per surface.
- Motion: retain existing transitions and respect reduced motion.
- Imagery/iconography: generated media is primary; use the existing icon library.

## Components
- Existing components to reuse: `AppLayout`, `AppSidebar`, `Icon`, current form controls, `GenerationHistoryPanel`, image/video APIs, batch-image API, status badges, and result actions.
- New/changed components: `OnlineCreatorView`, internal creator rail, tool home, shared key/model selector, image tool, text tool, batch tool, audio tool, unified result panel, and unified creation history; existing leaderboard and affiliate components remain protected.
- Variants and states: eleven creator tools plus home/history; realtime leaderboard refreshing every five minutes; settled historical leaderboard; arbitrary positive agent levels with level 1 as the cap; administrator root collapsed to level-1 agents; provider/model-specific media and audio states.
- Token/component ownership: existing frontend tokens remain authoritative.

## Accessibility
- Target standard: preserve current semantics and keyboard behavior; WCAG AA for changed controls.
- Keyboard/focus behavior: all provider and result actions remain keyboard reachable with visible focus.
- Contrast/readability: use existing semantic text and error colors.
- Screen-reader semantics: status changes use existing live/status patterns.
- Reduced motion and sensory considerations: no new required animation.

## Responsive behavior
- Supported breakpoints/devices: current desktop and mobile breakpoints.
- Layout adaptations: wide desktop uses creator rail + parameter column + flexible result area; medium desktop collapses the rail to a horizontal/segmented tool selector; mobile stacks tool selector, parameters, primary action, then results. No horizontal overflow at 390px; media stages preserve intrinsic aspect ratio.
- Touch/hover differences: no hover-only commands; browser visual-search opt-out may be added to generated images.

## Interaction states
- Loading: leaderboard keeps existing data during silent automatic refresh and shows loading only for explicit switches/refreshes; provider request accepted and polling status visible.
- Empty: creator result area names the next required action without feature-marketing copy; home/history use compact empty states.
- Error: show normalized provider error without exposing credentials.
- Success: render actual text/media/audio response, dimensions/status when available, copy/download/reuse actions, and a persisted creation record where supported.
- Disabled: invalid provider/model parameter combinations cannot submit.
- Offline/slow network, if applicable: bounded polling with explicit timeout/failure state.

## Content voice
- Tone: concise Chinese operational copy.
- Terminology: use `在线创作`, `创作首页`, `AI 生图`, `图片编辑`, `对话助手`, `商品文案`, `图片翻译`, `批量主图`, `批量克隆`, `水印处理`, `AI 视频`, `语音转写`, `AI 配音`, and `创作记录`.
- Microcopy rules: do not claim 4K/Full HD unless the provider accepts and returns it; affiliate level badges use concise labels such as "一级" and omit the repeated word "代理".

## Implementation constraints
- Framework/styling system: existing Vue/Vite frontend and Go backend patterns.
- Design-token constraints: no new global design layer.
- Performance constraints: no local Docker or parallel full builds on the low-resource workstation; run narrow checks first.
- Compatibility constraints: preserve current production data, environment, hard-coded supervisor scope, custom menus, current-recharge rebate ordering, daily leaderboard settlement, and recharge iframe configuration; agent totals and promotion use positive balance redemption records other than the value-2 registration bonus, rather than third-party payment-order amounts; agent reparenting applies only after the triggering redemption is processed. Keep both distinct `178_*` migration filenames because migrations are keyed by full filename.
- Test/screenshot expectations: compare the creator route at 1920x1080 and 390x844 with the approved references and require Visual Ralph score >= 90; compare protected routes against `../../research/live-site/BASELINE.md`; preserve current affiliate tree expand/collapse behavior and recharge iframe crop semantics; verify cumulative thresholds, idempotent recharge events, maximum level, downstream preservation, designated-admin scope, and five-minute realtime leaderboard refresh.

## Open questions
- [ ] Confirm which live keys expose compatible audio-input/audio-output models without exposing credentials.
- [ ] Approve a final maintenance window only after the v0.1.158 release candidate, visual verdict, functional browser flows, and rollback package pass acceptance.
