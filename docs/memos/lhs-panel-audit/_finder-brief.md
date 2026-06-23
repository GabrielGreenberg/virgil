# LHS Panel Audit — Finder Brief (cold-start, authoritative)

You are one finder agent in a QA audit of Virgil's LEFT-hand side panels. The audit **only FINDS and LOGS bugs — it never fixes anything and never edits source**. Read source READ-ONLY. The only file you write is your findings JSON (path given in your task).

Virgil is a browser-based visual LaTeX editor (Next.js, fully client-side, File System Access + IndexedDB). It renders `.tex` meaningfully while preserving source; card metadata lives in JSON sidecars under the paper's `virgil/` folder.

## Your job
You own ONE (subject × group) slice. For every function-cluster your group owns, trace the actual code, reason adversarially about edge cases and the realistic things a human user hits, and produce findings. For every matrix cell your group owns, emit a status (PASS / BUG / N-A / UNVERIFIED). **Method is deep CODE analysis** (read the code, trace data flow, find the deepest root cause). You have no live preview; if a cell genuinely cannot be resolved by reading code, mark it UNVERIFIED with the reason — never guess PASS.

Diagnose at the DEEPEST level. A finding's value is its root cause and its *class* (other places the same defect lives), not the surface symptom. When you spot a defect, ask: "what general mistake is this, and where else is that mistake made?" List suspected siblings.

---

## Subjects (rows) and their file maps

### S1 footnotes — `src/panels/Footnotes/` (FootnotePanel.tsx, FootnoteCard.tsx, omni.tsx), hook `src/hooks/useFootnotes.ts`
Card kind `footnote` = inline atom in `\footnote{}`. NO gutter marker (text→card is atom-click only). Functions: edit body (RichTextField), bodyTitle, "acknowledgement"/thanks badge "A", auto-renumber on move (number from editor via syncFromEditor), jump-to-atom (`scrollToFootnote`), orphaned-footnote card (`FootnoteCard.tsx:177-247`, NO jump), drag inline-atom (MIME_FOOTNOTE, ghost truncates body at 80), citations-in-body, keyboard cycle ↑/↓, clone (`useFootnotes.ts:106-119`), AI-request inbox (filters `r.kind==="footnote"`), delete/delete-orphan. Orphans listed BEFORE anchored (`FootnotePanel.tsx:114-121`).

### S2 citations — `src/panels/Citations/` (CitationsPanel.tsx, CitationCard.tsx, CitekeyPicker.tsx, omni.tsx), hook `src/hooks/useCitations.ts`
Card kind `citation` = inline atom keyed to `.bib`. NO gutter marker (atom-click only). Functions: order by `citationOrder` (unknown ids sort last), draft/pending-create card, CitekeyPicker (paper bib + library, raw free-text citekey), multi-key rows add/remove, cite-type select `\citet/\citep/\citeauthor/\citeyear` (natbib vs biblatex), `*` full-author / `Aa` capitalize, per-key postnote/prenote, biblatex singular→plural auto-promote (`:377-388`, NO demote), raw "Code" edit (250ms debounce), Preview (sanitized HTML), missing-entry error ("— not in your bibliography" `:1155-1160`), inline BibEntryCard ("Bib" toggle), drag (MIME_CITATION) + drop-merge bibkey, unanchored dashed styling, jump-to-atom (anchored-only), copy citekey, package/style menu, AI-request inbox, bib-review request routed through card, delete. **Editor regenerates citation ids on every parse** (`useCitations.ts:352-374`).

### S3 bibliography — `src/panels/Bibliography/BibliographyPanel.tsx` + SHARED `src/components/BibEntryCard.tsx` (NO BibEntryCard.tsx in folder, NO omni.tsx). `omniEligible: false` (`panel-registry.ts:83`). Hook reads `.bib`; `src/hooks/useBibReview.ts`, `useCitations.ts`.
Card kind `bib` = unanchored, from `.bib`. Functions: Cited-only vs Full filter, sort by author (localeCompare), view/edit fields incl @type+key (warns "modifies .bib"), request field/annotation review (writes `bib-review-requests.json`, 10s poll while pending), annotations (contentEditable + execCommand, 400ms debounce), CSL preview (`formatBibliography(entry, style)`), citation count + occurrence cycling (prev/next, `keyOccurrenceIdx`), jump to first citation (cited-only), local/library search, add-from-library + conflict strip (replace/keep/new-citekey/request-merge), request-entry free-text, export cited.bib (Blob), rename citekey propagates to citations (regex word-boundary), drag bib→editor (`\cite{}`), provenance chips, keyboard nav (skips inputs). **N/A: omni, morph, gutter marker, AI-request inbox section.**

