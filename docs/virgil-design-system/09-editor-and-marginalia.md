<!-- historical-record: docs/virgil-design-system -->
> **Historical — not the spec.** Part of the frozen April-2026 design-system
> migration record. The live style spec is
> [`src/STYLE_GUIDE.md`](../../src/STYLE_GUIDE.md); where this file and the code
> disagree, the code is right and this file is history. Start at
> [README.md](README.md).

# 09 — Editor & Marginalia

The editor is the heart of Virgil. Its surfaces follow rules that don't
apply to the rest of the app.

## Inline elements (in flow)

Eight kinds of inline atom or mark:

| Kind | Style | Token group |
|---|---|---|
| Footnote marker | superscript red chip | `--footnote-*` |
| Citation | warm-yellow chip with brackets | `--citation-*` |
| LaTeX comment | steel-blue chip with `%` glyph | `--latex-comment-*` |
| Comment (Mode B) | sky-blue underline | `--comment-*` |
| Inline math | mono purple chip | `--math-*` |
| Mark / suggestion | amber highlight | `--mark-*` |
| Linked anchor | invisible until hover | per-kind via `data-link-card` attr |

Each inline element has a *role* (where in the document it lives),
*color* (which token group), and *behavior* (what happens on click /
hover / drag).

### Resting style

Inline atoms are pill-shaped, `rounded-sm` (2px), with the kind's `bg`
and `color` from their token group. Border: 1px in the kind's `border`
color (where defined; otherwise none).

Footnote and citation markers do NOT have a gutter marker. They live
inline and only inline.

### Selected state

When a card linked to an inline atom is selected, the atom gets a
**ring**, not a tint:

```css
box-shadow: 0 0 0 2px var(--ring-drag-target);
border-radius: 3px;
```

This is the only place the amber ring is correct as a default — it's a
neutral selection, kind-agnostic, that lights up regardless of the
inline atom's resting color.

For Mode-B linked-anchor spans (text ranges, not atoms), use the
kind-specific tint via `--link-anchor-color` from
`linked-anchor[data-link-card^=…]`.

## Marginalia gutters

Two gutters: left and right. Both render outside the page text column.

```
Left gutter        Text column        Right gutter
[OUTER 22] [icons] [INNER 8]         [INNER 8] [icons] [OUTER 6]
```

The left gutter is wider because it hosts the heading-fold chevron in
the outer-pad strip. The right is narrower; it has no chevron.

Within each gutter, icons are packed into a 2-column grid (`MARGINALIA_COLS = 2`).

### Marker types

Seven types, all defined in `MARKER_META`:

- `quote` (left default), `note`, `archive`, `revision`, `cut`, `todo`,
  `error` (all right default).

Each `MARKER_META` row: `label`, `panelId`, `defaultSide`, `color`,
`bg`, `selectedBg`, `border`, `icon`. The `icon` is a real
`<IconQuotations />` etc. component from `panel-icons.tsx`, sized 16px.

### Side override

A marker's side is `marker.side ?? MARKER_META[type].defaultSide`. The
panel host can override per-instance. If the panel is closed, the
marker still renders at its default side.

### Per-paragraph packing

Markers anchor to a paragraph UUID. Multiple markers on one paragraph
pack into the 2-column grid. If they overflow (more than `2 * lineCount`
markers), the overflow goes into the last row with a `+N` chip — see
`10-audit.md` item 12 for the design that needs to land here.

### Click behavior

Plain click → opens panel + selects card + scrolls card into view.
Cmd-click → opens panel without scrolling.
Hover → highlights linked text range (if any) via
`useLinkHighlight.ts`.

## Top bar

The application top bar runs above the editor. It's a single row, 40px
tall, `--topbar-bg`.

Slots, left → right:

| Slot | What |
|---|---|
| Logo | `V` wordmark, serif, 18px, `text-ink-body` |
| Project tabs | `<TabBar>` — current project + saved projects |
| Title bar | document title (centered), input on click |
| AI status | sky `★` if AI activity in progress |
| User menu | `iconbtn-md`, opens settings popover |

Top bar uses `hover-on-dark` for hover affordances.

The active-project tab joins the canvas via the locked
`--main-tab-bg = --background` alias. The "swoop" pseudo-element on the
active tab is intentional but a known visual-noise risk — see
`10-audit.md` item 9.

## Suggestion vocabulary

Suggestions (AI-generated changes pending review) use a three-key
shortcut vocabulary:

- **Y** — accept this suggestion.
- **N** — reject this suggestion.
- **S** — skip (defer; show next suggestion).

This vocabulary should extend to other binary-acceptance flows (footnote
accept/reject, AI-request apply/discard). One muscle memory across the
app.

## Editor selection chip

When the user has a non-empty text selection, a floating chip appears
near the selection's bottom edge with three actions:

- → Notes (drag or click)
- → Revisions (drag or click)
- → Cutter (drag or click)

The chip uses `MIME_SELECTION_ANCHOR` for drags (see
`08-modals-and-drag.md`). On click, it opens the matching panel and
creates a card linked to the selection range.

## Forbidden

- Inline atoms with hand-rolled colors. Use the token group.
- Marginalia icons drawn anywhere except `panel-icons.tsx`.
- Per-marker icon sizes (always 16px).
- Top bar with two rows.
- Selection chip with more than three options. The selection is for
  *attaching*, not for editing.
