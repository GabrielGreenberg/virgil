---
description: Resolve one bib-review request — verifies/fills bibliography fields (type=fields), drafts an annotation note (type=notes), or swaps the entry in from the library (--library-sync). Args - <docPath> <bibKey> [--library-sync <libraryCitekey> --library <path>].
---

# /editor/answer-bib-review $ARGUMENTS

Three modes:

- `type: "fields"` — the user wants you to verify or fill bibliography
  fields against authoritative sources. Mirror of
  `/library/authenticate-bib`.
- `type: "notes"` — the user wants you to draft an annotation note for
  the entry, persisted in `annotations.json`.
- `--library-sync` — replace the paper's entry with the canonical
  version from `master.bib` in the user's Virgil Library, renaming
  citekeys throughout the doc if the library's citekey differs.
  Invoked by `/editor/sync-bib-to-library`. Does **not** require a row
  in `bib-review-requests.json`.

## Args

- `<docPath>` — path to the doc folder.
- `<bibKey>` — the citekey under review (in the paper's references.bib).
- `--library-sync <libraryCitekey>` *(library-sync mode only)* — the
  citekey to pull from the library's `master.bib`. May equal `<bibKey>`.
- `--library <path>` *(library-sync mode only)* — absolute library
  root. If omitted, resolved via `editor/scripts/library_path.py --get`.

## Procedure

> **Library-sync mode short-circuits.** If `--library-sync
> <libraryCitekey>` is set, jump straight to step 3a — skip steps 1
> (bib-review-requests load), 2 (fields), 3 (notes), and 4 (request
> flip). Library-sync writes its own notification and exits.

> **Path resolution.** Every step below uses `$scripts_editor` and
> `$scripts_library` to invoke Python helpers. Resolve them once at the
> start of the procedure:
> ```bash
> scripts_editor=""
> for candidate in .virgil/scripts/editor editor/scripts; do
>   [ -d "$candidate" ] && { scripts_editor="$candidate"; break; }
> done
> scripts_library=""
> for candidate in .virgil/scripts/library library/scripts; do
>   [ -d "$candidate" ] && { scripts_library="$candidate"; break; }
> done
> if [ -z "$scripts_editor" ] || [ -z "$scripts_library" ]; then
>   echo "This folder doesn't look Virgil-managed (no synced scripts found)."
>   echo "Open the paper in Virgil first so cowork tooling syncs into it."
>   exit 1
> fi
> ```

1. **Load.** Resolve the entry:
   ```bash
   python3 "$scripts_editor/bib_resolve.py" <docPath> <bibKey>
   ```
   Stdout has `entry`, `type`, `fields`, `annotation`. Read the
   matching `bib-review-requests.json` row to find the request type +
   `requestNotes`.

2. **For `type: "fields"`:**
   - Look up the entry against Crossref → OpenAlex → Semantic Scholar
     → arXiv (in that order). Try the library's auth helper:
     ```bash
     python3 "$scripts_library/bib_auth.py" --citekey <bibKey> \
                                            --title "<existing title>" \
                                            --author "<existing author>" \
                                            --type article
     ```
     If it errors with `ModuleNotFoundError` (deps not installed) or
     can't resolve from `cwd`, fall through to direct Crossref /
     OpenAlex lookups via stdlib `urllib.request` (both expose JSON
     without auth) or WebSearch + WebFetch. Don't try to `pip install`.
   - Apply the user's `requestNotes` as additional guidance ("Add
     DOI; double-check the page range" → focus DOI lookup, then
     verify the page-range field).
   - **If the lookup proves the entry's `@type` is wrong** (e.g.
     `@article` masking a book, as can happen when the title and
     metadata diverge): change the type and reshape the field set
     to match the actual work. Preserve only the citekey verbatim
     and any field the lookup confirms. Drop fields that don't
     belong on the new type (e.g. drop `journal`/`volume`/`number`
     when changing `@article` → `@book`).
   - Otherwise edit `<docPath>/<bibFilename>` to replace the entry
     block with the corrected version. Preserve the citekey verbatim.
   - If the user asked to "Add DOI" but no DOI is registered for the
     work (common for pre-2000 trade books, many humanities titles):
     declare this explicitly in the reply rather than leaving the
     omission silent.

