# AF-audit — the `Floatable` presence subsystem

> Read-only audit + design for the **AF** foundation arena of the card-system refactor.
> Scope is **strictly the popped-out window/presence layer** shared by `Card` and `TextObject`.
> This chip proposes **no** changes to either kind's ontology, registry, identity, in-document
> behavior, sync model, or anchoring, and **never merges the two kinds**. The two registries stay
> separate; they only both *produce* a `Floatable`.
>
> Verified against `HEAD` = `486a462` on 2026-06-01. All `file:line` are best-effort exact;
> the impl chip should re-pin any that drift.

---

## 0. TL;DR

- The shared float substrate **already exists implicitly** and is **already substantial**: one
  low-level window (`FloatingPanel`), one drag/undock/redock/stack-hit engine, one MRU focus stack +
  Cmd-W, one spawn-position helper, one popped-state store (`prefs.poppedOutCards` /
  `cardFloatPositions`), one stack-drop event bus, one height-cap policy. **These are not the
  problem.**
- What is **duplicated / divergent** sits in a thin band on top: the **float wrapper** (cards inline
  `<FloatCard>` in **15** component files; text-objects funnel through **one** `TextObjectFloat`), the
  **dispatch** (a 14-case prefix `switch` that mixes both domains), the **chrome header** (two
  separate header implementations + the jump-chevron glyph drawn twice), the **surface** (`panel` vs
  `card`), the **z-index base** (`1200` vs `FLOATING_PANEL_Z_BASE`), and the **key grammar** (flat
  `<prefix>:<id>` vs `textobject:<kind>:<id>`).
- The AF work is therefore mostly **formalize + rename + unify**, not rebuild: extract a `src/floats/`
  module exposing a `Floatable` contract; collapse the 15 inline wrappers + the 14-case switch into
  **one** generic `FloatWindow` driven by `registry.toFloatable(id)`; promote the text-object header
  to the single chrome skeleton; unify the key grammar to `float:<domain>:<kind>:<id>` with a
  prefs migration that rewrites `poppedOutCards` **and** `cardFloatPositions` in lockstep.

---

## 1. Current float reality (READ-ONLY map)

For each surface: exact `file:line`, and whether it is **ALREADY SHARED** by both domains or
**DUPLICATED / DIVERGENT** across the card side and the text-object side.

### 1.1 Low-level window — ALREADY SHARED
- [`src/components/FloatingPanel.tsx`](../../src/components/FloatingPanel.tsx) — the draggable/resizable
  portal window. Min 240×200, max 900×(vh−40) (clamps at `FloatingPanel.tsx:209-210`, `:304-305`).
  Owns: header drag → move ([`:387`](../../src/components/FloatingPanel.tsx)); docked→floating
  **undock** with continuous gesture ([`:191-228`](../../src/components/FloatingPanel.tsx)); **redock**
  proximity test + `onMaybeRedock` ([`:350-375`](../../src/components/FloatingPanel.tsx)); the
  **stack-hit** detection during drag ([`:240-259`](../../src/components/FloatingPanel.tsx), `:318-342`);
  shift-drag → drop-mode session ([`:400-409`](../../src/components/FloatingPanel.tsx)); imperative
  `beginDragAt` handoff for lift-off ([`:510-527`](../../src/components/FloatingPanel.tsx)).
