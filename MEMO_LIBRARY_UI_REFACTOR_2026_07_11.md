# Library UI deep refactor — one gesture engine, layout-driven chrome — 2026-07-11

Ultramode manager session. Deep audit (7-agent workflow `wf_e5405183-a12`: drag
dynamics, tab-chrome geometry, layout architecture, watcher census, cross-app
prior art, git archaeology + adversarial completeness critic; ~1.4M subagent
tokens, 50 findings, 12 critique verdicts) + live dev-preview probes. This memo
is the implementation plan. Work lands in a worktree off local main.

**User-reported symptoms:** (1) L/R gutter drag — especially middle|right —
choppy, hangs; panel outline lags the drag and snaps into place seconds later.
(2) Tops of library/paper folder tabs missing their outline stroke (bottom fine);
multiple past fixes didn't stick. (3) General "assembled ad hoc" feel of the
geometry + drag watchers.

---

## Root causes (all evidence-verified, cross-checked by critic)

- **R1 — Gestures are watched, not owned.** `makeResizeHandler`
  ([LibraryView.tsx:203-257](library/components/LibraryView.tsx)) uses plain
  `window` listeners: no `setPointerCapture`, no `pointercancel` /
  `lostpointercapture` / `blur`, no `e.button`/`e.buttons` gating. The right
  pane hosts a full-bleed pdf.js **iframe** ([PdfView.tsx:292-302](library/components/PdfView.tsx)) —
  pointer events over an iframe go to the iframe's document, so the drag
  **hangs** when the cursor overshoots the 6px gutter; a release over the
  iframe is **never seen**: the drag *ghost-resumes* when the cursor returns
  (button up), and the user's **next click anywhere** finally fires `onUp`,
  which **commits a width the user never chose** and only then reconciles the
  parked chrome → the "outline snaps seconds later". (Critic-resolved: wedge
  lasts until next click, not forever; the ghost-commit is worse than any
  auditor reported.)
- **R2 — Chrome geometry is measurement-driven and frozen mid-gesture by
  design.** The tab silhouette and the panel body outline are **measured SVGs**
  (2 ResizeObservers per tab + strip RO + body-frame RO), whose `d`-strings are
  recomputed from `getBoundingClientRect`. Task 090 ([gutter-drag.ts](library/lib/gutter-drag.ts))
  *parks* them during drags and reconciles once on a single-caller end edge —
  so the outline is **frozen at drag-start geometry for the whole gesture**
  ("outline hangs back" is the parking design working as intended), and the
  reconcile rides the fragile end edge from R1.
- **R3 — Forked geometry.** [folder-path.ts](library/components/panel-tabs/folder-path.ts)
  exists twice: the library copy (379 lines, task-087 clip cushions applied) and
  the editor original ([src/components/editor-layout/folder-path.ts fork consumed
  by DocumentFolderTab.tsx](src/components/editor-layout/DocumentFolderTab.tsx),
  74 lines, **zero-cushion top stroke**, same export names). Fix attempts (8
  outline commits in 18 days) kept landing on one fork while the sighting was
  plausibly the other — the outer tabs are literally the "library/paper tabs".
  The candidate live clip for the outer strip is the documented WCO/installed-PWA
  strip-edge clip (see wco memo/`?wco-debug`). Meta-diagnosis from the ledger:
  the recurring fix class is "add a compensating pixel constant or a
  watcher-damping gate"; the bug lives in measurement-driven chrome.
- **R4 — Reader pane thrashes per drag frame** (mode-exclusive tracks, per
  critic): **PDF mode** (default): the vendored viewer re-scales and
  re-rasterizes canvases on every frame (undebounced `resize` →
  `currentScaleValue` reassign + `update()`, viewer.mjs:14446/14702-14719).
  **Text mode**: [usePgmarkPages.ts:127](library/hooks/usePgmarkPages.ts) RO is
  unparked — per-frame O(chips) forced-layout scan + **ungated fresh-array
  `setPages`** whose identity defeats `PaperRender`'s memoized EditorPane via
  the `pagePickerEl` deps ([PaperRender.tsx:383](library/components/PaperRender.tsx))
  → full reader subtree re-render per frame, stacked on the O(doc) ProseMirror
  rewrap; plus the [RightDetail.tsx:117](library/components/RightDetail.tsx)
  `textPodRect` RO → [PaperHeader podAlign](library/components/PaperHeader.tsx)
  cascade. **Both gutters** resize the 1fr reader column (critic-corrected).
- **R5 — Per-frame store commits.** LeftList column-header drag routes
  `setLayout` through the view-session store **per pointermove**
  ([LeftList.tsx:449](library/components/LeftList.tsx)) → LibraryView-wide
  re-render per frame. Editor-side `useDragGap` consumers likewise commit React
  state + localStorage per mousemove — same class, other silo.
