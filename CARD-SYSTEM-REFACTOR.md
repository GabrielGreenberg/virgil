# Card-System Refactor — A Unified Card Registry & a Shared `Floatable` Presence

A deep overhaul of Virgil's card system, run as a **management session**: this doc is the single source of truth, and tasks are spun off as **chips** (one worktree/session each) tracked in the Chip Ledger. The card system is *the un-migrated half* left behind by the text-object refactor — [TEXT-OBJECT-REFACTOR.md](TEXT-OBJECT-REFACTOR.md) already solved "scattered kind-definition" for editor blocks, and this refactor mirrors that pattern for cards.

**Governing ontology (§2).** Virgil has **two basic kinds of things: `TextObject`** (graspable pieces of the document) **and `Card`** (annotation/apparatus anchored to them). They are distinct kinds and are **not merged** — there is no shared base type. The *only* thing they share is their **popped-out physical presence** — the floating window — captured by a **`Floatable` role both satisfy by composition** (§3).

**Strategy.** audit-first · **two foundations** (the card spine §5 and the `Floatable` presence §3) land before dependent arenas rebase onto them · the two kinds stay ontologically distinct — we touch the text-object side **only at the shared window layer**, nowhere else · keystroke sanctity is sacred.

---

## Progress

### Session 3 — both foundations landed; decisions ratified; new issues folded (2026-06-04)
- **Both Wave-1 foundations landed** (`docs/card-refactor/A0-spine-audit.md`, `AF-floatable-audit.md`). Resolved an audit↔audit conflict: **Quotations is deleted** (A0 correct; AF stale — the tree moved `486a462`→`d1b3ee3`); `report`/`report-request` are real. Corrected taxonomy: **17 declared / 16 real kinds, 4 polymorphic panels, ~14 sync sites + 6 parallel kind-enums + a duplicate `entityKind` union**; `error` is **not** poppable.
- **Ratified all recs + reconciliations** — see the new **Decisions** section (kind-in-key for all polymorphic panels, `comment`→`revision-comment`, error-not-poppable, raise-on-click, keep per-domain surface, lifecycle gaps declared-intentional/deferred to A3, registry at `src/cards/`, AF owns the popped header before A9, stackability via `Floatable.snapshotForStack()`).
- **Process rule:** the tree moves under the refactor → every chip re-pins to current HEAD + re-verifies `file:line` on start; AF-impl gets an explicit re-pin pass (its inline float sites 15→14, `quotation:` mooted).
- **Folded in Gabriel's issue list:** card-modes matrix + expand/pop-out-without-select + unanchored reflow (→ A4/A5); borrows-from-main-text display + two-class typography (→ A9); stackability (→ AF, already covered); and the **polymorphic morph chevron** (→ A0 + A9).
- **N1 (modes matrix) + N2 (typography) ratified** — all decisions now settled.
- **Entering foundation implementation.** Next: **A0-impl** (card registry SSOT — the keystone), then **AF-impl** (`src/floats/`). **Wave-2 dependent-arena audits (A1–A10) deferred until the foundations land** — auditing them now (against pre-refactor code) would re-stale them the moment the registry/floats restructure lands (the same drift that hit AF in 3 days). A0-impl and AF-impl run **serial, not parallel** — they share `panel-primitives.tsx` + the key grammar + `toFloatable`.

### Session 2 — ontology refined; two foundations; A0 re-spun + AF spun off (2026-06-01)
- Established the governing ontology: two distinct kinds (`TextObject`, `Card`) + a shared **`Floatable` role** for the popped-out presence — **composition, not a shared base class.** A Card *has* a floating presence; a TextObject *has* a floating presence; the float subsystem hosts anything satisfying the contract and knows nothing about which kind it holds.
- Ratified the three seams: **(1)** each domain keeps its own *birth* gesture; the subsystem owns the float + the commit-to-float handoff. **(2)** fixed chrome skeleton (drag · title · jump · redock · close) + 1–2 domain-contributed slots. **(3)** one popout-key grammar `float:<domain>:<kind>:<id>` with a prefs migration.
- Reshaped arenas: **A0 spine is card-only**; old A7 (float/popout + stack) is **elevated to `AF` — the `Floatable` presence abstraction**, the single sanctioned cross-domain arena (window layer only).
- Coordination tweak: audit chips write to their own `docs/card-refactor/<ID>-audit.md` (conflict-free parallel fan-out) and return a summary; **the management session consolidates into this doc and owns the Chip Ledger.**
- Re-spun **A0-audit** (card-only, refined) and spun off **AF-audit** (Floatable presence). Both are Wave-1 foundations.

