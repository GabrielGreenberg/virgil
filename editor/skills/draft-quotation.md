---
description: |
  Pull a quotation (or several) from a source into a Virgil paragraph.
  Triggers on: "Virgil, quote this passage from <source>", "pull a
  quote from X on Y", "find me a quotation about Z", "block-quote that
  passage here", or when there's a pending `kind: quotation` request
  in the paper's AI-request inbox. Assembles a QuotationGroup with
  the requested quote(s) anchored to the paragraph. Does NOT trigger
  for adding a citation without quoted text (use find-citation) or for
  general notes (use answer-note-request). Args: <docPath> <requestId>.
---

# /editor/draft-quotation $ARGUMENTS

Resolve one AI request whose kind is `quotation`. The user wants to
quote something (often a passage from a cited source) anchored to a
specific paragraph. Direct create — no suggestion wrapper.

## Args

- `<docPath>` — path to the doc folder.
- `<requestId>` — the request id from `list_requests.py`.

## Procedure

0. **Validate.** Before doing anything, check the request:
   - `kind == "quotation"` (otherwise refuse).
   - `status == "submitted"` (otherwise no-op).
   - `paragraphIds` is non-empty.

   If `paragraphIds` is empty, halt: leave the request `submitted`,
   append a `kind: "ai-request-failed"` notification (the schema's
   only "needs attention" kind — `DocNotification.kind` in
   `src/lib/types.ts:213`) with summary "Halted: quotation request
   needs paragraph anchor", bump `version.txt`, and reply with the
   halt template from step 5.

1. **Load.** Request from `ai-requests.json`, paragraph context via
   `get_para_context.py`. If the request references a bibkey, resolve
   it via `bib_resolve.py` and pull the matching annotation if any.

2. **Source the quote.** If the request supplies the quote verbatim,
   use it. If it asks you to *find* a quote ("a quote from Bringhurst
   on the margin"), search the web — for a printed source, the
   prefix-match must be exact and verifiable; otherwise mark the
   request complete with a note explaining why and stop.

3. **Build the QuotationGroup.** See `src/lib/types.ts:457`. The
   group nests references → quotes:
   ```json
   { "id": "<group-uuid>",
     "title": "<short identifier>",
     "references": [{
        "id": "<reference-uuid>",
        "citeKey": "<bibkey>",
        "quotes": [{
           "id": "<quote-uuid>",
           "text": "<the quote, plain text>",
           "page": "<page string, or empty if unknown>"
        }]
     }],
     "notes": "",
     "createdAt": "<ISO now>",
     "links": [{
        "id": "<link-uuid>",
        "kind": "anchor",
        "anchor": { "type": "anchor",
                    "paragraphIds": ["<paragraph-uuid>"],
                    "margin": { "side": "left" } },
        "target": { "type": "card",
                    "ref": { "kind": "quotation", "id": "<group-uuid>" } },
        "createdAt": "<ISO now>"
     }]
   }
   ```
   - `notes` is required — default to `""`.
   - `page`: use the user's value verbatim. If absent, leave `""` —
     don't guess from article-level metadata.
   - `margin.side`: default `"left"` (matches existing house style in
     the sample paper).
   - If `paragraphIds` is set on the request, it is authoritative for
     the anchor; any natural-language paragraph reference in the
     request body is just a hint for the human reader.

4. **Apply.**
   ```bash
   python3 editor/scripts/apply_response.py <docPath> '<op-json>'
   ```
   ```json
   { "requestId": "<requestId>",
     "panel": "quotations",
     "card": { ...the QuotationGroup... },
     "summary": "Added quotation group: <title>",
     "clearSourceFlag": false
   }
   ```

5. **Reply.** On success:
   ```
   Done: added quotation <newId> for request <requestId>. Output: quotations.json (+ ai-requests.json, notifications, version).
   ```
   On halt (step 0 validation failed):
   ```
   Halted: request <requestId> has no paragraphIds; needs anchor before drafting.
   ```

## Safety

- Never fabricate a quote. If a verbatim source isn't reachable, mark
  complete with a note and stop.
- Quotes from copyright-sensitive material should stay short (fair-use
  excerpt). Use the user's request as the upper bound on length.
