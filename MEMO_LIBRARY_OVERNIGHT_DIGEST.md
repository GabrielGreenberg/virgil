# Library overnight run — digest & ledger

**Run:** autonomous overnight, started 2026-06-27. Operator: Claude (Opus 4.8), ultracode manager mode.
**Goal:** land the six deep moves (16 features) deep-first, each phase merged to local `main` no-ff (NOT pushed).
**Source of truth:** [MEMO_LIBRARY_FEATURE_WISHLIST.md](MEMO_LIBRARY_FEATURE_WISHLIST.md) + [MEMO_LIBRARY_FEATURES_LITE_PLAN.md](MEMO_LIBRARY_FEATURES_LITE_PLAN.md).

This file is the complete record: the START ledger (below), then a per-phase landing log + the MORNING DIGEST appended at the end.

---

## Baseline (captured before any code)

- Branch: `main` @ `53afaa51` (Release v0.1.62). Worktree clean except the 3 planning memos.
- node: **arm64** (good — no Rosetta crash risk).
- `tsc --noEmit`: **0 errors** ✅
- `vitest`: baseline **2983 passed | 1 skipped | 0 failed** ✅ (312 files).
- Merge convention: a branch per phase **in the main checkout** (`git checkout -b phaseN-…`), verified, committed, then `git checkout main && git merge --no-ff`. *Rationale for not using a separate worktree:* prior sessions hit Turbopack panics on symlinked-node_modules worktrees, and Workflow/Agent subagents edit the **main cwd** regardless of worktree — so a phase branch in the main checkout gives the per-phase + no-ff convention without those hazards, and the dev preview (which serves the working dir) live-verifies whatever branch is checked out.

---

## PHASE A — Decisions & Assumptions Ledger

