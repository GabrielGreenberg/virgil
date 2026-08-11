<!-- historical-record: docs/virgil-design-system -->
> **Historical — not the spec.** Part of the frozen April-2026 design-system
> migration record. The live style spec is
> [`src/STYLE_GUIDE.md`](../../src/STYLE_GUIDE.md); where this file and the code
> disagree, the code is right and this file is history. Start at
> [README.md](README.md).

# 02 — Typography

## Families

```
--font-serif:    Source Serif 4, Georgia, serif       Editor body, headings, blockquote
--font-sans:     Inter, system-ui, sans-serif         App chrome, panels, marginalia
--font-mono:     ui-monospace, monospace              Code, math, LaTeX commands
--font-display:  (same as serif unless overridden)    Reserved for future title treatments
```

Each has a `*-override` companion (`--font-serif-override`, etc.) which
the user can set via the Tweaks panel. **Always read the override
first**: `var(--font-serif-override, var(--font-serif))`.

## Editor scale (serif)

```
H1            1.75rem   weight 700
H2            1.35rem   weight 600
H3            1.15rem   weight 600
Body          1.05rem   weight 400   line-height 1.6 (token: --editor-line-height)
Blockquote    inherits  italic       muted color via --blockquote-text
Inline math   0.9em     mono
```

H1 color is locked to `--foreground`. H2/H3 color is locked to
`--editor-text-color`. Don't override these per-component.

## Panel chrome scale (sans)

```
Panel header title       14px   weight 600   --panel-header-size
Panel body / cards       13px   weight 400   --panel-font-size
Card title               0.78rem (12.5px) weight 500
Badge label              10px   weight 600   uppercase no
Annotation chips         0.68rem (10.9px) weight 400
```

The panel chrome scale is small on purpose; pods feel "tool" not
"document."

## Marginalia & paragraph annotations

```
.par-title-annotation       --par-title-size  weight 500  --par-title-color
.heading-annotation         0.68rem            weight 400  --heading-annotation-color
.title-field-annotation     0.68rem            weight 400  --heading-annotation-color
```

These annotations are *not* the same as section content — they're
metadata about the section. Sans-serif, smaller, colored.

## Rules

1. **One family per role.** Editor = serif. Chrome = sans. Code = mono.
   No mixing.
2. **No hand-rolled font-stacks.** Always go through the variable.
3. **Heading sizes don't change with screen size.** They're calibrated
   to the page width, not the viewport.
4. **Body text is never below 13px.** Marginalia and badge labels are
   the only places where smaller is permitted.
5. **No italic except blockquote.** Italics in
   panels read as "I forgot what to use here."
6. **Numerals are tabular** for any list of numbers (counts, page
   numbers, footnote numbers). Add `font-variant-numeric: tabular-nums`.
7. **letter-spacing is reserved** for chip labels (`0.04em`) and small
   uppercase annotations. Body text is never tracked.

## What to never do

- Don't use `Inter` for editor body. It looks like a slack message.
- Don't use serif in panels. The pods feel like documents instead of
  tools.
- Don't introduce a new family for "display" without a written reason.
  Three families is already a lot.
