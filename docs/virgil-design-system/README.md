# Virgil Design System

This folder is the canonical reference for Virgil's UI. **Read every file in
order before making changes.** Then execute `MIGRATION.md` one pass at a
time.

## Audience

This folder is written for an engineering agent (Claude Code) working in
the `virgil/` repo. It assumes you can read TypeScript, Tailwind v4, and
the existing codebase.

## How to use it

1. **Read in order.** Files are numbered. Each file is short and assumes
   you've read the previous ones.
2. **Treat the prose as the spec, not the suggestion.** Where this folder
   conflicts with the current code, the code is wrong.
3. **Open `reference.html` in a browser** for visual reference. It's a
   single-file rendering of every token, theme, button, card, modal, and
   editor inline. Use it to eyeball the target state.
4. **Execute `MIGRATION.md` in order.** It's broken into seven passes,
   each a single concern, each landable as one PR. Don't combine passes.

## File map

| File | What it is |
|---|---|
| `00-overview.md` | What changed, why. One-page mental model. |
| `01-tokens.md` | Every CSS variable. Locked aliases. The new scales. |
| `02-typography.md` | Families, sizes, weights, rules. |
| `03-spacing-and-icons.md` | 4-px grid, three icon sizes, stroke rules. |
| `04-interaction.md` | Hover, selection, focus, drag affordances. |
| `05-cards-and-themes.md` | The five-token theme shape. All eleven themes. |
| `06-panels-and-headers.md` | Panel slots, locked header height, slot rules. |
| `07-buttons-and-inputs.md` | Five button variants × three sizes. |
| `08-modals-and-drag.md` | SystemDialog sizes, drag ghosts, drop targets. |
| `09-editor-and-marginalia.md` | Inline elements, gutter markers, top bar. |
| `10-audit.md` | Twelve-item worklist. Where the current code drifts. |
| `11-style-guide.md` | Drop-in replacement for `src/STYLE_GUIDE.md`. |
| `MIGRATION.md` | Pass-by-pass execution plan. |
| `reference.html` | Visual reference. Open in a browser. |
| `patches/` | Concrete code starting points for the first three passes. |

## Migration mode

**Breaking.** Old token names are removed, not aliased. Component classes
are rewritten. The point of the system is to flush inconsistencies; an
alias layer would defer that work indefinitely.

If a consumer breaks, fix the consumer. Don't add a back-compat shim.

## What this folder does *not* contain

- New product features. The audit (file 10) is exclusively about
  systematizing what exists, not adding capability.
- Visual redesign. Colors, type, and metaphors are unchanged. The
  intent is to make the existing system internally consistent.
- Marketing or landing-page guidance. App chrome only.

## Owner

The author of this folder is Virgil's design lead. Questions about
intent go through them. Don't reinterpret the prose; ask.