Legend: **[DEFAULT]** = taking the wishlist "lean"/decided option, proceeding. **[NEEDS-GABRIEL]** = genuinely his call; I picked the most architecture-respecting option, flagged LOUDLY, and proceeded (he's asleep). **[HARD-STOP]** = skipped this feature only; no safe default.

### Phase 0 — Foundations

**F#12 — `--control-selected` warm-taupe token** · **[DEFAULT]** (decided)
- New tokens `--control-selected:#8a7355`, `--control-selected-hover:#7a6549`, `--control-selected-tint:#efe9e0` in `:root` + alt-theme block of globals.css; repoint the **6 segmented controls** + the iconbtn/topbar `aria-pressed` rules. Leave global `--accent` untouched.
- Checkboxes / primary CTA stay on `--accent` (lean — he pointed at the toggle family). Flagged.

**F#6 — Toast lifecycle** · **[DEFAULT]**
- Per-toast `Toast` subcomponent owns its own TTL timer + ✕ + pause-on-hover; kill the single-effect-clears-all-timers bug. Per-severity TTL: info/done ~5s, attention/warning (`setup-needed`) ~11s. Dismissal session-scoped (no localStorage suppression).

**F#5 + F#7 — One left-rail three-dot menu primitive** · **[DEFAULT]**
- Build/ös reuse **one** portaled menu primitive (the `RowActionMenu` pattern) importable from both `library/components/` and `src/components/library/`. Visibility: **always-visible** three-dot (match the existing paper rows) for both pods.
- F#5 (Libraries pod): Central → Re-sync skills + Change folder; custom → Rename + Delete library (confirm) + Add from .bib (imports INTO that library). Remove standalone `AddFromBibRow`; fold "new library from .bib" into the "My Libraries" header **+** menu. Project Libraries: no menu.
- F#7 (My Papers pod): three-dot replaces the hover-×; item = **Remove** (`removeMyPaper`, curated-list only — does not close tab / delete doc).

### Phase 1 — Bibliography subsystem (DM-1 + DM-2)

**F#4 — Catalog membership = sources-only (layered-hybrid)** · **[DEFAULT]** (decided)
- `catalog.json` = holdings only; `master.bib` + `bib-index.json` = reference universe; `bib.state` in the master.bib `% bib.state` comment, projected into `bib-index.json`; search + stats over bib-index.
- Migration in dependency order; **back-fill the `% bib.state` comment from any row whose state predates it BEFORE pruning rows** (the one data-loss risk). For the **first release I gate the writer-stop / row-prune behind a one-line flag** (default sources-only ON, but the prune is the only irreversible step → I make the prune a separate, idempotent, dry-run-first migration script and DO NOT auto-run a destructive prune over Gabriel's real 27k-row catalog unattended). See Phase 1 log + **QUESTION** below.

**F#2 — Retire "verified", unify on "authenticated"** · **[DEFAULT]** (decided)
- Rename positive "✓ Verified" → "✓ Authenticated" (chips/pills/tooltips). Keep "Unverified"/"Failed" per-entry labels. Internal `unverified` value + `doiVerified` field unchanged. Delete the orphaned `verifiedTerminal` stat (or rename to `terminalNoAction` if a consumer survives).

**F#3 — Pre-digital authentication route** · **[NEEDS-GABRIEL → proceeding with the documented lean]**
- canonical stops being a terminal auth state; becomes a *route to* `authenticated` via metadata + citing-work triangulation (OpenAlex/Crossref/Semantic Scholar reverse-citation + book catalogs). **No fetch/OCR.**
- **Confidence model (my chosen defaults, flagged):** success → `authenticated` when **(a)** ≥2 independent corroborations agree on title+author+year, **OR (b)** one authoritative catalog (LoC/WorldCat/OpenLibrary/IA-metadata) + publisher match. Authoritative catalogs weighted higher than scraped reference lists. Keep a **year/no-identifier gate**: only attempt for book/incollection/inbook with no DOI/ISBN.
- **Year cutoff reconcile (code `<1980` vs docs `<1950`):** pick **`<1980`** (the code's current gate) as the single value — it's the live behavior and the broader, safer net for "pre-digital" books; update docs to match. Flagged.
- **Migration of ~13 canonical rows:** re-run authentication; on success → `authenticated` (+ provenance note); on failure → `unverified`/`failed`. Provide as a re-runnable skill invocation, not a blind bulk mutate.
- **Order of operations:** run pre-digital route only after the modern chain exhausts (`failed`), preserving today's behavior.
- **Scope note for overnight:** F#3 is a Python-pipeline + skill change (no live UI to break). I implement the engine + skill + scoring + tests, but I will **NOT** mass-mutate Gabriel's real `master.bib`/catalog unattended — the migration is delivered as a documented, dry-run-first skill the user runs. This is the safe split.

**F#1 — Dashboard headline-stats redesign** · **[DEFAULT]**
- Two rows. Top (4): Bibliography / Sources (`citekey && pdf.present`) / Indexed / Deep-indexed. Mid (3): Authenticated (strict) / Non-authenticated (`bibEntries − authenticated`) / Unsorted. Remove Pipeline section + Verified card. Keep light section labels ("Library" / "Bibliography"). 4-up on wide, wrap on narrow.

### Phase 2 — List-table (DM-3)

**F#14 — Sort by status facet + fold bib-imp into Status** · **[DEFAULT]**
- Sort widened to `{col, dir, facet?}`, `facet ∈ {pdf, idx, bib, imp}`. Shared `FACETS` array drives glyph order + comparator + sub-bar. Click best-first; re-click reverses. Per-library (rides existing `ListView.sort`). Fold bib-imp into Status (`bibImported` pill); drop the 52px column; bump status widths ~52px. Equal-width sub-bar segments first; keep composite-status sort on STATUS label-click.

**F#13 — Drag column headers to reorder (global pref, promoted)** · **[DEFAULT]**
- Introduce a `ColOrder` SSOT consumed by all 3 sites (`gridTemplate`/row/header). Reorderable: `year·author·title·status·citekey`. Pinned: status-dot, action ⋮, F#9 open column, bib-imp(now folded — moot). Global `colOrder` on `LibraryViewSession.layout`. Promote order-only (not widths) via a new `library/lib/list-columns.defaults.json` + a `dev-prefs-registry.json` whitelist entry + extend `check-prefs-coverage.mjs`.

**F#9 — Open-in-Virgil-tab column + header button** · **[DEFAULT]**
- Fire `virgil-open-library` `{citekey, target:"tab"}` by name (clean boundary). New trailing icon-only column before the ⋮; disabled on triage rows. Header button in `PaperHeader` shown only in in-library reader (`RightDetail`), hidden in outer tab (`PaperOuterView`). Merges with F#11's header open link.

### Phase 3 — PDF surface (DM-6)

**F#10 — pdf.js prebuilt viewer (Option B)** · **[DEFAULT]** (decided)
- Vendor pdf.js prebuilt viewer to `public/pdfjs/` (web/+build/ from the matching release zip, NOT node_modules). Point iframe at `/pdfjs/web/viewer.html`, open via `PDFViewerApplication.open({url, originalUrl})`. `virgil-overrides.css` remaps pdf.js vars to Virgil tokens; hide annotate/print/editor groups. Add a build re-vendor note.
- **Risk flag:** vendoring ~1MB binary assets requires downloading a release zip from GitHub (network). If unavailable in the overnight env, F#10 is the one phase that may HARD-STOP at the vendoring step — see Phase 3 log.

### Phase 4 — Reader chrome & header (DM-5)

**F#11 — Paper-header overhaul (`<BibEntryChrome>`, cohesive pod, page picker)** · **[DEFAULT + a NEEDS-GABRIEL]**
- Extract leaf-pure `<BibEntryChrome>` reusing `LibraryStatusRow`/`LibraryMembershipChips`/`OpenEntryLink`; structured author·year·title headline + "more" → full APA. One warm-sheet pod, kill the 50/50 grid → flex (bib `flex:1 min-w:0`, controls `flex-shrink:0`, ViewToggle priority, StatusPills→StatusDots below threshold). Page picker: Text via shared `usePgmarkPages`; PDF via pdf.js (depends F#10).
- Draggable bib (HTML5 DnD, copy, drop on custom "My libraries" NavRow). **[NEEDS-GABRIEL]** membership chips in header → **lean YES** (proceeding). Bibliography-panel single-source `<BibEntryChrome>` adoption → **lean YES, same pass** (proceeding).

**F#16 — Reader inherits the editor top bar** · **[DEFAULT]**
- Build `READER_MENUBAR_BUNDLE`/`useReaderMenuBar(editor, vp)` in `reader-view-prefs.ts` (read-only, functional view toggles via the ephemeral engine). Pass `menuBar` on the single `PaperRender` `<EditorPane>`. **Functional** back/forward (port the keystroke-safe paragraph-visit recorder). Three-dot mirrors the editor's View menu minus auto-dropped edit items. No Reader-specific render code (inheritance invariant). Keystroke sanctity re-verified.

### Phase 5 — Folder-tab primitive (DM-4)

**F#8 — Tab outline fully wraps (clipped stroke)** · **[DEFAULT]**
- Give the tab SVG a horizontal stroke gutter mirroring the vertical one (widen viewport + offset path so both swoop feet + bottom corners render). Verify at 1× and 2× DPR. Preserve `R=10`.

**F#15 — Inner tabs compress Chrome-style** · **[DEFAULT]**
- Invert strip contract: tabs share width (`overflow-x:hidden` + `min-width:0`). Inactive tabs `flex:1 1 auto` + ellipsis; active tab `flex:0 1 auto` reserved min-width, last to shrink, keeps full name. SVG-flex inversion: measure flex-laid-out wrapper → derive `tabW`, rebuild path; never write width back. Scroll-active-into-view past the floor. Defer "+N" overflow menu. Land WITH F#8, re-verify the seam.
- **[NEEDS-GABRIEL]** DM-4 "unify with main-app `DocumentFolderTab`" → **evaluate; lean: only if low-risk.** Default to fixing the library copy correctly first; unify only if the shared extraction is clean (documented in Phase 5 log).

---

## Front-loaded QUESTIONS FOR GABRIEL (collected; full list in MORNING DIGEST)

1. **F#4 row-prune:** I do NOT auto-run a destructive prune of ~27k `present:false` catalog rows over your real library unattended. The reader/writer repoints + bib-index projection land; the prune ships as a dry-run-first script for you to run. OK? (The alternative — auto-prune overnight — is the one irreversible step and violates the "no destructive default" rule.)
2. **F#3 thresholds + `<1980` cutoff:** confirm the confidence model (≥2 corroborations OR catalog+publisher) and the `<1980` year gate. I did NOT mass-re-authenticate your real master.bib; delivered as a re-runnable skill.
3. **F#3/F#1 interaction:** with canonical retired as a state, the dashboard's non-auth bucket folds canonical in — confirm.
4. **F#10 vendoring:** confirm the ~1MB `public/pdfjs/` vendored assets are acceptable in-repo (vs gitignored + a fetch script).
5. **F#5 menu primitive home:** I'm placing the shared menu primitive where both silos can import it — confirm the location once you see it.

---

## Deferred (supervised follow-ups)

**F#4 writer-side — sources-only data flip (the perf win).** The reader-side is done and makes the UI correct/honest on *both* catalog models, so this is non-urgent and is the destructive half — land it with the Python pipeline runnable. Exact steps (from the wishlist migration plan, dependency order):
1. ✅ (done) project `% bib.state` into `bib-index.json` (the safety net).
2. ✅ (done) widen the frontend reader so synthetic rows show real state.
3. ✅ (done, reader-side) search + stats already run over the merged universe.
4. **TODO** stop the Python writers minting reference rows — gate `merge_paper_references._upsert_catalog_row` + `triage_apply._upsert_catalog_row_bib_only` to holdings-only; gate `authenticate-bib` / `update_catalog_entry.py` so they stop *requiring* a row (write the master.bib `% bib.state` comment instead — `update_master_bib_entry --bib-state`, already the path).
5. **TODO** relax the merge shrinkage-guard (`merge_bibs_postflight._check_catalog` — catalog is now expected-flat/shrinking).
6. **TODO (destructive)** one-time prune of `present:false` rows — **back-fill the `% bib.state` comment from any row whose state predates the comment BEFORE deleting it.** Ship as a dry-run-first idempotent script; do not auto-run.
Note: a non-standard `bib.state="needs-reauth"` is written by `apply_metadata_mismatch_policy.py` — not in the `BibAuthState` union, so the bib-index reader drops it (→ "none"). Reconcile to `unverified`/`failed` (or add to the union) when doing the writer-side.

## Per-phase landing log

### Phase 2 — List-table — ✅ MERGED to local main `0e45eafa` (no-ff, NOT pushed)
DM-3 partial via the existing `gridTemplate` SSOT. **F#14 (fold bib-imp → 4th "✓ imp" Status pill)** + **F#9 (open-in-tab list column)** landed; **F#13 (column-order drag + promote-defaults)** and **F#14's facet sub-bar sort** DEFERRED (live tuning). Skeptic-reviewed: 0 real defects; 1 LOW self-healing edge (a persisted status width <208 may clip the 4th pill until resized). tsc 0 · vitest 2995 · eslint clean.
- F#9 header-button half folds into F#11 (not done).

---

### Completions B — F#11 editor Bibliography-panel adoption — ◑ ASSESSED & DEFERRED (no code changes)
The third "small completion" you picked. A Map→assess pass found `risky-defer`: the single-source win is **mostly already banked** — `BibliographyPanel` (headerMeta) already shares the same `LibraryStatusRow` + `LibraryMembershipChips` that `<BibEntryChrome>` composes; only a ~15-line byte-identical author·year·title headline duplicates. Forcing full `<BibEntryChrome>` adoption into the editor card would risk **drag-on-drag** (chrome's drag-to-library vs the card's `MIME_CITATION` cite-drag — the exact forbidden regression), visual drift (themed header band / TITLE dialect / double grip), and an APA mismatch (BIB-F1-02 deliberately removed the editor APA preview) — on the data-loss-grade `BibEntryCard`. Clean documented deferral chosen over a risky editor regression. **Prereqs for a safe future pass** (in the digest's wishlist F#11 line + the workflow followups): add an `embedded/noDrag` mode + `dragHandle`/`titleStyle` slots to `<BibEntryChrome>`, thread props in BibliographyPanel, decide the APA question, then full live FSA feel-check of the card's cite-drag/popout/annotation. Empty branch dropped.

### Completions A — F#16 breadcrumb + F#14 facet sort — ✅ MERGED to local main `d73624d6` (no-ff, NOT pushed)
Completes the deferred halves: **F#16** now FULLY done (functional Reader section breadcrumb — keystroke-safe scroll-driven `useReaderSectionPath` + one-shot settle recompute so it populates on fresh open) and **F#14** FULLY done (status facet sub-bar sort; one shared `FACETS` array genuinely drives the comparator + sub-bar + StatusPills glyph order). Workflow-implemented + reviewed (2 findings fixed: breadcrumb fresh-open recompute; StatusPills FACETS-driven) + my verification. tsc 0 · vitest 3046 · eslint clean. OWED live feel-check (breadcrumb follows scroll; 2-row Status header + facet rail).

### Phase 4b — Paper-header (F#11, library-scoped) — ✅ MERGED to local main `ee8ed084` (no-ff, NOT pushed)
DM-5(a). NEW leaf-pure `<BibEntryChrome>` (structured headline + "more"→APA, membership chips, ✓Authenticated/index-tier status row, drag-to-custom-library) + NEW `usePgmarkPages` (extracted; **single owner** in RightDetail feeding both the lozenge + the header picker — review caught & I fixed a two-instance double-derivation) + PaperHeader collapsed to ONE responsive warm-sheet pod (50/50 grid killed; StatusPills→StatusDots <560px via RAF-coalesced RO) + text-view "p. N / x" page picker + the F#9 header open button. Also completes **F#9** (list column + header button). Workflow-implemented + reviewed (2 findings fixed) + my diff-gate (confirmed 1 usePgmarkPages call site). tsc 0 · vitest 3025 · no net-new lint. **DEFERRED:** editor Bibliography-panel single-source `<BibEntryChrome>` adoption (fast-follow, kept editor blast radius out) + PDF page-picker (needs F#10). OWED live feel-check (560px swap, picker jump, borderless pod, grab-drag).

### Phase 2b — List-table column-order (F#13) — ✅ MERGED to local main `1bb50490` (no-ff, NOT pushed)
Completes **DM-3** (list-table now fully done: F#9 + F#14-fold + F#13). One `order[]` SSOT across the 3 column sites; `resizeNeighborsForBoundary` (the asymmetric 1fr-title-aware resize helper — I diff-gated it reproduces the legacy pairs + generalizes); global `colOrder` on the layout slice; HTML5 drag-reorder; **promote-defaults wiring** (first library pref to ride it — new `list-columns.defaults.json` + registry entry + a permutation guard in check-prefs-coverage — reusable plumbing for future library globals). Workflow-implemented (subagent context) + review 0 defects + my diff-gate. tsc 0 · vitest 3015 · prefs-coverage OK · eslint clean. OWED live drag feel-check (resize-after-reorder; click-vs-drag).

### Phase 4 — Reader top-bar (F#16) — ✅ MERGED to local main `cc1810df` (no-ff, NOT pushed)
Resumed workflow-heavy (explore→implement→review all in subagent context to preserve main-loop context, per Gabriel's mid-run ask). DM-5(b): the Reader's docked MenuBar now inherits via a typed `menuBar` bundle on PaperRender's one `<EditorPane>`. `useReaderView(editor, editorHandleRef, scrollEl)` returns BOTH bundles off **one** ephemeral `useViewPrefs` (two-engine trap avoided). View toggles functional; back/forward = keystroke-safe wall-clock `useParaNavHistory` (DiskWatcher-class, not an editor subscriber). Inheritance invariant honored. Workflow review 0 defects + my own diff-gate. tsc 0 · vitest 2997 · reader-view-prefs lints clean.
- **DEFERRED in F#16:** the section **breadcrumb** half (still `EMPTY_SECTION_PATHS` — needs a separate ~60-line coordsAtPos section-path port, foldable into the same para-nav poll); and `editorSplit` is wired type-complete but a single-pane Reader has no real second pane — **live-check / product call** whether the split button should appear in the Reader.

## ☀️ MORNING DIGEST (PHASE Z)

**Bottom line (UPDATED — final state after the workflow-heavy resume):** **11 of 16 features fully landed + 2 substantially landed**, all merged to local `main` (no-ff, **NOT pushed**, your convention), each adversarially reviewed + verified. The first batch (Phases 0/1/2) ran with heavy inline reading; after your "run workflow-heavy" nudge I moved exploration+implementation into subagent workflows (file contents stay in subagent context; my main loop holds only plans + diffs + the merge gate) and landed F#16, F#13, F#11(core), F#14-facet, F#16-breadcrumb that way. Only the **live-SVG / network / destructive** items remain.

### Merge log (local `main`, unpushed) — newest first
| Merge sha | Features |
|---|---|
| `d73624d6` | **F#16 breadcrumb** (Reader section-path, keystroke-safe) + **F#14 facet sub-bar sort** (FACETS SSOT) — completes F#16 + F#14 |
| `ee8ed084` | **F#11 (core)** — `<BibEntryChrome>` + cohesive responsive PaperHeader pod + text page-picker; completes **F#9** |
| `1bb50490` | **F#13** — column-order SSOT + global pref + promote-defaults + drag → **DM-3 complete** |
| `cc1810df` | **F#16** — Reader inherits the editor top bar (View menu + functional back/forward) |
| `0e45eafa` | **F#14 bib-imp fold** + **F#9 list column** |
| `607e9b8b` (+`6e41d7b0`) | **F#1 + F#2 + F#3 + F#4 reader-side** (DM-1 + DM-2) |
| `e3b0744f` | **F#12 + F#6 + F#5 + F#7** (foundations) |

Plus doc commits. `git log --oneline` shows the chain. Everything **unpushed**.

### Final feature status
- ✅ **Fully landed (11):** F#1, F#2, F#3, F#5, F#6, F#7, F#9, F#12, F#13, F#14, F#16.
- ◑ **Substantially landed (2):** F#4 (reader-side layered model done; **writer-stop + destructive row-prune deferred** — supervised), F#11 (`<BibEntryChrome>` + pod + text picker done; **editor Bibliography-panel adoption assessed risky-defer**, **PDF page-picker needs F#10**).
- ⬜ **Not started (3):** F#10 (pdf.js — network + browser), F#8 + F#15 (folder tabs DM-4 — live SVG pixel work). You deprioritized these (chose "small completions").

### Verification status (whole run)
- **tsc:** 0 errors (re-checked every phase).
- **vitest:** **3046 passed / 1 skipped / 0 failed** (baseline 2983; +63 new guard tests).
- **Python:** bib-index 11/11, bib-auth-predigital 12/12, bib-parse 7/7, bib-import OK.
- **eslint:** no net-new problems.
- **Build mirrors:** `npm run build:library-bundle` re-run after every Python/skill edit.
- **prefs-coverage:** OK (incl. the new F#13 permutation guard).
- **Adversarial review:** every phase reviewed (multi-dim workflows or skeptic agents), every finding independently verified before fixing — Phase 1 caught a **CRITICAL** F#4 comment-wipe bug; F#11 caught a double-derivation; completions-A caught a breadcrumb fresh-open gap. All fixed.
- **OWED (yours): live FSA feel-checks** — I never drove a browser (your other chat holds the dev-server port). Highest-value eyeballs: taupe toggles (F#12), rail row-menus (F#5/F#7), toast ✕/hover (F#6), 2-row dashboard (F#1), folded "✓ imp" pill + open-in-tab column + facet sub-bar (F#14/F#9), fileless refs showing real auth state (F#4), the Reader top bar + breadcrumb + back/forward (F#16), column drag-reorder + resize-after-reorder (F#13), the new header pod / responsive swap / drag-to-library (F#11).

### Decisions I made on your behalf (NEEDS-GABRIEL items) — please confirm
1. **F#3 confidence model (the big design surface):** authenticate a pre-digital work when **≥2 independent sources agree on title+author** OR **one authoritative catalog agrees AND the bib publisher matches**; authoritative (OpenLibrary/Internet Archive/OpenAlex/Crossref/S2) > secondary (Google Books); per-record bar = book-title sim ≥0.85 + author-surname overlap + year within 5y. **Year gate reconciled to `<1980`** (the code's gate; docs said ~1950). Fail-closed to the `canonical` descriptor. I did **NOT** mass-re-authenticate your real `master.bib` — it ships as the (now-changed) re-runnable `/library/authenticate-bib` skill. Tune `score_predigital` in `bib_auth.py` if you want a different bar.
2. **F#4 = sources-only, but I deferred the destructive half.** The reader-side layered model is live (UI is honest on both catalog models). The **writer-stop + row-prune** (the part that actually shrinks `catalog.json` for the perf win) is NOT done — it's a coordinated multi-script Python change + a destructive prune I won't run unattended. Exact steps are in **Deferred (supervised follow-ups)** above. Confirm you want sources-only finished (and the prune is dry-run-first).
3. **F#1 dashboard** folds canonical/manuscript/unverified/failed/none all into "Non-authenticated" (strict binary). Confirm that reads right.
4. **F#12** repointed the *global* `.iconbtn-toggle`/`.topbarbtn` aria-pressed rules to the taupe family (not just the 6 segmented controls) — so every toggled-on control app-wide now reads taupe, not brown. If you only wanted the 6 library controls changed, say so and I'll narrow it.
5. **F#5 menu primitive** lives at `library/components/RowMenu.tsx`, imported cross-silo by `src/components/library/MyPapersPod.tsx` (same bridge `LibraryTabView` already uses). Confirm the location.

### Remaining work (you deprioritized — all need your live verification / a decision)
- **F#10 (pdf.js, decided Option B):** vendor pdf.js's prebuilt viewer to `public/pdfjs/` (download the matching release zip — needs network; may HARD-STOP if unavailable) + restyle + swap the iframe. Unlocks F#11's PDF page-picker. Best done where you can browser-verify.
- **F#8 + F#15 (folder tabs, DM-4):** rewrite `PanelFolderTab`/`folder-path.ts` — F#8 the clipped-stroke horizontal gutter, F#15 the SVG-flex Chrome-style compress. Whole point is a 1×/2× DPR pixel-perfect result that MUST be eyeballed — I won't ship a guessed offset.
- **F#4 writer-side** (sources-only writer-stop + the destructive row-prune) → exact steps in **Deferred (supervised follow-ups)** above; the prune is dry-run-first, supervised.
- **F#11 editor Bibliography-panel `<BibEntryChrome>` adoption** → assessed risky-defer (see Completions B); prereqs documented (the `embedded/noDrag` mode + slots). Low marginal value (single-source mostly already banked).

### Notes / gotchas for you
- **The `git add -A` incident** (Phase 1, corrected in `6e41d7b0`): I briefly swept your concurrent bug-catcher files into a commit; reverted, your content is intact (`MEMO_FOCUS_BAND_SECTION_END.md` untracked, `MEMO_BUG_BACKLOG.md` +8 unstaged — exactly as you left them). I switched to explicit `git add` after.
- Merged-but-not-deleted branches (clean whenever via `git branch -D`): `phase0-foundations`, `phase1-bibliography`, `phase2-list-table`, `phase2b-col-order`, `phase4-reader-chrome`, `phase4b-paper-header`, `phase-completions-a`. (`phase-completions-b` was empty — already dropped.)
- `bib_auth.py`'s `apply_metadata_mismatch_policy.py` writes a non-standard `bib.state="needs-reauth"` — the new bib-index reader drops it (→ "none"). Reconcile when doing the F#4 writer-side.


### Phase 1 — Bibliography subsystem — ✅ MERGED to local main `607e9b8b` (no-ff, NOT pushed)
> ⚠️ **Incident (corrected):** my `git add -A` on the review-fixes commit swept in two files from your concurrent bug-catcher session — `MEMO_FOCUS_BAND_SECTION_END.md` (new) and a `MEMO_BUG_BACKLOG.md` (+8). Corrected in `6e41d7b0`: HEAD reverts both to baseline and their content is restored to the working tree exactly as you left it (untracked / unstaged). No content lost. I've stopped using `git add -A` for the rest of the run.

Adversarial review (3 dimensions, every finding verified): 10 raw → 6 confirmed, **all fixed** (commit `598676f9`): a **CRITICAL** F#4 SSOT bug (`update_master_bib_entry` wiped the `% bib.state` comment on fields-only writebacks → would erase projected state; now preserved), IA `year` list-normalization, F#4 projection completeness on 2 more fileless surfaces (TabbedLibraryPanel project tab + PaperFileBody reader fallback — threaded `bibStateByKey`), and 2 F#2 tooltip rename misses.


Split into Tier 1 (frontend/TS, fully verified) + Tier 2 (Python F#3). The F#4 **writer-side** (stop minting reference rows + the destructive row-prune) is **DEFERRED** — see QUESTION 1 — because the reader-side already makes the UI correct/honest on *both* catalog models, and the writer-stop+prune is a coordinated multi-script behavioral change + a destructive migration I won't run unattended.

- **Tier 1** (commit `73d015bc`): F#4 reader-side layered model — `build_bib_index` projects the `% bib.state` comment into bib-index `bs` (new `iter_master_bib_states`); `bib-index.ts` → validated `stateByKey`; `useMasterBib` exposes `bibStateByKey`; `mergedEntries` fileless rows show real state (default "none", was hardcoded "unverified"); `BibStatus` gains `score?`/`note?`. F#1 dashboard 2-row redesign (`sourcesWithFile`, `nonAuthenticated`; removed Pipeline + Verified card + `verifiedTerminal`). F#2 verified→authenticated rename (chip/pill/tooltips/aria + STYLE_GUIDE + glossary + test). tsc 0 / vitest 2995 / Python bib-index 9/9.
- **Tier 2** (commit `2d6bf666`): F#3 pre-digital authentication route — `score_predigital` (pure, tested), `_internet_archive_search`, `_authenticate_predigital` (fail-closed), `_predigital_or_canonical` (Phase D extracted so it runs for cited-only refs too). canonical → route to authenticated; `<1980` reconcile. Skill + "Bib states" doc reworked. Python bib-auth-predigital 12/12 (new). NOT mass-re-authenticated on the real library (delivered as the re-runnable skill).


*(appended as each phase merges — sha, what landed, verification status)*

### Phase 0 — Foundations — ✅ MERGED to local main `e3b0744f` (no-ff, NOT pushed); branch commit `69084fa3`
- **F#12** — added `--control-selected`/`-hover`/`-tint` tokens to `:root` (outside the managed PROMOTE-DEFAULTS block); repointed the 6 segmented controls (PaperHeader ViewToggle, BibEditModal tabs, BibCard pill, library.css `.lib-viewswitch`, PrintDialog font-size, OutlinePanel Edit/Focus) + the 2 global toggle aria-pressed rules (`.iconbtn-toggle`, `.topbarbtn`). `--accent` left intact for links/CTA/checkboxes/panel-icons. Grep-verified no other solid-`--accent` selected-fill site exists.
- **F#6** — `Toaster.tsx` rewritten: per-toast `Toast` subcomponent owns its own TTL timer (kills the shared-timer cancel bug) + ✕ close + pause-on-hover with banked remainder + per-severity left-accent. `queue.ts`: `NotificationSeverity` + `NOTIFICATION_TTL_MS` (info 5s / attention 11s) + helpers. Guard test `Toaster.lifecycle.test.tsx` (5 tests).
- **F#5+F#7** — new shared `RowMenu.tsx` primitive (⋮ trigger + portaled popup + viewport-aware up/down flip + outside-click/escape + click-through suppression + declarative items). `RowActionMenu` refactored onto it (API unchanged for LeftListRow). `LibrariesNavigator`: Central row menu (Re-sync skills / Change folder…), custom row menu (Rename / Add from .bib… / Delete library), My-libraries header `+` → 2-item menu (New empty / New from .bib), standalone `AddFromBibRow` retired. `MyPapersPod`: always-visible RowMenu "Remove" replacing hover-×. `useLibraryTabs.remove()` (closes tabs in both panels → `diskLibs.remove`). `LibraryView`: `stagePickedBib` refactor + `handleAddBibToLibrary` + `handleDeleteLibrary` (confirm). Guard test `RowMenu.test.tsx` (4 tests).
- Verification: **tsc 0**, **vitest 2992 passed / 1 skipped / 0 failed** (+9 new), **no new lint** (12 OutlinePanel problems all pre-existing).
- Adversarial review (3-dimension workflow, each finding independently verified): 4 raw → 2 confirmed, both fixed: (a) AA contrast regression on the tint-path toggles → added `--control-selected-ink #6b5840` (5.6:1) for text/icon on the tint; (b) RowMenu trigger lost hover feedback → added a subtle default trigger hover (also gives the ⋮ triggers hover, an improvement). 2 dismissed as non-actionable nits.
- OWED: live FSA feel-check (Gabriel) — taupe toggle fills across the 6 controls; the rail row menus; toast ✕/hover.
