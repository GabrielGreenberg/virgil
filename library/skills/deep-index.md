---
description: Apply structural cleanup to an already-indexed paper — produces a human-readable LaTeX document from raw extraction. Runs an internal convergence loop (no cap), persistently working through every recoverable issue until two consecutive passes produce no new findings. Emits a clear "Deep indexing complete" banner (or stall report) when done. Args: <citekey> [--fresh]
---

# /deep-index

> **Naming note.** This skill was previously called `/rich-index`. Old
> queue files (`.virgil/queue/<citekey>-richindex.json`) and catalog entries
> (`indexed.state == "richIndexed"`) are still accepted on read; new
> writes use the deep-index vocabulary throughout.

**Structurally improve a paper's `main.tex`** — transform raw extracted
text into properly structured LaTeX that is useful to a human reader.

All paths are relative to the **library root**, which is your **current working directory**. The default convention is `~/Virgil-Library`, but the user may have picked a different folder (e.g. `~/Documents/Virgil-Library`). Resolve the library root in this order:

1. `$VIRGIL_LIBRARY_ROOT` if set;
2. otherwise your current cwd, **iff** it contains both `master.bib` and `.virgil/catalog.json`;
3. otherwise `~/Virgil-Library`.

`cd` into that directory before running any of the commands below — every relative path (`papers/<citekey>/...`, `.virgil/...`, `master.bib`, `references.bib`) and every helper script under `.virgil/scripts/` resolves against cwd. If none of the three resolutions yields a valid library, abort with a one-line error pointing the user to set up the library first.

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


**Shared doctrine.** Read [_doctrine.md](_doctrine.md) for the §0.5 Scope doctrine (in-scope categories + four narrow out-of-scope-only carveouts), the §Persistence convergence loop (no hard cap, two-fingerprint stop, never deferring in-scope work), the anti-pattern table ("no existing tool" ≠ exhaustion, etc.), the self-check checklist before tagging any outstanding-work item, and the narrow `user-judgment-required` triggers. The doctrine is load-bearing for every subskill listed in §3 below.

## Genre detection (preflight)

After §Preflight (resume detection) but before Step 1, run a fast
genre classifier:

