---
description: Draft a `kind: quotation` AI request — assembles a QuotationGroup with the requested quote(s) anchored to the paragraph. Args - <docPath> <requestId>.
---

# /editor/draft-quotation $ARGUMENTS

Resolve one AI request whose kind is `quotation`. The user wants to
quote something (often a passage from a cited source) anchored to a
specific paragraph. Direct create — no suggestion wrapper.

## Args

- `<docPath>` — path to the doc folder.
- `<requestId>` — the request id from `list_requests.py`.

## Procedure

1. **Load.** Request from `ai-requests.json`, paragraph context via
   `get_para_context.py`. If the request references a bibkey, resolve
   it via `bib_resolve.py` and pull the matching annotation if any.

2. **Source the quote.** If the request supplies the quote verbatim,
   use it. If it asks you to *find* a quote ("a quote from Bringhurst
   on the margin"), search the web — for a printed source, the
   prefix-match must be exact and verifiable; otherwise mark the
   request complete with a note explaining why and stop.

3. **Build the QuotationGroup.** See `src/lib/types.ts` for the
   schema. Minimum shape:
   ```json
   { "id": "<new-uuid>",
     "title": "<short identifier>",
     "items": [{
        "id": "<inner-uuid>",
        "text": "<the quote, plain text>",
        "source": "<author/title or bibkey reference>",
        "createdAt": "<ISO now>"
     }],
     "createdAt": "<ISO now>",
     "links": [{
        "id": "<link-uuid>",
        "kind": "anchor",
        "anchor": { "type": "anchor",
                    "paragraphIds": ["<uuid>"],
                    "margin": { "side": "right" } },
        "target": { "type": "card",
                    "ref": { "kind": "quotation", "id": "<new-uuid>" } },
        "createdAt": "<ISO now>"
     }]
   }
   ```

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

5. **Reply.**
   ```
   Done: added quotation <newId> for request <requestId>. Output: quotations.json (+ ai-requests.json, notifications, version).
   ```

## Safety

- Never fabricate a quote. If a verbatim source isn't reachable, mark
  complete with a note and stop.
- Quotes from copyright-sensitive material should stay short (fair-use
  excerpt). Use the user's request as the upper bound on length.
