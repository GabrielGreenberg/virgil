<!-- last-verified: 41d988c2 2026-08-25 -->
<!-- derives-from: docs/architecture/VIRGIL.md#reserved-name-inventory -->
<!-- covers-code: src/lib/storage-fsa.ts, src/lib/latex-serializer.ts, src/lib/document-styles.ts, src/app/globals.css, editor/scripts/create_card.py -->

# Gardening (deny-list & cleanup) — operational manifest

> **When to load.** Before a skill writes anything it didn't author, deletes
> text a Card depends on, or composes a preamble/LaTeX that might collide with
> Virgil's reserved names. This is the skill-facing **"what not to touch"** plus
> the cleanup conventions. It **aligns with [editor/AGENTS.md](../../editor/AGENTS.md)**
> (the skill-bundle "Don't" rules) and the [structure.md write path](structure.md#the-write-path)
> rather than restating them — the unique content here is the reserved-name
> deny-list, orphan handling, and the registry-shadow discipline. It fulfills the
> forward-pointers in [ontology.md](ontology.md), [atoms.md](atoms.md#mobility-and-editing-rules),
> and [structure.md](structure.md#what-a-skill-may-read-and-write).

Operational cut of [VIRGIL.md → Reserved-name inventory](../architecture/VIRGIL.md#reserved-name-inventory).
This doc is the operational home for the deny-list; the authoritative substrate is the code SSOTs cited inline below.

## The deny-list

Every name Virgil reserves, such that authoring over it corrupts the round-trip.
**Never define, override, or hand-author any of these.**

**Injected LaTeX macros** — seven no-op entity-id macros plus one package, owned by
`ensurePreambleRequirements` (`src/lib/latex-requirements.ts`, formerly
`ensureVirgilCommands`) + `CLASSIC_PREAMBLE`, topped up on **every
save** even against a user preamble:

```
\vfid  \vcid  \vbid  \vexid  \vxid  \vlid  \vlidend      \usepackage{xcolor}
```

`\vbid` marks a `.bib` entry's durable surrogate id (round-tripped by
`serializeBibFile`, minted by `src/lib/bib-uid.ts`); it lives in the `.bib`, not the
`.tex`, but the serializer still declares the no-op in the preamble so a `\input`'d
`.bib` or a raw-LaTeX open never breaks.
`\pgmark` is reserved too but injected by the **library** indexer, not the editor.
You never write these — the serializer manages them; you author only the content
command they wrap ([identity.md → injected macros](identity.md#the-injected-macros)).
The expex control words (`\ex \pex \xe \a \begingl \endgl \gla …`) are package
commands the parser depends on — don't redefine them either. The same holds for
`\begin{forest}…\end{forest}`, which the parser **claims whole** (task 383) rather
than leaving to the generic carrier — its bytes are the node's authoritative `source`.

**Comment conventions** (all `%!v`-prefixed) — the invisible id surface:

```
%!v:<4hex>   %!v:blank   %!vtex:begin <id> … %!vtex:end <id>   %!v tex:end (escape)
```

Never type, move, or delete one by hand ([identity.md](identity.md#the-marker-family)).

**Where the `%!v:` anchor sits is no longer "the last token on the line."** Two
recent moves matter to any hand-computed splice: a paragraph ending in a `%`
comment carries its anchor INSIDE that comment tail (`prose % note %!v:aaaa`, task
347 — the anchor is comment bytes, so it may ride there), and a `listItem`'s anchor
is APPENDED to the end of the item's whole serialized body and may STACK with a
nested child's (`\end{itemize} %!v:child %!v:me`, task 348 — the LAST anchor is the
outer item's). So "splice just before the trailing `%!v:`" can land your text inside
a comment (where LaTeX will not typeset it) or inside the wrong node. Splice through
`apply_response.py`'s `texEdit`, which owns the placement, rather than computing the
offset yourself. Task 387 adds a third case: a `forestBlock`'s
`\begin{forest}…\end{forest}` is a **user-editable attr** whose anchor is appended
after the closer, so ANY byte you add after `\end{forest}` — a newline included —
moves the anchor off the reader's `[ \t]*` window and de-anchors the block silently
(fresh uuid on the next save, the old id stranded on an empty paragraph). Never append
to a claimed environment's tail.

**Reserved CSS classes & `data-*` attributes** (SSOT [src/app/globals.css](../../src/app/globals.css)).
A skill rarely emits CSS, but **content a skill pastes or authors must not collide**
with the structural hook namespace: `.tiptap` / `.ProseMirror` / `.react-renderer`
/ `.node-<name>`, the `.expex-*` family, `.linked-anchor`, `.dropmode-bar-*`,
`.virgil-bar` / `.panel-*`, and the `data-card-*` / `data-link-*` / `data-print-*`
families. (The full namespace is the SSOT file itself,
[src/app/globals.css](../../src/app/globals.css).)

**Reserved file / folder paths** (SSOT [src/lib/storage-fsa.ts](../../src/lib/storage-fsa.ts)):

- `virgil/` (the sidecar folder), `virgil/figures-cache/`, `virgil/.history/`.
- the sibling **`.virgil/`** (agent/library plumbing — distinct from `virgil/`),
  including `.virgil/pen-context.json` (the editing pen) and `.virgil/scripts/`.
- the **writeback-owned** infrastructure sidecars a skill must **never hand-edit**:
  `version.txt`, `notifications.json`, `collab.json`, `ai-requests.json`,
  `document-settings.json`. (This is the full set the [structure.md write
  path](structure.md#what-a-skill-may-read-and-write) forward-points to — it lists
  the same names as the contract's; this doc is the superset deny-list.)

**v2-reserved overlay paths** — `~/.virgil-user/` and `<docpath>/.virgil/user-overrides/`
are reserved **by design only**. There is **zero code** that reads, writes, or
deny-lists them today (a repo-wide grep is empty under `src/`); the enforcement is
aspirational. Don't write into them expecting Virgil to honor them yet, and don't
treat their absence as a bug ([VIRGIL.md → Reserved-name inventory](../architecture/VIRGIL.md#reserved-name-inventory) records the same).

## What a skill may write (by reference, not restated)

The write rules live in two places — follow them, don't duplicate them:

- **The contract** — read any `.tex`/`.bib`/`virgil/*.json` freely; write Cards
  (and their `.tex` splice) **only through `apply_response.py`**
  ([structure.md → the write path](structure.md#the-write-path)).
- **The skill-bundle "Don't"** — don't hand-edit `.tex` outside the pen-protected
  atomic write; don't bypass `apply_response.py`; don't add a backend
  ([editor/AGENTS.md → Don't](../../editor/AGENTS.md)).

Gardening adds no new write rule — only the deny-list above and the orphan duty below.

### The preservation gates (tasks 350-D / 357) — and why they don't cover you

Virgil now refuses its own **automatic** `.tex` writes when the re-serialized model
would lose content. Two gates, one rule: project away Virgil's own markers, count
WORDS in the preamble and the body **separately**, and refuse on a shrink in either
region, leaving the file byte-identical.

- **Load-writeback gate** — `checkTexPreservation`
  ([src/lib/tex-preservation.ts](../../src/lib/tex-preservation.ts)), on the
  unconditional re-stamp `readDocBundle` fires on open.
- **Write gate** — `write-preservation.ts`, on every `writeDocBundle` that lands
  **before the user's first genuinely undoable edit** (an anchor-UUID mint from a
  grab-handle click or a card drag is an automatic write, not a user edit).
- A refusal is **published**, not logged: `recordPreservationRefusal`
  ([src/lib/preservation-notice.ts](../../src/lib/preservation-notice.ts)) raises a
  non-dismissable topbar banner, forces a forensic snapshot of the intact bundle
  into `virgil/.history/`, and **suspends** the post-user-edit step-aside until the
  user acknowledges. The editor stays editable; only writes to disk are held.

**Stated at the door and repeated here: `apply_response.py` is NOT covered.** The
gates govern writes the *user* did not ask for; a skill's write is a write someone
asked for, so it lands unmeasured. Preservation on the skill side is still the
skill's own duty — splice, don't rewrite; never re-emit a region you merely
re-read.

## Orphan handling

When a skill deletes or moves text a Card depends on, it inherits a cleanup duty.
The editor's guards keep cards from *silently* orphaning (the mechanism — guards,
events, `reanchorByText`, `recoverOrphanedUuids` — is
[anchoring.md → what invalidates a link](anchoring.md#what-invalidates-a-link)); a
skill's job is to make the *intent* right, because recovery is best-effort:

- **Deleting an Atom is deleting half a link.** Removing a `\footnote{}`/`\cite{}`
  leaves its `footnotes.json`/`citations.json` Card orphaned. Insert and delete the
  Atom **and** its Card together — never one without the other
  ([atoms.md](atoms.md#mobility-and-editing-rules)).
- **Deleting an anchored block** leaves a same-uuid **placeholder paragraph**
  (`MarginaliaAnchorGuard`). Decide deliberately: re-anchor the Card to a real
  block, or remove the Card — don't leave it pinned to an empty placeholder.
- **Don't lean on recovery for duplicated text.** `recoverOrphanedUuids` and
  `reanchorByText` skip ambiguous matches, so re-anchor explicitly rather than
  trusting a fingerprint/snapshot match to find the right home.
- **Surface only real ambiguity.** When cleanup hits a genuine judgment call, the
  memo discipline (a dated memo under `<docPath>/.virgil/memos/`) is in
  [editor/AGENTS.md](../../editor/AGENTS.md) — write one only when something
  flagged a real ambiguity, not routinely.

## The Python shadow-rot discipline

The `editor/scripts/` helpers run **outside** the app and can't import the TS
registries, so they **hand-duplicate** two slices of the card vocabulary — and
hand-maintained copies rot. Two shadows exist:

- `apply_response.PANEL_TO_SIDECAR` — the panel → `(file, list-key)` map. The
  refactor had to hand-edit it (`quotations` → `reports`).
- `create_card.ALL_KINDS` — the create-able kinds. **Reconciled** by the create-card
  fan-out to the real set (`footnote` `citation` `note` `todo` `report`
  `report-request` `example`; `quotation`/`annotation` dropped) and **pinned** by a
  module-level assert that every member is a real `CardKind` ([cards.md](cards.md), the SSOT).

`check:coherence` **check 5** reconciles both shadows against the TS SSOTs (`CardKind`,
`PANEL_REGISTRY`) — it is **error-grade and currently clean**. The
`WRITEBACK_EXEMPT_PANELS` allowlist (`archive`/`bibliography`/`errors`/`examples`) records
the card-hosting panels intentionally *not* create-card writeback targets. When you touch
either shadow, re-run the check and keep it reconciled.

## Rules for skills

1. **Author content commands, never markers.** The `\v*` macros and `%!v` comments
   are Virgil's; you write `\footnote{}` / `\section{}` / `\ex…\xe`, not their ids.
2. **Don't collide with reserved names** — macros, comment conventions, CSS/`data-*`
   hooks, and the `virgil/` / `.virgil/` paths.
3. **Never hand-edit the writeback-owned sidecars** (`version.txt`,
   `notifications.json`, `collab.json`, `ai-requests.json`, `document-settings.json`).
4. **Clean up both halves of a link** you break, and **re-anchor deliberately** —
   the guards prevent silent loss, not wrong intent.
5. **Treat the v2 overlay paths as not-yet-real.** Create-ability is the reconciled,
   assert-pinned `create_card.ALL_KINDS` (SSOT `CardKind`).