```bash
python3 .virgil/scripts/detect_genre.py papers/$ARGUMENTS
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
python3 .virgil/scripts/fix_invisibles.py papers/$ARGUMENTS/main.tex
python3 .virgil/scripts/deep_preprocess.py papers/$ARGUMENTS/main.tex
python3 .virgil/scripts/repair_pgmarks.py papers/$ARGUMENTS/main.tex
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

> **Escalation principle (load-bearing).** When a structural call
> looks ambiguous — a footnote you can't place, a heading you can't
> classify, a pgmark whose target text you can't find, an inline
> citation that doesn't obviously match a bib entry — **do not bail.**
> Escalate through the tier ladder defined in `/library/recover-footnotes`:
>
> - **Tier 0:** in-file scan of `main.tex` for content already present.
> - **Tier 1:** PDF re-extraction with `pdftotext -layout`.
> - **Tier 2:** fresh OCR via `ocrmypdf` on individual pages.
> - **Tier 3:** rasterize the page to PNG via PyMuPDF and read it visually.
> - **Tier 4 (always succeeds):** for orphan footnotes whose call site cannot be located, attach to the end of the nearest preceding body paragraph as `\footnote{[orphan fn N] <body>}`. **This is strictly better than leaving the numbered paragraph unattached.**
>
> The ideal is that every step a–i completes with the outstanding list
> empty. Warnings should reflect genuine intractability (the three
> narrow categories from §0.5 scope doctrine), not first-tier doubt.
>
> **"Out of scope" is not a synonym for "hard."** If you are tempted to
> defer a problem with "out of /deep-index scope" as the reason, check
> the §0.5 in-scope list first. Footnotes, chapter titles, pagination,
> misplaced text, drop-cap recovery, invisible characters, bibliography
> parsing (all styles), citation rewriting (all styles), and
> multi-article surgical cleanup are all in scope. The bar for
> out-of-scope deferral is very high; the convergence loop (§Persistence)
> will keep re-running until the outstanding list stabilizes, so
> deferring an in-scope item just means re-doing it next pass.

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
untouched, append `deep-index-blocked` notification).

### 4. Write output

Save the improved document back to `papers/$ARGUMENTS/main.tex`.

### 5. Update catalog

**Do not Read/Write `.virgil/catalog.json` directly** — the catalog is
shared across all skills and concurrent sessions, and ad-hoc rewrites
race. Compute the new field values, write them to a patch file, then
call `update_catalog_entry.py` (which holds `lock_catalog`, applies
the patch, and bumps `catalog-version.txt`).

Compute these field values for the patch:

- `indexed.state` = `"deepIndexed"`
- `indexed.lastIndexedAt` = current ISO timestamp
- `indexed.exampleCount` — count the top-level `\ex` / `\pex` blocks
  in the final body (single + multi combined, including unnumbered
  tagged examples like `\ex<*>`). **Do not count `\a` items,
  `\begin{xlist}` sub-items, or nested gloss tiers** — only the outer
  `\ex` / `\pex` envelopes. Examples skipped per §3.h₂'s "Bias toward
  not converting" rules do not contribute to this count (they live as
  prose; the corresponding `examples-not-converted:` warning logs
  them). Frontends ignore unknown fields, so this addition ships
  without a UI change; a future Library badge can surface it.
- `indexed.pgmarkCount` — recompute if step 1b's `repair_pgmarks.py`
  removed any spurious anchors OR the pre-validation Recovery 1 step
  (§3 pre-validation block) added missing pgmarks. Count the distinct
  numeric labels in `\pgmark[opt]{N}` after the pass so the catalog
  stays in sync with the file on disk. If neither operation changed
  the count, omit the field from the patch and the existing count is
  preserved.

Other `indexed` fields (`extractor`, `footnoteCount`, etc.) and
top-level `updatedAt` are preserved automatically — the patch script
deep-merges nested objects and only the keys you include get replaced.

The `warnings` array is **append-only across passes, except for eight
recomputed prefixes: `missing-bib-entry:`, `footnote-recovery-needed:`,
`examples-not-converted:`, `ambiguous-citation:`,
`numeric-citation-style:`, `pgmark-duplicate:`, `pgmark-gap:`, and
`pgmark-out-of-order:`**. Read existing warnings, **drop any prior
lines starting with any of those eight prefixes** (they're recomputed
by this pass), then concatenate the fresh lines from step 3g
(`missing-bib-entry: <Author> <Year>` and `ambiguous-citation:
<Author> <Year> (matches: ...)`, one per unique pair each, OR a
single `numeric-citation-style: ...` line for Vancouver-style
sources), step 3d (`footnote-recovery-needed: <count> ...`, at most
one), step 3.h₂ (`examples-not-converted: <reason> ...`, one per
skipped region), and step 3i (`pgmark-duplicate:`, `pgmark-gap:`,
`pgmark-out-of-order:` lines emitted by the validator against the
post-repair file). Other warning kinds (from earlier indexing) are
preserved untouched. This keeps idempotency clean: re-running
deep-index on the same paper produces the same warnings array (no
duplicates, no ghost entries from a previous run that have since been
resolved).

> **Why the three pgmark-continuity prefixes are recomputed.** Step
> 1b's `repair_pgmarks.py` removes spurious anchors; afterward, the
> §3i validator emits a fresh set of continuity findings against the
> repaired file. Pre-repair `pgmark-duplicate:`, `pgmark-gap:`, and
> `pgmark-out-of-order:` entries in `indexed.warnings` reflect the
> pre-repair state and are now stale. Recomputing on every pass keeps
> the catalog honest. If repair removed nothing AND no new
> continuity findings surfaced (typical for a resume pass), the net
> effect is zero diffs.

> **`missing-bib-entry` lookup spec (load-bearing).** Emit a
> `missing-bib-entry:` line **only when** the inline mention has no
> matching entry in `references.bib` under this lookup:
> 1. **Normalize each surname** (NFKD-fold, strip diacritics, lowercase,
>    drop hyphens / apostrophes / spaces, drop trailing `jr|sr|iii`).
> 2. **Extract every cited surname** from the mention. Handle:
>    `Author1 and Author2`; `Author1 & Author2`; `Author1, Author2, and
>    Author3` (Oxford comma optional); `Author1 et al.` (treat as a
>    prefix match — first surname only); `Author1, Author2, …, AuthorN`.
> 3. **Match against `references.bib`** by (a) parsing each entry's
>    `author = {…}` field into a normalized surname list, then (b)
>    accepting iff: (i) the cited year matches the entry's year, AND
>    (ii) for `et al.` mentions, the first surname is among the entry's
>    first 3 authors; for explicit `Author1 (and|&) Author2` mentions,
>    every cited surname appears in the entry's author list.
> 4. **Emit the warning only if no entry matches.** If multiple entries
>    match (same first author + year), emit `ambiguous-citation:` with
>    the candidate citekeys, not `missing-bib-entry:`.
>
> Heuristic shortcuts that match only on first-author surname + year
> will produce ~30–50% false-positive `missing-bib-entry` warnings on
> multi-author corpora — this is the failure mode the spec above
> exists to prevent. Do **not** emit warnings then post-hoc filter
> them; implement the lookup correctly the first time, and if the
> lookup is too expensive to do inline (large bibliography), build
> the normalized author-list index once at the start of step 3g and
> reuse it.

Compute the `warnings` array. It's **append-only across passes,
except for eight recomputed prefixes: `missing-bib-entry:`,
`footnote-recovery-needed:`, `examples-not-converted:`,
`ambiguous-citation:`, `numeric-citation-style:`, `pgmark-duplicate:`,
`pgmark-gap:`, and `pgmark-out-of-order:`**. To produce it: read
existing `indexed.warnings` from the catalog (plain `cat
.virgil/catalog.json | jq …` is fine; no lock needed for reads),
**drop any prior lines starting with any of those eight prefixes**
(they're recomputed by this pass), then concatenate the fresh lines
from step 3g (`missing-bib-entry: <Author> <Year>` and
`ambiguous-citation: <Author> <Year> (matches: ...)`, one per unique
pair each, OR a single `numeric-citation-style: ...` line for
Vancouver-style sources), step 3d (`footnote-recovery-needed: <count>
...`, at most one), step 3.h₂ (`examples-not-converted: <reason>
...`, one per skipped region), and step 3i (the pgmark validator's
fresh `pgmark-duplicate:` / `pgmark-gap:` / `pgmark-out-of-order:`
findings against the post-repair file). Other warning kinds (from
earlier indexing) are preserved untouched. This keeps idempotency
clean: re-running deep-index on the same paper produces the same
warnings array (no duplicates, no ghost entries from a previous run
that have since been resolved).

Then write the patch to a temp JSON file and call the catalog updater:

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
python3 .virgil/scripts/update_catalog_entry.py "$ARGUMENTS" \
  --patch-file /tmp/$ARGUMENTS-deepindex-patch.json
rm /tmp/$ARGUMENTS-deepindex-patch.json
```

