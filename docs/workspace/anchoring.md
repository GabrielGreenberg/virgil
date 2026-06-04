<!-- last-verified: 694f789 2026-06-04 -->
<!-- derives-from: docs/architecture/VIRGIL.md#ontology -->
<!-- covers-code: src/links/_shared/types.ts, src/links/links.ts, src/lib/tiptap/linked-anchor.ts, src/lib/latex-serializer.ts -->

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
               textObjectIds: string[]; margin: { side: "left"|"right" };
               textRange?: { anchorId; textSnapshot } }                       // anchor
```

For a paragraph/range anchor the `anchor.type` is `"textObject"`, and **the mode
is derived, never declared**:

- **Mode A — `targetKind !== "linkedRange"`.** A pointer to a persistent **node**
  by its `%!v:` block id(s) (`textObjectIds`). Generalized to **every** TextObject
  kind — paragraph, heading, listItem, exampleItem, atom blocks — not just
  paragraphs. **Multi-anchor (N > 1) is allowed** for Mode A: one card may pin
  several blocks (e.g. an `archive` snippet). One-way and coarse: the Card knows
  its blocks; the block doesn't know what points at it.
- **Mode B — `targetKind === "linkedRange"`.** A pointer to a **text span** backed
  by a `linkedAnchor` mark. `textObjectIds` still names the containing block(s);
  `textRange` carries the mark's `anchorId` plus a **`textSnapshot`** (the recovery
  path, below). The span persists to the `.tex` as paired `\vlid{}…\vlidend{}`
  markers ([identity.md](identity.md#example-and-linked-range-ids)).

Every `"textObject"` anchor also carries a `margin` gutter entry (which side the
Omni-View icon sits on). Resolution at measure time returns a `LinkResolution`
(`paragraph` / `text-range` / `inline-atom`) — skills don't compute it; they read
`textObjectIds` (Mode A) or the `textRange` (Mode B).

### OriginalAnchor

When a Mode-B card is dropped onto a paragraph (Mode B → Mode A via drop mode), the
prior range is saved so future UX can restore it:

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
| The anchored **block** is deleted | anchor (A) | **`TextObjectOrphanGuard`** emits `virgil-textobject-orphaned`; **`MarginaliaAnchorGuard`** *pre-empts* it for marginalia-bearing blocks by re-inserting a **placeholder paragraph with the same uuid** at the deletion site | `recoverOrphanedUuids` re-attaches a sidecar id by **unique** content fingerprint |
| The **`linkedAnchor` mark** vanishes (delete, or lost on a parse/paste) | anchor (B) | **`LinkedAnchorGuard`** emits `virgil-anchor-orphaned` so the feature hook clears the link; its `transformPasted` strips pasted `linkedAnchor` marks so a paste can't duplicate an anchor id | `reanchorByText` ([src/links/links.ts](../../src/links/links.ts)) re-anchors by the `textRange.textSnapshot` |
| The **`\vfid` / `\vcid` marker** (or the whole `\footnote{}`/`\cite{}`) is removed | atom-link | — (deleting the Atom is a normal edit) | `recoverOrphanedUuids` by fingerprint; a footnote whose marker vanished becomes an in-memory `OrphanedFootnote` the panel still hosts |

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
