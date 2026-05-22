# Text-Object Refactor — A Unified Canonical Pathway

Working memo. Captures the design conversation that produced it, the implementation plan, and progress through the refactor. The implementing session should read this end-to-end before touching code, and consult it whenever a question arises about scope or shape.

---

## Progress (updated 2026-05-22)

Branch: **`text-object-refactor`** (3 commits landed, 8 remaining).

### Landed

| # | Phase | Commit | Spirit |
|---|---|---|---|
| 1 | A1 + A3 | `c705d3e` | `exampleItem` becomes a first-class TextObject — it now carries a `uuid` attr and round-trips through `\vxid{xxxx}` in the LaTeX source, completing the family alongside `\vfid`/`\vcid`/`\vexid`. Deprecated `ANCHORABLE_NODES`/`ANCHORABLE_ATOMS` sets retired (the schema-based `isAnchorableNode` was already canonical; the deprecated sets had drifted to omit `figureBlock`/`graphicsBlock` and were dead weight). 5 round-trip tests in `src/lib/__tests__/example-item-roundtrip.test.ts`. |
| 2 | B + C1 | `8b2fa20` | Every persistent TextObject node now declares the `textObject` schema group. Top-level kinds get `"block textObject"` (lists keep `"block list textObject"`); sub-objects (`listItem`, `exampleItem`) get `"textObject"` alone. `linkedRange` membership lives in the registry, not the schema (mark, not node). Same commit widens `listItem.content` and `exampleItem.content` so `graphicsBlock` may sit mid-item (the parser + serializer were extended end-to-end; `texBlock`/`figureBlock` were intentionally NOT widened, per memo §6). 3 round-trip tests in `src/lib/__tests__/graphic-in-item-roundtrip.test.ts`. |
| 3 | C2 | `f089f95` | `src/text-objects/` skeleton — the SSOT. `types.ts` (TextObjectKind union, TextObjectRef, SelectionRef, TextObjectMeta, DropTarget/DropAction, TextObjectTransportPayload, MIME_TEXTOBJECT), `text-object-registry.ts` (16-kind registry + helpers `isTextObjectKind` / `textObjectForNode` / `textObjectPopoutKey` / `parseTextObjectPopoutKey` / `registerFloatBody`), `drop-adapters.ts` (per-kind wrap/no-wrap functions replacing the per-spec switches), `hydrate-selection.ts` (selection → linkedRange minting with anchorId reuse when a range is already covered), `handle-layout.ts` (one shared `computeHandleLeftEdge` utility replacing scattered placement math). Float body components are placeholders; Phase D5 wires real bodies via `registerFloatBody`. 21 unit tests in `src/text-objects/__tests__/`. |

After commits 1–3: typecheck clean, full suite 151/159 passing (the 8 failures are pre-existing in `usePersistentState.test.ts`, unrelated).

### Remaining (8 commits)

Strict dependencies: D10 before D5+D6; D8 before E. Otherwise order is flexible.

