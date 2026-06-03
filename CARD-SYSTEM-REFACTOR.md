# Card-System Refactor — A Unified Card Registry & a Shared `Floatable` Presence

A deep overhaul of Virgil's card system, run as a **management session**: this doc is the single source of truth, and tasks are spun off as **chips** (one worktree/session each) tracked in the Chip Ledger. The card system is *the un-migrated half* left behind by the text-object refactor — [TEXT-OBJECT-REFACTOR.md](TEXT-OBJECT-REFACTOR.md) already solved "scattered kind-definition" for editor blocks, and this refactor mirrors that pattern for cards.

**Governing ontology (§2).** Virgil has **two basic kinds of things: `TextObject`** (graspable pieces of the document) **and `Card`** (annotation/apparatus anchored to them). They are distinct kinds and are **not merged** — there is no shared base type. The *only* thing they share is their **popped-out physical presence** — the floating window — captured by a **`Floatable` role both satisfy by composition** (§3).

**Strategy.** audit-first · **two foundations** (the card spine §5 and the `Floatable` presence §3) land before dependent arenas rebase onto them · the two kinds stay ontologically distinct — we touch the text-object side **only at the shared window layer**, nowhere else · keystroke sanctity is sacred.

---

## Progress

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

> ⚠️ **Seeded from the kickoff discussion's read of the architecture — file paths/line numbers are best-effort and may have drift. The A0-audit chip verifies & corrects this section with exact `file:line`.**

**The ~11 hand-synced card-kind definition sites (the core problem).** Adding/changing a card kind today touches all of these:

| Sync point | File (verify) |
|---|---|
| `CardKind` union | `src/panels/_shared/types.ts` (one report said `src/lib/types.ts` — **resolve which is canonical**) |
| `PANEL_REGISTRY`, `CARD_KEY_PREFIXES`, `CARD_TYPE_LABELS`, `CARD_TITLE_LABELS` | [src/panels/panel-registry.ts](src/panels/panel-registry.ts) |
| `CARD_THEMES` | [src/components/panel-primitives.tsx](src/components/panel-primitives.tsx) |
| `CardLifecycleRegistry` (clone/delete/bindAnchor) | [src/panels/card-lifecycle-registry.tsx](src/panels/card-lifecycle-registry.tsx) + wiring in [src/components/EditorPane.tsx](src/components/EditorPane.tsx) |
| `ANCHORED_CARD_KINDS` | [src/links/_shared/entity-hover.ts](src/links/_shared/entity-hover.ts) |
| `MARKER_META` / `MarkerType` + `MIME_*` card constants | [src/lib/marginalia.ts](src/lib/marginalia.ts) |
| Drop-spec registry | [src/components/drop-mode/registry.ts](src/components/drop-mode/registry.ts) |

**The 16 card kinds:** `note`, `highlight`, `footnote`, `citation`, `quotation`, `example`, `todo`, `archive`, `comment`, `suggestion`, `cutter-comment`, `cutter-suggestion`, `revision-suggestion`, `bib`, `ai`, `error`. (13 anchored; `bib`/`ai`/`error` not.)

**3 polymorphic panels** (registry `card: null`, via `POLYMORPHIC_CARD_PANEL`): Notes (`note`+`highlight`), Revisions (`comment`+`revision-suggestion`), Cutter (`cutter-comment`+`cutter-suggestion`).

**Surfaces a card appears on:** docked side panel · omni-view · **popped-out float** · marginalia gutter (nav only) · stack (thumbnail) · print · reader/library (read-only).

**Known naming/keying warts (resolve in the card SSOT):** `suggestion` vs `revision-suggestion` (both labeled "Revision"); `cut` theme vs `cutter-*` kinds; `quote` theme vs `quotation` kind (opts out of `CARD_THEMES`, styles inline); example-block popout carries **two** keys (`textobject:exampleBlock:<uuid>` + legacy `example:<uuid>`); polymorphic panels are a special-case branch in every consumer.

**Lifecycle coverage gaps:** clone/delete/bindAnchor exist for `footnote`, `citation`, `note`, `highlight`, `comment`, `suggestion`, `cutter-comment`, `cutter-suggestion` — **none for `todo`, `archive`, `quotation`, `example`** (and `bib`/`ai`/`error` by design). Intentional or drift?

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

The 16 kinds, the 3 polymorphic panels, and the anchored/non-anchored split (cheat-sheet). The `A0`-audit produces the authoritative, code-verified taxonomy: creatable vs system-generated (`bib`/`ai`/`error`), anchored vs not, and the canonical home of `CardKind`.

## 5. Target Card Registry Shape (the new SSOT) — card-only

> **Placeholder — filled in from the `A0`-audit.** A `CARD_REGISTRY: Record<CardKind, CardMeta>` mirroring `TEXT_OBJECT_REGISTRY`: one descriptor per kind driving `label` / `titleLabel` / `keyPrefix` / `themeKey` / `anchored` / `lifecycle` (clone/delete/bindAnchor) / in-doc `dropSpec` / `markerMeta` / `panel`. **Float handling is NOT defined here** — the descriptor exposes `toFloatable(id): Floatable` plugging into §3's shared contract; the card registry never defines float-window internals. Define the canonical predicate(s) replacing `ANCHORED_CARD_KINDS` and the polymorphic-panel branches.

## 6. Current Fragmentation to Retire

> **Placeholder — filled in from the `A0`-audit** as a `Surface | File(s) (file:line) | Disposition` table (one row per sync point + per wart). The `AF`-audit adds the float-presence fragmentation (duplicated chrome, key prefixes, per-kind float logic).

