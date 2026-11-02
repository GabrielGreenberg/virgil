---
description: |
  Add printed-page anchors from a PDF source to a library paper that
  was originally indexed from a DOCX or TEX source (which carry no
  pagination). Triggers on: "fuse the PDF alternate for <citekey>",
  "add pgmarks from the PDF version of X", "Virgil, attach page
  numbers from the PDF to this paper". Reads the PDF alternate (the
  sibling `papers/<citekey>/<citekey>.pdf` the catalog lists under
  `pdf.alternates`), lines up the pagination, and inserts
  `\pgmark{N}` anchors into main.tex. Does NOT trigger for first-time
  indexing (use /library/index-paper). Args: <citekey>.
---

# /library/fuse-alternate $ARGUMENTS

> **Allowable-LaTeX doctrine.** The `\pgmark{N}` anchors this skill rewrites,
> and any surrounding `.tex` it touches, must stick to the vocabulary Virgil
> renders meaningfully — read
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

**Add page-anchor pagination from a PDF alternate to an already-indexed
paper.** Use this when the paper was indexed from a DOCX or TEX source
(clean text, but no `\pgmark{N}` markers because Word/LaTeX have no
printed-page concept) and a PDF alternate is also on disk. The fusion
step runs the existing PDF pgmark detector against the alternate,
fuzzy-aligns each page's first prose to the body of `main.tex`, and
splices `\pgmark{N}` lines at body scope.

Fusion is **additive** — it never re-emits `main.tex` from blocks,
never modifies citations / examples / footnotes / bibliography, only
adds `\pgmark{N}` lines. A previously deep-indexed paper keeps every
`\vexid{}\ex…\xe` envelope, every `\cite…{}` rewrite, and the
canonical bibliography itemize.

All paths are relative to the library root (the current working directory).

> **Where any memo you write goes.** Library memos (notes about this
> pipeline — retros, indexing-flow ideas) → `.virgil/memos/<YYYY-MM-DD>-<slug>.md`.
> A reflection about Virgil's *skill set* is a dev-loop note, **not** a library
> memo — never file a reflection under `.virgil/memos/` (see `.claude/virgil/memos.md`).
> Paper-specific analyses or reports → `papers/<citekey>/notes/<slug>.md`.
> Never drop a markdown file at the library root.

## Arguments

`$ARGUMENTS` is the citekey (e.g. `glanzbergmscoherence`).

## Prerequisites

- `papers/<citekey>/main.tex` must already exist (indexed or deepIndexed).
  If missing, tell the user to run `/library/index-pending` first and stop.
- `master.bib` must contain an entry for `<citekey>`.
- The paper must have a catalog row (`indexed.state` `indexed` or
  `deepIndexed`; legacy `richIndexed` accepted on read). You do not check
  this by reading the catalog — the script does, and says
  `fuse-alternate: … not in catalog` when there is none.

## Steps

The script is the executor and the reader: it reads the catalog row, picks
the alternate, gates idempotency, aligns, validates, writes `main.tex`, and
— on its normal path — updates the catalog, appends the notification, and
writes the log. This skill runs it and reads its outcome. **Do not read
`.virgil/catalog.json` yourself** (library/AGENTS.md: a skill never reads or
writes it directly) and do not re-derive any decision below from it.

### 1. Run the fuser

From the library root:

```bash
python3 .virgil/scripts/library/fuse_alternate.py <citekey>
echo "exit=$?"
```

Pass `--alternate <filename>` only when the user named a specific file
(it must sit in `papers/<citekey>/`). Without it the script's
`_resolve_alternate` chooses: it refuses a PDF primary, filters the row's
`pdf.alternates` to `.pdf` names, and takes the one with the most pages.
Its `_idempotency_skip` then decides "already fused" (the row's
`indexed.pgmarkSource` names this alternate, `pgmarkCount > 0` equals the
in-file body-scope `\pgmark{N}` count, and every in-file page is one the
PDF yields).

Alignment is `difflib.SequenceMatcher` at `PRIMARY_THRESHOLD`, with a
substring-match fallback for DOCX-joined paragraphs; injection is at body
scope (the canonical pgmark scope state machine); `pgmark_validate.validate`
is a hard gate before the atomic write. The script prints one diagnostic
line per PDF page — show them to the user as printed, don't reformat them.

### 2. Read the outcome

The exit code and the line that accompanies it are the whole answer
(`fuse_alternate.py` `main()`):

