# 01 — Tokens

All design tokens live in `src/app/globals.css` under `:root`, then are
exposed as Tailwind utilities via `@theme inline`. Consumers read tokens
via Tailwind classes (`bg-surface`, `text-ink-muted`) or CSS `var()`.

**Rule: no hex colors in component code.** If you need a color that
isn't in this file, add it here first. Then use it.

## Locked aliases

These pairs MUST track each other. The locking is enforced via
`var(--other)` in the source, not by convention.

| Token | Locked to | Why |
|---|---|---|
| `--theme-color` | `--topbar-bg` | PWA chrome and in-app top bar must match. |
| `--main-tab-bg` | `--background` | Active tab joins the canvas; same color. |
| `--pod-editor` | `--surface` | Editor pod and "paper" surfaces are one color. |
| `--h1-color` | `--foreground` | H1 and primary body text are one color. |
| `--h2h3-color` | `--editor-text-color` | H2/H3 and body are one color. |
| `--scrollbar-hover` | `--muted-light` | Scrollbar hover matches muted text. |

Don't unlock without a written reason. Drift between these pairs is the
single most common cause of "this looks slightly off."

## Canvas & surfaces

```
--background:        #f8f3ed   warm cream paper canvas
--surface:           #ffffff   primary writing surface (cards, popovers, inputs)
--surface-muted:     #fafaf9   list-hover, subpod resting bg
--surface-muted-strong:#f5f5f4 icon-button hover, chip bg
--overlay-scrim:     rgba(0,0,0,0.3)  modal backdrop
```

## Borders (edge scale)

```
--border:        #e5e2dd   pod border (warm)
--border-light:  #c9c5c5   pod stroke (cooler, slightly heavier)
--edge-subtle:   #e7e5e4   card/input border, menu divider
--edge-hover:    #d6d3d1   border hover
--edge-strong:   #a8a29e   input focus border
```

## Text (ink scale)

Ordered light → dark. Use the *role*, not the hex.

```
--ink-faint:   #d6d3d1   disabled text, resting drag handles
--ink-muted:   #a8a29e   placeholders, default icons, timestamps
--ink-subtle:  #78716c   subtitles, panel admin text
--ink-body:    #44403c   section titles, strong readable text
--ink-strong:  #292524   modal titles, primary bold text
--foreground:  #1a1a1a   editor body text, H1
```

## Brand

```
--accent:       #7c5e3c   warm brown, primary brand
--accent-light: #f5f0ea   tinted accent surface
```

## App chrome

```
--topbar-bg:        #dcdbd7   top bar
--topbar-border:    #cbc3b8
--tab-bg:           #dcdbd7   inactive tabs
--main-tab-bg:      var(--background)  active tab (locked)
--library-bg:       #eae7e2   library page surface
--virgil-bar-text:  #78716c
```

## Pods (the "card-on-paper" frame)

```
--pod-editor:    var(--surface)   editor paper
--pod-panel:     #f3f0eb          panel pods (slightly warm)
--pod-toolbar:   #f5f3ef          toolbar pods
--pod-dark:      #eae6df          dark pods
--header-bg:     #e8e5de          panel-header strip

--header-h:      34px             panel header height (LOCKED)
--pod-radius:    8px
--pod-gap:       10px
--pod-border:    1px solid var(--border-light)
--pod-shadow:    0 1px 6px rgba(0,0,0,0.12), 0 0 2px rgba(0,0,0,0.06)
--card-shadow-ambient: 0 2px 6px rgba(0,0,0,0.10), 0 1px 2px rgba(0,0,0,0.06)
```

## Editor

```
--editor-font-size:    1.05rem
--editor-line-height:  1.6
--editor-text-color:   #000000
--par-title-size:      0.78rem
--par-title-color:     #c45a5a   reddish marginalia accent
--blockquote-border:   #d4cfc8
--blockquote-text:     #6b6560
--code-bg:             #f0eeeb
--code-block-bg:       #f5f3f0
--math-color:          #6b4fa0
--math-prefix-color:   #a090c0
```

## Inline elements (in editor)

Each inline element has a stroke / fill / border triple.

```
--comment-color:        #93c5fd
--comment-bg:           rgba(147, 197, 253, 0.25)
--comment-border:       rgba(96, 165, 250, 0.5)

--latex-comment-color:  #7191b0
--latex-comment-bg:     #f0f5fa

--citation-color:       #6b6245
--citation-bg:          #fdf8e1
--citation-border-color:#e0d5a8

--footnote-color:       #b45757
--footnote-bg:          #fef2f2

--note-color:           #15803d
--note-bg:              #f0fdf4
--note-marker-border:   #86efac
```

## Interaction

```
--mark-bg:               #fbbf24      suggestion highlight
--mark-border:           #c8960e
--drag-highlight:        #3b82f6      drop indicator
--ring-drag-target:      #fcd34d      drop-target ring (amber)
--pref-mode-accent:      var(--drag-highlight)  edit-mode outline
```

## Destructive

```
--danger:       #ef4444   destructive action text
--danger-soft:  #fef2f2   destructive hover bg
```

## Tailwind exposure

Every token in the `--ink-*`, `--edge-*`, `--surface-*`, `--danger`,
`--ring-drag-target` scales is exposed via `@theme inline`. Use Tailwind
utilities for these:

```
bg-surface              text-ink-faint        border-edge-subtle
bg-surface-muted        text-ink-muted        border-edge-hover
bg-surface-muted-strong text-ink-subtle       border-edge-strong
bg-overlay-scrim        text-ink-body         ring-drag-target
                        text-ink-strong       text-danger / bg-danger-soft
```

For everything else, use `var(--token)` in inline `style` or in
hand-written CSS.

## Forbidden

- `text-stone-*` in any new code. Use `text-ink-*`.
- `border-stone-*` in any new code. Use `border-edge-*`.
- `bg-stone-50/50`, `bg-stone-100/70`, etc. Use `surface-muted` /
  `surface-muted-strong`, or pre-mix to a hex token if you need a fourth
  level (you don't).
- Hex literals in `*.tsx`. They go in this file.
- `bg-blue-*`, `bg-green-*`, `bg-red-*` in panel chrome. Use the panel
  theme. (Inline editor markers reference `--footnote-color` etc., which
  is fine — those tokens *are* the role.)
