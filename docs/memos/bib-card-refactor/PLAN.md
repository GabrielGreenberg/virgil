# Bib card UI/UX refactor — plan

Manager session, 2026-06-21. Worktree flow. Central principle: deep/unified, capture related phenomena.

> **Historical record, PARTLY SUPERSEDED (task 500, 2026-08-31).** Its "Reuse"
> bullet below decided to *mirror the meaning* of `StatusPill`'s
> `indexedLabel` / `indexedTone` vocabulary while rendering in "the paper-side
> chip style" — i.e. a second colour table. That is exactly what task 500
> retired: the bib-auth state and the processing tier now resolve ONE tone in
> `src/lib/library/status-tone.ts`, which every surface reads, and the paper
> side paints from the same `--pill-<tone>-{bg,fg,edge}` tokens. The LABEL
> dialects this memo introduced survive; the palette does not. See
> `src/STYLE_GUIDE.md` → *The status-pill tone family*.

## The four asks

1. **Stacking layout** — bib cards collapse at narrow width (screenshot: title vertical-truncates one char/line while the `CENTRAL | ICONICITY LIBRARY | AUTH` chip row hogs the horizontal space). Restack into **3 layers: text → libraries → status ("other")**.
2. **"Verified ✓" not "AUTH"** — relabel the bib-auth=`authenticated` chip to "✓ Verified", and move it OFF the libraries layer onto its own (status) layer.
3. **Library-status tier + open-entry link** — on the status layer, show the entry's processing tier: **Bib only / Indexed PDF / Deep-indexed PDF**, plus a **link that opens the entry in a NEW Virgil-bar tab** ("as if opened from the library").
4. **Modular open-entry** — build the "open entry" primitive shareable so it can also drop into citation cards.

## What the investigation established (firsthand + 6-agent workflow)

- **Today's composition.** `BibliographyPanel.renderCard` builds `<ProvenanceChips>` (central + custom + bib-state, all on one row) and passes it as the `libraryChip` ReactNode to `BibEntryCard`. `BibEntryCard` renders it in the header flex row (`BibEntryCard.tsx:631-682`) as a trailing `shrink-0` element next to the `flex-1 min-w-0` title → that's the narrow-width collapse.
- **The status data model is TWO orthogonal axes** (`library/lib/catalog.ts`, `library-data/.virgil/catalog.json`):
  - `indexed.state`: `none | queued | running | indexed | deepIndexed | failed` (legacy `richIndexed`→`deepIndexed`). **This is the 3-tier axis** → `none`=**Bib only**, `indexed`=**Indexed PDF (`✓ idx`)**, `deepIndexed`=**Deep-indexed PDF (`✓✓ idx`)**.
  - `bib.state`: `authenticated | unverified | manuscript | canonical | failed | none`. **This is the "Verified" axis** ("AUTH"=`authenticated`).
- **The façade currently flattens the tier.** `useLibrary.entryToItem` maps `indexed.state` → a coarse `status` (`indexed`+`deepIndexed`→`ready`), dropping the tier. `LibraryIndexItem` carries `bibState` but not the index tier → needs a small enrichment.
- **"Open as if from the library tab" = `openPaperTab(citekey)`** (`useFiles.ts:736`) → mounts `<PaperOuterView citekey>` as a dedicated outer Virgil-bar tab (`EditorLayout.tsx:4268`). `PaperFileBody` synthesizes a minimal entry from `master.bib` for **bib-only** refs, so the link renders gracefully for all three tiers.
- **The open-library plumbing exists but is dead.** `virgil-open-library` event has a wired bridge (`event-bridges/library.ts`, switches to Library tab) + a `LibraryView` listener (selects row, opens inner paper tab), but its only dispatcher `BibLibraryChip.tsx` is **unused** (zero imports). The current `CENTRAL`/`AUTH` chips are inert spans. So we are *adding* the open affordance, not changing a working one.
- **Reuse.** Library pill CSS tokens (`--pill-*`) are app-wide (globals.css imports `library/styles/library.css`). `StatusPill.tsx` has the canonical `indexedLabel`/`indexedTone` vocabulary. We mirror the *meaning* but render in the paper-side chip style (rounded Tailwind chips like the existing `CENTRAL` chip) with readable labels.
- **Citation card** (`src/panels/Citations/CitationCard.tsx`): per-row META line (the `Bib` toggle, lines 1258-1324) is the natural home for a shared open-entry link; it has the citekey but no library data today.

## Design — one unified "library entry" surface

### New shared modules (the deep seam, reusable by both cards)