- **R6 — Idle churn.** catalog-store's 6s poll emits a fresh store state every
  tick (IDB returns a fresh FSA handle object each `get`, so the handle
  comparison at [catalog-store.ts:99-102](library/lib/catalog-store.ts) never
  holds) → the whole Library tree re-renders every 6 s **in prod too**
  (critic-resolved against the in-code "stable handle" comment).
- **R7 — Ungoverned silo.** Both CI grep-guardrails (keystroke-subscriber,
  scroll-reposition) walk `src/` only; the perf doctrine the test comment
  defers to **does not exist** in library/AGENTS.md. Every regression class
  above landed in the ungoverned silo.
- **R8 — Clamp composition.** The three gutters' clamps are independent and
  non-reactive; combined minimums exceed narrow viewports and the 1fr reader
  can silently collapse to 0 ([LibraryView.tsx:154](library/components/LibraryView.tsx)).

Ruled out (so nobody re-chases them): mid-drag React re-renders do NOT clobber
the imperative grid write (commit path race-free); LeftListRow IS memoized
(stale comment says otherwise); inner active tab top stroke DOES paint at HEAD
at DPR 2 (verified live twice); inactive inner tabs have no outline **by
design** (BackgroundTab plain divs — the stale comment at PanelTabStrip.tsx:458
claiming per-inactive strokes misleads).

---

## Design — five pillars

