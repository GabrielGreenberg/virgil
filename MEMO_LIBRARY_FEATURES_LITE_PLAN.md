# Library features — lite plan (grouping & approach)

A **structural outline** of the 16 library features in
[MEMO_LIBRARY_FEATURE_WISHLIST.md](MEMO_LIBRARY_FEATURE_WISHLIST.md): how they group, the deep
architectural move each group reduces to, and a recommended sequence. **This is not the detailed
plan** — it's the skeleton Gabriel will flesh out in a planning session, and the map the overnight
agent orients by.

> **Central design principle (load-bearing).** Prefer **unified, deep, architectural solutions that
> capture a range of related phenomena** over superficial surgical patches. Each group below is
> framed as *one architectural change* that subsumes several wishlist items **and improves the app
> generally** — that framing is the point, not an afterthought. (See `MEMORY.md` →
> design-prefer-deep-unified.)

The 16 features are **not**16 independent tasks — they collapse into **six deep moves** plus a few
shared-primitive wins. Build the deep move once; the surface features fall out of it.

---

## The six deep moves (the spine)

### DM-1 · Layered bibliography data model — *holdings vs reference universe* → **F#4** (decided), unblocks **F#1**
`catalog.json` = **holdings only** (rows ⟺ a file on disk); `master.bib` + `bib-index.json` = the
**reference universe**; `bib.state` lives in the master.bib `% bib.state` comment, **projected into
bib-index.json**; search + stats run over bib-index. Decided: sources-only / layered-hybrid. **The
foundation** — every bib-status reader (dashboard, list, chrome) reads from here. Migration is
subtractive + reversible; the one risk is back-fill-state-before-pruning-rows.

### DM-2 · One bibliography-status ontology + real authentication routes → **F#2 + F#3**, read by **F#1 / F#11 / F#14**
Collapse the **verified ≡ authenticated** synonym (one term, app-wide). Make **"canonical/pre-digital"
a *route to* `authenticated`** (publisher + book-catalog + citing-work triangulation), **not** a
terminal give-up. Net ontology: `{ authenticated, unverified, failed, manuscript }` + a *pre-digital*
provenance descriptor — `authenticated` reachable by modern **or** pre-digital means, defined in **one
place** (the chips/pills, the docs, the Python `bib_auth.py`). **DM-1 + DM-2 together = "the
bibliography subsystem"** — plan and land them as one coherent pass so state's *home*, *vocabulary*,
and *the dashboard* all change once.

