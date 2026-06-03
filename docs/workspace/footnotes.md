<!-- last-verified: 8ed5779 2026-06-03 -->
<!-- derives-from: docs/architecture/VIRGIL.md#cowork-pattern, docs/architecture/phase0-stable-current-state.md -->
<!-- covers-code: src/lib/latex-serializer.ts, src/lib/latex-parser.ts, src/lib/tiptap/footnote.ts, src/lib/types.ts, editor/scripts/create_card.py, editor/scripts/apply_response.py -->

# Footnotes — operational manifest

> **Vertical-slice extraction.** Written while building the `apply_response.py`
> v1 contract, using footnotes as the validation kind. Built against the
> **current** footnote shape — if the card-system refactor changes `FootnoteRef`
> or the `Link` schema, revisit this doc (it's `covers-code` for those files).

## Reading protocol

Read this before handling a `kind: footnote` Task or running
`create-card --kind=footnote` / `draft-footnote`. It tells you the `.tex` atom
mechanics and the on-disk shape; the *composition* of footnote prose is chat's
job (see [draft-footnote.md](../../editor/skills/draft-footnote.md)).

## The `\vfid` / `\footnote` mechanics

Full emit/parse archaeology is in
[phase0-stable-current-state.md §1](../architecture/phase0-stable-current-state.md)
(the UUID-marker section) — don't re-derive it. The operative facts:

- A footnote atom is two adjacent `.tex` tokens: Virgil's id marker
  `\vfid{<4hex>}` immediately **before** the authored `\footnote{...}` (or
  `\thanks{...}`).
- **Emit** (serialize → `.tex`): `src/lib/latex-serializer.ts` (~391, 648).
- **Parse** (`.tex` → doc): `src/lib/latex-parser.ts` (~341) stashes
  `pendingFootnoteId` and attaches it to the next `\footnote`/`\thanks` atom
  (`footnoteId` ← `\vfid`). The `Footnote` TipTap extension is
  `src/lib/tiptap/footnote.ts`.
- The `\vfid` macro is a no-op (`\providecommand{\vfid}[1]{}`), seeded in
  `CLASSIC_PREAMBLE` and topped up by `ensureVirgilCommands` on save.

### House-style splice

Insert the atom immediately after the paragraph's terminal token, before the
trailing ` %!v:<uuid>` marker (no floating whitespace):

```
…final sentence of the paragraph. %!v:3301
            ↓
…final sentence of the paragraph.\vfid{<id>}\footnote{<body>} %!v:3301
```

`apply_response.py`'s `texEdit` (`mode: "end-of-paragraph"`) does exactly this;
`mode: "after-selected"` splices right after a matched `selectedText`
substring instead. The splice is kind-agnostic — `create_card.py` composes the
`\vfid{<id>}\footnote{<body>}` insert string; the contract just places it.

## On-disk shape (current)

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
(Tiptap JSONContent doc; legacy HTML strings migrate on read), `createdAt`.
There is **no anchor/paragraphId field**: the `\vfid{<id>}` in the `.tex` *is*
the anchor, and the entry's `id` must equal that `\vfid` id. Ids are 4-hex
(`f0ac`, `f003`), the `\vfid{<4hex>}` namespace — `create_card.py` allocates a
fresh one that collides with neither an existing `footnotes.json` id nor a
`\vfid{}` already in the `.tex`.

## How a footnote is created (v1)

`create-card --kind=footnote` → `create_card.py` → the `apply_response.py`
contract. `create_card.py` allocates the id, builds the `footnotes.json` entry
+ the splice, and dispatches by the Task's `safetyLevel`:

| safetyLevel | subcommand | effect |
|---|---|---|
| _none_ | `complete-task` | direct create — footnote lands; `result: direct-created` |
| `1` | `write-silent` | footnote lands silently; `result: silent-applied` |
| `2` | `write-with-comment` | footnote lands + a sibling note; `result: auto-applied` |
| `3` | `complete-task --propose` | footnote drafted into `footnotes.json`, **`.tex` untouched**; Task left `in-progress` awaiting review |

All of it — `footnotes.json`, the `.tex` splice, `ai-requests.json`,
`notifications.json`, `version.txt` — commits atomically under the editing pen.