| # | Phase | Spirit (NOT a surgical patch — keep the architectural ambition) |
|---|---|---|
| 4 | D2 + D3 + D4 | Refactor `SelectionDragHandle.tsx` (~630 lines) into `TextObjectGrabHandle.tsx` backed by the registry. Replace the 4-variant `DragHandlePassage` union with `TextObjectRef \| SelectionRef`. Delete per-node-view grips on `texBlock`/`figureBlock`/`graphicsBlock`/`exampleBlock` — the editor-level handle covers them via the schema group. One canonical grab handle in the codebase. |
| 5 | D7 | Code-mod: `MarginaliaMarker.paragraphId` → `textObjectId`; `addParagraphLink` → `addTextObjectLink`; `getAnchorParagraphIds` → `getAnchorTextObjectIds`; `paragraphSideReanchorSpec` → `textObjectSideReanchorSpec`. ~159 call sites across hooks (Notes/Todos/Archive/Cutter/Revisions/Quotations), drop specs, drop-ctx APIs. Mechanical but bulky. Do NOT rename `data-link-id`/`data-link-card`/`data-link-kind`/`data-card-key` DOM attrs (stable user-facing contract); do NOT rename `LinkResolution.paragraph.paragraphId` (single resolved match); do NOT rename in `migrate-card.ts` (it IS the migration shim). |
| 6 | D8 | Full restructure of `Link.anchor`: rename `type: "anchor"` → `"textObject"`; add `targetKind: TextObjectKind`; rename `paragraphIds` → `textObjectIds`. `isModeB(link)` becomes `link.anchor.type === "textObject" && link.anchor.targetKind === "linkedRange"`. `migrateCardLinks` extended with one-shot read-side migration: infer `targetKind` by resolving the node id in the doc (sub-objects get their actual kind; missing → `"paragraph"` + console.warn). Mode B/A distinction collapses to a derived check. |
| 7 | D10 | Popout-key migration: all block popouts use `textobject:<kind>:<id>` (centralized via `textObjectPopoutKey` from C2). One `case "textobject"` in the `floating-cards.tsx` dispatcher; explicit deletion of `case "selection"` and the per-block-kind cases (`paragraph`, `heading`, `list`, `texBlock`, `example`). One-time read-side migration in `useViewPrefs.ts`: `paragraph:<uuid>` / `heading:<uuid>` → `textobject:<kind>:<uuid>`; `list:<uuid>` resolved by walking the doc for the actual node kind; `selection:<id>` / `sel:<id>` dropped (session-only). Card popout prefixes (`note:`, `todo:`, etc.) stay — they're a stable contract. |
| 8 | D5 + D6 | Float collapse: delete `ParagraphFloat.tsx`, `HeadingFloat.tsx`, `ListFloat.tsx`, `SelectionFloat.tsx`, `TexBlockFloat.tsx`, and `selection-floats.ts`. Their bodies relocate as registry-registered components via `registerFloatBody`; chrome is the unified `TextObjectFloat`. **Chrome unified; body sync stays per-kind** — abstracting CodeMirror-vs-TipTap sync would create false unification (TexBlockFloat keeps its CodeMirror sync internally). `cardContext` becomes a body-component concern. Same commit: drop-spec collapse — delete `paragraph.ts`/`heading.ts`/`selection.ts` from `drop-mode/specs/`; new `textobject.ts` consumes `TextObjectTransportPayload` and dispatches through `dropAdapterFor`. |
| 9 | E | Selection hydration + multi-paragraph linkedAnchor LaTeX round-trip. `hydrateSelectionToTextObject` (already exists in C2) wired at three commit sites: popout commit, card-anchor commit, drop-mode commit. The session-only "selection float" category is gone. New paired markers `\vlid{anchorId}…\vlidend{anchorId}` introduced in the parser + serializer (this is a NEW LaTeX-level round-trip — the mark was app-state-only before, persisted via sidecar `anchorText`). Parser is defensive: unmatched `\vlid` logs a console.warn and recovers via sidecar `textSnapshot`. Sidecar `paragraphId` (single) → `paragraphIds` (array). |
| 10 | F | Final migration audits: `\vxid` lazy assignment confirmed working for legacy docs; `migrateCardLinks` covers every consumer; orphan link surfacing; no silent data loss. No doc-format version sentinel needed (migration is additive). |
| 11 | G | Sample extension + agent-docs refresh + dev-preview walkthrough. Extend `samples/annotation-history/` with graphic-in-list-item, graphic-in-example-item, multi-paragraph linkedAnchor, sub-object card anchors. Walk the §13 checklist end-to-end. Refresh `docs/agents/main-text.md` (Block nodes + Link architecture sections), `docs/agents/architecture.md` (SSOTs table + MIME map + popout-key prefixes + float collapse note), `docs/agents/glossary.md` (TextObject entry, Mode A/B collapse), `docs/agents/overview.md` (text-objects in core concepts). |

### The spirit (re-stated for the next session)

