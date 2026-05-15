---
description: Apply structural cleanup to an already-indexed paper — produces a human-readable LaTeX document from raw extraction. Runs an internal convergence loop (no cap), persistently working through every recoverable issue until two consecutive passes produce no new findings. Emits a clear "Deep indexing complete" banner (or stall report) when done. Args: <citekey> [--fresh]
---

# /deep-index

## §0 Autonomous execution contract

This skill runs end-to-end without asking the user anything. The user
invoked /deep-index because they want it done; they are not in the loop.

**Permitted exits — exactly three.** Each is emitted as a single
greppable keyword on its own line, immediately below the human-readable
banner (§Output format):

- `DEEP_INDEX_RESOLVED` — punch-list empty AND outstanding list empty.
- `DEEP_INDEX_NARROW_RESIDUAL` — only narrow out-of-scope items remain
  (`source-missing` | `figure-reconstruction` | `validator-false-positive`).
- `DEEP_INDEX_STALLED` — pathological-loop guard fired, OR three-iteration
  validator abort, OR `metadata-lock: true` block.

Anywhere you are tempted to ask the user a question, apply the default
in [_doctrine.md](_doctrine.md) §0 (Automatic decisions) and proceed.
Anywhere you are tempted to defer in-scope work, walk the tier ladder
one more level. The convergence loop has no hard cap; spending another
pass is always cheaper than surfacing a question. Outstanding-work
items belong in the summary log, not in chat.

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

> **Naming note.** This skill was previously called `/rich-index`. Old
> queue files (`.virgil/queue/<citekey>-richindex.json`) and catalog entries
> (`indexed.state == "richIndexed"`) are still accepted on read; new
> writes use the deep-index vocabulary throughout.

**Structurally improve a paper's `main.tex`** — transform raw extracted
text into properly structured LaTeX that is useful to a human reader.

All paths below resolve against `$library_root` (the library root the
bootstrap just located). Every relative path (`papers/<citekey>/...`,
`.virgil/...`, `master.bib`, `references.bib`) and every helper script
under `.virgil/scripts/library/` resolves against the cwd the bootstrap
set. If the bootstrap printed "No library set up", honour its exit code
and stop — don't try to recover by hand.

> **Where any memo you write goes.** Dev memos (skill retros, ideas for
> improving this pipeline) → `.virgil/memos/<YYYY-MM-DD>-<slug>.md`.
> Paper-specific analyses or reports → `papers/<citekey>/notes/<slug>.md`.
> Never drop a markdown file at the library root.

## Arguments

`$ARGUMENTS` is the citekey (e.g. `cumming2008`), optionally followed
by `--fresh` to restart from baseline. The default (no flag) is
**resume mode** — continue from where a prior pass left off if
`indexed.state == "deepIndexed"`. See the §Preflight section.

## Prerequisites

The paper must already be indexed (`papers/<citekey>/main.tex` must
exist). If it doesn't, tell the user to run `/index-pending` first
and stop.

Also verify the body is populated: a `main.tex` whose body (between
`\maketitle` and `\end{document}`) has fewer than 100 non-comment
bytes is an `/index-paper` failure (typically a scanned PDF that
pymupdf could not text-extract). Hard-stop with the message
"extraction-empty-body — body has <N> bytes; re-run /index-paper
with OCR" and do not proceed. There is nothing for /deep-index to
clean up.


**Shared doctrine.** Read [_doctrine.md](_doctrine.md) for the §0 Autonomous-execution contract (long form), the §Scope doctrine (in-scope categories + three narrow out-of-scope-only carveouts), the §Persistence convergence loop (no hard cap, two-fingerprint stop, never deferring in-scope work, full idempotency rules), the anti-pattern table ("no existing tool" ≠ exhaustion, etc.), and the self-check checklist before tagging any outstanding-work item. The doctrine is load-bearing for every subskill listed in §3 below.

## Genre detection (preflight)

After §Preflight (resume detection) but before Step 1, run a fast
genre classifier:

```bash
python3 .virgil/scripts/library/detect_genre.py papers/$ARGUMENTS
```

