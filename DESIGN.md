# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-07-14
- Primary product surfaces: existing 88token Sub2API console, AI image, AI video, affiliate, and recharge custom page.
- Evidence reviewed: user screenshots; `frontend/src/views/user/BatchImageGuideView.vue`; `frontend/src/views/user/VideoGenerationView.vue`; `frontend/src/components/user/GenerationHistoryPanel.vue`; local Playwright screenshots under `output/playwright/.playwright-cli/`; `../../research/live-site/BASELINE.md`; recovered production source.

## Brand
- Personality: quiet, operational, trustworthy, compact.
- Trust signals: stable navigation, preserved balances and account context, clear status and errors.
- Avoid: marketing-style heroes, decorative cards, layout rewrites, and unrelated color or spacing changes.

## Product goals
- Goals: upgrade safely to v0.1.153; make image sizing truthful; make supported video providers work; preserve current affiliate and recharge experiences.
- Non-goals: redesign navigation, affiliate, recharge, dashboard, or global visual language.
- Success signals: protected pages match the live baseline; provider-specific requests pass contract tests; rollback remains possible.

## Personas and jobs
- Primary personas: end users generating media; administrators managing accounts and channels.
- User jobs: select a key/model, submit a valid media request, inspect progress, download output, manage referrals, and recharge.
- Key contexts of use: desktop-first console with responsive mobile support and repeated operational use.

## Information architecture
- Primary navigation: preserve the current sidebar and ordering.
- Core routes/screens: `/batch-image`, `/video-generation`, `/affiliate`, `/custom/0270c67cf5b175db`.
- Content hierarchy: media workbenches use parameters on the left, the preview and primary action in the center, and generation history on the right; the preview keeps the largest flexible area.

## Design principles
- Preserve before improving: protected routes and shared layout are immutable unless explicitly approved.
- Provider truth: show only supported models, dimensions, durations, and states for the selected provider.
- Tradeoffs: prefer small provider-specific controls over a misleading universal form.

## Visual language
- Color: reuse existing tokens and current cyan/teal accents; no palette replacement.
- Typography: reuse current type scale; no viewport-scaled font sizes.
- Spacing/layout rhythm: use the outer `AppLayout` gutter once; keep compact 16px gaps between media-workbench columns and avoid nested page padding.
- Shape/radius/elevation: reuse existing component tokens; cards remain at current radius.
- Motion: retain existing transitions and respect reduced motion.
- Imagery/iconography: generated media is primary; use the existing icon library.

## Components
- Existing components to reuse: `AppLayout`, `AppSidebar`, current form controls, status badges, and result actions.
- New/changed components: provider adapters and provider-aware media parameter normalization; image result-stage sizing only.
- Variants and states: provider/model-specific loading, polling, success, failure, and unsupported-parameter states.
- Token/component ownership: existing frontend tokens remain authoritative.

## Accessibility
- Target standard: preserve current semantics and keyboard behavior; WCAG AA for changed controls.
- Keyboard/focus behavior: all provider and result actions remain keyboard reachable with visible focus.
- Contrast/readability: use existing semantic text and error colors.
- Screen-reader semantics: status changes use existing live/status patterns.
- Reduced motion and sensory considerations: no new required animation.

## Responsive behavior
- Supported breakpoints/devices: current desktop and mobile breakpoints.
- Layout adaptations: show three media-workbench columns on wide desktop, move history below a two-column parameters/preview layout on medium desktop, and stack parameters, preview, then history on narrow screens; media stages must fit intrinsic aspect ratio without oversized side gutters.
- Touch/hover differences: no hover-only commands; browser visual-search opt-out may be added to generated images.

## Interaction states
- Loading: provider request accepted and polling status visible; always show elapsed wait time while active, and show progress, queue position, or ETA only when the upstream response provides those values.
- Empty: retain current empty image/video canvases.
- Error: show normalized provider error without exposing credentials.
- Success: render actual response dimensions/status and existing download actions.
- Disabled: invalid provider/model parameter combinations cannot submit.
- Offline/slow network, if applicable: bounded polling with explicit timeout/failure state.

## Content voice
- Tone: concise Chinese operational copy.
- Terminology: use provider model names and exact parameter labels.
- Microcopy rules: do not claim 4K/Full HD unless the provider accepts and returns it.

## Implementation constraints
- Framework/styling system: existing Vue/Vite frontend and Go backend patterns.
- Design-token constraints: no new global design layer.
- Performance constraints: no local Docker or parallel full builds on the low-resource workstation; run narrow checks first.
- Compatibility constraints: preserve current production data, environment, custom menus, affiliate logic, and recharge iframe configuration.
- Test/screenshot expectations: compare protected routes against `../../research/live-site/BASELINE.md`; preserve current affiliate tree behavior and recharge iframe crop semantics.

## Open questions
- [ ] Confirm live provider account base URLs and model entitlements without exposing credentials.
- [ ] Approve a final maintenance window only after the local release candidate and rollback package pass acceptance.