| Exit | Line | Meaning | `main.tex` |
|---|---|---|---|
| 0 | stderr `fuse-alternate: <reason>` | Nothing to fuse — `_resolve_alternate` refused (primary is already a PDF, no PDF alternate, citekey not in the catalog, or the named `--alternate` is missing). Relay `<reason>` verbatim and stop. | unchanged |
| 0 | stdout `already fused from <pdf> — no-op (pgmarkCount=<N>)` | Idempotent no-op. | unchanged |
| 0 | stdout `Fused <N>/<P> pgmarks from <pdf> (aligned <K>)` | Success. On the normal path the script has ALSO written the catalog row, the `fused` notification and the log (it prints `Log: <path>`). | written |
| 1 | stderr `fusion FAILED: <aborted_reason>` | Refused — see **Failure modes** for each `<aborted_reason>`. | unchanged |
| 2 | a traceback | A crash. Report it verbatim; it is a bug. | check — the crash may follow the write |

On success with the normal path you are done — go to step 4. Step 3's
catalog patch and notification exist only for `--no-catalog`.

### 3. Only under `--no-catalog`: catalog row + notification

`--no-catalog` writes `main.tex` and skips the script's catalog write,
notification and log (`--dry-run` writes nothing at all). Use it only when
something outside this skill owns the bookkeeping; then you do the two
writes the script skipped. **On the normal path, do neither** — the script
already did both, and repeating them toasts the user twice.

Do the catalog update via the locked CLI shim — do **not** Read/Write
`catalog.json` directly:

```bash
t=$(mktemp -d "${TMPDIR:-/tmp}/virgil-fuse-alternate.XXXXXX")
set -e   # a failing shim must stop the fence, not be masked by the `rm`
# An ARRAY, not a plain string: zsh does not word-split an unquoted
# parameter expansion (bash does), so `$FLAGS` would arrive as ONE argv
# element and the shim would reject the whole invocation.
RECOMPUTE_FLAGS=($(python3 .virgil/scripts/library/fuse_alternate.py --print-recompute-flags))
# Fail CLOSED: with no flags the patch's `warnings` array REPLACES the row's
# — the whole-array clobber this fence was migrated off. Stop instead.
[ ${#RECOMPUTE_FLAGS[@]} -gt 0 ] || { echo "recompute-flag emitter produced nothing — NOT patching warnings"; exit 1; }
cat > "$t/patch.json" <<'EOF'
{
  "indexed": {
    "pgmarkSource": "<pdf-filename>",
    "pgmarkCount": <count from main.tex>,
    "pgmarkPosition": "<header|footer|mixed|unknown>",
    "lastIndexedAt": "<ISO now>",
    "warnings": [<ONLY this run's fresh fusion lines — see below>]
  }
}
EOF
python3 .virgil/scripts/library/update_catalog_entry.py "$ARGUMENTS" \
  --patch-file "$t/patch.json" "${RECOMPUTE_FLAGS[@]}"
rm -rf "$t"
```

The patch deep-merges, so `indexed.state` (`deepIndexed` /
`indexed`), `extractor`, `footnoteCount`, `exampleCount`, and other
`indexed.*` fields are preserved automatically — only the keys you
include get replaced. The script also bumps
`.virgil/catalog-version.txt` for you.

**Do NOT read and re-supply the existing `warnings` array.** Put in
`warnings` only the lines THIS run computed — and do not compose them
yourself: the script printed them verbatim under

```
  Catalog warnings for this run (copy verbatim into indexed.warnings; empty means []):
```

Copy those lines, trimmed of leading spaces. That block is the same list
the primary (catalog-writing) path stores, produced by the same function,
so the two routes cannot disagree. **This matters more than it looks:**
`$RECOMPUTE_FLAGS` declares every head in the family, and a declared head
with no fresh line CLEARS — so inventing the list by hand, or omitting a
continuity finding you had no way to see, silently deletes a finding this
very run reproduced. (Continuity findings never abort a fusion — only
scope violations do — and under `--no-catalog` no log file is written, so
that printed block is the only place THIS run reports them. You could
re-derive the same pairs with `python3 .virgil/scripts/library/pgmark_validate.py
papers/$ARGUMENTS/main.tex --json` and format them yourself; copying the
printed block is better, because it comes from the same function the
catalog-writing path uses and therefore cannot disagree with it.)

