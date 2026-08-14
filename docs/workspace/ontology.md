<!-- last-verified: 9b4f80cb 2026-08-14 -->
<!-- derives-from: docs/architecture/VIRGIL.md#ontology -->
<!-- covers-code: src/text-objects/text-object-registry.ts, src/cards/card-registry.tsx, src/cards/types.ts, src/panels/_shared/types.ts, src/links/link-dom-contract.ts, src/lib/tiptap, src/lib/latex-serializer.ts, src/lib/bib-uid.ts -->

# Ontology — operational manifest

> **Read this first.** The [INDEX](INDEX.md) sends you here before any other
> manifest doc. Every other doc specializes one of the primitives named here:
> [identity.md](identity.md) is the UUIDs, [atoms.md](atoms.md) is the Atoms,
> [latex.md](latex.md) is how TextObjects round-trip through `.tex`,
> [structure.md](structure.md) is where Cards live on disk. The card-kind
> shapes and the anchor mechanics are [cards.md](cards.md) / [anchoring.md](anchoring.md).

This is the operational cut of [VIRGIL.md → Ontology](../architecture/VIRGIL.md#ontology):
the same five primitives, pitched as *what a mechanical skill must recognize and
must not break*. When in doubt about a concept (not a recipe), read the spine.

## The Document and the five primitives

Virgil's world is **the Document** — a `.tex` file Virgil parses into an editor
model and serializes back, **never compiling**, always preserving the raw source
(see [latex.md](latex.md)). The Document is composed entirely of **TextObjects**;
the other four primitives exist *within* or *alongside* it.

| Primitive | What it is | A skill's handle on it |
|---|---|---|
| **TextObject** | The structural unit of text — paragraph, heading, list, listItem, exampleItem, blockquote, standalone blocks (math/code/figure/texBlock), and selection-backed linked ranges. The one canonical "graspable" abstraction. | A `%!v:<4hex>` block marker in the `.tex` ([identity.md](identity.md)); the `TEXT_OBJECT_REGISTRY` is the SSOT for what counts. |
| **Atom** | Inline element *within* a TextObject, finer than a TextObject but not one itself — `\cite{}`, `\footnote{}`, `\ref{}`, `$…$`. Often bidirectionally linked to a Card. | An inline marker (`\vfid{}` / `\vcid{}` / …) just before the command ([atoms.md](atoms.md), [identity.md](identity.md)); `ATOM_REGISTRY` is the SSOT for the kinds. |
| **Card** | Almost everything that isn't text: notes, footnotes, citations, bib entries, todos, reports, comments, suggestions, examples, **Tasks**. A parallel structure, *not* a TextObject sub-type. | A JSON entry in a `virgil/*.json` sidecar ([structure.md](structure.md)), carrying `"id"`; written only through `apply_response.py`. The card spine SSOT is `CARD_REGISTRY` (`src/cards/`), mirroring `TEXT_OBJECT_REGISTRY`. |
| **Omni-View gutter** | The in-context rendering of Cards beside the text they anchor to. | Read-only surface; skills don't write it. |
| **Panel** | Sidebar collection listing Cards of one kind (Notes, Footnotes, Bibliography, the Inbox for Tasks). | `PANEL_REGISTRY` is the SSOT; a skill targets a panel's sidecar, not the Panel UI. |

**The load-bearing distinction is Card vs. text.** A Card is never part of the
`.tex` body; it lives in a sidecar and *points at* text. A TextObject *is* the
`.tex` body. Confusing the two is the classic error — e.g. a footnote's prose is a
**Card** (`footnotes.json`), while its `\footnote{}` marker in the `.tex` is the
**Atom** that Card is linked to.

## TextObjects — the graspable set

The single answer to "is this graspable?" is membership in the `textObject`
schema group. Members (SSOT: `TEXT_OBJECT_REGISTRY`, mirrored by the serializer's
`UUID_BEARING_NODE_TYPES`):

`paragraph` · `heading` · `bulletList` · `orderedList` · `listItem` ·
`blockquote` · `codeBlock` · `displayMath` · `titleField` · `latexComment` ·
`texBlock` · `figureBlock` · `graphicsBlock` · `exampleBlock` · `exampleItem`.

`linkedRange` is a TextObject too, but lives **outside** the node group — it is a
mark range (the `linkedAnchor` mark), not a node. Each member carries a `%!v:`
block id; the LaTeX form of each is in [latex.md](latex.md), the marker rules in
[identity.md](identity.md).

## Atoms — inline, text-bound

The four inline Atom kinds — `citation`, `footnote`, `labelRef`, `inlineMath` —
are detailed in [atoms.md](atoms.md). The ontological facts a skill needs:

- An Atom is **text-bound**: it moves with the surrounding characters and **never
  pops into a Panel** on its own. Only Cards and TextObjects move/pop/drop freely.
- An Atom is usually one half of an **Atom link** to a Card (the `\footnote{}`
  Atom ↔ a `footnotes.json` Card; a `\cite{}` Atom ↔ a `bib`/`citation` Card).
  `\ref{}` and `$…$` carry no Card.

## Cards — the parallel structure

A Card is "almost everything else." Operationally:

- It lives in a **sidecar** (`virgil/<panel>.json`), not the `.tex`. See
  [structure.md](structure.md) for the inventory; per-kind shapes are
  [cards.md](cards.md) / [sidecars.md](sidecars.md).
- It connects to text by an **anchor** and/or an **Atom link** (next section).
- It is **written only through `apply_response.py`** — never by hand-editing the
  JSON. The write path is in [structure.md → the write path](structure.md#the-write-path);
  the conceptual contract is [VIRGIL.md → Cowork pattern](../architecture/VIRGIL.md#cowork-pattern).
- Each kind declares a **`content` descriptor** (`CardContentModel | null` on
  `CardMeta`, `src/cards/types.ts`) naming the user-content fields. One walker
  (`cardHasContent`) reads it so a delete-confirm can never miss content; the
  `null` descriptor is the no-user-content kinds (`bib`/`error`/`highlight`).
  A kind's `morph` carries a `drops` field listing the fields the target shape
  can't hold (drives the confirm copy + the lossy-morph unbridge). The `CardKind`
  union itself is unchanged — this is data-model metadata, not a new kind.
- **Tasks** live in `ai-requests.json` with a lifecycle the others lack
  (`status` / `result` / `safetyLevel`); the Inbox surfaces them. (The legacy
  `"ai"` CardKind was retired in #55b — unlinked note/todo requests now migrate
  to real cards with a per-card `aiRequest` flag; the `AiRequest` store remains
  the parallel Task structure.)
  A Task may have an anchor, Atom links, both, or neither (a "review the whole
  doc" Task has none). Full Task detail is [cards.md](cards.md).

## Linkage — anchor vs. Atom link

Two flavors, **both properties of the Card** (not separate primitives). The full
mechanics — what invalidates each, precedence when a Card has both — are in
[anchoring.md](anchoring.md); the altitude a skill needs now:

- **Anchor** — a Card's *one-way*, coarse (paragraph-level) pointer to a
  TextObject. The Card knows its anchor; the TextObject does not know what points
  at it. A note/todo typically has only an anchor.
- **Atom link** — a Card's *bidirectional*, fine-grained tie to an inline Atom.
  Both ends know each other. A footnote Card ↔ its `\footnote{}` Atom; a
  citation/bib Card ↔ every `\cite{}` instance.

A Card may have only an anchor, only Atom links, or both (a footnote Card is
anchored to a paragraph *and* Atom-linked to a `\footnote{}` within it).

## UUIDs — the identity layer

Every TextObject, Atom, and Card carries a UUID for stable reference across edits.
The user never sees them. Full rules in [identity.md](identity.md); the
one-paragraph version:

- **Short ids** (4-hex) name anything that appears in the `.tex`: the `%!v:`
  block markers and the `\v*id{}` Atom markers. A `bib` Card also carries a
  durable short-id surrogate in the **`.bib`** — a no-op `\vbid{<id>}` line
  before each entry block (`src/lib/bib-uid.ts`), so a citekey rename no longer
  strands its sidecars. It's the bibliography analogue of `\vcid`/`\vfid`.
- **Entity ids** (v4 UUID) name sidecar-only data that never appears in `.tex`
  (notes, todos, links, Tasks).
- Cards carry their id in their sidecar JSON (`"id": "…"`). For an Atom-linked
  Card the link is **id equality**: a footnote Card's `id` equals its
  `\vfid{<id>}` marker. Breaking that equality orphans the Card.

## The uniform affordance, and its one exception

All TextObjects and Cards can be **moved, popped out as floating windows, and
dropped back** freely. Atoms have only **text-bound** mobility (they ride the
characters). Omni-View gutters and Panels are surfaces, not movable objects. A
skill performing a structural operation must preserve this: never strand a Card
whose anchor you deleted (the editor's anchor guards re-insert a placeholder, but
a skill should re-anchor deliberately — see [gardening.md](gardening.md)).
