---
description: |
  Add printed-page anchors from a PDF source to a library paper that
  was originally indexed from a DOCX or TEX source (which carry no
  pagination). Triggers on: "fuse the PDF alternate for <citekey>",
  "add pgmarks from the PDF version of X", "Virgil, attach page
  numbers from the PDF to this paper". Reads the PDF alternate from
  `papers/<citekey>/variants/`, lines up the pagination, and inserts
  `\pgmark{N}` anchors into main.tex. Does NOT trigger for first-time
  indexing (use /index-paper). Args: <citekey>.
---

# /fuse-alternate $ARGUMENTS

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
  If missing, tell the user to run `/index-pending` first and stop.
- `master.bib` must contain an entry for `<citekey>`.
- `.virgil/catalog.json` must record the paper with
  `indexed.state in {"indexed", "deepIndexed"}` (legacy `richIndexed`
  accepted on read).

## Steps

### 1. Decide which alternate to use

Read `.virgil/catalog.json`. Find the entry for `<citekey>`.

- If `pdf.format == "pdf"` (the primary IS the PDF), stop with the
  message: `<citekey>'s primary source is already a PDF — pgmarks
  should already be present from the original index. Run /index-paper
  to re-derive if catalog disagrees.`
- Otherwise filter `pdf.alternates` to entries ending in `.pdf`.
  - If empty, stop with: `<citekey> has no PDF alternate. The
    .docx/.tex source is the only available pagination evidence —
    there's nothing to fuse.`
  - If exactly one PDF alternate, use it.
  - If multiple PDF alternates, pick the one with the largest page
    count.

### 2. Idempotency gate

If the catalog row already has:

- `indexed.pgmarkSource == <chosen-pdf>`, AND
- `indexed.pgmarkCount > 0`, AND
- in-file `\pgmark{N}` count matches `indexed.pgmarkCount`

…stop with success exit code: `<citekey> already fused from <pdf>
(pgmarkCount=<N>). No-op.` Do **not** re-run the script.

### 3. Run the fuser

From the library root:

```bash
python3 .virgil/scripts/library/fuse_alternate.py <citekey> --alternate <pdf-filename>
```

The script orchestrates: read main.tex, extract anchors from PDF, align
via `difflib.SequenceMatcher` (threshold 0.78, with a substring-match
fallback for DOCX-joined paragraphs), inject at body scope (walked up
via the canonical pgmark scope state machine), validate via
`pgmark_validate.validate`, write atomically.

Capture per-page diagnostics — the script prints one line per PDF page:
`page 7 → line 412 (sim 0.87)` or `page 12 SKIPPED (below-threshold)`.

### 4. Validate output

The script already calls `pgmark_validate` as a hard gate. Exit code
non-zero means the output didn't pass — no `main.tex` write happened
in that case. Print the validation report to the user and stop.

### 5. Update catalog

On success, the script's standalone CLI updates the catalog itself
(when invoked directly): sets `indexed.pgmarkSource`,
`indexed.pgmarkCount`, `indexed.pgmarkPosition`, bumps timestamps, and
appends a fused-kind notification.

If you invoked the underlying script with `--no-catalog`, do the
catalog update via the locked CLI shim — do **not** Read/Write
`catalog.json` directly:

```bash
set -e   # a failing shim must stop the fence, not be masked by the `rm`
# An ARRAY, not a plain string: zsh does not word-split an unquoted
# parameter expansion (bash does), so `$FLAGS` would arrive as ONE argv
# element and the shim would reject the whole invocation.
RECOMPUTE_FLAGS=($(python3 .virgil/scripts/library/fuse_alternate.py --print-recompute-flags))
# Fail CLOSED: with no flags the patch's `warnings` array REPLACES the row's
# — the whole-array clobber this fence was migrated off. Stop instead.
[ ${#RECOMPUTE_FLAGS[@]} -gt 0 ] || { echo "recompute-flag emitter produced nothing — NOT patching warnings"; exit 1; }
cat > /tmp/$ARGUMENTS-fuse-patch.json <<'EOF'
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
  --patch-file /tmp/$ARGUMENTS-fuse-patch.json "${RECOMPUTE_FLAGS[@]}"
rm /tmp/$ARGUMENTS-fuse-patch.json
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

If `RECOMPUTE_FLAGS` comes back empty (wrong working directory, missing
`python3`), **stop and report it** — do not run the patch without the
flags. Without them the array replaces rather than merges, which is the
clobber this fence exists to avoid; the emitter itself is stdlib-only, so
an empty result means the invocation was wrong, never that the family is
empty.

### 6. Notify

Append a notification via the locked CLI shim. `kind` must be a member of
`NotificationItem["kind"]` in `library/lib/queue.ts` — `"indexed"`,
`"authenticated"`, `"failed"`, `"triaged"`, `"setup-needed"`. An off-list
value is appended verbatim but falls through `notificationSeverity()` to the
default `info`, so it renders as an anonymous short toast; `"indexed"` is the
neutral member that fits a fuse. The specifics belong in `summary`.

```bash
cat > /tmp/$ARGUMENTS-fuse-notify.json <<'EOF'
{
  "kind": "indexed",
  "citekey": "$ARGUMENTS",
  "at": "<ISO>",
  "summary": "Fused <N> pgmarks from <pdf>"
}
EOF
python3 .virgil/scripts/library/append_inbox_item.py \
  --item-file /tmp/$ARGUMENTS-fuse-notify.json
rm /tmp/$ARGUMENTS-fuse-notify.json
```

### 7. Log

Write a summary log to `.virgil/logs/<citekey>/<ISO>-fuse.summary.md`
with per-page alignment table (the script writes this when invoked
directly).

## Idempotency

Running `/fuse-alternate` twice on the same paper with the same
alternate is a strict no-op:

- `indexed.pgmarkSource` already names this alternate, AND
- `indexed.pgmarkCount > 0`, AND
- in-file body-scope `\pgmark{N}` count matches

…⇒ skip with no-op message and exit 0. `main.tex` mtime unchanged,
`catalog.json` unchanged, `catalog-version.txt` unchanged.

## Failure modes

| Reason | Message |
|---|---|
| No `main.tex` | `<citekey> not yet indexed. Run /index-pending first.` |
| Primary IS pdf | `<citekey>'s primary source is already a PDF — …` |
| No PDF alternate | `<citekey> has no PDF alternate. …` |
| Already fused | `<citekey> already fused from <pdf>. No-op.` |
| Low alignment (<50%) | `Alignment failed: only <K>/<P> PDF pages matched body prose at threshold 0.78. The PDF and the indexed text may be different versions. main.tex unchanged.` |
| Scope violation | `Validator rejected fusion result. main.tex unchanged. This is a bug — paste the report into a memo at .virgil/memos/.` |
| Hand-authored pgmarks present | `<citekey> already has pgmarks in main.tex with no recorded source — refusing to overwrite hand-authored markers.` |

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
