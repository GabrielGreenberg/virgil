---
description: Numbered examples / expex conversion, formal-semantics math, user note processing (Step 3.h).
arguments: <citekey>
---

# Examples & user notes

> Shared doctrine: read [_doctrine.md](_doctrine.md).

Operates on `papers/$ARGUMENTS/main.tex` and
`papers/$ARGUMENTS/virgil/notes.json`. The canonical narrative is
[deep-index.md](deep-index.md) §3.h₁ / §3.h₂.

## Step 3.h₁ — User notes

Read `papers/$ARGUMENTS/virgil/notes.json` for `kind: "todo" |
"suggestion" | "footnote" | "citation" | "note"` entries that ask
for body edits. Each gets processed per the [editor-side
review](../../editor/AGENTS.md) skill set (which lives in
`/editor/answer-*` and `/editor/draft-*`).

## Step 3.h₂ — Numbered examples / expex conversion

**Bias toward NOT converting** in these genres:

- **Book genre** — typically zero numbered examples; this step is a
  no-op.
- **High cross-reference density** (Chomsky 1957's 120 examples
  with `see (29ii)` inline patterns) — converting one without
  rewriting every back-reference breaks rendering. Defer with
  `examples-not-converted-due-to-cross-reference-density` warning.
- **Formal-semantics-heavy papers** (Davidson, Schlenker family,
  Lascarides) — heavy inline notation (lambda calculus,
  set-builder, ASL glosses) renders fine as inline math; the expex
  envelope adds complexity without value.

**Formal-semantics math pre-pass** (Davidson, Schlenker, etc.):

```bash
python3 .virgil/scripts/mathify_formal_semantics.py papers/$ARGUMENTS/main.tex \
    --predicates demonstration,agent,theme,locating,similar,move,see
```

Converts OCR-mangled `λ` → `\lambda`, `∃` → `\exists`, `∧` →
`\wedge`, Heim-Kratzer brackets `[[X]]` → `[\!\![X]\!\!]`, lambda
chains `kdke` → `\lambda d\, \lambda e\,`, subscripts `e1` → `e_1`.
Wraps predicate names in `\text{}` to keep them upright.

**Batch numbered-example conversion** (linguistics papers with 50+
examples):

```bash
python3 .virgil/scripts/bulk_convert_numbered_examples.py papers/$ARGUMENTS/main.tex \
    --out /tmp/$ARGUMENTS-proposals.json
# review the proposals, then:
python3 .virgil/scripts/bulk_convert_numbered_examples.py papers/$ARGUMENTS/main.tex --apply
```

Top-level `(N)` examples become `\ex[exno=N] \vexid{<uuid>} body
\xe`; sub-items `(Na)` / `(Nb)` get grouped under a parent `\pex`
block with `\a` sub-items.

Refuses to convert inside:

- `\begin{enumerate}…\end{enumerate}` envelopes (those are
  enumeration lists, not linguistic examples).
- `\begin{quote}` blocks.
- The References section.
- Theorem / proposition / lemma numbering contexts.

**Wrap bare numbered prose into enumerate envelopes** (NOT into
expex) when the source shows `^1. Foo` paragraph leaders for
Annual-Reviews SUMMARY POINTS / KEY POINTS / FUTURE ISSUES /
CONCLUSIONS lists. The §3.h₂ "do NOT convert" rule applies to
existing `\begin{enumerate}` blocks, not to bare numbered prose
that's *missing* its enumerate envelope.
