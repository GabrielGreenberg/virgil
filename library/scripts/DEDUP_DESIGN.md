# Work-identity & de-duplication — design spec

Status: implementation contract. Authored 2026-07-03.

## Problem

The library identifies bibliographic records by **citekey string**, not by the
**work** they denote. The same work enters under divergent citekeys
(`greenberg2018content`/`greenberg2019content`, `modeling`/`modelling`), becoming
two first-class records in **both** `master.bib` and `.virgil/catalog.json`.

- master.bib: 27,014 entries → ~3,078 redundant (2,394 clusters).
- catalog.json: 4,290 rows → ~507 redundant (439 clusters); 382 clusters are
  "dangerous" (contain a real indexed/deep-indexed member).

The only real matcher (`find_duplicate` in `merge_paper_references.py`) is
imported by nothing else, and its fuzzy stage requires exact title AND year AND
surname — so year-drift and title variants still slip through.

## Solution: one shared work-identity layer

`work_identity.py` is the single source of truth for "are these the same work?"
Every write path consults it; the cleanup tool clusters with it; an alias map
records collapsed keys so nothing is ever truly lost.

### Identity signals (strongest → weakest)

1. **DOI** — normalized (lowercase, strip `https?://(dx.)?doi.org/`, trim).
2. **ISBN** — digits+X only, book-ish types.
3. **(title_norm, year, first-author surname)** — exact.
4. **Fuzzy title** (token-set Jaccard / prefix / subtitle) + surname + year window.

### Title normalization

- NFKD fold, strip accents, lowercase, strip LaTeX commands + braces,
  `&amp;`→`and`, collapse non-alphanumerics to single spaces, trim.
- `title_core` = title_norm truncated at the first `:` (subtitle removed), for
  prefix/subtitle-extension matching.
- **Generic-title guard**: titles whose core is empty, purely numeric, or in
  {introduction, preface, foreword, abstract, comments, reply, review,
  discussion, editorial, untitled, notes} may NEVER match on title alone —
  they require a DOI/ISBN match.

### classify(a, b) → Verdict(relation ∈ {same, distinct, uncertain}, confidence, reasons[])

Rules in priority order. **Title-divergence veto applies first.**

- **VETO**: if both sides have a non-generic title and `title_jaccard < 0.40`,
  the pair can never be `same`. A DOI/ISBN/SHA match with divergent titles →
  `uncertain` (flag), never `same`. (Kills the `10.1038/` placeholder-DOI
  false-merge and the `peirce1906` same-PDF-different-article pair.)
- **A** same/0.98: DOI equal AND not vetoed.
- **B** same/0.90: ISBN equal (book-ish) AND surname match AND jaccard ≥ 0.60.
- **C** same/0.95: title_norm equal AND year equal AND surname equal (non-generic).
- **D** same/0.88: title_norm equal AND surname equal AND |Δyear| ≤ 40
  (edition/preprint drift), non-generic, title length ≥ 12 chars.
- **E** uncertain/0.70: surname equal AND |Δyear| ≤ 1 AND (jaccard ≥ 0.85 OR one
  title_core is a prefix of the other).
- **F** uncertain/0.55: surname equal AND |Δyear| ≤ 3 AND 0.60 ≤ jaccard < 0.85.
- else **distinct**.

`same` → auto-mergeable. `uncertain` → send to LLM adjudication. `distinct` → leave.

Low confidence ⇒ LLM (per user directive): E and F are always routed to the
adjudicator, never auto-merged.

### WorkIndex

Built from records `{citekey, type, fields, meta}` where `meta` may carry
`bib_state, indexed_state, pgmarkCount, pageCount, has_folder, added_at,
sha256`. Inverted indices: `by_doi`, `by_isbn`, `by_title_year`,
`by_surname`. `candidates(fp)` returns the small union of buckets worth
comparing (keeps clustering ~O(N·k), not O(N²)). `find(fields, type,
exclude_ck) → [(citekey, Verdict)]` for the intake guard.

### Clustering (cleanup)

Union-find over `same` edges only. `uncertain` edges are recorded as
`candidate_links` for the adjudicator (never auto-union). Output: list of
clusters (size ≥ 2) + list of uncertain candidate pairs.

### Winner-selection — pick_survivor(cluster, loadbearing)

`loadbearing` = catalog citekeys ∪ `papers/` folder names.
Rank each member by tuple (higher wins):
1. is_loadbearing (bool)
2. index_depth: deepIndexed=3, indexed=2, none/absent=1
3. bib_state: canonical=4, authenticated=3, needs-reauth=2, unverified/other=1, manuscript/failed=0
4. pgmarkCount, then pageCount
5. field completeness (count of {doi,title,author,year,journal/booktitle,pages})
6. oldest `added_at` (stability)

Survivor = rank-max. **If ≥2 members are load-bearing → mark cluster
`survivor_conflict` and DO NOT auto-merge** (needs reference-rewrite or alias
decision; route to review). Emit ranked members so the plan is auditable.

### Field union — union_fields(survivor, losers[])

Fill missing fields on the survivor from losers; on conflict keep survivor,
except: prefer a present DOI over absent, a longer title, a longer author list
(reuse `merge_paper_references.merge_fields` heuristic). Record which fields were
back-filled and from where (provenance in the plan).

## Deliverables

- `library/scripts/work_identity.py` — the module (this spec).
- `library/scripts/dedup.py` — CLI: `scan` → plan JSON + report; `apply` →
  execute under locks + backup + alias map + reversible folder archive; `verify`
  → invariants; `check` → fast "any new dups?" for the drain loop.
- Hardening wiring (separate task): `_tools.find_work_in_library`, guard at
  `upsert_catalog_entry`, `triage_apply` edges, `index_paper` post-auth,
  `update_master_bib_entry` shim, upgrade `merge_paper_references.find_duplicate`
  to delegate; fix `upsert_catalog_entry` shallow-clobber; robustify `_bib_parse`.
- `.virgil/aliases.json` (new artifact): `{loser_citekey: {survivor, work_key,
  at, reason}}`. Consulted by the intake guard so a collapsed key resolves
  forever.

## Non-negotiable safety

- Never delete a `papers/<ck>/` folder — archive to `.virgil/_dedup-archive/<ck>/`.
- Never drop a deep-index member: winner-selection keeps highest depth.
- Hold `lock_master_bib` / `lock_catalog` across the ENTIRE read→compute→write.
- Pre-apply backup of master.bib + catalog to an off-Dropbox path; abort if the
  live file's sha changed since scan (optimistic concurrency); refuse if a drain
  lock is held.
- `distinct` and `uncertain` clusters are never auto-applied.
