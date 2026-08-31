---
description: |
  Convert numbered examples to the `expex` package and format
  formal-semantics math in a linguistics or philosophy paper.
  Triggers on: "convert examples for <citekey>", "format the linguistic
  examples in this paper", "do the expex pass on X", "Virgil, mathify
  the formal semantics in <citekey>". Subskill of /deep-index;
  invoke directly when only example/math conversion is needed. Does
  NOT trigger for general prose cleanup (use /di-clean-prose) or
  footnote recovery (use /recover-footnotes).
arguments: <citekey>
---

# Examples & user notes

> **Allowable-LaTeX doctrine.** The expex examples (`\ex`/`\pex`/`\begingl`)
> and math this skill composes must stick to the vocabulary Virgil renders
> meaningfully — read
> [_latex-output.md](_latex-output.md) — the **library appendix** (document
> structure, expex numbered examples, `\pgmark{N}`, the font-strip rule, the
> minimal preamble) — which links the cross-silo SSOT
> [_latex-allowlist.md](_latex-allowlist.md) for the inline vocabulary (marks,
> math, footnotes, the `\cite…` family, and the tie `~` vs.
> `\textasciitilde{}` rule). Anything outside those two renders as raw grey
> monospace in Virgil. Never re-paraphrase either doctrine here — link to it.

## Bootstrap (run this first)

This skill operates on the user's Virgil Library. Resolve the library
root and cd into it before running anything else.

```bash
# Find library_path.py — synced PWA folders have it under .virgil/scripts/,
# the Virgil source repo has it under editor/scripts/. Either is fine.
library_path_py=""
for candidate in .virgil/scripts/editor/library_path.py editor/scripts/library_path.py; do
  [ -f "$candidate" ] && { library_path_py="$candidate"; break; }
done
if [ -z "$library_path_py" ]; then
  echo "No library set up. Pick a library in Virgil first."
  exit 1
fi
library_root="$(python3 "$library_path_py" --get 2>/dev/null)" || {
  echo "No library set up. Pick a library in Virgil first."
  echo "  (Or run: python3 $library_path_py --set <abs-path>)"
  exit 1
}
cd "$library_root"
export VIRGIL_LIBRARY_ROOT="$library_root"
```

---

> Shared doctrine: read [_doctrine.md](_doctrine.md).

Operates on `papers/$ARGUMENTS/main.tex` and
`papers/$ARGUMENTS/virgil/notes.json`.

## Step 3.h₁ — User notes

If `.virgil/queue/$ARGUMENTS-deepindex.json` (or the legacy
`.virgil/queue/$ARGUMENTS-richindex.json`) carries a `note` field, or
a coexisting `.virgil/queue/$ARGUMENTS-paperreview.json` exists, print
the note verbatim in a delimited block:

```
════════════════════════════════════════════════════════════
DEEP-INDEX NOTE · $ARGUMENTS
────────────────────────────────────────────────────────────
<full verbatim note>
════════════════════════════════════════════════════════════
```

Then act on the note — apply whatever additional fixes or adjustments
the user requested. This is the queue-level user note channel and
lives inside di-examples because the dispatch happens during the
deep-index pass.

A second channel of user requests reaches the paper as sidecar
entries in `papers/$ARGUMENTS/virgil/notes.json`. Read that file for
`kind: "todo" | "suggestion" | "footnote" | "citation" | "note"`
entries that ask for body edits. **di-examples does NOT invoke the
editor skills inline.** The contract is:

- If `notes.json` is missing or `notes: []`: no-op, no warning.
- If one or more matching entries exist: append a single
  outstanding-work item `notes-pending-editor-review (N entries)`
  to the deep-index audit punch-list so the user knows to run
  `/editor/review <docPath>` afterwards. Do not edit the document
  body in this skill; that's the editor skill set's job.

The editor-side skills (`/editor/answer-*` and `/editor/draft-*`,
documented in `editor/AGENTS.md` in the Virgil repo) drain
the queue when explicitly invoked by the user against the paper
folder.

