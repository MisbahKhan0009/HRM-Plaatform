Big-Matrix Solutions builds software for healthcare and business, from AI-powered medical diagnostics and hospital systems to SaaS platforms and e-commerce. This system covers anything that carries the Big-Matrix name: the website, social posts, decks, documents, print and events. Each section gives the rule, the reason and the exact token to use.

> **Designing the future of *intelligent* infrastructure.**
> Use the tagline as written. When it is set as a headline, *intelligent* takes the red emphasis (`Emphasis`).

**Promise:** intelligent infrastructure that works in the real world. We ship systems that run in hospitals and businesses every day, and we support them around the clock.

## Brand essence

### What we do · four pillars

| Pillar | What it means |
|---|---|
| AI diagnostics | Machine learning that supports clinicians in reading scans, signals and test results. |
| Hospital systems | Software that runs patient flow, records and operations across departments. |
| SaaS platforms | Cloud products our partners subscribe to and scale with. |
| E-commerce | Online stores and sales platforms that businesses run and grow on. |

### Who we talk to

- Hospital directors, CIOs and clinical leads choosing technology they will live with for years.
- Doctors and specialists who need tools that save time and never get in the way of care.
- Business owners and operations leads who need online sales and systems that stay up and stay measurable.
- Engineers and future hires who want to work on systems that matter.

### Personality

| Trait | What it means |
|---|---|
| Precise | Numbers over adjectives. We say exactly what a system does. |
| Calm | Healthcare is high stakes. We sound steady, never alarmist or hyped. |
| Engineered | Grids, systems and clear structure show up in how everything looks. |
| Human | Technology serves clinicians, patients and customers. People stay in the story. |

### Proof points

Use these numbers, and only these, when a piece needs proof: **6** systems in production · **5** clinical partners · **24/7** support coverage. Set them with `StatBar`.

## Voice & tone: engineers talking to clinicians

Write clear, specific and calm copy. Explain what a system does and what it changes for the people using it.

| We are | We avoid |
|---|---|
| Specific: real numbers, real outcomes | Hype: "revolutionary", "game-changing", "disrupt" |
| Plain: short sentences, active voice | Fear: "don't get left behind" |
| Confident: we state, we don't oversell | Unexplained jargon and acronyms |
| Respectful of care: patients and clinicians first | Claims we can't back with a number |

| Instead of | Write |
|---|---|
| Our revolutionary AI will transform healthcare forever. | Our diagnostic models help radiologists review scans faster, in 5 partner hospitals. |
| Cutting-edge synergistic solutions for tomorrow's enterprises. | 6 systems in production, supported 24/7. |
| Hurry! Don't miss out on the future! | See how a hospital cut patient wait times. Read the case study. |

- **Headline formula:** outcome + for whom, with one red word on the idea: "Faster diagnosis for *clinical* teams".
- **Calls to action:** verb first, two to three words. Use the website's own, **Start collaboration** and **Explore solutions**; for content, **Read the case study**, **Apply now**, **Book a demo**.
- **Casing:** sentence case for headlines. Capitals only in mono labels (`label` style).
- **The name:** **Big-Matrix Solutions** on first mention, **Big-Matrix** after, always with the hyphen and both capitals. Never "BigMatrix", "Big Matrix", "BMS" in public copy, or "big-matrix" outside the URL.
- **The URL:** **big-matrix.com**, lowercase, without "www" or "https".

## Logo: the cube matrix

Blue cubes built around one red cube: many systems, one intelligent core. The red cube is the brand's focal point, which is why red is the only accent colour everywhere else. The final logo (Oct 2026) pairs the cube with bold geometric lettering: white letters with red details on Ink, Graphite letters on white.