**Deep architectural fixes — not surgical patches.** This refactor exists because the existing consistency is enforced by team vigilance, not by design. Every parallel implementation §4 enumerates is something to delete or merge through the new pathway. Where you find drift (the deprecated `ANCHORABLE_NODES` set omitting `figureBlock`/`graphicsBlock`; `figureBlock` lumped with "atom blocks" when it's actually `content: "figureCaption?"`; the `EntityKind`/`TextObjectKind` name collision around `example`), surface and fix it as part of the refactor — don't leave the drift behind for the next vigilant person.

When fixing a reported case, look for the class of bug and the analogous siblings. When extending functionality (sub-object popout, multi-paragraph linkedAnchor, graphicsBlock-in-list, cards-on-any-text-object), the extensions should be trivial after the refactor — if they're not, the abstraction isn't right yet.

Detailed plan (with all the cross-cutting concerns called out): `/Users/gabriel/.claude/plans/we-re-undertaking-a-major-quizzical-truffle.md`.

---

## 1. Spirit and Ambition

Virgil currently has at least three parallel implementations of "graspable text unit":

- **Main-editor grab handles** — `SelectionDragHandle` (the 6-dot lift in the gutter), normalized via `DragHandlePassage`, dispatched via `DragHandleMenu`.
- **Per-node-view grips** — `texBlock`, `figureBlock`, `graphicsBlock`, `exampleBlock` each render their own grip/popout elements inside their TipTap NodeViews. Different code paths, different visual conventions, different drag payloads.
- **Float-internal grips** — `ParagraphFloat`, `HeadingFloat`, `ListFloat`, `SelectionFloat`, plus per-block popouts each have their own internal drag affordances.

Around those sit scattered registries: anchorable-node predicates, drag-handle passage unions, drop-mode specs, popout-key prefixes, MIME types for text-object transport, marginalia anchor fields. Today they behave consistently mostly because the team has been careful — the consistency is enforced by vigilance, not by design.

**This refactor introduces `TextObject` as the single canonical abstraction** for everything in Virgil that:
- has its own block-level position in the document (not inline)
- carries an identity that persists across edits
- can be grabbed, popped out, dropped, and anchored to

After the refactor, every parallel implementation routes through this one pathway. Adjusting the affordances of a TextObject ripples outward automatically.

**β-scope.** All other code edits halt until this ships. The refactor is conceptually unified and the implementation should match it: don't ship as a series of small patches. The architectural shape is the deliverable.

**Extend functionality where it is patchy.** Sub-object popout (list items, example items), drop-context adaptive wrapping, multi-paragraph `linkedAnchor`, cards attachable to sub-objects, `graphicsBlock` allowed inside `listItem` and `exampleItem` — these aren't bolted-on extras; they're tests of whether the new abstraction is right. If the abstraction is right, they become trivial extensions.

---

## 2. The TextObject Taxonomy (Closed Union)

Two families:

### A. Persistent nodes
TipTap block-level nodes with a `uuid` attr. Lifecycle = lifetime of the node.

**Top-level kinds:**
1. `paragraph`
2. `heading`
3. `bulletList`
4. `orderedList`
5. `blockquote`
6. `codeBlock`
7. `displayMath`
8. `titleField`
9. `latexComment`
10. `texBlock`
11. `figureBlock`
12. `graphicsBlock`
13. `exampleBlock`

**Sub-object kinds** (only meaningful inside a parent; if dropped outside, wrap into a fresh single-item parent — see §8):
14. `listItem` — parent kinds: `bulletList`, `orderedList` (source list kind carried in the dragged payload so the wrap reproduces it)
15. `exampleItem` — parent kind: `exampleBlock` (via `exampleItemList` wrapper)

### B. Persistent ranges
TipTap mark with id. Lifecycle = lifetime of the mark.

16. `linkedRange` — id is the `linkedAnchor.anchorId`. Created on selection-popout. Also created when a Mode B card is anchored to a range. May span multiple paragraphs (see §5).

### Excluded — NOT text objects
- Inline atoms: `footnote`, `citation`, `inlineMath`, `aiRequest`, `labelRef`, `latexCommandMark`
- Marks (other than `linkedAnchor`, which backs `linkedRange` but is itself not a TextObject)
- Structural sub-sub-objects: `exampleItemList` (wrapper), `figureCaption`, `exampleGloss`, `alignedGlossRow`, `proseGlossRow`, `glossCell`

---

## 3. Registry Shape (the new SSOT)

Sit alongside `src/panels/panel-registry.ts` and `src/links/link-registry.ts`. Name: `src/text-objects/text-object-registry.ts` (new top-level `text-objects/` directory mirroring `links/` and `panels/`).

Sketch (refine in implementation):

```ts
export type TextObjectKind =
  | "paragraph" | "heading"
  | "bulletList" | "orderedList" | "blockquote" | "codeBlock"
  | "displayMath" | "titleField" | "latexComment"
  | "texBlock" | "figureBlock" | "graphicsBlock" | "exampleBlock"
  | "listItem" | "exampleItem"
  | "linkedRange";

export interface TextObjectMeta {
  label: string;
  /** Sub-object kinds wrap into a fresh single-item parent when dropped outside. */
  isSubObject: boolean;
  /** For sub-objects: the parent kind to wrap into. listItem carries the source list kind in the payload to drive this. */
  parentKind?: TextObjectKind;
  /** Atom block (uses DOM-rect positioning, not coordsAtPos). */
  isAtomBlock: boolean;
  /** Range (linkedRange) vs node. */
  isRange: boolean;
  /** Px reserved to the right of the handle for bullet/marker decoration. See §7. */
  decorationSafety: number;
  /** Float component for popout (parameterized; replaces per-kind floats). */
  floatComponent: ComponentType<TextObjectFloatProps>;
  /** DragHandleMenu actions this kind exposes. */
  actions: ReadonlyArray<DragHandleAction>;
  /** Source-marker spec for .tex round-trip (if any). e.g. paragraph uses %!v:xxxx; exampleItem needs a new marker. */
  sourceMarker?: { command: string; idLength: 4 };
  /** Drop adapter — given a target context, can this kind drop directly, or does it need wrapping? */
  dropAdapter: (target: DropTarget) => DropAction;
}

export const TEXT_OBJECT_REGISTRY: Record<TextObjectKind, TextObjectMeta>;
```

The schema-side companion: add `groups: "textObject"` to the node spec of every persistent-node kind so PM's `nodeType.isInGroup("textObject")` is the canonical predicate. (`linkedRange` lives on a mark, not a node, so it's handled separately.)