The script holds `lock_catalog`, deep-merges the patch into the
existing entry (so `extractor`, `footnoteCount`, `pgmarkCount`, etc.
are preserved), and bumps `.virgil/catalog-version.txt` — no manual
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
python3 .virgil/scripts/append_inbox_item.py \
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
List **every** issue you did not resolve in this pass — be specific,
not vague. One bullet per item:

```
- [<category>] <description> — <why deferred>
```

Allowed `<category>` values:

- `source-missing` — page or block literally absent from the PDF
- `figure-reconstruction` — raster-only content (figures, diagrams)
- `user-judgment-required` — requires user input (rare; high bar)
- `validator-false-positive` — the validator's heuristic flagged
  something that's verifiably correct (journal-offset reprint with
  span fitting in PDF page count, multi-section pagination with
  legitimate page-label namespaces, low-confidence-flood on a
  scanned-OCR book where every marker has been positionally
  verified). Distinct from `user-judgment-required` because there's
  no decision for the user to make — the file is already correct.

These are the **only four categories** that may remain after the
convergence loop completes. Everything else is in-scope per §0.5
and must be drained by subsequent passes. If you find yourself
wanting to use a different category, you are almost certainly failing
to exhaust a tier. Go back and try Tier 0 (in-file scan), Tier 3.5
(batch orphan recovery), or Tier 4 (orphan-prefix attachment).

Allowed `<why deferred>` values (be precise — these are auditable):

- `source-missing — verified absent from PDF (pages X–Y)` — with
  evidence: `pdfinfo` page count vs. expected.
- `figure-reconstruction — raster-only content` — for raster figures
  whose meaning is the image. Text in captions is NOT this category;
  it's in-scope.
- `user-judgment-required — <specific question>` — with the exact
  question that needs the user's input. Default expectation: this
  is almost never the right reason.
- `validator-false-positive — <finding kind>: <why it's correct>` —
  e.g., `range-impossible: span fits in PDF page count (offset
  reprint)`. The corresponding catalog warning gets a
  `…-false-positive:` prefix so future passes don't re-flag it.

**If everything was resolved**, write the section with body:

```markdown
## Outstanding work

None. Document is fully cleaned.
```