### Session 1 — doc created; spine-audit chip spun off (2026-06-01)
- Mapped the card system across four facets (taxonomy/registries, surfaces, interaction/drag-drop, persistence/styling) and consolidated into the arena breakdown + Chip Ledger. Ratified: audit-first, foundation-first/serial. (Scope later refined in session 2 from "cards-only" to "two kinds + one shared presence.")

---

## Current state cheat-sheet (read before touching code)

> ✅ **Verified by the A0/AF audits against HEAD `d1b3ee3` (2026-06-04).** Authoritative detail lives in `docs/card-refactor/A0-spine-audit.md` (taxonomy, per-kind matrix, exact `file:line`) and `AF-floatable-audit.md` (float layer).

**~14 hand-synced card-kind definition sites across 10 files** (≈2× the original "~11" estimate), **plus 6 parallel kind-enums** with drifting tokens (canonical `CardKind` 17 · pristine 6 · `StackCardKind` 12 · `ANCHORED_CARD_KINDS` 13 · `MarkerType` 7 · `PanelThemeKey` 11 · `HighlightType` 5) **and a duplicate inline `entityKind` union** (`marginalia.ts:111`). Core sites:

| Sync point | File (verify) |
|---|---|
| `CardKind` union | `src/panels/_shared/types.ts` (one report said `src/lib/types.ts` — **resolve which is canonical**) |
| `PANEL_REGISTRY`, `CARD_KEY_PREFIXES`, `CARD_TYPE_LABELS`, `CARD_TITLE_LABELS` | [src/panels/panel-registry.ts](src/panels/panel-registry.ts) |
| `CARD_THEMES` | [src/components/panel-primitives.tsx](src/components/panel-primitives.tsx) |
| `CardLifecycleRegistry` (clone/delete/bindAnchor) | [src/panels/card-lifecycle-registry.tsx](src/panels/card-lifecycle-registry.tsx) + wiring in [src/components/EditorPane.tsx](src/components/EditorPane.tsx) |
| `ANCHORED_CARD_KINDS` | [src/links/_shared/entity-hover.ts](src/links/_shared/entity-hover.ts) |
| `MARKER_META` / `MarkerType` + `MIME_*` card constants | [src/lib/marginalia.ts](src/lib/marginalia.ts) |
| Drop-spec registry | [src/components/drop-mode/registry.ts](src/components/drop-mode/registry.ts) |

**17 declared kinds** (`src/panels/_shared/types.ts:32-49`): `note`, `highlight`, `footnote`, `citation`, `comment`, `suggestion`, `cutter-comment`, `cutter-suggestion`, `revision-suggestion`, `report`, `report-request`, `example`, `todo`, `archive`, `bib`, `ai`, `error`. **`quotation` is gone** (panel deleted; zero `src/` refs). After cleanup → **16 real** (drop bare `suggestion` — an on-disk data discriminator, not a registry kind; rename `comment`→`revision-comment`). **13 anchored**; `bib`/`ai`/`error` system; **15 poppable** (`error` is not — dead capability, A0 §3.5).

**4 polymorphic panels** (registry `card: null`, via `POLYMORPHIC_CARD_PANEL`): Notes (`note`+`highlight`), Revisions (`comment`+`revision-suggestion`), Cutter (`cutter-comment`+`cutter-suggestion`), **Reports** (`report`+`report-request`).

**Surfaces a card appears on:** docked side panel · omni-view · **popped-out float** · marginalia gutter (nav only) · stack (thumbnail) · print · reader/library (read-only).

**Known naming/keying warts (dispositions ratified — see Decisions):** `suggestion` is one concept under **five names** → kind-in-key + `comment`→`revision-comment`, drop bare `suggestion`; `cut` theme/marker vs `cutter-*` kinds; the `quote`/`quotation` mismatch is **resolved by deletion**; the dual example key (`example:` vs `textobject:exampleBlock:`) left for A1; polymorphic special-casing → inverted to registry-derived (`cardKindsForPanel`).