---

## 4. Current Fragmentation to Retire

Every entry below is something to delete, merge, or refactor through the new pathway. Verify each in code before acting; this list is from the conversation's read of the architecture and may have drift.

| Surface | File(s) (verify) | Disposition |
|---|---|---|
| `isAnchorableNode` predicate | `src/lib/marginalia.ts` | Replace with `nodeType.isInGroup("textObject")`. Delete the deprecated `ANCHORABLE_NODES` and `ANCHORABLE_ATOMS` sets. |
| `DragHandlePassage` union | `src/components/editor-layout/card-actions/drag-handle-actions.ts` | Replace with `TextObjectRef = { kind: TextObjectKind; id: string }` (plus a separate `SelectionRef` for the gesture-input layer). `paragraph`/`heading`/`atomBlock` variants collapse into one. |
| `SelectionDragHandle` (main-editor grip) | `src/components/SelectionDragHandle.tsx` | Becomes the canonical single grab-handle component (renamed `TextObjectGrabHandle`). Accepts a `TextObjectRef \| SelectionRef`. Applies the indent rule from §7. Replaces the per-node-view grips. |
| Per-node-view grips | `src/lib/tiptap/tex-block.ts`, `src/lib/tiptap/figure-block.ts`, `src/lib/tiptap/graphics-block.ts`, `src/lib/tiptap/expex.ts` (for exampleBlock) | Delete the bespoke grip elements. Each NodeView still owns its content rendering, but the grab handle is contributed by the editor-level `TextObjectGrabHandle` infrastructure based on the node's TextObject membership. |
| Float components (per-kind) | `ParagraphFloat.tsx`, `HeadingFloat.tsx`, `ListFloat.tsx`, `SelectionFloat.tsx`, plus the example-block/tex-block popout floats | Collapse into one parameterized `TextObjectFloat` that delegates to a kind-specific body renderer registered in the TextObject registry. |
| Drop-mode specs | `src/components/drop-mode/specs/paragraph.ts`, `heading.ts`, `selection.ts`, plus `ai-request.ts`, `stack-pull.ts` | Collapse `paragraph` + `heading` + any other block-source specs into one `textObject.ts` spec parameterized by kind. `selection.ts` collapses too — selections hydrate into `linkedRange` text-objects at drop commit. `ai-request.ts` and `stack-pull.ts` likely stay (different payloads). |
| Popout key prefixes for blocks | `prefs.poppedOutCards` lookup, `src/components/editor-layout/floating-cards.tsx` | Today: `paragraph:<uuid>`, `heading:<uuid>`, `example:<uuid>` (the in-editor variant). New: unified `textobject:<kind>:<id>`. Migration: a one-time prefs upgrade on load that rewrites old keys to the new shape. |
| MIMEs for text-object transport | `MIME_PAR_CAPTURE`, `MIME_TEXT_CAPTURE` (`src/hooks/usePanelCapture.ts`?), plus float-body grips | One MIME: `application/x-virgil-textobject`. Payload includes `{ kind, id, sourceContext }` where `sourceContext` carries enough info to drive the drop adapter (e.g. for a `listItem` from a `bulletList`, the source list kind). |
| `Mode A` / `Mode B` distinction on Link | `src/links/link-registry.ts`, `src/links/links.ts`, `src/links/_shared/types.ts` | Collapse. The anchor target is just a `TextObjectKind`: persistent-node kinds = today's Mode A; `linkedRange` = today's Mode B. `isModeB(link)` becomes `link.anchor.targetKind === "linkedRange"`. The 3-kind `LinkKind` (footnote/citation/anchor) stays — that's about *what links to what*, not about *what's being anchored to*. |
| Marginalia anchor field | `src/lib/marginalia.ts` — `MarginaliaMarker.paragraphId` | Rename to `textObjectId`. The field is already kind-agnostic in spirit; the rename makes that explicit. Update consumers. |
| `EntityKind` union | `src/links/_shared/entity-hover.ts` | Audit. EntityKind is about *cards*, not about *what they anchor to*. Keep it as-is for cards (note/cut/revision/todo/archive/quotation/footnote/citation), but its definition should not duplicate or shadow `TextObjectKind`. |
| Multiple grip implementations in floats | Inside each float component | Delete per-float grip code; the unified `TextObjectGrabHandle` handles the gesture for the wrapped content. Floats can still have a header drag-region for window moves — that's separate from text-object gestures. |

