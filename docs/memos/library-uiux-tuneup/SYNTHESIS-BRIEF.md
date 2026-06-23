All findings verified against live code. The key structural facts hold: the body container (with `borderRadius: 10`) is a sibling of the tab strip at line 432, the Central branch always renders LeftList at line 489, READER_CHROME has no grab-handle gate, and `IndexedState` lacks `richIndexed` in the enum (it's a separate `LegacyIndexedState` type — Finding 1's claim that the union includes `richIndexed` is wrong; the legacy normalization is a read-path concern). Now writing the brief.

---

# Virgil Library UI Tune-Up — Consolidated Implementation Brief

**Status:** Single source of truth for the manager. 7 asks across 6 implementation areas. All file/line claims below verified against `HEAD` (main @ `6f4c1c6`) on 2026-06-20. Where a reader finding was wrong, the correction is flagged inline with **[CORRECTION]**.

---

## 1. Shared foundations

These land first; later work imports them.

### F-A. Catalog status field (used by ASK 4 labels + ASK 7 dashboard stats)

The authoritative discriminator is `entry.indexed.state: IndexedState`, defined in `library/lib/catalog.ts:7-13`:

```ts
type IndexedState = "none" | "queued" | "running" | "indexed" | "deepIndexed" | "failed";
```

- **[CORRECTION to Finding 1]** `richIndexed` is **not** a member of `IndexedState`. It's a *separate* `LegacyIndexedState = "richIndexed"` type (catalog.ts:17), normalized to `"deepIndexed"` only on the read path. Any new code branching on state must compare against `"deepIndexed"` — never `"richIndexed"`. Do not import `LegacyIndexedState` into UI code.
- Bib auth lives in `entry.bib.state: BibAuthState` (catalog.ts:19-25): `"none" | "unverified" | "authenticated" | "manuscript" | "canonical" | "failed"`. Used by ASK 7 stats (verified = authenticated/manuscript/canonical; needs-action = failed/unverified).
- PDF presence: `entry.pdf.present` + `entry.pdf.format` (`"pdf" | "docx" | "tex"`) + `entry.pdf.alternates[]` (catalog.ts:29-41). The `hasPdfSource()` helper already encodes the DOCX-with-PDF-alternate logic (RightDetail.tsx:30-35) — **reuse it, do not re-derive**.

### F-B. View-session-store extensions (used by ASK 1 default, ASK 7 dashboard mode)

`library/lib/view-session-store.ts`:
- `usePaperViewMode` (lines 779-800) reads `readListView(...).viewMode ?? "text"` at **line 791**. ASK 1 flips this fallback. Per-paper persistence under `paper:<citekey>` slice is sound — do not touch the persistence mechanics.
- `useLayoutPrefs` / `useLayoutPrefs().layout` (lines 802-809) is the **global** slice. ASK 7's `centralViewMode` belongs here (global), not in the per-libId `ListView` slice.

### F-C. READER_CHROME (used by ASK 2 grab-handle gate, ASK 3 lozenge gating)

`src/components/editor-layout/chrome-config.ts:96-110`. The Reader passes `editable={false}` + this preset. There is **no** flag controlling gutter affordances today. **Decision (see §4 D-2): do NOT add a chrome flag for the grab handle** — gate on `editor.isEditable` in the shared component, mirroring the Marginalia precedent. READER_CHROME stays as-is unless ASK 2 phase-3 (chevron suppression) is approved, which is CSS-only and needs no flag.

### F-D. library.css tokens + the tab-strip/body structure (used by ASK 3 lozenge CSS, ASK 4 tab fix, ASK 7 dashboard)

`library/styles/library.css` + `src/app/globals.css` are the only places colors may originate. All new Library UI routes through CSS vars (`--surface`, `--pod-border`, `--pod-radius`, `--pod-shadow`, `--pill-{tone}-{bg,fg}`, `--accent`, `--ink-*`, `--edge-*`). **No hex literals in components.** Status badges use the 5-tone pill family (`StatusPill.tsx` is canonical). In-card type is two-tier only: META 10px mono / CONTENT 12px.

**Structural fact for ASK 4** (verified TabbedLibraryPanel.tsx:431-447): the rounded body container (`borderRadius: 10`, `border: 1px solid var(--topbar-border)`, `overflow: hidden`) is a **sibling** of `PanelTabStrip`, not a wrapper around it. This is the root cause of the tab/body clipping mismatch.