### S4 reports — `src/panels/Reports/` (ReportsPanel.tsx, ReportCard.tsx, ReportRequestCard.tsx, omni.tsx), hook `src/hooks/useReports.ts`, morph `src/cards/morphs/index.ts`
Polymorphic `report` (author byline human/ai) + `report-request`. HAS gutter marker (report markerType). Functions: list sorted by createdAt, Add Report / Add Report-Request, edit title/author/body (report) or body (request), **morph report↔report-request (LOSSY: report→request drops title+author & sets aiRequest:false `index.ts:136-148`; request→report drops aiRequest `:151-160`)**, AI-request flag (request only, bridges via bridgeCardAiRequestFlag), jump (linked-only), orphan listener clears dead anchorId (`useReports.ts:407-416`), multi-paragraph anchors → multiple omni rows (`@0`/`@1`), delete, popout/float-key remap on morph (`convertCardWithRemap`), clone, legacy "Report N" auto-title stripped on load (`:57-60`).

### S5 examples — `src/panels/Examples/` (ExamplesPanel.tsx, ExampleCard.tsx, omni.tsx), hook `src/hooks/useExamples.ts`
Card kind `example` = **DERIVED from `exampleBlock` nodes** (sidecar stores ONLY title+createdAt). Functions: live expex editor in card body (editable, mounts `buildEditorExtensions({surface:"float"})`), read-only `BorrowedMainText` fallback (no editor context), collapsed preview = read-only clamped expex editor (N editors mounted when N collapsed, #43), write-back to main doc (FLOAT_WRITE_META), re-seed on `rev.examples`/`contentRev` only (NOT per-keystroke), jump to block (`scrollToExample`), orphaned example (block gone → pos==null), read-only gate on partner-claimed doc, help popover, number `(N)` + sub-labels from node attrs, title edit (sidecar), delete (metadata only). **N/A: morph, AI-request flag, bibkey, CSL, drag-atom.**

### S6 outline — `src/panels/Outline/OutlinePanel.tsx` (structural, NO card)
Functions: heading tree (view mode) indent by level, fold/collapse + persisted prefs (`loadOutlinePrefs`/`saveOutlinePrefs`), inline heading rename (edit-mode pods), inline parTitle rename, inline label edit + conflict warning (`isTaken`), drag-reorder blocks (above/below, blocks self-drop), navigate/jump (scrollTo), focus mode activate/deactivate/lock, focus move/expand (click/shift-click), focus band drag handles (snap to row), position lozenge (reader position; split-pane mirror), section word counts, show numbers/labels/titles/wordcount/position toggles. **N/A: card kind, selection halo, omni, popout, delete-confirm, A1/A2/A3, F4, F6.**

### S7 search — `src/panels/Search/SearchPanel.tsx` (structural, NO card)
Functions: full-text mainText search (regex, PM-pos mapping with manual `textOffset += 1` per textblock boundary), scope toggles (primary chips + "More" dropdown), multi-scope (footnotes/notes/citations/todos/archive/cuts/revisions/bib), case-sensitive (Aa)/whole-word (W), breadcrumb context, result navigation ↑/↓/Enter (wraps), open item in target panel (`onOpenItem`), highlight range (`onHighlightRange`), unanchored results (no breadcrumb), result count, per-scope themed border. Results memoized on `editor` identity → **stale positions when doc edited after search**. **N/A: card kind, selection halo (own selectedIdx), omni, popout, A1/A2/A3, F4, F6.**

### S8 omni-left — `src/components/editor-layout/panels/omni-host.tsx`, `src/panels/Omni/OmniViewPanel.tsx`, each card panel's `omni.tsx`
The left Omni column aggregates left card panels (footnote/citation/report/example builders). Functions: aggregation, filter menu toggle category per side (`OmniFilterMenu`), "Default view" reset, category resolution from item id (`categoryOf`, parses `float:card:<kind>:<id>`), anchored cascade (in-text positions, transform-Y), unanchored bin (free + orphaned, `OmniUnanchoredBin`), "N outside focus" bin (`OmniOutsideFocusBin`, stamped at `topPx:30` hardcoded), fold filter (drops cards in collapsed sections), pin-on-touch / marker-click pin (`omniPinStore.requestPin`), card-identity match with docked (same cardKey → same halo), hide-all toggle, single-selection enforcement, panel reorder moves category between strips (`deriveCategorySides`), live pos resolve for footnote/citation/example (`resolvePos`).

---

## Shared card infrastructure (read for your cluster)
- `src/components/panel-primitives.tsx` — `EditableCard` props enumerate F1/F4/F5/F6/F7 affordances.
- `src/cards/card-registry.tsx`, `src/cards/types.ts` — card kinds, markerType, poppable.
- `src/cards/predicates.ts` — `isInlineAtomCardKind` (footnote/citation), markerType assertions (`:97-113`).
- `src/cards/marker-meta.ts` — MARKER_TYPES (note/highlight/todo/report/cut/revision/archive). Footnote/citation/bib/example have markerType null.
- `src/cards/has-content.ts` — `cardHasContent` for delete-confirm. **Has NO case for footnote/citation/example/bib** (`:22-32,50-89`).
- `src/links/links.ts` — `jumpToCard`/`jumpToLink`, `reanchorByText`, `isUnanchored`, `deleteLink`, link ops. Spine for F3/F7/A1/A2.
- `src/links/_shared/anchored-card-store.ts` — module-scope cardStore keyed by `{kind,id}` (NOT surface): `selected` (≤1 halo), `expandedSet` (multi). select/expand/onHeaderActivate/onActivate. Selection ⟂ Expansion are independent axes.
- `src/links/_shared/useAnchorHighlightReconciler.ts` — idempotent paint of `data-card-hovered`/`data-card-selected` across all surfaces. Pruner clears selection for deleted cards BUT inline-atoms (fn/cite) are `entityExists ⇒ true` always (`:84-90`) → stale-ghost risk.
- `src/links/_shared/useTextHoverBridge.ts` — `openForCard` (omni-first open + pin at click-Y); fn/cite atoms dispatch own events vs Mode-B `virgil-linked-anchor-click`.
- `src/components/Marginalia.tsx` — gutter markers (only marker-bearing kinds), overflow pill, marginalia-move re-anchor.
- `src/hooks/usePersistentState.ts` — sidecar write (~300ms debounce, flush on unmount/docId change, retry).

---

## Column vocabulary (the matrix columns) — clusters
Each finder GROUP owns specific clusters. Within your group, test every cluster's member functions for YOUR subject.

- **F1 Render/empty/truncate** — initial mount, populated render, empty state, very-long-content truncation, compressed↔expanded summary, strip count badge.
- **F2 Select & expansion** — single-card halo (≤1), multi-card expand/collapse, axis purity (selecting ≠ collapsing; expanding ≠ moving halo), header-activate composition.
- **F3 Bidirectional jump** — card→text (jump-to-anchor scroll+highlight), text→card (gutter marker for marker kinds), in-text atom/span click. Note anchored-only/cited-only/linked-only gates.
- **F4 Nested body links** — citations/footnotes/`\ref`/inline-math rendered INSIDE card bodies (BorrowedMainText read-only vs RichTextField editable); click-through from inside a body selects that atom's card.
- **F5 Edit** — edit body, title (bodyTitle), named fields; AI-request flag toggle + inbox bridging.
- **F6 Morph/convert** — report↔report-request (lossy); note↔highlight etc. live elsewhere. N/A for most left subjects.
- **F7 Lifecycle** — delete (+ "has content?" confirm via cardHasContent), duplicate/clone on same anchor, drag/lift/re-anchor.
- **F8 Float & cross-surface sync** — popout to float, docked↔omni↔float↔gutter selection/hover sync, sidecar JSON round-trip (debounce/flush/race).
- **A1 Orphaned anchor** — anchor text-object deleted → unanchored/orphan bin, orphan card render, jump disabled.
- **A2 Stale anchor + recovery** — anchor drift, `reanchorByText`, id/uuid regeneration round-trip.
- **A3 Duplicate cards same anchor** — two cards one anchor, selection/jump disambiguation.
- **C1 Panel chrome** — panel toggle/open/close, reorder across strips, collapse, split; strip badge.
- **C2 Omni-specific** — filter menu, outside-focus bin, unanchored bin, dual-column projection, focus-view interaction, fold filter, pin. (Owned by S8 only.)

## Group → cluster ownership
- **G-display** owns: F1, F4, F5.
- **G-interact** owns: F2, F3, F6, F7.
- **G-anchor** owns: A1, A2, A3, F8, C1, and (S8 only) C2.

For structural subjects S6 (outline) and S7 (search), most card clusters are N/A — instead test the panel's own structural functions under the nearest cluster (e.g. outline fold/focus/rename under F2/F3/F5; search query/scope/navigate under F1/F3; prefs persistence under F8; chrome under C1). Mark genuinely inapplicable cells N-A with a reason.

---

## Severity rubric
- **DATA-LOSS** — silent loss/corruption of user content (dropped entry on export, clobbered edit, lost title/author on morph, orphaned-without-recovery).
- **HIGH** — core function broken or wrong result (jump to wrong place, selection lost, accept applies wrong text, stale positions cause mis-navigation).
- **MEDIUM** — function works but misbehaves in a realistic case (stale plural command, desync halo, count off, confirm skipped).
- **LOW** — minor/edge wrongness, unlikely path, recoverable.
- **COSMETIC** — visual only.

## Known-fragile leads (investigate these hard)
1. `cardHasContent` missing cases for footnote/citation/example/bib → delete-confirm can't classify → may skip "has content?" prompt.
2. Reconciler inline-atom exemption (`entityExists⇒true`) → deleted footnote/citation leaves stale ghost halo/hover/expand ref.
3. Citation id regeneration on every parse → selection-by-id, omni pos cache, pin all key off discarded ids → halo/selection lost on next structural edit (cross-surface).
4. biblatex singular→plural auto-promote with NO demote → command stuck plural after rows reduced.
5. Duplicate-citekey silent drop on display (`sortedEntries` seen-set); empty-`raw` silent drop on export (`.filter(Boolean)`).
6. Polymorphic morph lossy & partly silent (title/author/aiRequest dropped); verify the "host confirms first" gate actually fires; AI-request inbox entry orphans on morph.
7. `isAutoTitle` false-positive: user title matching `^<Label> \d+$` ("Report 2"/"Example 3") silently nulled on load.
8. Search manual PM `textOffset` accounting (+1 per textblock) = off-by-one surface for multi-block matches; positions stale when doc edited post-search.
9. Examples derived-vs-persisted: write-back race vs main editor, echo-skip via JSON compare, N mounted editors when N collapsed, swallowed schema errors.
10. Hardcoded omni bin stacking offset (`topPx:30`) desyncs if pill height changes.
11. Outline focus-band measurement (observer-driven remeasure on fold/expand) historically thrashy.
12. `document.execCommand` (deprecated) for bib annotation editor; `navigator.clipboard` unguarded in copy-citekey/copy-key (rejects in insecure context).

## Scope corrections (do not mis-file)
- Footnotes & Citations: NO gutter marker → C8/F3 text→card is in-text ATOM click only; gutter-marker subcell is N-A.
- Bibliography: shared `src/components/BibEntryCard.tsx`, no folder card, no omni.tsx; omniEligible false → C2 N-A, F6 N-A, F8 omni-sync N-A (still has float/popout + .bib persistence).
- Examples: derived; delete removes sidecar metadata only, not the block.

## Hard guards (every finder)
- READ-ONLY on source. Never edit, stash, checkout, or run non-readonly commands. Only write your own findings JSON.
- Code analysis PRIMARY. No live preview available to you. Cells unresolved by code-read = UNVERIFIED (with reason + what would resolve), never PASS.
- Tests are *contracts* (intended behavior), not proof of current behavior. A divergence between code and a test's/ jsdoc's intent is itself a finding. Read relevant `__tests__/`.
- Keystroke-sanctity: if you touch a card-source memo or an `editor.on('update'|'transaction')` path, a per-keystroke regression is itself an auditable bug (see root AGENTS.md permitted-list).

---

## Output: write your findings JSON, then return a lean digest

Write a file at the EXACT path given in your task: `docs/memos/lhs-panel-audit/raw/<subject>-<group>.json` (absolute: `/Users/gabriel/Programming/virgil/docs/memos/lhs-panel-audit/raw/<subject>-<group>.json`). Shape:

```json
{
  "subject": "footnotes",
  "group": "G-interact",
  "clusters": ["F2","F3","F6","F7"],
  "cells": [
    { "cluster": "F2", "status": "PASS|BUG|N-A|UNVERIFIED", "note": "one line + file:line evidence or reason", "bugIds": ["FN-F2-01"] }
  ],
  "findings": [
    {
      "id": "FN-F2-01",
      "subject": "footnotes",
      "cluster": "F2",
      "severity": "DATA-LOSS|HIGH|MEDIUM|LOW|COSMETIC",
      "symptom": "user-observable misbehavior, one sentence",
      "suspectedRootCause": "the mechanism, not the symptom",
      "evidence": [{ "file": "src/...", "line": 0, "note": "what this line does in the failure path" }],
      "reproSteps": ["..."],
      "reproChannel": "code-trace",
      "confidence": "high|medium|low",
      "suspectedClass": "hypothesized sibling instances elsewhere, or null"
    }
  ]
}
```

Use id prefix from subject: FN (footnotes), CI (citations), BIB (bibliography), REP (reports), EX (examples), OUT (outline), SR (search), OMNI (omni). Suffix `-<cluster>-<seq>`.

**Return to the orchestrator ONLY this lean digest (NOT the full findings):**
`{ "subject": "...", "group": "...", "cellsTouched": N, "bugCount": N, "unverifiedCount": N, "highestSeverity": "...", "findingIds": ["..."], "wroteFile": true }`
