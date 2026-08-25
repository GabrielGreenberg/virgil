---
description: |
  Edit an existing card's body or a named field in a Virgil paper, through the
  apply_response writeback contract (atomic, pen-protected). Triggers on: "edit
  this card", "change the note body", "rename this card", "mark the todo done",
  "fix the text on card X", or as the mechanical edit step behind a responder
  skill that revises a card already on disk. Resolves the card via card_by_id.py,
  then routes an `update` op (body → the kind's body field, with the footnote
  `.tex \footnote{}` kept in sync; --field → an arbitrary named field). Does NOT
  compose content (that's chat's job), does NOT create a card (use
  /editor/create-card), and REFUSES a citation card outright — `--field` included,
  not just its command — because its fields are coupled to the `.tex` cite and
  `references.bib` (use /editor/find-citation). `--field` is generic over
  ORDINARY fields only: a field whose transition another op owns is refused by
  name — above all a suggestion's `status`, which belongs to
  /editor/accept-suggestion and /editor/reject-suggestion (they splice the .tex
  and complete the Task; setting the field alone flips the panel and changes
  nothing else). Args: <docPath> <cardId> [--body <text>] [--field <k>=<v> …].
---

# /editor/edit-card $ARGUMENTS

Mutate an **existing** card (EDITOR_SKILLS_V1 §10). One of the five existing-card
ops; like all of them it resolves the card with
[`card_by_id.py`](../scripts/card_by_id.py) and routes the change through the one
sanctioned writeback, [`apply_response.py`](../scripts/apply_response.py) — the
sidecar edit (and, for a footnote, the `.tex \footnote{}` body) land **atomically
under the editing pen**, with the audit notification + version bump. This skill
is **mechanical**: the new body/value is supplied by you/chat, not composed here.

> **Allowable-LaTeX doctrine.** Any LaTeX in a `--body`/`--field` you land
> must stick to the vocabulary Virgil renders meaningfully — read
> [_latex-allowlist.md](_latex-allowlist.md). In particular use the tie `~`
> (never `\textasciitilde{}`) for a non-breaking space, plus the `\cite…`
> family and inline marks it lists; anything outside it renders as raw grey
> monospace.

## Args

- `<docPath>` — the paper folder.
- `<cardId>` — the id of the card to edit (a v4 entity id, or a 4-hex `\v*id`
  marker id for a footnote).
- `--body "<text>"` — replace the card's primary body. The op maps it per kind:
  `note`/`footnote` → `content` (JSONContent); `todo` → `text`;
  `report`/`report-request`/`comment`/`cutter-comment` → `content` **and** the
  plain-text `text` mirror. For a **footnote** it also rewrites the
  `\vfid{…}\footnote{…}` body in the `.tex`, in the same transaction.
- `--field <k>=<v>` — set a named field (repeatable). Generic: e.g.
  `--field title="New title"`, `--field done=true`, `--field author=ai`,
  `--field highlightColor=yellow`, `--field suggested_text="…"`. Values are
  JSON-typed (booleans/numbers bare, strings quoted).
  **Generic does not mean unrestricted:** a field whose transition another op
  OWNS is refused, with the owning door named in the error. See *Reserved
  fields* below.

## Procedure

1. **Resolve + sanity-check the card.** Confirm it exists and see its kind:
   ```bash
   python3 editor/scripts/card_by_id.py <docPath> <cardId>
   ```
   `{found:false}` → stop (wrong id). Note the `panel`/`cardKind`.

2. **Build the `update` op-json and run it.** Translate `--body`/`--field` into
   `body` + a `set` object:
   ```bash
   python3 editor/scripts/apply_response.py <docPath> update \
     '{"cardId":"<cardId>","body":"<new body>","set":{"title":"<t>"}}'
   ```
   Body only, or fields only, are both fine — but at least one is required (an
   empty update is refused). It prints `{ok, version, op:"update", cardId,
   cardKind}`.

## Applicability (which kinds — derived from the manifest)

- **Editable body** (`--body`): `note`, `todo`, `footnote`, `report`,
  `report-request`, `comment`, `cutter-comment`.
