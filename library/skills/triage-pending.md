---
description: Batch-triage every file in ~/Virgil-Library/pdfs/unsorted/. Produces a JSONL of proposed citekeys + flags for review, then applies the (possibly edited) decisions in one transaction. Args (optional): "auto" to skip review and apply directly.
---

# /triage-pending $ARGUMENTS

Drain `pdfs/unsorted/` in one batch. Use this instead of invoking
`/triage-pdf` once per file when you have more than a handful of new
sources to triage — `/triage-pdf` is the per-file workflow; this is the
batch equivalent.

The work splits into three phases:

1. **Extract** observables for every file (one shell command).
2. **Review** the proposed citekeys / types / flags (you, in chat).
3. **Apply** the confirmed decisions (one shell command).

All paths below are relative to the library root (the current working
directory).

## Steps

1. **Extract.** Run the batch script:
   ```bash
   python3 scripts/triage_batch.py --output /tmp/triage.jsonl
   ```
   This walks `pdfs/unsorted/`, reads each file's first-page text (PDF)
   or core properties (DOCX), and emits one JSON line per file. Each row
   carries:
   - `filename`, `extension`
   - `proposedCitekey`, `proposedType` — best-effort proposals from
     filename and content
   - `flags`: subset of `["filename-mismatch", "whole-handbook",
     "variant-copy", "sep", "preprint", "unsupported-ext", "error"]`
   - `proposedFields`: bib-stub fields (title, doi, isbn, url, etc.)
   - `byline`, `textPreview`, `notes`

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
   python3 scripts/triage_apply.py --input /tmp/triage.jsonl
   ```
   For each row this:
   - **whole-handbook** → moves file to `pdfs/unsorted/_pending/`,
     emits a `triage-needs-chapter-info` notification (frontend will
     prompt the user)
   - **variant-copy** + `existingCitekey` → archives under
     `papers/<existingCitekey>/variants/<filename>`, no new bib entry
   - **otherwise** → appends a stub to `master.bib`, moves the file to
     `pdfs/<citekey>.<ext>`, writes `queue/<citekey>.json` (kind=index)
   - emits a `triaged` (or `triage-filename-mismatch`) notification per row
   - bumps `catalog-version.txt` once at the end

   Capture the script's per-row output and final summary in your reply.

4. **Drain the queue.** After triage, the queue has N pending `index`
   entries. Run `/index-pending` (or `python3 scripts/drain_queue.py`
   directly) to actually index every paper and authenticate every bib.

## Reply format

Three blocks:

1. The summary table from step 2 (proposed counts by flag/type)
2. The per-row output from `triage_apply.py` (one line per file)
3. A final line: `Triaged N files: <indexed> queued, <handbooks> need chapter info, <variants> archived, <skipped> skipped.`

If anything went wrong in apply, paste the relevant error message and stop —
do not try to manually re-run portions; rerun `triage_apply.py` after
fixing the JSONL.
