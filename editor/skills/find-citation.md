---
description: Resolve a `kind: citation` AI request — find an authoritative source matching the user's description, add it to references.bib, and create a citation card linked to the anchor paragraph. Args - <docPath> <requestId>.
---

# /editor/find-citation $ARGUMENTS

Resolve one AI request whose kind is `citation`. The user has described
a paper they want to cite ("a recent post-2020 paper on the Hypothes.is
annotation platform that I can cite in §6"); your job is to identify a
real source, add it to the bibliography, and surface a `CitationRef`
card so the user can drag it into the document.

## Args

- `<docPath>` — path to the doc folder.
- `<requestId>` — the request id from `list_requests.py`.

## Procedure

1. **Load.** Read the request from `<docPath>/virgil/ai-requests.json`.
   Fetch paragraph context for the surrounding section so the citation
   makes sense in place:
   ```bash
   python3 editor/scripts/get_para_context.py <docPath> <uuid> --neighbors=2
   ```

2. **Search.** Use Crossref + OpenAlex + Semantic Scholar (in that
   order of preference) to find a real, citable paper that matches the
   request's description. The library's authentication helper is the
   right tool:
   ```bash
   python3 library/scripts/bib_auth.py --query "<query string>" --type article
   ```
   If `library/scripts/bib_auth.py` is unavailable from this `cwd`,
   shell out to WebFetch / WebSearch with the same source priority.

   Acceptance bar: prefer DOI-verified results. If you can't find
   anything that meets the request's criteria, **mark the request
   complete with a note explaining why** rather than fabricating a
   citation.

3. **Generate a citekey.** `<LastNameYear>` lowercased
   (e.g. `mcgrenere2022`). On collision in `references.bib`, suffix
   with `a`, `b`, ….

4. **Add to `references.bib`.** Append a complete BibTeX entry —
   include doi, year, author, title, journal, volume, number, pages.
   Use `@article` / `@book` / `@inproceedings` as appropriate.

5. **Build the CitationRef** (see `src/lib/types.ts:202`):
   ```json
   { "id": "<new-uuid>",
     "command": "\\citet{<citekey>}",
     "keys": ["<citekey>"],
     "createdAt": "<ISO now>",
     "unanchored": true
   }
   ```
   Set `unanchored: true` — the user drags the card to anchor it; the
   editor strips the flag on drop.

   For biblatex docs (detect via `\usepackage{biblatex}` in the .tex
   preamble), use `\textcite{...}` instead of `\citet{...}`.

6. **Apply.**
   ```bash
   python3 editor/scripts/apply_response.py <docPath> '<op-json>'
   ```
   ```json
   { "requestId": "<requestId>",
     "panel": "citations",
     "card": { ...the CitationRef... },
     "summary": "Added <citekey> to bibliography",
     "clearSourceFlag": false
   }
   ```
   The `references.bib` write is separate — use the Edit tool to
   append the entry.

7. **Reply.**
   ```
   Done: added <citekey> to references.bib and citations.json for request <requestId>. Output: references.bib + citations.json (+ ai-requests.json, notifications, version).
   ```

## Failure mode

If you can't confidently find a real source for the description, do
**not** fabricate. Run:
```bash
python3 editor/scripts/apply_response.py <docPath> --complete-only <requestId> --note "Could not locate a paper matching <criteria>; user should refine the request."
```
And reply:
```
Skipped <requestId>: no source found matching '<criteria>'.
```