Do **not** omit the section — its presence (including the "None"
form) is the contract that downstream readers can rely on. A
missing `## Outstanding work` section is a skill-protocol violation.

**Convergence interaction.** The persistence loop uses this list,
together with the audit punch-list from Step 9.5, as the convergence
fingerprint. When two consecutive passes produce the identical
outstanding set, the loop exits. Empty or narrow-out-of-scope-only
outstanding lists are the desired terminal state.

Re-runs across invocations should make the outstanding-work list
shrink, not grow.

### 9.5. Audit punch-list (REQUIRED — drives convergence)

After steps 1–9 complete for the pass, run the audit script:

```bash
python3 .virgil/scripts/audit_deepindex.py papers/$ARGUMENTS
```

The script emits a punch-list of concrete cleanup issues that remain
in `main.tex`, `references.bib`, and the catalog. It checks: invisible
characters (U+00AD, U+200B, U+00A0 word-internal, U+FB00–U+FB06
ligatures, U+2800 Braille blank); hyphenation artifacts; title /
metadata cross-check; `references.bib` sample audit; pgmark continuity
+ low-confidence count; footnote inline-rate; citation completeness.

Append the audit output as a `## Audit punch-list` section to the
SAME summary log file from step 8.

```markdown
## Audit punch-list

- [invisibles] 13 U+00AD soft hyphens remain (samples: line 42, 78, 124)
- [hyphenation-artifacts] 4 broken-word joins remain
- [footnote-inline-rate] 5 leaked-prose paragraphs un-reattached
- ...
```

If the punch-list is **empty**, write:

```markdown
## Audit punch-list

Clean. No remaining issues detected.
```

**Convergence semantics.** Each punch-list item is the next pass's
agenda. The pass-fingerprint includes the punch-list as a set, so an
unchanged punch-list (and unchanged outstanding list, unchanged
validator findings) signals convergence and exits the loop. An empty
punch-list plus an empty outstanding list (or only narrow-out-of-scope
items) is the desired terminal state.

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

The terminal output is a human-readable banner — NOT a technical-stats
dump. The audience is the user; the stats live in the summary log
(§8). Emit one of two banners depending on convergence outcome.

**Converged-clean banner** (audit punch-list empty AND outstanding
list empty or narrow-out-of-scope-only):

```
✓ Deep indexing complete: $ARGUMENTS

  Document: <N> chapters / sections, <M> pages
  Footnotes: <K> inline, <J> approximate placement with [orphan fn N] prefix (or "0 orphaned")
  Citations: <N> clickable, 0 unresolved
  Bibliography: <N>-entry references.bib, all entries parsed
  Cleanup: 0 invisibles, 0 hyphenation artifacts, 0 catalog warnings
  Passes: <P> (converged at pass <P>)

  Outstanding: none (or "<N> permanently-out-of-scope items, see log §9")
```

**Stalled banner** (the pathological-loop guard fired, OR convergence
reached but with non-narrow outstanding items remaining):

```
⚠ Deep indexing stalled: $ARGUMENTS

  Converged at pass <P> with residual:
    - <category>: <count> items

  Re-invoke /library/deep-index $ARGUMENTS to retry from here.
  See .virgil/logs/$ARGUMENTS/<ISO>-deepindex.summary.md §9 for detail.
```

The stalled banner is rare — the convergence loop normally drives
everything to an empty or narrow-only outstanding list. If you find
the loop emitting "stalled" frequently, escalate by re-reading §Scope
doctrine and the tier ladder; the typical cause is prematurely
tagging in-scope items as out-of-scope.

The detailed stats (preprocessing counts, pgmark repair counts,
per-tier escalation counts, AI-changes list, full outstanding-work
list, audit punch-list) all live in the summary log file at
`.virgil/logs/$ARGUMENTS/<ISO>-deepindex.summary.md`. Reference the
log path in the streamlining memo (§10).

## What this command does NOT do

These are the **narrow** out-of-scope boundaries. Everything inside
§Scope doctrine is in-scope and the convergence loop drives it to
resolution.

- Does not re-extract the full document from the PDF in bulk.
  Targeted per-page or per-region re-extraction via `pdftotext
  -layout`, `ocrmypdf`, or PyMuPDF rasterization is **in scope** —
  the §3d tier ladder uses it. What's out of scope is rebuilding the
  whole `main.tex` from the PDF; if the catalog row has
  `extraction-empty-body` or pymupdf returned 0 blocks, that's an
  `/index-paper` failure surfaced at the Preflight check, not a
  /deep-index problem.
