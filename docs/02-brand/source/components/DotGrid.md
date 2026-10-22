# DotGrid

The matrix made literal: a regular grid of `grid-dot` dots (`grid-dot-radius`) every `grid-pitch`, filling its positioned parent. With the red glow it is the brand signature: every piece carries both.

- **Provide:** a parent with `position: relative` (or absolute) and the ground colour; put `<Glow />` first and `<DotGrid />` right after it, before any content. `wide` switches to `grid-pitch-small-image` (30px) for profile pictures and other images platforms shrink. `slide` switches to the presentation scale (`grid-dot-slide` dots of `grid-dot-radius-slide` every `grid-pitch-slide`) for 1920 × 1080 slides and anything shown on a projector or big screen.
- Always on, always full-bleed: never left off a piece, cropped to one corner, faded away or hidden under a full-bleed image. Cards and panels may cover it where they sit; it shows around them.
- Always a regular grid, never random, never a partial scatter.
- Dots follow the ground: `bm-grid-dot-ink-2` (#2A2D32) on Ink stages, posts and cards; `bm-grid-dot-ink` (#202327) for a quieter full-page grid; `bm-grid-dot-paper` (#D4D4D4 at 50%) on Paper. At presentation scale: `bm-grid-dot-ink-slide` (#34383E) on Ink, `bm-grid-dot-paper-slide` (#D4D4D4) on Paper.
- It has to be visible at the size the piece is seen. If the dots disappear (a projected slide, a shrunk thumbnail), step up to the `slide` or `wide` scale; never swap it for another texture.