- **Three direct consumers** of `FloatingPanel`: `FloatCard`
  ([`FloatingCards.tsx:162`](../../src/components/FloatingCards.tsx)) → cards **and** text-objects;
  floating **panels** ([`EditorPane.tsx:3363`](../../src/components/EditorPane.tsx)); and the Fonts
  **dialog** ([`FontsDialog.tsx:169`](../../src/components/FontsDialog.tsx)). The `Floatable`
  subsystem sits **above** `FloatingPanel` and unifies the card+text-object band only; panels (which
  need dock semantics cards don't) and dialogs keep mounting `FloatingPanel` directly.

### 1.2 Card float wrapper — DUPLICATED (15 inline sites)
- [`FloatCard`](../../src/components/FloatingCards.tsx) at
  [`FloatingCards.tsx:38`](../../src/components/FloatingCards.tsx) — wraps a card's JSX in a
  `FloatingPanel`, reads/writes `cardFloatPositions`, runs the lift-handoff
  ([`:67-74`](../../src/components/FloatingCards.tsx)) and a **text-object-only auto-fit** grow burst
  ([`:86-160`](../../src/components/FloatingCards.tsx), gated on `.par-float-body` + `liftMode`).
- Each card component re-implements the **same popped early-return**:
  `if (isPoppedOut) return <FloatCard cardKey={cardKey}>{card}</FloatCard>;`. Confirmed in **15**
  files:
  [`NoteCard.tsx:148`](../../src/panels/Notes/NoteCard.tsx),
  [`HighlightCard.tsx`](../../src/panels/Notes/HighlightCard.tsx),
  [`FootnoteCard.tsx`](../../src/panels/Footnotes/FootnoteCard.tsx),
  [`CitationCard.tsx`](../../src/panels/Citations/CitationCard.tsx),
  [`QuotationGroupCard.tsx`](../../src/panels/Quotations/QuotationGroupCard.tsx),
  [`RevisionCommentCard.tsx`](../../src/panels/Revisions/RevisionCommentCard.tsx),
  [`RevisionSuggestionCard.tsx`](../../src/panels/Revisions/RevisionSuggestionCard.tsx),
  [`CutterCommentCard.tsx`](../../src/panels/Cutter/CutterCommentCard.tsx),
  [`CutterSuggestionCard.tsx`](../../src/panels/Cutter/CutterSuggestionCard.tsx),
  [`TodoRow.tsx`](../../src/panels/Todo/TodoRow.tsx),
  [`ArchiveCard.tsx`](../../src/panels/Archive/ArchiveCard.tsx),
  [`ExampleCard.tsx`](../../src/panels/Examples/ExampleCard.tsx),
  [`ErrorCard.tsx`](../../src/panels/Errors/ErrorCard.tsx),
  [`BibEntryCard.tsx`](../../src/components/BibEntryCard.tsx) (`<FloatCard cardKey={popKey}>`),
  and [`panel-primitives.tsx:2076`](../../src/components/panel-primitives.tsx) (`AiRequestCard`,
  `<FloatCard cardKey={popKey}>`).

### 1.3 Text-object float wrapper — SHARED across text-object kinds, SEPARATE from cards
- [`src/text-objects/TextObjectFloat.tsx`](../../src/text-objects/TextObjectFloat.tsx) — **one**
  component for every text-object kind. **Confirmed: it wraps `FloatCard`** at
  [`TextObjectFloat.tsx:90`](../../src/text-objects/TextObjectFloat.tsx)
  (`<FloatCard cardKey={cardKey} surface="card">`), then renders its **own** 24px header via
  `FloatHeaderContent` ([`:96`](../../src/text-objects/TextObjectFloat.tsx)) and a per-kind body via
  `meta.floatBodyComponent`. So `FloatCard` is **misnamed** — it already hosts text-objects (per the
  refactor doc's recon, confirmed).
- This is the proof that the text-object side **already solved** "one wrapper for N kinds." The card
  side has not.

### 1.4 In-panel → popped transition for cards
- There is **no `FloatCard` early-return inside `PanelCard`** itself. The transition lives in each
  card component (§1.2). `PanelCard`
  ([`panel-primitives.tsx:1456`](../../src/components/panel-primitives.tsx)) renders the card's
  **unified header** ([`:1664-1691`](../../src/components/panel-primitives.tsx)) for **both** docked
  and popped states; when popped it additionally renders `CardJumpChevron`
  ([`:1683-1685`](../../src/components/panel-primitives.tsx)) and `CardPopoutButton` (the X,
  [`:1688-1690`](../../src/components/panel-primitives.tsx)). The popped card's border/rounding is
  stripped by `themedCardStyle(..., {isPoppedOut})`
  ([`panel-primitives.tsx:160-162`](../../src/components/panel-primitives.tsx)) so `FloatingPanel`'s
  pod chrome surrounds it. The **lift-to-popout** gesture (drag the docked card header out) lives on
  `PanelCard.onWrapperMouseDown` ([`:1526-1644`](../../src/components/panel-primitives.tsx)) and hands
  off via `card-lift.ts`.

### 1.5 Popped-state + keys — ALREADY SHARED store, TWO key grammars
- Store: `prefs.poppedOutCards: string[]` + `prefs.cardFloatPositions: Record<string, rect>`
  ([`useViewPrefs.ts:119`](../../src/hooks/useViewPrefs.ts), `:121`). Mutators
  `toggleCardPopout` ([`:1332`](../../src/hooks/useViewPrefs.ts)),
  `closeCardPopout` ([`:1352`](../../src/hooks/useViewPrefs.ts)),
  `setCardFloatPosition` ([`:1363`](../../src/hooks/useViewPrefs.ts)),
  `migratePoppedOutCards` ([`:1377`](../../src/hooks/useViewPrefs.ts)).
- Context: `usePoppedCards()` ([`src/hooks/usePoppedCards.ts`](../../src/hooks/usePoppedCards.ts)),
  provided once in EditorPane ([`EditorPane.tsx:1111-1135`](../../src/components/EditorPane.tsx),
  mounted `:2964`). **Both domains read the same context + the same `poppedOutCards` array** — the
  store is already kind-blind.
- **Key prefixes actually in use** (the dispatcher `renderPoppedCard`,
  [`floating-cards.tsx:200-540`](../../src/components/editor-layout/floating-cards.tsx)):

  | Prefix in `poppedOutCards` | Built by | Dispatched at | Notes |
  |---|---|---|---|
  | `note:` `highlight:` `footnote:` `archive:` `todo:` `bib:` `citation:` `quotation:` `ai:` | `cardPopKey` / `popKey` ([`panel-registry.ts:277-290`](../../src/panels/panel-registry.ts)) | `floating-cards.tsx` cases | one card each |
  | `revision:` | `CARD_KEY_PREFIXES.comment = "revision"` ([`panel-registry.ts:200`](../../src/panels/panel-registry.ts)) | `case "revision"` ([`:418`](../../src/components/editor-layout/floating-cards.tsx)) | **resolves comment vs suggestion from `card.kind`**, not the key |
  | `cutter-comment:` `cutter-suggestion:` | `CARD_KEY_PREFIXES` | two cases | cutter is **split** by key (asymmetric with revisions) |
  | `example:` | `CARD_KEY_PREFIXES.example` | `case "example"` ([`:517`](../../src/components/editor-layout/floating-cards.tsx)) | **panel card** (Examples) |
  | `textobject:<kind>:` | `textObjectPopoutKey` ([`text-object-registry.ts:935`](../../src/text-objects/text-object-registry.ts)) | `case "textobject"` ([`:494`](../../src/components/editor-layout/floating-cards.tsx)) → re-parse via `parseTextObjectPopoutKey` ([`:943`](../../src/text-objects/text-object-registry.ts)) → `TextObjectFloat` | the **only** domain-tagged grammar |
  | `textobject:exampleBlock:` | `textObjectPopoutKey` | `case "textobject"` | the **block** twin of `example:` — the dual-key wart |

  **Declared-but-undispatched prefixes** (drift the registry can't catch today): `suggestion:` and
  `revision-suggestion:` exist in `CARD_KEY_PREFIXES` ([`panel-registry.ts:201,204`](../../src/panels/panel-registry.ts))
  but have **no case** in `renderPoppedCard`; `error:` exists in `CARD_KEY_PREFIXES`
  ([`:208`](../../src/panels/panel-registry.ts)) and `ErrorCard` *has* a `<FloatCard>` early-return, but
  there is **no `case "error"`** in the dispatcher — so a popped error would silently render nothing.
  (Taxonomy fix is A0's; from the float side this is exactly the drift `toFloatable()` eliminates.)

### 1.6 Spawn position — ALREADY SHARED
- [`spawn-position.ts`](../../src/components/editor-layout/spawn-position.ts):
  `computeSpawnPosition(anchor, size, opts)` ([`:39`](../../src/components/editor-layout/spawn-position.ts))
  (quadrant-aware, viewport-clamped) and `computeColumnSpawnRect(side)`
  ([`:91`](../../src/components/editor-layout/spawn-position.ts)). Used by cards via
  `toggleAtAnchor`/`popOutAtRect` ([`EditorPane.tsx:1118-1129`](../../src/components/EditorPane.tsx))
  and `popCardAtAnchor` ([`:1072`](../../src/components/EditorPane.tsx)).
- **Default-size constants are scattered**, though: `POPUP_W/H = 360/280`
  ([`EditorPane.tsx:230-231`](../../src/components/EditorPane.tsx)); `DEFAULT_W/H = 360/280`
  ([`FloatingCards.tsx:13-14`](../../src/components/FloatingCards.tsx)); `LIFT_FLOAT_W/H = 360/280`
  ([`panel-primitives.tsx:1453-1454`](../../src/components/panel-primitives.tsx)); text-objects use
  per-kind `initialFloatSize` ([`text-object-registry.ts:255-259` field](../../src/text-objects/text-object-registry.ts)).
  Three copies of `360×280`.

### 1.7 Z-index / MRU / Cmd-W focus stack
- **MRU focus stack — ALREADY SHARED + already kind-uniform.** Lives in **EditorLayout**:
  `FloatingRef` union (`panel` | `card` | `toolbar`) + `focusStack` state
  ([`EditorLayout.tsx:851-859`](../../src/components/EditorLayout.tsx)); `focusFloating(ref)`
  ([`:860-867`](../../src/components/EditorLayout.tsx)); prune/append reconcile from
  `poppedOutPanels` + `poppedOutCards` ([`:873-890`](../../src/components/EditorLayout.tsx)); **Cmd-W**
  closes the frontmost ([`:895-908`](../../src/components/EditorLayout.tsx)). `focusFloating` is
  injected into the `viewPrefs` bundle and called as `recordFocus`
  ([`EditorPane.tsx:1133`](../../src/components/EditorPane.tsx)) and on panel/toolbar focus
  ([`:3380`,`:3065`,`:3101`,`:3127`](../../src/components/EditorPane.tsx)).
- **Z-index — DIVERGENT base.** Cards/text-objects: `zIndex={1200 + indexHint}` (hardcoded `1200`,
  [`FloatingCards.tsx:169`](../../src/components/FloatingCards.tsx)). Panels:
  `FLOATING_PANEL_Z_BASE + i` (= 1000 + i, [`EditorPane.tsx:3372`](../../src/components/EditorPane.tsx),
  constant at [`constants.ts:18`](../../src/components/editor-layout/constants.ts)). Detached toolbars:
  `z-[9999]`. **Z is insertion-order, not MRU** — the focus stack drives only Cmd-W, never paint order
  (explicit at [`EditorLayout.tsx:849`](../../src/components/EditorLayout.tsx)). So clicking a buried
  float does *not* raise it.

### 1.8 Stack-drop — ALREADY SHARED dispatch, per-kind serialization
- Signal + hit-test: [`stack-drop-target.ts`](../../src/lib/stack/stack-drop-target.ts)
  (`setStackDropTarget`/`isOverStackIcon`/`isHeaderOverStackIcon`, icon rect cached by `StackIcon`).
- Producer: `FloatingPanel` lights the ring on `onMove` ([`:240-259`](../../src/components/FloatingPanel.tsx))
  and fires the `virgil-stack-drop` CustomEvent on `onUp`
  ([`:318-341`](../../src/components/FloatingPanel.tsx)).
- Consumer: **EditorPane** `virgil-stack-drop` listener ([`EditorPane.tsx:824-888`](../../src/components/EditorPane.tsx))
  — parses the key prefix, then branches: `paragraph`/`heading` → `snapshotParagraph`/
  `snapshotHeadingSection`; else → `cardKeyPrefixToStackKind(prefix)`
  ([`resolve-card.ts:27`](../../src/lib/stack/resolve-card.ts)) + `resolveCardData` + `snapshotCard`.
  Serialization in [`snapshot.ts`](../../src/lib/stack/snapshot.ts). **This prefix switch is a third
  place that must learn every kind** (alongside `renderPoppedCard` and `CARD_KEY_PREFIXES`).
- Note: the consumer still reads **legacy `paragraph:`/`heading:` prefixes**
  ([`EditorPane.tsx:840-843`](../../src/components/EditorPane.tsx)) even though live keys are
  `textobject:paragraph:` post-D10 — so text-object stack-drop currently routes through the `else`
  branch and `cardKeyPrefixToStackKind("textobject")` returns `null` → **text-object floats may not
  snapshot to the stack at all today.** Flag for the impl chip to verify (the generic
  `snapshotForStack()` fixes it by construction).

### 1.9 Re-dock + dock outline — ALREADY SHARED (panel-centric)
- [`dock-drag.ts`](../../src/components/editor-layout/dock-drag.ts) — module-level `{slotKey, rect,
  companionRect}` signal (`setDockDragTarget`/`useDockDragTarget`, `:38-73`), proximity finder
  `findDockTargetByPanelProximity` ([`:266`](../../src/components/editor-layout/dock-drag.ts)),
  point finder `findDockTargetAtPoint` ([`:95`](../../src/components/editor-layout/dock-drag.ts)).
- [`DockOutline.tsx`](../../src/components/editor-layout/DockOutline.tsx) — body-portaled WAAPI
  crossfade outline (`:38`), mounted from EditorPane (`~:2965`).
- Cards/text-objects **opt out**: `FloatCard` passes no `onMaybeRedock`/`onUndock`, and
  `FloatingPanel` skips the dock-outline path entirely when `onMaybeRedock` is absent
  ([`:264-266`](../../src/components/FloatingPanel.tsx)). So the dock machinery is shared *code* but a
  *panel-only behavior*. **AF keeps it panel-only** — `Floatable.canRedock` defaults false.

### 1.10 Chrome comparison — DIVERGENT
| Aspect | Card popped header | Text-object popped header |
|---|---|---|
| Implementation | `PanelCard` unified header ([`panel-primitives.tsx:1669-1691`](../../src/components/panel-primitives.tsx)) | `FloatHeaderContent` ([`FloatHeaderContent.tsx:64`](../../src/text-objects/FloatHeaderContent.tsx)) |
| Height | `h-6` (24px) | `h-6` (24px) — same |
| Grip glyph | `CardDragHandle` (6-dot) present | **none** |
| Title | `CardKindHeader` (kind label / dropdown) | label span (+ per-instance `setHeaderLabel`) |
| Trailing slot | `headerTrailing` (claim pill / AI checkbox / presence dots) | none (source-missing is rendered in the **body**) |
| Jump | `CardJumpChevron` ([`:376`](../../src/components/panel-primitives.tsx)) — polyline `9 6 15 12 9 18` | inline `<button>` ([`FloatHeaderContent.tsx:79-99`](../../src/text-objects/FloatHeaderContent.tsx)) — **same** polyline, **redrawn** |
| Close | `CardPopoutButton` = `PopoutButton variant="x"` | `PopoutButton variant="x"` — **shared primitive** ([`panel-primitives.tsx:1158`](../../src/components/panel-primitives.tsx)) |
| Surface | `"panel"` (beige pod, strong shadow) | `"card"` (white surface, ambient shadow) — divergent |

**Already shared in the chrome:** `PopoutButton`/`POPOUT_BUTTON_CLASS` (the X) and the height. **Divergent:**
everything else — two header components, the jump glyph drawn twice, the grip present on one side only,
the surface treatment.

---

## 2. The `Floatable` contract (finalized)

A thin behavioral contract — **composition, not a base class**. A `Card` *has* a floating presence;
a `TextObject` *has* a floating presence. The subsystem is blind to which kind it holds.

```ts
// src/floats/types.ts
export type FloatDomain = "card" | "textobject";

/** Visual treatment of the window shell (today: cards→"panel", text→"card"). */
export type FloatSurface = "panel" | "card";

/** Context handed to renderBody() at mount/refresh time. Domain-specific;
 *  the subsystem passes the matching bag through opaquely. The CARD bag is
 *  today's `PoppedCardDeps` (owned by A0/A3); the TEXTOBJECT bag is `{ editorRef }`.
 *  AF does NOT define their internals — only that toFloatable() receives one. */
export type FloatRenderCtx = unknown;

export interface FloatChromeSlots {
  /** Narrow region between title and jump/close: status dot, claim pill,
   *  AI checkbox, source-missing indicator. The ONLY domain-contributed
   *  header region (Seam 2 budget: 1 slot + a title override). */
  trailing?: React.ReactNode;
}

export interface Floatable {
  /** Unified popout key — `float:<domain>:<kind>:<id>`. Parses back via parseFloatKey(). */
  key: string;
  domain: FloatDomain;
  kind: string;                 // CardKind | TextObjectKind (string at this layer)
  id: string;

  /** Header label. May be overridden per-instance during the float's life
   *  (heading level → "Chapter"/"Section"); see setTitle in the render ctx. */
  title: string;

  /** Visual shell treatment. */
  surface: FloatSurface;

  /** The specialized content — headerless (the skeleton owns the header). */
  renderBody(): React.ReactNode;

  /** Optional header slots the domain contributes (Seam 2). */
  chromeSlots?: FloatChromeSlots;

  /** Reveal where this thing actually lives (scroll-to + select). */
  jumpToSource(): void;
  /** Whether the float shows the jump affordance (some cards have no anchor). */
  canJump: boolean;

  /** Serialize onto the Stack. Returns null when this kind isn't stackable
   *  (ai / error / examples / text-object sub-objects). Replaces the prefix
   *  switch + cardKeyPrefixToStackKind in EditorPane's stack-drop handler. */
  snapshotForStack(source: { docId: string | null; docTitle?: string }): StackItem | null;

  /** Initial float size. Omit → subsystem default (FLOAT_DEFAULT_SIZE). */
  defaultSize?: { w: number; h: number };
  /** NOT LANDED — design sketch only. The spawn-at-rect need is met by the
   *  lift pipeline (TextObjectGrabHandle `liftSpawnRect` / `popOutAtRect`);
   *  anchor spawns use `computeSpawnPosition`. The live `Floatable`
   *  (src/floats/types.ts) ends at `defaultSize`. Kept as design history. */
  spawnHint?: DOMRect;
}
```

**Deltas from the §3 sketch in `CARD-SYSTEM-REFACTOR.md`, and why:**
- **Added `domain`, `kind`, `id`** — the subsystem must dispatch, build/parse keys, and apply
  per-domain policy (surface default, `canRedock`) without re-parsing strings.
- **Added `surface`** — cards and text-objects genuinely differ here today (§1.10); keep it a
  per-domain visual choice rather than forcing one look.
- **Added `chromeSlots` + `canJump`** — Seam 2 needs a typed slot; `canJump` already varies per card
  (`getLinkedTextObjectIds(...).length > 0`, e.g. [`floating-cards.tsx:209`](../../src/components/editor-layout/floating-cards.tsx)).
- **`snapshotForStack` returns `StackItem | null`** (not a non-null `StackSnapshot`) — matches the
  reality that `snapshotCard`/`snapshotParagraph` already return `| null`
  ([`snapshot.ts:99,134,162,195`](../../src/lib/stack/snapshot.ts)) and that several kinds aren't
  stackable.
- **`renderBody()` is headerless** — the header moves to the skeleton (Seam 2). Per-instance title
  changes flow through a `setTitle` callback in the render ctx (generalizing today's
  `setHeaderLabel`, [`TextObjectFloat.tsx:69-73`](../../src/text-objects/TextObjectFloat.tsx)).

**Integration point (NOT designed here):** each registry exposes a factory the subsystem calls:

```ts
// in CARD_REGISTRY[kind]  — designed by the A0 chip; AF only consumes this signature
toFloatable(id: string, ctx: CardFloatCtx): Floatable | null;
// in TEXT_OBJECT_REGISTRY[kind]
toFloatable(id: string, ctx: TextObjectFloatCtx): Floatable | null;
```

`CardFloatCtx` ≈ today's `PoppedCardDeps` ([`floating-cards.tsx:44-193`](../../src/components/editor-layout/floating-cards.tsx));
`TextObjectFloatCtx` ≈ `{ editorRef }`. **AF defines the `Floatable` interface and the `toFloatable`
*signature* only; the registries and their ctx bags are A0's.**

---

## 3. The `src/floats/` module + rename plan

New top-level module, sibling to `src/text-objects/`, `src/links/`, and the new `src/cards/` (A0):

```
src/floats/
  types.ts            Floatable, FloatDomain, FloatSurface, FloatChromeSlots, FloatRenderCtx
  float-key.ts        buildFloatKey({domain,kind,id}) / parseFloatKey(key) + migrateFloatKeys()
  FloatWindow.tsx     renamed FloatCard — generic window wrapper (domain-neutral); owns surface,
                      position read/write, lift-handoff, auto-fit hook delegation
  FloatChrome.tsx     the ONE chrome skeleton (promoted from FloatHeaderContent): grip · title ·
                      <trailing slot> · jump · redock · close
  FloatHost.tsx       generic dispatcher: maps each key in poppedOutCards → toFloatable → <FloatWindow>
                      (replaces renderPoppedCard's 14-case switch)
  float-policy.ts     FLOAT_DEFAULT_SIZE, FLOAT_Z_BASE (re-exports FLOATING_PANEL_Z_BASE), viewport
                      clamp + capPopoutHeight (relocated from text-object-registry), spawn helpers
  useFloatState.ts    thin re-export/adapter over usePoppedCards() so callers import from src/floats
```

**Rename: `FloatCard` → `FloatWindow`.** It already hosts text-objects, so `…Card` is wrong. Touch the
**16** import sites (15 card components in §1.2 + `TextObjectFloat`) plus the
[`FloatingCards.tsx`](../../src/components/FloatingCards.tsx) definition. The card components' inline
`<FloatCard>` early-returns are *deleted* (not renamed) once the generic `FloatHost` owns rendering —
so most of those 15 sites disappear rather than rename.

**What stays put (not moved into `src/floats/`):**
- `FloatingPanel.tsx` — the low-level shell, shared by panels + dialogs too. `src/floats/` *uses* it.
- `dock-drag.ts` + `DockOutline.tsx` — panel-centric; cards opt out.
- The MRU focus stack — stays in EditorLayout (it serves panels + toolbars too); AF exposes the
  `recordFocus`/`closeFrontmost` surface and Cmd-W dispatches through it unchanged.
- `prefs.poppedOutCards`/`cardFloatPositions` + `useViewPrefs` — persistence stays; AF adds the
  migration (§4).
- `float-sync.tsx` + the per-kind float bodies — **text-object domain, untouched** (§6).

---

## 4. Key grammar + migration

### 4.1 Target grammar
`float:<domain>:<kind>:<id>` for both domains:
- card → `float:card:note:<id>`, `float:card:revision:<id>`, `float:card:example:<id>`, …
- text-object → `float:textobject:paragraph:<uuid>`, `float:textobject:exampleBlock:<uuid>`, …

`buildFloatKey`/`parseFloatKey` live in `src/floats/float-key.ts`. `panel-registry.ts`'s `cardPopKey`/
`popKey` and `text-object-registry.ts`'s `textObjectPopoutKey`/`parseTextObjectPopoutKey` become thin
delegators (or are retired once callers move to `buildFloatKey`). The dual example key stays **two**
keys (`float:card:example:` for the panel card vs `float:textobject:exampleBlock:` for the block) —
they are genuinely two surfaces of two different kinds; AF does not collapse them (that's A1's
gardening call), but the `float:` grammar makes the distinction legible.

### 4.2 One-time `prefs.poppedOutCards` migration
Extend the existing read-time migration ([`useViewPrefs.ts:429-455`](../../src/hooks/useViewPrefs.ts))
+ the `migratePoppedOutCards` transform ([`:1377`](../../src/hooks/useViewPrefs.ts)). Mapping:

| Today | After |
|---|---|
| `textobject:<kind>:<id>` | `float:textobject:<kind>:<id>` |
| `<cardPrefix>:<id>` (note/footnote/citation/revision/cutter-*/example/bib/ai/quotation/archive/todo/highlight) | `float:card:<canonicalKind>:<id>` |
| legacy `paragraph:`/`heading:`/`texBlock:` (pre-D10) | first → `textobject:…` (existing step), then → `float:textobject:…` |
| `selection:`/`sel:` | dropped (already dropped at `:441-442`) |

`<canonicalKind>` is the reverse of `CARD_KEY_PREFIXES`. **Keep `revision` as the kind token** (the
comment/suggestion split is resolved from the record's `card.kind`, exactly as today at
[`floating-cards.tsx:421`](../../src/components/editor-layout/floating-cards.tsx)) — do **not** invent
a `float:card:comment:` vs `float:card:suggestion:` distinction the data doesn't carry. The vestigial
`suggestion:`/`revision-suggestion:` prefixes (§1.5) simply have no live keys to migrate.

### 4.3 **Critical: migrate `cardFloatPositions` in lockstep**
`cardFloatPositions` is keyed by the **same** popout string ([`useViewPrefs.ts:121`](../../src/hooks/useViewPrefs.ts);
read at [`EditorPane.tsx:1131`](../../src/components/EditorPane.tsx)). The existing D10 migration rewrote
**only** `poppedOutCards`, **not** `cardFloatPositions` — so any pre-D10 saved float rect already
orphaned. The AF migration must rewrite **both maps with the same key transform atomically**, or every
user's saved float size/position is lost on upgrade. (Session-only `autoFittedKeys`
[`FloatingCards.tsx:22`](../../src/components/FloatingCards.tsx) needs no migration.) This is the
no-silent-data-loss line item (cross-cutting constraint §8 of the parent doc).

---

## 5. Chrome skeleton + slot API (Seam 2)

**One fixed skeleton**, promoted from `FloatHeaderContent`
([`FloatHeaderContent.tsx`](../../src/text-objects/FloatHeaderContent.tsx)) — it is already the closest
thing to a shared inner header and already documents the "one source of truth so the label can't
drift" intent (`L3d.1`).

Fixed skeleton (left→right): **grip · title · `<trailing slot>` · jump (if `canJump`) · redock (if
`canRedock`, panels only) · close (X)**. Uses the shared `PopoutButton variant="x"` for close
([`panel-primitives.tsx:1158`](../../src/components/panel-primitives.tsx)) and the existing jump
polyline — **drawn once** here, deleting the duplicate `CardJumpChevron`
([`panel-primitives.tsx:376`](../../src/components/panel-primitives.tsx)) vs the inline button in
`FloatHeaderContent`.

```tsx
// src/floats/FloatChrome.tsx
interface FloatChromeProps {
  title: string;
  surface: FloatSurface;
  canJump: boolean;
  onJump: () => void;
  onClose: () => void;
  canRedock?: boolean;      // panels only; cards/text-objects false
  trailing?: React.ReactNode; // the single domain slot
}
```

**Slot budget (Seam 2 = 1 slot + title override):**
- **Card** fills `trailing` with what `EditableCard` builds today as `headerTrailing`
  ([`panel-primitives.tsx:791-810`](../../src/components/panel-primitives.tsx)): `CollabClaimPill` /
  `CollabPresenceDots` / `AiRequestCheckbox`.
- **Text-object** fills `trailing` with a source-missing / sync dot (today the body renders
  `SourceMissingBanner` from `useFloatMainSync`; a header dot is the presence-level signal).
- **Title override** (per-instance, e.g. heading "Chapter"/"Section") flows through a `setTitle`
  callback in the render ctx — generalizing today's `setHeaderLabel`
  ([`TextObjectFloat.tsx:69-73`](../../src/text-objects/TextObjectFloat.tsx)).

**Boundary note (flag for A0/A9):** moving the popped header to the skeleton means `PanelCard` must
**stop rendering its `isPoppedOut` header branch** ([`panel-primitives.tsx:1683-1690`](../../src/components/panel-primitives.tsx))
— the docked header stays, the popped header is delegated. The popped header *is* window chrome, so
this is squarely presence-layer; but it edits a card-shared file, so the impl chip should coordinate
the diff with A0 (spine) and A9 (card appearance). `renderBody()` returns the card's body **without**
the kind-label/jump/X chrome.

---

## 6. Float-policy consolidation (the payoff of "constrain")

One module (`src/floats/float-policy.ts`) so per-kind invariants stop drifting:

- **Default size.** Collapse the three `360×280` copies (`POPUP_W/H`, `DEFAULT_W/H`, `LIFT_FLOAT_W/H`,
  §1.6) into one `FLOAT_DEFAULT_SIZE`; per-kind overrides come from the `Floatable.defaultSize`
  (text-objects already carry `initialFloatSize`).
- **Viewport / fit-on-screen cap.** Relocate `POPOUT_MAX_VH` + `capPopoutHeight`
  ([`text-object-registry.ts:54-67`](../../src/text-objects/text-object-registry.ts)) into
  `float-policy.ts` — it is a *float* policy (Issue-13), currently mis-homed in the text-object
  registry but already consumed by `FloatCard` ([`FloatingCards.tsx:129`](../../src/components/FloatingCards.tsx)).
  Both the lifted-overlay capture cap and the auto-fit grow cap import it from there.
- **Move clamp.** Keep `FloatingPanel`'s move/resize clamps ([`:230-233`,`:304-305`](../../src/components/FloatingPanel.tsx))
  as the shell's, but expose the bounds as policy constants so cards and panels can't diverge.
- **Z-index.** Unify the base on `FLOATING_PANEL_Z_BASE`
  ([`constants.ts:18`](../../src/components/editor-layout/constants.ts)) — kill the magic `1200`
  ([`FloatingCards.tsx:169`](../../src/components/FloatingCards.tsx)). **Open improvement:** optionally
  derive z from the MRU stack so clicking a buried float raises it (today it can't — §1.7). Low-risk
  but a behavior change; gate behind the human's call (§9).
- **Auto-fit.** The text-float grow burst ([`FloatingCards.tsx:86-160`](../../src/components/FloatingCards.tsx))
  is text-object-specific logic squatting in the shared wrapper. Move it behind a domain hook the
  `Floatable` can opt into (e.g. `autoFitBody?: boolean`) so `FloatWindow` stays kind-blind.

**Generic dispatch.** `FloatHost` iterates `poppedOutCards`, calls `parseFloatKey` + `toFloatable`,
renders `<FloatWindow floatable={f}/>`. Every shared behavior then routes through the contract in one
place:
- **stack-drop** → `f.snapshotForStack(source)` (replaces EditorPane's prefix switch +
  `cardKeyPrefixToStackKind` + `resolveCardData`, [`EditorPane.tsx:833-865`](../../src/components/EditorPane.tsx));
  also fixes the text-object-can't-snapshot gap noted in §1.8);
- **spawn** → `computeSpawnPosition(anchor, f.defaultSize ?? FLOAT_DEFAULT_SIZE)` (the proposed `spawnHint` short-circuit was NOT landed — lift-off spawn-at-rect is handled by the lift pipeline's `liftSpawnRect`/`popOutAtRect`, not a contract field);
- **z / MRU / Cmd-W** → unchanged focus stack, but z from `float-policy`;
- **redock / dock-outline** → only when `f.canRedock` (cards/text-objects: false).

---

## 7. Fragmentation table (float layer)

| Surface | File(s) (`file:line`) | Disposition |
|---|---|---|
| Low-level window shell | [`FloatingPanel.tsx`](../../src/components/FloatingPanel.tsx) | **KEEP** — shared shell; `FloatWindow` + panels + dialogs mount it |
| Card float wrapper (15 inline early-returns) | `NoteCard.tsx:148` + 14 more (§1.2); def [`FloatingCards.tsx:38`](../../src/components/FloatingCards.tsx) | **REPLACE** — delete the 15 `if(isPoppedOut) return <FloatCard>` sites; generic `FloatHost` renders |
| Text-object float wrapper | [`TextObjectFloat.tsx`](../../src/text-objects/TextObjectFloat.tsx) | **FOLD** into `FloatWindow` + `FloatChrome`; per-kind body still via `meta.floatBodyComponent` |
| Float dispatch | `renderPoppedCard` [`floating-cards.tsx:200-540`](../../src/components/editor-layout/floating-cards.tsx) | **REPLACE** with `parseFloatKey → registry.toFloatable → FloatWindow` |
| Chrome header (card) | `PanelCard` popped branch [`panel-primitives.tsx:1683-1690`](../../src/components/panel-primitives.tsx); `CardJumpChevron` [`:376`](../../src/components/panel-primitives.tsx) | **MOVE** to `FloatChrome`; delete duplicate jump glyph |
| Chrome header (text-object) | [`FloatHeaderContent.tsx`](../../src/text-objects/FloatHeaderContent.tsx) | **PROMOTE** to the `FloatChrome` skeleton |
| Surface treatment | `surface` prop [`FloatingPanel.tsx:602-627`](../../src/components/FloatingPanel.tsx); card→panel, text→card | **KEEP** as per-domain `Floatable.surface` (legible, not forced) |
| Popped-state store | `poppedOutCards`/`cardFloatPositions` [`useViewPrefs.ts:119-121`](../../src/hooks/useViewPrefs.ts); ctx [`usePoppedCards.ts`](../../src/hooks/usePoppedCards.ts) | **KEEP** store; access via `src/floats/useFloatState` |
| Key builders | `cardPopKey`/`popKey` [`panel-registry.ts:277-290`](../../src/panels/panel-registry.ts); `textObjectPopoutKey`/`parseTextObjectPopoutKey` [`text-object-registry.ts:935-952`](../../src/text-objects/text-object-registry.ts) | **UNIFY** behind `buildFloatKey`/`parseFloatKey`; registries delegate |
| Key migration | [`useViewPrefs.ts:429-455`](../../src/hooks/useViewPrefs.ts), `migratePoppedOutCards` [`:1377`](../../src/hooks/useViewPrefs.ts) | **EXTEND** to `float:` grammar; migrate `cardFloatPositions` in **lockstep** |
| Default-size constants (×3) | `POPUP_W/H` [`EditorPane.tsx:230`](../../src/components/EditorPane.tsx); `DEFAULT_W/H` [`FloatingCards.tsx:13`](../../src/components/FloatingCards.tsx); `LIFT_FLOAT_W/H` [`panel-primitives.tsx:1453`](../../src/components/panel-primitives.tsx) | **CONSOLIDATE** into `FLOAT_DEFAULT_SIZE` |
| Spawn helpers | [`spawn-position.ts`](../../src/components/editor-layout/spawn-position.ts) | **KEEP**; re-home under `float-policy` |
| Height cap policy | `POPOUT_MAX_VH`/`capPopoutHeight` [`text-object-registry.ts:54-67`](../../src/text-objects/text-object-registry.ts) | **RELOCATE** to `float-policy.ts` (it's a float policy, not a text-object one) |
| Z-index base | `1200` [`FloatingCards.tsx:169`](../../src/components/FloatingCards.tsx) vs `FLOATING_PANEL_Z_BASE` [`EditorPane.tsx:3372`](../../src/components/EditorPane.tsx) | **UNIFY** on one base; optional MRU-raise |
| Text-float auto-fit | [`FloatingCards.tsx:86-160`](../../src/components/FloatingCards.tsx) | **MOVE** behind a domain opt-in hook so the wrapper stays kind-blind |
| MRU focus stack + Cmd-W | [`EditorLayout.tsx:851-908`](../../src/components/EditorLayout.tsx) | **KEEP** (already kind-uniform; serves panels+toolbars too); AF exposes the API |
| Stack-drop dispatch | signal [`stack-drop-target.ts`](../../src/lib/stack/stack-drop-target.ts); consumer [`EditorPane.tsx:824-888`](../../src/components/EditorPane.tsx); `resolve-card.ts`/`snapshot.ts` | **KEEP** transport; route serialization via `Floatable.snapshotForStack()` (retires the prefix switch + `cardKeyPrefixToStackKind`) |
| Re-dock + dock outline | [`dock-drag.ts`](../../src/components/editor-layout/dock-drag.ts), [`DockOutline.tsx`](../../src/components/editor-layout/DockOutline.tsx) | **KEEP** panel-only; gated by `Floatable.canRedock=false` |
| Lift-handoff | [`card-lift.ts`](../../src/components/card-lift.ts); `beginDragAt` [`FloatingPanel.tsx:510`](../../src/components/FloatingPanel.tsx); `consumeCardLiftHandoff` [`FloatingCards.tsx:68`](../../src/components/FloatingCards.tsx) | **KEEP**; Seam 1 — the subsystem owns the commit-to-float handoff, each domain owns its birth gesture |

---

## 8. Keystroke sanctity

No risk introduced, provided two invariants hold:

1. **`float-sync.tsx` stays domain-specific and untouched.** It subscribes to the **main editor's**
   transactions for text-object floats (Main→float, [`float-sync.tsx`](../../src/lib/float-sync.tsx)
   header) and is on the AGENTS.md permitted-subscriber list (*"docChanged-gated + own-write meta
   filter"*). AF must not generalize it into the card domain (cards edit sidecar JSON, not the doc) and
   must not add any new `editor.on('update'|'transaction')` subscriber. The `Floatable` contract is
   pull/callback-based (`renderBody`, `jumpToSource`, `snapshotForStack`) — none of it walks the doc.
2. **The generic float list stays event-gated, not keystroke-gated.** `FloatHost` iterates
   `prefs.poppedOutCards` (identity changes only on open/close, never on a plain keystroke);
   `parseFloatKey` is O(1). `toFloatable` factories must remain **pure resolvers** — resolve one entity
   by id, no full-doc descent. (Today's `case "footnote"` reads `editorRef.current?.getFootnotes()`
   once per *float render*, not per main-doc transaction — preserve that boundary.) Card-source
   derivation stays gated on `useStructuralRevisions` + the reactive `editor` per AGENTS.md — AF does
   not touch it.

**Verify (impl chip):** `window.__virgilBusStats().emitCount` flat while typing N plain characters into
the main editor with a card float **and** a text-object float both open; float windows must not
re-render or re-derive on a structurally-null keystroke.

---

## 9. Definition of Done — the `Floatable` subsystem

1. **One `Floatable` contract** in `src/floats/types.ts`; both `CARD_REGISTRY[kind].toFloatable(id,ctx)`
   and `TEXT_OBJECT_REGISTRY[kind].toFloatable(id,ctx)` return a `Floatable`. **No shared base type
   between `Card` and `TextObject`; the two kinds remain ontologically distinct.**
2. **One generic dispatcher** (`FloatHost`) replaces `renderPoppedCard`'s 14-case switch; **one window
   wrapper** (`FloatWindow`, renamed from `FloatCard`) replaces the 15 inline `if(isPoppedOut) return
   <FloatCard>` early-returns and `TextObjectFloat`.
3. **One chrome skeleton** (`FloatChrome`, grip·title·trailing·jump·redock·close); the jump glyph is
   drawn once; `PanelCard`'s popped header branch is removed; per-domain content fills exactly one
   `trailing` slot + an optional title override.
4. **One key grammar** `float:<domain>:<kind>:<id>` via `buildFloatKey`/`parseFloatKey`; the
   registries' key builders delegate; the dual example key is legible as two distinct `float:` keys.
5. **One prefs migration** rewrites `poppedOutCards` **and** `cardFloatPositions` in lockstep, idempotent
   across the existing D10 step; legacy `paragraph:`/`heading:`/`texBlock:` and `selection:` paths
   preserved; a console.warn records anything dropped. **No saved float position lost.**
6. **One float policy** (`float-policy.ts`): single default size, single `FLOAT_Z_BASE`, single
   viewport/fit-on-screen cap (`POPOUT_MAX_VH` relocated here), single move clamp source.
7. **Stack-drop, spawn, z/MRU/Cmd-W, redock all dispatch through the contract** — one place to enforce
   each policy; the text-object stack-drop gap (§1.8) closes by construction; `canRedock=false` keeps
   cards/text-objects out of the dock flow.
8. **Text-object `float-sync` untouched and domain-specific**; no new per-transaction subscriber;
   `__virgilBusStats().emitCount` flat on plain typing with floats open.
9. **Dev-preview parity walk:** pop out a card **and** a text-object; confirm identical window behavior
   (drag, resize, undock-clamp, spawn-near-trigger, drop-to-stack, Cmd-W frontmost, viewport cap) and
   one chrome skeleton. The two kinds were **not** merged — only their presence.

---

## 10. Open questions for the human

1. **Popped header ownership.** Moving the popped card header out of `PanelCard` into `FloatChrome`
   (§5) is the cleanest path to "one chrome," but it edits a card-shared file and shifts a visual that
   A9 (card appearance) also touches. Confirm AF owns the *popped* header while A0/A9 keep the *docked*
   header — and that the impl ordering threads `AF-impl` before A9.
2. **MRU → z-index.** Should clicking a buried float **raise** it (derive z from the MRU stack)? Today
   it doesn't (z = insertion order, §1.7). It's a small, arguably-correct behavior change, but it *is*
   a change — opt in or leave as-is?
3. **`surface` divergence.** Keep cards on `"panel"` (beige pod) and text-objects on `"card"` (white)
   as a deliberate visual language, or unify to one surface? AF's recommendation: keep both (it's a
   per-domain choice, not a policy invariant) — confirm.
4. **Dual example key.** AF keeps `float:card:example:` and `float:textobject:exampleBlock:` as two
   keys (two surfaces of two kinds). The parent doc lists the dual example-block key under A1
   gardening — confirm AF leaves it intact and A1 decides any collapse.
5. **Undispatched prefixes.** `suggestion:`/`revision-suggestion:`/`error:` are declared in
   `CARD_KEY_PREFIXES` but not dispatched (§1.5). `toFloatable()` makes them dispatch-or-not by registry
   declaration. Is `error` *meant* to be poppable (ErrorCard has the capability) or never (no popout
   affordance)? A0 taxonomy call — flag so the registry `toFloatable` for `error` is intentionally
   present or absent.
6. **Scope confirm.** AF treats `FloatingPanel`, `dock-drag`, `DockOutline`, and the MRU stack as
   *shared infrastructure it consumes but does not relocate* (they also serve panels/dialogs). Confirm
   that boundary — i.e. AF does **not** absorb panel docking, only the card+text-object window band.
