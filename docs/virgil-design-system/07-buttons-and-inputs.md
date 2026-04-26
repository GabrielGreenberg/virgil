# 07 — Buttons & Inputs

Five button variants. Three sizes. That's everything.

## Button variants

### `primary`

Used for *the* action on a surface — the one you'd click without
reading. There is at most one primary per modal / panel / card.

```
bg-accent              text: white
hover: brightness 92%  active: translate-y 0.5px
disabled: opacity 40%
```

Color: `--accent` (warm brown). Not blue. Blue isn't a Virgil color
except for inline editor markers.

### `secondary`

The default for "standard action" buttons (Save in a non-destructive
context, Apply, Continue).

```
bg-surface             text: ink-body
border: edge-hover     hover: bg-surface-muted-strong, border-edge-strong
```

### `warm`

A spotlit-but-not-primary variant in the brand color family. Used for
the "Yes / Apply" affirmation in suggestion flows, AI accept buttons.

```
bg-accent-light        text: accent
border: 1px solid color-mix(--accent 40%, transparent)
hover: brightness 95%
```

This is the variant that replaces the `bg-blue-100 text-blue-800`
patterns currently scattered across the codebase. There are no blue
buttons in panels.

### `danger`

Destructive action — confirm delete, discard. Always paired with a
`secondary` "Cancel" alongside.

```
bg-danger-soft         text: danger
border: 1px solid color-mix(--danger 30%, transparent)
hover: bg-danger 10%   active: translate-y 0.5px
```

The trash *icon* button (in card chrome) is also danger-colored but
uses `iconbtn-*` sizing (see below).

### `ghost`

Borderless, transparent. Used for "Cancel", "Skip", and similar
de-emphasized actions.

```
bg: transparent        text: ink-subtle
hover: bg-surface-muted-strong, text: ink-body
```

## Button sizes

| Size | Height | Padding | Font |
|---|---|---|---|
| `sm` | 24px | `px-2.5 py-0.5` | 12px |
| `md` | 32px | `px-3 py-1.5` | 13px |
| `lg` | 40px | `px-4 py-2` | 14px |

Each size has the same border-radius (`rounded-md`, 6px). Smaller
buttons don't get smaller radii.

## Combine

Variant × size = 15 combinations. Code lives in
`panel-primitives.tsx` as `<Button variant="primary" size="md">`. Don't
hand-roll. Don't mix Tailwind utilities to imitate.

## Icon buttons

Three locked sizes — see `03-spacing-and-icons.md`:

```
.iconbtn-sm   20×20    inline editor toolbar
.iconbtn-md   24×24    panel headers, top-bar
.iconbtn-lg   32×32    omni primary, panel-strip toggles
```

All three share:

```css
border-radius: 4px;
color: var(--ink-muted);          /* default */
transition: background-color 120ms;
```

States:

- Hover: `bg-surface-muted-strong` + `text-ink-body`.
- Active (toggle ON): `bg-pod-dark/80` + `text-ink-strong`.
- Pressed: `translate-y-[0.5px]`.
- Disabled: `opacity-40 pointer-events-none`.

The trash button is a `iconbtn-sm` with `text-danger` and
`hover:bg-danger-soft`.

## Inputs

### Text input

```
bg-surface
border: 1px solid edge-subtle
rounded-md (6px)
height: 32px (sm), 36px (md, default), 44px (lg)
padding: 0.5rem 0.75rem
font: 13px sans
```

Focus: `border-edge-strong`, no ring. The thicker border *is* the
focus indicator. Placeholder: `text-ink-muted`.

### Card title input

A specialized inline input used inside cards. See
`CardTitleInput`. Inherits from text input but:

- Border: none, only a `border-bottom: 1px solid theme.titleColor` on
  focus.
- Background: transparent.
- Font: sans, 0.78rem, weight 500, color = `theme.titleColor`.

Don't reuse this style elsewhere; it belongs inside cards.

### Textarea

Same border + radius + focus rules as text input. Min-height 64px.
Auto-grow to content height; cap at 240px and scroll.

### Select / dropdown

There's no native `<select>` in the system. Dropdowns are popovers
(`<ItemMenu>`). The trigger is an `iconbtn-md` showing a chevron-down.

### Checkbox / toggle

Toggle (the soft kind):

```
22×14 pill, rounded-full
off: bg-edge-hover, thumb on left
on:  bg-accent, thumb on right (translate-x 8px)
transition: 150ms
```

Checkbox (true binary):

```
16×16 box, rounded-sm
off: border-edge-strong, bg-surface
on:  bg-accent, border-accent, white check glyph
```

Use checkbox for "include this item." Use toggle for "turn this feature
on."

### Color swatch

Square 16×16, `rounded-sm`, 1px white inset border, drop shadow. The
panel-color picker uses this. Click opens the preset popover from
`panel-theme.ts`.

## Form layout

- Labels above inputs, not beside.
- Label: 12px, `text-ink-subtle`, weight 500, mb-1.
- Help text: 11px, `text-ink-muted`, mt-1.
- Error text: 11px, `text-danger`, mt-1.
- Form field group: `space-y-3`.
- Form section: `space-y-6`.

## Forbidden

- `bg-blue-*` buttons. There is no "blue button" in Virgil.
- Hand-rolled icon buttons with arbitrary padding.
- Buttons without a variant. Pick one.
- Borderless inputs (except `CardTitleInput`).
- Two primaries on one surface.
- Tooltip-only buttons. Every button has a visible label or a recognized
  glyph.