- **Named fields only** (`--field`, no single editable body): `highlight`
  (`highlightColor`), the suggestion family (`cutter-suggestion` /
  `revision-suggestion` — edit `suggested_text` / `user_text` /
  `explanation` / `instructions`). **Not `status`**: that transition belongs to
  [`accept-suggestion`](accept-suggestion.md) /
  [`reject-suggestion`](reject-suggestion.md), and the op refuses it here — see
  *Reserved fields* below.
- **Refused** — `citation` (its `command`/`keys` are coupled to the `.tex` cite
  **and** `references.bib`; change a cite via [`find-citation`](find-citation.md),
  or rename its citekey via the `renameCitekey` contract op —
  [`sync-bib-to-library`](sync-bib-to-library.md)), `example` (lives in the
  `.tex`, not a card),
  `bib`/`ai`/`error` (system/derived). The op refuses these rather than desync —
  a **blanket** citation refusal, `--field` included, since "which fields are
  coupled?" is its own drift.

### Reserved fields — a field another op OWNS is refused here

`--field` is generic over *ordinary* fields. It is **not** a second door onto a
transition that a dedicated op performs, and the op refuses those by name:

| Field | Owner | Why edit-card can't do it |
|---|---|---|
| `status` on a suggestion | [`accept-suggestion`](accept-suggestion.md) / [`reject-suggestion`](reject-suggestion.md) | `accept` splices `original_text` → `suggested_text` into the `.tex` under `replace-span`'s stale-guard **and** completes the originating Task. Setting the field alone flips the panel to *accepted* while the paper is byte-unchanged and the Task stays open. (`applied`/`stale` are the browser's own pending-change states — not writable from the contract at all.) |
| `links` | [`move-card`](move-card.md) | `links` **is** the anchor; the move op validates the target uuid against the `.tex` and refuses an atom-bearing card or a Mode-B range. |
| `originalPanel` / `originalCard` | [`archive-card`](archive-card.md) / [`restore-card`](restore-card.md) | the origin record `restore` reads verbatim to put a card back where it came from. |
| `id`, `aiOriginRequestId` | [`create-card`](create-card.md) | `id` **is** the `\v*id` marker id for a footnote/citation; `aiOriginRequestId` is the back-pointer `accept`/`reject` read to pick which Task to complete. |

Everything else — `title`, `done`, `author`, `highlightColor`, `suggested_text`,
`user_text`, `explanation`, `instructions`, `notes`, `aiRequest`, … — stays
editable here. (`aiRequest` deliberately so: `draft-footnote`'s virtual-request
branch clears a footnote's flag with exactly this op.)

> **Enforcement (tasks 156 + 467).** Neither list above is prose the op is
> trusted to honor — both are TABLES it asks:
> `apply_response.MUTATION_PANEL_POLICY` answers *may this op write a card in
> this panel?* (an **allow-list** exhaustive over the card-store universe, so a
> panel nobody classified is refused), and `apply_response.OP_OWNED_FIELDS`
> answers *may this op write this field?* (a **deny-list** DERIVED from the ops
> — a field is reserved precisely because another door owns its transition, so a
> new op inherits the refusal by declaring what it owns). The doc and the code
> cannot fork the way they had here twice: `cmd_update` guarded
> `archive`/`examples`, forgot `citations`, and silently desynced the sidecar
> from the `.tex` + `.bib` for a year (156); and this file named `status` as an
> editable suggestion field while the `accept` op owned that transition, so an
> agent "accepted" a suggestion and the paper never changed (467). Contracts:
> `editor/scripts/tests/test_panel_policy_slice.py`,
> `editor/scripts/tests/test_field_policy_slice.py`,
> `editor/skills/__tests__/field-ownership.test.ts`.

## Reply

```
Done: edit-card <cardId> (<cardKind> in <panel>.json). Output: <panel>.json (+ document.tex for a footnote, notifications, version).
```

## Safety

- Don't hand-edit the sidecars or `.tex` — route through `apply_response.py update`
  so the pen + atomic transaction + audit notification stay centralized.
- A footnote body lives in **two** places (`footnotes.json` `content` + the `.tex`
  `\footnote{}`); the `update` op edits both together so they can't drift. Don't
  edit one without the other.
