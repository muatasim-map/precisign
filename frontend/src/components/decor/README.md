# Decor kit

PreciSign's illustrations are one family: routes, nodes and contours in `currentColor`.

- **Strokes:** 1.25 px for routes and contours (non-scaling), 1.5 px for 24×24 form glyphs.
- **Nodes:** r = 3 with a soft halo (r 5.5–7, 8–14% opacity). The "current" node is filled and carries a small highlight.
- **Fades:** contours fade at both ends through a gradient mask. Ids come from `useSvgId`, so they're unique per instance.
- **Palette:** teal (`--color-workspace-teal`) by default, steel for archive, indigo for people, amber for brand. Set it through CSS `color`, never with hard-coded fills.
- **Motion:** draw-ins use `pathLength={1}` with `stroke-dashoffset`. Drift and float are slow and linear, or ease-out. All of it lives in `src/craft.css`, is hover-gated, and stops under reduced motion.
- **Pieces:** `RouteMotifs.tsx` (header, rail, card corner, empty states with check, lock and search endings), `FormGlyphs.tsx` (one glyph per form), and `common/PageHeader.tsx` (the page hero).
- **Rules:** decoration only (`aria-hidden`, `no-print`). Never inside the official A4 documents, PDFs or signature images.