1. **`src/components/icons/ExternalLinkIcon.tsx`** — domain-neutral 12px stroke-only "open in new tab" glyph (box+arrow). Style guide notes none exists.
2. **`src/components/library/open-library-entry.ts(x)`** — the open-entry primitive:
   - Owns the event contract (moved off dead `BibLibraryChip`): extend `OpenLibraryEntryDetail` with `target: "tab" | "library"` (default `"library"`).
   - `useOpenLibraryEntry()` → `{ openInTab(citekey), revealInLibrary(citekey) }` (stable, dispatches the window event — the idiomatic decoupling seam; both deeply-nested cards use it without touching `useFiles`).
   - `<OpenEntryLink citekey label? />` — small button: ExternalLinkIcon + "Open" → `openInTab`.
3. **`src/components/library/library-entry-status.tsx`** — the status-layer renderer:
   - `<LibraryStatusRow indexTier bibState citekey inLibrary />` (layer 3): a **Verified** badge (✓ Verified when authenticated; unverified/manuscript/canonical/failed keep informative labels) + an **index-tier** badge (Bib only / Indexed PDF / Deep-indexed PDF / Indexing… / Index failed) + `<OpenEntryLink>` (shown when `inLibrary`).
   - Layer 2 reuses the EXISTING `membershipChipsFor` + `<LibraryMembershipChips>` (already drops bib-state) for local/central/custom chips.

### Data enrichment

- Add `LibraryIndexTier = "bib-only" | "processing" | "indexed" | "deep-indexed" | "failed"` to `src/lib/library/library-types.ts`; add `indexTier?` to `LibraryIndexItem`; map `indexed.state`→tier in `useLibrary.entryToItem`. (Paper-side derived vocabulary — no library enum leak.)

### Bridge (route the new "tab" target)

- Extend `useLibraryBridge` to also take `openPaperTab` and route `target==="tab"` → `openPaperTab(citekey)`, else `activateLibraryOuterPane(...)`. Update the EditorLayout call site (`:433`). Gate `LibraryView`'s listener to ignore `target==="tab"` so it doesn't also open a background inner tab.

### Bib card — 3-layer header (the core visual change)

- Refactor `BibEntryCard` header (`:631-682`) from a single flex row into a **flex column**:
  - **Layer 1 (text):** drag handle + title (author·year·title), full-width, wraps naturally (no chip competing). `addAction` stays trailing on this row.
  - **Layer 2 + 3 (`headerMeta` slot):** a `flex flex-col gap-1` block below the title, `pr-14` to clear the absolute top-right cluster. Replace the `libraryChip` prop with a `headerMeta: ReactNode` prop (keeps `BibEntryCard` library-agnostic — it just stacks a meta node under the title; update the prop doc-comment). Renders in BOTH compressed and expanded states.
- `BibliographyPanel.renderCard` composes `headerMeta` = `<LibraryMembershipChips>` (layer 2) + `<LibraryStatusRow>` (layer 3) from `membershipChipsFor(...)` + `libraryByCitekey.get(key)?.indexTier`/`?.bibState`. Only renders when the entry is library-known.

### Citation card (ask 4 — realize the modular intent)

- Drop `<OpenEntryLink citekey>` into `CitationKeyRow`'s META line next to `Bib` (gated on `inLibrary`), fed by a lightweight shared `useLibraryEntryLookup()` resolver `(citekey) => { inLibrary, indexTier, bibState }`. Proves the primitive is shareable and improves the app immediately.

## Work plan (worktree, chip waves)

- **Wave A (foundation):** A1 ExternalLinkIcon · A2 open-library-entry module (event+hook+link, repoint dead BibLibraryChip) · A3 bridge routing + EditorLayout wiring + LibraryView gate · A4 LibraryIndexTier enrichment + tier/label helper.
- **Wave B (bib card):** B1 library-entry-status.tsx (LibraryStatusRow + membership row) · B2 BibEntryCard 3-layer header (`libraryChip`→`headerMeta`) · B3 BibliographyPanel compose+pass.
- **Wave C (reuse + verify):** C1 wire OpenEntryLink into CitationCard rows via shared lookup · C2 tests (tier mapping, status-row labels per tier, bridge `target:"tab"`→openPaperTab routing) · C3 live-verify in dev preview (force-dev-storage + doc_devtest, the asher2003 card has CENTRAL+library+auth) and update STYLE_GUIDE (stacked meta layout, external-link icon, status-chip vocabulary).

## Gates / non-goals

- Keystroke-sane (panel render, library-revision gated; O(1) per-citekey map reads). No new persistence (status derived, link is an action).
- Verify `tsc` + vitest + eslint(no-new) green; live feel-check owed to user (production FSA at scale).
- Non-goal: changing the catalog/skill pipeline, library inner-tab behavior, or the bib editor/annotation flows.

## Open assumption (stated, not blocking)

"Open a new tab (as if from the library tab)" = `openPaperTab` → dedicated `PaperOuterView` reader tab (NOT switching to the Library tab + selecting). High confidence from "new tab" + "as if from the library." User can redirect at approval.
