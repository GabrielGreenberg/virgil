---
description: Resolve one bib-review request — verifies/fills bibliography fields (type=fields) or drafts an annotation note (type=notes). Args - <docPath> <bibKey>.
---

# /editor/answer-bib-review $ARGUMENTS

Resolve one entry in `<docPath>/virgil/bib-review-requests.json`. Two
review types:

- `type: "fields"` — the user wants you to verify or fill bibliography
  fields against authoritative sources. Mirror of
  `/library/authenticate-bib`.
- `type: "notes"` — the user wants you to draft an annotation note for
  the entry, persisted in `annotations.json`.

## Args

- `<docPath>` — path to the doc folder.
- `<bibKey>` — the citekey under review.

## Procedure

1. **Load.** Resolve the entry:
   ```bash
   python3 editor/scripts/bib_resolve.py <docPath> <bibKey>
   ```
   Stdout has `entry`, `type`, `fields`, `annotation`. Read the
   matching `bib-review-requests.json` row to find the request type +
   `requestNotes`.

2. **For `type: "fields"`:**
   - Look up the entry against Crossref → OpenAlex → Semantic Scholar
     → arXiv (in that order). Reuse the library's auth helper if it
     resolves from `cwd`:
     ```bash
     python3 library/scripts/bib_auth.py --citekey <bibKey> \
                                         --title "<existing title>" \
                                         --author "<existing author>" \
                                         --type article
     ```
   - Apply the user's `requestNotes` as additional guidance ("Add
     DOI; double-check the page range" → focus DOI lookup, then
     verify the page-range field).
   - Edit `<docPath>/<bibFilename>` to replace the entry block with
     the corrected version. Preserve the citekey verbatim.

3. **For `type: "notes"`:**
   - Read the entry + the user's `requestNotes`.
   - Draft a 60–150 word annotation summarizing what the entry argues
     and (when the request asks) why it matters for *this* paper.
   - Edit `<docPath>/virgil/annotations.json` to set
     `annotations.<bibKey> = { "text": "<your note>" }` (or whatever
     shape `bib_resolve.py` reports — tolerate either flat or nested
     forms).

4. **Mark complete.** Edit
   `<docPath>/virgil/bib-review-requests.json` to flip the matching
   entry's `status` from `"pending"` to `"complete"`. Then notify +
   bump version:
   ```bash
   python3 editor/scripts/apply_response.py <docPath> --complete-only <bibKey> --note "Updated bib entry <bibKey> (<type>)"
   ```
   *(`--complete-only` here is repurposed to write the notification +
   version-bump path; the request-id resolution falls through harmlessly
   for bib reviews since they don't live in `ai-requests.json`.)*

   If `apply_response.py --complete-only <bibKey>` errors (because no
   matching id is in `ai-requests.json`), notify directly by running:
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