- Does not touch `master.bib` or bib authentication — those are
  separate concerns handled by `/authenticate-bib`. Each paper's
  `references.bib` is self-contained; cross-paper deduplication and
  per-entry authentication are future features. Exception: when a
  metadata-vs-content mismatch is explicitly authorized by the
  user (§3a), update `master.bib` via `update_master_bib_entry.py`.
- Does not reconstruct figures or diagrams. Raster-only content
  whose meaning is the image stays as-is; text in captions IS in
  scope and must be cleaned. Tag truly-raster items as
  `figure-reconstruction — raster-only content` in §9.
- Does not collapse multi-display equations into a single `\[...\]`
  when a page boundary runs between them. If `\pgmark{N}` already sits
  between two displays in the input, leave the layout split — fusing
  the displays would force the pgmark either inside math (silently
  swallowed by the renderer) or far from its true position.
- Does not "give up" on hard problems by tagging them out-of-scope.
  If you're tempted to tag something as out-of-scope, re-read §Scope
  doctrine and the tier ladder. The skill is designed to be
  persistent; premature deferral defeats that purpose.

## Idempotency

Running `/deep-index` twice on the same paper should not degrade it.
The preprocessing script detects already-cleaned content (no running
headers to strip = no changes). The AI step should similarly recognize
when structural fixes have already been applied and avoid double-fixing.

**Multi-pass addendum pattern (within a single invocation).** The
internal convergence loop runs Steps 1–9.5 N times until the
pass-fingerprint stabilizes. Each pass either resolves outstanding
items from the prior pass or carries them over. The pass-fingerprint
is `(outstanding-list-as-set, audit-punch-list-as-set,
validator-findings-as-set)`. Two consecutive identical fingerprints
trigger exit.

**Multi-pass addendum pattern (across invocations).** When `/deep-index`
is invoked on a paper that's already `deepIndexed`, the new invocation
writes both the normal summary log AND an addendum log
`<ISO>-deepindex-addendum.summary.md` that cross-references the prior
summary's outstanding items, marking each as `resolved` (no longer
present this pass) or `carried over` (still present, with notes on
what was tried). This makes multi-invocation convergence auditable.

A paper that requires more than 2 invocations to converge is unusual
and warrants a streamlining-memo entry diagnosing the friction.

For the bibliography work specifically: on a second pass, the entries
already exist in `references.bib` and the body already has `\cite{…}` /
`\citet{…}` commands. Re-running 3e–3g should produce **zero diffs** in
both `main.tex` and `references.bib`. If the second pass would change
either file, check first whether the difference is genuine new work or
just spurious re-formatting — the latter signals a bug in the rewrite
heuristics.

The catalog `indexed.warnings` array is recomputed per pass for the
`missing-bib-entry:`, `footnote-recovery-needed:`,
`examples-not-converted:`, `ambiguous-citation:`,
`numeric-citation-style:`, `pgmark-duplicate:`, `pgmark-gap:`, and
`pgmark-out-of-order:` prefixes (step 5). Other warning kinds are
preserved verbatim. If a missing entry from a prior pass has since
been added to `references.bib` (e.g. by a manual edit), the rerun
drops it from warnings. Same for stale pgmark-continuity findings
that have been resolved by the §1b repair pass.

For numbered examples specifically: on a second pass, the `\vexid{…}`
markers from the first pass identify each canonical example, and §3.h₂
short-circuits to a no-op when every `\ex|\pex` is already prefixed
with a v4 `\vexid`. Re-running 3.h₂ should produce **zero diffs** in
the example region. If the user manually added a new `\ex` without a
`\vexid` between runs, that single example gets a fresh UUID; existing
canonical examples are left untouched.

When merging or rewriting math fragments on a second pass, **scan the
merge region for `\pgmark{N}` markers first and pull them out to body
scope before doing the merge**. A well-intentioned "improvement" that
fuses two `\[...\]` displays without first extracting the pgmark
between them will silently re-introduce a swallowed marker — exactly
the bug that step 3i exists to catch.

## LaTeX constraints

The output must be valid LaTeX that `parseLatex()` in Virgil can
handle. Stick to:

- `\documentclass{article}`, `\title`, `\author`, `\date`, `\maketitle`
- `\section`, `\subsection`, `\subsubsection`
- `\pgmark{N}` (preserved from extraction)
- `\footnote{…}`
- `\begin{quote}\textit{…}\end{quote}` for captions
- `\begin{itemize}` ... `\end{itemize}` with `\item` entries (used for
  the bibliography section and any source-document lists)