---

## 2. Per-ask plan

Asks are grouped into the chips that should ship together.

---

### GROUP 1 — Paper detail header (ASK 1 + ASK 4): PDF default + dynamic Text labels

**Why grouped:** both edit `RightDetail.tsx` + `PaperHeader.tsx` and would collide if split.

**Deep fix.** Flip the never-toggled default from `"text"` to `"pdf"` at the single store fallback, leaving per-paper persistence and the DOCX coercion effect untouched — a freshly-viewed paper opens to PDF, a paper the user explicitly switched to Text stays Text, and a DOCX-only paper is immediately coerced back to text by the existing effect (RightDetail.tsx:73-75) so it never strands on a disabled PDF button. For labels, thread `entry.indexed.state` from RightDetail through PaperHeader into `ViewToggle`, then compute the Text button label as `"Virgil Text"` when `state === "deepIndexed"` else `"Raw Text"`; the PDF button label is unchanged.

**Files / lines:**
1. `library/lib/view-session-store.ts:791` — `?? "text"` → `?? "pdf"`. (One-line; this is the entire ASK 1 behavior change.)
2. `library/components/RightDetail.tsx` — pass `indexedState={entry.indexed.state}` to `PaperHeader` at **both** call sites: the PDF branch (~line 112) **and** the text branch (~line 152). **[CORRECTION to Finding 1, which named only one site.]**
3. `library/components/PaperHeader.tsx` — add `indexedState: IndexedState` to the Props interface (import `IndexedState` from `@library/lib/catalog`); pass it to `<ViewToggle>`; add it to the `ViewToggle` destructure + type (lines 507-515); compute the Text label at line 527: `label={indexedState === "deepIndexed" ? "Virgil Text" : "Raw Text"}`. Line 531 (PDF) unchanged.

**Related phenomena folded in:** Legacy `richIndexed` rows are normalized to `deepIndexed` on read (F-A), so the label check works for old catalogs without special-casing. DOCX coercion is already independent of the default and needs no change. Papers in `queued`/`running`/`failed` either don't render the toggle meaningfully or get `"Raw Text"` — acceptable (see D-1).

---

### GROUP 2 — Reader render (ASK 2 + ASK 3): gutter cleanup + page lozenge

**Why grouped:** both touch the Reader render path; ASK 3 removes `PageScrollStrip` (mounted via `PaperRender.tsx` `leftGutterPrelude`), and ASK 2's gutter analysis covers the same left-gutter real estate. Coordinating them avoids two passes over `PaperRender.tsx`.

#### ASK 2 — Reader gutter / overflow

**Deep fix.** The grab handle (`TextObjectGrabHandle.tsx`) renders its `:::` dots in the left gutter unconditionally because its placement scheduler never checks `editor.isEditable` — unlike `Marginalia.tsx:144`, which already gates drag on editability. Add the same early-return gate in the grab-handle scheduler so a read-only Reader produces zero placements, removing the clutter. Separately, give the Reader prose a bounded, centered column (`max-width: var(--page-preferred, 880px); margin: 0 auto`) so wide viewports don't sprawl and the dual-padding asymmetry stops narrowing the column.

**Files / lines:**
1. `src/text-objects/TextObjectGrabHandle.tsx` (~line 746, inside `schedule()` before `resolveActiveRefs`): add
   ```ts
   if (!editor.isEditable) { setPlacements((p) => (p.length === 0 ? p : [])); return; }
   ```
   This is **shared-layer** (per READER_INHERITANCE.md, the correct location) and O(1) per call — no keystroke-sanctity concern.
2. `library/styles/library.css` — add `[data-virgil-library-reader] .paper-render .tiptap { max-width: var(--page-preferred, 880px); margin: 0 auto; }`. Set max-width to `--page-preferred` (≈880px) so normal laptops are unaffected; only very wide viewports reflow.
3. **Optional, deferred (D-3):** fold-chevron suppression in the Reader — CSS-only, `[data-virgil-library-reader] .heading-fold-chevron { display: none; }`. Default recommendation: **keep chevrons** (read-only-safe navigation aid).

**Related phenomena:** After the gate, paragraph/heading floats in the Reader lose their grab-handle drag entry point — correct, since floats are dormant in the Reader anyway (Reader passes no `viewPrefs`). Text selection/copy is unaffected (the gate only suppresses lift-to-popout handles, not selection).

