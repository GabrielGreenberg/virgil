# A6-audit — Marginalia gutter

<!-- pinned: HEAD 588ae7e (2026-06-09) — re-verified every file:line against the post-A0+AF tree -->

Read-only audit of the **marginalia gutter surface** (the icon markers in the left/right gutters; nav-only) against the two landed foundations (A0 card SSOT `src/cards/`, AF Floatable subsystem `src/floats/`). Scope: marker rendering, marker metadata, marker→card click/scroll/pin coherence, drag/re-anchor, the deferred overflow design, and keystroke sanctity of the live gutter pipeline.

---

## 0. TL;DR

The marginalia gutter is **structurally sound at the render layer but fragmented at the source/metadata layer, and split into a live pipeline + a large dead twin.**

Three headline findings:

1. **DEAD PARALLEL PIPELINE (the keystone).** There are **two** complete `marginaliaMarkers` builders. The **live** one is `EditorPane.tsx:1495` (it feeds the only mounted `<Marginalia>` at `EditorPane.tsx:3915`). The **dead** one is `EditorLayout.tsx:3330` → `visibleMarginaliaMarkers` (`:3733`), which is never passed to `<EditorPane>` (`:4784`, no `markers` prop). **All of `markers.ts` (`useMarkerActions`) and ALL of the AF-fix marker-omniKey→`cardPopKey` / revision-`entrySelector`→`cardDomSelector` migration work feeds ONLY the dead pipeline.** The live gutter markers use a trivially simpler `onClick` (`setSelected*` + `setActivePanelKindBySide`) with no `openForCard`, no `cardPopKey`, no `alignOmniCardWithClick`. So the AF-fix "marker→card scroll/pin coherent against `float:card:<kind>:<id>`" was verified **in code that doesn't run for the gutter.** (`marker-clicks.ts`'s window-event bridges ARE live — see §1 — so the AF-fix there is real; the *gutter-marker-click* AF-fix is dead.)

2. **MARKER METADATA IS NOT REGISTRY-DERIVED.** A0 declared `CardMeta.markerType` per kind (`card-registry.tsx`), and A0-audit §6 (lines 513-514) explicitly said to reach the marker namespace via `CardMeta.markerType` and replace `MarginaliaMarker.entityKind` with `CardKind`-filtered-by-`anchored`. **That fold never happened.** `marginalia.ts:96` still hand-keeps `MarkerType` (7 tokens); `MARKER_META` (`:235`) is a hand-built 7-row table; `MarginItemKind` (`delete-margin-item.ts:46`) is a *fourth* parallel 6-token enum; `MARKER_TO_THEME_KEY` (`Marginalia.tsx:44`) and `MARKER_KIND_TO_THEME_KEY` (`EditorLayout.tsx:80`) are two more hand-kept marker→theme maps. The registry's distinct `markerType` values are exactly the `MarkerType` union — the derivation is mechanically available and unused.

3. **THE "DEFERRED OVERFLOW DESIGN" IS A DEAD FIELD.** `PositionedMarker.overflow` (`marginalia.ts:199`) is *written* by the grid (`marginalia-grid.ts:74-81,106`) and **read nowhere**. When a paragraph has more markers than text lines, excess markers all clamp to the last row at the *same* (x,y) and stack invisibly on top of each other. There is no overflow affordance (no "+N" chip, no second-column spill indicator). The design was deferred and the placeholder is inert.

Keystroke sanctity in the **live** path is intact: `Marginalia.tsx`'s `editor.on("update")` is the sanctioned RAF-coalesced O(1) host-notify; the `EditorPane.tsx:1495` memo gates on `rev.anchors`/`rev.blocks` (structural-revision counters), not an update counter; the registry hook sources from layout observers. The deepest fix (fold marker metadata onto the registry + collapse to one pipeline) carries a keystroke-sanctity trap in the **revision branch's live doc walk** — see §Keystroke sanctity.