Emits one of: `book` / `article` / `multi-article-pdf` / `scanned-ocr` /
`endnote-style`. Several later steps branch on the result:

- `multi-article-pdf` — run `detect_multi_article.py` to identify
  adjacent-article spans for surgical removal (§3a).
- `scanned-ocr` — expect drop-cap loss (run `recover_drop_caps.py`),
  ligature artifacts (run `fix_invisibles.py` aggressively), and
  inline running headers (extend preprocessor's strip patterns).
- `endnote-style` — chapter-end-notes recovery is the primary tier-0
  footnote path (run `reattach_chapter_end_notes.py`); the bibliography
  may live in a unified Notes section (run `itemize_endnotes.py`,
  not the standard §3e itemizer).
- `book` — bibliography may have 100s of entries (use
  `format_references_section.py` rather than hand-shaping); chapters
  may need explicit `\section{}` markers added before §3d's auto-pipeline
  can scope per-chapter.
- `article` — standard path; the existing tier ladder is well-suited.

If `detect_genre.py` is unavailable or its output is ambiguous,
proceed as `article` and let downstream steps detect failures and
adapt.

## Steps

### Preflight: Resume vs. fresh

**Default is resume.** Before doing anything else, check the catalog
row for this paper. If `indexed.state == "deepIndexed"`, a prior pass
has run — pick up from where it left off and the loop will continue
to convergence from there.

Read:

- The most recent `.virgil/logs/$ARGUMENTS/<ISO>-deepindex.summary.md`
  — specifically its `## Outstanding work` section (the schema from
  §9 below) and `## Audit punch-list` section. Both become the
  starting agenda for the first pass of this invocation.
- The catalog `indexed.warnings` array — every item still present
  there is something the prior pass either deferred or couldn't
  resolve.

The §1 preprocessing scripts are designed to be re-run safely (idempotent
on already-clean input). Run them again — they'll be no-ops if there
is nothing new to fix.

**When this invocation is a resume**, write an addendum log
`<ISO>-deepindex-addendum.summary.md` (alongside the normal
`<ISO>-deepindex.summary.md` per §8) that cross-references the prior
summary's outstanding items, marking each as `resolved` (no longer
present on the current pass) or `carried over` (still present, with
notes on what was tried). This makes multi-pass convergence
auditable across invocations.

**`--fresh` flag.** If the user invokes
`/library/deep-index $CITEKEY --fresh`, treat `$ARGUMENTS` as the
citekey and restart from the baseline before doing anything else:

```bash
cp .virgil/baselines/$CITEKEY-pre-deepindex.tex papers/$CITEKEY/main.tex
```

…then proceed normally. Only use `--fresh` when the user explicitly
asks; resume is always the default.

**No prior baseline?** If `.virgil/baselines/$ARGUMENTS-pre-deepindex.tex`
doesn't exist (paper indexed before baselines were added), copy
`main.tex` to that path before running step 1's preprocessing. Future
re-runs can then `--fresh`-restore.

### 1. Run deterministic preprocessing

```bash
python3 .virgil/scripts/library/fix_invisibles.py papers/$ARGUMENTS/main.tex
python3 .virgil/scripts/library/deep_preprocess.py papers/$ARGUMENTS/main.tex
python3 .virgil/scripts/library/repair_pgmarks.py papers/$ARGUMENTS/main.tex
```

Three deterministic passes:

**0. `fix_invisibles.py`** (new, run first) — strips soft hyphens
(U+00AD) wholesale, normalizes ligatures (U+FB00–U+FB06: `ﬁ` → `fi`,
`ﬄ` → `ffl`, etc.), replaces word-internal NBSP (U+00A0 between two
lowercase letters) with a regular space, and replaces U+2800 (Braille
pattern blank) with `(` in citation contexts. These artifacts break
byte-offset matching in downstream regex work and produce silent
mismatches in Edit calls; clearing them at the front of every pass
removes a whole class of bugs. Idempotent on already-clean input.

**Pgmark repair safeguard.** If `repair_pgmarks.py` would remove more
than 50% of pgmarks, that's a red flag — the paper likely has
multi-section page-label collisions (book with front matter + body +
indexes sharing printed page numbers). The script aborts and prints
a warning in that case; revert to baseline pgmarks (skip the repair)
and let the validator (§3i) emit pre-existing continuity warnings
instead of silently dropping anchors.

