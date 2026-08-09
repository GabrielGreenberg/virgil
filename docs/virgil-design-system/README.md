<!-- historical-record: docs/virgil-design-system -->
> **Historical — not the spec.** This folder is the frozen record of the
> April-2026 design-system systematization pass. The live style spec is
> [`src/STYLE_GUIDE.md`](../../src/STYLE_GUIDE.md); where this folder and the
> code disagree, **the code is right and this folder is history**.

# Virgil Design System — 2026 migration record

This folder is a **record of a completed migration**, kept for its rationale.
It was written in April 2026 as a spec-to-execute: an engineering agent read it
in order and worked `MIGRATION.md` pass by pass. Those passes ran; most of them
landed. What you are reading is the *before* picture plus the reasoning that
justified each change.

**It is not maintained.** Token values, pixel numbers and "the current code
does X" statements were true in April 2026 and several are wrong now. Read it
for *why a decision was made*, never for *what the value is*.

## Where the spec actually lives

`src/STYLE_GUIDE.md` — the single style spec, kept current, and the one file
`AGENTS.md` routes agents to. It is a strict superset of what this folder ever
said about the live system (~1300 lines to this folder's summary's 272), and it
carries everything landed since: the radius scale, the menu-roving token, the
Library-edge derivation, the omni-bin pill, the hint/tooltip layer, the folder-tab
chrome.

Two CI guards keep this arrangement from silently reverting:

- [`src/__tests__/spec-authority-guardrail.test.ts`](../../src/__tests__/spec-authority-guardrail.test.ts)
  — every file here carries the historical banner, and **no** doc outside
  `src/STYLE_GUIDE.md` claims to be the style spec.
- [`src/__tests__/token-contract.test.ts`](../../src/__tests__/token-contract.test.ts)
  — the *live* spec surfaces may not state a token value that `globals.css`
  contradicts. This folder is deliberately outside that scan: a historical
  document is *allowed* to record the old number, which is exactly why it must
  be unmistakably labelled as historical.

## Why this folder was demoted rather than deleted

It used to bill itself as *the* authoritative UI reference and tell the reader
to read every file in order before touching anything, while `11-style-guide.md`
presented itself as a file you could drop straight over the live style guide.
That relationship reversed as the live guide grew; taking either header
literally would have deleted ~1000 lines of current doctrine. Meanwhile the rationale here is real and
non-duplicated — this is the only place that records *why* the token scales were
consolidated, why the theme shape collapsed to five fields, and which surfaces
were deliberately left alone.

So: kept, banner-marked per file, and stripped of the two parts that could only
mislead (task `2026-07-18-173`).

## What was removed in the demotion

| Removed | Why |
|---|---|
| `11-style-guide.md` | A frozen 272-line subset of `src/STYLE_GUIDE.md` whose header told the reader to overwrite the live file with it. |
| `patches/` | Unapplied patch files. Alone in this folder they described a *proposal*, not what happened — and two of the folder's live-looking errors (`--pod-shadow-light`, `--header-h: 34px`) were "defined" there. |

Both are recoverable: `git log --diff-filter=D -- docs/virgil-design-system/patches/`.

`MIGRATION.md` still references `patches/…` in its Pass 1/4/6 file lists. Those
links are dead by design — the passes are done.

## File map

| File | What it is | Status |
|---|---|---|
| `00-overview.md` | What changed, why. One-page mental model. | rationale, still useful |
| `01-tokens.md` | The April-2026 token block. | **values stale** — read `globals.css` |
| `02-typography.md` | Families, sizes, weights, rules. | mostly landed |
| `03-spacing-and-icons.md` | 4-px grid, three icon sizes, stroke rules. | landed; documents one token that never existed |
| `04-interaction.md` | Hover, selection, focus, drag affordances. | landed |
| `05-cards-and-themes.md` | The five-token theme shape. | landed |
| `06-panels-and-headers.md` | Panel slots, header height, slot rules. | landed |
| `07-buttons-and-inputs.md` | Five button variants × three sizes. | landed |
| `08-modals-and-drag.md` | SystemDialog sizes, drag ghosts, drop targets. | landed |
| `09-editor-and-marginalia.md` | Inline elements, gutter markers, top bar. | landed |
| `10-audit.md` | The twelve drifts the migration set out to fix. | **annotated per item** with what is true now |
| `MIGRATION.md` | The pass-by-pass execution plan. | executed |
| `migration-feedback.md` | Notes written *during* execution. | the honest record of what fought back |
| `questions-for-gabriel.md` | Open questions raised by the pass. | historical |
| `reference.html` | Single-file visual reference of the target state. | as-of April 2026 |

## Doctrine that graduated

Two exception lists in `MIGRATION.md` were live doctrine rather than migration
bookkeeping — the surfaces `iconbtn-*` and `<Button>` deliberately do **not**
model. They now live in `src/STYLE_GUIDE.md` (under *Spacing & icons* and
*Buttons*), because an agent sweeping for hand-rolled buttons needs them and
should never have to read a migration plan to find out that a hand-rolled
topbar toggle is correct.