**Confidence: high** on the dead-twin and metadata-fragmentation findings (verified by grep that EditorLayout's markers never reach EditorPane and that `markers.ts`/`useMarkerActions` has no live consumer); **medium** on the exact disposition of the dead pipeline (whether the rich Omni-first routing should be *ported into* EditorPane or *deleted* is a real product call — see Open questions Q1).

---

## 1. Current reality (code-derived, EXACT file:line)

### 1.1 The render layer — `Marginalia.tsx` (the live surface)

- **Component:** `src/components/Marginalia.tsx:110` `export default function Marginalia({ editor, markers, panelSides })`. Mounted **once**, at `EditorPane.tsx:3915`, fed `markers={visibleMarginaliaMarkers}` (the EditorPane memo) + `panelSides={marginaliaPanelSides}` (`EditorPane.tsx:1725`).
- **Host subscription:** `useMarginaliaHost` (`Marginalia.tsx:65`) — `useSyncExternalStore` whose `subscribe` registers `editor.on("create"|"update", recheck)` with `recheck` RAF-coalesced (`:72-79`). This is the **sanctioned** O(1) host-element notify (AGENTS.md keystroke-sanctity list). The snapshot is `editor.view.dom.closest("[data-marginalia-host]")` (`:93`).
- **Positioning:** `computeMarkerPositions(registry.getMetrics, markers, panelSides)` memoized on `[registry, markers, panelSides, registryVersion]` (`:123-128`). `registryVersion` from `useRegistryVersion` (`:114`) is the re-render trigger; `getMetrics` is stable.
- **Marker render:** `MarkerButton` (`:412`) self-subscribes to the global `cardStore` via `useIsSelected(ref)`/`useIsHovered(ref)` keyed by `{kind: m.entityKind, id: m.entityId}` (`:413-417`) — **no prop threading from a parent decoration loop** (good; this is the post-reactor-sweep pattern). Stamps `data-marginalia-marker={`${m.type}:${m.id}`}` (`:437`).
- **DnD re-anchor:** the gutter-level `dragover`/`drop` effect (`:132-380`) handles paragraph-level anchor drags (MIME-typed: `MIME_MARGINALIA_MOVE`, `MIME_NOTE`, `MIME_TODO`, `MIME_CUT`, `MIME_REPORT`, `MIME_ARCHIVE_ANCHOR`), dispatching `virgil-*-drop` / `virgil-marginalia-reanchor` CustomEvents. The marker button's own `onDragStart` (`:476`) sets `MIME_MARGINALIA_MOVE`.

### 1.2 The marker *source* — two builders, one live, one dead

| Builder | Location | Status | onClick shape |
|---|---|---|---|
| **EditorPane** `marginaliaMarkers` | `EditorPane.tsx:1495-1718` | **LIVE** (→ `visibleMarginaliaMarkers` `:1761` → `<Marginalia>` `:3915`) | `setSelected<X>Id(...)` + `setActivePanelKindBySide("<panel>")` (e.g. `:1518-1521`) |
| **EditorLayout** `marginaliaMarkers` | `EditorLayout.tsx:3330-3623` | **DEAD** (→ `visibleMarginaliaMarkers` `:3733` → consumed by nothing; `<EditorPane>` `:4784` gets no `markers` prop) | Rich Omni-first via `openForCard` + `cardPopKey` + `cardDomSelector` + `alignOmniCardWithClick` (e.g. `:3383-3406`, `:3475-3499`) |

Both builders gate on `rev.anchors`/`rev.blocks` (`useStructuralRevisions`) and both do a **live `ed.state.doc.descendants` walk** for the revision branch to resolve `anchorId → paragraphId` (EditorPane `:1560-1576`; EditorLayout `:3428-3443`). Identical logic, divergent click behavior.

The live EditorPane builder covers: notes (`:1506`), archive (`:1531`), revisions (`:1554`), cutter (`:1600`), **reports** (`:1628` — the EditorLayout twin has **no reports branch**, another drift), todo (`:1656`), errors (`:1678`).

### 1.3 Marker metadata (the satellite tables — NONE registry-derived)

- `MarkerType = "note"|"archive"|"revision"|"cut"|"todo"|"report"|"error"` — `marginalia.ts:96`.
- `MARKER_META: Record<MarkerType, MarkerMeta>` — `marginalia.ts:235-245`, built by the `meta()` helper (`:227`) deriving the color quartet from `DEFAULT_PANEL_COLORS[accentKey]` via `markerPaletteFromAccent`. Each row hand-wires `{label, panelId, defaultSide, icon}`.
- `MarginaliaMarker.entityKind?: EntityKind` — `marginalia.ts:112` (the A0 dedup landed: the field now reuses `EntityKind` instead of an inline 13-kind union, per the `// Was a hand-kept inline union` comment at `:110-111`). But `EntityKind` itself (`entity-hover.ts:38`) is `(typeof ANCHORED_CARD_KINDS)[number]` where `ANCHORED_CARD_KINDS` (`entity-hover.ts:22-36`) is **still a hand-kept 13-element array**, NOT `CARD_KINDS.filter(isAnchoredCardKind)`.
- `MarginItemKind = "note"|"archive"|"cut"|"todo"|"revision"|"report"` — `delete-margin-item.ts:46`, a 4th parallel enum (its own docstring at `:44` admits it "Mirrors `MarkerType` … minus `error`").
- `MARKER_TO_THEME_KEY` — `Marginalia.tsx:44-50` (5 entries: note/archive/revision/cut/todo — **missing report/error**).
- `MARKER_KIND_TO_THEME_KEY` — `EditorLayout.tsx:80-88` (note/revision/cutter-comment/cutter-suggestion/report — a *different* keyspace, EntityKind-ish, for active-anchor highlight tint).

### 1.4 The grid + overflow

- `computeMarkerPositions` — `marginalia-grid.ts:41`. Pure function, no DOM. Resolves side (`m.side ?? panelSides[meta.panelId] ?? meta.defaultSide`, `:57-59`), packs L→R/T→B (`:65-100`). Left gutter uses 1 effective column (`:72`, the inner-left slot is reserved for the paragraph popout button); right uses 2 (`MARGINALIA_COLS`).
- **Overflow:** `:78-81` clamps `row` to `node.lineCount-1` and sets `overflow=true` when the grid is full; `:106` writes it onto the `PositionedMarker`. **No consumer reads `overflow`** (verified across `src/` — only the type decl `marginalia.ts:199` + the write `marginalia-grid.ts:106`). Overflowed markers stack at identical (x,y).

### 1.5 The click bridges — `marker-clicks.ts` (LIVE) vs `markers.ts` (DEAD)

- `useMarkerClickBridges` (`marker-clicks.ts:63`) — **LIVE**, wired at `EditorLayout.tsx:2541`. These are **window-event** listeners (`virgil-footnote-click` `:160`, `virgil-citation-click` `:213`, `virgil-label-ref-click` `:235`, `virgil-math-click` `:252`, `virgil-figure-click` `:269`, `virgil-linked-anchor-click` `:339`) dispatched by node views / `useTextHoverBridge`. They DO route through the AF-fix-correct `cardPopKey`/`cardDomSelector` (`:133`,`:157`,`:309`, `ANCHOR_CLICK_ROUTES` `:13-45`). **This is the live route by which note/cutter/revision *in-text* clicks reach the panel — it is coherent against `float:card:<kind>:<id>`.**
- `useMarkerActions` (`markers.ts:24`) — **DEAD**. Wired at `EditorLayout.tsx:2434`, but its outputs (`handleNoteMarkerClick`/`handleCutMarkerClick`/`handleTodoMarkerClick`) are consumed ONLY by the dead EditorLayout `marginaliaMarkers` memo (`:3359`,`:3526`,`:3548`). The live EditorPane gutter markers never call them. **All AF-fix migration in `markers.ts` (omniKey→`cardPopKey` at `:88`,`:110`,`:143`,`:164`,`:180`,`:202`; `entrySelector`→`cardDomSelector` at `:143`) is dead.**

### 1.6 What IS coherent against the AF float grammar

- `cardStore` hover/selection keying: `MarkerButton`'s `ref = {kind: m.entityKind, id: m.entityId}` (`Marginalia.tsx:413`) matches the panel-card store keying — three-surface hover works on the live gutter (this is store-keyed, not DOM-key-keyed, so it sidesteps the float grammar entirely).
- The live in-text→panel route (`marker-clicks.ts`, §1.5) is correct.
- `data-marginalia-marker` is its OWN third grammar (`${MarkerType}:${entityId}:${pid}`), **not** `float:card:…`. It's used live only for drag hit-test occlusion (`EditorLayout.tsx:1479` generic `closest("[data-marginalia-marker]")`); the `^=` prefix querySelectors against it (`markers.ts:105/159/197`, `EditorLayout.tsx:3402/3494`) are all in dead code.

---

## 2. Finding — DEAD parallel marker pipeline in EditorLayout

**WHAT.** A complete, rich `marginaliaMarkers` builder + `visibleMarginaliaMarkers` filter live in `EditorLayout.tsx` but feed nothing. The live gutter is driven entirely by EditorPane's simpler twin.

**WHERE.**
- Dead builder: `EditorLayout.tsx:3330-3623`.
- Dead filter: `EditorLayout.tsx:3733-3737`.
- Dead consumers (only): `useMarkerActions` (`markers.ts`, wired `EditorLayout.tsx:2434`), and the dead memo's own `openForCard`/`cardPopKey`/`alignOmniCardWithClick` calls.
- Proof of death: `<EditorPane>` mount `EditorLayout.tsx:4784-4805` passes **no** `markers` prop; the live mount `EditorPane.tsx:3915` reads `visibleMarginaliaMarkers` from the **EditorPane** memo (`EditorPane.tsx:1761`).
- Provenance: the "panel rendering moved to EditorPane post-7.8" comments (`EditorLayout.tsx:611,828,833,3783`) — this is leftover from the 7.8 split.

**WHY it's wrong.** (a) It's ~300 lines of dead code that *looks* canonical (it has the richest behavior), so future readers/chips will edit the wrong one — exactly what happened to AF-fix, which migrated this dead memo's marker keys and the dead `markers.ts`. (b) It masks a **real behavior regression**: the live gutter lost the Omni-first routing, `clickY` card-alignment, split-aware citation routing, and the suppress-placement logic that the dead version has. (c) It diverged structurally (the dead twin has no reports branch).

**DEEPEST fix.** Collapse to **one** marker-source pipeline. The class of bug is "the 7.8 split duplicated the marginalia source and only one copy kept evolving." Decide the canonical behavior (Q1) and:
- Delete `EditorLayout.tsx:3330-3623` + `:3733-3737` + the `useMarkerActions` wiring (`:2434`) + `markers.ts` itself, **OR**
- Port the Omni-first routing from `markers.ts`/the dead memo INTO the EditorPane builder (`EditorPane.tsx:1495`), then delete the EditorLayout twin.

Either way the end state is: exactly one `marginaliaMarkers` builder, exactly one set of gutter-click handlers, and `markers.ts` either deleted or relocated to be the EditorPane builder's helper. This is an A6+A1 (gardening) seam — see §Cross-arena seams.

---

## 3. Finding — Marker metadata is not registry-derived (4 parallel enums + 2 theme maps)

**WHAT.** A0 put `markerType` in `CARD_REGISTRY` and A0-audit §6 prescribed reaching the marker namespace via `CardMeta.markerType` + replacing `MarginaliaMarker.entityKind` with `CardKind`-filtered-by-`anchored`. The fold was never done; the marginalia layer keeps **four** hand-kept kind enums and **two** hand-kept marker→theme maps that drift independently.

**WHERE.**
- `MarkerType` union — `marginalia.ts:96`.
- `MARKER_META` table — `marginalia.ts:235-245`.
- `MarginItemKind` union — `delete-margin-item.ts:46`.
- `ANCHORED_CARD_KINDS` / `EntityKind` — `entity-hover.ts:22-38` (hand-array, NOT `CARD_KINDS.filter(isAnchoredCardKind)` even though that predicate exists at `predicates.ts:25`).
- `MARKER_TO_THEME_KEY` — `Marginalia.tsx:44-50` (5 entries; missing `report`,`error`).
- `MARKER_KIND_TO_THEME_KEY` — `EditorLayout.tsx:80-88`.
- `entityKindToAnchorKind` / `MARKER_KIND_TO_THEME_KEY` mapping logic — `entity-hover.ts:130-144`, `EditorLayout.tsx:3642-3664`.

**WHY it's wrong.** Adding/renaming a marker kind requires editing ≥4 sites by hand, in violation of the refactor's DoD ("adding a card kind = one registry entry"). The drift is already live: `MARKER_TO_THEME_KEY` omits `report`/`error`; `MarginItemKind` re-spells the `cut`/`revision` marker tokens (vs the `cutter-*`/`revision-*` card kinds); `MARKER_KIND_TO_THEME_KEY` keys on a mix of marker-tokens and entity-kinds. The registry already has the SSOT: `CARD_REGISTRY[k].markerType` and `.themeKey` are declared and correct (verified: the registry's distinct non-null `markerType` values `{note,archive,todo,revision,cut,report,error}` are EXACTLY the `MarkerType` union).

**DEEPEST fix.**
1. **`MarkerType`** → `type MarkerType = NonNullable<CardMeta["markerType"]>` derived, OR keep the literal union but add a dev assertion `assertMarkerCoverage()` (mirror A0's `assertLifecycleCoverage`) pinning `Object.keys(MARKER_META)` ⊇ `{registry markerType values}`. (Keep `MarkerType` as a small *visual* namespace per A0-audit §6 line 513 — but stop hand-listing it.)
2. **`MARKER_META`** → keep the visual rows (icon/label/side are genuinely marginalia-local, not card-spine), but key/validate them off the registry's markerType set; better, fold `panelId`/`defaultSide` lookups to read `CARD_REGISTRY[k].panel` so the marker's home panel can't drift from the card's. (The icon belongs in marginalia; the panel binding belongs in the registry.)
3. **`MarginItemKind`** → derive from `MarkerType` minus `error` (or just `= MarkerType` and let the `error` handler bundle be absent). Delete the standalone union.
4. **`MarginaliaMarker.entityKind`** → already `EntityKind`; make `EntityKind`/`ANCHORED_CARD_KINDS` themselves registry-derived: `export const ANCHORED_CARD_KINDS = CARD_KINDS.filter(isAnchoredCardKind)` and `type EntityKind = CardKind` (or a branded subset). This is technically an A2 (anchoring) seam — A2-audit owns `EntityKind`-vs-`anchored` — but A6 should flag it because the marker `entityKind` field is the consumer.
5. **`MARKER_TO_THEME_KEY` + `MARKER_KIND_TO_THEME_KEY`** → both replaced by reading `CARD_REGISTRY[k].themeKey` (and the registry's `markerType→themeKey` is already implied per-kind). Collapse the two maps; fill the `report`/`error` gaps for free.

---

## 4. Finding — The deferred overflow design is a dead field

**WHAT.** When a paragraph has more markers than text lines (e.g. a 1-line heading with 3 notes + a todo + a cut), the grid sets `overflow=true` and clamps every excess marker to the last row at the **same** (x,y). They render stacked, fully occluding each other. No "+N" affordance exists. `overflow` is written and never read.

**WHERE.** Write: `marginalia-grid.ts:74-81` (clamp) + `:106` (assign). Type: `marginalia.ts:199`. Read: **none** (grep-verified across `src/`).

**WHY it's wrong.** It's a silent data-presentation loss — markers vanish under each other with no indication. The left gutter is worse: it's already restricted to 1 effective column (`marginalia-grid.ts:72`), so overflow triggers sooner. The field's existence implies a design was intended; leaving it inert is a trap (a reader assumes overflow is handled).

**DEEPEST fix.** Pick ONE overflow design and make `overflow` load-bearing:
- **Option A (compress):** on overflow, render the first N markers and an "+K" pill (clicking it opens the panel filtered to that paragraph's items). Minimal, legible, matches the "nav-only gutter" role.
- **Option B (spill column):** allow markers to spill into the reserved inner column / a second row past `lineCount` when the paragraph is short. More complex; risks colliding with the popout button.
- **Option C (de-dup at source):** the more common real case is *one card anchored to N paragraphs* producing N markers, and *N cards on one paragraph*. Most gutters overflow because a short heading collects many markers. Recommend **Option A** as the deepest, with the grid keeping `overflow` and `Marginalia.tsx` rendering the pill from it.

This is squarely A6-owned (the brief names it). It should be ratified (Q3) before impl since it's a new affordance, not a pure refactor.

---

## 5. Finding — AF-fix marker→card coherence was verified in dead code

**WHAT.** The brief asks to "verify marker→card scroll/pin is coherent against `float:card:<kind>:<id>`." The AF-fix migrated the gutter-marker `omniKey`→`cardPopKey` and the revision `entrySelector`→`cardDomSelector` — but those edits are in `markers.ts` (dead) and the EditorLayout dead memo (`:3385,:3478,:3494`). The **live** gutter markers (`EditorPane.tsx:1495`) never build a `cardPopKey` or call `openForCard`/`alignOmniCardWithClick` at all.

**WHERE.** AF-fix migration in dead code: `markers.ts:88,110,143,164,180,202`; `EditorLayout.tsx:3385,3405,3477-3478,3497`. Live gutter onClick (no float-key): `EditorPane.tsx:1518-1521,1542-1545,1588-1591,1615-1618,1643-1646,1668-1671,1689-1692`.

**WHY it's wrong / what it means.** The marker→card *float-grammar* coherence the AF-fix claims to have verified does not run for the gutter. The gutter→panel link still works (via `setSelected*` + `setActivePanelKindBySide` + the cardStore three-surface highlight), but it's a *different, simpler* mechanism than the audited one — no Omni-first routing, no `clickY` alignment, no scroll/pin. The live in-text→panel route (`marker-clicks.ts`, §1.5) IS coherent. So "marker→card scroll/pin" is **half live (in-text clicks) / half regressed-and-bypassed (gutter clicks).**

**DEEPEST fix.** Resolved by §2 (collapse to one pipeline). When the canonical pipeline is chosen, the float-grammar coherence is verified there *once*. If the Omni-first routing is ported into EditorPane, the AF-fix `cardPopKey`/`cardDomSelector` calls move with it and become live; if deleted, the gutter's simpler route is the ratified behavior and the AF-fix dead edits are deleted with the dead memo. **Do not "fix" the live EditorPane onClick in isolation** — that re-creates two divergent copies.

---

## Target design

One marginalia source, registry-derived metadata, a load-bearing overflow affordance.

**1. One marker-source pipeline.** Exactly one `marginaliaMarkers` builder (canonically in EditorPane, where the live `<Marginalia>` mounts). The EditorLayout twin (`:3330-3623`,`:3733-3737`) and `markers.ts`/`useMarkerActions` are deleted; if the richer Omni-first routing is kept (Q1), it is ported into the EditorPane builder's `onClick`s (and `markers.ts` becomes that builder's colocated helper). The live in-text click bridges (`marker-clicks.ts`) stay as-is (already correct).

**2. Registry-derived marker metadata.** `MarkerType`/`MARKER_META` keyed off `CARD_REGISTRY[k].markerType`, validated by a boot-time `assertMarkerCoverage()` (mirrors `assertLifecycleCoverage`). `MARKER_META`'s `panelId`/`defaultSide` read `CARD_REGISTRY[k].panel` so a marker's home can't drift from its card. `MarginItemKind` derived from `MarkerType`. `ANCHORED_CARD_KINDS`/`EntityKind` → `CARD_KINDS.filter(isAnchoredCardKind)` (coordinate w/ A2). Both marker→theme maps replaced by `CARD_REGISTRY[k].themeKey` reads. **Net: adding a marker kind = one registry entry**, matching the whole-refactor DoD.

**3. Load-bearing overflow.** `Marginalia.tsx` reads `PositionedMarker.overflow` and renders an "+K" pill (Option A) on the last cell, clicking opens the owning panel filtered to that anchor. The grid keeps producing `overflow`; the render layer consumes it.

**Consumes the foundations:** A0's `CARD_REGISTRY[k].markerType`/`.themeKey`/`.panel` + `predicates.ts` (`isAnchoredCardKind`, `panelForCardKind`) become the marker SSOT. AF's `cardPopKey`/`cardDomSelector` are used by the *single* surviving marker-click route (only if Omni-first routing is kept). Marker hover/selection stays cardStore-keyed (no float-grammar dependency).

---

## Keystroke sanctity

**Live path: NO new risk today.**
- `Marginalia.tsx:65-89` `useMarginaliaHost` — sanctioned RAF-coalesced `editor.on("create"|"update")` host-notify; the doc explicitly documents it (AGENTS.md list). O(1) per transaction. **Must stay O(1)** through any refactor — do not add doc-walking work to this subscriber.
- `EditorPane.tsx:1495` (live builder) — gates on `notesHook.notes`/`cutterHook.cards`/…/`rev.anchors`/`rev.blocks` (the `useStructuralRevisions` counters) + `editor`, NOT an `update` counter. Plain typing bumps none → no marker recompute. Correct per AGENTS.md "Card-source derivation: no raw update counters."
- `useMarginaliaRegistry.ts` — sources layout truth from `ResizeObserver`/`IntersectionObserver`, never edit events (`:21-31`). Per-keystroke cost is O(change), not O(doc).

**The trap the deepest fix must respect — the revision-branch live doc walk.** Both builders' revision branch does `ed.state.doc.descendants(...)` to resolve `anchorId → paragraphId` (EditorPane `:1560-1576`; EditorLayout `:3428-3443`). This is O(doc) **per recompute**, and is only safe because it's gated on `rev.anchors`/`rev.blocks` (it runs when anchors/blocks change, NOT per keystroke). When collapsing to one pipeline:
- **Keep the gate.** The merged builder must still depend on `rev.anchors`/`rev.blocks` + the card arrays + the reactive `editor`, never on a `docVersion`/update counter. A null structural keystroke must not re-run the descendants walk.
- **Better (event-driven alternative):** the `DocStructureObserver` already tracks **anchors** (per AGENTS.md: "blocks, headings, footnotes, citations, anchors, examples, figures, labels"). The `anchorId → paragraphId` resolution should read the observer's per-transaction-mapped anchor snapshot (`getBus(editor).structure`) at measure time, instead of re-walking `doc.descendants`. That eliminates the O(doc) walk entirely and makes the revision marker source O(anchors). Flag for the impl chip — it's the same class as `useInTextPositions` resolving live positions from the bus snapshot.
- Verify `window.__virgilBusStats()` `emitCount` flat while typing in a paragraph that carries a revision/note/cut marker, with the gutter visible.

---

## Fragmentation table

| Surface | File(s) (file:line) | Disposition |
|---|---|---|
| **Live marker builder** | `EditorPane.tsx:1495-1718`; filter `:1761`; mount `:3915` | **KEEP** as the single source; absorb Omni-first routing if Q1 says so |
| **Dead marker builder (twin)** | `EditorLayout.tsx:3330-3623`; filter `:3733-3737` | **DELETE** (post-7.8 leftover; never reaches `<EditorPane>`) |
| **Gutter-click handlers (dead)** | `markers.ts` (`useMarkerActions`); wired `EditorLayout.tsx:2434` | **DELETE** or **PORT into EditorPane builder** (Q1) |
| **In-text click bridges (live)** | `marker-clicks.ts:63-353`; wired `EditorLayout.tsx:2541` | **KEEP** (AF-fix-correct; uses `cardPopKey`/`cardDomSelector`) |
| `MarkerType` union | `marginalia.ts:96` | **DERIVE/ASSERT** from `CARD_REGISTRY[k].markerType` |
| `MARKER_META` table | `marginalia.ts:235-245` | **KEEP** visual rows; key off registry markerType; read `.panel` for `panelId` |
| `MarginItemKind` union | `delete-margin-item.ts:46` | **DERIVE** from `MarkerType` (drop standalone) |
| `MarginaliaMarker.entityKind` field | `marginalia.ts:112` | already `EntityKind`; make `EntityKind` registry-derived (A2 seam) |
| `ANCHORED_CARD_KINDS`/`EntityKind` | `entity-hover.ts:22-38` | **REPLACE** with `CARD_KINDS.filter(isAnchoredCardKind)` (coordinate A2) |
| `MARKER_TO_THEME_KEY` | `Marginalia.tsx:44-50` | **REPLACE** with `CARD_REGISTRY[k].themeKey` (fills missing report/error) |
| `MARKER_KIND_TO_THEME_KEY` | `EditorLayout.tsx:80-88` | **REPLACE** with `CARD_REGISTRY[k].themeKey` |
| `PositionedMarker.overflow` | type `marginalia.ts:199`; write `marginalia-grid.ts:74-81,106`; read **none** | **MAKE LOAD-BEARING** (Option A "+K" pill) or remove (Q3) |
| `data-marginalia-marker` grammar | producer `Marginalia.tsx:437`; live consumer `EditorLayout.tsx:1479`; dead consumers `markers.ts:105/159/197`,`EditorLayout.tsx:3402/3494` | **KEEP** producer + live hit-test; dead `^=` lookups die with the dead memo |
| MIME constants + `ANCHOR_DRAG_TYPES` | `marginalia.ts:49-94` | **A1** (A0-audit §6 line 515 deferred these to gardening) |

---

## Definition of Done for this arena

1. **One marginalia source.** Exactly one `marginaliaMarkers` builder; the EditorLayout twin + `markers.ts` (if dead) deleted. No second copy can drift.
2. **Registry-derived metadata.** `MarkerType`/`MARKER_META`/`MarginItemKind`/the two theme maps all reach `CARD_REGISTRY[k].{markerType,themeKey,panel}`; a boot assertion pins coverage. Adding a marker kind touches only the registry (+ the marginalia-local icon).
3. **Overflow is real.** `overflow` drives a visible affordance (or is removed by ratified decision). No marker silently occludes another.
4. **Marker→card coherence verified once, live.** Whichever click route survives is coherent against `float:card:<kind>:<id>` (if Omni-routed) and verified in the dev preview — not in dead code.
5. **Keystroke sanctity intact.** `Marginalia.tsx` host-notify stays O(1); the merged builder stays gated on structural-revision counters + reactive editor; the revision-branch `doc.descendants` walk is either kept-gated or replaced by the observer's anchor snapshot. `__virgilBusStats().emitCount` flat on plain typing with markers visible.
6. **Dev-preview walk:** create a note/todo/cut/revision/report/archive marker; click each (gutter + in-text); re-anchor by drag; overflow a short heading; delete via the gutter `Delete` key. All coherent, no occlusion, no console errors.

---

## Open questions for the human

- **Q1 (gates §2/§5 impl).** When collapsing to one marker pipeline, is the canonical gutter-click behavior the **rich Omni-first routing** (port the dead `markers.ts`/EditorLayout memo logic — `openForCard` + `cardPopKey` + `clickY` alignment + split-aware citation routing) into EditorPane, or the **simpler current live behavior** (`setSelected*` + `setActivePanelKindBySide`)? The live gutter has *regressed* off the richer routing since the 7.8 split; this is a product call, not just gardening. (Recommendation: port the Omni-first routing — it's the better UX and the AF-fix already made it coherent.)
- **Q2.** Is the EditorLayout marginalia twin (`:3330-3623`) safe to delete outright in A6, or does any other consumer read it that grep missed? (My grep says no consumer; confirming intent.) Note it also lacks a reports branch, so it's strictly inferior — not a "keep both" situation.
- **Q3 (gates §4 impl).** Ratify the overflow design: **Option A** ("+K" compress pill, recommended), Option B (spill column), or "remove the dead field, overflow stays clamped-and-stacked (status quo)". This is a new affordance needing sign-off.
- **Q4.** `MARKER_META` mixes genuinely-marginalia-local data (icon, label) with card-spine data (`panelId`, `defaultSide`). Should `defaultSide` move into `CARD_REGISTRY` (so a card kind declares its preferred gutter side), or stay marginalia-local? (Leaning: `panelId` derives from registry `.panel`; `defaultSide` stays marginalia-local since it's a gutter-layout concern.)

---

## Cross-arena seams

| Arena | Shared surface | Where (file:line) |
|---|---|---|
| **A1 (Gardening)** | Deleting the dead EditorLayout `marginaliaMarkers` twin + `markers.ts`/`useMarkerActions` is gardening of exactly the kind A1 owns; the MIME-constant cleanup (`marginalia.ts:49-94`) was *already deferred to A1* by A0-audit §6 (line 515). Coordinate the dead-pipeline deletion with A1 so it isn't done twice. | `EditorLayout.tsx:3330-3623,3733-3737,2434`; `markers.ts` (whole file); `marginalia.ts:49-94` |
| **A2 (Anchoring & link model)** | `EntityKind`/`ANCHORED_CARD_KINDS` (`entity-hover.ts:22-38`) is the `MarginaliaMarker.entityKind` field's type and the cardStore hover key. A2 owns the "is `EntityKind` redundant with the registry `anchored` flag?" question (CARD-SYSTEM-REFACTOR §A2). A6's registry-derive of `entityKind` depends on A2's resolution. The live in-text click route (`marker-clicks.ts`'s `virgil-linked-anchor-click`, `ANCHOR_CLICK_ROUTES`) is Mode-B anchor routing = A2 territory. | `entity-hover.ts:22-38,130-144`; `marginalia.ts:112`; `marker-clicks.ts:13-45,278-352` |
| **A4 (Selection/focus)** | The gutter marker is a selection operand: `MarkerButton` self-subscribes to `cardStore` (`Marginalia.tsx:413-417`) and the click sets `setSelected<X>Id`. The "selection ⟂ expansion" matrix (Decisions N1) and "select without scroll" decisions land in A4; the marker onClick is a call site of that model. | `Marginalia.tsx:413-467`; `EditorPane.tsx:1518-1692` (onClick selection writes) |
| **A5 (Omni-view)** | If Q1 keeps Omni-first routing, the gutter click pins/scrolls the Omni card via `alignOmniCardWithClick` + `tryScrollOmniEntry` (dead today, in `markers.ts`/the dead memo). The omni-key invariant (`omniKey === cardPopKey(kind,id) === data-omni-entry`) is shared with A5's resolvePos/pin surface. | `markers.ts:88-202` (dead); `marker-clicks.ts:309,336` (live in-text); A5's `OmniViewPanel` pin path |
| **A9 (Appearance & typography)** | Marker icons + the marker color palette (`MARKER_META` icons, `markerPaletteFromAccent`) are the gutter's visual identity; A9 owns per-kind appearance + the registry's `themeKey`. The `MARKER_*_THEME_KEY` maps A6 wants to replace with `CARD_REGISTRY[k].themeKey` are A9's theming surface. | `marginalia.ts:216-245`; `Marginalia.tsx:44-50,419-431`; `EditorLayout.tsx:80-88,3642-3664` |
| **A8 (Print + reader)** | The Reader mounts the same `<Marginalia>` (read-only: `dragEnabled = editor?.isEditable !== false`, `Marginalia.tsx:390`). A8's read-only reader path shares the marker source; any pipeline collapse must keep the Reader's right-only `marginaliaPanelSides` fallback (`EditorPane.tsx:1725-1732`) working. | `Marginalia.tsx:388-398`; `EditorPane.tsx:1725-1732` |
| **A3 (Creation & lifecycle)** | `delete-margin-item.ts` (the gutter `Delete`-key + drag-delete path) carries `MarginItemKind` and the unanchor-vs-delete escalation — A3 owns lifecycle (clone/delete/bindAnchor). A6's `MarginItemKind`-derive overlaps A3's delete-coverage work. | `delete-margin-item.ts:46-67,89-…`; `Marginalia.tsx:468-475` (Delete key) |

---

## Stale-ref corrections

| SSOT / older-audit ref | Stated location | Current (HEAD 588ae7e) |
|---|---|---|
| Brief: `src/links/_shared/markers.ts`, `marker-clicks.ts` | `src/links/_shared/` | `src/components/editor-layout/card-actions/markers.ts`; `src/components/editor-layout/event-bridges/marker-clicks.ts` |
| AF re-review §8.2: "marker→Omni `omniKey` still legacy … `markers.ts:88/110/180/202`, `marker-clicks.ts:138/162/185/215/312`" | (pre-AF-fix lines) | AF-fix migrated these; in `markers.ts` the `cardPopKey` calls are now `:88,110,143,164,180,202` (and **the `markers.ts` route is DEAD** — feeds only EditorLayout's dead memo). `marker-clicks.ts` `cardPopKey` calls: `:133,157,210,309` (LIVE). |
| AF re-review §8.3: "Revision marginalia-marker → card scroll dead — hand-built legacy entrySelector `EditorLayout.tsx:3458`" | `EditorLayout.tsx:3458` | Now `cardDomSelector(revKind,…)` at `EditorLayout.tsx:3478` — but this whole memo (`:3330-3623`) is **DEAD** (not wired to `<EditorPane>`); the live revision marker (`EditorPane.tsx:1580`) has no entrySelector at all. |
| A0-audit §6 line 513: `MarkerType`+`MARKER_META` at `marginalia.ts:97,237-247` | `:97,237-247` | `MarkerType` `:96`; `MARKER_META` `:235-245`. Disposition ("reach via `CardMeta.markerType`") **not yet done** — that's this arena's core fix. |
| A0-audit §6 line 514: `MarginaliaMarker.entityKind` inline 13-kind union at `marginalia.ts:111-114` | inline union | The inline union was deduped to `EntityKind` (A0 landed); field now `marginalia.ts:112`. `EntityKind` source (`entity-hover.ts:22-38`) is **still hand-kept**, not registry-derived. |
| CARD-SYSTEM §A6 key files: `Marginalia.tsx`, `marginalia.ts`, `marginalia-grid.ts` | listed | All correct & current (`src/components/Marginalia.tsx`, `src/lib/marginalia.ts`, `src/lib/marginalia-grid.ts`). The arena's *real* hot files also include `EditorPane.tsx` (live builder) + `EditorLayout.tsx` (dead twin) + `delete-margin-item.ts` + `entity-hover.ts`, which the SSOT key-file list omits. |
| Cheat-sheet: "MARKER_META / MarkerType … in `src/lib/marginalia.ts`" + duplicate `entityKind` union `marginalia.ts:111` | `:111` | `entityKind` field `:112`; it is no longer a duplicate union (reuses `EntityKind`). The duplication moved up a level into `entity-hover.ts`'s hand-kept `ANCHORED_CARD_KINDS`. |