### DM-3 · A declarative library list-table → **F#13 + F#14 + F#9**
Replace the **3 hard-coded column sites** with **one `order[]` SSOT** + a status **`FACETS` SSOT**
(per-facet comparators). The Status column becomes a **facetted, sortable, self-describing** unit
(bib-imp folded in as "imp"; the movable sub-bar selects the sort facet). Column order is the **first
library global pref to ride the promote-defaults pipeline** (reusable plumbing). The open-in-tab
column slots into the same model. *Intra-group order:* fold bib-imp into Status (F#14) → author the
order SSOT over the resulting 9-track grid (F#13) → slot the open column (F#9).

### DM-4 · A unified folder-tab primitive → **F#8 + F#15** (consider also the main-app `DocumentFolderTab`)
One folder-tab whose SVG geometry is **correct** (full-wrap stroke, F#8 = vertical/stroke dimension)
**and** **Chrome-style flex-compressible** (F#15 = horizontal/width dimension), with the
**active-tab→body attach** as a guaranteed invariant both respect. **Deeper option (recommended to
evaluate):** the main-app `DocumentFolderTab` is the *same* content-measured SVG folder shape — unify
both into **one shared folder-tab primitive** rather than fixing the library copy alone. That's the
"capture the range of related phenomena" move.

### DM-5 · The Reader is a *fully-configured* EditorPane + one bib-entry chrome → **F#11 + F#16**, shared chrome touches **F#2 / F#9**
(a) Extract **`<BibEntryChrome>`** — one bib-entry presentation component used by **both** the editor
Bibliography panel and the library `PaperHeader` (single SSOT; **improves the editor too**). (b)
**Complete the Reader-inheritance contract:** give the Reader a read-only `menuBar` bundle (the
symmetric counterpart to `READER_NOOP_HANDLERS`) so it's a *fully-configured* EditorPane that inherits
the top bar (F#16), not a half-configured one. (c) F#11's cohesive header pod + responsive chooser +
draggable bib + adaptive page picker. **Theme:** *the library Reader is the editor, fully inherited;
bib presentation is one component everywhere.*

### DM-6 · An owned, themeable PDF surface → **F#10** (decided B), unlocks **F#11**'s page picker
Replace the un-styleable native `<iframe>` with **pdf.js's prebuilt viewer** (vendored, same-origin,
restyled to Virgil tokens). One swap yields **both** the on-brand toolbar (F#10) **and** app-drivable
page control (F#11's "n / x" picker). Not a rebuild — Mozilla's shipped app, restyled.

### Shared-primitive wins (smaller, mostly independent)
- **F#5 + F#7** — one portaled left-rail **menu primitive** (three-dot on Libraries-pod + My-Papers-pod
  rows). Build the primitive once, two consumers.
- **F#12** — the **`--control-selected`** token (warm taupe `#8a7355`). **Lands first** so F#11's
  restyle inherits it.
- **F#6** — toast **lifecycle** fix (each toast owns its own timer + ✕ + per-severity TTL).

---

## How the groups depend on each other

```
F#12 (token) ───────────────▶ F#11 (header restyle inherits it)
F#10 (pdf.js) ──────────────▶ F#11 (PDF page-picker needs a drivable viewer)
DM-1 F#4 (bib.state home) ──▶ F#1, F#2, F#3, and F#14 (status reads)
F#2 (chip rename) ──────────▶ F#11 (chip lives in <BibEntryChrome>)
F#9 (open button) ──────────▶ F#11 (= the header open link) + DM-3 (list table)
F#14 (fold bib-imp) ────────▶ F#13 (simpler 9-track grid)
F#8 + F#15 ─────────────────  land together (same tab files; F#8's bottom seam = F#15's attach)
```

Independent / parallelizable: **DM-4** (tabs), **DM-6** (PDF), and the shared-primitive wins.

---

## Recommended phasing (deep-first, dependency-respecting)

| Phase | Deep move(s) | Features | Why here |
|---|---|---|---|
| **0 · Foundations** | tokens & primitives | F#12, F#6, F#5+F#7 | Independent, low-risk, **unblocks** F#11 (token) + de-risks the rest. |
| **1 · Bibliography subsystem** | DM-1 + DM-2 | F#4, F#2, F#3, F#1 | The architectural spine; touches Python + bib-index + UI; most open design (F#3) — **front-load it**. |
| **2 · List-table** | DM-3 | F#14, F#13, F#9 | Reads the Phase-1 status model; one coordinated pass over `LeftList`/`gridTemplate`. |
| **3 · PDF surface** | DM-6 | F#10 | Independent; **prerequisite** for F#11's page picker. |
| **4 · Reader chrome & header** | DM-5 | F#11, F#16 | Depends on F#12, F#10, F#2, F#9; the `<BibEntryChrome>` + Reader-inheritance hub. |
| **5 · Folder-tab primitive** | DM-4 | F#8, F#15 | Independent; can run alongside any phase. |

Phases 3 and 5 are independent and may run in parallel with 1/2/4.

---

## Open decisions (consolidate before/early in the build)

**Genuinely needs Gabriel (front-load — surface at the *start* of the overnight run):**
- **DM-2 / F#3 pre-digital authentication** — the real design surface: the confidence model +
  thresholds; how many independent citing works must agree (and weighting authoritative catalogs);
  reconcile the **year cutoff** (code `<1980` vs docs `<1950`); migration of the ~13 existing
  `canonical` rows. *(Decided already: metadata + citing-work triangulation, no fetch/OCR; success →
  `authenticated`.)*
- **F#11** — include the membership chips in the header? do the Bibliography-panel single-source
  `<BibEntryChrome>` adoption in the same pass or as a fast-follow?

**Defaults the agent should take (documented, non-blocking — the "lean" notes in each wishlist
entry):** F#1 section sub-headers (keep light labels) · F#5 delete-confirm + add-into-library flow ·
F#6 per-severity TTL values · F#7 always-visible three-dot · F#8 widen-viewport · F#9 event-by-name +
icon-only column · F#12 toggles-only (leave checkbox/CTA on `--accent`) · F#13 bib-imp pinned,
order-only (don't promote widths) · F#14 equal-width sub-bar segments, keep composite-status sort ·
F#15 floor constants tuned live, defer the "+N" overflow menu · F#16 functional back/forward, mirror
the editor's three-dot.

---

## Conventions & guardrails (every phase)

- **Keystroke sanctity** (`AGENTS.md`) — nothing may do per-keystroke work proportional to doc size.
  Watch F#16's paraNav recorder + F#14's sort memos especially; verify `window.__virgilBusStats()`.
- **Reader-inheritance invariant** (`library/READER_INHERITANCE.md`) — F#11/F#16 channel through
  `READER_CHROME` / the shared layer; **no Reader-specific render code**.
- **Build mirrors** — edit `library/skills` + `library/scripts` sources; run `npm run
  build:library-bundle`; never hand-edit `public/skill-bundle/**` or `.claude/commands/library/**`.
- **Verification** — `tsc` 0, full `vitest` green, no new lint; live-check via the dev-preview library
  recipe (`library/CLAUDE.md` → "Verifying the Reader live": force-dev-storage + idb seed).
- **Merge convention** (per Gabriel's pattern) — a **worktree/branch per phase**, merged to **local
  `main` no-ff, NOT pushed**; each phase independently reviewable.
- **Keep the wishlist live** — update each feature's status in `MEMO_LIBRARY_FEATURE_WISHLIST.md` as it
  lands.

---

## Source-of-truth pointers

- **[MEMO_LIBRARY_FEATURE_WISHLIST.md](MEMO_LIBRARY_FEATURE_WISHLIST.md)** — full per-feature scope,
  decisions, file:line touch-points, and the cross-cutting section (the durable record of the
  research workflows; their `/tmp` outputs are ephemeral).
- **[MEMO_LIBRARY_OVERNIGHT_HANDOFF.md](MEMO_LIBRARY_OVERNIGHT_HANDOFF.md)** — the paste-ready prompt
  to launch the autonomous overnight run.
- Docs: `AGENTS.md` · `library/CLAUDE.md` · `library/AGENTS.md` · `library/READER_INHERITANCE.md` ·
  `src/STYLE_GUIDE.md` · `docs/agents/glossary.md` · `docs/architecture/VIRGIL.md` ·
  the promote-defaults trio (`src/lib/dev-prefs-registry.json`, `tools/promote-defaults.mjs`,
  `tools/check-prefs-coverage.mjs`).
