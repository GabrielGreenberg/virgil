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

0. **Validate.** Before doing anything, check the request:
   - `kind == "citation"` (otherwise refuse).
   - `status == "submitted"` (otherwise no-op).

   `paragraphIds` is optional for citation requests (the resulting
   card is `unanchored: true` — the user drags it to anchor).

1. **Load.** Read the request from `<docPath>/virgil/ai-requests.json`.
   Fetch paragraph context so the citation makes sense in place:
   - If the request has `paragraphIds`, run
     `get_para_context.py` on the first id with `--neighbors=2`.
   - Otherwise, scan the request `text` for `§N`, `section N`, or
     `\ref{label}`. If found, locate the corresponding `\section{...}`
     in the .tex by counting `\section{}` headers and run
     `get_para_context.py` on the uuid of the section's first
     paragraph.
   - Otherwise, skip the context fetch — the search query relies on
     the request `text` alone.

   ```bash
   python3 editor/scripts/get_para_context.py <docPath> <uuid> --neighbors=2
   ```

2. **Search.** Use Crossref + OpenAlex + Semantic Scholar (in that
   order of preference) to find a real, citable paper that matches the
   request's description. Try the library's authentication helper
   first:
   ```bash
   python3 library/scripts/bib_auth.py --query "<query string>" --type article
   ```
   Fall through to WebSearch + WebFetch (with the same source
   priority) if `bib_auth.py` is unavailable from this `cwd` OR
   errors with `ModuleNotFoundError` (deps not installed). Don't try
   to `pip install` — sandbox declared-dep rules will block it.
   WebSearch is fully supported as a primary tool, not a last resort.

   Acceptance bar:
   - **For works with a DOI** (most post-2000 articles): prefer
     DOI-verified — either (a) `https://doi.org/<doi>` resolves, (b)
     `api.crossref.org/works/<doi>` returns a matching record, or (c)
     WebFetch on the publisher landing page shows the DOI alongside
     matching title/authors/year.
   - **For works without a DOI** (pre-2000 books, magazine articles,
     working papers, conference posters): accept the citation if at
     least two independent authoritative sources (publisher catalog,
     OCLC/library catalog, peer-reviewed journal review, author-
     curated bibliography) match on author/title/year/publisher.
     "Independent" means independently typed — three database
     listings derived from a single MARC record count as one. Prefer
     sources of different *type* (publisher + peer-reviewed review +
     library record beats three Goodreads/Wikipedia/Amazon listings).
     WebFetch failures on a single source are not blocking when
     others have verified the same metadata.

   If you can't find anything that meets the request's criteria,
   **mark the request complete with a note explaining why** rather
   than fabricating a citation. If the request includes soft
   preferences ("ideally", "if available", "preferably") and they
   can't be satisfied but a fallback is implied, use the failure-mode
   path with a note explaining what was checked.

3. **Generate a citekey.** `<LastNameYear>` lowercased
   (e.g. `mcgrenere2022`). On collision in `references.bib`, suffix
   with `a`, `b`, …. Do **not** modify the colliding entry, even if it
   appears malformed (wrong type, wrong fields, wrong year). Bib
   hygiene is the `answer-bib-review` skill's responsibility, not
   find-citation.

4. **Add to `references.bib`.** Append a complete BibTeX entry. Use
   `@article` / `@book` / `@inproceedings` as appropriate. Field
   policy:
   - **Always**: `year`, `author`, `title`. `doi` only if the work
     has one — omit it for pre-DOI works rather than fabricating from
     ISBN, LCCN, or a publisher landing-page URL (downstream tools
     reject non-DOI strings in the `doi` field).
   - **`@article`**: `journal`, `volume` always; `number` and `pages`
     only if the publication has them. For article-number-only
     journals (Frontiers, PLOS, eLife, MDPI, etc.) set
     `pages = {<article-number>}` and omit `number`.
   - **`@book`**: `publisher`, `address` always. ISBN/LCCN/OCLC may
     be included as `isbn = {...}`, `lccn = {...}`, `oclc = {...}` if
     known — never put them in `doi`.
   - **`@inproceedings`**: `booktitle`, `year`; `pages`, `editor`,
     `address`, `publisher` if available.

   Append with a blank line separating the new entry from the
   previous one; the file should end with `}\n` (single trailing
   newline, no trailing blank line).

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

   Cite-command selection:
   - **biblatex doc** (detect via `\usepackage{biblatex}`): use
     `\textcite{...}`.
   - **natbib doc**: default to `\citet{...}`. If the request names an
     existing citekey, grep `document.tex` for `\cite*{<that-key>}`
     and match the cite-command of its first in-prose occurrence
     (so a collision-suffix entry like `grafton1997a` inherits the
     style used for `grafton1997`). If the request names a section,
     match the dominant style in that section's prose. The user can
     re-style on drag.

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