**Lifecycle coverage gaps (corrected):** the 8 with clone/delete/bindAnchor are `footnote`, `citation`, `note`, `highlight`, `comment`, `suggestion`, `cutter-comment`, `cutter-suggestion`; the **real gaps are `todo`, `archive`, `example`, `report`, `report-request`** (the cheat-sheet missed `report`/`report-request` and wrongly listed the deleted `quotation`). Ratified: **declared intentional in the registry now; fills deferred to A3.**

**Float-presence current reality (recon; the `AF`-audit verifies):** `FloatingPanel` ([src/components/FloatingPanel.tsx](src/components/FloatingPanel.tsx)) is the low-level window, already shared. `FloatCard` ([src/components/FloatingCards.tsx](src/components/FloatingCards.tsx)) wraps it; `TextObjectFloat` ([src/text-objects/TextObjectFloat.tsx](src/text-objects/TextObjectFloat.tsx)) appears to wrap `FloatCard` (so `FloatCard` is **misnamed** — it already hosts text-objects). Popped state via `usePoppedCards`/`prefs.poppedOutCards` keyed by string. Stack-drop dispatch shared ([src/lib/stack/](src/lib/stack/)); snapshot per-kind. So the shared substrate **already exists implicitly** — the work is largely formalizing, renaming, unifying chrome + key grammar.

**Keystroke-sanctity constraint (non-negotiable):** card-source derivation gates on [`useStructuralRevisions`](src/hooks/useStructuralRevisions.ts) counters + the reactive `editor` — never an `update`-counter. Verify `window.__virgilBusStats()` (emitCount flat on plain typing). Any refactor must preserve this. See [AGENTS.md](AGENTS.md).

---

## The spirit (re-stated for every session)

- **Two kinds, one presence.** `TextObject` and `Card` stay ontologically distinct — composition, **not** a shared base class. The only shared layer is the `Floatable` popped-out presence (window / chrome / stack-drop / float-policy). **Touch the text-object side only at that window layer.**
- **One registry, one descriptor** for the card spine — mirror `TEXT_OBJECT_REGISTRY`.
- **One canonical predicate** for "is this an anchored card?" (registry-derived, replacing `ANCHORED_CARD_KINDS` + the polymorphic-panel branches).
- **Coherent across surfaces** — same card looks/behaves consistently docked → omni → float → print → reader.
- **Keystroke sanctity is sacred.** Verify every time.
- **Audit before you build.** Audits land in per-arena files; the management session consolidates into this doc.

---

## 1. Spirit & Ambition

Collapse the card spine into a single card SSOT (`CARD_REGISTRY`); rationalize naming/keying drift; make every card coherent across its surfaces; even out uneven capabilities (lifecycle, anchoring); garden the dead drag-drop code. **And** formalize the implicitly-shared float machinery into one named `Floatable` presence subsystem that both kinds consume — without merging the two kinds — so popped windows behave identically and global float policy is enforced in one place. The TextObject refactor is the proof this pattern works.

## 2. The Two-Layer Ontology — Kinds vs. Presence

The crux of getting this right. Two layers, kept strictly separate:

**Layer 1 — Kind (distinct; never merged).**
- `TextObject` — a graspable piece of the *document* (paragraph, heading, list, atom block, linkedRange…). Lives in the ProseMirror doc; persists via `.tex` + source markers; `TEXT_OBJECT_REGISTRY`.
- `Card` — *apparatus* (note, footnote, citation, todo…). Lives in sidecar JSON; anchors **to** a text-object (or is paper-wide); will have `CARD_REGISTRY`.
- Different identity, lifecycle, persistence, creation, in-context selection, anchoring. **No shared base type.**

**Layer 2 — Presence (shared by composition).** "Being popped out into a window" is a **role** both kinds play, not a thing they both *are*. A Card *has* a floating presence; a TextObject *has* a floating presence. The float subsystem hosts anything satisfying the `Floatable` contract and is blind to which kind it holds. This is exactly what lets us *access and constrain the common abstraction even as each kind specializes* — the shared thing is a thin behavioral contract, not a shared identity.

