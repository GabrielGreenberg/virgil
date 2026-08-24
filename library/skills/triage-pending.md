---
description: |
  Batch-triage every file in the library's unsorted/ folder at once —
  propose citekeys for the whole inbox, surface them for review, then
  apply the (possibly edited) decisions in a single transaction.
  Triggers on: "triage everything in unsorted", "process my pending
  uploads", "name all the papers I dropped", "Virgil, batch-triage
  the inbox", "drain the unsorted folder". Heavy — must run from
  inside the library folder. Pass `auto` to skip the review step.
  Does NOT trigger for single files (use /triage-pdf). Args: optional
  `auto`.
---

# /triage-pending $ARGUMENTS

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

Drain `unsorted/` in one batch. Use this instead of invoking
`/triage-pdf` once per file when you have more than a handful of new
sources to triage — `/triage-pdf` is the per-file workflow; this is the
batch equivalent.

> **Where any memo you write goes.** Library memos (notes about this
> pipeline — retros, indexing-flow ideas) → `.virgil/memos/<YYYY-MM-DD>-<slug>.md`.
> A reflection about Virgil's *skill set* is a dev-loop note, **not** a library
> memo — never file a reflection under `.virgil/memos/` (see `.claude/virgil/memos.md`).
> Paper-specific notes → `papers/<citekey>/notes/<slug>.md`.
> Never drop a markdown file at the library root.

The work splits into three phases:

1. **Extract** observables for every file (one shell command).
2. **Review** the proposed citekeys / types / flags (you, in chat).
3. **Apply** the confirmed decisions (one shell command).

All paths below are relative to the library root (the current working
directory).

## Steps

1. **Extract.** Run the batch script:
   ```bash
   python3 .virgil/scripts/library/triage_batch.py --output /tmp/triage.jsonl
   ```
   This walks `unsorted/` and emits one JSON line per **document or bib
   entry**. Supported source kinds:
   - `.pdf` / `.docx` → one row per file (existing behavior)
   - `.tex` → one row per file. Metadata read from `\title{}/\author{}/\date{}`.
   - `.bib` → **one row per entry inside the file** (multi-entry fan-out).
     Each row carries `flags: ["bib-only"]` and a `bibEntryRaw` field;
     no source-file move happens at apply time.

   **Layered extractor (PDF rows).** The default extractor is
   `pdftotext` (cheap, ~30s for a backlog of hundreds). When the
   heuristic produces an empty / stopword / filename-stem citekey,
   add `--marker-rescue` so marker-pdf re-runs on heuristic-failed
   rows for layout-aware extraction (typically 10-30% of a
   placeholder-named backlog). Marker output is sha256-cached at
   `.virgil/extraction-cache/<sha>/` so repeated triage runs don't
   re-pay the cost. See 2026-05-16-triage-no-name-pdfs.md.

   ```bash
   python3 .virgil/scripts/library/triage_batch.py \\
       --marker-rescue --output /tmp/triage.jsonl
   ```

   Each row carries:
   - `filename`, `extension`
   - `proposedCitekey`, `proposedType` — best-effort proposals from
     filename and content. Empty string when the heuristic detected
     a stopword/publisher author or degenerate filename fallback
     (e.g., `unnamed-N.pdf`); paired with `flags: ["needs-metadata"]`.
   - `flags`: subset of `["filename-mismatch", "whole-handbook",
     "variant-copy", "sep", "preprint", "unsupported-ext", "error",
     "bib-only", "citekey-exists", "bib-manuscript", "bib-parse-failed",
     "needs-metadata", "needs-title", "year-from-pdf-metadata",
     "year-scan-fallback"]`
   - `proposedFields`: bib-stub fields (title, doi, isbn, url, etc.)
   - `proposedBibState` (bib-only rows only): `"unverified"` or `"manuscript"`
   - `byline`, `textPreview`, `notes`

   **Safeguards.** `triage_batch.py` refuses to mark files with
   degenerate base stems (no letters) as variant-copy and refuses to
   mint citekeys from stopword/publisher author candidates (`press`,
   `university`, `editors`, …). These return empty citekeys plus
   `needs-metadata` flag; `triage_apply.py` quarantines them to
   `unsorted/_needs-metadata/` rather than minting garbage
   `papers/<garbage>/` directories. The cluster-size guard in
   `triage_apply.py` also strips the `variant-copy` flag when >10
   children claim to be variants of the same parent.

