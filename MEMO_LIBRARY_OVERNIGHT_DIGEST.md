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

## Per-phase landing log

*(appended as each phase merges — sha, what landed, verification status)*

### Phase 0 — Foundations — ✅ MERGED to local main `e3b0744f` (no-ff, NOT pushed); branch commit `69084fa3`
- **F#12** — added `--control-selected`/`-hover`/`-tint` tokens to `:root` (outside the managed PROMOTE-DEFAULTS block); repointed the 6 segmented controls (PaperHeader ViewToggle, BibEditModal tabs, BibCard pill, library.css `.lib-viewswitch`, PrintDialog font-size, OutlinePanel Edit/Focus) + the 2 global toggle aria-pressed rules (`.iconbtn-toggle`, `.topbarbtn`). `--accent` left intact for links/CTA/checkboxes/panel-icons. Grep-verified no other solid-`--accent` selected-fill site exists.
- **F#6** — `Toaster.tsx` rewritten: per-toast `Toast` subcomponent owns its own TTL timer (kills the shared-timer cancel bug) + ✕ close + pause-on-hover with banked remainder + per-severity left-accent. `queue.ts`: `NotificationSeverity` + `NOTIFICATION_TTL_MS` (info 5s / attention 11s) + helpers. Guard test `Toaster.lifecycle.test.tsx` (5 tests).
- **F#5+F#7** — new shared `RowMenu.tsx` primitive (⋮ trigger + portaled popup + viewport-aware up/down flip + outside-click/escape + click-through suppression + declarative items). `RowActionMenu` refactored onto it (API unchanged for LeftListRow). `LibrariesNavigator`: Central row menu (Re-sync skills / Change folder…), custom row menu (Rename / Add from .bib… / Delete library), My-libraries header `+` → 2-item menu (New empty / New from .bib), standalone `AddFromBibRow` retired. `MyPapersPod`: always-visible RowMenu "Remove" replacing hover-×. `useLibraryTabs.remove()` (closes tabs in both panels → `diskLibs.remove`). `LibraryView`: `stagePickedBib` refactor + `handleAddBibToLibrary` + `handleDeleteLibrary` (confirm). Guard test `RowMenu.test.tsx` (4 tests).
- Verification: **tsc 0**, **vitest 2992 passed / 1 skipped / 0 failed** (+9 new), **no new lint** (12 OutlinePanel problems all pre-existing).
- Adversarial review (3-dimension workflow, each finding independently verified): 4 raw → 2 confirmed, both fixed: (a) AA contrast regression on the tint-path toggles → added `--control-selected-ink #6b5840` (5.6:1) for text/icon on the tint; (b) RowMenu trigger lost hover feedback → added a subtle default trigger hover (also gives the ⋮ triggers hover, an improvement). 2 dismissed as non-actionable nits.
- OWED: live FSA feel-check (Gabriel) — taupe toggle fills across the 6 controls; the rail row menus; toast ✕/hover.