#### ASK 3 — Replace page strip with scroll lozenge

**Deep fix.** Delete `PageScrollStrip.tsx` (the 24px sticky rail) and replace it with a small `PageScrollLozenge` pinned near the scrollbar that fades in on scroll and out after ~1s idle, showing `p. N` for the current page. Reuse the existing pgmark data source and the RAF-coalesced scroll tracking already in `PaperRender.tsx` — collect pages only on `editor.on("transaction")`/`"create"` (never per-keystroke DOM walks), compute `currentIdx` on scroll, and drop all the strip's density-thinning/label-distribution logic. DOCX/tex papers have no `\pgmark{N}`, so `pages.length === 0` → render nothing.

**Files / lines:**
1. **Delete** `library/components/PageScrollStrip.tsx`.
2. **Create** `library/components/PageScrollLozenge.tsx` (~120 lines), same `{ editor, scrollContainer }` signature so `PaperRender.tsx` wiring barely changes. Page collection on `transaction`/`create` only; `currentIdx` on scroll; fade pattern copied from `editor-scrollbar.tsx` (scheduleFade ~1s); return `null` when `pages.length === 0`.
3. `library/components/PaperRender.tsx` — swap the `leftGutterPrelude` `<PageScrollStrip />` for `<PageScrollLozenge />` (or mount as an absolutely-positioned sibling of the editor column near the right scrollbar — see D-4). Reuse the existing scroll RAF; do not add a second scroll listener.
4. `library/styles/library.css` — lozenge pill: `position: absolute; right: 12px; padding: 6px 12px; border-radius: 20px; background: var(--surface-muted); border: 1px solid var(--edge-subtle); color: var(--ink-muted); font: 11px var(--font-mono); opacity: 0; transition: opacity 0.3s; z-index: 10; pointer-events: none;` + `.visible { opacity: 1 }`.

**Related phenomena:** pgmark decorations remain in the DOM for marginalia binning — removing the strip is a navigation-widget change only, no data path touched. Keystroke sanctity preserved (collection is on structural transactions, not keystrokes; scroll is RAF-coalesced).

---

### GROUP 3 — Inner tab strip + catalog header shape (ASK 5)

> **[Numbering note]** The orchestrator labeled this "Finding 4" but the underlying ask is the tab-strip/header geometry. Treating it as its own chip.

**Deep fix.** The tab strip and the rounded body live in separate flex containers with mismatched `overflow`/`border-radius`, so the SVG "manila folder" tabs (corner radius `R=10`, swoop `S=12`) visually spill into the body's top corners and the catalog `ProjectHeader` reads as a flat seam. Wrap the tab strip + body in a single container that owns the `borderRadius: 10` + `border` + `overflow: hidden`, move that styling off the body div, give `ProjectHeader` matching `borderTopLeftRadius`/`borderTopRightRadius`, and remove the ambiguous `marginBottom: -1` on the active tab so the body's top border draws the seam cleanly.

**Files / lines:**
1. `library/components/TabbedLibraryPanel.tsx:431-508` — introduce the unifying wrapper; move `borderRadius`/`border`/`overflow` from the body div (line 432-447) onto it; body keeps `flex:1; minHeight:0` only.
2. `library/components/TabbedLibraryPanel.tsx:558-616` — `ProjectHeader`: add top corner radii; drop or flatten the `borderBottom` seam.
3. `library/components/panel-tabs/PanelFolderTab.tsx:83` — remove `marginBottom: -1`; verify SVG `height` accounts for the body's 1px top border.
4. `library/components/panel-tabs/PanelTabStrip.tsx:331-347` — confirm tab width `2*S + tabW` doesn't overhang the wrapper's padding.

**Related phenomena / risk:** If the new wrapper gains `overflow: hidden`, the per-tab `⋮` menu (`TabMenuPopup`, absolutely positioned `top: 100%`) will clip. **Coordinate with the popout convention:** render that menu via `createPortal` (per STYLE_GUIDE.md) so it escapes the clip. Paper-kind tabs use `fill={var(--background)}` to merge with the editor canvas — keep that, but set the wrapper background to `var(--surface)` (already the case for non-paper kinds at line 441) so the seam reads cleanly.

---

### ASK 6 — "5000 documents" cap investigation

