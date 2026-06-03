<!-- last-verified: 8ed5779 2026-06-03 -->
<!-- derives-from: docs/architecture/VIRGIL.md#cowork-pattern -->
<!-- covers-code: editor/skills, editor/scripts -->

# Virgil operational manifest

The operational manifest is the **per-kind knowledge** Virgil's mechanical
skills load on demand: each card kind's reading protocol, the `.tex` atom
mechanics, and the current on-disk sidecar shape. It is the Layer-3 companion
to the conceptual spine in [VIRGIL.md](../architecture/VIRGIL.md) — where the
spine states the *concept* and forward-points here, the manifest holds the
*operational detail* (shapes, anchors, the exact write path).

Source lives in `docs/workspace/`; it ships to each paper's `.claude/virgil/`
via the skill-sync engine (the sync wiring is a later chip — see
[VIRGIL.md → Document discipline](../architecture/VIRGIL.md)). Each manifest doc
is a single-topic Layer-3 doc and carries the doc-graph header block
(`last-verified` / `derives-from` / `covers-code`) at its top.

> **Vertical-slice status.** This is the manifest's first sliver — **footnotes
> only**, extracted while building the `apply_response.py` v1 contract and
> validating it through the footnote kind. The full manifest (all card kinds,
> partly machine-generated from `src/lib/types.ts`) is a later chip. Entries
> here are written against the *current* shapes; revisit any entry whose
> `covers-code` the card-system refactor touches.

## Reading protocols (read before acting on a kind)

| Kind | Read first | When |
|---|---|---|
| `footnote` | [footnotes.md](footnotes.md) | Handling a `kind: footnote` Task, or running `create-card --kind=footnote` / `draft-footnote`. |
| `note` · `todo` · `citation` · `quotation` · `example` · `annotation` | _(TODO — later chips)_ | Each adds its own manifest entry + `create-card` `--kind` implementation on the same contract. |

## The write path every kind shares

All card writes flow through one contract — the mechanical skills never write
files directly:

```
create-card --kind=<k>  →  create_card.py  →  apply_response.py <subcommand>
                                               ├─ acquire the editing pen
                                               ├─ atomic N-file write (card +
                                               │  .tex + ai-requests + notif +
                                               │  version), all-or-nothing
                                               └─ release the pen
```

Subcommand by the Task's `safetyLevel`: `1 → write-silent`,
`2 → write-with-comment`, `3 → complete-task --propose`; none → `complete-task`
(direct create). See [VIRGIL.md → Cowork pattern](../architecture/VIRGIL.md#cowork-pattern)
for the conceptual model and `apply_response.py`'s module docstring for the CLI.