## Step 3.h₂ — Numbered examples / expex conversion

Convert numbered examples in the body — whether already-canonical
expex, `linguex` (`\ex.` / `\a.`), `gb4e` (`\begin{exe}` /
`\begin{xlist}`), or PDF-extracted prose with manual `(1)…(2)…`
numbering — into Virgil's canonical form: `\vexid{<v4-uuid>}\ex…\xe`
for single-line examples, `\vexid{<v4-uuid>}\pex…\a item …\xe` for
multi-part. Convert interlinear glosses (`\gll`-form, column-aligned
PDF text) to `\begingl…\endgl`.

> **Idempotency check (do this first).** Scan the file. If every
> `\ex` and `\pex` is already preceded by `\vexid{<v4-uuid>}` (full
> v4 form: `[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}`),
> a prior pass already canonicalized them. **Do nothing in this
> step** and proceed to 3i. The example region must produce zero
> diffs on a re-run. (If the user manually added a new `\ex`
> without a `\vexid` between runs, only that example gets a fresh
> UUID; existing canonical examples are untouched.)

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
python3 .virgil/scripts/library/mathify_formal_semantics.py papers/$ARGUMENTS/main.tex \
    --predicates demonstration,agent,theme,locating,similar,move,see
```

Converts OCR-mangled `λ` → `\lambda`, `∃` → `\exists`, `∧` →
`\wedge`, Heim-Kratzer brackets `[[X]]` → `[\!\![X]\!\!]`, lambda
chains `kdke` → `\lambda d\, \lambda e\,`, subscripts `e1` → `e_1`.
Wraps predicate names in `\text{}` to keep them upright.

**Inline-example pre-pass.** Before the batch converter, hoist any
mid-paragraph numbered examples onto their own paragraphs. The
converter only sees paragraph-leading `^(N)\s+` forms; inline forms
like `...thus the formula (2) σ31 satisfies P31...` slip past it
(abusch2013applying memo).

```bash
python3 .virgil/scripts/library/split_inline_numbered_examples.py papers/$ARGUMENTS/main.tex
```

The split is idempotent; safe to re-run.

**Batch numbered-example conversion** (linguistics papers with 50+
examples):

```bash
python3 .virgil/scripts/library/bulk_convert_numbered_examples.py papers/$ARGUMENTS/main.tex \
    --out /tmp/$ARGUMENTS-proposals.json
