# FEATURE — Indent footnote-owned cards under their footnote card (like bib-under-cite)

**Status:** `PLAN-READY` (citation phase is fully specced + data-ready) · `ROOT-CAUSE-FOUND` (general-kind phase needs a small data extension)
**Filed by:** bug-catcher session, 2026-06-21
**Request:** "When a citation, example, or other card is linked to a footnote (rather than the main text), show it
**indented under the card it's linked to** (the footnote card) — compare the indentation on the bib card pop-up under
cite cards."

---

## 1. The ask, precisely

A card whose anchor lives **inside a footnote body** (today: a `\cite` nested in a footnote; soon `\ref` too — see
batch item #5) should appear as a **distinct card directly BELOW its footnote card (where it already sits today),
shifted RIGHT by an indent** — visually matching the bib-under-cite pattern.

> **⚠️ CLARIFIED BY USER (2026-06-21) — read before implementing:** the dependent card is **NOT** contained inside /
> folded into the footnote card. It stays a **standalone card** that renders **below** the footnote card (as it does
> now — the cascade already pushes it there because a footnote-nested cite shares the footnote's anchor position) and
> is simply **indented to the right**, exactly the way a dependent bib card sits under its parent cite card. The
> bib-under-cite analogy is about the **visual** (below + indented), not DOM containment. **This supersedes any
> "render children inside the parent's wrapper / fold their height into the parent" language elsewhere in this memo.**

---

## 2. Current behavior (verified)

- Footnote-nested citations are tagged `nestedInFootnoteId` on the DocStructureObserver `CitationEntry`
  ([doc-structure/types.ts:63](src/lib/tiptap/doc-structure/types.ts:63)), populated during the initial walk
  ([structure-index.ts:165-187](src/lib/tiptap/doc-structure/structure-index.ts:165)) by descending into each
  footnote's `attrs.content` via `inlineAtoms()` ([inline-content.ts:206](src/lib/inline-content.ts:206)).
- But the Omni view renders **everything flat**. `buildCitationOmniItems`
  ([Citations/omni.tsx:36-81](src/panels/Citations/omni.tsx:36)) emits one peer-level `OmniItem` per citation with
  **no parent/nesting field** ([_shared/types.ts OmniItem](src/panels/_shared/types.ts)), and a nested cite's `pos`
  resolves to the **host footnote's** position — so it currently appears as a separate card sitting right at the
  footnote, not nested under it. (This is the visual mess in the earlier gutter screenshots.)
- The bib-under-cite nesting that the user wants to match is **bespoke to `CitationCard`**: the bib renders in
  `<div className="ml-4 overflow-y-auto">` wrapped with the card in `<div className="space-y-2">{card}{bibInline}</div>`
  ([CitationCard.tsx:1034-1071](src/panels/Citations/CitationCard.tsx:1034)). There is **no reusable** "child card
  under parent" primitive yet.

---

## 3. The key simplification — citations are data-ready

The nesting fact for citations **already exists** in the structure snapshot (`structure.citations[].nestedInFootnoteId`).
So the concrete citation case (the user's primary example) is **pure rendering plumbing — zero new doc-walking**:
read it at the omni-host level (which already holds `editorInstance` → `getBus(editor).structure`) and route nested
cites under their footnote card. Generalizing to *other* kinds is a separate, additive phase (§5).

---

## 4. Deep design — a general parent→child card-nesting seam (one mechanism)

### 4a. Data: one optional field + one resolver
- Add `parentCardId?: string | null` to **`OmniItem`** ([_shared/types.ts](src/panels/_shared/types.ts)) — the single
  carrier of "this card nests under that card."
- In **omni-host** ([panels/omni-host.tsx](src/components/editor-layout/panels/omni-host.tsx), after the builders
  assemble `items` ~L400-618): build `nestedFootnoteOf: Map<citationId, footnoteId>` from
  `structure.citations` (filter `nestedInFootnoteId != null`), and stamp each matching citation item's
  `parentCardId = <the footnote omni-item id>`. **Use the same key the footnote omni item uses** (the footnote builder's
  `popKey("footnotes", footnoteId)` / `cardPopKey` form — match it exactly so parent lookup resolves).
  This is O(citations), snapshot-gated → keystroke-safe (reuse the `useLivePosResolver`/structure-identity memo pattern,
  no per-keystroke walk).

### 4b. Render: each child stays its own card, just ordered-under-parent + indented
- The dependent card remains a **standalone positioned card** in the omni column — NOT a DOM child of the footnote
  card. The only visual change to the child is a **right indent** matching bib-under-cite.
- Indent: in **`OmniViewPanel`**'s child render ([:545-587](src/panels/Omni/OmniViewPanel.tsx:545)), when an item has
  `parentCardId`, give its absolute wrapper a larger left inset (e.g. `left-6`/`pl-4` instead of the base `left-2`, or a
  `ml-4` on its inner content) so it reads as `ml-4` (16px) past its parent — pixel-match
  [CitationCard.tsx:1034-1071](src/panels/Citations/CitationCard.tsx:1034) (`ml-4`). Optionally extract that 16px indent
  into a small shared token/`NestedCard` wrapper and refactor `CitationCard`'s `bibInline` to use it too (one nesting
  convention); add a **"Nested cards"** note to [STYLE_GUIDE.md](src/STYLE_GUIDE.md). (The bib stays inside
  `CitationCard`; only the *indent value* is shared — the footnote-child is a sibling card, not contained.)

### 4c. Positioning: child stays in the cascade, ordered immediately under its parent
- **Keep children in `inTextItems`** — they cascade as independent cards and measure their own height (no change to the
  parent's measurement, no combined-height RO needed). A footnote-nested cite already carries the **host footnote's
  pos**, so it shares the footnote card's `naturalTop` and the cascade's overlap pass
  ([useInTextPositions.ts:145-156](src/hooks/useInTextPositions.ts:145)) already packs it **directly below** the
  footnote card — which is the "appears below, as it does now" the user described. The feature adds the **indent** and
  guarantees the **ordering**.
- **Ordering robustness:** make the cascade tie a child to its parent so it always lands immediately after it (and
  before any unrelated card that happens to share the Y). Cleanest: in the omni-host assembly, **reorder `items`** so
  each `parentCardId` child immediately follows its parent footnote item; the cascade's stable sort on equal
  `naturalTop` then preserves parent→child order. (If equal-Y ties ever prove fragile, give a child the sort key
  `parentTop + ε` before the overlap pass.) No change to the cascade's overlap math otherwise.
- This is strictly **fewer-to-equal** independent cards vs today, so it does not worsen the separate stacking bug in
  `MEMO_CARD_GUTTER_STACKING.md`.

### 4d. Cross-surface (docked panels)
Omni is the primary surface (the screenshots). For the docked view, the same rule applies — the child cite card appears
**below its footnote card, indented** — but note that in docked panels each kind lists in its **own** panel, so showing
the cite directly under its footnote means routing the nested-cite card into the **Footnotes panel** (rendered as a
distinct indented card after the footnote row) and **suppressing it from the flat Citations list** (so it shows once).
The child stays a standalone card (still NOT contained in the footnote card) — only its placement + indent change. If
the docked case adds complexity, ship omni first and treat docked as a fast-follow; the indent token/primitive is shared
either way.

---

## 5. Staging
- **Phase 1 (citations — data-ready, the concrete ask):** §4a stamp from `nestedInFootnoteId` + §4b/c ordering-under-
  parent + right-indent (child stays in the cascade). No structure changes, no containment. Ships the user's example.
- **Phase 2 (general kinds — additive):** a general `footnoteOwnerOf(anchorPos|uuid) → footnoteId | null` resolver
  (binary-search footnote ranges; O(log n)/item) + extend the footnote-body `inlineAtoms` walk in `buildInitial` to
  surface non-citation nested atoms. Then any kind with `parentCardId` nests for free.
  ⚠️ **Reality check:** footnote bodies hold *inline* content — the realistically-nestable kinds are inline atoms
  (citations now, `\ref` once #5 lands, maybe inline math). Block cards (examples) likely can't live in a footnote;
  confirm before promising "examples." Treat Phase 2 as "any future nestable inline-atom card," not a doc-wide promise.

---

## 6. Recommended design decisions (decisive defaults; flag if you disagree)
- **Always-indented**, not collapsible — the user said "show it indented under." The footnote card is the visible
  parent; the child keeps its *own* expand/collapse for its content (e.g. the bib under a nested cite).
- **Independent selection** — `cardStore` is per-card-id; selecting a child does not select the parent (matches today).
- **Both surfaces** (omni + docked) via the one `NestedCard` primitive; omni is primary (the screenshots).
- **Children follow the parent's visibility/side** — a nested cite shows wherever/whenever its footnote card shows
  (so it moves to the footnotes' side and respects the footnote filter), and is suppressed from the flat citations list.

---

## 7. Files
- [doc-structure/types.ts:48-64](src/lib/tiptap/doc-structure/types.ts:48) (`nestedInFootnoteId`) ·
  [structure-index.ts:165-187](src/lib/tiptap/doc-structure/structure-index.ts:165) (footnote-body walk; Phase 2 extend) ·
  [inline-content.ts:206](src/lib/inline-content.ts:206) (`inlineAtoms`).
- [panels/_shared/types.ts](src/panels/_shared/types.ts) (`OmniItem` + `parentCardId`) ·
  [omni-host.tsx:400-618](src/components/editor-layout/panels/omni-host.tsx:400) (stamp `parentCardId` + reorder items so
  each child follows its parent) ·
  [OmniViewPanel.tsx:425-490](src/panels/Omni/OmniViewPanel.tsx:425) + [:545-587](src/panels/Omni/OmniViewPanel.tsx:545)
  (keep children in `inTextItems`; render a child's wrapper with the right-indent) ·
  [useInTextPositions.ts:145-156](src/hooks/useInTextPositions.ts:145) (overlap pass already stacks child below parent;
  optional `parentTop + ε` tie-break for ordering).
- [CitationCard.tsx:1034-1071](src/panels/Citations/CitationCard.tsx:1034) (the `ml-4` indent value to match) ·
  [panel-primitives.tsx](src/components/panel-primitives.tsx) (optional shared indent token/`NestedCard`) ·
  [CardListPanel.tsx:65-158](src/panels/_shared/CardListPanel.tsx:65) (docked) · `src/panels/Footnotes/*`.

## 8. Risks / tests
- **Keystroke sanctity:** the parent-stamp + item reorder must be snapshot-identity-gated (no per-keystroke walk) —
  reuse the `useLivePosResolver` cache pattern.
- **Ordering / placement:** the child stays an independent cascade card; verify it lands **immediately below** its
  footnote card and stays glued there (reorder `items` so the child follows its parent; tie-break equal Y if needed).
  Test a footnote with 2+ nested cites (all stack below, in order, each indented).
- **De-dup / re-parenting:** a nested cite must render **once**, under its footnote — routed to the footnote's
  column/side and suppressed from the flat Citations list (§4c/§4d). Verify it doesn't also appear at its own slot.
- **Orphans:** if the host footnote is orphaned/gone, the child falls back to a normal (non-indented) flat card
  (`parentCardId` resolves to null) — don't drop it.
- **Tests:** OmniViewPanel ordering+indent (child is a separate positioned card directly under its parent, with the
  16px indent, NOT a DOM descendant of the footnote card); structure-index nested-atom coverage (extend the existing
  cite-in-footnote test for Phase 2).

## 9. Open questions
1. Can examples (block cards) actually be anchored inside a footnote, or is nesting inline-atom-only (cite/ref/math)?
   (Confirms Phase 2 scope — see §5 reality check.)
2. Docked surface: footnote panel hosts children, or each kind's panel indents its footnote-owned cards? (§4d
   recommends the former.)
3. Once #5 lands (`\ref` in footnotes), refs nest the same way — confirm refs get a `nestedInFootnoteId`-equivalent tag
   in the footnote-body walk.