---

## 5. Reinforcement Work (do these BEFORE the unification, in the same session)

### 5.1 `exampleItem` UUID + source marker

`exampleItem` does not have a `uuid` attr today. Add one.

For the source marker: today the family is `\vfid{xxxx}` (footnote), `\vcid{xxxx}` (citation), `\vexid{xxxx}` (example-block). Add `\vxid{xxxx}` (or similar — pick a non-colliding name) for `exampleItem`. Parser emits, serializer preserves.

Verify (the next session must check before depending):
- `listItem` UUID round-trip — `listItem` is in the deprecated `ANCHORABLE_NODES` set, but confirm the parser/serializer actually persist a `%!v:` anchor on listItems across save/reload. If not, fix it as part of this work.
- `figureBlock` and `graphicsBlock` `uuid` attrs — they should already be there (the schema-based `isAnchorableNode` detects them); verify.

### 5.2 Multi-paragraph `linkedAnchor`

The `Link` type uses `paragraphIds: string[]` (plural), suggesting multi-paragraph was anticipated. Today the linkedAnchor mark in practice anchors a range within one paragraph (Mode B's `textRange` carries one `paragraphId`).

Extend: a `linkedAnchor` mark with a given `anchorId` may exist on multiple ranges across multiple paragraphs, and the `linkedRange` text-object aggregates them. Practically:

- Parser/serializer must support `\vlid{<anchorId>}…end-anchor` markers (or equivalent) across paragraphs.
- Marginalia must position the marker next to the first line of the first paragraph in the range (already true for single-paragraph; extend).
- The float/popout for a multi-paragraph `linkedRange` shows the full ranged content.

Verify before depending: read the linkedAnchor mark schema to confirm what's already there. If multi-paragraph already works for the mark itself but the *Link* type's plumbing is the bottleneck, extension is mostly in the Link types and the marginalia/popout code.

---

## 6. Content-Rule Changes (schema)

User-confirmed nesting target = **(b)+**:

- `listItem.content` — extend to allow `graphicsBlock` (the `\includegraphics` kind). Today probably `paragraph block*`; widen to include `graphicsBlock` explicitly.
- `exampleItem.content` — same: allow `graphicsBlock`.

**Do NOT widen:**
- `texBlock` in `listItem` or `exampleItem` (not needed for now)
- `figureBlock` in `listItem` or `exampleItem` (never needed)

When tables are added later, the same change happens for the table kind. Build the content-rule extension in a way that makes "add another allowed inner kind" a one-line change, not a deep rewrite.

LaTeX round-trip implications:
- `\begin{itemize}` containing `\includegraphics` mid-item — parser must accept this; serializer must emit it.
- Expex with `\includegraphics` inside an `\a` item — same.

---

## 7. The Grab-Handle Indent Rule

**Architectural principle:** measurement-based, with per-kind customization declared in one place (the registry's `decorationSafety`), and a clamp to keep top-level handles in the gutter.

Algorithm:

```
handleRightEdge = elDOM.getBoundingClientRect().left
                - decorationSafety[textObjectKind]
                - HANDLE_GAP
handleRightEdge = max(handleRightEdge, editorColumnLeft - HANDLE_GAP)
```

Where:
- `elDOM.getBoundingClientRect().left` = the rendered content-box left edge of the text object's DOM element.
- `decorationSafety[kind]` = a per-kind reserved zone for things rendered to the left of content (bullets, ex-markers). Defaults to 0; non-zero for `listItem` and `exampleItem`.
- `HANDLE_GAP` = a small constant breathing space.
- The clamp ensures top-level paragraphs (which sit at the editor column edge) keep their handle out in the gutter — current behavior.

For `exampleItem`, the marker width varies by depth (cycles `1.`/`a.`/`i.`/`A.`/`I.`). Two acceptable strategies:
- **(a)** Hardcode the widest of the cycle (`iii.` worst case) as `decorationSafety` — simple, slightly wasteful at shallow depths.
- **(b)** Live-measure via `Range.getBoundingClientRect()` on the marker text — accurate, slightly more complex.

Start with (a). Escalate to (b) only if it visually breaks.

The function lives in one shared utility (e.g. `src/text-objects/handle-layout.ts`). Every grab-handle render reads from it. No per-kind grip components doing their own placement math.

---

## 8. Drop-Context Adapter

User's spec (verbatim from conversation):

> "if they are dropped down, outside of their native environment, they should just become object-level items, if the same kind. (So if you pull out an 'a. Example text' as a sub-object in an expex list... you can drop it down in another expex list, and it will stay a sub-object. if you drop it down in clear text, it becomes its own expex list. Mutatis mutandis for other list items.)"

Encoding:

The dragged payload `{ kind, id, sourceContext }` reaches a drop site. The drop site's context is one of:
- inside-same-parent-kind (e.g. inside another `bulletList` for a `listItem` from a `bulletList`)
- inside-cross-parent-kind (e.g. inside an `orderedList` for a `listItem` from a `bulletList` — for `listItem`, both parents accept it, so this is also "inside-same-parent-kind" in effect)
- inside-incompatible-parent (e.g. inside an `exampleBlock` for a `listItem`)
- inside-top-level (paragraph-level slot in the doc)

The registry entry's `dropAdapter` decides:
- Inside-compatible → drop directly as the sub-object.
- Inside-incompatible OR inside-top-level → wrap in a fresh single-item parent of `parentKind`. For `listItem`, the wrap kind comes from `sourceContext.parentKind` (so a `listItem` from a `bulletList` wraps into a fresh `bulletList`, even when dropped at top level). For `exampleItem`, always wraps into `exampleBlock`.

Same machinery for top-level kinds: dropping a `paragraph` into a `listItem`'s content (now legal per §6 for `graphicsBlock` — extend the principle?) should wrap if needed; but the explicit user-facing rule is currently sub-object-driven, so don't over-generalize.

The drop adapter is a function in the registry entry, NOT a per-case switch scattered across `drop-mode/specs/`.

---

## 9. Selection-on-Popout Hydration

The user gesture starts with a live text selection. It is NOT a TextObject yet — no id, no registry entry. It's an input to a gesture.

When the user commits a gesture that requires persistence (popping the selection into a float; anchoring a card to it; etc.), the gesture **hydrates** the selection into a `linkedRange` text-object:

1. Generate a fresh `anchorId` (4-char hex via `generateShortId()`).
2. Stamp a `linkedAnchor` mark with that `anchorId` over the selection's range. (May span multiple paragraphs per §5.2.)
3. Selection is now a `linkedRange` text-object with id = `anchorId`. All downstream code paths (float, popout key, drop spec, card anchor) key on it.
4. If the user dismisses the popout or unanchors all cards from the range with no remaining references, the mark can be reaped (existing `linkedAnchor` cleanup logic, audit it).

In code, this is one small function — `hydrateSelectionToTextObject(view, from, to): TextObjectRef`. Call sites: popout commit, card-anchor commit, drop-mode commit on a selection source.

**All popouts persist.** There is no "ephemeral selection float" category in the new world. If a popout is created, the selection is hydrated. (If we later want ephemeral previews, they live outside the popout system.)

---

## 10. Cards Anchored to Any TextObject (Mode A/B Collapse)

Today: Mode A = paragraph anchor; Mode B = paragraph + text range (linkedAnchor mark).

New world: a card's anchor is a `TextObjectRef`. The target kind determines layout/behavior:
- Persistent-node target → marker positioned at the node's first-line top (today's Mode A behavior, generalized).
- `linkedRange` target → marker positioned at the range's first-line top, with optional text-tint painting (today's Mode B).