2. **Review.** Read `/tmp/triage.jsonl` and present a concise summary
   to the user. Group by flag — flagged rows get a one-line note in
   the summary, clean rows are just counted:
   ```
   Triage proposals (47 files):
     - 38 clean → @article (DOI present: 22, no DOI: 16)
     - 5 books (ISBN present)
     - 2 SEP entries
     - 1 whole-handbook → needs chapter info from user
     - 1 filename-mismatch → Friedman2014 (filename said Vinci)
     - 0 variants
   ```
   Surface anything that looks wrong (a `proposedType=article` for a
   clearly-book filename; a SEP entry without `sep` flag; a citekey
   collision with `master.bib`). Edit the JSONL in place when you find
   issues — the apply script reads whatever you give it.

   **Skip review when `$ARGUMENTS == "auto"`.** Use this only after a
   prior batch has been reviewed and the input is known-good (e.g.,
   re-running after a partial failure).

3. **Apply.** Pipe the (possibly edited) JSONL into the apply script:
   ```bash
   python3 .virgil/scripts/library/triage_apply.py --input /tmp/triage.jsonl
   ```
   For each row this:
   - **whole-handbook** → moves file to `unsorted/_pending/`,
     emits a `triage-needs-chapter-info` notification (frontend will
     prompt the user)
   - **variant-copy** + `existingCitekey` → archives under
     `papers/<existingCitekey>/variants/<filename>`, no new bib entry
   - **bib-only** → upserts the entry into `master.bib` (merging field-by-field
     when an existing unverified/failed/none row already has the same
     citekey; ignoring entirely when the existing state is `authenticated`
     or `manuscript`), creates a minimal `papers/<citekey>/`
     (`references.bib` + empty `virgil/` sidecars; no source file, no
     `main.tex`), inserts a bib-only catalog row (`pdf.present: false`,
     `indexed.state: "none"`), and queues `kind: "authenticate"` (or
     skips queueing when `proposedBibState == "manuscript"`). After all
     rows from one `.bib` file have been applied, the source `.bib` is
     deleted from `unsorted/` (or parked under `_pending/` if any rows
     hit a parse error).
   - **otherwise** → appends a stub to `master.bib`, moves the file to
     `papers/<citekey>/<citekey>.<ext>`, writes `.virgil/queue/<citekey>.json` (kind=index)
   - emits a `triaged` / `triage-filename-mismatch` / `triage-bib-imported`
     / `triage-bib-summary` / `triage-bib-ignored-<state>` notification
     per row (the ignored kind names the SETTLED state that won —
     `authenticated`, `manuscript` or `canonical`; see `TERMINAL_BIB_STATES`)
   - bumps `.virgil/catalog-version.txt` once at the end

   Capture the script's per-row output and final summary in your reply.

4. **Drain the queue.** After triage, the queue has N pending `index`
   entries. Run `/index-pending` (or `python3 .virgil/scripts/library/drain_queue.py`
   directly) to actually index every paper and authenticate every bib.

### Optional: `--llm-rescue` for the residual

After `--marker-rescue` runs, some rows (typically 5-15% of a
placeholder-named backlog) still have no usable citekey — the title
page is missing, OCR garbled the byline beyond recovery, or the year
sits buried somewhere marker didn't reach. For these, dispatch a
final LLM-rescue pass:

```bash
# 1. Stage prompts for rows that need LLM rescue.
python3 .virgil/scripts/library/triage_llm_rescue.py emit-prompts \\
    /tmp/triage.jsonl --out-dir /tmp/llm-rescue/

# 2. For each /tmp/llm-rescue/prompts/row-NNNN.txt, dispatch a
#    Sonnet subagent via the Agent tool with that prompt as its
#    input and write the JSON response to
#    /tmp/llm-rescue/responses/row-NNNN.json.

# 3. Merge responses back into the JSONL.
python3 .virgil/scripts/library/triage_llm_rescue.py merge-responses \\
    /tmp/triage.jsonl --responses-dir /tmp/llm-rescue/responses \\
    --output /tmp/triage.llm.jsonl

# 4. Backfill years via Crossref for rows where the LLM found
#    title+author but no year.
python3 .virgil/scripts/library/triage_llm_rescue.py crossref-year-backfill \\
    /tmp/triage.llm.jsonl --output /tmp/triage.final.jsonl
```

Token cost: ~$0.01-0.05 per row with Sonnet. Only run when the
backlog includes a substantial residual of placeholder-named PDFs
(>20% with `needs-metadata` after `--marker-rescue`). Rows the LLM
also can't resolve remain in `_needs-metadata/` quarantine.

## Reply format

Three blocks:

1. The summary table from step 2 (proposed counts by flag/type)
2. The per-row output from `triage_apply.py` (one line per file)
3. A final line: `Triaged N files: <indexed> queued, <handbooks> need chapter info, <variants> archived, <skipped> skipped.`

If anything went wrong in apply, paste the relevant error message and stop —
do not try to manually re-run portions; rerun `triage_apply.py` after
fixing the JSONL.
