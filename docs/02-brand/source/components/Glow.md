# Glow

The red glow that warms the ground: a 2:1 ellipse of Matrix Red (`bm-accent`) centred 82% across and just above the top edge, fading out by 64% of its radius; optionally a smaller second glow centred below the bottom-left corner. With the dot grid it is the brand signature: every piece carries both.

- **Provide:** a parent with `position: relative` (or absolute); put `<Glow />` first inside it, then `<DotGrid />`, then the content. `second` adds the bottom-left glow.
- Always on: the main glow is on every piece, on Ink and on Paper. The second glow is for statement pieces (title, closing and thank-you slides, announcement posts).
- Strength follows the nearest theme: `glow-ink` / `glow-2-ink` on Ink, `glow-paper` / `glow-2-paper` on Paper.
- The ellipse is sized from the parent's width (about 2.3× wide for the main glow), so it reads the same on a card, a slide or a post.
- Corners only: keep headlines clear of the top-right.
- No other glows: no neon, lens flares or glows on the logo.
