# Button

The site's button in three variants, label first and arrow at the end: primary for the one thing the view is for, secondary for the alternative, text for a quiet link-style action.

- **Provide:** `children`, a verb-first label of two to three words ("Start collaboration", "Explore solutions", "Read the case study", "Book a demo", "Apply now"); `variant` (`"primary"` default, `"secondary"`, `"text"`); `href` to render a link; `arrow={false}` to drop the arrow.
- **Primary:** Red Fill (`action`) with a white label (`on-action`) and the soft red `shadow-primary`; hover `action-hover` (Red Deep). **One primary button per view.**
- **Secondary:** `ground` fill, `text` label, `line-strong` border (hover: border in `text`). The border is below 3:1, so the label is what marks it as a button: keep labels explicit.
- **Text:** `link` red label, no fill or border, 4px side padding.
- All: `button` type (600 15px/1), 14px × 20px padding, `bm-r` corners, 10px gap before the arrow; keyboard focus draws a `focus-width` outline in `accent`, `focus-offset` from the edge.
- Don't set white labels on Matrix Red (`bm-accent`): 4.09:1, large text only.
