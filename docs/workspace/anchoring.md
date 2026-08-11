<!-- last-verified: ef13712e 2026-08-11 -->
<!-- derives-from: docs/architecture/VIRGIL.md#ontology -->
<!-- covers-code: src/links/_shared/types.ts, src/links/links.ts, src/links/resolve-card-anchor.ts, src/links/_shared/reapply-mode-b-anchors.ts, src/links/_shared/apply-linked-anchors.ts, src/links/_shared/normalize-text.ts, src/hooks/useReconcileModeAAnchors.ts, src/lib/anchor-mint-signal.ts, src/lib/tiptap/linked-anchor.ts, src/lib/latex-serializer.ts -->

# Anchoring (Card → text linkage) — operational manifest

> **When to load.** Any task that resolves where a Card sits in the text, or
> edits text a Card points at. This is the linkage **mechanism**; [cards.md](cards.md)
> says *which* flavor each kind has, [sidecars.md](sidecars.md) gives the field
> shapes, [identity.md](identity.md) owns the id rules, and [atoms.md](atoms.md)
> is the inline-Atom side. It fulfills the forward-pointers in
> [ontology.md](ontology.md) ("the anchor mechanics"),
> [atoms.md](atoms.md#inline-marks-not-atoms) ("the `linkedAnchor` Card-linkage
> rules"), and [identity.md](identity.md#example-and-linked-range-ids)
> ("Card-side linkage detail").

Operational cut of [VIRGIL.md → Ontology → Linkage](../architecture/VIRGIL.md#ontology).
Two flavors, **both properties of the Card** (not separate primitives): the
**anchor** (one-way, coarse) and the **Atom link** (bidirectional, fine). A Card
may carry only one, or both.

## Anchor — the `Link` and its two modes

An **anchor** is the Card's one-way pointer to a TextObject, carried in the card's
`links: Link[]` array (SSOT: [src/links/_shared/types.ts](../../src/links/_shared/types.ts)).
A `Link` is endpoint-independent — it has its own stable `id`, so it's addressable
without naming either end:

```ts
Link       { id; kind: "footnote" | "citation" | "anchor"; anchor: LinkAnchor;
             target: { type: "card"; ref: { kind: CardKind; id } }; createdAt }
LinkAnchor = { type: "inline-atom"; nodeName: "footnote"|"citation"; pos }   // atom link
           | { type: "textObject"; targetKind: TextObjectKind;
               textObjectIds: string[];      // no stored margin side — see margin-side.ts
               paragraphSnapshot?: string;                                    // Mode-A self-heal
               textRange?: { anchorId; textSnapshot } }                       // anchor
```

For a paragraph/range anchor the `anchor.type` is `"textObject"`, and **the mode
is derived, never declared**:

- **Mode A — `targetKind !== "linkedRange"`.** A pointer to a persistent **node**
  by its `%!v:` block id(s) (`textObjectIds`). Generalized to **every** TextObject
  kind — paragraph, heading, listItem, exampleItem, atom blocks — not just
  paragraphs. **Multi-anchor (N > 1) is allowed** for Mode A: one card may pin
  several blocks (e.g. an `archive` snippet). One-way and coarse: the Card knows
  its blocks; the block doesn't know what points at it. A Mode-A link also carries
  an **optional `paragraphSnapshot`** — a normalized plain-text capture of
  `textObjectIds[0]`'s block, taken at card creation and at drop re-anchor
  (`captureParagraphSnapshot` in [src/links/links.ts](../../src/links/links.ts), via
  `normalizeParagraphText` in
  [src/links/_shared/normalize-text.ts](../../src/links/_shared/normalize-text.ts)).
  It's the self-healing recovery path (below) — additive/optional; legacy links
  lack it and get it backfilled on the next load.
- **Mode B — `targetKind === "linkedRange"`.** A pointer to a **text span** backed
  by a `linkedAnchor` mark. `textObjectIds` still names the containing block(s);
  `textRange` carries the mark's `anchorId` plus a **`textSnapshot`** (the recovery
  path, below). The span persists to the `.tex` as paired `\vlid{}…\vlidend{}`
  markers ([identity.md](identity.md#example-and-linked-range-ids)). The
  Mode-B-capable kinds are the `LinkedAnchorKind` union in
  [src/links/links.ts](../../src/links/links.ts): `note`, `highlight`, **`todo`**
  (gained range-anchor symmetry with note/cutter as of fa7b898/5257b1a),
  `revision`, `cutter-comment`, `cutter-suggestion`, `report`, `report-request`
  (plus the synthetic AI render sentinels `pending-ai-change` / `pending-ai-request`, both `#bfdbfe`).

A `"textObject"` anchor carries NO margin side. It used to (`margin: { side }`,
read by the Mode-A anchor rail), but which side a card's margin chrome sits on
follows its PANEL's dock and is resolved live by
[src/lib/margin-side.ts](../../src/lib/margin-side.ts) — a stored copy could only
be right until the user re-docked. Skills must not write one.
Resolution at measure time returns a `LinkResolution`
(`paragraph` / `text-range` / `inline-atom`) — skills don't compute it; they read
`textObjectIds` (Mode A) or the `textRange` (Mode B).

### OriginalAnchor

When a Mode-B card is dropped onto a paragraph (Mode B → Mode A via drop mode), the
drop **converts** the link to a clean Mode-A anchor: `addTextObjectLink(…, "paragraph", …)`
does **not** fold the new paragraph id into the surviving `linkedRange` link (the
`targetKind === "paragraph"` gate in [src/links/links.ts](../../src/links/links.ts)),
and the caller drops the stale range link via `clearModeB` so the load Mode-B re-apply
can't drag the card back to the old paragraph. The prior range is saved so future UX
can restore it:

```ts
OriginalAnchor { droppedAt; anchorId; textSnapshot; paragraphIds: string[] }
```

It lives on `UserNote.originalAnchor` / `HighlightCard.originalAnchor`. **Drop mode
only writes it; nothing reads it yet** — treat it as a forward-compatible record, not
a live anchor.

## Atom link — id equality

An **Atom link** is the Card's *bidirectional* tie to an inline Atom
([atoms.md](atoms.md)). Its **persistent** form is **id equality**, not a stored
`Link`:

- A **footnote** Card's `id` in `footnotes.json` **equals** the `\vfid{}` marker id
  on its `\footnote{}` Atom. That equality *is* the link — `FootnoteRef` carries no
  `links` array and no pointer field.
- A **citation/bib** Card ties through its **citekey**: one bib key cited many
  times → many `\vcid{}` Atoms, one bib Card. `CitationRef` carries `id` (= `\vcid`)
  + `keys`; the bib entry is matched by key.

At **runtime** the same tie is surfaced as a `Link` of `kind: "footnote"` /
`"citation"` (an `inline-atom` anchor) so the editor can render the bidirectional
jump — but that Link is resolved from the live atom + card, **not** persisted. The
durable truth is the id equality; don't fabricate a `links` entry for a footnote or
citation.

## When a Card has both

The classic "both" case is a **footnote**: its Atom link (id equality) is the
**stored, authoritative** tie, and its anchor is **positional and implicit** — the
footnote rides whatever paragraph its `\footnote{}` Atom sits in, recoverable via
that block's `%!v:`. There is no separate `links` anchor entry. So **precedence:
the Atom link leads; the paragraph anchor follows the Atom.** Move the Atom (the
characters) and the footnote's effective anchor moves with it
([atoms.md → mobility](atoms.md#mobility-and-editing-rules)). Contrast an anchored
card (note/comment/report): its anchor *is* the stored `Link`, with no Atom.

## What invalidates a link

Each flavor breaks differently, and different machinery catches each
(all event-driven and O(1) per transaction — the keystroke-sanctity invariant):

| What breaks | Flavor | Guard (`src/lib/tiptap/linked-anchor.ts`) | Recovery |
|---|---|---|---|
| The anchored **block** is deleted | anchor (A) | **`TextObjectOrphanGuard`** emits `virgil-textobject-orphaned`; **`MarginaliaAnchorGuard`** *pre-empts* it for marginalia-bearing blocks by re-inserting a **placeholder paragraph with the same uuid** at the deletion site — **except** a transaction tagged `LIFECYCLE_DELETE_META` (the Archive / Delete drag-handle actions), where the removal is deliberate and the guard bypasses, letting the block actually go | `recoverOrphanedUuids` re-attaches a sidecar id by **unique** content fingerprint |
| The anchored **block's `%!v:` uuid is re-minted** (the `.tex` reload race — the `%!v:` write lost to a reload, so the paragraph parsed back with a fresh uuid and the card's stored uuid matches nothing) | anchor (A) | — (no guard; caught on the next load) | The reload reconcile re-finds the block by `paragraphSnapshot` (snapshot rung of the resolver ladder) and rewrites `textObjectIds[0]` to the live uuid — see the unified resolver below |
| The **`linkedAnchor` mark** vanishes (delete, or lost on a parse/paste) | anchor (B) | **`LinkedAnchorGuard`** emits `virgil-anchor-orphaned` so the feature hook clears the link; its `transformPasted` strips pasted `linkedAnchor` marks so a paste can't duplicate an anchor id | `reanchorByText` ([src/links/links.ts](../../src/links/links.ts)) re-anchors by the `textRange.textSnapshot`; on **load** the once-per-doc re-apply pass restamps every Mode-B mark (below) |
| The mark **reloads mislabeled** — the serializer drops the mark `kind`, and the parser's `applyLinkedAnchorBoundaries` resurrects every `\vlid` pair as a hardcoded `kind:"note"`/`linkCard:""` (the schema default in [src/lib/tiptap/linked-anchor.ts](../../src/lib/tiptap/linked-anchor.ts)), so a revision/cutter/todo/report/highlight span reloads painted as a note | anchor (B) | — (caught on the next load) | The load reconcile (`applyLinkedAnchorsImpl`, below) is **authoritative**: it re-stamps each present-but-disagreeing mark's `kind`/`linkCard`/`tintColor` from the owning sidecar card over the parser default |
| The **`\vfid` / `\vcid` marker** (or the whole `\footnote{}`/`\cite{}`) is removed | atom-link | — (deleting the Atom is a normal edit) | `recoverOrphanedUuids` by fingerprint; a footnote whose marker vanished becomes an in-memory `OrphanedFootnote` the panel still hosts |

### The unified recovery owner (resolver SSOT)

One pure resolver — [src/links/resolve-card-anchor.ts](../../src/links/resolve-card-anchor.ts) —
answers "what paragraph does this card live on **now**?" for every consumer (the
load reconcile, the marginalia render, the Mode-B re-apply). `buildResolveIndex(editor)`
walks the doc **once** per pass (uuid set, `linkedAnchor`-mark→paragraph map, and a
normalized-text→uuid snapshot lookup); `resolveCardAnchor` then resolves each card
**O(1)** against that index down a strict ladder — **`uuid` → `mark` → snapshot →
`orphan`** (a still-live stored uuid ALWAYS beats a same-text sibling). `reconcileCardToResolved`
is the pure card mutator that applies the binding (backfill the snapshot on a uuid
hit; rewrite `textObjectIds[0]` or convert a relocated Mode-B on a snapshot hit).

- **Load reconcile.** [src/hooks/useReconcileModeAAnchors.ts](../../src/hooks/useReconcileModeAAnchors.ts)
  is the shared factory the panel hooks run once on load — it builds the index and
  funnels each card through `resolveCardAnchor` + `reconcileCardToResolved`.
- **Single load-time Mode-B re-apply (authoritative reconcile).**
  [src/links/_shared/reapply-mode-b-anchors.ts](../../src/links/_shared/reapply-mode-b-anchors.ts)
  (`reapplyModeBAnchors`) feeds every persisted Mode-B card **before** the per-panel
  reconcile, so healthy Mode-B cards win the resolver's live-mark rung. It routes
  each record through the **one** load-time recovery writer,
  `applyLinkedAnchorsImpl` ([src/links/_shared/apply-linked-anchors.ts](../../src/links/_shared/apply-linked-anchors.ts)),
  shared by the production `EditorHandle.applyLinkedAnchors` and the RC-B tests so
  they can't drift. **It does not skip present marks** (the prior skip-if-present
  behavior was the BUG1 kind-corruption class): it makes the **sidecar
  authoritative** — an *absent* range is re-stamped via `reanchorByText` from the
  snapshot; a *present-but-disagreeing* range (kind / `linkCard` token / `tintColor`
  mismatch) is re-stamped **in place** (`addToHistory:false`); an *agreeing* one is
  skipped (idempotent). This is the load-time reconcile that **replaced** the retired
  second `EditorLayout.applyLinkedAnchors` effect — it now lives in this shared impl,
  driven from a single `EditorPane` recovery pass latched on `modeAReconciledDocRef`
  ([src/components/EditorPane.tsx](../../src/components/EditorPane.tsx)). Per-kind
  tint flows through the `defaultTintForLinkedAnchorKind` SSOT; the `linkCard` token
  is built via the shared `legacyKindToCardKindString` so it is byte-identical to
  create-time. A trailing `reapOrphanLinkedAnchors` pass (load-order- and
  read-error-gated) drops only marks with no live owning card.
- **Live card-morph restamp (no reload needed).** A card morph
  (`convertCardWithRemap`) flips only the sidecar record, so the in-doc
  `linkedAnchor` mark kept its stale `tintColor` / `data-link-card` token until a
  full reload re-stamped it. `restampLinkedAnchorForKind`
  ([src/links/links.ts](../../src/links/links.ts)) closes that gap: after the
  sidecar mutate commits it restamps the mark's kind-derived presentation (legacy
  `kind` attr, `data-link-card` token, `tintColor`) from the NEW spine kind via the
  same `defaultTintForLinkedAnchorKind` SSOT the create + reload paths use — so a
  note→highlight morph paints immediately (task 073).
- **Mint-race close.** [src/lib/anchor-mint-signal.ts](../../src/lib/anchor-mint-signal.ts)
  tags a uuid-mint transaction (`ANCHOR_MINT_META`); the autosave subscriber forces an
  **immediate** doc-bundle flush so the paragraph uuid lands on the card's fast clock,
  not the 1500 ms doc clock. Belt-and-suspenders, `storage-fsa` also **writes load-minted
  uuids back to the `.tex` on load** (parity with `storage-dev`).
- **Legacy helpers.** `reconcileModeAAnchors` / `findParagraphIdBySnapshot` /
  `isModeAOrphaned` in [src/links/links.ts](../../src/links/links.ts) are kept exported
  **for their own tests only** — production funnels through the resolver SSOT. `isModeAOrphaned`
  has no orphan-surfacing UI yet (`@internal`).

**The honest caveat for skills.** The guards keep cards from *silently* orphaning,
and `MarginaliaAnchorGuard`'s placeholder means an anchored paragraph you delete
survives as an empty same-uuid block. But **recovery is best-effort**:
`recoverOrphanedUuids` and `reanchorByText` skip **ambiguous** matches (duplicated
text can't be re-anchored unambiguously). So when a skill deletes or moves text a
Card depends on, **re-anchor deliberately** — don't lean on the guards. Cleanup
conventions for the orphans you do create are [gardening.md](gardening.md#orphan-handling).

## Rules for skills

1. **Read the mode off `targetKind`.** Mode B iff `targetKind === "linkedRange"`;
   everything else is Mode A. Don't add a separate mode flag.
2. **Mode A may be multi-anchor.** Treat `textObjectIds` as a set, not a single id.
3. **Atom links are id equality, not `links`.** For a footnote/citation, match
   `id` ↔ marker; never write a `links` array for them.
4. **A footnote's anchor is its Atom's position** — preserve the `\vfid{}\footnote{}`
   pair as one unit; the paragraph anchor follows it.
5. **Re-anchor deliberately after destructive edits.** The guards prevent silent
   loss; they don't reconstruct intent, and recovery skips ambiguous text.
6. **Resolve via the SSOT, not by hand.** To find a card's live paragraph, use
   `resolveCardAnchor` against one `buildResolveIndex` pass
   ([src/links/resolve-card-anchor.ts](../../src/links/resolve-card-anchor.ts)) — never
   walk the doc per card. When you write a fresh Mode-A anchor, pass a
   `paragraphSnapshot` so it self-heals the reload race; legacy links get it backfilled.
