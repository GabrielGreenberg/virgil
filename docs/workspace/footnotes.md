<!-- last-verified: 71c5f42 2026-06-03 -->
<!-- derives-from: docs/architecture/VIRGIL.md#cowork-pattern -->
<!-- covers-code: src/lib/tiptap/footnote.ts, src/lib/types.ts, editor/scripts/create_card.py, editor/scripts/apply_response.py -->

# Footnotes — operational manifest

> **Footnote-specific layer.** The general mechanics this kind rides on now live
> in the foundational docs — the `\vfid` marker in [identity.md](identity.md), the
> footnote Atom and its Card linkage in [atoms.md](atoms.md#footnote), the
> round-trip in [latex.md](latex.md), the write path in
> [structure.md](structure.md#the-write-path). This doc keeps **only** what is
> peculiar to footnotes: the splice recipe, the `FootnoteRef` shape, and the
> create flow. It does not restate the general facts — load the docs above for
> those.

## Reading protocol

Read this before handling a `kind: footnote` Task or running
`create-card --kind=footnote` / `draft-footnote`, alongside
[atoms.md#footnote](atoms.md#footnote) and
[identity.md#footnote-and-citation-ids](identity.md#footnote-and-citation-ids). The
*composition* of footnote prose is chat's job (see
[draft-footnote.md](../../editor/skills/draft-footnote.md)); this doc is the `.tex`
splice + on-disk shape + create mechanics.

## The footnote splice (house style)

A footnote Atom is two adjacent `.tex` tokens — `\vfid{<id>}` immediately before
the authored `\footnote{...}` (the general rule is
[atoms.md#footnote](atoms.md#footnote)). The **footnote-specific** placement: splice
the atom immediately after the paragraph's terminal token, before the trailing
` %!v:<uuid>` block marker, with no floating whitespace:

```
…final sentence of the paragraph. %!v:3301
            ↓
…final sentence of the paragraph.\vfid{<id>}\footnote{<body>} %!v:3301
```

`apply_response.py`'s `texEdit` does this: `mode: "end-of-paragraph"` splices
before the trailing marker (above); `mode: "after-selected"` splices right after a
matched `selectedText` substring instead. The splice itself is kind-agnostic —
`create_card.py` composes the `\vfid{<id>}\footnote{<body>}` insert string and the
contract just places it.

## On-disk shape

`virgil/footnotes.json`:

```json
{ "footnotes": [
  { "id": "f0ac",
    "content": { "type": "doc", "content": [
      { "type": "paragraph", "content": [
        { "type": "text", "text": "…footnote body…" } ] } ] },
    "createdAt": "2026-04-23T12:00:00.000Z" } ] }
```

`FootnoteRef` (`src/lib/types.ts`) is exactly three fields — `id`, `content`
(Tiptap `JSONContent` doc; legacy HTML strings migrate on read), `createdAt`.
**There is no anchor / paragraphId field**: the `\vfid{<id>}` in the `.tex` *is*
the anchor, and the entry's `id` **must equal** that `\vfid` id (the id-equality
link rule — [identity.md#footnote-and-citation-ids](identity.md#footnote-and-citation-ids)).
Id allocation (a fresh 4-hex colliding with neither an existing `footnotes.json`
id nor a `\vfid{}` already in the `.tex`) follows the general short-id rules in
[identity.md → rules for skills](identity.md#rules-for-skills); `create_card.py`
does it.

## How a footnote is created (v1)

`create-card --kind=footnote` → `create_card.py` → the `apply_response.py`
contract. The **footnote-specific** steps `create_card.py` performs:

1. allocate a collision-free `\vfid` id,
2. build the `footnotes.json` entry (the shape above),
3. compose the `\vfid{<id>}\footnote{<body>}` splice,

then hand off to the contract, which dispatches by the Task's `safetyLevel` and
commits atomically under the pen. The `safetyLevel` → subcommand mapping and the
atomic-commit semantics are **general** — see
[structure.md → the write path](structure.md#the-write-path). For footnotes
specifically, a Level-3 `--propose` drafts the entry into `footnotes.json` while
leaving the `.tex` untouched until the user accepts; every other level lands the
`\vfid{}\footnote{}` splice and the `footnotes.json` entry together, atomically,
alongside `ai-requests.json` + `notifications.json` + `version.txt`.