3. **For `type: "notes"`:**
   - Read the entry + the user's `requestNotes`.
   - Draft a 60–150 word annotation summarizing what the entry argues
     and (when the request asks) why it matters for *this* paper.
   - Edit `<docPath>/virgil/annotations.json` to set
     `annotations.<bibKey> = { "text": "<your note>" }` (or whatever
     shape `bib_resolve.py` reports — tolerate either flat or nested
     forms).

3a. **For `--library-sync <libraryCitekey>`:**
   - Resolve the library root. The script directories were already
     established at the top of the procedure (`$scripts_editor`,
     `$scripts_library`); we reuse them here:
     ```bash
     if [ -n "$LIBRARY" ]; then
       library_root="$LIBRARY"
     else
       library_root=$(python3 "$scripts_editor/library_path.py" --get) || {
         echo "No library set up. Pick a library in Virgil first."
         exit 1
       }
     fi
     ```
   - Read the library entry verbatim:
     ```bash
     python3 -c '
     import sys
     from pathlib import Path
     sys.path.insert(0, "'"$scripts_library"'")
     from _bib_parse import find_entry_span
     text = Path("'"$library_root"'/master.bib").read_text(encoding="utf-8")
     span = find_entry_span(text, "<libraryCitekey>")
     if span is None: raise SystemExit("library missing <libraryCitekey>")
     start, end, _state_start = span
     print(text[start:end])
     '
     ```
     If the entry isn't found, fail with `library missing <libraryCitekey>`.
   - Replace the paper's bib entry block: locate `@<type>{<bibKey>,` in
     `<docPath>/references.bib` (use the same `find_entry_span` helper
     to determine the byte range), and Edit the file to replace the
     entire span with the library entry text. Preserve a trailing
     newline so subsequent entries stay separated.
   - If `<bibKey> != <libraryCitekey>`, rewrite every `\cite*{...}`
     command and update `virgil/citations.json`:
     ```bash
     python3 "$scripts_editor/rename_citekey.py" <docPath> <bibKey> <libraryCitekey>
     ```
   - Skip the bib-review-requests.json flip — library-sync isn't driven
     by that file. Skip external Crossref/OpenAlex lookups — the
     library entry is already authoritative.
   - Append a single notification + bump version (same pattern as the
     fallback in step 4 below):
     ```bash
     python3 -c "from editor.scripts._common import append_notification, bump_version, now_iso, resolve_doc; \
                 doc = resolve_doc('<docPath>'); \
                 append_notification(doc, {'kind': 'ai-request-complete', 'at': now_iso(), 'summary': 'library-sync <bibKey> -> <libraryCitekey>'}); \
                 bump_version(doc)"
     ```
   - Reply: `Done: library-sync <bibKey> -> <libraryCitekey>. Output: references.bib, document.tex, virgil/citations.json.` (Omit any file that wasn't actually changed.)

4. **Mark complete.** Edit
   `<docPath>/virgil/bib-review-requests.json` to flip the matching
   entry's `status` from `"pending"` to `"complete"`. Then notify +
   bump version:
   ```bash
   python3 "$scripts_editor/apply_response.py" <docPath> --complete-only <bibKey> --note "Updated bib entry <bibKey> (<type>)"
   ```
   *(`--complete-only` here is repurposed to write the notification +
   version-bump path; the request-id resolution falls through harmlessly
   for bib reviews since they don't live in `ai-requests.json`.)*

   **Expected:** `apply_response.py --complete-only <bibKey>` will
   typically error with `request id not found: <bibKey>` because
   bib-review keys aren't in `ai-requests.json`. The fallback below
   is the normal path, not a recovery path:
   ```bash
   python3 -c "from editor.scripts._common import append_notification, bump_version, now_iso, resolve_doc; \
               doc = resolve_doc('<docPath>'); \
               append_notification(doc, {'kind': 'ai-request-complete', 'at': now_iso(), 'summary': 'Updated bib entry <bibKey>'}); \
               bump_version(doc)"
   ```

5. **Reply.**
   ```
   Done: <type> review on <bibKey>. Output: <files changed>.
   ```

## Safety

- Don't fabricate fields. If a field can't be verified from a source,
  leave it as-is and note in the response which fields are still
  unverified.
- The DOI is the gold standard — try Crossref-by-DOI first when one
  exists.