# review the proposals, then:
python3 .virgil/scripts/library/bulk_convert_numbered_examples.py papers/$ARGUMENTS/main.tex --apply
```

**Re-run safety.** Before invoking `--apply`, count existing
converted examples:

```bash
grep -c 'exno=' papers/$ARGUMENTS/main.tex
```

If the count is `>5`, the paper has prior conversion state and the
remaining proposals are enriched for false positives. Reject any
proposal whose body:

- starts with a lowercase letter or a function word (`do`, `the`,
  `is`, `as`, `c.`, `b.`) — broken-prose continuation, not an
  example;
- contains `\pgmark{`, `\vexid{`, `\xe`, or `\ex[` — overlaps an
  already-converted region;
- is a bare sub-letter (e.g. `(421) c. He walked up to ...`) whose
  parent `(N)` block is elsewhere — the script's pex grouping is
  misfiring.

If every remaining proposal fails these checks, skip `--apply`
entirely — the conversion work is done, and forcing a re-run will
corrupt content. No outstanding-work warning is needed in that
case.

### Detect-and-convert by source variant

*Variant A — Already-canonical expex (`\ex…\xe`, `\pex…\xe`).*
Detect: the regex `\\(?:ex|pex)(?:~|\b|\[|<)` followed eventually by
`\\xe`. If preceded by `\vexid{…}`, leave the entire block untouched.
If no `\vexid`, prepend `\vexid{<fresh-v4>}` on the same line as
`\ex` / `\pex`. Preserve `[exno=N]`, `<tag>`, `\label{…}`, the
`~`-suffix, the body, and any sub-items verbatim. Normalize sub-item
markers `\b`/`\c`/`\d…` to all `\a` (matches what the serializer
emits — the parser auto-cycles a/b/c by position).

*Variant B — `linguex` package.* Detect: `\usepackage{linguex}` in
the preamble, OR a paragraph-starting `\ex.` token (literal `\ex`
followed by `.`) without a matching `\xe` later in the file before
the next `\section`. Convert single-line `\ex. <body>` →
`\vexid{<uuid>}\ex\n<body>\n\xe`. Convert
`\ex. <preamble?> \a. item1 \b. item2` →
`\vexid{<uuid>}\pex\n<preamble?>\n\a item1\n\a item2\n\xe`. An
example ends at the next blank line not followed by an
`\a.`/`\b.`/`\c.` continuation, or at an explicit `\z.`. Strip
`\usepackage{linguex}` from the preamble. `\sn.` / `\nl.`
(un-numbered linguex variants) — convert to `\ex` and accept that
they'll be auto-numbered; un-numbered linguex examples are rare.

If the source has `\setcounter{exx}{N}` (or any other counter-restart
directive that overrides linguex's auto-numbering), translate it to
`[exno=N+1]` on the next `\ex` after the directive's position, then
remove the `\setcounter` line. Do not preserve the directive — expex
has no equivalent global counter knob; the per-example `[exno=N]`
override is how we anchor numbering.

```latex
% Source (linguex):
\ex. The cat sat on the mat.

\ex. Consider:
\a. John saw Mary.
\b. Mary saw John.
\c. They saw each other.

% Output:
\vexid{a1b2c3d4-e5f6-4789-abcd-ef0123456789}\ex
The cat sat on the mat.
\xe

\vexid{f1e2d3c4-b5a6-4987-fedc-ba0987654321}\pex
Consider:
\a John saw Mary.
\a Mary saw John.
\a They saw each other.
\xe
```

*Variant C — `gb4e` package.* Detect: `\usepackage{gb4e}` OR
`\begin{exe}…\end{exe}`, OR `\begin{xlist}…\end{xlist}` outside an
existing `\ex…\xe`. Convert `\begin{exe}\ex <body>\end{exe}` (one
item) → `\vexid{<uuid>}\ex\n<body>\n\xe`. **Critical:** when
`\begin{exe}` contains *multiple* top-level `\ex` items, emit each
as a *separate* `\ex…\xe` block with its own `\vexid` — gb4e's `exe`
is a numbered list of unrelated examples while expex's `\pex` is
parts of one. When `\begin{xlist}` nests inside an `\ex`, the outer
becomes `\pex` and the inner items become `\a` items. Preserve
`\ex\label{…}` and `\ex[exno=N]` verbatim. Strip `\usepackage{gb4e}`.

If the source has `\setcounter{ExNo}{N}` (gb4e's global counter
override), translate it to `[exno=N+1]` on the next `\ex` after the
directive's position, then remove the `\setcounter` line — same rule
as for linguex's `exx` counter.

```latex
% Source (gb4e):
\begin{exe}
\ex \label{ex:donkey} Every farmer who owns a donkey beats it.
\ex \begin{xlist}
    \ex Strict reading.
    \ex Sloppy reading.
    \end{xlist}
\end{exe}

% Output:
\vexid{<uuid-1>}\ex\label{ex:donkey}
Every farmer who owns a donkey beats it.
\xe

\vexid{<uuid-2>}\pex
\a Strict reading.
\a Sloppy reading.
\xe
```

*Variant D — PDF-extracted prose with manual numbering.* Detect: a
paragraph-start line matching one of these patterns, with two or
more such lines within ~30 lines of each other:

- `^\(\d+\)\s+\S` — standard `(7) text`.
- `^\(\d+[a-z]\)\s+\S` — sub-letter form `(3a) text`.
- `^\(\d+[a-z]?[''′`'*]+\)\s+\S` — primed variants common in
  linguistics/philosophy: `(4')`, `(4'')`, `(4a')`, `(4*)`, with the
  prime/apostrophe used to mark a transformed or related variant of
  the base example. Treat each primed variant as its **own** example
  (unique `[exno=4']` shape) — but see "Cross-reference repeats"
  below: if a primed marker `(4')` re-appears later for back-
  reference, leave it as prose. **Note:** expex's `[exno=…]` accepts
  brace-quoted strings, so use `[exno={4'}]` to preserve the prime.
- `^\d+\.\s+\S` — bare-number form `7. text` (no parens). Only
  convert when **both** of these hold: (i) ≥2 such lines appear in
  close proximity (within ~30 lines), AND (ii) introductory prose
  signals example shape ("Consider the following:", "the examples
  below", a colon-terminated lead-in). Without the introductory
  signal, bare-number paragraphs are usually procedural lists or
  enumerated arguments — leave them as prose. The
  `\begin{enumerate}` exclusion below still applies.

Strong companion signal across all four detection patterns: prose
nearby that says "consider the following examples", "(N) below", or
"see (N) above". Convert and **strip the source numbering** from the
body text. Sub-items take two equivalent shapes after PDF/DOCX
extraction; both convert to a single `\pex` with `\a` items:

- *Independent-numbered:* `(3a) …  (3b) …  (3c) …` — each sub-item
  carries its own outer number and inner letter.
- *Outer-once + naked-letters:* `(3) a. …  b. …  c. …` — single
  outer number, then bare letter markers `a.` / `b.` / `c.` (often
  on the same logical paragraph after the docx joiner glues them).
  This is the dominant shape in PDF/DOCX-extracted prose.

If a sub-item has its own inner sub-list (`(3a) i. …  ii. …`), nest
the inner items inside `\begin{xlist}…\end{xlist}` under the outer
`\a` (see the worked example below).

If the source has prose between `(N)` and the first sub-item — e.g.
`(11) John was disappointed in Tim.  a. He fired him.  b. He
disobeyed him.` — treat the prose as a leading body line before the
`\a` items, mirroring the Variant B template.

**Emit `[exno=N]` on every converted example using the literal
source number.** Don't try to be clever about "skip when N matches
the auto-counter" — the source numbering is the contract; preserve
it literally on every example so cascading behavior, sectional
restarts, and gaps all stay correct. (See the "Numbering
preservation" section below for why.)

```latex
% Source (PDF-extracted):
(1)  John saw Mary.

(2a) Strict reading.
(2b) Sloppy reading.

(7)  Bach owns a horse.

% Output:
\vexid{<uuid-1>}\ex[exno=1]
John saw Mary.
\xe

\vexid{<uuid-2>}\pex[exno=2]
\a Strict reading.
\a Sloppy reading.
\xe

\vexid{<uuid-3>}\ex[exno=7]
Bach owns a horse.
\xe
```

*With leading prose + naked-letter sub-items + nested inner tier:*

```latex
% Source (PDF/DOCX-extracted):
(11) John was disappointed in Tim.
     a. He fired him.
     b. He disobeyed him.

(14) a. Pre-closing.
        i.  OK.
        ii. OK/right, OK.
     b. Closing.
        i.  Bye.
        ii. Bye.

% Output:
\vexid{<uuid-4>}\pex[exno=11]
John was disappointed in Tim.
\a He fired him.
\a He disobeyed him.
\xe

\vexid{<uuid-5>}\pex[exno=14]
\a Pre-closing.
\begin{xlist}
\a OK.
\a OK/right, OK.
\end{xlist}
\a Closing.
\begin{xlist}
\a Bye.
\a Bye.
\end{xlist}
\xe
```

### What NOT to convert

Top-level `(N)` examples become `\vexid{<uuid>} \ex[exno=N] body
\xe`; sub-items `(Na)` / `(Nb)` get grouped under a parent `\pex`
block with `\a` sub-items. Refuses to convert inside:

- `\begin{enumerate}…\end{enumerate}` envelopes (those are
  enumeration lists, not linguistic examples).
- `\begin{quote}` blocks.
- The References section.
- Theorem / proposition / lemma numbering contexts.
- Existing `\ex[…]…\xe` / `\pex…\xe` blocks (idempotency).

**Bias toward not converting** when:

- The candidate region sits inside `itemize`/`enumerate`/`quote`/
  math or a command argument.
- The prose says "equation (N)" / "Eq. (N)" / "Figure (N)" referring
  to the same number.
- The list is inside the references / bibliography section.
- The numbering pattern is genuinely ambiguous.
- **Cross-reference repeats.** A candidate `(N)` or `(N-x)` (or
  `(Na)`, `(N.a)`, etc.) whose number matches an example you have
  *already* emitted earlier in the file. These are back-references —
  the author is re-displaying example N (or its sub-item) for
  exposition, not introducing a new example. The body prose nearby
  typically reads as a discussion of the prior example ("recall
  (2-b) above…", or just bare repetition for emphasis). Leave the
  fragment as prose. If converted, you would double-emit `\ex` /
  `\pex` blocks for the same example number, polluting the example
  registry and breaking `[exno=N]` uniqueness. Detection: before
  emitting any `\ex` / `\pex`, check whether `[exno=N]` has already
  been used. If so, the second occurrence is almost always a
  back-reference. (Exception: a paper that legitimately reuses
  numbers via `\setcounter` resets across sections — rare. When in
  doubt, leave as prose and emit `examples-not-converted: candidate
  (N) appears to be a back-reference to earlier example near pgmark
  <P>`.)
- **Sub-item continuations** (e.g. `(26) c.` appearing after an
  earlier `(26) a-b`). The author is extending example 26 with a
  new sub-item at a non-contiguous location. Do **not** emit a
  second `\pex[exno=26]` block (would collide on the exno) and do
  **not** insert a stray `\a item` at body scope (invalid — `\a`
  must live inside `\pex` or `\begin{xlist}`). Leave the
  continuation as prose AND emit
  `examples-not-converted: sub-item continuation of <N> at
  non-contiguous location near pgmark <P>`. The original
  `\pex[exno=N]` block stays as it was; the loss of fidelity (one
  sub-item left as prose) is acceptable until v2 schema supports
  cross-block continuations. (Folding the continuation into the
  original `\pex` is only valid if there is no intervening prose
  between the original block and the continuation — otherwise body
  text would silently be relocated, which is out of scope.)

In any of those cases, leave the region alone and emit a warning of
the form `examples-not-converted: <reason> near pgmark <N>` for
step 5 to merge into `entry.indexed.warnings`.

> **Why this kind defers to step 5 rather than persisting here.**
> `/library/clean-bibliography` persists its three kinds at source
> (task 323) because its OWN next step reads them back out of the
> catalog within the same run. Nothing reads `examples-not-converted:`
> inside the producing pass, so persist-at-source would buy nothing here
> and `deep-index.md` §5 remains its coherent owner. Running standalone,
> say plainly in your reply that the lines were computed and are
> persisted by a `/library/deep-index` pass (or its step 5), not by this
> run. The asymmetry with clean-bibliography is chosen, not drift.

> **Locator fallback for pgmark-less papers.** When the catalog row
> has `indexed.pgmarkCount == 0` (DOCX-native, plain-text imports,
> etc.), the "near pgmark <N>" suffix has no meaningful value — the
> file has no `\pgmark` anchors. Use one of these alternative
> locators instead, in order of preference: (a) `near §<section
> heading>` if the candidate region falls under a `\section{…}` /
> `\subsection{…}` heading; (b) `at line ~<N>` using the candidate's
> line number in the post-deep-index `main.tex`; (c) `in <first 6
> words of the candidate region's prose>` as a last resort. Pick
> exactly one locator per warning, and apply the same fallback
> consistently across all `examples-not-converted:`,
> `missing-bib-entry:`, and `ambiguous-citation:` warnings emitted
> for the same paper. The §8 log section follows the same fallback
> rule.

**Do NOT convert `\begin{enumerate}` blocks.** Even when the prose
treats them as examples, the false-positive risk on procedural
enumerations (algorithm steps, feature lists) is too high for v1.
Leave all `\begin{enumerate}` untouched.

**Wrap bare numbered prose into enumerate envelopes** (NOT into
expex) when the source shows `^1. Foo` paragraph leaders for
Annual-Reviews SUMMARY POINTS / KEY POINTS / FUTURE ISSUES /
CONCLUSIONS lists. The §3.h₂ "do NOT convert" rule applies to
existing `\begin{enumerate}` blocks, not to bare numbered prose
that's *missing* its enumerate envelope.

### Paragraph-fingerprint markers

**`%!v:XXXX` paragraph-fingerprint markers (DOCX-joiner artifact).**
DOCX-extracted bodies sometimes carry inline `%!v:XXXX` (or
backslash-escaped `\%!v:XXXX`) markers — virgil paragraph
fingerprints emitted when the docx joiner glued sub-items into one
logical paragraph. When converting an example, **strip every
intra-example marker** (between `\ex` and the matching `\xe`) and
**preserve only the example's outer trailing `%!v:XXXX`** on the
closing `\xe` line, so the example still carries one fingerprint
for `virgil.json` matching. Do not synthesize fingerprints; if the
example has none, leave `\xe` bare.

### Glosses

Detect `\gll <src> \\ <gloss> \\ \glt '<translation>'`
(gb4e/linguex form), or PDF-extracted column-aligned blocks (line A:
foreign-language tokens; line B: same token count, word-by-word
glosses; line C: a quoted free translation). Convert to:

```latex
\begingl
\gla <line A> //
\glb <line B> //
\glft ``<line C>'' //
\endgl
```

`\gll` (two source-tiers) → `\gla` + `\glb`. `\glll` (three) →
`\gla` + `\glb` + `\glc`. `\glt '…'` → `\glft \`\`…''` (straight or
backtick quotes converted to LaTeX double-quote pair). Each tier
line must end with `//`. Preserve TeX accents (`\ae`, `\'e`, etc.)
verbatim.

Glosses can nest inside `\ex…\xe` or inside an `\a` item, or stand
alone at body scope (the parser handles all three). Already-canonical
`\begingl…\endgl` blocks pass through unchanged.

**Column-alignment fallback.** When the source's gloss-tier token
count doesn't match the source-tier token count, use `{multi-token
gloss}` brace groups in the gloss tier to enforce alignment (e.g.
`\glb in {(the) beginning} was {word.NOM} //` to match a 4-token
source). If alignment is genuinely impossible (clearly different
word counts, no obvious grouping), fall back to `\glpreamble` /
`\glft` prose tiers — the parser renders these without enforcing
column alignment, which is the right behavior for a corrupted
gloss. **Err toward emitting a parseable gloss** rather than one
with mismatched aligned tiers.

### Numbering preservation (load-bearing)

The rendered example number after conversion **must match the source
number for every example**, full stop. This is the single most
important correctness property of this step — body prose throughout
the paper refers to examples by their printed number ("see (7)
above", "the contrast in (3a)–(3b)"), and we explicitly do not
rewrite those references (see "Body cross-references" below). If we
silently renumber, every body mention drifts.

Concrete rules per variant:

- **Variant A (canonical expex).** Preserve every `[exno=N]` from
  the source verbatim. If the source has no `[exno=N]` and uses
  expex auto-numbering, the converted file uses the same
  auto-numbering — match by construction.
- **Variant B (linguex).** Linguex auto-numbers via the `exx`
  counter, starting at 1 and incrementing per `\ex.` Default
  conversion to expex auto-numbering matches by construction.
  **Translate any `\setcounter{exx}{N}` directive** in the source to
  `[exno=N+1]` on the next `\ex` after the directive (and drop the
  `\setcounter` line).
- **Variant C (gb4e).** Same as B with `\setcounter{ExNo}{N}`
  instead of `exx`. Preserve `\ex[exno=N]` verbatim.
- **Variant D (PDF-extracted manual numbering).** **Emit `[exno=N]`
  on every converted example using the literal source number.**
  This is the only variant where the source numbers are encoded as
  visible text, which means we have ground truth to anchor against —
  and per-example anchoring is the only rule that's robust to
  sectional re-numbering, gaps, hand-curated sequences, and any
  expex cascading behavior we'd otherwise have to reason about.

After conversion, **spot-check the first three and last three
examples in the file**: the rendered `[exno=N]` (or auto-number if
none) on each must equal the source number. If any drift, **edit
the `[exno=N]` value on the affected `\ex` / `\pex` to match the
source number — do not regenerate the UUID, do not move the
example, do not touch its body**. The UUID is the parser's stable
id and must not churn. This check belongs in the §3.h₂ output, not
in §3i — the pgmark validator does not catch number drift.

### UUIDs and labels

**UUIDs.** Every `\ex` and `\pex` block gets `\vexid{<v4-uuid>}` on
the same line, immediately preceding it (matching the canonical
sample at `samples/annotation-history/document.tex`). Use full v4
UUIDs (e.g. `ee5126e9-d91e-4c94-afd8-1eed7591c22e`) — generate
inline or via `python3 -c 'import uuid; print(uuid.uuid4())'`.
Verify uniqueness within the file; regenerate any duplicates (the
parser uses the UUID as the example's stable id; a duplicate would
silently merge two examples in the panel).

If the source already has `\vexid` on *every* `\ex|\pex`, preserve
them all (idempotent path above). If only *some* have `\vexid`,
regenerate all — partial reuse causes divergent IDs across re-runs.

**Labels.** Preserve `\label{…}` from source verbatim
(`\vexid{<uuid>}\ex\label{ex:foo}`). Sub-item labels:
`\a\label{ex:foo:a} …`. **Do not synthesize labels** when the source
has none; the example panel keys by `\vexid`, not `\label`, and a
synthesized `\label{ex:N}` pollutes the namespace and breaks if the
example order changes.

**Body cross-references.** Leave inline `(1)` / `(3a)` / "see
example (3)" mentions in body prose alone. Virgil has no
inline-example-ref schema node; rewriting `(N)` → `\ref{ex:foo}` is
out of scope for v1. The `[exno=N]` mitigation in Variant D
preserves rendered numbers so existing mentions stay visually
correct.

### Pgmark interaction

`\ex`/`\pex`/`\xe` are block-level command pairs, not braced
arguments — `\pgmark{N}` markers inside `\ex…\xe` bodies stay at
body scope and the validator (3i) passes them. The one trap: a
pgmark inside a `\begingl…\endgl` aligned tier line (e.g. between
`\gla` and `\glb`) is body-scope by the validator's lights but the
renderer treats one tier line as one logical row and may swallow
the marker. Mitigation, mirroring the rule from §3c and the
second-pass caution under "Idempotency": **before wrapping any
region, scan it for `\pgmark{N}` markers and pull them out to a
blank line just before the wrap**. Never place a pgmark inside a
single tier line. If a page boundary truly cuts mid-gloss in the
source, split the gloss into two `\begingl…\endgl` blocks with the
pgmark between them.

### Constraints

- Do **not** introduce `\ex`, `\pex`, or `\begingl` inside math
  (`\[…\]`, `$…$`, `equation`, `align`, etc.), inside other command
  arguments (`\textbf{…}`, `\section{…}`, `\title{…}`,
  `\footnote{…}`, etc.), or in the preamble. Mirror 3c's scope
  discipline. If a footnote body itself contains a numbered example
  (a `(i)`, `(1)`, etc. inside the footnote prose), leave that
  example as plain text inside the `\footnote{…}` argument —
  `\ex…\xe` cannot live there.
- Do **not** convert numbered lists inside the references /
  bibliography section.
- Do **not** synthesize examples from text that wasn't numbered in
  the source.
- Do **not** convert `\begin{enumerate}` blocks (out of scope v1,
  even when used semantically as examples).
- For Variant D, **always emit `[exno=N]` using the literal source
  number** — never trust expex's auto-numbering to coincide with the
  source. See "Numbering preservation" above.

## Pre-validation recovery (run before §3i)

Three recoverable extraction gaps the prior /index-paper pass
sometimes leaves behind. All are Tier-1 cheap (the bodies are
already in the source PDF; we just need to locate and inject them):

> **Recovery 1 — pgmark coverage.** If `indexed.pgmarkCount` is
> significantly smaller than the source PDF's page count (often the
> front N body pages, e.g. 1-41 of a 218-page book, are silently
> missing — small-font footnote layout interferes with the
> header/footer page-number detector in `pgmark.py`), recover them
> with:
>
> ```bash
> python3 .virgil/scripts/library/recover_missing_pgmarks.py \
>   papers/$ARGUMENTS/main.tex papers/$ARGUMENTS/$ARGUMENTS.pdf
> ```
>
> The script auto-pins the PDF-page → printed-page offset by
> matching the lowest existing `\pgmark{N}` against the
> corresponding PDF page's printed-footer, then walks the missing
> printed pages 1..(L-1) where L is the lowest existing pgmark. For
> each, it extracts the first body words via `pdftotext -layout`,
> locates them in `main.tex`, and inserts `\pgmark{N}`. Pages whose
> call site is inside an existing `\footnote{}` argument or at a
> hyphenated word-break are reported as "couldn't auto-place" and
> need a manual Edit (often an inline `\pgmark{N}` insertion at the
> word break).
>
> This is **not** out-of-scope for /deep-index, despite the body
> extraction itself belonging to /index-paper. The PDF text isn't
> being re-extracted; existing prose is just being annotated with
> page anchors using `pdftotext` lookups (a Tier-1 operation per
> §3d).

> **Recovery 2 — page-break body fragments.** Detect paragraphs
> that end with a hyphen (`-`) followed by a blank line and a new
> paragraph that doesn't continue the hyphenated word. Each such
> case is a silently-dropped body fragment at the page boundary.
> Run:
>
> ```bash
> python3 .virgil/scripts/library/recover_page_break_fragments.py \
>   papers/$ARGUMENTS/main.tex papers/$ARGUMENTS/$ARGUMENTS.pdf
> ```
>
> The script reports each candidate with the recovered fragment
> text from `pdftotext -layout` and the surrounding pgmark anchor.
> Apply each manually with the Edit tool — the agent decides
> whether the fragment continues a hyphenated word inline (e.g.
> `commit-` + `ment` → `commit\footnote{...}\pgmark{N}ment`) or
> starts a fresh paragraph after the page break, since that's a
> context-dependent call the script can't safely make. The
> pre-flight duplicate-check rule from §3d applies: before
> inserting, grep for the leading 4-6 words to make sure the text
> isn't already preserved (truncated) elsewhere nearby.

> **Recovery 3 — opportunistic OCR-artifact cleanup.** If the
> indices (`\section{Index of names}`, `\section{Index of
> subjects}`) have already been itemized but still show OCR
> artifacts (surname-initial concatenation `JoyceJ.`, comma-spacing
> artifacts `Word,28`, Roman-numeral garbles `ii4` → `114`, em-dash
> between digits `27—8`), run:
>
> ```bash
> python3 .virgil/scripts/library/clean_index_ocr.py papers/$ARGUMENTS/main.tex
> ```
>
> If any `\footnote{...}` body ends with a stray printed page-number
> (`...Convention C unless I say otherwise. 137}`), run:
>
> ```bash
> python3 .virgil/scripts/library/clean_fn_trailing_pagenum.py papers/$ARGUMENTS/main.tex
> ```
>
> Both scripts are idempotent and safe to run on already-clean
> input.
