# 08 — Modals & Drag

## Modals (`SystemDialog`)

All modals use `<SystemDialog>` from `src/components/SystemDialog.tsx`.
Three sizes:

| Size | Width | Use |
|---|---|---|
| `sm` | 360px | confirm-delete, single-input prompts |
| `md` | 480px | settings panel, AI request review |
| `lg` | 640px | bibliography import, citation builder |

There is no `xl` and no fullscreen modal. If you think you need one,
you don't.

## Anatomy

```
┌──────────────────────────────────────────────┐  ← pod (radius 8, pod-shadow)
│  Title                                  ✕    │  ← header (40px, divider below)
├──────────────────────────────────────────────┤
│                                              │
│  Body                                        │
│  (inputs, prose, etc.)                       │
│                                              │
├──────────────────────────────────────────────┤  ← footer (separator above)
│                            [Cancel] [Save]   │
└──────────────────────────────────────────────┘
```

- Title: 16px, weight 600, `text-ink-strong`.
- Close X: `iconbtn-md` in `text-ink-muted`.
- Body padding: `1rem 1.25rem`.
- Footer: `0.75rem 1.25rem`, right-aligned button row, `space-x-2`.
- Backdrop: `bg-overlay-scrim`, click-to-dismiss.

## Footer button rules

Right-to-left:

1. **Primary action** is rightmost (Save, Confirm, Apply).
2. **Cancel / Discard** to its left (`ghost` variant).
3. **Destructive action** if applicable, far left (`danger` variant).

Never put the destructive action on the right. Users tab right and hit
enter; if delete is rightmost, they delete.

## Confirm dialogs

`<ConfirmDialog>` is a `sm` modal pre-wired for:

- Delete with content → "Delete this footnote?" + body excerpt.
- Discard unsaved → "Discard changes?".

It anchors near the source element (`anchorRef`), not screen-center.
Center-screen is for system-wide actions; element-anchored is for
surgical actions.

## Modal stacking

Don't nest modals. If a modal wants to confirm something, replace its
content; don't open a second modal on top.

If you absolutely need a transient (e.g. color-picker over a settings
modal), use a `Popover`, not a second `SystemDialog`.

## Drag

Three drag categories. Each uses a different MIME type and a different
ghost.

### 1. Anchor drag (paragraph-level)

Dragging a card's grab handle. Reanchors the entity to a new paragraph.

```
MIMEs: MIME_QUOTATION, MIME_NOTE, MIME_TODO, MIME_ARCHIVE_ANCHOR,
       MIME_CUT, MIME_MARGINALIA_MOVE
Ghost: full card snapshot, offset (10, 28) below cursor
Drop indicator: 2px solid blue (--drag-highlight) horizontal line
                between paragraphs
```

ProseMirror's native dropcursor is suppressed during anchor drags
(see `ANCHOR_DRAG_TYPES` in `marginalia.ts`).

### 2. Inline insert drag (text only)

Dragging a text-handle (3-line icon) on a card body. Inserts text into
the editor without binding identity.

```
MIMEs: MIME_QUOTE, MIME_CITATION, MIME_ARCHIVE, MIME_FOOTNOTE,
       MIME_AI_REQUEST, MIME_TEXT_INSERT
Ghost: white pill, 1px edge-hover border, 11px ink-subtle text,
       max-width 220px, ellipsis
Drop indicator: ProseMirror's native horizontal cursor
```

The neutral ghost is intentional — text-insert drags don't carry
identity, so the ghost shouldn't look like a card.

### 3. Selection drag

Dragging the floating "selection chip" from a text selection into a
panel. Creates a linked-margin item (note / revision / cut) anchored to
the selected range.

```
MIME: MIME_SELECTION_ANCHOR
Ghost: small chip showing first ~40 chars of the selection,
       with a tiny "→ Notes" / "→ Revisions" hint glyph
Drop target: the panel body (not the gutter); panel highlights
             with the drop-target outline
```

## Drop-target outline

Any element that accepts a drop highlights as the cursor enters with a
**dashed amber outline** (the `--ring-drag-target` token):

```css
outline: 2px dashed var(--ring-drag-target);
outline-offset: -2px;
background: color-mix(in oklab, var(--ring-drag-target) 12%, transparent);
```

This is universal: paragraph drop, panel drop, card drop. One look,
many surfaces.

## Drag handles

| Handle | Glyph | Where | Drags |
|---|---|---|---|
| 6-dot grip | `⋮⋮` (vertical pair) | card header | the entity |
| 3-line | `≡` (small) | card body left gutter | text-only |
| Paragraph grip | `⋮⋮` (vertical) | editor paragraph margin | the paragraph (with marginalia) |

The 6-dot vs 3-line distinction is a known UX risk; it's preserved for
now. See `10-audit.md` item 11.

## Cursor states

- `cursor-grab` resting on a draggable handle.
- `cursor-grabbing` while held.
- `cursor-not-allowed` over invalid drop targets.
- Default cursor over the body. Don't `cursor-pointer` non-buttons.

## Forbidden

- Native HTML5 drag preview. Always set a custom `setDragImage`.
- Solid drop highlights. Always dashed outline + low-opacity fill.
- Nested drag categories. A drag is one category for its lifetime.
