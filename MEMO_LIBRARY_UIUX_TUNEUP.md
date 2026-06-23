# Library UI/UX tune-up — handoff

**Manager session 2026-06-20 (ultracode, workflow-driven).** A wide-spread UI/UX
update + tune-up of the Virgil **Library** subsystem, 7 user asks. Understanding
workflow (7 parallel readers → synthesis) mapped every ask to code; implemented in
4 waves of chips in an isolated worktree; live-verified in the dev preview at the
234-paper dev-sample scale.

**Status:** ALL 7 SHIPPED. **MERGED to local main (no-ff `9b46e50`), NOT pushed.**
Worktree + branch removed. `tsc 0` · `eslint 172` (baseline unchanged) · **2413
tests green**. Design SSOT: [docs/memos/library-uiux-tuneup/SYNTHESIS-BRIEF.md](docs/memos/library-uiux-tuneup/SYNTHESIS-BRIEF.md)
(+ raw per-ask findings in `AGENT-FINDINGS.md` alongside).

## The 7 asks → what shipped

| # | Ask | Deep fix | Commit |
|---|-----|----------|--------|
| 1 | PDF by default | `usePaperViewMode` default `text`→`pdf` (one store fallback). Per-paper memory + DOCX→text coercion untouched. | `b55a5ea` |
| 4 | "Raw Text" (indexed) / "Virgil Text" (deep-indexed) | Thread `entry.indexed.state` → `PaperHeader` → `ViewToggle`; label `deepIndexed ? "Virgil Text" : "Raw Text"`. | `383e5d3` |
| 2a | Reader gutter clutter | Gate `TextObjectGrabHandle` placements on `editor.isEditable` (shared layer; mirrors Marginalia). Read-only reader shows zero `:::` handles. | `c34b6a2` |
| 3 | Page-number strip → lozenge | Deleted `PageScrollStrip`; new `PageScrollLozenge` = `p. N` pill near the right scrollbar, fades on scroll/idle, silent on DOCX. Collection on `docChanged` tx only (keystroke-safe). | `c34b6a2` |
| 2b | Reader "runs off the page" | **Root cause:** reader inherits EditorPane's 3-col `[dock\|page\|dock]`; the ~366px non-shrinking dock columns + 526px-min page overflowed the ~794px reader pane by ~468px. Reader-scoped CSS (`[data-virgil-library-reader]`) lets the (empty, in the common case) dock columns shrink → page centers, **overflow 468→0**. Main editor provably unaffected. | `c87652f` |
| 5 | Window/tab shapes | Tab strip + body were SIBLING containers with mismatched radius/overflow → clipped corners + flat seam. Unified into ONE rounded `overflow:hidden` wrapper; `ProjectHeader` top radii; dropped `marginBottom:-1`; strip transparent + horizontally scrollable. **Portaled** the per-tab kebab + the "+" menus so they escape the new clip. Kept the R=10 manila radius (documented). | `5a7764f` |
| 6 | "5000 documents" cap | **No cap exists anywhere** (runtime-confirmed: real lib ~4,876 bib / ~3,868 catalog / ~1,486 indexed — not 5000). The round figure was the user eyeballing ~4,876. The new dashboard shows exact, comma-formatted, distinctly-labeled counts, dissolving the confusion. No code "fix" — verification + honest surfacing. | (dashboard) |
| 7 | Central = stats dashboard, search-first | Central opens to `LibraryCentralDashboard` (library-size / bib-health / pipeline pod cards) instead of the heavy virtualized list. A prominent search box shows an inline ~40-result fuzzy palette (`searchCatalogFuzzy`) whose rows open papers — **the list never mounts until Browse**. Persistent `[Dashboard \| Browse]` switch (Central-only). `centralViewMode` global slice defaults to `dashboard`, persists the user's choice. Custom/project libraries unchanged. | `4e275eb` |

## Key product decisions (manager calls)

- **Dashboard default = `dashboard` for EVERYONE** (overrode the reader-agent's "existing users keep list" — the user explicitly asked not to default to the slow list; Browse persists their choice after first click).
- **Search = inline palette (Option B)**, not flip-to-full-list — matches the user's "search for a limited palette" and keeps the heavy list unmounted (perf goal).
- Grab-handle gated on `editor.isEditable` (no chrome flag). Fold chevrons kept. Lozenge copy `p. N`. Tab radius kept at R=10. Stats = comma-formatted integers + honest ratios.

## Architecture notes for future work

- New foundations in `library/lib/view-session-store.ts`: `usePaperViewMode` default is now `pdf`; `layout.centralViewMode` slice + `useCentralViewMode()` hook (default `dashboard`).
- New pure util `library/lib/catalog-stats.ts` (`computeCatalogStats(entries, bibByKey)`) + test — derive all dashboard counts synchronously from the in-memory catalog, no disk I/O.
- `TabbedLibraryPanel.tsx` has a `BODY-CONTENT BRANCH POINT` comment at the Central body where dashboard-vs-list branches.
- Reader fix is **reader-scoped** under `[data-virgil-library-reader]` in `library/styles/library.css`; the 366px side columns are *panel-dock* regions (marginalia markers portal into the pod, so margin-note papers are unaffected when the docks collapse).
- READER_INHERITANCE respected throughout: reader fixes live in the shared `EditorPane`/`TextObjectGrabHandle`, the `useReaderViewPrefs` shim, or reader-scoped `library.css` — never new Reader-specific render code under `library/components/`.

## OWED (user-only, FSA — cannot be driven in the dev preview)

A **production-FSA feel-check on the real ~5,000-entry Central library**:
- Dashboard counts read honestly at full scale; the search palette stays snappy.
- Central opens to the dashboard on load; `[Dashboard | Browse]` flips both ways; choice persists across reload.
- PDF-default on open; both toggle labels; centered reader column on a wide viewport; the `p. N` lozenge fades in on scroll and out when idle; no lozenge on DOCX.
- Tab geometry + the kebab/"+" menus escaping the clip on the real tab strip.
