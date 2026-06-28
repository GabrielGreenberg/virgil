# Library feature wishlist

Capture doc for the batch of Library features Gabriel wants to add — big and
little. **This is a requirements-gathering document, not a plan.** We fill it in
one feature at a time; for each, I (Claude) ask enough questions to be confident
I understand the ask, then write a self-contained entry below. Once the list is
built up, we convert it into a comprehensive implementation plan (sequencing,
sizing, shared infrastructure, risks).

Subsystem context lives in [library/AGENTS.md](library/AGENTS.md) (catalog,
multi-tab libraries, skill cowork, Python pipeline) and the recent Library work
is logged across `MEMO_LIBRARY_*.md` + `docs/memos/library-*`.

Started: 2026-06-24. **16 features captured (F#1–F#16).** Grouping & approach →
[MEMO_LIBRARY_FEATURES_LITE_PLAN.md](MEMO_LIBRARY_FEATURES_LITE_PLAN.md); autonomous-overnight
launch prompt → [MEMO_LIBRARY_OVERNIGHT_HANDOFF.md](MEMO_LIBRARY_OVERNIGHT_HANDOFF.md).

---

## How to read an entry

Each feature is self-contained so the eventual implementer doesn't have to
re-derive scope. Template:

```
### F#N — <short title>            [size: big | little]  ·  status: gathering | understood | planned
**Ask (Gabriel's words / paraphrase):** what he asked for.
**Understanding:** my restatement of the goal + the why behind it.
**Scope & touch-points:** which part of the Library this lives in (catalog,
  reader, browse/dashboard, search, Python pipeline, skills, …) + any files.
**Open questions:** anything still ambiguous (resolved questions move into
  Understanding).
**Notes:** edge cases, dependencies on other F#, prior-art in the codebase.
```

Status legend:
- `gathering` — still asking clarifying questions.
- `understood` — I'm confident I know what's wanted; ready to plan.
- `planned` — folded into the implementation plan.

Size is a rough first cut (`big` = new subsystem / cross-cutting / pipeline
work; `little` = contained UI or behavior tweak). Refined at planning time.

---

## Index

- **F#1** — [Dashboard headline-stats redesign](#f1--dashboard-headline-stats-redesign) · `little` · **✅ LANDED (Phase 1)**
- **F#2** — [Retire "verified", unify on "authenticated"](#f2--retire-verified-unify-on-authenticated) · `little` · **✅ LANDED (Phase 1)**
- **F#3** — [Pre-digital ("canonical") authentication pipeline](#f3--pre-digital-canonical-authentication-pipeline) · `big` · **✅ LANDED (Phase 1)** — engine+skill+tests; not mass-run on the real lib (re-runnable skill)
- **F#4** — [Catalog membership policy: all-bib vs sources-only](#f4--catalog-membership-policy-all-bib-vs-sources-only) · `big` · **◑ PARTIAL (Phase 1)** — reader-side layered model + bib-index `bs` projection LANDED; **writer-stop + row-prune DEFERRED** (supervised; see digest)
- **F#5** — [Per-row three-dot menus in the libraries list](#f5--per-row-three-dot-menus-in-the-libraries-list) · `little` · **✅ LANDED (Phase 0)**
- **F#6** — [Toast attention tabs: close button + reliable auto-dismiss](#f6--toast-attention-tabs-close-button--reliable-auto-dismiss) · `little` · **✅ LANDED (Phase 0)**
- **F#7** — [Three-dot menu on "My Papers" pod rows (Remove)](#f7--three-dot-menu-on-my-papers-pod-rows-remove) · `little` · **✅ LANDED (Phase 0)**
- **F#8** — [Library tab outline doesn't fully wrap the shape (clipped stroke)](#f8--library-tab-outline-doesnt-fully-wrap-the-shape-clipped-stroke) · `little` · **✅ LANDED (Phase DM-4)** (landed 2026-06-28, merge f329c5b0) — folder-tabs deep move complete
- **F#9** — [\"Open in Virgil tab\" button for library papers (list column + paper header)](#f9--open-in-virgil-tab-button-for-library-papers-list-column--paper-header) · `little` · **✅ LANDED (Phase 2 + 4b)** — list column + header button both in
- **F#10** — [Lighten the library PDF viewer's heavy native toolbar](#f10--lighten-the-library-pdf-viewers-heavy-native-toolbar) · `medium` · **✅ LANDED (Phase DM-6)** (landed 2026-06-28, merge b65e6ef4) — vendored pdf.js prebuilt viewer (Option B), DM-6 complete
- **F#11** — [Paper-header design overhaul (cohesive pod, unified bib chrome, page picker)](#f11--paper-header-design-overhaul-cohesive-pod-unified-bib-chrome-page-picker) · `medium` · **◑ PARTIAL (Phase 4b)** — `<BibEntryChrome>` + cohesive responsive pod + drag-to-library + text page-picker + header open LANDED. DEFERRED (assessed risky-defer): editor Bibliography-panel `<BibEntryChrome>` adoption — single-source mostly already banked (BibliographyPanel shares LibraryStatusRow + LibraryMembershipChips; only a ~15-line headline duplicates); full adoption needs an embedded/noDrag mode to avoid drag-on-drag + visual-drift on the data-loss-grade BibEntryCard. PDF page-picker → needs F#10.
- **F#12** — [Replace the incongruous brown on toggle selected-fills (warm-taupe complement)](#f12--replace-the-incongruous-brown-on-toggle-selected-fills-with-a-warm-taupe-complement) · `little` · **✅ LANDED (Phase 0)** · `#8a7355` (+ `--control-selected-ink #6b5840` for AA on the tint path)
- **F#13** — [Drag column headers to reorder the library paper list (global pref, promoted to defaults)](#f13--drag-column-headers-to-reorder-the-library-paper-list-global-pref-promoted-to-defaults) · `medium` · **✅ LANDED (Phase 2b)** — order-SSOT + global pref + promote-defaults + HTML5 drag; OWED live drag feel-check
- **F#14** — [Sort by index-status facet (movable sub-bar) + fold bib-imported into Status](#f14--sort-by-index-status-facet-movable-sub-bar-under-status--fold-bib-imported-into-status) · `medium` · **✅ LANDED (Phase 2 + completions-A)** — bib-imp fold + facet sub-bar sort (FACETS SSOT); OWED live feel-check
- **F#15** — [Inner library tabs: compress Chrome-style (always attached, ellipsized inactive names)](#f15--inner-library-tabs-compress-chrome-style-always-attached-ellipsized-inactive-names) · `medium` · **✅ LANDED (Phase DM-4)** (landed 2026-06-28, merge f329c5b0) — folder-tabs deep move complete, landed WITH F#8 · _couples to F#8_
- **F#16** — [Library papers inherit the editor's top-bar chrome (breadcrumb + back/forward + three-dot)](#f16--library-papers-inherit-the-editors-top-bar-chrome-breadcrumb--backforward--three-dot) · `medium` · **✅ LANDED (Phase 4 + completions-A)** — View menu + functional back/forward + the section breadcrumb (keystroke-safe scroll-driven); OWED live feel-check

---

## Features

### F#1 — Dashboard headline-stats redesign            [size: little]  ·  status: understood

**Ask (Gabriel's words):** Rework the Central Library dashboard's stat blocks into two lines.
- **Top line (4):** (1) total bibliography entries; (2) total sources — *meaning the
  total number of PDFs/docs, actual source files in the library*; (3) total indexed
  sources; (4) total deep-indexed sources.
- **Middle line (3):** (1) entries with authenticated bibliographies; (2) entries with
  non-authenticated bibliographies; (3) total unsorted.
- No third line.

**Understanding:** Today's dashboard has three sections (Library size / Bibliography
health / Pipeline) = 10 cards. Collapse to two rows. Two of the numbers change *meaning*,
so this isn't purely cosmetic:

- **"Sources" stops counting bib-only reference rows.** Today `totalSources =
  entries.length` (27,040), dominated by citation-only `master.bib` rows that have no
  file on disk. Redefine it to the count of catalogued papers that have a real source
  file — the honest "documents I actually have" number. **Decided: sorted-only** —
  entries with a citekey AND `pdf.present === true`. The 9 untriaged `unsorted/` files
  are excluded here (they keep their own card on the middle line).
- **Bibliography health collapses to a strict binary.** Drop the separate "Verified"
  (no-action terminal set) card. **Decided: strict** — authenticated = `bib.state ===
  "authenticated"` only; non-authenticated = the rest of the bibliography (folds
  unverified / failed / manuscript / canonical / none together). The two visibly
  partition the top-line Bibliography total.
- **Pipeline section removed entirely.** **Decided:** the in-progress and failed cards
  go away; no conditional resurfacing on this screen.

**Final card map:**

| line | card | source | vs today |
|---|---|---|---|
| top | Bibliography | `bibEntries` (master.bib size) | unchanged (27,023) |
| top | Sources | **NEW:** count of `citekey != null && pdf.present` | was `entries.length` (27,040) → real files only |
| top | Indexed | `indexed` (indexed + deepIndexed); sub "of N sources" repoints to new Sources | 1,300 |
| top | Deep-indexed | `deepIndexed`; sub "of N indexed" | 809 |
| mid | Authenticated | `authenticated` (strict) | was its own card (3,374) |
| mid | Non-authenticated | **NEW:** `bibEntries − authenticated` | ~23,649 |
| mid | Unsorted | `unsorted` (citekey == null) | moved up from the Pipeline section (9) |

Removed: "Verified" card, "In progress" card, "Failed" card, the whole Pipeline section.

**Scope & touch-points:** Pure presentation + one new derived stat. No catalog schema
change — every input already exists.
- [library/lib/catalog-stats.ts](library/lib/catalog-stats.ts) — add a `sourcesWithFile`
  count (`citekey && pdf.present`) and a `nonAuthenticated` convenience (`bibEntries −
  authenticated`); keep the existing fields (other call-sites may use them).
- [library/components/LibraryCentralDashboard.tsx](library/components/LibraryCentralDashboard.tsx)
  `StatsGrid` — rebuild to two rows, remove the Pipeline section + Verified card, repoint
  the "of N" denominators.
- `catalog-stats` unit test — cover the two new derivations.

**Open questions / design details (non-blocking, resolve at build):**
- **Section sub-headers** — you said "top line / middle line." Keep the current
  "LIBRARY SIZE" / "BIBLIOGRAPHY HEALTH" labels, relabel (e.g. "Library" /
  "Bibliography"), or drop to two bare rows? *(Lean: keep light labels.)*
- **Grid wrap** — the top line is 4 cards; render as a true 4-up row, or keep the
  current responsive 3-up wrap? *(Lean: 4-up on wide, wrap on narrow.)*
- **Reconciliation** — `bib.state` lives on catalog rows; `bibEntries` is the master.bib
  key count. Defining non-authenticated = `bibEntries − authenticated` keeps the two
  middle numbers summing to the displayed Bibliography total even though the universes
  differ by ~17 rows. Flagging in case you'd rather count both over catalog rows.
- **Subtitle string** — the header summary (`summarize()`, "27,023 references · 1,300
  indexed papers · 9 unsorted") — leave as-is or align its wording with the new
  Sources definition?

**Notes:** Same "stop conflating bibliography rows with real documents" instinct behind
the library-scale work (`MEMO_LIBRARY_SCALE.md`). The "source (file on disk) vs reference
(master.bib row)" distinction pinned here will likely recur → see cross-cutting.

---

### F#2 — Retire "verified", unify on "authenticated"            [size: little]  ·  status: understood

**Ask (Gabriel's words):** The library skills and scripts distinguish "verified" from
"authenticated" but these mean the same thing. Change EVERYTHING to "authenticated" and
retire "verified".

**Understanding (after audit):** "verified" is **not** a real status — the `BibAuthState`
union is `none | unverified | authenticated | manuscript | canonical | failed` (no
"verified"). The word survives only as *UI vocabulary* and one derived stat, and in the
narrow per-entry chip it is already an exact synonym for `authenticated` (the "✓ Verified"
chip fires only when `state === "authenticated"`). So this is a clean cosmetic
rename — **not** a state-model change. Two things the audit flagged that the rename must
respect, both now neutralized or decided:
- The dashboard's "Verified" StatCard secretly meant the *broader* no-action set
  (`authenticated ∪ manuscript ∪ canonical`, the `verifiedTerminal` stat). Renaming *that*
  to "Authenticated" would have been wrong — but **F#1 already deletes that card**, so the
  trap is gone. The now-orphaned `verifiedTerminal` stat can be deleted (or, if any
  consumer remains, renamed to a non-"verified" word like `terminalNoAction`).
- `unverified` (a real "needs action" low-confidence state) and `doiVerified` (a per-entry
  boolean: was the DOI cross-checked) are **distinct concepts, left untouched**.

**Decided:** rename the positive **"✓ Verified" → "✓ Authenticated"** (chips, pills,
tooltips). **Keep "Unverified" / "Failed"** as their own per-entry labels (we did *not*
go fully binary at the per-entry level). Internal state value `unverified` and field
`doiVerified` unchanged.

**Scope & touch-points (from audit — edit `library/` sources, NOT the build mirrors
`public/skill-bundle/**` or `.claude/commands/library/**`):**
- [src/components/library/library-entry-status.tsx](src/components/library/library-entry-status.tsx) — `verifiedChip()` fn, "✓ Verified" text (:42), aria/data-hint (:39–40), doc-comment (:9).
- [src/components/library/BibEntryPickerMenu.tsx](src/components/library/BibEntryPickerMenu.tsx) — `verified` var (:551), `showVerifiedPill`/`VerifiedPill` (:640–681), tooltips. (All narrow `=== authenticated`.)
- [src/components/library/provenance-chips.tsx](src/components/library/provenance-chips.tsx) — "verified against authoritative sources" tooltip prose (:100, :115). Chip text is already "auth".
- [library/lib/catalog-stats.ts](library/lib/catalog-stats.ts) — delete/rename `verifiedTerminal` (orphaned once F#1 lands); keep the broad-set semantics if any consumer survives. Update `catalog-stats.test.ts:73` accordingly.
- Docs/prose: [src/STYLE_GUIDE.md:117](src/STYLE_GUIDE.md), [docs/agents/glossary.md:149](docs/agents/glossary.md), `library/AGENTS.md:258`, plus the `open-library-entry.test.tsx` chip assertions.

**Open questions:** none blocking. (Sequencing: do F#2 *after* or *with* F#1 so the
`verifiedTerminal`/"Verified"-card removal happens once.)

**Notes:** Depends on F#1 (shares the dashboard "Verified" card removal). Interacts with
F#3 — if "canonical" stops being an auth verdict (F#3 decision), the old `verifiedTerminal`
broad set shrinks further.

---

### F#3 — Pre-digital ("canonical") authentication pipeline            [size: big]  ·  status: understood

**Ask (Gabriel's words):** The skills treat "authenticated" and "canonical" as if canonical
sources *can't* be authenticated. That's wrong — they CAN be, just not by the same means.
Build a skill system for authenticating publications from before the digital era. The
pipeline may be more score/confidence-based; expect it to look at publisher information,
the PDF source if possible, and triangulate using other published sources that *refer* to
the work.

**Understanding (after audit):** Today `canonical` is a pure **give-up fallback**, not a
positive authentication: `bib_auth.py` `authenticate()` (≈ lines 1818–1850) sets
`state="canonical"`, `score=0.0`, **no field changes**, and *only* when the entire external
chain already returned `failed` (no match at all) AND the entry is a book/incollection/inbook
with `0 < year < 1980` and no DOI/ISBN. There is **no** citation-triangulation or
publisher-corroboration code anywhere. The user wants to replace this give-up with a real,
confidence-scored authenticator for pre-digital works.

**Decided design:**
- **Outcome = plain `authenticated`.** Pre-digital is a *route* to authentication, not a
  separate verdict. On success the entry becomes the same `authenticated` state as a modern
  DOI-verified work, carrying a **provenance note** (e.g. corroborated-by-pre-digital-means)
  and a `score`. On failure it falls back to `unverified` / `failed` like everything else.
  **"canonical" stops being an auth state** — it survives at most as an optional descriptor
  ("pre-digital classic"), not a status. (This also simplifies F#2's `verifiedTerminal`.)
- **Evidence = metadata + citing-work triangulation; no fetch/OCR.** Score agreement
  between the bib's `publisher`/`address`/`editor`/`pages` and book-catalog records
  (Internet Archive metadata / WorldCat / OpenLibrary), corroborated by works that *cite*
  it via reverse-citation (OpenAlex `cites_works`/`cited_by`, Crossref `is-referenced-by`,
  Semantic Scholar citations). Use an on-disk source PDF *only if one happens to exist*
  (canonical entries are usually cited-only references with no PDF) — do **not** go fetch or
  OCR a digitized copy in v1.

**Data feasibility (audit):** publisher info is abundant (all 13 sample canonical entries
carry publisher + address); source PDFs are usually **absent** for these (cited-only refs);
reverse-citation lookups are feasible via the listed APIs but are **entirely net-new** (no
such code today). `score`/`note` already flow to `catalog.json` — they're just not declared
on the TS `BibStatus` type yet.

**Scope & touch-points (audit integration points):**
- [library/scripts/bib_auth.py](library/scripts/bib_auth.py) — insert `_authenticate_predigital(...)` inside the `if result.state == "failed":` block, *before* the canonical give-up; it returns a real scored `AuthResult` (state `authenticated`, a corroboration score, optional publisher/edition field changes). Keep a bare floor when even it finds nothing.
- New source helpers alongside `crossref_search`/`openalex_search`/… — a **reverse-citation / cited-by** query (none exists) + a publisher/book-catalog corroboration check (reuse `_openlibrary_title_search`, `_google_books_search`; add Internet Archive `archive.org/metadata/<id>`).
- [library/skills/authenticate-bib.md](library/skills/authenticate-bib.md) — its step-6 rule currently hard-codes "canonical is terminal — never upgrade"; rework so pre-digital corroboration writes `authenticated` with a score. Add reply-format messaging.
- [library/lib/catalog.ts](library/lib/catalog.ts) `BibStatus` — declare `score?: number` + `note?: string` (already written to disk) and any corroboration-evidence field; decide the descriptor representation for "pre-digital".
- [library/components/StatusPill.tsx](library/components/StatusPill.tsx) — canonical pill ("≈ bib", "no external registry expected") loses its auth-state role; pre-digital-authenticated entries read as normal authenticated (optionally with a provenance tooltip).
- Reconcile the **`<1980` (code) vs `<1950` (docs)** drift; revisit `merge-bibs.md`'s transient-skip rules now that pre-digital works can be positively authenticated.

**Open questions / design details (resolve at design time):**
- **Confidence model & threshold** — how to weight heterogeneous evidence (publisher
  agreement is weak alone; a reverse-citation reproducing title+author+year+publisher is
  strong). Need a bar analogous to the existing ≥0.92 / two-source / ≥0.85-book rules.
- **Triangulation trust** — citing works' bibs can be wrong (errors propagate). How many
  independent citing works must agree; weight authoritative catalogs (LoC/WorldCat) over
  scraped reference lists.
- **Order of operations** — run only after the modern chain exhausts (preserves today's
  behavior) vs earlier for clearly pre-digital books (saves API calls but a coincidental
  weak modern match → `unverified` would skip it).
- **Migration of the ~13 existing `canonical` rows** once it stops being a state.
- **API budget** — reverse-citation queries multiply calls/entry; needs rate-limit pacing.

**Notes:** Biggest item so far — a net-new authentication subsystem (new external sources +
scoring), not a tweak. Touches the same `bib_auth.py` engine and `authenticate-bib` skill
as F#2/F#4. The "pre-digital can be authenticated" decision retires `canonical`-as-state,
which feeds back into F#1 (dashboard) and F#2 (`verifiedTerminal`).

---

### F#4 — Catalog membership policy: all-bib vs sources-only            [size: big]  ·  status: understood · **DECIDED: sources-only (layered-hybrid)**

**Ask (Gabriel's words):** Double-check the policy on whether the library catalog should
include only entries with paper sources, or all entries from master.bib. If it's
sources-only, that needs to be ramified out to the many library skills so they enforce it.

**Current reality (confirmed by audit):** **all-bib** — the catalog holds one row per
master.bib entry; `pdf.present` distinguishes the few real holdings from the mass of
citation-only references (fixture: 232 of 234 rows are fileless). The catalog is modeled as
"the projection of master.bib with a presence flag," not "the set of held files." Riding on
those rows today: per-entry `bib.state` (authenticate-bib stamps it; `update_catalog_entry.py`
**raises KeyError if the row is missing**), the blue "imported" flag, the dashboard counts,
and catalog-driven fuzzy search. So flipping to sources-only is a genuine **cross-cutting
redefinition**, not a localized fix.

**Research result → RECOMMENDATION: flip to sources-only, in its disciplined *layered-hybrid*
form.** Three independent agents (architecture, performance, migration) converged on this.

**The model:** `catalog.json` = **holdings only** (one row per on-disk source; `pdf`/`indexed`
fields finally always meaningful). `master.bib` + `bib-index.json` = the **reference universe**
and per-entry `bib.state` (already half-stored in the `% bib.state =` master.bib comment —
project it into `bib-index.json`). Manifests own membership (already decoupled). Search + stats
run over `bib-index.json`.

**Why it wins:**
- **Performance/scale (decisive).** The all-bib catalog grows ~1:1 with master.bib, so
  `catalog.json` is a second full-bibliography file `JSON.parse`d **whole on the main thread on
  every 6 s poll bump** — measured ~1.6 KB/row ⇒ ~43 MB / 200–650 ms today, **~160 MB / 0.8–2.4 s
  at 100k**. Sources-only **decouples catalog size from bib size**: ~2–7 MB now, ~13 MB worst-case
  at 100k, and reference-only growth (27k→100k) stops touching the catalog hot path. Same slim-
  projection pattern the `bib-index.json` work already proved (~140× win, `MEMO_LIBRARY_SCALE`).
- **Architecture.** Each datum gets exactly one owner matched to its ontology (holdings↔catalog,
  reference fields↔master.bib, reference status↔master.bib comment→bib-index, membership↔manifest).
  Today's catalog mixes "a file I hold" with "a reference I might cite," leaving `pdf`/`indexed`
  vestigial on ~99% of rows and `bib.state` stored twice.
- **Cheaper than it looks.** The frontend **already** fabricates a fileless bib-only row for every
  master.bib key lacking a catalog row (`LibraryView.mergedEntries` :412–478), so the read path is
  largely done. **Effort = medium; reversibility = high** (master.bib/bib-index untouched; catalog
  is skill-rebuildable; gate the old behavior behind a one-line flag for the first release).

**Migration (dependency order — do NOT flip the writer first):** (1) project `% bib.state` into
`bib-index.json` (new slim field + schema bump) — the safety net, lands first; (2) widen the
frontend reader so synthetic rows show the real state (replace the hardcoded `unverified` at
`mergedEntries:446`); (3) move search + stats onto `bib-index.json` so coverage doesn't silently
collapse to ~holdings; (4) stop the Python writers (`merge_paper_references._upsert_catalog_row`,
the triage bib-only path) minting reference rows, and gate `authenticate-bib` /
`update_catalog_entry.py` so they stop *requiring* a row (write the master.bib comment instead);
(5) relax the merge **shrinkage-guard** (`merge_bibs_postflight._check_catalog` — catalog is now
expected-flat); (6) one-time prune of `present:false` rows — **back-filling the master.bib comment
from any row whose state predates the comment BEFORE deleting it** (the one real data-loss risk).
The `imported` flag needs no re-home — it already lives on the holdings paper's surviving row.

**✅ DECIDED (Gabriel, 2026-06-25): adopt sources-only (layered-hybrid).** A deliberate
cross-cutting redefinition (medium effort, high reversibility) — bigger than F#1, but the research
says it's the right endpoint and the scale ceiling on all-bib is real. The "ramify to the many
library skills" Gabriel originally flagged **is** the writer/reader repoints in the migration steps
1–6 above. Full detail in the `catalog-membership-research` workflow output (architecture / perf /
migration). **Sequencing reminder:** F#4 dictates where bib.state lives, so it must be planned
*with* the bib-auth cluster (F#1–F#3) — see cross-cutting.

**Scope & touch-points (preliminary, from the first audit — what sources-only would touch):**
`merge_paper_references.py` `_upsert_catalog_row` (the primary 1:1 driver), `triage_apply.py`
bib-only path, `_sync_catalog_entry_from_master`, `authenticate-bib` (KeyError-on-missing-row;
bib.state would re-home to the master.bib `% bib.state` comment), the dashboard counts
(`catalog-stats.ts`), search (`catalog-search.ts` → would need `bib-index.json`), the
"imported" flag's home, the merge **shrinkage-guard**, and a one-time prune of ~27k rows.

**Open questions:** the whole decision — pending the research recommendation. Note this is
the membership counterpart to F#1's *display* honesty: F#1 already makes "Sources" mean
real files **without** changing membership, so sources-only is not required for F#1.

**Notes:** Deeply entangled with F#1 (Sources count), F#2/F#3 (bib.state home), and the
library-scale work. The cross-cutting "source vs reference" theme is the spine of this one.

---

### F#5 — Per-row three-dot menus in the libraries list            [size: little]  ·  status: understood

**Ask (Gabriel's words):** In the Library tab, the left-most libraries column and the papers
column beneath it — every entry should get its own three-dot options on the right side. At
minimum, the menu lets the user delete the library (not its entries) — except Central. For
custom libraries, put the "Add from .bib" option here instead of listing it in the main list.

**Understanding (after mapping the UI):** The "libraries column" is `LibrariesNavigator` — a
vertical list of `NavRow`s in three sections: **Central** (1 row), **Project libraries** (one
per open Virgil doc), **My Libraries** (custom). **Correction (later turn):** Gabriel's "papers
column" is **not** the `LeftList` main paper list — it's the separate **"My Papers" pod**
([src/components/library/MyPapersPod.tsx](src/components/library/MyPapersPod.tsx)), a curated list
of his own Virgil docs stacked *below* the Libraries pod in the left rail (with a resizer between).
That work is split into **[F#7](#f7--three-dot-menu-on-my-papers-pod-rows-remove)**; F#5 covers the
**Libraries pod** (the "library column"). Two facts shaped F#5:
- **The `LeftList` main paper rows already have a three-dot** (`RowActionMenu`: AI bib review /
  AI text review / Import bibliography / context-aware Delete-or-Remove) — those stay as-is; they
  were never the target. The real new work is the **Libraries pod**, whose rows have no menu today.
- **Delete-library plumbing already exists** (`useDiskLibraries.remove(id)` — deletes only the
  `.virgil/libraries/<slug>.json` manifest, Central guarded via `isBuiltin`) but has **no UI**.
  A manifest is just a `citekeys[]` membership list, so "delete the library, not the entries" is
  the natural (and only) semantics — papers + master.bib are untouched.
- **"Add from .bib" today is a standalone row** (`AddFromBibRow`) that **creates a NEW library**
  from a picked `.bib` (pick → parse → write to `unsorted/` → `createFromBib`). Moving it into a
  per-library menu means a semantic shift to "add INTO this library."

**Decided:**
- **Which rows get a three-dot: Central + custom only.** Project Libraries (live open docs) get
  none.
  - **Central** → no delete; offers **Re-sync skills** + **Change folder** (the actions that live
    on its tab today — `TabbedLibraryPanel`). Surface them in the row menu, sharing the handlers.
  - **Custom library** → **Rename** (triggers the existing inline `RowTitleInput` edit — today
    only reachable via double-click) + **Delete library** (wires `remove(id)`; destructive-confirm)
    + **Add from .bib**.
- **"Add from .bib" becomes per-custom-library = import a .bib's entries INTO that library** (new
  behavior). **Remove the standalone `AddFromBibRow`.** Keep "create a *new* library from a .bib"
  on the **"My Libraries" header "+" menu** so spinning one up from scratch still exists.
- **`LeftList` main paper rows: leave as-is** (they already have their context-aware three-dot;
  never the target). The **"My Papers" pod** three-dot + Remove is **F#7**.

**Scope & touch-points (from the UI map):**
- [library/components/LibrariesNavigator.tsx](library/components/LibrariesNavigator.tsx) —
  add a three-dot button + portaled menu to `NavRow` (right edge); menu contents branch on
  Central vs custom. **Rename** wires to the existing `startEditing(lib.id, lib.label)` (:73–83)
  → inline `RowTitleInput` (:266–272). Remove `AddFromBibRow` (:381–423); fold "new library from
  .bib" into the "My Libraries" `SectionHeader` "+" (:335–372) — likely becoming a tiny "New empty
  library / New library from .bib" menu.
- [library/components/RowActionMenu.tsx](library/components/RowActionMenu.tsx) **or** the
  `PanelMenuPopup`/`useFloatingMenuPosition` pattern in `panel-tabs/PanelTabStrip.tsx` — reuse one
  portaled-menu primitive for the NavRow three-dot rather than reinventing (paper rows use
  `RowActionMenu`; matching it keeps the trigger/positioning/escape/outside-click behavior
  consistent).
- [library/hooks/useDiskLibraries.ts](library/hooks/useDiskLibraries.ts) `remove(id)` (:497–515)
  — already there; just needs the menu item + a confirm. `useLibraryTabs` currently exposes no
  public delete, so thread `remove` through (or expose it).
- **New "add .bib into existing library" handler** — adapt `LibraryView.handleCreateLibraryFromBib`
  (:574–645): pick → parse → write new entries to `unsorted/` → instead of `createFromBib`, **add
  the parsed citekeys to the target library's manifest** (membership). Most of the flow is reused.

**Open questions / design details (non-blocking):**
- Confirm what the "My Libraries" header **"+"** does today (create empty library?) and shape it
  into the 2-item create menu (empty / from .bib).
- **Delete confirmation** UX — inline confirm vs modal. (Lean: a lightweight confirm; deletion is
  permanent for that collection even though entries survive.)
- **Add-into-library + master.bib** — entries in the picked `.bib` may not yet be in master.bib;
  mirror the create flow (route through `unsorted/` so they get added) before adding membership,
  so the manifest's citekeys resolve.
- Three-dot **visibility** — always-visible (like paper rows) vs hover-reveal. (Lean: match paper
  rows = always visible, for consistency.)

**Notes:** Mostly UI wiring over existing plumbing (delete exists; menu primitive exists; create-
from-.bib exists) + one new "add into library" handler — hence `little`. Independent of the
bib-auth cluster (F#1–F#4); can ship on its own. Reuses the portaled-menu pattern from the
library-uiux-tuneup work.

---

### F#6 — Toast attention tabs: close button + reliable auto-dismiss            [size: little]  ·  status: understood

**Ask (Gabriel's words):** The little attention tabs (like the "setup-needed" one) are fine, but
(a) they should have an ✕ to close in the top-right corner, and (b) they should disappear
automatically after a while even if the issue persists — it can surface again on reload, like
this one.

**Understanding (after audit):** These are the Library **`Toaster`** toasts. There is exactly one
renderer — `LibraryView` mounts `<Toaster items={allToasts} />` where `allToasts =
[...syncToasts, ...setupStatus.notice, ...notifications]`. The "setup-needed" card is **not** a
separate persistent banner: `useSetupStatus` polls `.virgil/models/manifest.json` and emits a
*synthetic* `NotificationItem` (`kind: "setup-needed"`, stable per-episode `at`) that's
concatenated into the same toast stream. So:
- **(b) is mostly already implemented.** The Toaster auto-dismisses at `VISIBLE_MS = 6000` and
  re-surfaces on reload (the setup check's `firstSeenAtRef` resets each load; the dedupe `seenRef`
  is in-memory only). **But there's a real bug** that explains the "they persist" feeling: all
  dismiss timers live in one `useEffect` whose cleanup `timeouts.forEach(clearTimeout)` fires on
  **every `items` change** and only re-arms timers for *new* toasts. So when a second toast arrives
  while the first is still visible, the first's timer is cancelled and **never re-armed → it sticks
  forever.** (Inbox/sync activity, or the 30 s setup poll re-emitting a fresh array, trips this.)
- **(a) is genuinely missing** — no close control today.

**Decided:**
- **Close ✕** in the top-right of every toast; clicking removes that toast.
- **Reliable auto-dismiss** — fix the shared-timer bug by giving **each toast its own lifecycle**
  (own TTL timer), so a sibling's arrival/`items` change can never cancel it.
- **Per-severity duration** — info/"done" toasts short (~5 s); attention/warning toasts
  (e.g. `setup-needed`) longer (~10–12 s) so they're readable/actionable before vanishing.
- **Pause-on-hover** — hovering a toast freezes its countdown; leaving resumes it (track remaining
  time).
- **Dismissal stays session-scoped** (both ✕ and auto): no persisted suppression — the toast
  re-surfaces on reload if the condition still holds. This already falls out of the in-memory
  `seenRef` + the setup check's reload reset; **do not** add any localStorage "don't show again".

**Scope & touch-points:**
- [library/components/Toaster.tsx](library/components/Toaster.tsx) — the rewrite. Extract a
  per-toast `Toast` subcomponent that owns its `setTimeout(TTL)`, pause/resume on
  `mouseenter`/`mouseleave`, and renders a header row (kind label left, ✕ right). Parent keeps the
  `seenRef` dedupe + `visible` list + a `removeToast(uid)` used by both the timer and the ✕.
  **Kill the single-effect-clears-all-timers pattern** (the bug). Add the ✕ button + a flex header
  so the kind label and ✕ share the top row.
- [library/lib/queue.ts](library/lib/queue.ts) — `NotificationItem` + its `kind` set. Add a
  `kind → severity` (and severity → TTL) map to drive per-severity duration. Classify
  `setup-needed` as attention/long.

**Open questions / design details (non-blocking, resolve at build):**
- Enumerate the `queue.ts` notification kinds and assign each a severity; pin the two TTL values
  (proposed ~5 s info / ~10–12 s attention).
- Optional: a subtle fade/slide on dismiss (match existing surface styling; today there's no
  animation).
- Stacked toasts each pause independently on hover (per-toast, yes).

**Notes:** `little` — the substantive part is the timer-bug fix; ✕ + hover-pause are standard
toast UX. Scoped to the **Library** `Toaster`; grep found **no** shared/main-app toaster
(`src/components`), so the main app is out of scope unless it grows an analogous one. Independent
of F#1–F#5.

---

### F#7 — Three-dot menu on "My Papers" pod rows (Remove)            [size: little]  ·  status: understood

**Ask (Gabriel's words):** Add three-dot menus to the docs listed under the "My Papers" heading in
the left-hand column; the menu should list "Remove" as well.

**Understanding:** This was Gabriel's original "papers column" from F#5 (clarified this turn). The
**"My Papers" pod** ([MyPapersPod.tsx](src/components/library/MyPapersPod.tsx), `<NavPod title="My
papers">`) is the lower pod in the left rail — a **user-curated list of his own Virgil docs**
(`myPaperIds` from `useMyPapers`, persisted in IndexedDB). It is distinct from the Libraries pod's
**"Project libraries"** section (which mirrors *open* docs) and from the `LeftList` (papers within
a library). Each `PaperRow` currently shows a **hover-revealed ×** ("Remove from My Papers") that
calls `removeMyPaper(id)` — drops the doc from the curated list **without closing its tab or
deleting the doc**.

**Decided:**
- Each My Papers row gets a **right-aligned three-dot menu** (matching F#5 / the `RowActionMenu`
  pattern), in place of the lone hover-× .
- The menu lists **"Remove"** = the existing `onRemove` → `removeMyPaper(id)` (curated-list
  removal; does **not** close the tab or delete the doc). Short label "Remove" (the pod context
  makes the scope clear).

**Scope & touch-points:**
- [src/components/library/MyPapersPod.tsx](src/components/library/MyPapersPod.tsx) — in `PaperRow`
  (:277–379), replace the hover-× button (:337–376) with a three-dot trigger + portaled menu whose
  item is "Remove" → `onRemove`. Reuse the **same** portaled-menu primitive F#5 settles on (the
  `RowActionMenu` pattern) so trigger/positioning/escape/outside-click are identical across the
  rail. `removeMyPaper` plumbing already exists (`useMyPapers`) — no new data work.

**Open questions / design details (non-blocking):**
- Always-visible vs hover-revealed three-dot — **match F#5's choice** (the two left-rail pods
  should behave the same).
- Any items beyond "Remove" (e.g. "Open", "Reveal folder")? Row-click already opens; default to
  **Remove-only**, extensible later.

**Notes:** `little`; pure UI consolidation over existing `removeMyPaper` plumbing. Pairs with F#5
(shared menu primitive + the "every left-rail row gets a right-aligned three-dot" consistency
goal). The file lives under `src/components/library/` (not `library/components/`) because it reaches
into Virgil doc machinery (`@/lib/doc-index`, FSA permissions), so the reused menu primitive must
be importable from there.

---

### F#8 — Library tab outline doesn't fully wrap the shape (clipped stroke)            [size: little]  ·  status: understood

**Ask (Gabriel's words):** The outlines on tabs within the library don't consistently wrap around
the tab shape all the way — clarified: *the thin border doesn't go all the way around the shape.*

**Understanding (root-caused):** The library **inner tabs** (`PanelFolderTab`, the manila/folder
tabs in `PanelTabStrip` — Central / Project / custom libraries) are drawn as an **SVG folder
shape**; the "thin border" is the **1px stroke** of a path from `folder-path.ts` (inactive tabs
stroke the full closed `buildTabFillPath`; active tabs use `buildActiveTabStrokePath`, which
*intentionally* omits the bottom edge so the folder merges into its panel body — that omission is
**by design, not the bug**). The bug: the SVG viewport is sized **exactly** to the path width
(`svgW = 2*S + tabW`) and the path is drawn inside `<g transform="translate(0.5, 0.5)">` for crisp
1px rendering. The **height** got a 1px gutter (`svgH = TAB_H + 1`) so the bottom stroke fits — but
the **width got none**. So the path's outer "swoop feet" sit at `x = 0` and `x = svgW`; after the
`+0.5` translate the **right foot lands at `x = svgW + 0.5`**, outside the viewport, and the SVG's
default `overflow: hidden` **clips that part of the stroke**. Result: the thin border doesn't trace
the full silhouette (the outer bottom corners/feet get cut). (The left foot at `x → 0.5` sits right
on the viewport edge too, so its outer half-pixel is marginal.)

**Decided (fix direction):** Give the tab SVG a **horizontal stroke gutter** mirroring the vertical
one it already has — widen the viewport and offset the path so the full 1px stroke renders around
**both** swoop feet and the bottom corners, instead of bleeding past `overflow: hidden`. Verify
live at **1× and 2× DPR** (a half-pixel clip is DPR-sensitive).

**Scope & touch-points:**
- [library/components/panel-tabs/PanelFolderTab.tsx](library/components/panel-tabs/PanelFolderTab.tsx)
  — `svgW`/`svgH` sizing (:66–67), the two `translate(0.5,0.5)` groups (:112,:116), the bottom fill
  `rect` (:115), and the content offset `left: S` (:137). Widening the box means nudging the
  content offset so the label/×/pin stay put. Preserve the `R = 10` radius (there's an explicit
  "do NOT unify to 8" comment, :15–20).
- [library/components/panel-tabs/folder-path.ts](library/components/panel-tabs/folder-path.ts) —
  the path geometry. If the fix is to **inset the path** (rather than widen the viewport), it lands
  here; either approach is fine as long as the stroke fits.

**Open questions / design details (resolve at build):**
- Choose **widen-viewport** vs **inset-path** (both work; widen-viewport is the smaller diff and
  mirrors the existing `svgH = TAB_H + 1` precedent).
- Confirm the **active** tab's open-path endpoints (its swoop feet at `x = 0` / `x = svgW`) get the
  same gutter — the clip affects active and inactive alike.
- Live pixel-check at 1×/2× DPR; check adjacent-tab seams aren't affected by the width change.

**Notes:** `little` SVG-rendering fix, scoped to the inner library folder tabs. The active-tab
bottom-edge omission (folder→panel merge) is intentional and out of scope. Confirmed against the
code, but the exact pixel fix should be eyeballed live (the dev preview can drive the Library tab
per `library/CLAUDE.md` → "Verifying the Reader live").

---

### F#9 — "Open in Virgil tab" button for library papers (list column + paper header)            [size: little]  ·  status: understood

**Ask (Gabriel's words):** In the library viewer, add a **column** that gives the "open document"
button (like the bib cards in the main Virgil editor) — it opens the paper as a **new Virgil tab**
(not just within the library). Also add this button to the **header row for papers**, as another
route to opening a paper in a tab, instead of dragging it up.

**Understanding (after mapping):** The "open as a Virgil tab" plumbing **already fully exists** and
is shared by the reference button and the current drag-up gesture:
- The bib card's **`OpenEntryLink`** ([src/components/library/open-library-entry.tsx](src/components/library/open-library-entry.tsx))
  dispatches the `virgil-open-library` window event with `{ citekey, target: "tab" }`;
- the bridge ([src/components/editor-layout/event-bridges/library.ts](src/components/editor-layout/event-bridges/library.ts))
  routes `target:"tab"` → **`openPaperTab(citekey)`** ([src/hooks/useFiles.ts:746](src/hooks/useFiles.ts));
- which adds the paper to the outer (main Virgil bar) tab order and renders it as a **read-only
  `PaperOuterView`** (the same reader, but as a top-level tab, not inside the library split).
- The **drag-up gesture** (`PanelTabStrip` drag → `EditorLayout` drop) calls the *same*
  `openPaperTab`. So both new buttons are just UI that fires the existing event — **no new wiring,
  no new tab machinery.**

So this is purely two UI surfaces + read-only is the right (and only sensible) behavior — library
papers are indexed sources, and the bib-card reference opens read-only too.

**Decided:**
- **List column** — a new **fixed-width column at the right edge, just before the ⋮ three-dot**, an
  **icon-only open button** (reuse the external-link icon from `OpenEntryLink` for visual parity
  with the bib card). Fires `{ citekey, target: "tab" }`. Disabled on triage rows (no citekey),
  like `RowActionMenu`.
- **Paper header** — an open-in-tab button in **`PaperHeader`**, shown **only in the in-library
  reader** (the `RightDetail` context) and **hidden when `PaperHeader` is already inside an outer
  tab** (`PaperOuterView` → `PaperFileBody`), where it'd be redundant.
- Both open the **read-only** reader as a main tab. The drag-up gesture stays; this is an
  additional, easier route.

**Scope & touch-points:**
- **Reuse (no new plumbing):** dispatch the `virgil-open-library` `CustomEvent` with `{ citekey,
  target: "tab" }` — the library bridge already listens and calls `openPaperTab`. Firing the event
  **by name** keeps the `library/` → `src/` boundary clean (the library side already dispatches
  `virgil-library-close-paper-tab` this way); no need to import Virgil internals.
- **Column:** [library/lib/list-columns.ts](library/lib/list-columns.ts) — add a trailing
  fixed-width "open" column (mirror `ACTION_COL_WIDTH` / `BIB_IMP_WIDTH`; header-less, like the
  action column). [library/components/LeftListRow.tsx](library/components/LeftListRow.tsx) — render
  the icon button as a flex sibling immediately **before** the `RowActionMenu` action column
  (:340–357); gate `disabled` on missing citekey.
- **Header:** [library/components/PaperHeader.tsx](library/components/PaperHeader.tsx) — add the
  button to the right-column control stack (near the Text/PDF `ViewToggle` / status pills). Thread a
  context flag (e.g. `canOpenInTab` / `isOuterTab`) so it renders from `RightDetail`
  ([library/components/RightDetail.tsx:136](library/components/RightDetail.tsx)) but **not** from
  the outer-tab mount (`PaperOuterView` → `PaperFileBody`).

**Open questions / design details (non-blocking):**
- Column **header label** — none (it's an icon action column, like the ⋮ and bib-imp columns).
- **Icon vs icon+label** in the header (more room there) — lean icon + "Open" to match the bib card.
- The `OpenEntryLink` component itself lives in `src/components/library/`; decide whether the
  library-side buttons reuse it (if importable as a sanctioned bridge) or just re-fire the event by
  name (cleaner boundary). Lean: fire the event by name.

**Notes:** `little` — the tab-opening machinery already exists end-to-end; this adds two triggers
(a list column + a header button) and one context gate. Complements the drag-up gesture rather than
replacing it. The header button shares the `PaperHeader`-rendered-in-two-contexts subtlety with the
Reader-inheritance pattern (`library/CLAUDE.md` → Reader inheritance).

---

### F#10 — Lighten the library PDF viewer's heavy native toolbar            [size: medium]  ·  status: understood · **DECIDED: Option B** (pdf.js prebuilt viewer, restyled)

**Ask (Gabriel's words):** The built-in PDF header takes up a lot of vertical room and is visually
heavy. Without rebuilding my own PDF editor, can we make it more in-sync with the current styling?
(Clarified via screenshot: the **dark gray native Chrome PDF toolbar** — page N/68, zoom, fit,
rotate, annotate, undo/redo, download, print, kebab.)

**Understanding (studied):** The library PDF viewer is the **browser's native PDF plugin** in a
plain `<iframe>` fed an object URL from the FSA file ([library/components/PdfView.tsx:82–88](library/components/PdfView.tsx)).
The bar Gabriel circled is **Chrome's own toolbar, browser chrome *inside* the iframe** — **not
reachable by our CSS**, and there's **no `postMessage` API** into it. So it can be **hidden** (a URL
param) or **replaced** (pdf.js's own viewer), but **not restyled in place**. (Note: there is *also*
a separate, in-app `PaperHeader` rendered *above* the iframe that's independently tall/heavy and
*is* freely restyleable — see Notes.)

**✅ DECIDED (Gabriel, 2026-06-25): Option B** — vendor pdf.js's prebuilt viewer and restyle its
toolbar to Virgil tokens. It's the only path that actually restyles (rather than hides) the toolbar,
works cross-browser, keeps real zoom/page controls, and isn't a rebuild. A and C below are retained
as the analysis behind the choice / fallbacks, not the plan.

**Options considered:**

- **A — Hide the native toolbar + a thin Virgil bar** · `little`. Append
  `#toolbar=0&navpanes=0&view=FitH` to the object URL ([PdfView.tsx:84](library/components/PdfView.tsx))
  and add a ~30-LOC cream strip with only the controls we can *truthfully* drive: an app-side
  **Download** (we already hold the `File`), **Open in new tab** (escape hatch → the full native
  toolbar for print/rotate/annotate on demand), an optional pdfjs `numPages` "N PP" lozenge, and a
  muted "⌘-scroll / pinch to zoom" hint. **Honest limits:** Chromium-only — Safari ignores
  `#toolbar=0` (keeps its bar) and Firefox keeps the pdf.js bar, so on those you'd get *double
  chrome* (UA-gate the app bar or accept it); the param is **unguaranteed** (Chrome has rewritten
  this UI twice — "works today, live-verify after updates"); and with no postMessage we **can't
  proxy live zoom/page** → zoom becomes gesture-only (the hint mitigates). Verified: scroll +
  ⌘-scroll + pinch zoom **still work** with the toolbar hidden, so the PDF stays usable. This
  **hides**, it doesn't restyle — so it nails "less vertical room" but not "in-sync styled toolbar."

- **B — (Recommended) Vendor pdf.js's *prebuilt* viewer + restyle its toolbar to Virgil tokens** ·
  `medium` (~0.5 day). Point the iframe at pdf.js's shipped `viewer.html` (whose toolbar is
  same-origin DOM we *can* style). **Premise correction from the study:** the prebuilt viewer is
  **NOT in `node_modules`** (npm `pdfjs-dist@4.10.38` ships only `pdf_viewer.mjs`, no `viewer.html`)
  — you download the matching `pdfjs-4.10.38-dist.zip` from the mozilla/pdf.js GitHub release and
  commit `web/`+`build/` into `public/pdfjs/` (~1 MB). Load `/pdfjs/web/viewer.html` and open the
  FSA blob via `PDFViewerApplication.open({ url: objectURL, originalUrl: "<citekey>.pdf" })` on the
  iframe load event (more robust than `?file=<blob>`, per pdf.js #10435/#20137). Then a ~60-line
  `public/pdfjs/web/virgil-overrides.css` remaps pdf.js's own `--toolbar-*/--main-color` vars to
  `--topbar-bg/--topbar-border/--ink/--muted/--font-mono` and `display:none`s the annotate/print/
  editor groups → a quiet **40px manila strip with mono-uppercase micro-labels**, in the same
  register as the Library TopBar. **NOT a rebuild** (Mozilla's shipped app, Apache-2.0, already a
  dep). The only path that actually delivers **"in-sync styling" + cross-browser consistency** and
  keeps real on-screen zoom/page controls. **Costs:** ~1 MB vendored assets; re-vendor + re-apply
  the one-line `viewer.html` `<link>` edit on each pdfjs bump (script it in `build/`); heavier
  runtime than the native plugin (worker load; pdf.js virtualizes pages).

- **C — (later / if you want to own it) EmbedPDF** (`@embedpdf/react-pdf-viewer`, MIT, headless) ·
  ~1–2 days. Compose the toolbar in your own JSX with Virgil tokens (cleanest token fit), but adds
  a new dep **and a second PDF engine** (PDFium WASM) alongside `pdfjs-dist`. Reserve for if B's
  CSS-skinning proves too constraining.

- **Rejected:** `@react-pdf-viewer/core` — **commercial paid license** + unmaintained (pdfjs 3.x,
  React-19 unverified). `react-pdf` (wojtekmaj) — ships **no toolbar**, so you'd rebuild the chrome
  = exactly the "custom PDF editor" Gabriel ruled out.

**Why B / sequencing:** B is the faithful answer to "make it in-sync with the styling" — it restyles
rather than removes, works across browsers, and keeps zoom/page controls, all without a rebuild.
Optional: **A** could ship first as a one-line stopgap for immediate relief (Chromium-only,
gesture-zoom) since B cleanly supersedes it — but B is the committed target.

**Scope & touch-points:**
- **A:** [library/components/PdfView.tsx](library/components/PdfView.tsx) — append the fragment to
  the object URL (:84); add the `File`-backed download + open-in-tab strip above the iframe;
  optional one `pdfjs` `numPages` read (dep already present). No new deps; stays in the `library/`
  boundary.
- **B:** `public/pdfjs/` (vendored `web/`+`build/` from the GitHub dist zip), `PdfView.tsx` (iframe
  → `/pdfjs/web/viewer.html` + `PDFViewerApplication.open` on load), the vendored
  `public/pdfjs/web/viewer.html` (one-line `<link>` to the override CSS), and
  `public/pdfjs/web/virgil-overrides.css` (~60 lines). Add a `build/` step to re-vendor on a pdfjs
  bump. Serving from `public/` is explicitly sanctioned for `library/`.

**Open questions / details:**
- Which **browser(s)** does Gabriel use? (Decides whether A's Chromium-only limit + double-chrome on
  Safari/Firefox matters; the screenshot toolbar is current Chrome's.)
- **A-then-B** vs straight to **B**.
- Whether the "PDF view feels heavy" is *also* partly the in-app `PaperHeader` (separate, see Notes).

**Notes:** The study also surfaced that the in-app **`PaperHeader`** (the bordered citation pod +
a 3-row right stack of status pills / Text·PDF toggle / AI-requests, rendered *above* the iframe by
`RightDetail`) is independently tall/heavy and **fully restyleable with no rebuild** (inline styles,
zero CSS-file rules) — trim padding, collapse the right column to one control strip, de-pod the bib
to a one-line summary (matches the borderless warm-sheet panel reskin). Not what Gabriel circled,
but if the top of the PDF view still feels heavy after the toolbar fix, that's a separate `little`
win — **split into its own entry if wanted.** Full study: the `library-pdf-viewer-study` +
`native-pdf-toolbar-options` workflow outputs.

---

### F#11 — Paper-header design overhaul (cohesive pod, unified bib chrome, page picker)            [size: medium]  ·  status: understood

**Ask (Gabriel's words):** The paper headers (bib data, AI requests, text/PDF chooser) are a mess
and need a design overhaul (functionality is fine). Desiderata: (1) make the bibliography entry use
the same chrome organization as the editor's **bib cards**, and make it **draggable** (e.g. into
another library to add the entry) — **not** a pop-out; (2) the **PDF/Text chooser** gets pushed off
the right edge — redesign so it's header chrome that compresses to stay on-screen as long as
possible; (3) a **page-number picker** — "n / x pages," edit `n`, click go; (4) the **whole header**
should feel cohesive — one big pod, in the same position inside the tab.

**Understanding (studied):** The header is `PaperHeader` ([library/components/PaperHeader.tsx](library/components/PaperHeader.tsx)),
mounted by `RightDetail` above the PDF/text view. Today it's **three nested layers**: a bare cream
wrapper → a rigid 50/50 grid (`minmax(0,1fr) minmax(0,1fr)`) → a left **bib pod** (a
`formatBibliography(bib,'apa')` APA *string*) + a right bare column stacking status pills, the
Text/PDF `ViewToggle`, the AI-requests dropdown, and a conditional instructions box — plus a *second*
pod below for expanded fields. The functionality's fine; it's the structure that's messy.

**Decided:**

- **(1) Unified bib chrome + draggable.** Extract a **leaf-pure `<BibEntryChrome>`** (proposed
  `src/components/library/bib-entry-chrome.tsx`, same silo as the already-shared status modules)
  that renders the editor bib card's header stack and owns the drag — reusing the pieces that are
  **already extracted**: `LibraryStatusRow` (the ✓ chip + index-tier "Bib only / Indexed PDF /
  Deep-indexed PDF" + open link, [src/components/library/library-entry-status.tsx](src/components/library/library-entry-status.tsx))
  and `LibraryMembershipChips` ([src/components/library/provenance-chips.tsx](src/components/library/provenance-chips.tsx)).
  **DECIDED: adopt the structured author·year·title headline** (true match to `BibEntryCard`), with
  the full APA reachable via "more". PaperHeader already has all the data (`entry.indexed.state`,
  `entry.bib.state` → reuse `mapTier`). **Do NOT lift** `PanelCard`/card-store/`MIME_CITATION`
  drag/annotation editor — header stack only. **Fast-follow:** swap the Bibliography panel's inline
  `headerMeta` ([src/panels/Bibliography/BibliographyPanel.tsx](src/panels/Bibliography/BibliographyPanel.tsx):1010–1023)
  to the same `<BibEntryChrome>` for genuine single-source chrome.
  - **Draggable (HTML5 DnD, NOT a pop-out):** mirror `LeftListRow`'s drag source — `onDragStart`
    sets `ENTRY_DT_TYPE=citekey` + `ENTRIES_DT_TYPE=[citekey]`, `effectAllowed="copy"`,
    `attachClampedDragGhost`. Dropping on a custom **"My libraries" NavRow** adds the entry
    (`onAddEntriesToLibrary` → manifest membership) — **zero drop-side change** (the targets already
    accept it). Copy semantics (entry added; header stays). Drop targets = custom libraries only.

- **(2)+(4) One cohesive pod + responsive chooser.** Collapse all three layers into **one warm-sheet
  pod** in the same slot: `--pod-panel` fill, `--panel-radius` (14px), borderless (`--panel-border:
  none`), `--card-shadow-ambient` — internal regions delimited by spacing / a hairline divider, not
  nested pods. **Kill the 50/50 grid** (it's the overflow root) → a flex row: **bib region**
  `flex:1; min-width:0` (yields), **controls cluster** `flex-shrink:0`. Make the **`ViewToggle` the
  priority** (`flex-shrink:0`, `margin-left:auto`) and the **status pills the yielder** — swap
  `StatusPills` → **`StatusDots`** (the compact pair **already exists** in `StatusPill.tsx`) below a
  width threshold (RAF-coalesced `ResizeObserver`), short "Text" label in narrow mode, and a `⋯`
  overflow menu only as a last resort (likely unneeded). Reuse the reader page-vs-dock flex-collapse
  pattern + the `PaperAiRequestsMenu` portal idiom.

- **(3) Page picker — adaptive, both views.** One control in the controls region that switches its
  backing adapter on `viewMode`:
  - **Text view (ships now, no dep):** lift a shared `usePgmarkPages(editor, scrollContainer)` hook
    out of [PageScrollLozenge.tsx](library/components/PageScrollLozenge.tsx) so the picker and the
    "p. N" lozenge share one `pages[]` + current-page derivation; "go" = `scrollTo(docY)`.
    Auto-disable when there are no `\pgmark` pages (DOCX / plain-tex).
  - **PDF view (ships with F#10):** bind to pdf.js's `PDFViewerApplication` — `pagesCount` = x,
    `page` = set on go (clamp), `pagechanging` = live n. **Depends on F#10 (Option B)** — today's
    native iframe exposes no page API, so the PDF half is inert until the pdf.js swap lands.

**Scope & touch-points:**
- **NEW** `src/components/library/bib-entry-chrome.tsx` — the shared chrome + drag (reuses
  `LibraryStatusRow` / `LibraryMembershipChips` / `OpenEntryLink`; `mapTier` from
  [src/hooks/useLibrary.ts](src/hooks/useLibrary.ts)).
- [library/components/PaperHeader.tsx](library/components/PaperHeader.tsx) — the overhaul: one pod
  (replace cream wrapper + grid + inner pods), mount `<BibEntryChrome>`, the flex + `StatusDots`
  responsive controls, the page picker. Import `dnd-types` (currently imports none).
- [library/components/PageScrollLozenge.tsx](library/components/PageScrollLozenge.tsx) — extract
  `usePgmarkPages` (shared with the picker).
- [library/components/PdfView.tsx](library/components/PdfView.tsx) + [RightDetail.tsx](library/components/RightDetail.tsx)
  — forward `PDFViewerApplication` (with F#10 B) to the PDF page adapter.
- `src/panels/Bibliography/BibliographyPanel.tsx` (fast-follow single-source adoption).

**Cross-feature links (this entry is a hub):**
- **F#9** — the unified chrome's **open link IS F#9's "open in Virgil tab" header button**;
  fold them into one (enable `OpenEntryLink` in the library header). F#9's header-button half
  effectively merges here.
- **F#2** — the status row's **✓ chip is exactly what F#2 renames** ("Verified" → "Authenticated").
  The shared chrome becomes the single place that label lives — coordinate.
- **F#10** — the **PDF page-picker half depends on Option B** (pdf.js drivable). Text half is
  independent and ships first.
- **F#5 / F#7** — drag-to-library reuses the **same entry-drop plumbing** (`onAddEntriesToLibrary`
  → manifest membership) as the existing list drag and F#5's add paths.

**Open questions / design details (non-blocking):**
- **Membership chips** in the header — include (shows which libraries the entry is already in,
  complements drag-to-add) or omit? *(Lean: include — they pair naturally with the drag gesture.)*
- **Drag affordance** — whole bib-region draggable + grab cursor vs a small ⠿ handle. *(Lean: grab
  cursor + a subtle handle.)*
- **Text-view page labels** — `\pgmark` labels are printed page strings (e.g. "525"), not 1..N;
  "go" matches the typed label, and "x" = the page count vs the max printed label — pin at build.
- **Panel adoption timing** — do the Bibliography-panel single-source swap in the same pass or as a
  fast-follow.

**Notes:** `medium` — the meatiest library item, and a **hub**: the `<BibEntryChrome>` extraction is
the load-bearing, reusable piece (the editor's Bibliography panel benefits too), and it ties into
F#2 (chip rename), F#9 (open button), F#10 (PDF page control), and F#5/F#7 (drag plumbing). Worth
planning alongside those rather than in isolation.

---

### F#12 — Replace the incongruous brown on toggle selected-fills with a warm-taupe complement            [size: little]  ·  status: understood · **DECIDED: warm taupe `#8a7355`**

**Ask (Gabriel's words):** The background brown (e.g. on the non-selected options of the Virgil
Text / PDF chooser) feels incongruous with the Virgil aesthetic. Find a better complement color for
the manila — it crops up in a few places, so search around.

**Understanding (studied):** The brown is **`--accent: #7c5e3c`**. Wording note: in every
segmented control it's the **selected/active** fill (the inactive options are `transparent`), so
it's the *active pill* that reads off — there's no brown "non-selected track." It reads incongruous
because the manila family is uniformly **low-chroma** (creams, warm-grays) and #7c5e3c is the one
**saturated, dark** swatch dropped on it → it pops like a sticker, not a shade of the paper. It
crops up in **six segmented controls**:
- Text/PDF `ViewToggle` — `PaperHeader.tsx:578`
- BibEdit Form / Raw-BibTeX tabs — `BibEditModal.tsx:301`
- BibCard pill toggle — `BibCard.tsx:522`
- Central **Dashboard | Browse** switch — `library.css:659` (`.lib-viewswitch-btn[aria-pressed]`)
- PrintDialog font-size buttons — `PrintDialog.tsx:165`
- Outline **Edit / Focus** toggles — `OutlinePanel.tsx:1788,1810`

**Decided:**
- **Color: warm taupe `#8a7355`** (hover/active `#7a6549`; aria-pressed tint `#efe9e0`). Analogous
  to the manila — the manila's own deeper tone (lower chroma, slightly higher value), so the active
  pill reads as "a darker shade of the paper." White label text stays AAA (~4.9:1); one value works
  on both the cream and blue alt-themes (no per-theme override).
- **Scope: a NEW shared `--control-selected` token, NOT the global `--accent`.** `--accent` is the
  user-overridable `accentColor` pref (preferences-tree.ts:225/290) driving links, selection rings,
  ~30 panel-icon strokes, menu checkmarks, focus borders, progress bars, drag indicators, the
  primary CTA button, and marker palettes — far too broad to touch (and any user's custom accent
  overrides the default anyway). One new token = the literal "few places," and it decouples the
  toggle aesthetic from the link/selection accent (which stays brown).

**Scope & touch-points:**
- [src/app/globals.css](src/app/globals.css) — add `--control-selected: #8a7355`,
  `--control-selected-hover: #7a6549`, `--control-selected-tint: #efe9e0` to `:root` (~:7–53) **and**
  the alt-theme block (:243–250, same values). Repoint the iconbtn/topbar `aria-pressed` rules
  (:489–492, :535–537) that paint `--accent` on `--accent-light` → the new tokens.
- The six controls above — swap `var(--accent)` (and `--accent-light` where it's the pressed-tint)
  → `var(--control-selected)` / `--control-selected-tint`. Four are inline-style/Tailwind sites,
  two are CSS (`library.css`, the PrintDialog buttons).

**Open questions / details (non-blocking):**
- **Checkboxes & the primary CTA** (`PrintDialog.tsx:217`, `FontsDialog.tsx:125`, the
  `EditorLayout.tsx:3908` primary button) use the same brown *active-fill* but aren't segmented
  toggles. **Lean: leave them on `--accent`** (the user pointed at the toggle family) — but flag in
  case Gabriel wants the checkbox on-state moved too for consistency.
- Keep white (#fff) label text on the taupe (already AAA).

**Notes:** `little` — one token + ~6 repoints. Coordinates with **F#11** (the `ViewToggle` is one
of these controls and F#11 restyles the header) — land the token first so F#11 inherits it. The
alternatives considered (if taupe ever feels too quiet): muted slate-teal `#5e7d7a` (cooler,
deliberate accent; needs a `#5a7a72` nudge on the blue theme) or deep ink-slate `#44403c` (neutral
ink). Swatch comparison shown in-session.

---

### F#13 — Drag column headers to reorder the library paper list (global pref, promoted to defaults)            [size: medium]  ·  status: understood

**Ask (Gabriel's words):** In any library's paper list, be able to drag the column headers to
re-order columns. It's a **global** preference for all libraries, and one of those **deep
preferences that gets exported from my setup to the app defaults**.

**Understanding (studied):** Two parts — the reorder UI, and the global-pref-that-promotes wiring.
Both are well-supported by existing machinery:
- **Column model is duplicated, not SSOT'd.** Order is hard-coded positionally in **three** places
  with no `order[]`: `gridTemplate()` ([list-columns.ts:48–61](library/lib/list-columns.ts)), the
  per-row cells ([LeftListRow.tsx:185–335](library/components/LeftListRow.tsx)), and the header row
  ([LeftList.tsx:508–529](library/components/LeftList.tsx)). The header already has **resize-drag**
  handles (the `Resizer` separators) + sort-click `SortHeader` buttons — reorder-drag sits beside
  them.
- **Widths are already a GLOBAL pref**, in `view-session-store.ts` `layout.colWidths` (singleton
  blob `virgil-library-view-session`). So column **order** belongs in the *same* `layout` slice as
  `colOrder` — global by construction, exactly matching the ask.

**Decided:**
- **Reorderable columns: `year · author · title · status · citekey`** (the header-bearing content
  columns). **Pinned (not reorderable):** the far-left status-dot (16px, edge-fixed outside the
  grid), the far-right three-dot action (32px), the **F#9 open-in-tab column** (edge-fixed), and
  **bib-imp** (the 52px trailing imported-check track — kept last, excluded from `order[]`).
- **Global persistence:** add `colOrder?: ResizableColId[]` to `LibraryViewSession.layout`
  (sibling of `colWidths`), read/written via the existing `useLayoutPrefs()` / `setLayout({colOrder})`
  — automatically global across all libraries (singleton slice), no per-library variant.
- **Promote to app defaults:** ride the existing **promote-defaults** pipeline. It already supports
  the exact shape needed (`whitelist` + `subPath`, the same way `print.defaults.json` promotes
  `printOptions` out of a blob) — **no promoter code change.** The **snapshot-fold gotcha does NOT
  apply** (that's the CSS-var managed block; column order is pure JS grid state).

**Scope & touch-points:**
- **Introduce a `ColOrder` SSOT** and make all three sites consume it: `gridTemplate(widths, order)`
  iterates `order` (px tracks for year/author/status/citekey, `1fr` for title, RESIZER tracks
  interleaved), then appends fixed `BIB_IMP_WIDTH` last; `LeftListRow` + the header **map** the same
  order (stop the positional hand-writing) so row + header can't drift.
- **Reorder drag:** dependency-free HTML5 DnD on the `SortHeader` buttons (`draggable` +
  `onDragStart/Over/Drop` carrying `colId`; insert index from pointer-x vs header midpoints);
  commit `setLayout({colOrder})`. Disambiguate from resize (the `Resizer` already
  `stopPropagation`s its pointerdown) and sort-click (drag threshold). **Subtlety:** the resize
  neighbor-pair logic (the asymmetric title-`1fr` split) is currently hard-coded
  ([LeftList.tsx:509–515](library/components/LeftList.tsx)) and must be **recomputed from the live
  order** once columns cross the `1fr`.
- **Global field:** `view-session-store.ts` — `colOrder` on `layout` + a defensive filter in
  `normalizeSession` (drop unknown/dupe ids).
- **Promote wiring:** (a) new `library/lib/list-columns.defaults.json` holding the shipped
  `{ colOrder }` (the **single** default source — `view-session-store` seeds from it; store holds
  only user overrides); (b) a `promotable` entry in [src/lib/dev-prefs-registry.json](src/lib/dev-prefs-registry.json):
  `{ storageKey: "virgil-library-view-session", subPath: "layout", defaultsFile: ".../list-columns.defaults.json", strategy: "whitelist", whitelist: ["colOrder"] }`
  — this auto-includes the blob in `MIRRORABLE_STORAGE_KEYS` (mirror snapshots it) and the promoter
  folds `layout.colOrder` into the defaults; (c) extend `tools/check-prefs-coverage.mjs` to read the
  new defaults file.

**Open questions / details (non-blocking):**
- **bib-imp** — keep pinned-trailing (decided) or allow it to move too? *(Lean: pinned; it's a
  narrow trailing status indicator.)*
- **Promote widths too?** `colWidths` is global today but **not** promoted. Since this adds the
  library blob to the promote pipeline anyway, adding `"colWidths"` to the whitelist would also ship
  your column widths as app defaults. *(Lean: order-only per the ask; widths is a one-word add if
  wanted.)*

**Notes:** `medium` — the load-bearing work is **de-duplicating the column order into one SSOT** (3
hard-coded sites → one `order[]`), which also makes the existing resize code cleaner. This is the
**first Library pref to ride the promote-defaults pipeline**, so the registry entry + defaults file
it adds are reusable plumbing for future global library prefs. Coordinates with **F#9** (its
open-in-tab column is one of the pinned edge columns — both touch the `LeftList`/`LeftListRow`
column layout; plan together).

---

### F#14 — Sort by index-status facet (movable sub-bar under Status) + fold bib-imported into Status            [size: medium]  ·  status: understood

**Ask (Gabriel's words):** Be able to order the list by the different index statuses — e.g. list
deep-indexed files first, or the ones with no PDF first, etc. Idea: a thin bar under "Status" that
moves with a click to the different columns within Status. Also: include bib-imported (under a term
like **"imp"**) **under Status**, not as its own big column.

**Understanding (studied):** Today the "status" sort collapses three facets into one lossy scalar
(`statusRank = pdf + INDEXED_RANK + BIB_RANK`, [list-columns.ts:122–125](library/lib/list-columns.ts))
— so it can't cleanly order by any single facet, and `bib.imported` isn't in it at all. The status
glyphs (`StatusPills`: pdf / idx / bib, [StatusPill.tsx:125–145](library/components/StatusPill.tsx))
already render in a fixed order, and the bib-imported "✓ imp" pill is *already supported* by
`StatusPills` (the list just doesn't pass it — it renders the check in a separate trailing 52px
column instead). So both halves are well-supported.

**Decided:**
- **Sort model: widen the sort to `{ col, dir, facet? }`.** `facet ∈ { pdf, idx, bib, imp }`,
  meaningful only when `col === "status"` (absent → today's composite `statusRank`, reachable by
  clicking the STATUS *label*). Per-facet comparators in `list-columns.ts` reuse the existing
  `INDEXED_RANK` / `BIB_RANK` tables + booleans for pdf/imp, with a `citekey` tie-break. **Direction
  comes free** from the existing `sign = dir==="asc"?1:-1` flip — no new plumbing. Add `facet` to the
  `loadSort`/`saveSort` round-trip.
- **Interaction (your call): click best-first, re-click reverses.** Click a facet segment → sort
  best-first (deepIndexed / authenticated / has-PDF / imported on top); click the **active** segment
  again → reverse. So "deep-indexed first" = click `idx`; **"no-PDF first"** = click `pdf`, click
  again. The bar marks the active facet and shows ▲/▼.
- **Sub-bar UI:** a 2-row stack inside the Status header track — row 1 = the STATUS `SortHeader`
  (label-click → composite sort, clears facet); row 2 = a ~3px rail with **4 segments** in glyph
  order (`pdf · idx · bib · imp`), the active facet drawing a short `--accent` bar at its segment.
  One shared **`FACETS = ["pdf","idx","bib","imp"]`** array drives the `StatusPills` glyph order, the
  comparator switch, **and** the sub-bar segments — so they can't drift.
- **Per-library (not global).** The facet sort rides the existing per-`(panel, libId)`
  `ListView.sort` slice — same granularity as today's sort. (Distinct from F#13: column *order* is a
  global pref; *sorting* is a transient per-library view action.)
- **Fold bib-imported into Status as "imp".** Pass `bibImported={entry.bib.imported}` to
  `StatusPills` (renders the "✓ imp" blue pill — zero new component code), and **drop the separate
  52px column** (the `gridTemplate` track + the `imp` header div + the row cell). Bump
  `DEFAULT_WIDTHS.status` / `MAX_WIDTHS.status` by ~52px so the freed space holds the 4th pill
  instead of flowing entirely into the title.

**Scope & touch-points:**
- [library/lib/list-columns.ts](library/lib/list-columns.ts) — `StatusFacet` type; widen the sort
  type; `compareStatusFacet` routing the `case "status"`; the shared `FACETS` array;
  `defaultDirForStatusFacet`; the `loadSort`/`saveSort` `facet` round-trip; **drop the
  `BIB_IMP_WIDTH` track** from `gridTemplate`; bump the status widths.
- [library/components/LeftList.tsx](library/components/LeftList.tsx) — replace the status
  `SortHeader` slot with the 2-row stack + the sub-bar (`onSortStatusFacet`); extend `handleSort` to
  compare `facet`; remove the `imp` header div.
- [library/components/LeftListRow.tsx](library/components/LeftListRow.tsx) — pass `bibImported`;
  remove the `imp` row cell.
- [library/components/StatusPill.tsx](library/components/StatusPill.tsx) — already supports
  `bibImported`; optionally export the `FACETS` order.
- `view-session-store.ts` — `ListView.sort` widened (the slice already spreads verbatim; just keep
  `facet` through `normalizeScope`/`loadSort`).

**Open questions / details (non-blocking):**
- **Bar alignment fidelity:** equal-width segments (simple, robust — the bar is its own little
  legend) vs glyph-aligned (measure the variable-width pills so the bar literally underlines each).
  *(Lean: equal-width first; upgrade to glyph-aligned if you want it to underline the pills.)*
- Keep the composite **"overall status"** sort on the STATUS label-click (most-complete-first)? *(Lean:
  keep — it's a useful default and back-compatible.)*

**Notes:** `medium`. **Tightly coupled to F#13** — folding bib-imp *out of the columns* removes the
awkward fixed trailing track from F#13's column-order SSOT domain (one fewer special-case → F#13 gets
simpler), and both features rewrite the same `gridTemplate` + `LeftList`/`LeftListRow` header/row.
**Do the imp fold-in before or jointly with F#13**, and plan the two together. Also in the bib-auth
vocabulary family (F#1/F#2/F#3) — the idx/bib/imp facets are the same status taxonomy.

---

### F#15 — Inner library tabs: compress Chrome-style (always attached, ellipsized inactive names)            [size: medium]  ·  status: understood

**Ask (Gabriel's words):** Avoid the visual crud on the right side (esp. upper-right) of the
screenshot. To avoid it: require that tabs **always attach properly to their bodies**, but allow
tab **widths and the names of non-selected tabs to compress naturally with "…"** — the way the
Chrome browser does it.

**Understanding (diagnosed):** The inner library tabs (`PanelTabStrip` / `PanelFolderTab`) are
**content-sized SVG folder shapes** laid out `flex-shrink: 0` inside an `overflow-x: auto` strip
([PanelTabStrip.tsx:365](library/components/panel-tabs/PanelTabStrip.tsx)). So when the tabs don't
fit, the strip **scrolls instead of compressing** — the rightmost (active) tab gets stranded past
the panel's right edge. Its attach-seam is a **1px vertical bridge** (`marginBottom:-1` + a 1px fill
rect + the open-bottom stroke) that only registers when the tab sits over the body's *straight* top
border; stranded over the body's **rounded top-right corner** (radius 10, `overflow:hidden`) the
bridge has no matching edge beneath it, so the tab's stroke and the body border show as two
misaligned lines — the "crud." (Same `PanelFolderTab`/`folder-path.ts` geometry as **F#8**.)

**Decided (Chrome-style compress):**
- **Invert the strip contract:** tabs **share** the width instead of `flex-shrink:0` + scroll.
  Strip → `overflow-x: hidden` + `min-width: 0` (it already lives in a `min-width:0` panel column,
  so it's pinned to the panel width).
- **Inactive tabs** (`BackgroundTab`, plain flex divs — trivial): `flex: 1 1 auto; min-width:
  INACTIVE_MIN`, label `min-w-0; overflow:hidden; text-overflow:ellipsis` → they **absorb the
  squeeze first** and **ellipsize their names** (the existing main-app `truncate min-w-0` idiom).
- **Active tab** (the one SVG `PanelFolderTab`): `flex: 0 1 auto`, **reserved `min-width = 2*S +
  ACTIVE_MIN_CONTENT`** (~120–140px) and `max-width` = its natural width; it is the **last to
  shrink** and **keeps its full name** (per your spec, non-selected names compress, the active
  doesn't — beyond its floor we scroll, never ellipsize the active).
- **SVG-flex inversion (the load-bearing bit):** stop deriving the wrapper width from content;
  instead measure the **flex-laid-out wrapper** width and derive `tabW = clamp(MIN, laidOut − 2*S)`,
  then rebuild the folder path at that width. The content overlay spans `[S, w−S]` with
  `overflow:hidden` so the label ellipsizes. Avoid the ResizeObserver feedback loop by keeping the
  `<svg>` absolutely-positioned / `pointer-events:none` and **never writing width back** to the
  wrapper (flex owns it).
- **Attach guarantee (falls out for free):** with tabs no longer `flex-shrink:0`, the strip never
  exceeds the panel → the active tab's right edge is always ≤ the strip's → its 1px bridge always
  overlaps the body's *straight* top border → **always attached**; `svgW` = the in-bounds wrapper
  width, so no detached fragment.
- **Last resort** (rare — only past the floor, i.e. many tabs): **horizontal scroll with the active
  tab pinned via `scrollIntoView`** (engage scroll only once inactive tabs hit their floor; ~10-line
  ref effect keyed on activeId — matches Chrome, and the strip already hides its scrollbar). A
  **"+N" overflow menu** is a deferred follow-up (reuse the existing tab-menu portal idiom) only if
  real libraries routinely open >~8 inner tabs.

**Scope & touch-points:**
- [library/components/panel-tabs/PanelTabStrip.tsx](library/components/panel-tabs/PanelTabStrip.tsx)
  — strip div (`overflow-x:hidden` + `min-width:0`; engage-scroll-past-floor); the inactive
  `BackgroundTab` flex bounds + label ellipsis; the active-tab wrapper flex bounds; the
  scroll-active-into-view effect.
- [library/components/panel-tabs/PanelFolderTab.tsx](library/components/panel-tabs/PanelFolderTab.tsx)
  — invert the measurement (RO on the **wrapper**, derive `tabW`; drop the hard `width:svgW`;
  content overlay `[S, w−S]` + `overflow:hidden`; label `ellipsis` + `min-w-0`); named
  `ACTIVE_MIN_CONTENT` / `INACTIVE_MIN_CONTENT` constants (not magic numbers).
- `folder-path.ts` — **no change** (pure; just fed a flex-derived `tabW`).
- Reuse: `DocumentFolderTab`'s content-measure idiom (inverted), the main-app `truncate min-w-0`
  ellipsis primitive.

**Open questions / details (non-blocking):**
- Tune the floors (`ACTIVE_MIN_CONTENT` ~120–140px, `INACTIVE_MIN_CONTENT` ~56–64px) live.
- Overflow "+N" menu deferred unless many-tab libraries are common.

**Notes:** `medium`. **Coordinate with F#8** — same `PanelFolderTab` / `folder-path.ts`: F#8 owns
the **vertical/stroke** dimension (svgH, the bottom seam, the 0.5 crispness offset); F#15 owns the
**horizontal/width** dimension (svgW ← flex-derived tabW). They compose — F#8's bottom-edge merge IS
the attach mechanism F#15's guarantee relies on — so **land the two together and re-verify the seam**
once width becomes flex-driven.

---

### F#16 — Library papers inherit the editor's top-bar chrome (breadcrumb + back/forward + three-dot)            [size: medium]  ·  status: understood

**Ask (Gabriel's words):** The top bar of the text-editor body — the current session, back/forward
buttons, three-dot menu — should also apply to library papers. (Clarified: the editor's top-bar
chrome **changed recently** — the library should just **inherit it smoothly**; it isn't inheriting
automatically now.)

**Understanding (verified against current code):** The recent change is `f9070d57` "move pod top
chrome strip inside the white card" — the editor's top bar is now an **in-card chrome band**
([EditorPane.tsx:5261–5335](src/components/EditorPane.tsx)). It has two halves:
- **Left = the `SectionLozenge` breadcrumb** ("current session" = the live section path you're
  scrolled into). It **already renders in the Reader** — it's always-on.
- **Right = the docked `MenuBar`** — the **back/forward** paragraph-visit nav chevrons + the
  **three-dot View menu** (display toggles: par-titles, latex-comments, marginalia, highlights,
  dividers, dim-cards, close-all-panels — all read-only-safe; edit items Fonts/Margins are already
  gated off). It's **dormant in the Reader purely because no `menuBar` bundle is threaded** — the
  render is gated `{menuBar && <MenuBar/>}`, and the in-code comment confirms "the Reader shows the
  breadcrumb alone."

So the Reader is **half-inheriting** the bar today. Library papers render through the canonical
`<EditorPane>` (Reader inheritance), so the fix is to supply the missing bundle — **no
Reader-specific render code** (the `READER_INHERITANCE.md` invariant).

**Decided:**
- **Smoothly inherit the FULL current top bar** in the Text reader by threading a **read-only
  `menuBar` bundle** — the symmetric counterpart to `READER_NOOP_HANDLERS`. Build
  `READER_MENUBAR_BUNDLE` / `useReaderMenuBar(editor, vp)` in the sanctioned
  [reader-view-prefs.ts](src/components/editor-layout/reader-view-prefs.ts), reading the Reader's
  **existing ephemeral `useViewPrefs` engine** so the View-menu toggles are **functional
  session-only** (same way `useReaderViewPrefs` already wires its derivations). Pass
  `menuBar={readerMenuBar}` on the one existing `PaperRender` `<EditorPane>` mount — **both reader
  contexts** (inline panel + outer tab) inherit it, since both funnel through `PaperRender`.
- **Read-only-correct, for free:** Fonts…/Margins… auto-drop via `showMenuBarEditItems=false`
  (already set in `READER_CHROME`); Preferences/split = no-op (or wire Preferences if wanted).
- **back/forward functional:** the chevrons only `scrollToParagraph` (no mutation), but the
  paragraph-visit **history recorder** lives in `EditorLayout` (which the Reader doesn't run). Port
  the small (~50-line, editor-driven, keystroke-safe) selection-history recorder into the Reader
  hook so the buttons actually navigate. *(MVP fallback: render them present-but-disabled — but
  "apply to library papers" means functional, so that's the target.)*
- **PDF mode is unaffected** — it mounts no `<EditorPane>` (and has no section path), so the editor
  band correctly appears only in the **Text** reader.

**Scope & touch-points:**
- **NEW** in [reader-view-prefs.ts](src/components/editor-layout/reader-view-prefs.ts) —
  `useReaderMenuBar` / `READER_MENUBAR_BUNDLE` (a typed `EditorPaneMenuBarBundle` read from the
  ephemeral `vp`; no-op edit members; functional paraNav).
- [library/components/PaperRender.tsx](library/components/PaperRender.tsx) — pass
  `menuBar={readerMenuBar}` on the existing `<EditorPane>` (the **only** library-side line).
- Port the paragraph-visit history recorder (`EditorLayout.tsx`:~1756–1810) into a Reader-usable
  hook for functional back/forward.
- No `EditorPane` render change (it already lights up the `{menuBar && …}` half and threads the
  bundle to its inner `EditorChromeProvider` so float view-toggle classes derive correctly).

**Open questions / details (non-blocking):**
- back/forward: ship **functional** (port the recorder) vs **disabled-MVP** first. *(Lean: functional —
  that's the ask.)*
- Whether the three-dot in the Reader should also expose **Preferences** (wire it) or stay a pure
  view-toggle menu. *(Lean: match the main editor's menu exactly, minus the auto-dropped edit items —
  "smooth inheritance.")*

**Notes:** `medium` (mostly the functional back/forward recorder; the bundle + prop are small).
**Coordinate with F#11:** in Text mode this inherited editor band stacks **below** the library's own
`PaperHeader` (bib / AI / Text-PDF) — two distinct bands. The editor band **must stay inherited from
`EditorPane`** (never re-rendered in `PaperHeader` — that would fork the Reader path, an
anti-pattern). If F#11 ever wants a single visually-unified top chrome, the breadcrumb/nav/View-menu
must remain the **inherited** controls, just placed in the pod. F#11 should keep `PaperHeader`
compact so the combined chrome isn't bulky.

---

## Cross-cutting themes / shared infrastructure

- **"Source" vs "reference" vocabulary** (seeded by F#1; central to F#4). A *source* =
  an actual document on disk (`pdf.present`); a *reference* = a `master.bib` row (may be
  citation-only, no file). The dashboard has been quietly conflating them. Any future
  feature that counts, filters, or lists "the library" should be explicit about which it
  means. F#1 fixes the *display*; F#4 weighs whether to fix the *data model*. Candidate
  for a shared helper if it recurs.

- **Bib-auth taxonomy is touched by F#1 + F#2 + F#3 at once.** The `BibAuthState` union
  (`none | unverified | authenticated | manuscript | canonical | failed`), its derived
  `verifiedTerminal` stat, the `StatusPill`/chip vocabulary, and `bib_auth.py` are a single
  coupled surface. F#1 drops the "Verified" card, F#2 retires the "verified" word, F#3
  retires `canonical`-as-a-state. **These should be planned together** so the enum, the
  stats, the pills, and the docs (`library/CLAUDE.md` "Bib states", `glossary.md`,
  `STYLE_GUIDE.md`) change once, coherently — not in three conflicting passes.

- **Reader chrome stacks two bands** (F#11 + F#16). In Text mode the library reader will show the
  library's own `PaperHeader` (F#11 — bib / AI / Text-PDF) **above** the **inherited** editor
  in-card top bar (F#16 — section breadcrumb + back/forward + three-dot View menu). Hard rule: the
  editor band is **inherited from `EditorPane` via a `menuBar` bundle**, never re-rendered in
  `PaperHeader` (forking the Reader path is the `READER_INHERITANCE.md` anti-pattern). Plan F#11's
  layout knowing F#16's band sits just below it; keep `PaperHeader` compact.

- **Shared `<BibEntryChrome>` + the paper-header hub** (F#11, reaching into F#2/F#9/F#10). F#11
  extracts the editor bib-card's header stack (status row ✓chip + index-tier + open link + the
  membership chips) into one leaf-pure component used by **both** the editor Bibliography panel and
  the library `PaperHeader`. That single component is where three other features converge: the
  **✓ chip is F#2's rename target**, the **open link is F#9's "open in tab" header button**, and the
  header's **PDF page-picker half depends on F#10's pdf.js swap**. Plan F#11 *with* that trio, not
  alone — and make `<BibEntryChrome>` the single home for the bib-status vocabulary so F#1–F#4's
  taxonomy work lands in one place on the UI side.

- **The inner-tab folder shape is a 2-feature pair** (F#8 + F#15). Both rewrite
  `PanelFolderTab` + `folder-path.ts`: F#8 fixes the **vertical/stroke** dimension (the clipped
  outline — svgH, bottom seam, the 0.5 crispness offset), F#15 the **horizontal/width** dimension
  (flex-driven tabW, ellipsized labels, the always-attached active tab). F#8's bottom-edge merge IS
  the attach mechanism F#15 depends on, so **land them together and re-verify the seam** once width
  becomes flex-driven — don't do one without re-checking the other.

- **The library list-table is a 3-feature cluster** (F#9 + F#13 + F#14). The `LeftList` /
  `LeftListRow` / `list-columns.ts` `gridTemplate` triad is rewritten by all three: F#9 adds a
  pinned open-in-tab column, F#13 introduces the column-order SSOT, F#14 folds bib-imp out of the
  columns into Status and reworks the Status header. They share the same `gridTemplate` consumers
  and would otherwise conflict — **plan and build them as one pass over the list table**, ideally:
  fold bib-imp in (F#14) → author the order SSOT over the resulting 9-track grid (F#13) → slot the
  open column (F#9). The status taxonomy (idx/bib/imp) also ties to F#1/F#2/F#3.

- **Library global prefs + the promote-defaults pipeline** (F#13 opens it). F#13 is the first
  Library pref to ride the maintainer-setup → shipped-defaults pipeline (`dev-prefs-registry.json`
  + a new `list-columns.defaults.json`). Once that registry entry + library defaults file exist,
  *other* global library prefs (e.g. promoting `colWidths`, or any future library-global setting)
  ride the same plumbing — so if more "export my setup to defaults" library prefs appear, they
  extend this entry rather than re-inventing it. The Library deliberately uses its own
  `view-session-store` `layout` slice for this, NOT the editor's `VIEW_PREF_REGISTRY`.

- **Entry-drag → library membership** (F#5, F#7, F#11). Dragging an entry onto a custom-library
  NavRow (`ENTRY_DT_TYPE`/`ENTRIES_DT_TYPE` → `onAddEntriesToLibrary` → manifest `citekeys`) is the
  shared "add to this library" primitive. F#11 makes the paper-header bib a new drag *source* for
  it; F#5's per-library "Add from .bib" writes the same membership. One drop contract, several
  sources.

- **Left-rail three-dot menus + one menu primitive** (F#5 + F#7). Both want every row in the
  left rail to carry a right-aligned three-dot menu, and both should reuse a *single* portaled
  menu primitive (the `RowActionMenu` pattern, already used by `LeftList`) so trigger /
  positioning / escape / outside-click / visibility behave identically. Decide visibility
  (always-on vs hover) once for both. F#7's pod lives under `src/components/library/` (Virgil-doc
  side), so the primitive must be importable from there as well as from `library/components/`.

- **Left-rail terminology** (caused a real mix-up). The left library rail has **two stacked pods**:
  the **Libraries pod** (`LibrariesNavigator` → "Libraries": Central + *Project libraries* [open
  docs] + *My libraries* [custom]) and the **"My Papers" pod** (`MyPapersPod` → curated list of the
  user's own docs). "Papers column" / "My Papers" = the **My Papers pod**, NOT the `LeftList`
  (papers within a library) and NOT the "Project libraries" section. Recorded in
  `docs/agents/glossary.md`.

- **Build mirrors.** `public/skill-bundle/**` and `.claude/commands/library/**` are
  generated from `library/skills` + `library/scripts` via `npm run build:library-bundle`.
  Every skill/script edit in these features lands in the `library/` sources; never hand-edit
  the mirrors.

- **`bib.state` storage home** (F#3 + F#4). Today it lives on the catalog row *and* as a
  `% bib.state =` comment in master.bib. F#4's sources-only option would force fileless
  entries' state to live only in the master.bib comment; F#3 adds `score`/`note` to the
  state record. Whatever F#4 decides about membership dictates where F#3's richer auth
  result is allowed to live — resolve F#4 before finalizing F#3's persistence.

---

## Parking lot — out of scope / later

_(Ideas raised but explicitly deferred, with the reason, so they're not lost.)_
