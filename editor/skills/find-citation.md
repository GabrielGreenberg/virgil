---
description: |
  Find a citation matching the user's description and add it to a
  Virgil paper. Triggers on: "Virgil, find me a citation for X",
  "look up the source for this claim", "what's the citation for the
  paper on Y", "add a citation here for Z", or when there's a pending
  `kind: citation` request in the paper's AI-request inbox. Searches
  Crossref/OpenAlex/Semantic Scholar/arXiv, adds the entry to
  references.bib, and creates a citation card linked to the anchor
  paragraph. Does NOT trigger for verifying an existing bib entry
  (use answer-bib-review). Args: <docPath> <requestId>.
---

# /editor/find-citation $ARGUMENTS

Resolve one AI request whose kind is `citation`. The user has described
a paper they want to cite ("a recent post-2020 paper on the Hypothes.is
annotation platform that I can cite in §6"); your job is to identify a
real source, add it to the bibliography, and surface a `CitationRef`
card so the user can drag it into the document.

> **Shared doctrine — find-or-surface, never fabricate.** Read
> [_find-or-surface.md](_find-or-surface.md). Search the user's Virgil
> Library first, then external authoritative sources; if you can't
> locate a real match, surface the gap (the step-6 failure path) rather
> than inventing a citation. The acceptance bar in step 2 is this
> skill's own; the doctrine is the shared rule behind it.

> **Allowable-LaTeX doctrine.** Any LaTeX you compose or edit must stick to
> the vocabulary Virgil renders meaningfully — read
> [_latex-allowlist.md](_latex-allowlist.md). In particular use the tie `~`
> (never `\textasciitilde{}`) for a non-breaking space, plus the `\cite…`
> family and inline marks it lists; anything outside it renders as raw grey
> monospace.

## Args

- `<docPath>` — path to the doc folder.
- `<requestId>` — the request id from `list_requests.py`.

## Procedure

0. **Validate.** Before doing anything, check the request:
   - `kind == "citation"` (otherwise refuse).
   - the status is open (not the terminal `complete` / `failed` —
     re-running a terminal Task is a no-op).

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

   **Disambiguation rule for "different from `<existing-citekey>`"
   requests.** When the request describes the desired work *in
   contrast to* an existing entry ("different from grafton1997",
   "another Drucker paper", "something other than what jones2020
   covers"), read the existing entry's `title` field as the canonical
   ground truth for what the user thinks that entry is — not the
   `@type` or `journal`. Users see titles in rendered bibliographies;
   BibTeX type/journal metadata is invisible to them. Don't pick a
   candidate whose title matches or near-matches the existing
   entry's title even if its BibTeX type differs. (The existing
   entry may be malformed — type-vs-title mismatch is a real failure
   mode in the wild — but that's `answer-bib-review` territory; this
   skill only reads the existing entry, never repairs it.)

2. **Search.** Per the find-or-surface doctrine, search the user's
   Virgil Library *first* — they may already own the work, with verified
   metadata and a settled citekey. If a library is set up (resolve its
   root via `editor/scripts/library_path.py --get`, or its synced copy
   under `.virgil/scripts/editor/library_path.py`), scan `master.bib`
   for an entry matching the description; on a confident hit, reuse that
   entry verbatim (its citekey and fields) instead of minting a new one.
   A no-library / no-match falls through to external search — never a
   blocker.

   Then use Crossref + OpenAlex + Semantic Scholar (in that
   order of preference) to find a real, citable paper that matches the
   request's description. Try the library's search helper first — its
   `--query` mode is the DISCOVERY door (see
   [_find-or-surface.md](_find-or-surface.md), "Calling `bib_auth.py`"):
   ```bash
   python3 library/scripts/bib_auth.py --query "<query string>" --type "<kind>"
   ```
   It prints `{"mode": "search", "candidates": [...]}` — ranked records
   from every source, **not** a verdict. Treat each candidate as a lead
   and hold it to the acceptance bar below; a high `score` is title
   similarity, not verification.

   **Set `--type` from the work the request describes, or omit it.** It
   is a real filter, not a label: `article` narrows Crossref to
   journal articles, and `book`/`incollection`/`inbook` are what bring
   OpenLibrary and Google Books into the search at all. Passing
   `article` for a book request excludes the only catalogs that hold
   it. When the request doesn't say, omit the flag and search wide.

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

   **Verification quality wins ties on soft preferences.** When a
   soft preference points at a less-verifiable candidate and a
   more-verifiable alternative satisfies the request's *hard*
   requirements, prefer the more-verifiable work. A less-verifiable
   citation is a worse citation, even when it sits closer to the
   user's stated preference. Note the tradeoff in the op `summary`
   so the user can re-route if they want — e.g.,
   `"Added grafton-wq1997 to bibliography (chose Wilson Quarterly
   over Lingua Franca for verifiability)"`.

   The acceptance bar is **hard**, not a soft preference. If the
   soft-preferred candidate *fails* the acceptance bar (e.g. only
   one independent source for a non-DOI work), this is not a tie —
   pick the more-verifiable alternative outright. Soft preferences
   cannot override the acceptance bar.

   **What counts as "independent" sources.** An article scan or PDF
   reproduction on a scholarly aggregator (academia.edu, JSTOR,
   ResearchGate, etc.) counts as independent of an author-curated or
   institutional bibliography *listing* for the same article — the
   scan is direct evidence of the article's existence with the
   claimed metadata, not a derived listing. A list-only aggregator
   entry without the scan is derived (counts as one with the
   bibliography).

3. **Generate a citekey.** `<LastNameYear>` lowercased
   (e.g. `mcgrenere2022`). On collision in `references.bib`, suffix
   with `a`, `b`, …. Do **not** modify the colliding entry, even if it
   appears malformed (wrong type, wrong fields, wrong year). Bib
   hygiene is the `answer-bib-review` skill's responsibility, not
   find-citation.

4. **Compose the BibTeX entry.** Build a complete entry — it rides the
   writeback in step 6 as `bibEdit` (the contract appends it to
   `references.bib`, atomically, in the *same* commit as the citation
   card). Do **not** hand-append the file. Use `@article` / `@book` /
   `@inproceedings` as appropriate. Field policy:
   - **Always**: `year`, `author`, `title`. `doi` only if the work
     has one — omit it for pre-DOI works rather than fabricating from
     ISBN, LCCN, or a publisher landing-page URL (downstream tools
     reject non-DOI strings in the `doi` field).
   - **`@article`**: `journal`, `volume` always; `number` and `pages`
     only if the publication has them. For article-number-only
     journals (Frontiers, PLOS, eLife, MDPI, etc.) set
     `pages = {<article-number>}` and omit `number`. For non-journal
     periodicals (magazines, weeklies, quarterlies, alumni magazines
     — *Wilson Quarterly*, *Lingua Franca*, *Atlantic*, etc.), use
     `@article` with `journal = {<magazine name>}`; magazines
     reliably have volume + number + paginated pages, so apply the
     standard `@article` field policy unmodified.
   - **`@book`**: `publisher`, `address` always. ISBN/LCCN/OCLC may
     be included as `isbn = {...}`, `lccn = {...}`, `oclc = {...}` if
     known — never put them in `doi`.
   - **`@inproceedings`**: `booktitle`, `year`; `pages`, `editor`,
     `address`, `publisher` if available.

   Just compose the entry block itself (`@type{citekey, …}`) — the
   contract's `bibEdit` append inserts the blank-line separator and the
   single trailing `}\n` for you, and **refuses a citekey that already
   exists** (so if step 3's collision check missed one, the write fails
   loudly rather than duplicating).

5. **Build the CitationRef** (`CitationRef`, `src/lib/types.ts`):
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

6. **Apply — the citation card and the `.bib` entry land together, atomically.**
   One `complete-task` op carries *both* the `CitationRef` card and the
   `bibEdit` append, so they commit all-or-nothing under the pen — a crash
   can no longer leave one without the other. Status flips to
   `complete` / result `direct-created` (the two-field vocabulary).

   Because the entry carries LaTeX braces/backslashes, write the op to a
   temp file and pass it with `@` (robust JSON quoting). `mkdir -p` the
   `.virgil/` dir first — a fresh paper folder may not have it yet:
   ```bash
   mkdir -p "<docPath>/.virgil"
   cat > "<docPath>/.virgil/find-citation-op.json" <<'JSON'
   { "requestId": "<requestId>",
     "panel": "citations",
     "card": { ...the CitationRef (unanchored: true)... },
     "bibEdit": { "mode": "append", "entry": "@article{<citekey>, ... }" },
     "summary": "Added <citekey> to bibliography",
     "clearSourceFlag": false }
   JSON
   python3 editor/scripts/apply_response.py <docPath> complete-task "@<docPath>/.virgil/find-citation-op.json"
   ```
   (`entry` is the BibTeX block from step 4, as a JSON string — escape `\`
   as `\\` and newlines as `\n`. Inline `'<op-json>'` works too if you
   quote carefully.) Do **not** touch `references.bib` with the Edit tool;
   `apply_response.py` is the only writeback path.

7. **Reply.**
   ```
   Done: added <citekey> to references.bib and citations.json for request <requestId>. Output: references.bib + citations.json (+ ai-requests.json, notifications, version) — one atomic commit.
   ```

## Failure mode

Surfacing the gap is the find-or-surface doctrine's step 4
([_find-or-surface.md](_find-or-surface.md)) — the mechanics for this
skill are: if you can't confidently find a real source for the
description, take the failure path (two-field: status `failed`,
result `impossible` — no `.bib` / card write happens):
```bash
python3 editor/scripts/apply_response.py <docPath> complete-only <requestId> --result impossible --note "Could not locate a paper matching <criteria>; user should refine the request."
```
And reply:
```
Skipped <requestId>: no source found matching '<criteria>'.
```