**a. `deep_preprocess.py`** — strips repeating running headers and
footers, removes leaked page numbers, rejoins hyphenated line breaks,
joins broken paragraphs, unwraps hard-wrapped lines, cleans
high-confidence mid-paragraph hyphenation artifacts (`re- semble` →
`resemble`), and normalizes OCR-flattened numeric subscripts
(`realism2` → `realism\textsubscript{2}`, `realistici` →
`realistic\textsubscript{1}`) for a whitelisted set of
philosophy/math terms. Ambiguous mid-paragraph hyphen cases (compound
words like `well- known`, `non- trivial`) are left for the AI pass to
judge in §3. The subscript-term whitelist in
`normalize_subscript_artifacts()` should be extended whenever a new
paper surfaces a subscript-bearing term the rule misses.

**b. `repair_pgmarks.py`** — removes spurious `\pgmark{N}` anchors:
false-leading sequences from OCR misreads of the front matter,
duplicate labels emitted by index pages that share printed page
numbers with body anchors, and trailing out-of-order runs. Keeps the
longest contiguous non-decreasing run (with small forward jumps
allowed) and drops the rest. Non-numeric pgmarks (roman / appendix-
style) are passed through untouched.

**Capture each script's stdout summary line verbatim** — they must be
quoted into step 8's `**Preprocessing:**` and `**Pgmark repair:**`
fields unchanged. Do not paraphrase; the exact counts are the only
audit trail of what the deterministic passes changed.

`deep_preprocess.py` omits any counter that is zero, so the line you
see may have 2–3 stats (e.g. `"7 headers removed, 9 paragraphs
joined."`) or up to all five (`"60 headers removed, 29 page numbers
removed, 12 paragraphs joined, 8 hyphenated breaks rejoined, 3
pgmarks inlined."`).