| Version | Asset | Ground | Use for |
|---|---|---|---|
| Primary lockup | `Logos/bms-logo-full-dark.png` | `bm-ink` | First choice for every use: covers, posts, stories, slides, website header. |
| Light version | `Logos/bms-logo-full-light.png` | `bm-paper` | Documents, email, white pages. |
| Cube mark | `Logos/bms-logo-cube.png` | `bm-ink` | Profile pictures, app icons, favicons, stickers, small spaces where the wordmark would be unreadable. |

- **Approved grounds:** Ink takes the primary lockup; white takes the light version. Photos and red grounds take the all-white version, and single-colour print the single-colour version; neither is approved artwork yet, so ask the designer before using one.
- **Clear space:** keep empty space on every side equal to **X**, the height of one cube in the mark (about a quarter of the logo's height). Nothing enters that zone: text, edges, other logos.
- **Minimum size:** lockup `logo-min-lockup` on screen (`logo-min-lockup-print` in print); cube mark `logo-min-cube` (`logo-min-cube-print`). Below these sizes switch to the cube mark instead of shrinking the lockup.
- **Never:** stretch or squash it; rotate or tilt it; recolour it; add shadows, glows or bevels; place the full-colour version on busy photos; scatter cubes as decoration. One approved exception: the faded, cropped cube watermark on the back of the business card (see **BusinessCard**), and nowhere else.
- **Wordmark:** vector, Orbitron-based lettering with a red hyphen, an open Λ (in place of the A) with a red square, and a red dot on the i. The chosen colourways are **Night** (white lettering) with the original cube and **Graphite** lettering on white. The cube keeps its original blue (`bm-logo-blue`) and red.
- **Vector cube:** the cube exists only as a 518 × 518 px PNG. Ask the designer for a vector cube before large print jobs, signage or merchandise.

## Colour: ink, paper and one red

The palette is mostly neutral so the red can do its job: point at the one thing that matters. Blue lives in the logo and stays there.

**Proportion:** 60% ground (`ground`: Ink or Paper), 30% neutrals for text and structure (`text`, `text-2`, `line`), 10% red (`accent`). Pick Ink or Paper as the ground and keep red to about a tenth of any layout.

**Two kinds of colour token.** The `bm-*` tokens are the fixed big-matrix.com values, with the same names as the site's CSS variables (`--bm-accent`, `--bm-ink` and so on). The unprefixed roles switch with the theme: **Ink** is the dark ground and the default, **Paper** the light one. Build with the roles; set `data-theme="ink"` or `data-theme="paper"` on a container to fix its ground (a title slide is always Ink, an email signature and the back of the business card always Paper).

| Role | On Ink | On Paper | Use |
|---|---|---|---|
| `ground` · `ground-2` | Ink · #131415 | Paper · #FAFAFA | Page ground · table headers and spec blocks |
| `surface` | Ink 2 | Paper | Cards and panels |
| `text` · `text-2` · `text-3` | Mist · Fog · #8F9297 | Graphite · Slate · #6C6C6C | Headlines and body · secondary copy · mono labels, captions, footers |
| `line` · `line-strong` | #2B2D31 · #3C3F44 | #E6E6E6 · #D4D4D4 | Dividers and card borders · eyebrow pill, stat bar, secondary button |
| `accent` | Red on Ink | Matrix Red | Red marks: eyebrow dot, ticks, list dashes, focus outline |
| `accent-text` · `link` | Red on Ink · #FF8078 | Red Deep · #A81F16 | Small red text · links and the text button |
| `accent-tint` | #2A1614 | #FEF2F0 | Hover tint, info badges |
| `action` · `action-hover` · `on-action` | Red Fill · Red Deep · white | same | Primary button |
| `ok` · `bad` (+ `-tint`) | #5FD39A · #FF8078 | #1F7A4A · #B42318 | "Do" / "Don't" marks in guidance, always with a word or ✕ |
| `grid-dot` | #2A2D32 | #D4D4D4 at 50% | Dot grid |

### Brand core and action reds

| Name | Token | Hex | Use |
|---|---|---|---|
| Matrix Red | `bm-accent` | #EC362E | Emphasis words, dots, ticks, glows. Large text and graphics only. |
| Red Fill | `bm-accent-fill` | #D92D22 | Primary buttons with white text (4.83:1). |
| Red Deep | `bm-accent-deep` | #C62519 | Hover state, gradient end, small red text on white. |
| Red on Ink | `bm-accent-on-ink` | #FF5A4F | Red text and ticks on dark grounds (6.19:1). |
| Logo Red | `bm-logo-red` | #D42221 | Sampled from the logo. Reference only, for matching print. |
| Logo Blue | `bm-logo-blue` | #005ABC | Sampled from the logo. Logo and cube only, never as an accent. |

### Neutrals

| Name | Token | Hex | Use |
|---|---|---|---|
| Ink | `bm-ink` | #0F1011 | Dark backgrounds, covers, slides. |
| Ink 2 | `bm-ink-2` | #1C1F22 | Cards and panels on Ink. |
| Paper | `bm-paper` | #FFFFFF | Light backgrounds, documents. |
| Graphite | `bm-text` | #1C1C1C | Body text on Paper. |
| Slate | `bm-text-2` | #4E4E4E | Secondary text on Paper. |
| (tertiary) | `bm-text-3` | #6C6C6C | Tertiary text on Paper only. |
| Mist | `bm-text-inv` | #F1F2F3 | Headlines and body on Ink. |
| Fog | `bm-text-inv-2` | #B9BBBF | Secondary text on Ink. |
| Line | `bm-line` · `bm-line-ink` | #E6E6E6 · #2B2D31 | Dividers, borders, table rules. |

### Red gradient: the emphasis word only

`bm-gradient-emphasis` = `linear-gradient(98deg, #F4564E 0%, #EC362E 34%, #C62519 100%)`. Apply it through `Emphasis` and nowhere else.

### Contrast: measured WCAG ratios

| Text / ground | Ratio | Level | Use |
|---|---|---|---|
| Graphite on Paper | 17.04:1 | AAA | All body text |
| Mist on Ink | 16.99:1 | AAA | All body text on dark |
| Fog on Ink | 9.91:1 | AAA | Secondary text on dark |
| Slate on Paper | 8.32:1 | AAA | Secondary text |
| Red on Ink | 6.19:1 | AA | Red text on dark |
| White on Red Deep | 5.71:1 | AA | Buttons, hover |
| White on Red Fill | 4.83:1 | AA | Primary buttons |
| Matrix Red on Ink | 4.66:1 | AA | Headlines, emphasis |
| White on Matrix Red | 4.09:1 | Large only | 18px bold / 24px+ only. Use Red Fill for buttons. |

`line` and `line-strong` are below 3:1 on their grounds: never let a hairline be the only thing that shows where a control is.

## Typography: three faces, three jobs

A tight display face for headlines, a clear workhorse for reading, and a monospace for labels and data. All three are free on Google Fonts and ship with this system as variable fonts (Latin).

| Job | Family token | Face | Use for | Settings |
|---|---|---|---|---|
| Display | `display` | Inter Tight 600 | Headlines, covers, slide titles, big numbers | Tracking −3.2%, line height 1.02–1.1 |
| Body | `body` | Inter 400 / 500 | Paragraphs, UI, captions | Line height 1.65 |
| Utility | `mono` | JetBrains Mono 500 | Eyebrows, labels, stats, URLs | Uppercase, tracking +13% |

Type scale (web, 16px base; styles hold the desktop size, the phone size is in each note): `display` 38–68px · `h1` 31–48px · `h2` 26–36px · `h3` 21–26px · `lead` 17–19px · `body` 16px · `small` 13–15px · `label` 12px caps. Component styles: `button` (600 15px/1), `stat` (Inter Tight 600 28px/1), `eyebrow` (mono 12px/1, +16%), `caption` (mono 10.5px, +12%). Set mono labels and captions in `text-3`.

- Sentence case for headlines. Caps only for mono labels.
- One red emphasis word per headline, at most.
- Left-align body text. Centre only short covers and hero lines.
- Keep lines near 65 characters.
- **Office fallbacks** (Word, PowerPoint, Google Docs): `office` (Arial) for headlines, bold and tight, and for body; `office-mono` (Consolas or Courier New, uppercase) for labels. Email signatures use Arial only, so every inbox renders them the same.

## Signature elements: what makes it look like us

Five details taken from big-matrix.com. Two of them, **the dot grid and the red glow, are the brand signature: every piece carries both, together**, on Ink and on Paper alike: slides, posts, covers, documents, email, print. Then add one or two of the other three; all five at once gets noisy.

### The signature: dot grid + red glow, always on

1. **Dot grid** (`DotGrid`): the matrix made literal. `grid-dot` dots of `grid-dot-radius` every `grid-pitch`, full-bleed across the whole ground; always a regular grid, never random, never cropped to one corner, faded out or left off. For images platforms shrink (profile pictures) widen it to `grid-pitch-small-image`. On 1920 × 1080 slides and anything seen on a projector or big screen, use the presentation scale: `grid-dot-slide` dots of `grid-dot-radius-slide` every `grid-pitch-slide`, so the grid is still visible from the back of the room.
2. **Red glow** (`Glow`): radial, from the top-right corner, 82% across and above the top edge; Matrix Red at `glow-ink` on Ink, `glow-paper` on Paper; optional second glow bottom-left at `glow-2-ink` / `glow-2-paper`. It is a 2:1 ellipse about 1.2× the piece's width in radius, fading out by 64% of it. Warms the ground. Corners only: keep headlines clear of the top-right.

**How they stack:** the glow first, the dot grid over it, then the content. Cards and panels (`surface`) cover the grid where they sit; the grid must still show around them. If either the dot grid or the glow is missing, or the grid can't be seen at the size the piece is viewed, the piece is not on brand.

### Accents: pick one or two

3. **Eyebrow pill** (`Eyebrow`): mono caps (`eyebrow` style, +16%) in `text`, a 7px `accent` dot, a 1px `line-strong` border, fully rounded, 9px × 16px. It sits above a headline to name the brand, a series or a category ("BIG-MATRIX SOLUTIONS", "CAREERS", "CASE STUDY").
4. **Red emphasis word** (`Emphasis`): the one word that carries the idea gets the red gradient, as in "Built for *clinical* teams". Everything else stays `text`.
5. **Red tick** (`Tick`): 2px `accent` dashes between `tick-min` and `tick-max`. Flank a lowercase URL (12px ticks, mono 13px in `text-2`), or sit on top of each stat in a row of numbers (20px).

**Not part of the brand:** floating cubes, particles or scattered shapes (the cube appears only as the logo); neon glows, lens flares, 3D renders of brains or circuits; gradients other than `bm-gradient-emphasis`; blue as a background or accent colour.

## Layout & spacing: a 4px system

Every gap is a step on one scale: `space-4` · `space-8` · `space-12` · `space-16` · `space-24` · `space-32` · `space-48` · `space-64` · `space-96`. That is what makes separate pieces feel engineered together.

- **Radius:** `radius-2` and `radius-4` are available on the scale; `bm-r` (6px) for buttons and inputs; `bm-r-lg` (10px) for cards and stat bars; `bm-r-pill` for eyebrows and tags. Nothing rounder.
- **Margins in graphics:** keep text at least `margin-graphic` (8% of the width) from any edge.
- Keep logos and text out of the bottom-left of Facebook and LinkedIn covers, where the profile picture overlaps.
- Align to a centre axis or a single left edge. Never both in one piece.
- **Elevation:** no drop shadows on cards, panels or the logo. Set cards apart with `surface` and a `line` border. The primary button alone carries `shadow-primary`.
- **Lists:** mark list items with an 8 × 2px `accent` dash instead of a bullet, in `text-2`.
- **Focus:** every interactive element shows a solid `accent` outline, `focus-width` wide and `focus-offset` from its edge, on keyboard focus.

## Imagery & icons: real places, real people, real screens

- **Use:** our team, our office, partner hospitals and client businesses (with consent); clinicians using our software on real devices; close crops of screens showing real UI; natural light, neutral colour, slightly cool.
- **Avoid:** stock handshakes, glowing brains, holograms, robots; identifiable patients, or any screen showing patient data; heavy filters, colour casts, AI-generated people.
- **Text over photos:** darken with a `bm-ink` overlay between `photo-overlay-min` and `photo-overlay-max`; white logo and Mist (`bm-text-inv`) text only; keep a calm area for text and don't fight the subject.
- **Icons:** outline style, `icon-stroke` at `icon-size`, rounded joins. The site uses Bootstrap Icons; this system ships no icon files. Colour icons `text` (Graphite or Mist); `accent` only for the active or key item. One icon set per piece.

## Components & applications

The components live in `components/bundle.js` as `window.BigMatrix` and expect React 18 on the page; their styles are in `components/bundle.css` and read the tokens above.

- **Button:** `button` type, 14px × 20px, `bm-r` corners, arrow at the end: "Start collaboration →", "Explore solutions →", "Read the case study →". **Primary** is Red Fill (`action`) with a white label and `shadow-primary`, one per view; **secondary** is `ground` with a `line-strong` border; **text** is a `link` label alone.
- **Card:** `surface`, `line` border, `bm-r-lg`, 20px padding; a mono `label`, a display-face title and 14px `text-3` copy.
- **StatBar:** equal cells on the `ground` with a `line-strong` outline and dividers, a 20px tick on each cell's top edge, `stat` numbers and `caption` labels.
- **Presentation title slide (16:9):** Ink ground with glow and dot grid; padding 6% × 7%; eyebrow pill ("PARTNER BRIEFING"); headline with one red word, at most 16 characters a line ("Intelligent infrastructure for *modern* hospitals"); primary lockup at 22% width and "BIG-MATRIX.COM" in `text-3` mono caps at the foot.
- **Presentation slides (1920 × 1080):** every slide, Ink or Paper, title or content, carries the full-bleed dot grid at the presentation scale (`grid-pitch-slide`, `grid-dot-radius-slide`, `grid-dot-slide`) over the red glow (`glow-ink` or `glow-paper`); statement slides (title, closing, thank-you) add the second glow. Content slides end in one footer row, 64px above the bottom edge: a red tick and BIG-MATRIX SOLUTIONS on the left, the page number as "PAGE 02/17" on the right, both in mono caps `text-3`.
- **Business card (85 × 55 mm):** front (Ink): the primary lockup alone, centred at about two-thirds of the card's width, over a fine dot grid with the red glow in the top-right corner. Back (Paper), a spec-sheet layout with 8% margins aligned to the left and right edges: red tick, Full Name (display face), ROLE TITLE (mono caps, `text-3`), a large cube watermark at 8% opacity bleeding off the top-right corner, a `line` hairline, then E / T / W in mono `text-3` beside name@big-matrix.com, +880 phone number, big-matrix.com, and BIG-MATRIX SOLUTIONS bottom-right. See the **BusinessCard** card.
- **Email signature (Arial):** a 600 × 120 white panel with the dot grid across it and the red glow in the top-right corner (in email, use `Email/bms-email-bg.png` as the cell background, since inboxes strip CSS effects); cube mark (56px) on the left; Full Name (600 15px) / Role title · Big-Matrix Solutions (13px, `text-2`) / **big-matrix.com** in semibold Red Fill · +880 phone number (12px, `text-3`).
- **Social posts:** Ink ground for announcements and links, Paper for stats; padding 8%; logo at 38% width; detail lines and URLs in mono caps at 70% opacity.
- Social sizes and post templates are in **Social media**; the eleven checks before anything goes out are in **Pre-publish checklist**.
