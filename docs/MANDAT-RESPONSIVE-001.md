# RESPONSIVE-001 — Inspection and continuation mandate for Claude Code

Date: 26/10/2026. Requested by the founder: inspect the work and continue the responsive redesign.

## Vision
Make the web app feel designed for desktop and tablet, while retaining the established mobile experience, visual identity and business rules. Use https://www.fii.sn/ only as a live reference for card hierarchy and action placement. Do not copy its branding, assets, text or page composition.

## Actual state and evidence limits
- Repository head checked for this handoff: `5b4f144063797b2e16aa23289bddc5e878b24a1b` (Fii Studio). Refresh main before working; mobile and Studio work must be preserved.
- Codex's earlier responsive exploration used `08a4c47794bad9771e3138e4be61187513f15f16`. It identified a general 560px content wrapper and narrow carousel/navigation constraints.
- That exploration and its local tests were NOT pushed. Its local checkout and screenshots are no longer available. No responsive code, screenshots or test suite from that exploration is delivered by this mandate. Do not assume a branch, patch or a production rollout exists.
- The earlier browser inspection of fii.sn showed a desktop grid with separated image, title, price and seller information. Reinspect the live page before relying on that observation.
- This commit is documentation only. Earlier local test counts are not acceptance evidence for the current repository.

## Start with independent inspection
1. Read CLAUDE.md, any applicable AGENTS.md, docs/HANDOFF.md and docs/REVUE-VP.md.
2. Inspect current main, open branches/PRs, working-tree changes and deployed revision. Avoid overwriting ongoing work or rebuilding existing fixes.
3. Capture the current app and the reference in real browsers. Diagnose the app before adding CSS. Distinguish verified facts, recommendations and hypotheses.
4. Give a concise independent verdict: what remains broken, what you disagree with in this mandate, and the smallest coherent fix. Then proceed with the authorized UI corrections; escalate only a genuine product decision or blocker.

## Required scope
- Review home, product feed, shop directory, saved items, all six storefront themes, cart/checkout, merchant orders/products/customers/settings/Marketing, Studio, courier/Agent dashboards and back-office.
- Introduce task-specific responsive containers. Browsing/workspaces should use available width; forms and long text should keep a readable measure. Widening the global wrapper alone is insufficient.
- Test a two-column tablet grid and a three/four-column desktop grid where card width and content justify it. Prefer CSS Grid to device sniffing.
- Adapt merchant navigation: top tabs on tablet, a stable left rail on sufficiently wide desktops, current mobile tabs on phones. Derive final breakpoints from content.
- In Marketing, make publishing, the site and results efficiently visible. A two-area desktop workspace is a candidate, not a mandatory mockup.
- Cards: clear title/price/status hierarchy, legible text, consistent image treatment, aligned actions after decision information, one primary action per context; keep secondary actions quieter.
- Where a carousel becomes a grid, disable auto-advance and pagination and remove inert/hidden restrictions from every visible card. Restore carousel behavior on resizing back to mobile without reloading. Clean up observers, timers and listeners on navigation.
- Check sticky bars, cart/save buttons, dialogs, keyboard focus, long names/prices, empty/error/loading/offline states, dark mode, reduced motion and native safe areas.

## Constraints
Keep the current green/lime palette, typefaces, logo, adaptive-home priorities, permissions, data and routes. Do not duplicate the main action or add more visible filter rows. No new design framework, naming/domain changes, backend migration or paid activation for a layout correction. Preserve the current Capacitor and Studio integrations; test Studio with simulated results, without spending credits.

## Acceptance and delivery
- Test at 320, 390, 768, 820, 1024, 1100, 1440 and 1920 CSS pixels, plus 200% zoom/reflow and long content. No horizontal page overflow, clipped prices, hidden CTAs or content covered by fixed navigation.
- Verify keyboard reachability of all visible cards, live resize between layouts, modal focus/escape, cart completion using synthetic data, and current mobile behavior.
- Run Chromium and WebKit responsive checks and the relevant existing navigation, onboarding, feed, storefront, shop, Marketing, back-office, native and Studio suites. Add meaningful regression checks to CI. Do not call a simulated result a real-device validation.
- Save actual before/after captures under docs/screenshots/responsive/ and a report at docs/RAPPORT-RESPONSIVE-001.md: inspected SHA, findings, changed files, viewport matrix, commands/results, limits, remaining work and rollback.
- Update HANDOFF in the same implementation commit. State explicitly whether anything new was added to back-office; UI-only changes do not require inventing a new setting.
- Deliver a reviewable branch/PR first. Do not declare production fixed until deployment and production checks have actually succeeded. Explain any remaining deployment gate precisely.

Next action: inspect current main and produce the independent diagnostic with real before captures, then implement and verify the smallest coherent responsive correction.
