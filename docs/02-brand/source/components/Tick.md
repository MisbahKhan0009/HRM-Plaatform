# Tick

A short red dash, 2px tall and 12 to 20px wide, that flanks a URL or marks each stat in a row of numbers.

- **Provide:** optionally `width` in px (clamped to `tick-min`–`tick-max`, default 16).
- Colour is `accent`: Red on Ink on Ink, Matrix Red on Paper.
- **Flanking a URL:** wrap a tick, the lowercase URL and a tick in `.bm-url` (500 13px mono in `text-2`, 12px gaps), using 12px ticks: — big-matrix.com —.
- **Above stats:** `StatBar` draws its own 20px ticks on the bar's top edge.
- Never as a bullet on its own or as decoration.