This means cards become attachable to **any** text-object kind — including sub-objects (`listItem`, `exampleItem`) and atom blocks. Marginalia already keys on UUID, so most of this works once we extend; what needs care is the layout math for new kinds (e.g. a card anchored to an `exampleItem` should position next to that item's first line, not the surrounding `exampleBlock`'s top).

Cleanup to bundle:
- `isModeB(link)` becomes `link.anchor.targetKind === "linkedRange"`.
- `Link.anchor` shape unifies. Audit `src/links/_shared/types.ts` and `src/links/links.ts` for what splits and what stays.

---

## 11. Migration Considerations

- **Sub-object UUIDs in existing docs.** Once `exampleItem` has a `uuid` attr, existing docs (which don't have `\vxid` markers on example items) need IDs assigned on load. Lazy ID assignment on first parse is fine; round-trip writes them out the next time the doc is saved.
- **Popout-key migration.** Existing `prefs.poppedOutCards` entries with `paragraph:<uuid>`, `heading:<uuid>`, `example:<uuid>` prefixes need to migrate to `textobject:<kind>:<id>`. One-time read-side rewrite on prefs load.
- **Mode B link migration.** Existing Mode B links should map cleanly to the new shape — same anchorId, just refactored fields. Audit for any subtle shape changes.
- **Document version stamp.** Consider whether this refactor warrants bumping a doc-format version sentinel so future readers know they're seeing the new shape. Probably not necessary if the migration is purely additive (new attrs, new IDs), but worth thinking about.
- **No silent data loss.** Anything that fails to migrate should surface (toast, console warning) — do not silently drop popouts, anchors, or sub-object identities.

---

## 12. Files to Touch (initial inventory — verify and extend during the work)

This is a starter set, not exhaustive. The implementing session will discover more.

### New files
- `src/text-objects/text-object-registry.ts` — the SSOT.
- `src/text-objects/types.ts` — `TextObjectKind`, `TextObjectRef`, `TextObjectMeta`, `SelectionRef`.
- `src/text-objects/TextObjectFloat.tsx` — parameterized float.
- `src/text-objects/TextObjectGrabHandle.tsx` — unified grab handle (or refactor `SelectionDragHandle.tsx` into this).
- `src/text-objects/handle-layout.ts` — the indent-rule utility.
- `src/text-objects/hydrate-selection.ts` — selection → `linkedRange` hydration.
- `src/text-objects/drop-adapters.ts` — sub-object drop wrapping (registry exposes these as `dropAdapter`).

### Heavy edits (verify file paths)
- `src/lib/marginalia.ts` — replace `isAnchorableNode`, rename `paragraphId` → `textObjectId`.
- `src/components/SelectionDragHandle.tsx` — refactor into the unified handle.
- `src/components/editor-layout/card-actions/drag-handle-actions.ts` — replace `DragHandlePassage` with `TextObjectRef`.
- `src/components/DragHandleMenu.tsx` — actions per-kind from the registry.
- `src/lib/tiptap/expex.ts` — add `uuid` to `exampleItem`; widen `exampleItem.content` for `graphicsBlock`; emit/parse `\vxid` markers; delete in-node-view grip from `exampleBlock`.
- `src/lib/tiptap/tex-block.ts` — delete in-node-view grip.
- `src/lib/tiptap/figure-block.ts` — delete in-node-view grip.
- `src/lib/tiptap/graphics-block.ts` — delete in-node-view grip.
- `src/lib/tiptap/linked-anchor.ts` — verify multi-paragraph support; extend if needed.
- `src/lib/latex-parser.ts` and `src/lib/latex-serializer.ts` — round-trip the new `\vxid` markers; verify `listItem` `%!v:` round-trip; multi-paragraph `linkedAnchor` parsing.
- `src/links/link-registry.ts`, `src/links/links.ts`, `src/links/_shared/types.ts` — Mode A/B collapse into a single anchor-target shape.
- `src/components/drop-mode/specs/*.ts` — collapse block-source specs into one.
- `src/components/drop-mode/registry.ts` — wire to the new collapsed spec.
- `src/components/editor-layout/floating-cards.tsx` — unified popout dispatcher reading `textobject:<kind>:<id>` keys.
- `src/components/ParagraphFloat.tsx`, `src/components/HeadingFloat.tsx`, plus list/selection floats — collapse into the new `TextObjectFloat`. Many files DELETED here.
- `src/hooks/useViewPrefs.ts` — popout-key migration (read-side rewrite).
- `src/hooks/usePanelCapture.ts` (or wherever the MIMEs live) — unified MIME.

### Lighter edits
- Any consumer of `paragraphId` on marginalia markers (rename).
- Any consumer of `DragHandlePassage` (rename / reshape).
- Any consumer of `isAnchorableNode` (replace with `nodeType.isInGroup("textObject")`).
- Docs: `docs/agents/main-text.md`, `docs/agents/architecture.md` — describe the new model after the refactor lands.

---

## 13. Definition of Done

The refactor is done when ALL of the following hold:

1. **Single canonical predicate.** "Is this a text object?" is answered by `nodeType.isInGroup("textObject")` everywhere. The old `isAnchorableNode`, `ANCHORABLE_NODES`, `ANCHORABLE_ATOMS` are deleted.
2. **Single registry.** Adding a new text-object kind = one entry in `text-object-registry.ts` + adding the node to the `textObject` schema group. No edits to drop specs, float dispatchers, marginalia code, popout key handling, MIME registries, or DragHandleMenu code are needed.
3. **Single grab-handle component.** `TextObjectGrabHandle` is the only grab-handle implementation in the codebase. Per-node-view grips on `texBlock`/`figureBlock`/`graphicsBlock`/`exampleBlock` are deleted.
4. **Single float component.** `TextObjectFloat` (parameterized) is the only block-popout float. `ParagraphFloat`, `HeadingFloat`, `ListFloat`, `SelectionFloat`, and per-block popout floats are deleted (or reduced to thin kind-body renderers registered in the registry).
5. **Single drop spec for text objects.** The per-source-kind drop specs collapse into one parameterized spec; the drop-context adapter handles wrap/no-wrap.
6. **Unified MIME.** One MIME for text-object transport; old `MIME_PAR_CAPTURE` / `MIME_TEXT_CAPTURE` deleted.
7. **Unified popout keys.** All block popouts use `textobject:<kind>:<id>`; old prefixes migrated.
8. **Sub-objects fully functional.** `listItem` and `exampleItem` can be popped out, dropped, drop-adapted (wrap if needed), and have cards anchored to them. `exampleItem` has a UUID with `\vxid` round-trip.
9. **`graphicsBlock` inside `listItem` and `exampleItem` works.** Schema permits it; LaTeX round-trip preserves it; grab handle positions correctly with `decorationSafety`; cards can anchor to it inside the nested context.
10. **Selection popout hydrates.** Popping out a selection creates a `linkedAnchor` mark with `anchorId` and treats the result as a `linkedRange` text-object. Persists across reload.
11. **Multi-paragraph `linkedRange`.** A selection spanning multiple paragraphs can pop out, persist, and be anchored to by cards.
12. **Mode A/B collapse.** `Link.anchor` has a single shape parameterized by `TextObjectKind`; `isModeB` becomes a derived check.
13. **Cards on any text object.** Notes/todos/quotations/etc. can be anchored to any text-object kind, including sub-objects and atom blocks; marginalia layout positions correctly.
14. **No silent data loss.** Existing docs and prefs migrate cleanly; nothing dropped without surfacing.
15. **Dev preview verified.** Walk through the dev doc (`virgil-data/doc_devtest`) and exercise: pop out a paragraph, a heading, a list, a list item, an example item, an example block, a tex block, a figure, a graphic, an image inside a list, an image inside an example, a selection. Drop them in various places. Anchor a note to a list item. Verify everything works.

---

## 14. Open Verifications (do these BEFORE depending on their state)

The conversation that produced this memo relied on architecture docs and the codebase index. Before depending on any of these, the implementing session must verify:

- **`listItem` `%!v:` round-trip.** Does the parser emit a `%!v:` anchor on `listItem`, and does the serializer preserve it? (It's in the deprecated `ANCHORABLE_NODES` set, but check.)
- **`figureBlock` and `graphicsBlock` UUID attrs.** Check the schemas; `isAnchorableNode` should detect them via schema-based detection.
- **`linkedAnchor` mark multi-paragraph status.** Read `src/lib/tiptap/linked-anchor.ts`. Does the mark naturally span paragraphs in PM, or is there logic that constrains it to one paragraph?
- **`Link.paragraphIds` actual usage.** Is the plural already meaningful (consumers handle N), or is it cosmetic with N=1 everywhere?
- **`SelectionFloat` persistence today.** Does it use `linkedAnchor` to persist or is it session-only? Inform the migration story.
- **Drop-mode spec list.** Confirm the actual file set in `src/components/drop-mode/specs/`.
- **MIME names** for text-object transport — confirm `MIME_PAR_CAPTURE` / `MIME_TEXT_CAPTURE` are the only ones, or list any others.
- **Popout key prefix list** — confirm `paragraph:` / `heading:` / `example:` are the only block-popout prefixes.

---

## 15. Working Pattern for the Implementing Session

1. **Read this memo end-to-end.** Plus `AGENTS.md`, `docs/agents/main-text.md`, `docs/agents/architecture.md`.
2. **Run `/plan` first.** Produce a step-by-step plan that walks through §5 (reinforcement work), §6 (content rules), §3 (registry), §4 (unification), §7-§10 (cross-cutting), §11 (migration). Get user sign-off on the plan before writing implementation code.
3. **Verify all of §14** as the early steps of the plan.
4. **Build foundation, then migrate.** Order suggested: schema + registry + grab-handle + float skeleton (foundation) → then rewire each parallel implementation through it, deleting the old one as you go.
5. **Verify in the dev preview.** Use `virgil-data/doc_devtest` (the dev doc, reloaded from `samples/annotation-history/` if it gets choppy). Walk through every kind. Don't claim done without §13.15.
6. **Run typechecks and any test suite.** Don't bundle unrelated cleanup. The scope is large enough already.
7. **No out-of-scope refactoring.** This is wide horizontally, not deep vertically. Don't redesign panels, cards, or links beyond what's required by §4 and §10.

---

*This memo is a working planning document for a single refactor. Once the refactor lands, archive or delete it.*