- `\textbf{…}` for bold (used for author names in bibliography entries)
- `\textit{…}` for italics (used for journal/book titles)
- `\[…\]` for display math
- `\cite{key}` / `\cite{key1,key2}` — parenthetical citations.
  Optional locator: `\cite[p.~75]{key}`, `\cite[pp.~75--80]{key}`.
- `\citet{key}` — textual citations ("Smith (2008) argues …").
  Optional locator same as `\cite`. (`\citep{…}` is also accepted by
  the parser but `\cite{…}` is preferred for parenthetical.)
- `\citealt{key}` — "Author Year" textual without parens. Use for
  bare-form footnote lists ("*see* Kehler and Rohde 2017; …").
- `\citealp{key}` — "Author, Year" without parens. Use inside
  parenthetical wrappers like `(e.g., …)`, `(see …)`, `(cf. …)` so the
  result doesn't get nested parens.
- `\citeauthor{key}` — author surname only, no year. Use for
  possessives ("Persson's") and any continuation reference where the
  year is supplied separately.
- `\citeyear{key}` — year only, no parens. Less common; use when the
  surrounding prose already supplies parens around the citation slot.
- `\citeyearpar{key}` — `(Year)`. Pair with `\citeauthor` for
  possessives, or use alone for continuation back-references where the
  author was named earlier in the sentence.

All seven `\cite…` commands accept `[locator]{key}` and comma-separated
multi-key forms.
- `\vexid{<uuid>}` — example id marker (no-op render; emitted on the
  same line immediately before each `\ex` / `\pex`).
- `\ex…\xe` — single-line numbered example. Optional `[exno=N]`,
  `<tag>`, `\label{…}`, and `~`-suffix to suppress trailing space.
- `\pex…\xe` — multi-part numbered example with `\a` sub-items. Same
  optional attrs as `\ex`.
- `\a` — sub-item marker inside `\pex` or `\begin{xlist}`. Optional
  `<tag>`, `\label{…}`.
- `\begin{xlist}…\end{xlist}` — nested sub-tier inside an `\a` item;
  the parser cycles markers a → i → A → I across nesting depth.
- `\begingl…\endgl` — interlinear gloss envelope. Can nest inside
  `\ex…\xe`, inside an `\a` item, or stand alone at body scope.
- `\gla` / `\glb` / `\glc` — aligned (column-by-column) gloss tiers.
  Each tier line ends with `//`; multi-token cells are wrapped in
  `{braces}` to enforce alignment.
- `\glft` — free-translation tier (one quoted line, ends with `//`).
- `\glpreamble` — gloss preamble tier (free prose, ends with `//`).
- Plain text paragraphs

Do not introduce commands that aren't in this list.

> **Stripped packages.** `\usepackage{linguex}` and `\usepackage{gb4e}`
> are removed from the preamble during 3.h₂ — Virgil's parser
> interprets `\ex` / `\pex` / `\begingl` directly without those
> packages, and keeping them would cause the LaTeX preamble to load
> macro definitions that conflict with the parser's expex
> interpretation.

### Font policy (strip rule)

If the input `main.tex` contains any font-affecting preamble line —
`\usepackage{fontspec}`, `\setmainfont`, `\renewcommand{\rmdefault}{...}`,
`\usepackage{times|palatino|lmodern|mathptmx|newtx|...}`, `\fontfamily`,
`\usepackage[T1]{fontenc}` (when paired with a font choice), or any
similar font-controlling directive — **remove it**. Do not preserve,
translate, or replace it with a different font. The Virgil library
renderer pins fonts independently of the source via
`--library-editing-font`; the indexed `.tex` must stay font-agnostic.

The output preamble should match the minimal preamble emitted by
`tex_emit.py`:

```latex
\documentclass{article}
\usepackage[utf8]{inputenc}
\usepackage{amsmath, amssymb}
\providecommand{\pgmark}[1]{}
\providecommand{\vexid}[1]{}
```

…plus `\title`/`\author`/`\date` lines. Nothing else font-related.
(The `\vexid` provide-command keeps the `.tex` valid as a standalone
LaTeX document — `\vexid{…}` renders as a no-op outside Virgil.
`\providecommand` for the expex envelope commands themselves
(`\ex`, `\pex`, `\xe`, etc.) is **not** added; those are not meant to
typeset under stock LaTeX. Authors who want to compile the file with
pdflatex should also `\usepackage{expex}` themselves.)