**Finding: there is no cap.** The entire path — `catalog.ts:readCatalog` → `catalog-store.ts` → `useCatalog` → `TabbedLibraryPanel.visibleEntries` (Central returns `entries` unfiltered, line 490) → `LeftList` (virtualized via `computeListWindow`, search limit defaults to `Infinity`) — and the Python side (`_tools.py`, `index_paper.py`) contain zero slicing, pagination, or 5000-entry truncation. `PARSE_CACHE_MAX=4` (bib-parser.ts) is a parse-result LRU, not an entry limit. The only cap in the codebase is the 200-entry notification inbox ring buffer.

**Action: confirm, don't fix.** Have the user run, against the live library folder:
```bash
jq '.entries | length' ~/Virgil-Library/.virgil/catalog.json
```
If it returns exactly `5000`, the file on disk is the source (a skill/extraction issue, out of scope for UI). If it returns a non-round number (e.g. 5247), the round figure was a coincidental display/estimate and there is nothing to fix. **No code change is part of this brief.** This finding also de-risks ASK 7 (dashboard stats scan the full uncapped array).

---

### ASK 7 — Central library dashboard as default view

**Deep fix.** Add a global `centralViewMode: "dashboard" | "list"` to the view-session `layout` slice with a `useCentralViewMode()` hook, branch `TabbedLibraryPanel`'s Central body (the `isCentral && centralViewMode === "dashboard"` case at line 489) to mount a new `<LibraryCentralDashboard />` instead of `LeftList`, and give the dashboard a "Browse" button (`setMode("list")`) plus a search input that flips to list mode with the query pre-populated. All stats derive synchronously from the in-memory `mergedEntries` array (LibraryView.tsx:403-469) via a pure `computeStats(entries, bibByKey)` util — no disk I/O. The dashboard and the list coexist under the same tab as conditional renders, so toggling never loses the per-libId query/sort/scroll state that `LeftList` reads from its own slice.

**Files / lines:**
1. `library/lib/view-session-store.ts` — extend the `layout` schema (~lines 802-809 region / the `LibraryViewSession["layout"]` type) with `centralViewMode?: "dashboard" | "list"`; add `useCentralViewMode()` (read via `useLayoutPrefs().layout.centralViewMode`, write via `setLayout`). **Migration (D-5): absent value resolves to `"list"`** on first load for existing users; new sessions seed `"dashboard"`.
2. **Create** `library/lib/catalog-stats.ts` — pure `computeStats()` returning counts (totalBibs, totalPapers, indexed, deepIndexed, indexed-or-deep, authenticated/verified, needsAction, unsorted).
3. **Create** `library/components/LibraryCentralDashboard.tsx` — stat cards (pod surface + pills, two-tier type), "Browse" button, search input. MVP search = flip to list + pre-fill query (Option A).
4. `library/components/TabbedLibraryPanel.tsx:489` — branch on `isCentral(activeLibrary.id) && centralViewMode === "dashboard"`.

