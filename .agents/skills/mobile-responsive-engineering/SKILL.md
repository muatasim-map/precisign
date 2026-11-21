---
name: mobile-responsive-engineering
description: Adapt PreciSign's dashboard, forms, review and signing, navigation, and account screens for phones and tablets while preserving existing desktop layouts and official documents. Use for responsive implementation or audits and for checking installed-app ergonomics ahead of PWA work.
---

# Mobile responsive engineering for PreciSign

## Start with a baseline

1. Read the nearest `AGENTS.md`. From the repository root, use `docs/navigation/feature-index.md` to find the affected screen, layout styles, and closest test. Follow only the relevant paths.
2. Use synthetic data in `npm run dev:showcase` for visual checks. Use an isolated connected instance for behavior that showcase simulates, such as permissions or authenticated attachment downloads. Record the route, data, role, company scope, browser, viewport, and shell state. Capture affected desktop screens before editing with the same inputs you will use afterward.
3. Fix one journey at a time. If the scope is app-wide, prioritize **find a request → review the document and files → sign or return**. Follow with **draft → select signers → submit**, then archive, library, settings, and profile as needed.

## Preserve desktop and business behavior

- Treat each current desktop layout as the baseline. Preserve columns, sidebar behavior, toolbar placement, preview dimensions, spacing, typography, and focus order at existing desktop widths. Inspect actual Tailwind classes and CSS media queries before selecting a breakpoint. There is no universal desktop cutoff.
- Prefer narrow-screen CSS or responsive variants on existing components. If editing base classes, explicitly verify which values desktop inherits. Avoid global spacing changes, new dependencies, and app-wide layout rewrites for a local issue.
- Keep sorting, filtering, navigation, validation, and actions shared across presentations. If a dense table needs a separate phone card, both views must use the same data and handlers. Mount or expose only the active controls to keyboard and assistive technology, and preserve state when resizing.
- Keep calls behind AppContext and the repository. Preserve company and role checks, draft and revision behavior, route links, sign and return semantics, authorized attachment downloads, and historical version selection. Keep responsive state independent of request state.
- Treat official A4 forms, bilingual content, signature positions, branding, and print/export behavior as protected. Change the screen wrapper only. Use a bounded pan or zoom region with a way to fit and inspect the page. Preserve access to version selection and zoom controls. Test print separately when touching a preview or shared print ancestor.

## Choose patterns that fit the screen

| Surface | Mobile pattern and checks |
| --- | --- |
| Shell | Reuse existing navigation and company scope controls. If using a drawer, support Escape, focus management and restoration, and closing after navigation. Keep the active company and next action easy to find. |
| Inbox and archive | Use cards for action queues when they improve scanning. Keep request identity, company where relevant, status, and next action visible. For comparison tables, use a labeled local scroll region when preserving columns matters. Verify filters and empty, loading, and error states. |
| Forms and correction | Stack fields in task order without changing validation or draft ownership. Keep selected signers and attachments visible. Allow wrapping for long names and filenames. Reveal and focus the first invalid field. Verify that opening the keyboard does not hide it or the submit action. |
| Review and signing | Keep request status, selected version, document access, and permitted actions discoverable. Make historical mode obvious. Test confirmation, cancel, and retry. Keep sticky controls clear of content, file lists, and dialogs. |
| Signature input | Restrict `touch-action: none` to the drawing surface. Use pointer capture and map coordinates against current bounds and pixel ratio. Keep strokes through resize or rotation, and verify finger/stylus drawing, cancel, clear, and save. |
| Dialogs and sheets | Use the existing accessible dialog pattern. Bound height to available viewport, allow internal scrolling, and ensure actions and validation stay reachable with the keyboard open. |

Use `min-w-0` on shrinking grid/flex children and fix the element that causes overflow. Do not clip the whole workspace to hide an overflow failure. Local scrolling is appropriate for an A4 preview or wide data table if keyboard and touch users can reach all content. Aim for 44 × 44 CSS px for mobile controls, especially icon actions, without enlarging desktop controls. Keep focus visible and browser zoom enabled.

## Prepare for standalone use

- Test with short viewport heights, mobile browser chrome, orientation changes, and an open keyboard. Prefer dynamic viewport sizing where a panel must fit available height. Apply safe-area padding to the affected edges of mobile headers, footers, and dialogs when the app uses edge-to-edge layout. Check that bottom controls neither overlap the home indicator nor leave an extra gap.
- Check the same journeys in iOS Safari and Android Chrome where available. If an installed build exists, also check standalone launch, deep links, back behavior, safe areas, and app resume. Track device checks separately from emulation.
- PWA readiness is a layout and interaction constraint here. Installing a manifest or service worker, enabling offline actions, or caching authenticated requests, signatures, or files requires a separate task.

## Verify and report

- Exercise affected screens at **320 and 390 CSS px** on phones, **768 CSS px** on a tablet, and **1280 and 1440 CSS px** on desktop. Check immediately below and above any changed breakpoint and include short landscape or browser zoom when relevant. Use long names, Arabic/bilingual content where supported, and both empty and dense states.
- Wait for the screen's actual ready state before taking measurements. Verify no unintended document-level horizontal scroll. Check that controls are visible, operable, and clear of sticky layers. Test the workflow itself, including opening a request, changing versions, downloading an attachment, or completing a form as applicable.
- Compare desktop before/after screenshots with matching state. Inspect sidebar and content bounds, table columns, action bars, paper wrappers, and interaction behavior. Resolve unexplained desktop differences before calling the change complete.
- Use existing browser scripts if they cover the affected route. Follow `docs/testing/verification.md` and `AGENTS.md` for checks. For implementation work, run the applicable tests, `npm run lint`, and a build with a fresh temporary output directory. For preview or print changes, include the protected document check and verify the print output in a browser.
- Report what changed, viewports and workflows exercised, desktop comparison evidence, and any checks that still need a physical device or installed build. A headless viewport check alone is not device or PWA verification.