`repair_pgmarks.py` prints either `"No spurious pgmarks in <path>."`
(no changes) or `"Repaired <path>: N spurious pgmarks removed."`
followed by one indented line per removed pgmark. Quote the
*Repaired*/*No spurious* summary line; the per-line detail can be
elided in the log.

### 2. Read inputs

Read all of these:

- `papers/$ARGUMENTS/main.tex` (the preprocessed result)
- The source PDF for structural reference: if any `.pdf` exists in
  `papers/$ARGUMENTS/` — even when the catalog's primary source is a
  DOCX (a PDF *alternate* counts) — run
  `pdftotext papers/$ARGUMENTS/$ARGUMENTS.pdf -` and read **the first
  ~8 pages OR up to and including the first body-text heading,
  whichever is more**. For journal articles 8 pages is plenty; for
  books, 8 pages is usually still front-matter (cover, series listing,
  copyright, dedication, ToC) — keep reading until you hit Chapter 1
  / Introduction so you have a real heading sample to anchor §3a/§3b
  on. Skip only when no PDF is present at all. The PDF is structural
  reference material; it does NOT authorize introducing new content
  (pgmarks, footnotes) that the indexed `main.tex` doesn't already
  have — see §3c, §3d for scope. (Structural rewrapping of existing
  prose, e.g. wrapping a leaked footnote body in `\footnote{}`, is
  not "new content" and is permitted by §3d.)
- `master.bib` — find the entry for this citekey (authoritative
  title, author, year, journal, etc.)
- Check for user notes:
  - `.virgil/queue/$ARGUMENTS-deepindex.json` — if present with a `note` field
    (legacy `.virgil/queue/$ARGUMENTS-richindex.json` is also accepted on read)
  - `.virgil/queue/$ARGUMENTS-paperreview.json` — if present, a coexisting
    paper-review request to incorporate

### 3. Apply AI-driven structural improvements

**Each step below runs as a focused subskill.** The subskills are
callable standalone (e.g. `/library/clean-bibliography <citekey>` to
re-itemize References without re-running the rest), and `/library/deep-index`
dispatches to them here.

> **Two load-bearing principles inherited from doctrine:**
> - **Escalation** — when a structural call looks ambiguous, walk
>   the tier ladder (Tier 0 in-file scan → Tier 1 `pdftotext -layout`
>   → Tier 2 fresh `ocrmypdf` → Tier 3 PyMuPDF rasterize → Tier 4
>   orphan-prefix attachment, which always succeeds). Do not bail.
>   "Out of scope" is not a synonym for "hard." See
>   [_doctrine.md](_doctrine.md) §Scope doctrine + §Anti-patterns.
> - **No-paraphrase** — the AI work may re-anchor prose, fix
>   deterministic OCR artifacts, itemize References, and convert
>   author-year mentions to `\cite{}`. It **must not** substitute
>   new sentences for source prose, "improve" the writing, expand a
>   terse footnote into a longer explanation, or drop citations
>   while paraphrasing. See [_doctrine.md](_doctrine.md)
>   §No-paraphrase rule for the full permitted/forbidden taxonomy
>   and the `lee2023structure` failure case.

#### Steps 3a / 3b / 3c — Prose cleanup → `/library/di-clean-prose`

Run `/library/di-clean-prose $ARGUMENTS`. Covers header / `\maketitle`
cleanup (3a), heading hierarchy (3b), and `\pgmark` alignment (3c).
See [di-clean-prose.md](di-clean-prose.md) for full narrative.

#### Step 3d — Footnote recovery (Tier 0 → Tier 4) → `/library/recover-footnotes`

Run `/library/recover-footnotes $ARGUMENTS`. Covers the full tier
ladder for leaked-prose / endnote-style / PDF re-extraction / OCR /
rasterize / semantic-relocation / orphan-prefix fallback.
See [recover-footnotes.md](recover-footnotes.md) for full narrative.

#### Steps 3e / 3f / 3g — Bibliography → `/library/clean-bibliography`

Run `/library/clean-bibliography $ARGUMENTS`. Covers References
itemization (every style — 3e), `references.bib` emission (3f), and
inline citation rewriting (every style — 3g).
See [clean-bibliography.md](clean-bibliography.md) for full narrative.

#### Step 3h — User notes + numbered examples → `/library/di-examples`

Run `/library/di-examples $ARGUMENTS`. Covers user-note processing
(3.h₁), numbered-example / formal-semantics math conversion (3.h₂),
and the Recovery 1–3 pre-validation tiers (run before §3i).
See [di-examples.md](di-examples.md) for full narrative.

#### Step 3i — Validate pgmark placement & continuity (hard gate) → `/library/di-validate`

Run `/library/di-validate $ARGUMENTS`. Hard validator gate: scope
violations are always blockers; continuity findings block only when
"new vs. baseline." See [di-validate.md](di-validate.md) for full
narrative. Three iterations failing → abort (leave `indexed.state`
untouched, append `deep-index-blocked` notification, emit
`DEEP_INDEX_STALLED` per §Output format).

### 4. Write output

Save the improved document back to `papers/$ARGUMENTS/main.tex`.

### 5. Update catalog

**Do not Read/Write `.virgil/catalog.json` directly** — the catalog is
shared across all skills and concurrent sessions, and ad-hoc rewrites
race. Compute new field values, write them to a patch file, then call
`update_catalog_entry.py` (which holds `lock_catalog`, applies the
patch, and bumps `catalog-version.txt`).

Patch fields:

- `indexed.state` = `"deepIndexed"`
- `indexed.lastIndexedAt` = current ISO timestamp
- `indexed.exampleCount` — count top-level `\ex` / `\pex` blocks
  (single + multi, including unnumbered `\ex<*>`). **Do not count**
  `\a` items, `\begin{xlist}` sub-items, or nested gloss tiers.
  Examples skipped per §3.h₂'s "Bias toward not converting" don't
  count (they live as prose; the `examples-not-converted:` warning
  logs them).
- `indexed.pgmarkCount` — recompute only if §1b's `repair_pgmarks.py`
  removed spurious anchors OR the §3 pre-validation Recovery 1 step
  added missing pgmarks. Count distinct numeric labels in
  `\pgmark[opt]{N}`. Omit the field if neither operation fired.
- `indexed.warnings` — see "Warnings recompute" below.

Other `indexed` fields (`extractor`, `footnoteCount`, etc.) and the
top-level `updatedAt` are preserved automatically — the patch script
deep-merges nested objects and only the keys you include get replaced.

**Warnings recompute (eight prefixes).** The `warnings` array is
append-only across passes EXCEPT for these eight prefixes, which are
recomputed every pass:

```
missing-bib-entry:         ambiguous-citation:        pgmark-duplicate:
footnote-recovery-needed:  numeric-citation-style:    pgmark-gap:
examples-not-converted:                               pgmark-out-of-order:
```

Read existing `indexed.warnings`; drop any line starting with one of
those prefixes; concatenate the fresh lines from §3d
(`footnote-recovery-needed:`, at most one), §3g (`missing-bib-entry:`,
`ambiguous-citation:` per unique pair, OR a single
`numeric-citation-style:` for Vancouver sources), §3.h₂
(`examples-not-converted:` per skipped region), and §3i's validator
(`pgmark-duplicate:` / `pgmark-gap:` / `pgmark-out-of-order:` against
the post-repair file). Other warning kinds are preserved untouched.

Why the three pgmark-continuity prefixes recompute: §1b's
`repair_pgmarks.py` removes spurious anchors; §3i emits fresh
continuity findings against the repaired file; pre-repair entries are
stale.

The `missing-bib-entry:` and `ambiguous-citation:` lookup spec lives
in [clean-bibliography.md](clean-bibliography.md) §Missing-bib-entry
lookup spec (load-bearing) — it's the canonical four-step
normalize/extract/match/emit procedure; do not approximate.

```bash
cat > /tmp/$ARGUMENTS-deepindex-patch.json <<'EOF'
{
  "indexed": {
    "state": "deepIndexed",
    "lastIndexedAt": "<ISO>",
    "exampleCount": <N>,
    "warnings": [<recomputed warnings array>]
  }
}
EOF
python3 .virgil/scripts/library/update_catalog_entry.py "$ARGUMENTS" \
  --patch-file /tmp/$ARGUMENTS-deepindex-patch.json
rm /tmp/$ARGUMENTS-deepindex-patch.json
```

The script holds `lock_catalog`, deep-merges the patch into the
existing entry, and bumps `.virgil/catalog-version.txt` — no manual
bump needed.

### 6. Notify

Use `append_inbox_item.py` rather than reading/writing
`inbox.json` directly (same race-protection reason as catalog):

```bash
cat > /tmp/$ARGUMENTS-deepindex-notify.json <<'EOF'
{
  "kind": "indexed",
  "citekey": "$ARGUMENTS",
  "at": "<ISO>",
  "summary": "Deep-indexed $ARGUMENTS"
}
EOF
python3 .virgil/scripts/library/append_inbox_item.py \
  --item-file /tmp/$ARGUMENTS-deepindex-notify.json
rm /tmp/$ARGUMENTS-deepindex-notify.json
```

### 7. Mark done

Delete `.virgil/queue/$ARGUMENTS-deepindex.json` (or the legacy
`.virgil/queue/$ARGUMENTS-richindex.json`) if it exists. If a coexisting
`.virgil/queue/$ARGUMENTS-paperreview.json` was also processed, delete that too.

If neither queue file exists but a `.json.done` marker is present
(e.g. `<citekey>-richindex.json.done` left behind by a prior pass),
that's the steady state — leave the marker alone, do not delete it,
and do not treat its absence as an error.

### 8. Log

Write a summary to `.virgil/logs/$ARGUMENTS/<ISO>-deepindex.summary.md`:

```markdown
# Deep-index summary: $ARGUMENTS

**Date:** <ISO>
**Preprocessing:** <stats from step 1a>
**Pgmark repair:** <stats from step 1b>
**References emitted:** <N> entries → references.bib
**Inline citations rewritten:** <M> (with <K> ambiguous mentions left as prose)
**Missing bib entries:** <K> author/year pairs in body without a matching entry — added to `indexed.warnings`.
**Examples converted:** <N> (<single>:<multi>:<gloss-only>:<unchanged-canonical>) — <variant breakdown, e.g. linguex 2, gb4e 1, prose 4>.
**AI changes:**
- <list each structural change made>
```

If any inline mentions were left as prose because no matching bib entry
existed (the "ambiguous" count above), list them under a sub-heading so
follow-up triage can find them:

```markdown
**Unresolved inline citations:**
- "(Smith 2008)" near pgmark 12 — no matching entry in references.bib
- "Jones (1995)" near pgmark 17 — no matching entry in references.bib
```

If any candidate example regions were left unconverted because the
heuristics flagged them as ambiguous, list them under a parallel
sub-heading (one line per warning, mirroring the
`examples-not-converted:` lines added to `indexed.warnings`):

```markdown
**Examples skipped (ambiguous):**
- "(1)…(2)…" inside \begin{enumerate} near pgmark 7 — out of scope v1
- "(3) The data:" inside \begin{quote} near pgmark 14 — non-body scope
```

### 9. Outstanding work (REQUIRED — always emit, even if empty)

Append a `## Outstanding work` section to the SAME summary log file
from step 8 (i.e., `.virgil/logs/$ARGUMENTS/<ISO>-deepindex.summary.md`).
The categories, `<why deferred>` schema, and tier-exhaustion checklist
live in [di-validate.md](di-validate.md) §Outstanding-work classification
— do not duplicate here. The three allowed categories are
`source-missing`, `figure-reconstruction`, `validator-false-positive`
(see [_doctrine.md](_doctrine.md) §0 and §Scope doctrine; the legacy
`user-judgment-required` tag has been removed).

The section is **required**, even when empty. If everything was
resolved, write:

```markdown
## Outstanding work

None. Document is fully cleaned.
```

A missing `## Outstanding work` section is a skill-protocol violation.
The persistence loop reads this list (together with the §9.5 audit
punch-list) as the convergence fingerprint — see
[_doctrine.md](_doctrine.md) §Persistence.

### 9.5. Audit punch-list (REQUIRED — drives convergence)

After steps 1–9 complete for the pass:

```bash
python3 .virgil/scripts/library/audit_deepindex.py papers/$ARGUMENTS
```

Append the output as a `## Audit punch-list` section to the same
summary log. Full check inventory + empty-state template live in
[di-validate.md](di-validate.md) §9.5. Pass-fingerprint includes
this list as a set; see [_doctrine.md](_doctrine.md) §Persistence.

### 10. Streamlining memo (REQUIRED — always emit, even if empty)

Write a memo to
`.virgil/memos/<YYYY-MM-DD>-deepindex-streamlining-$ARGUMENTS.md` with
concrete proposals for streamlining future deep-index runs based on
what you observed this pass:

```markdown
# Deep-index streamlining memo: $ARGUMENTS

**Date:** <ISO>
**Run summary:** [link to `.virgil/logs/$ARGUMENTS/<ISO>-deepindex.summary.md`]

## Bottlenecks this run

- <one bullet per friction point — where you spent disproportionate effort, where the skill text was unclear, where deterministic preprocessing left avoidable cleanup, where the escalation ladder fired and why>

## Proposed tools / scripts

### Generalizable

- <name + one-line purpose + why it would have helped — applies to many papers>

### Paper-specific

- <name + one-line purpose + why this paper specifically needed it — applies narrowly>

## Suggested skill-text changes

- <bullets referencing line numbers in `library/skills/deep-index.md` with concrete proposed edits>
```

If nothing surfaced — the run was straightforward, the existing
scripts and tier ladder handled everything — write:

```markdown
# Deep-index streamlining memo: $ARGUMENTS

**Date:** <ISO>

No streamlining observations from this run.
```

…and stop. Short is fine. The memo's *existence* is the contract;
emptiness is permitted but absence is not. Treat the memo as a chance
to feed back into the skill set: paper-specific scripts are useful
even when they only apply once (the user may generalize them later).

## Output format

The terminal output is a human-readable banner followed by exactly
one greppable status keyword on its own line. The audience is the
user *and* `/loop` callers; the stats live in the summary log (§8).
Emit exactly one of three banners depending on terminal state — see
[_doctrine.md](_doctrine.md) §0 for the contract.

**Resolved** (audit punch-list empty AND outstanding list empty —
no items in any bucket, including zero narrow items):

```
✓✓ Deep indexing fully resolved: $ARGUMENTS

  Document: <N> chapters / sections, <M> pages
  Footnotes: <K> inline, <J> approximate placement with [orphan fn N] prefix (or "0 orphaned")
  Citations: <N> clickable, 0 unresolved
  Bibliography: <N>-entry references.bib, all entries parsed
  Cleanup: 0 invisibles, 0 hyphenation artifacts, 0 catalog warnings
  Passes: <P> (converged at pass <P>)

DEEP_INDEX_RESOLVED
```

**Narrow residual** (audit punch-list empty AND outstanding list
contains only narrow out-of-scope items — `source-missing`,
`figure-reconstruction`, or `validator-false-positive`):

```
✓ Deep indexing complete: $ARGUMENTS (<N> narrow-out-of-scope items)

  [stats as above]
  Outstanding: <N> permanently-out-of-scope items, see log §9

DEEP_INDEX_NARROW_RESIDUAL
```

**Stalled** (pathological-loop guard fired, OR three-iteration
validator abort, OR `metadata-lock: true` block):

```
⚠ Deep indexing stalled: $ARGUMENTS

  Converged at pass <P> with residual:
    - <category>: <count> items
  Reason: <pathological-loop | validator-abort | metadata-lock>

  Re-invoke /library/deep-index $ARGUMENTS to retry from here.
  See .virgil/logs/$ARGUMENTS/<ISO>-deepindex.summary.md §9 for detail.

DEEP_INDEX_STALLED
```

The status keyword (`DEEP_INDEX_RESOLVED` | `DEEP_INDEX_NARROW_RESIDUAL`
| `DEEP_INDEX_STALLED`) **must** appear on its own line, with nothing
else on that line — `/loop` callers grep for it.

The stalled state is rare — the convergence loop normally drives
everything to resolved or narrow-residual. If you find the loop
emitting stalled frequently, escalate by re-reading §Scope doctrine
and the tier ladder; the typical cause is prematurely tagging
in-scope items as out-of-scope. The detailed stats (preprocessing
counts, pgmark repair counts, per-tier escalation counts, AI-changes
list, full outstanding-work list, audit punch-list) all live in the
summary log file. Reference the log path in the streamlining memo
(§10).

## What this command does NOT do

In-scope vs. out-of-scope is defined in [_doctrine.md](_doctrine.md)
§Scope doctrine. Three orchestrator-specific boundaries worth calling
out:

- **No bulk re-extraction.** Targeted per-page/per-region work via
  `pdftotext -layout`, `ocrmypdf`, or PyMuPDF rasterization is
  in-scope (the §3d tier ladder uses it). Rebuilding the whole
  `main.tex` from the PDF is an `/index-paper` failure surfaced at
  Preflight, not a /deep-index problem.
- **`master.bib` and bib authentication are `/authenticate-bib`'s
  job.** Each paper's `references.bib` is self-contained. Exception:
  the metadata-vs-content auto-resolution policy (see doctrine §0
  Automatic decisions) updates `master.bib` via
  `update_master_bib_entry.py` — that's the only sanctioned write.
- **No multi-display equation collapsing across page boundaries.** If
  `\pgmark{N}` already sits between two `\[...\]` displays in the
  input, leave the layout split — fusing would force the pgmark
  either inside math (silently swallowed) or far from its true
  position.

## Idempotency

The convergence loop, pass-fingerprint, cross-invocation addendum
pattern, and per-subskill idempotency rules (bibliography zero-diff,
examples `\vexid` short-circuit, catalog warning recompute, math-merge
pgmark extraction) all live in [_doctrine.md](_doctrine.md) §Persistence.
The orchestrator inherits them; do not duplicate here.

## LaTeX constraints

Allowed-command vocabulary, font-policy strip rule, and the minimal
preamble emitted by `tex_emit.py` live in
[_latex-output.md](_latex-output.md). Stick to that vocabulary; do
not introduce commands outside the list.
