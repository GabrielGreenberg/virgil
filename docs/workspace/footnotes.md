<!-- last-verified: 19ecd88b 2026-07-06 -->
<!-- derives-from: docs/architecture/VIRGIL.md#cowork-pattern -->
<!-- covers-code: src/lib/tiptap/footnote.ts, src/lib/footnote-commands.ts, src/lib/types.ts, src/hooks/useOrphanedFootnotes.ts, src/cards/has-content.ts, editor/scripts/create_card.py, editor/scripts/apply_response.py -->

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

`FootnoteRef` (`src/lib/types.ts`) is `id`, `content` (Tiptap `JSONContent` doc;
legacy HTML strings migrate on read), `createdAt`, an optional **`aiRequest?`** flag (#55a — see
[the AI-request flag](#the-per-card-ai-request-flag-55a)), plus the family-wide
optional **`archived?`** and (bug sweep #3) **`unanchored?`** flags — both **live**
for footnotes now, mirroring `CitationRef` (see the archive note below). **There is no anchor / paragraphId
field**: the
`\vfid{<id>}` in the `.tex` *is*
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

## The per-card AI-request flag (#55a)

A footnote card carries the same per-card **AI request** affordance the other
flag-bearing kinds have (note / highlight / todo / cutter-comment /
revision-comment / report-request). Flipping the card's `AiRequestCheckbox`
sets the `aiRequest?` flag on the `footnotes.json` entry AND bridges a
`kind: "footnote"` Task into `ai-requests.json` (`bridgeCardAiRequestFlag`,
`linkedTo: { panel: "footnotes", cardId }`); the routing is declared on
`CARD_REGISTRY` (`{ kind: "footnote", linkPanel: "footnotes" }`), not a bespoke
path. The flag rides the `...existing` spread through `syncFromEditor`, so it
survives a re-parse.

That Task is **drainable end-to-end** (#55b rework): `/editor/draft-footnote`
reads the `kind: "footnote"` queue entry and, because `linkedTo.panel ===
"footnotes"`, **REVISES the existing footnote in place** via `/editor/edit-card`
rather than creating a duplicate (with no `linkedTo`, it composes a brand-new
footnote — the create flow below). The footnote AI-request lives in the AIWindow
(it is **not** in `list_requests.py`'s `PANEL_FILES` fallback — footnote flags
are always bridged, never unbridged-virtual).

## Archive + orphaned footnotes

Footnotes are **archivable** (bug sweep #3) — `isArchivable`
(`src/cards/predicates.ts`) now excludes only `highlight`. Archiving a footnote
splices its `\footnote` atom out of the `.tex` and flags the `footnotes.json` ref
`archived` + `unanchored` (mirror of citations), so the atomless ref survives and
the Footnotes panel lists it under the **Archives** view (`CardViewModeMenu`);
`FootnoteCard` renders an `UnanchoredFootnoteCard` (no jump) whose `EditableCard`
chrome drives archive⇄unarchive. Unarchive clears `archived` only — the atom is
**not** re-inserted, so the footnote returns as an unanchored ref to re-place. It
was a missing render path, not a missing model (the archive machinery already
dispatched to footnotes). Under the DEFAULT-OFF `virgil:inline-atom-lifecycle`
flag the bus policy's orphan-upsert is suppressed for the archived id (the
one-shot `archivedSuppress` seam in `inline-atom-lifecycle-policy.ts`) so a
footnote can't be both archived and orphaned.

When a footnote's in-text marker is deleted but its body/title might still be
wanted, it becomes an **orphan**. The `Footnote` plugin
(`src/lib/tiptap/footnote.ts`) detects vanished footnote nodes off the
structural diff (`diff.removedFootnotes`); orphan-worthiness is gated through the
shared `cardHasContent("footnote", { content, title })` (`src/cards/has-content.ts`)
so a title-only (`\thanks`) footnote still orphans, and the gate matches the
delete-confirm's content model. Orphans persist per-doc in
`virgil/orphaned-footnotes.json` (`OrphanedFootnotesState` = `{ version: 1, orphans }`,
each an `OrphanedFootnote` carrying `content` + optional `title`/`thanks`), owned
by `useOrphanedFootnotes(docId)` (`src/hooks/useOrphanedFootnotes.ts`) — keyed
per-doc, which kills cross-doc orphan bleed under multi-doc keep-alive (FN-A2-03)
— and surfaced in both the Footnotes and Search panels. This hook is now the
**SINGLE** orphan store on **both** flag paths (the swap off the old shell
`useState` is unconditional). The DEFAULT-OFF `virgil:inline-atom-lifecycle`
flag governs **only the writer**: flag-ON the bus reconciler
(`src/links/_shared/useInlineAtomLifecycle.ts`) owns orphan upsert/clear and the
legacy `virgil-footnote-orphaned` event is suppressed; flag-OFF that event drives
the per-pane, docId-routed `useFootnoteOrphanBridges`
(`src/components/editor-layout/event-bridges/footnote-sync.ts`), which filters on
`detail.docId` so a teardown in doc A no longer bleeds into doc B's store. The
detector stamps that `docId` onto the event via the `Footnote` plugin's new
`docIdRef` option (`src/lib/tiptap/footnote.ts`).