## 3. The `Floatable` Presence Abstraction

The shared substrate (designed in detail by the **`AF`-audit** chip).

**What it owns (shared):** the window shell (today's `FloatingPanel`) + **one** chrome (header: drag · title · jump-to-source · redock/popout · close); move / resize / spawn position; **uniform float policy** — viewport clamping, the fit-on-screen size cap (cf. LIFTED-OVERLAY Issue-13), z-index/MRU, Cmd-W focus stack; drop-onto-stack (detection + dispatch); re-dock + dock-outline; popped-state persistence. *(Float policy in one place is the payoff of "constrain": invariants stop drifting per-kind.)*

**The contract (sketch — `AF` finalizes):**
```ts
interface Floatable {
  key: string;                 // unified popout key — float:<domain>:<kind>:<id>
  title: string;               // header label
  renderBody(): ReactNode;     // the specialized content
  jumpToSource(): void;        // reveal where it actually lives
  snapshotForStack(): StackSnapshot; // domain serialization onto the stack
  defaultSize?: { w: number; h: number };
  spawnHint?: DOMRect;
}
```
Both `CARD_REGISTRY[kind].toFloatable(id)` and `TEXT_OBJECT_REGISTRY[kind].toFloatable(id)` yield a `Floatable`. The float subsystem operates only on this.

**Shared vs specialized:**

| Shared (the subsystem) | Specialized (behind the contract) |
|---|---|
| window shell + chrome skeleton | the body renderer |
| move / resize / spawn / size & viewport policy | what `jumpToSource()` does |
| z-index / MRU / Cmd-W focus | `snapshotForStack()` serialization |
| stack-drop dispatch, re-dock, dock-outline | **sync model**: text-objects edit the live doc (`float-sync`); cards edit sidecar data |
| popped-state persistence | the *birth* gesture; anchor/marginalia behavior |

**Ratified seams:**
1. **Birth gesture stays per-domain.** A paragraph is grabbed *in the doc* (lifted-overlay); a card is lifted *from its panel header*. The subsystem owns the resulting float + the commit-to-float handoff; each domain owns its origin gesture.
2. **Chrome budget:** fixed header skeleton + 1–2 domain slots (e.g. text-object "source-missing"/sync dot; card collab-claim pill / AI checkbox). Beyond that it stops being "the same chrome."
3. **One key grammar:** `float:<domain>:<kind>:<id>`, so the subsystem dispatches generically. Needs a one-time `prefs.poppedOutCards` migration from the old `<prefix>:<id>` / `textobject:<kind>:<id>` shapes.

**Module:** new top-level `src/floats/` (sibling to `text-objects/`, `links/`, and the new `cards/`). Rename `FloatCard` → domain-neutral (working name `FloatWindow`) — it already hosts text-objects, so the current name is wrong.

## 4. The Card Taxonomy

**Landed — authoritative per-kind matrix in `docs/card-refactor/A0-spine-audit.md` §2** (origin · anchored · poppable · stackable · lifecycle · drop · panel · keyPrefix · themeKey · markerType). Headline: 17 declared / 16 real kinds; 13 anchored; 3 system (`bib`/`ai`/`error`); 15 poppable; `CardKind`'s canonical home is `src/panels/_shared/types.ts:32` (moves into `src/cards/types.ts`).

## 5. Target Card Registry Shape (the new SSOT) — card-only

**Designed — see `A0-spine-audit.md` §4:** `CARD_REGISTRY: Record<CardKind, CardMeta>` at new top-level `src/cards/`, one descriptor driving `label`/`titleLabel`/`keyPrefix`/`themeKey`/`panel`/`origin`/`anchored`/`markerType`/`lifecycle`/`dropSpec`/`toFloatable(id, ctx): Floatable | null`. Six parallel kind-enums + the polymorphic-panel branches collapse to one union + derived predicates (`isAnchoredCardKind`, `panelForCardKind`, `cardKindsForPanel`, `resolveCardKind`). **Float handling is NOT defined here** — `toFloatable` plugs into §3's shared contract. Ratified dispositions in **Decisions**.

## 6. Current Fragmentation to Retire

**Landed — two tables:** card-spine fragmentation in `A0-spine-audit.md` §6 (`Surface | File(s) (file:line) | Disposition`); float-presence fragmentation in `AF-floatable-audit.md` §7 (duplicated chrome, two key grammars, the 15→14 inline float sites, per-kind float logic).

## 7. The Arenas

Two foundations (`A0`, `AF`), then the dependent arenas. Each becomes a read-only **audit chip** then **implementation chip(s)**. Your original five review zones map on as noted.

### A0 — Spine: card SSOT consolidation *(FOUNDATION · card-only · ✅ audit landed)*
- **Scope:** the ~14 sync points + 6 parallel enums → one `CARD_REGISTRY`; resolve naming/keying warts; define canonical predicates. **Float presence is out of scope here** — expose `toFloatable()` (§3), don't design it.
- **Also exposes** the per-panel polymorphic-morph set (`cardKindsForPanel`) that powers the new **morph chevron** (A9) and generalizes the existing revisions `convertCard`.
- **DoD:** adding a card kind = one registry entry (+ predicate/anchor membership). No edits to the other sync points.

### AF — `Floatable` presence abstraction *(FOUNDATION · the ONE sanctioned cross-domain arena, window layer only · ✅ audit landed)*
- **Scope:** formalize the implicitly-shared float machinery into `src/floats/` + the `Floatable` contract; unify chrome; unify the key grammar (+ lockstep `poppedOutCards`/`cardFloatPositions` migration); enforce one float policy. Both `Card` and `TextObject` produce `Floatable`. **Do NOT touch either ontology/registry or in-doc behavior; do NOT merge the kinds.**
- **Key files:** [FloatingPanel.tsx](src/components/FloatingPanel.tsx), [FloatingCards.tsx](src/components/FloatingCards.tsx), [TextObjectFloat.tsx](src/text-objects/TextObjectFloat.tsx), [usePoppedCards.ts](src/hooks/usePoppedCards.ts), [spawn-position.ts](src/components/editor-layout/spawn-position.ts), [stack/](src/components/stack/) + [src/lib/stack/](src/lib/stack/), [dock-drag.ts](src/components/editor-layout/dock-drag.ts).
- **Covers your zones 2 & 3 + Part D (stackability):** drop-onto-stack is the **shared** `Floatable.snapshotForStack()` — one mechanism for cards **and** text-objects (this answers Part D's "shared vs wire-twice": shared); AF caught that text-object floats don't stack today (bug, fixed by construction). Ratified: **raise-on-click** (z from MRU); **AF owns the popped header** (out of `PanelCard`, lands before A9). Absorbs the old A7.

### A1 — Gardening *(your zone 4)*
Dead/vestigial removal: grip-redesign disabled drags (TodoRow/QuotationGroupCard/ErrorCard); vestigial `DetachedActionsToolbar`/`Formatting`/`Menu`; unused `AttachedPopover`; unreachable `menuLocation:"free"`; legacy `comments.json`/`useComments`; `legacySpawn`; the dual example-block key. Mostly leaf-file deletions → can land early.

### A2 — Anchoring & link model
Mode A/B, `linkedAnchor`, three-surface hover, orphans, re-anchor-by-drag. Files: [src/links/](src/links/), [linked-anchor.ts](src/lib/tiptap/linked-anchor.ts), [anchored-card-store.ts](src/links/_shared/anchored-card-store.ts). Open: is `EntityKind` redundant with the registry's `anchored` flag?

### A3 — Creation & lifecycle
3 creation entry points → one pipeline; pristine-card auto-discard; clone/delete/bindAnchor coverage gaps. Files: [card-creation.ts](src/components/editor-layout/card-actions/card-creation.ts), [usePristineCardManager.ts](src/hooks/usePristineCardManager.ts), [card-lifecycle-registry.tsx](src/panels/card-lifecycle-registry.tsx).

### A4 — Selection, focus & keyboard *(part of your zone 1 · folds Gabriel's Part A/B)*
Sticky/transient model, multi-expand vs focus-halo, keyboard nav, a11y. Files: [anchored-card-store.ts](src/links/_shared/anchored-card-store.ts), [CardListPanel.tsx](src/panels/_shared/CardListPanel.tsx). **Folded in:**
- **Card-modes matrix (your A1) — DECIDE, gates the rest** (Decisions N1: proposal = selection ⟂ expansion, full 2×2).
- **Expand/collapse without selecting (your B1)** — the action fires directly, no select step.
- **Pop-out without selecting + pop-out from a *compressed* card (your B2)** — birth gesture decoupled from selection; coordinate with AF (the float result) per Seam 1.

### A5 — Surface: omni-view *(your zone 1 · folds Gabriel's B3)*
Card appearance/selection/filter/pin; cross-surface consistency with the docked panel. Files: [src/panels/Omni/](src/panels/Omni/), [omni-host.tsx](src/components/editor-layout/panels/omni-host.tsx). **Folded in — unanchored-card collision/reflow (your B3):** expanding unanchored notes must reflow / avoid collisions, not overwrite each other or a nearby anchored card (e.g. one on the title). Comes after expansion behavior (A4) settles.

### A6 — Surface: marginalia gutter
Markers, the deferred overflow design, click/drag/hover. Files: [Marginalia.tsx](src/components/Marginalia.tsx), [marginalia.ts](src/lib/marginalia.ts), [marginalia-grid.ts](src/lib/marginalia-grid.ts).

### A8 — Surface: print + reader/library
Per-kind rendering in print & the read-only reader. Files: [PrintAppendices.tsx](src/components/PrintAppendices.tsx), [print.ts](src/lib/print.ts), [chrome-config.ts](src/components/editor-layout/chrome-config.ts), [PaperRender.tsx](library/components/PaperRender.tsx).

### A9 — Internal appearance & typography *(your zone 5 · folds Gabriel's Part C + the morph chevron)*
Per-kind fonts/layout/typography, compressed-body, empty states. Files: per-panel `*Card.tsx` in [src/panels/](src/panels/), [panel-typography.ts](src/lib/panel-typography.ts), [panel-theme.ts](src/lib/panel-theme.ts), [STYLE_GUIDE.md](src/STYLE_GUIDE.md). **Folded in:**
- **Borrows-from-main-text display class (your C1):** examples, archives, **footnotes**, and any others the audit enumerates (likely cutter excerpts + revision-suggestion) must faithfully render links / atoms / text-objects / nested footnote phenomena (citation-in-footnote, math-in-footnote) — **display-only, nothing grabbable or actionable.**
- **Two typography classes (your C2):** main-text-derived notes → main-text font one step down on the panel size scale; everything else → standard sans. (Exact step: Decisions N2.)
- **Consistency pass (your C3):** enumerate the full card-type set; make all styling consistent against C1/C2.
- **Polymorphic morph chevron (your top-line ask):** a down-chevron beside the card-type label that switches a panel's morphs (note↔highlight, comment↔revision-suggestion, cutter-comment↔cutter-suggestion, report↔report-request), driven by A0's `cardKindsForPanel`; generalizes the existing revisions `convertCard` + `PanelCard.kindOptions`. Rendered in the unified header — docked here, popped via AF's `FloatChrome` title slot. Per-pair morph compatibility (note↔highlight is lossy) declared in `CARD_REGISTRY`.

### A10 — Cross-cutting integrations
AI requests (bridge; ephemeral cards), collab focus-claims, theming/color overrides (`aiRequest`/`error` hardcoded — inconsistency), persistence integrity. Files: [ai-request-bridge.ts](src/lib/ai-request-bridge.ts), [useCollab.ts](src/hooks/useCollab.ts), [panel-theme.ts](src/lib/panel-theme.ts), [usePersistentState.ts](src/hooks/usePersistentState.ts).

*(A7 absorbed into AF.)*

## 8. Cross-cutting constraints

- **Keystroke sanctity** — bake the `__virgilBusStats()` flat-on-typing check into every code chip.
- **Theming** — colors derive from one accent via `themeFromAccent`; semantic tokens only; resolve `aiRequest`/`error` hardcoding.
- **Persistence integrity** — `usePersistentState` debounced writes, stale-pipeline rejection, multi-window lock; migrate any key/schema change (incl. the §3 key-grammar migration); no silent data loss.

## 9. Gardening punch-list

grip-redesign disabled drags (TodoRow/QuotationGroupCard/ErrorCard) · vestigial detached toolbars + `AttachedPopover` + `menuLocation:"free"` · legacy `comments.json`/`useComments` · `legacySpawn` · dual example-block popout key.

---

## Decisions

### Settled (ratified session 3)
- **Polymorphic key + naming.** Kind-in-key for all 4 polymorphic panels (`float:<domain>:<kind>:<id>` carries the real kind); retire the shared `revision` prefix special-case; `comment`→`revision-comment`; drop bare `suggestion` (only an on-disk data discriminator). One rule for revisions/cutter/reports/notes — resolves the "five names" wart and the cutter/revision asymmetry. *(Reconciles A0's shared-prefix lean with AF's kind-in-key grammar toward the deeper, uniform fix.)*
- **`error` not poppable.** `CARD_REGISTRY.error.toFloatable` returns `null`; A1 deletes the dead popout wiring (ErrorCard's `<FloatCard>` early-return that never had a dispatch case). `ai` stays poppable.
- **Raise-on-click.** Float z-index derives from the MRU stack so clicking a buried float raises it (today z is insertion-order).
- **Per-domain `surface` kept** (cards = beige "panel", text-objects = white "card") as a legible, centrally-controlled `Floatable.surface` field — the header chrome is unified regardless.
- **Lifecycle gaps declared intentional now** (`todo`/`archive`/`example`/`report`/`report-request`); actual clone/delete fills deferred to **A3**.
- **Card registry at top-level `src/cards/`** (sibling to `text-objects/`/`links/`/`floats/`), absorbing the existing `src/lib/cards/`.
- **AF owns the popped header** (moved out of `PanelCard` into `FloatChrome`); A0/A9 keep the docked header; **AF-impl ordered before A9**.
- **Dual example key left intact** → A1 (gardening) decides any collapse.
- **AF consumes-not-relocates** `FloatingPanel`/dock/MRU (they also serve panels + dialogs).
- **Stackability = one shared mechanism** via `Floatable.snapshotForStack()` (answers Part D); fixes the text-object-floats-don't-stack bug by construction.
- **`cardFloatPositions` migrates in lockstep** with `poppedOutCards` (AF caught the prior D10 migration only did the latter → no saved-position loss).

### Ratified (was Open — settled session 3)
- **N1 — Card-modes matrix:** **selection ⟂ expansion (full 2×2).** *Expansion* = how much content shows (compressed ↔ full body), a display property. *Selection* = the focus/link relationship — three-surface highlight (text + margin + card), scroll-on-select, keyboard target, multi-select operand. Post-B1/B2, **selection no longer gates expand or pop-out**, and selecting does **not** auto-expand. Gates A4/B1/B2/B3.
- **N2 — Typography:** borrowed-content notes → main-text font **one step down on the panel-typography size scale** ([panel-typography.ts](src/lib/panel-typography.ts)); everything else → standard sans. The C-pass chip pins the exact px.

### Resolved by audit (no decision)
- **Borrowed-content full list (your C1/C3).** An audit output of the C consistency pass — beyond examples/archives/footnotes, candidates are **cutter cards** (main-text excerpts) and **revision-suggestion** (proposed text). The pass enumerates definitively.

---

## Chip Ledger

The management control surface. **Audit chips write to `docs/card-refactor/<ID>-audit.md` and return a summary; the management session consolidates into this doc and flips the rows below.** Implementation chips (Wave 3) appended once their audit lands.

| Chip ID | Arena | Wave | Type | Status | Audit file / worktree | Depends on |
|---|---|---|---|---|---|---|
| **A0-audit** | Card spine / SSOT *(card-only)* | 1 | audit | ✅ **landed** | `docs/card-refactor/A0-spine-audit.md` | — |
| **AF-audit** | `Floatable` presence *(cross-domain, window layer)* | 1 | audit | ✅ **landed** | `docs/card-refactor/AF-floatable-audit.md` | — |
| A0-impl | Card spine consolidation | 3 | impl | **ready** (next) | — | foundations ratified ✓ |
| AF-impl | `Floatable` subsystem *(re-pin to HEAD first)* | 3 | impl | **ready** (next) | — | foundations ratified ✓ |
| A1-audit | Gardening | 2 | audit | planned | — | A0 |
| A2-audit | Anchoring & link model | 2 | audit | planned | — | A0 |
| A3-audit | Creation & lifecycle | 2 | audit | planned | — | A0 |
| A4-audit | Selection/focus/keyboard | 2 | audit | planned | — | A0 |
| A5-audit | Omni-view | 2 | audit | planned | — | A0 |
| A6-audit | Marginalia gutter | 2 | audit | planned | — | A0 |
| A8-audit | Print + reader/library | 2 | audit | planned | — | A0 / AF |
| A9-audit | Appearance & typography | 2 | audit | planned | — | A0 |
| A10-audit | Cross-cutting integrations | 2 | audit | planned | — | A0 |

**Wave gates:** the two **Wave-1 foundations** (`A0`, `AF`) are read-only and non-conflicting (different code areas, separate audit files) — launch in either order or together. Wave-2 audits spawn after the foundations land & their designs are ratified. Wave-3 impl: `A0-impl` + `AF-impl` land first (foundations), then dependent arenas rebase, sequenced to limit conflicts on `panel-registry.ts` / `panel-primitives.tsx` / `marginalia.ts`. A1 (gardening) may land early.

## Coordination protocol

This doc is the refactor's SSOT, **owned by the management session.** Audit chips are read-only on code, write only their own `docs/card-refactor/<ID>-audit.md`, and return a concise summary. The management session reads those files, consolidates findings into §3–§6, flips the ledger rows, and gates the next wave. (Implementation chips, Wave 3, edit code + update their arena section + ledger row + Progress, serialized per the wave gates.)

## Working Pattern for chips

1. Read this doc end-to-end + [AGENTS.md](AGENTS.md) + the relevant `docs/agents/*` sub-doc.
2. **Audit chips:** read-only on all source; write only `docs/card-refactor/<ID>-audit.md`; return a summary. **Do not edit this doc.** **Implementation chips:** run `/plan`, get sign-off, then code.
3. **Keystroke sanctity:** card-source memos stay event-driven on `useStructuralRevisions`; verify `window.__virgilBusStats().emitCount` flat on plain typing.
4. **Two kinds, one presence:** never merge `TextObject` and `Card`; touch the text-object side only at the `Floatable` window layer (and only in `AF`).
5. **Verify (impl)** in the dev preview against `virgil-data/doc_devtest` (reload from `samples/annotation-history/` if choppy); walk the card kind across every surface it touches.
6. **Re-pin on start.** The tree moves under the refactor — re-verify every `file:line` against current HEAD before relying on it or editing. AF-impl gets an explicit re-pin pass (its inline float sites 15→14 after Quotations' deletion; `quotation:` prefix mooted).

## Definition of Done (whole refactor)

1. **Single card registry.** Adding a card kind = one `CARD_REGISTRY` entry (+ predicate/anchor membership). No edits to the other ~10 sync points.
2. **Single `Floatable` presence subsystem.** One window/chrome/stack-drop/float-policy implementation in `src/floats/`; both `Card` and `TextObject` satisfy `Floatable`; `FloatCard` renamed domain-neutral; **the two kinds remain ontologically distinct (no shared base type).**
3. **Naming/keying drift resolved** — no `suggestion`/`revision-suggestion` ambiguity, no theme-key/kind mismatches, **one** popout-key grammar, polymorphic panels registry-driven not per-consumer.
4. **Lifecycle coverage rationalized** — every kind's clone/delete/bindAnchor is intentional and registry-declared.
5. **Cross-surface coherence** — each kind verified consistent across docked / omni / float / marginalia / print / reader; **all floats obey one policy** (sizing, viewport, z-index, focus).
6. **Gardening complete** — §9 punch-list gone.
7. **Keystroke sanctity intact** — `__virgilBusStats()` flat on plain typing across all card-bearing panels.
8. **No silent data loss** — prefs/sidecar + popout-key migrations clean.
9. **Dev preview verified** — walk every card kind through creation, selection, anchoring, pop-out, drop-to-stack, clone, delete; pop out a text-object and a card and confirm identical window behavior.

---

*This is a working planning document for a single refactor. Archive or delete it once the refactor lands.*