## 7. The Arenas

Two foundations (`A0`, `AF`), then the dependent arenas. Each becomes a read-only **audit chip** then **implementation chip(s)**. Your original five review zones map on as noted.

### A0 — Spine: card SSOT consolidation *(FOUNDATION · card-only)*
- **Scope:** the ~11 sync points → one `CARD_REGISTRY`; resolve naming/keying warts; define canonical predicates. **Float presence is out of scope here** — expose `toFloatable()` (§3), don't design it.
- **Key files:** the cheat-sheet's sync-point table.
- **DoD:** adding a card kind = one registry entry (+ predicate/anchor membership). No edits to the other ~10 sync points.

### AF — `Floatable` presence abstraction *(FOUNDATION · the ONE sanctioned cross-domain arena, window layer only)*
- **Scope:** formalize the implicitly-shared float machinery into `src/floats/` + the `Floatable` contract; unify chrome; unify the key grammar (+ migration); enforce one float policy. Both `Card` and `TextObject` produce `Floatable`. **Do NOT touch either ontology/registry or in-doc behavior; do NOT merge the kinds.**
- **Key files:** [FloatingPanel.tsx](src/components/FloatingPanel.tsx), [FloatingCards.tsx](src/components/FloatingCards.tsx), [TextObjectFloat.tsx](src/text-objects/TextObjectFloat.tsx), [usePoppedCards.ts](src/hooks/usePoppedCards.ts), [spawn-position.ts](src/components/editor-layout/spawn-position.ts), [stack/](src/components/stack/) + [src/lib/stack/](src/lib/stack/), [dock-drag.ts](src/components/editor-layout/dock-drag.ts).
- **Covers your zones 2 & 3** (pop-out behavior, drop-onto-stack). Absorbs the old A7.

### A1 — Gardening *(your zone 4)*
Dead/vestigial removal: grip-redesign disabled drags (TodoRow/QuotationGroupCard/ErrorCard); vestigial `DetachedActionsToolbar`/`Formatting`/`Menu`; unused `AttachedPopover`; unreachable `menuLocation:"free"`; legacy `comments.json`/`useComments`; `legacySpawn`; the dual example-block key. Mostly leaf-file deletions → can land early.

### A2 — Anchoring & link model
Mode A/B, `linkedAnchor`, three-surface hover, orphans, re-anchor-by-drag. Files: [src/links/](src/links/), [linked-anchor.ts](src/lib/tiptap/linked-anchor.ts), [anchored-card-store.ts](src/links/_shared/anchored-card-store.ts). Open: is `EntityKind` redundant with the registry's `anchored` flag?

### A3 — Creation & lifecycle
3 creation entry points → one pipeline; pristine-card auto-discard; clone/delete/bindAnchor coverage gaps. Files: [card-creation.ts](src/components/editor-layout/card-actions/card-creation.ts), [usePristineCardManager.ts](src/hooks/usePristineCardManager.ts), [card-lifecycle-registry.tsx](src/panels/card-lifecycle-registry.tsx).

### A4 — Selection, focus & keyboard *(part of your zone 1)*
Sticky/transient model, multi-expand vs focus-halo, keyboard nav, a11y. Files: [anchored-card-store.ts](src/links/_shared/anchored-card-store.ts), [CardListPanel.tsx](src/panels/_shared/CardListPanel.tsx).

### A5 — Surface: omni-view *(your zone 1)*
Card appearance/selection/filter/pin; cross-surface consistency with the docked panel. Files: [src/panels/Omni/](src/panels/Omni/), [omni-host.tsx](src/components/editor-layout/panels/omni-host.tsx).

### A6 — Surface: marginalia gutter
Markers, the deferred overflow design, click/drag/hover. Files: [Marginalia.tsx](src/components/Marginalia.tsx), [marginalia.ts](src/lib/marginalia.ts), [marginalia-grid.ts](src/lib/marginalia-grid.ts).

### A8 — Surface: print + reader/library
Per-kind rendering in print & the read-only reader. Files: [PrintAppendices.tsx](src/components/PrintAppendices.tsx), [print.ts](src/lib/print.ts), [chrome-config.ts](src/components/editor-layout/chrome-config.ts), [PaperRender.tsx](library/components/PaperRender.tsx).

### A9 — Internal appearance & typography *(your zone 5)*
Per-kind fonts/layout/typography, compressed-body, empty states. Files: per-panel `*Card.tsx` in [src/panels/](src/panels/), [panel-typography.ts](src/lib/panel-typography.ts), [panel-theme.ts](src/lib/panel-theme.ts), [STYLE_GUIDE.md](src/STYLE_GUIDE.md).

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

## Chip Ledger

The management control surface. **Audit chips write to `docs/card-refactor/<ID>-audit.md` and return a summary; the management session consolidates into this doc and flips the rows below.** Implementation chips (Wave 3) appended once their audit lands.

| Chip ID | Arena | Wave | Type | Status | Audit file / worktree | Depends on |
|---|---|---|---|---|---|---|
| **A0-audit** | Card spine / SSOT *(card-only)* | 1 | audit | **spun-off** | `docs/card-refactor/A0-spine-audit.md` | — |
| **AF-audit** | `Floatable` presence *(cross-domain, window layer)* | 1 | audit | **spun-off** | `docs/card-refactor/AF-floatable-audit.md` | — |
| A0-impl | Card spine consolidation | 3 | impl | planned | — | A0+AF audits ratified |
| AF-impl | `Floatable` subsystem | 3 | impl | planned | — | A0+AF audits ratified |
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