### P1. One pane-resize primitive (`src/lib/pane-resize/`)
A single gesture engine every divider in the app uses. Owns the pointer:
`setPointerCapture` on the handle; `pointermove`/`pointerup`/`pointercancel`/
`lostpointercapture` on the captured element; `e.button===0` start gate;
`e.buttons===0` mid-move bail; Escape cancels (restore drag-start value).
Applies geometry **imperatively via CSS custom properties** on the layout
container (grid templates reference the vars) — RAF-coalesced with equality
bail, zero React state per frame. **Commits once on release** through a
persistence adapter (store / localStorage). Mounts a **drag shield** for the
gesture (full-viewport overlay; kills iframe swallow as belt-and-suspenders
under capture, and owns `body` cursor). Publishes begin/end edges on **one
app-wide `PaneDragBus`** (replaces BOTH the editor's `virgil:drag-gap-start/end`
window events AND library's module flag `gutter-drag.ts`). Emits the unified
**band-grip** hover/drag chrome (MEMO_GUTTER_GRIP_UNIFY fork A: orientation-aware
grip pill, one rule set in globals.css).

### P2. Layout-driven chrome — kill measured SVG
- **One folder-tab implementation** shared by outer doc tabs and inner library
  tabs (unify the two folder-path forks; keep the visual: R=10 top corners,
  straight sides, convex swoop feet). Only the tab WIDTH varies → the shape is
  drawn with **fixed-size corner/feet pieces + a stretchable middle** (CSS
  9-slice via border-image or three-segment flex with two tiny static SVG end
  caps) — **zero ResizeObservers, no d-string recompute, no measurement**.
  Stroke ink sits ≥1 CSS px from every clip edge **by construction** (strip
  gets real top padding; no `overflow:hidden` that can shave ink), expressed as
  a unit-testable invariant, and applied to BOTH strips (this covers the
  WCO/PWA strip-edge clip environment for the outer tabs).
- **Panel body outline becomes a plain CSS border** + `--library-manila-radius`
  on the body (already has the radius token + overflow hidden). The active-tab
  seam uses the classic z-order fusion: the tab's background overlaps the body's
  top border by 1px (`margin-bottom:-1px`, background = surface) — needs no
  knowledge of panel width, no SVG bridge rect, no reconcile, correct at every
  width including mid-drag. **Delete** the body-frame measured SVG, the tab
  ROs, `gutter-drag.ts`, and the park/reconcile protocol (nothing left to park).
- **One geometry SSOT**: shared constants module + CSS tokens (manila radius,
  stroke width, swoop size, edge color) consumed by outer tabs, inner tabs,
  body frames, NavPod. Extend the `--library-edge` guard test to
  `src/components/library` (closes the MyPapersPod `--topbar-border` hole).

### P3. Freeze-don't-thrash the reader during drags
Grid columns track the pointer live (panels/frames move fluidly — they're
layout-driven now), but the **reader pane's content is frozen for the gesture**:
a shared-layer wrapper locks the pane's inner content width at drag start
(clipped, no rewrap), releases on commit → pdf.js sees exactly ONE resize;
EditorPane text reflows exactly once; every downstream RO fires once. This
lives in the shared layer keyed on the `PaneDragBus` (READER_INHERITANCE-legal;
amend the sanctioned-import list; precedent: KeepAliveVisibilityProvider).
Independent hygiene regardless of freeze: equality-gate `setPages`
(label+docY compare) restoring `pages` ref-stability for PaperRender's memo;
keep textPodRect's ±0.5 gate; instrument PDF-mode `setPdfPageState` once and
gate on the bus if it churns. Fix R6 (cache the resolved library handle /
version-gate the notify) and R8 (move clamps into the grid template via
`minmax()`/`max()` so layout owns the constraint).

### P4. Editor-side adoption (same class, other silo)
Migrate the editor dividers to the primitive + grip chrome: panel-column
gutter, split-with-code splitter, zen margins, panel bands, and the
`useDragGap` family (their per-mousemove React-state + localStorage commits
move to commit-on-release). Behavior-identical otherwise; LeftList column
drag also moves onto the primitive (per-frame CSS var on the table, one store
commit on release).

### P5. Guardrails + doctrine (make the class stay dead)
Write the perf-doctrine section in library/AGENTS.md (mirroring src/
keystroke/scroll discipline, with the why-O(1) allowlist convention); extend
BOTH existing grep-guardrail tests to walk `library/` with justified
allowlists; add a **third guardrail for the divider class**: any window-level
`pointermove`/`mousemove` listener paired with a drag gesture must be the
primitive or allowlisted — covering both silos. Re-pin surviving visual
contracts (tab/frame corner tangency, active-tab open-bottom seam, radius-token
equality, edge-color guard) as tests against the new mechanism; rewrite/retire
folder-path.test.ts (~40 path-math assertions) and gutter-drag.test.ts
accordingly. Keep the view-session-store layout slice shape (no schema bump);
update STYLE_GUIDE.md (“resize gutters” + “folder tabs” sections) and glossary.

---

## Phasing (each phase lands only with suite + tsc green)

1. **Foundations** — `src/lib/pane-resize/` (engine, bus, shield, CSS-var
   applier, persistence adapter), band-grip orientation variant in globals.css,
   unit tests (capture/cancel/buttons/escape/commit-once/RAF-coalesce).
2. **Library gutters** — LibraryView grid onto CSS vars + `minmax()` clamps;
   3 gutters onto the primitive; delete `makeResizeHandler` + `gutter-drag.ts`
   consumers; catalog-store notify fix; LeftList column drag onto the primitive.
3. **Chrome rebuild** — unified folder-tab module (outer + inner), CSS-border
   body frame, geometry SSOT, delete tab/strip/frame ROs + park protocol,
   re-pinned visual-contract tests, stale-comment fixes.
4. **Reader freeze** — shared drag-freeze wrapper on the bus; setPages equality
   gate; PDF eventBus instrumentation (+gate if needed); READER_INHERITANCE
   sanctioned-import amendment.
5. **Editor-side adoption** — editor dividers + useDragGap family onto the
   primitive; commit-on-release persistence; behavior-identical visuals + grip.
6. **Guardrails/docs** — doctrine text, extended + new guardrail tests,
   STYLE_GUIDE/glossary updates.
7. **Verification** — full vitest + tsc; live preview protocol (below).

## Verification protocol
- Unit: new primitive suite; re-pinned chrome contracts; all three guardrails
  green over both silos; full suite + tsc.
- Live dev preview (`virgil-dev`, force-dev-storage, library-data fixture):
  real pointer drags on all three library gutters — outline tracks the edge
  live (no lag, no snap); drag through/over the reader pane and release there —
  no hang, no ghost-resume, no spurious commit; tab tops present at DPR 2 on
  inner AND outer strips (+ `?wco-debug` for the WCO seam); `__virgilBusStats`
  flat while typing; scroll-reposition probe ≤1 distinct top/frame.
- Real-PWA checklist for Gabriel (preview can't prove these): drag over a real
  PDF paper + release over the viewer; outer-tab tops under installed-app WCO
  at DPR 1 and 2.

## Risks / constraints
- ~40 architecture-coupled assertions in folder-path.test.ts + all of
  gutter-drag.test.ts must be re-expressed as visual contracts, not deleted.
- Tab visual parity (swoop feet, radii, seam) must be pixel-faithful — verify
  side-by-side screenshots before/after in the preview.
- view-session-store: a schema bump silently resets ALL layout for
  forward-version blobs — keep the layout slice shape byte-compatible.
- READER_INHERITANCE.md forbids Reader-local render forks — all freeze/bus
  code goes through the shared layer + sanctioned-import list amendment.
- Shared live checkout: all work in a worktree; verify main tip before merge.
