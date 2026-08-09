<!-- historical-record: docs/virgil-design-system -->
> **Historical — not the spec.** Part of the frozen April-2026 design-system
> migration record. The live style spec is
> [`src/STYLE_GUIDE.md`](../../src/STYLE_GUIDE.md); where this file and the code
> disagree, the code is right and this file is history. Start at
> [README.md](README.md).

# 04 — Interaction

Five interactive states. Every interactive surface implements them in
the same way.

## 1. Hover

Two utility classes. Pick by background.

```css
.hover-on-light {
  /* Use when resting bg is white, pod-editor, surface-muted, or any
     light cream surface. */
  transition: background-color 120ms ease-out;
}
.hover-on-light:hover {
  background-color: var(--surface-muted-strong);
}

.hover-on-dark {
  /* Use when resting bg is pod-panel, header-bg, or topbar-bg —
     darker pods where surface-muted-strong wouldn't stand out. */
  transition: background-color 120ms ease-out;
}
.hover-on-dark:hover {
  background-color: rgba(0, 0, 0, 0.04);
}
```

**Never**:

- `hover:bg-stone-50`, `hover:bg-stone-100`, `hover:bg-stone-100/70`,
  `hover:bg-stone-200/50`. These are the same idea spelled five ways.
- Border-color hover for icon buttons. Use background.
- Hover shadow changes (no "lift on hover"). The pod is already lifted;
  hovering doesn't lift further.

## 2. Selection

Selection is **always themed**. There is no default selection color.

Each card kind has a theme (`05-cards-and-themes.md`). Selection uses
that theme's `borderSelected` and `headerSelected` tokens.

```tsx
// Right
<PanelCard theme={CARD_THEMES.note} selected={isSelected}>...

// Wrong — no fallback amber
<div className={selected ? "border-amber-300" : "border-edge-hover"}>
```

The previous "default amber selection" (`CARD_SELECTED` in
`panel-primitives.tsx`) is **deleted**. If a consumer doesn't know its
theme, it doesn't get to render a card.

## 3. Focus

Keyboard focus uses a 2px ring in `--edge-strong`, offset 1px:

```css
focus-visible:ring-2 focus-visible:ring-edge-strong focus-visible:ring-offset-1
```

Inputs use `border-edge-strong` on focus, no ring (the border thickening
is the focus indicator).

Don't use blue browser default focus. Don't use `outline: none` without
replacing it.

## 4. Active / pressed

Buttons depress 1px on press:

```css
active:translate-y-[0.5px]
```

The drag handle uses a stronger pressed state — see `08-modals-and-drag.md`.

## 5. Disabled

```css
opacity-40 pointer-events-none cursor-not-allowed
```

Disabled is **not** a desaturated color or a different border. It's an
opacity reduction with the cursor changed.

The exception is the `CardTargetIcon` "disabled" state (orphaned cards),
which uses `30%` opacity to visually distinguish "this anchor is
unreachable" from "this button is disabled."

## Drag affordances

Three drag-related visual states:

### Resting handle

`opacity-0 group-hover:opacity-60` — invisible until card hover, then
faint. Color: `text-ink-faint`.

### Hover handle

`group-hover:text-ink-muted` — the parent card hovers, the handle
darkens.

### Pressed handle (mid-drag)

```css
.par-drag-handle:active,
.par-drag-handle.is-pressed {
  color: var(--ink-body);
  background: rgba(0, 0, 0, 0.08);
  border-radius: 3px;
  transform: translateY(1px);
}
```

The handle reads as a button while held.

### Drop targets

A drop-eligible target gets a 2px dashed amber outline:

```css
outline: 2px dashed var(--ring-drag-target);
outline-offset: -2px;
background: color-mix(in oklab, var(--ring-drag-target) 12%, transparent);
```

A *line* drop indicator (between two paragraphs) uses
`--drag-highlight` (blue) at 2px solid.

## Click semantics

- **Click the card body** → selects the card.
- **Click outside any card** in a panel list → deselects.
- **Cmd/Ctrl+Click a marginalia marker** → opens its panel (if closed).
- **Plain click a marginalia marker** → selects + scrolls to its card.

These are universal. Panels do not get to override them.

## Keyboard

Every action with a button has a keyboard shortcut. The shortcut is
shown in the button's tooltip (after a 500ms hover delay).

The Y/N/S vocabulary for suggestions extends to other binary acceptance
flows — see `09-editor-and-marginalia.md`.