**Related phenomena:** unsorted count comes from `mergedEntries.filter(e => !e.citekey)` (the same array the panel already passes down — don't re-scan). Custom/project libraries are **out of scope** (Central only, D — narrow MVP). Search promotion to dashboard level is Option A (sync mode flip), not an overlay.

---

## 3. Cross-ask coherence risks

Files touched by more than one chip, and how to serialize:

| File | Chips | Conflict | Coordination |
|---|---|---|---|
| `RightDetail.tsx` | GROUP 1 only | ASK 1 + ASK 4 both edit it, but they're one chip | None — do them together. |
| `PaperHeader.tsx` | GROUP 1 only | same | Single chip. |
| `PaperRender.tsx` | GROUP 2 (ASK 2 + ASK 3) | ASK 3 swaps `leftGutterPrelude`; ASK 2 may touch reader CSS hooks | One chip owns PaperRender. ASK 2's only PaperRender-adjacent change is CSS in library.css; the grab-handle gate is in `TextObjectGrabHandle.tsx` (no PaperRender edit). Low collision. |
| `library/styles/library.css` | GROUP 2 (ASK 2 max-width + ASK 3 lozenge) **and** GROUP 3 (ASK 5 tab CSS) **and** ASK 7 (dashboard cards) | Three chips append rules to the same file | **Append-only, distinct selectors** — no shared rule is edited. Land in wave order; trivial textual merges. Keep each chip's additions in a labeled section block. |
| `TabbedLibraryPanel.tsx` | GROUP 3 (lines 431-508 wrapper) **and** ASK 7 (line 489 Central branch) | Both edit the body-render region; the wrapper restructure changes the exact node ASK 7 branches inside | **Serialize: GROUP 3 before ASK 7.** ASK 7's Central branch lives *inside* the body that GROUP 3 re-wraps, so doing the wrapper first gives ASK 7 a stable insertion point. |
| `view-session-store.ts` | GROUP 1 (line 791 default) **and** ASK 7 (layout schema + hook) | Different functions in the same file | No logical conflict; distinct regions. Either order; trivial merge. |
| `LibraryView.tsx` | ASK 7 only (reads `mergedEntries`) | — | Read-only consumption; no edit needed. |
| `TextObjectGrabHandle.tsx` | GROUP 2 only | shared-layer file | Single chip; verify the full ~2397 suite (it's editor-core). |

**Worktree strategy:** one worktree per group, branched off `main` (`6f4c1c6`). Merge order forced by the table: **GROUP 1, GROUP 2, ASK 6 (no-op/verify), GROUP 3, then ASK 7 last** (depends on GROUP 3's `TabbedLibraryPanel` restructure). `library.css` is append-only across groups so its merges are clean regardless of order. Per house rules: branch off main, commit only in worktrees, do not push, end commit messages with the Co-Authored-By trailer.

---

## 4. Product decisions for the manager

Each has a recommended default — rubber-stamp or override.

- **D-1 (ASK 4 label mapping).** Text button = `"Virgil Text"` iff `indexed.state === "deepIndexed"`, else `"Raw Text"`. **Recommend: ship as-is.** Papers in `queued`/`running`/`failed` show `"Raw Text"`; this is only visible when the toggle is interactive (post-index), so it's cosmetically harmless. Do **not** add tooltips in v1 (the `✓ idx` / `✓✓ idx` status pill already teaches the distinction).
- **D-2 (ASK 2 grab-handle gate location).** **Recommend: gate on `editor.isEditable` in `TextObjectGrabHandle.tsx`** (mirrors Marginalia). Do **not** add a `showGrabHandles` chrome flag — implicit read-only behavior is cleaner and a future Reader that wants handles just passes `editable={true}`.
- **D-3 (ASK 2 fold chevrons in Reader).** **Recommend: keep them** (read-only-safe navigation). The optional `display:none` rule is available if the user wants a fully bare gutter — leave it commented/deferred.
- **D-4 (ASK 3 lozenge placement + copy).** **Recommend: `p. N`** (short, Kindle-style), pinned `right: 12px` near the scrollbar, ~1s idle fade, silent on DOCX (no "no page info" placeholder). On touch overlay-scrollbar platforms, bump to `right: 24px` if it collides.
- **D-5 (ASK 7 dashboard default + migration).** **Recommend: new sessions default to `"dashboard"`; existing users (absent `centralViewMode`) default to `"list"`** to avoid surprising them with an unfamiliar view, with a one-shot "Try the new dashboard" affordance later. Central-only; custom/project libraries stay list-only in v1.
- **D-6 (ASK 7 search interaction).** **Recommend: Option A** — dashboard search flips to list mode and pre-fills the query (no live overlay). Simpler, discoverable, no overlay focus-trap plumbing.
- **D-7 (ASK 7 stat presentation).** **Recommend: raw integers** in pill/card form for v1; defer progress rings/percentages.
- **D-8 (ASK 5 tab corner radius token).** **Recommend: keep the Library-specific `R=10`** (intentional manila aesthetic, distinct from the global `--pod-radius: 8`); add a comment in `PanelFolderTab.tsx` documenting the deliberate divergence rather than unifying to 8px.
- **D-9 (ASK 6).** **Recommend: confirm via the `jq` one-liner, ship no code.** If the on-disk count is exactly 5000, escalate to the extraction/skill side as a separate investigation — out of scope here.

---

## 5. Recommended implementation waves

**Wave 0 — Foundations (sequential, fast):**
- `view-session-store.ts:791` default flip (ASK 1) + `layout.centralViewMode` schema + `useCentralViewMode` (ASK 7 scaffold). Both in one file, distinct regions. Land first so GROUP 1 and ASK 7 build on them.

**Wave 1 — Parallel (independent files, no overlap):**
- **GROUP 1** (RightDetail + PaperHeader) — ASK 1 default already in via Wave 0; this chip adds the label threading. Self-contained.
- **GROUP 2 / ASK 2** (TextObjectGrabHandle gate + library.css max-width). Touches a shared-layer editor file — run the full suite.
- **GROUP 2 / ASK 3** (delete PageScrollStrip, create PageScrollLozenge, PaperRender swap, library.css lozenge rules). Mostly new files.
- **ASK 6** (verification only — the `jq` check; no code).

  *GROUP 2's two sub-chips (ASK 2, ASK 3) can run as one worktree since they share `PaperRender.tsx` + `library.css`; safer to keep them in a single agent.*

**Wave 2 — Tab geometry (serializes ASK 7):**
- **GROUP 3 / ASK 5** (TabbedLibraryPanel wrapper restructure + PanelFolderTab + PanelTabStrip + ProjectHeader + portal for the tab menu). Must land before ASK 7.

**Wave 3 — Dashboard:**
- **ASK 7** (catalog-stats.ts, LibraryCentralDashboard.tsx, TabbedLibraryPanel:489 branch). Depends on Wave 0 (hook) + Wave 2 (stable body node).

**Serialization drivers:** `TabbedLibraryPanel.tsx` forces GROUP 3 → ASK 7. `library.css` is append-only so it never blocks parallelism. Everything in Wave 1 is mutually independent.

---

## 6. Verification plan

**Static gates (every chip):**
- `tsc` clean.
- `eslint` — **no new errors above the 172 baseline** (Library-audit memo confirms 172 as the accepted baseline).
- Full suite green (~2397 tests; run `--maxWorkers=4`). The `TextObjectGrabHandle` change (ASK 2) is editor-core — treat a green full suite as mandatory, not optional.

**Per-ask dev-preview checks** (load `virgil-data/doc_devtest`; preview can't use the FSA picker — refresh the dev doc from `samples/annotation-history` if choppy):

- **ASK 1:** Open a never-toggled paper → lands on **PDF**. Switch to Text, navigate away and back → restores **Text**. Open a DOCX-only entry → coerces to text, PDF button disabled (not stranded).
- **ASK 4:** A `deepIndexed` paper shows **"Virgil Text"**; an `indexed`-only paper shows **"Raw Text"**; PDF button always **"PDF"**. Verify at *both* RightDetail call sites (PDF-mode header and Text-mode header).
- **ASK 2:** In the Reader, the `:::` grab-handle dots are **gone** from the left gutter; text selection + copy still work; prose column is centered/bounded on a wide viewport. Confirm `__virgilBusStats().emitCount` stays flat while typing in the (editable) main editor — the gate must not regress keystroke sanctity.
- **ASK 3:** Scroll the Reader → lozenge fades in showing `p. N`, fades after idle; DOCX paper shows **no** lozenge; the old 24px strip is gone. Verify pgmark collection fires only on transaction/create (not per keystroke).
- **ASK 5:** Tab rounded corners no longer clip into the body; catalog `ProjectHeader` ("18 entries…", "Cited only") top corners align with the body frame; the per-tab `⋮` menu opens without being clipped (portal).
- **ASK 6:** `jq '.entries | length'` against the live catalog — record the number for the user.
- **ASK 7:** Central opens to the **dashboard** (new session) with correct counts; "Browse" → list; search → list with query pre-filled; existing-user session still opens to **list**. Counts match a manual scan of `mergedEntries`.

**Regression guards to watch specifically:**
- View-prefs round-trip / persistence tests (the ASK 1 default flip and ASK 7 schema addition touch `view-session-store`).
- Any `TextObjectGrabHandle` / text-object placement tests (ASK 2).
- Catalog/bib-parser tests (untouched by design — green confirms ASK 6's no-cap conclusion).
- The keystroke-sanctity invariant: no new `editor.on('update'|'transaction')` subscriber is added by any chip (the grab-handle gate is inside the existing scheduler; the lozenge subscribes to structural transactions only, RAF-coalesced).

**Owed to the user (manual, FSA-only — cannot be done in preview):** production-FSA walk of the Library Reader (grab-handle absence, lozenge fade, tab geometry) and the dashboard with a real ~5000-entry Central catalog, plus the `jq` count confirmation for ASK 6.