A clean fusion printed none — write `"warnings": []`, and
keep the key: with recompute flags the shim REFUSES a patch whose
`indexed.warnings` is missing (an implied empty array would let a patch
meant for one field wipe a whole kind), and `[]` correctly clears any
stale fusion lines from a previous pass. `$RECOMPUTE_FLAGS` then makes
the shim drop exactly the
`pgmark-fusion-` family's heads against the row's LIVE array before
appending yours — so every other producer's warnings, and any
operator-authored `pgmark-fusion-<kind>-false-positive:` suppression,
survive byte-identically (task 323's per-kind recompute-replace; task
373 migrated this fence onto it).

The flag list is emitted by `fuse_alternate.py` rather than typed here
because the family's heads are DERIVED from
`pgmark_validate.CONTINUITY_FINDING_KINDS` — a hand list would silently
under-drop the day a continuity kind is added. Never free-type a
`pgmark-fusion-…` head into this file.

Then the notification — the script's `_append_fusion_notification`, by
hand. The shim OWNS the `kind` vocabulary (task 799): an undeclared kind is
refused with exit 2 and nothing is written. The kind is `fused` — the one
the script itself writes (`LOG_TAG_FUSED`), declared in
`_tools.NOTIFICATION_WRITER_SEVERITY`:

```bash
t=$(mktemp -d "${TMPDIR:-/tmp}/virgil-fuse-alternate.XXXXXX")
cat > "$t/notify.json" <<'EOF'
{
  "kind": "fused",
  "citekey": "$ARGUMENTS",
  "at": "<ISO>",
  "summary": "Fused <N> pgmarks from <pdf>"
}
EOF
python3 .virgil/scripts/library/append_inbox_item.py \
  --item-file "$t/notify.json"
rm -rf "$t"
```

No log file is written under `--no-catalog`; the printed diagnostics are
the record.

### 4. Report

One line: the `Fused …` line (or the no-op / refusal line) plus, on the
normal path, the `Log:` path — the script writes
`.virgil/logs/<citekey>/<timestamp>-fuse.summary.md` with the per-page
alignment table.

## Idempotency

Running `/library/fuse-alternate` twice on the same paper with the same
alternate is a strict no-op: the second run takes the `already fused` row of
step 2's table — exit 0, `main.tex` mtime unchanged, `catalog.json`
unchanged, `catalog-version.txt` unchanged, no notification.

## Failure modes

Every exit-1 refusal names a `FuseResult.aborted_reason` from
`fuse_pgmarks_into`. In every case `main.tex` is unchanged.

| `aborted_reason` | What to tell the user |
|---|---|
| `main-tex-missing` | `<citekey>` is not yet indexed — run `/library/index-pending` first. |
| `alternate-pdf-missing` | The alternate vanished between selection and read — re-run. |
| `no-pages` | No page anchors could be extracted from the PDF (no text layer, or no detectable printed page numbers) — nothing to align. |
| `already-has-pgmarks-no-source` | `main.tex` already carries body-scope `\pgmark{N}` with no recorded `pgmarkSource` — refusing to overwrite hand-authored markers. |
| `low-alignment <K>/<P>` | Only `<K>` of `<P>` PDF pages matched body prose (below `MIN_ALIGNED_FRACTION`). The PDF and the indexed text may be different versions. |
| `scope-violation` | The validator rejected the result; its report is on stderr. A bug — paste the report into a memo at `.virgil/memos/`. |

The "nothing to fuse" cases (PDF primary, no PDF alternate, not in the
catalog) are NOT failures: they exit 0 with a `fuse-alternate: …` line
(step 2's first row).

## What this command does NOT do

- Does not synthesize footnotes from the PDF. Footnote provenance is
  determined upstream by the `tex > docx > pdf` source priority — when
  the user has both a DOCX and a PDF, indexing picks DOCX (clean
  footnotes) and fusion adds pagination on top. PDF-only papers with
  pymupdf footnote loss need re-extraction via marker, not fusion.
- Does not re-extract text from the PDF. Only printed-page anchors.
- Does not re-emit `main.tex` from blocks. Operates on the existing file.
- Does not modify `master.bib` or `references.bib`.
- Does not change `indexed.state` (preserves `deepIndexed`),
  `extractor`, `footnoteCount`, `exampleCount`.
- Does not run on PDF-primary papers.
- Does not modify Virgil sidecars (`virgil/{virgil,notes,footnotes}.json`).
- Does not splice `\pgmark{N}` mid-paragraph in v1. Pgmarks land on
  their own blank-padded line between paragraphs; visual offset for
  cross-page paragraphs is up to one paragraph.

## Output format

```
Fused <citekey>.
Alternate: <pdf-filename> (<N> pages)
Pgmarks injected: <K>/<N> pages aligned (threshold 0.78).
Validator: clean.
```
