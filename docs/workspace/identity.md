<!-- last-verified: 40d62da3 2026-07-10 -->
<!-- derives-from: docs/architecture/VIRGIL.md#uuid-marker-emission -->
<!-- covers-code: src/lib/uuid.ts, src/lib/latex-serializer.ts, src/lib/latex-parser.ts, src/text-objects/text-object-registry.ts, src/lib/latex-paragraph-map.ts, src/lib/document-styles.ts, src/lib/bib-uid.ts, src/lib/bib-parser.ts, src/lib/identity/ -->

# Identity (UUIDs & markers) — operational manifest

> **When to load.** Any task that creates, moves, or deletes a TextObject or an
> Atom, or that must match a Card to its place in the `.tex`. The single rule
> that governs every Atom-linked Card: **the id in the `.tex` marker and the id
> in the sidecar entry must be equal** — break that and the Card orphans.

Operational cut of [VIRGIL.md → UUID marker emission](../architecture/VIRGIL.md#uuid-marker-emission).
Concepts live in [ontology.md](ontology.md); the per-Atom mechanics in
[atoms.md](atoms.md); the LaTeX surface in [latex.md](latex.md).

## The two id namespaces

Two id flavors, both minted in `src/lib/uuid.ts`. Pick by *does it appear in the
`.tex`*:

| Flavor | Generator | Format | Names |
|---|---|---|---|
| **Short id** | `generateShortId(existing?)` | 4-char hex, `[0-9a-f]{4}` (~65 K space) | Everything **in the `.tex`**: the `%!v:` block markers and every `\v*id{}` Atom marker. |
| **Entity id** | `generateEntityId()` | full v4 UUID | Sidecar-only data that **never** appears in `.tex`: notes, todos, comments, archive, revisions, links, Tasks. |

The 4-hex space is small enough that collisions appear in modest documents, so
**every short-id allocation must avoid existing same-kind ids**: pass the set of
ids already present to `generateShortId`, and the serializer runs a dedup pass on
save (below). When a skill mints a new short id (e.g. for a new footnote), it must
collide with neither an existing sidecar id **nor** a marker already in the `.tex`.

## The marker family

Every marker below is **Virgil-auto-managed**: the serializer injects it, the
parser consumes it, and the rendered display strips it. The user authors only the
underlying *content* command (`\footnote{}`, `\citep{}`, `\section{}`, `\ex…\xe`)
and never types or sees a marker. **A skill must never hand-author or delete a
marker** except as a side effect of the content it wraps.

| Marker | Identifies | Shape | Behavior |
|---|---|---|---|
| `%!v:<4hex>` | a **TextObject** (paragraph, heading, list, listItem, blockquote, codeBlock, displayMath, latexComment, titleField, figureBlock, graphicsBlock, …) | trailing line-end **comment** (not a macro) | serializer appends ` %!v:<id>` to every id-bearing block; parser strips the trailing anchor into the node's id. |
| `%!v:blank` | an empty, unidentified paragraph | sentinel comment | round-trips to/from an empty paragraph. |
| `\vfid{<4hex>}` | a **footnote** Atom | inline no-op macro | emitted immediately **before** `\footnote{}` / `\thanks{}`; parser stashes it as `pendingFootnoteId` and attaches to the next footnote. |
| `\vcid{<4hex>}` | a **citation** Atom | inline no-op macro | emitted **before** the cite command; parser stashes `pendingCitationId` for the next cite. |
| `\vbid{<4hex>}` | a **BibEntry** durable surrogate id (`BibEntry.uid`) | no-op macro **line in the `.bib`** (not the `.tex`) | emitted immediately before each BibTeX block by `serializeBibFile`; parser binds it positionally to the entry it precedes (`orderedVbidBindings`, `src/lib/bib-uid.ts`); a `.bib` with no markers mints fresh on first parse and the first save anchors it. Decouples sidecar identity from the renameable citekey — see the IdentityCascade section. |
| `\vexid{<4hex>}` | an **exampleBlock** (`\ex`/`\pex`) | block no-op macro | emitted before `\ex`/`\pex`. |
| `\vxid{<4hex>}` | an **exampleItem** (`\a` row) | block no-op macro | emitted before `\a`; a stray `\vxid` at body scope is discarded so it can't accrete. |
| `\vlid{<4hex>}…\vlidend{<4hex>}` | a **linkedRange** (the `linkedAnchor` mark's span) | paired inline no-op macros | opened where the mark starts, closed where it ends; ranges open at a block boundary are closed and reopened. Reassembled on parse by `applyLinkedAnchorBoundaries`. |
| `%!vtex:begin <id>` … `%!vtex:end <id>` | a **texBlock** (raw-LaTeX passthrough) | block comment sentinels | bracket a verbatim body slurped without recursive parse; a literal `%!vtex:end` inside the body is escaped to `%!v tex:end`. |

SSOTs: which TextObject kind carries which marker → the `sourceMarker` field on
`TEXT_OBJECT_REGISTRY` (`src/text-objects/text-object-registry.ts`); the `%!v:`
regexes → `src/lib/uuid.ts`; emit → `serializeToLatex`/`serializeNode`
(`src/lib/latex-serializer.ts`); parse → `parseBody`/`parseInlineContent`
(`src/lib/latex-parser.ts`).

## Block and paragraph ids

`%!v:<4hex>` is a **trailing line-end comment**, not a macro — it sits at the end
of the block's last source line. Assignment rules (the `assignUuids` pass, below)
decide *which* blocks get one:

- **Container lists** (`bulletList` / `orderedList` / `blockquote`) get **one** id;
  their inner paragraphs are stripped of ids (the container or its `listItem` owns
  the anchor).
- **`listItem`s** each get their own id (so an anchor can pin a single line).
- **Headings** and **titleFields** always get one; a **non-empty paragraph**
  outside a container gets one; the **standalone blocks** (displayMath, latexComment,
  codeBlock, exampleBlock, figureBlock, graphicsBlock) always get one.

`src/lib/latex-paragraph-map.ts` maps `.tex` line numbers ↔ paragraph ids by
re-deriving from the `%!v:` markers (used for code-editor scroll-to-paragraph and
error-line → margin-marker mapping).

## Footnote and citation ids

`\vfid` / `\vcid` are inline no-op macros emitted **immediately before** the
content command, with no space between marker and command:

```
…end of the sentence.\vfid{f0ac}\footnote{…body…} %!v:3301
…as Smith argues\vcid{a1b2}\citep{smith2020}.
```

On parse, the marker is stashed and attached to the *next* footnote/citation
Atom: the Atom's `footnoteId` ← `\vfid`, `citationId` ← `\vcid`. **This id is the
Atom-link key**: the footnote Card's `id` in `footnotes.json` must equal the
`\vfid` id; a citation/bib Card links to every `\vcid` instance of its key. See
[atoms.md](atoms.md) for the Card side and [footnotes.md](footnotes.md) for the
footnote splice recipe.

## Example and linked-range ids

- `\vexid` (exampleBlock) and `\vxid` (exampleItem) ride the expex family
  (`\ex`/`\pex`/`\a`); see [latex.md](latex.md) for the example syntax.
- `\vlid{id}…\vlidend{id}` persist a **linkedRange** to the `.tex`. The range's
  *identity* is the `linkedAnchor` mark's `anchorId` (attrs: `anchorId` / `kind`
  default `"note"` / `linkId` / `tintColor`); the paired markers persist the span
  so it survives a round-trip, and the card link's `textSnapshot` is the recovery
  path (`reanchorByText`) if the mark is lost. Card-side linkage detail is
  [anchoring.md](anchoring.md).

## How ids are assigned and recovered

`assignUuids(doc)` (`src/lib/latex-serializer.ts`) is the single pass that mints
missing block ids before serialization:

- A first **dedup pass** clears duplicate block ids (e.g. from a bad recovery) so
  the second pass re-mints unique ones.
- Inline `citationId` / `footnoteId` are deduped in **separate namespaces**
  (React keys are namespaced `citation:` / `footnote:`), so a footnote and a
  citation may share the 4-hex string without conflict.
- The serializer keeps a local `UUID_BEARING_NODE_TYPES` set mirroring the schema
  group — **adding a TextObject kind to the schema group requires adding it here
  too**, or the new kind serializes without an id.

Companions: `extractSidecarData` writes paragraph titles + content fingerprints
keyed by id into `virgil.json`; `recoverOrphanedUuids` re-attaches a sidecar id to
a node whose marker was lost by **unique** content-fingerprint match (ambiguous
matches are skipped — so a skill should not rely on recovery for duplicated text).

## The injected macros

The `\v*` markers are no-op macros, so a `.tex` still compiles outside Virgil.
`CLASSIC_PREAMBLE` (`src/lib/document-styles.ts`) seeds `\providecommand` no-ops
for `\vfid` / `\vcid` / `\vexid` (+ `\usepackage{xcolor}`); `ensurePreambleRequirements`
(`src/lib/latex-requirements.ts`, formerly `ensureVirgilCommands`) tops up **all seven**
(`SHIM_COMMAND_NAMES`: `\vfid` `\vcid` `\vbid` `\vexid` `\vxid` `\vlid` `\vlidend`) on
every save, even against a user-authored
preamble — `\vbid` is declared in the `.tex` preamble (so a `.bib` `\input` or a
raw-LaTeX open never breaks) even though the marker itself only lives in the
`.bib`. These names are **reserved** — the full never-override deny-list (macros,
comment conventions, CSS, paths) is [gardening.md](gardening.md).

## The IdentityCascade (durable identity, default-OFF rollout)

A second identity axis sits beside the marker-id one above: **renaming a citekey
or regenerating an inline-atom id must not strand the sidecars keyed on the old
value.** The cascade is the single writer for any such identity change. It is
gated behind two **default-OFF** localStorage flags — flag-OFF preserves the
legacy paths exactly, so nothing below is on the hot path until a flag is set.

- **`virgil:identity-cascade`** (`src/lib/identity/identity-flag.ts`,
  `isIdentityCascadeOn`) — the bib-rename + id-regen cascade.
- **`virgil:inline-atom-lifecycle`** (`inline-atom-lifecycle-flag.ts`,
  `isInlineAtomLifecycleOn`) — gates only the orphan-footnote **writer** (T2
  Wave 2): flag-ON, the bus-driven `useInlineAtomLifecycle` reconciler writes the
  store; flag-OFF, the per-pane, docId-routed legacy event web
  (`useFootnoteOrphanBridges`) does. The per-doc orphan **store** itself
  (`useOrphanedFootnotes(docId)`, `src/hooks/useOrphanedFootnotes.ts`) is now the
  single store on **both** paths, unconditionally (un-bundled from the gated
  reconciler) — so orphans survive a reload and never bleed across documents
  regardless of this flag (FN-A2-01, FN-A2-03).

**`IdentityCascade`** (`src/lib/identity/identity-cascade.ts`) is a pure-logic,
per-document service (no React/editor import). Surfaces `registerMigrator(kind,
fn)`; `runIdentityChange(change)` fans one change out to every registered
migrator atomically (errors isolated, never half-applied). Change vocabulary:
`renameCitekeyChange` / `retypeChange` (kind `"bibEntry"`) and `regenIdsChange`
(kind `"inlineAtom"`, an `oldId → newId` remap after a markerless re-parse).
The `.bib` `key`+`type` write, every `\cite{oldKey}` doc-rewrite
(`bib-cite-rewrite.ts`, whole-token + footnote-deep), and each citekey-keyed
sidecar are migrators — adding a new citekey-keyed sidecar gets rename-safety by
registering one, not by patching the rename call site.

**`BibEntry.uid`** (the `\vbid` round-trip, `src/lib/bib-uid.ts` +
`serializeBibFile`/parse in `src/lib/bib-parser.ts`) is the durable surrogate
that decouples sidecar identity from the renameable citekey.
**`sidecar-uid-migrate.ts`** re-keys `annotations.json` / `bib-review-requests
.json` onto the uid non-destructively (unresolvable citekeys bucket under
`orphanByKey`, never silent-delete; additive + idempotent).

**The single inline-atom bus consumer** — `useIdentityBusConsumer`
(`src/lib/identity/useIdentityBusConsumer.ts`) mounts ONCE per pane and opens
exactly ONE `DocStructureBus.onAnyChange` subscription (the **+1, not +3**
keystroke-sanctity consumer). It owns an `IdentityBusConsumer` dispatcher and
registers T1's `regenIds` policy first; Wave-2 themes register **ordered
policies** on it via `registerPolicy` rather than opening their own
subscriptions: `inline-atom-lifecycle-policy.ts` (via `useInlineAtomLifecycle`,
`src/links/_shared/`) and `citation-resync-policy.ts` (via `useCitationResync`).
`onAnyChange` is `emitCount`-gated and the handler bails O(1) when no
citation/footnote entered or left the transaction, so plain typing runs zero
consumer code.

## Rules for skills

1. **Never type or delete a marker by hand.** Let the serializer manage them;
   author only content commands.
2. **Match ids exactly.** An Atom-linked Card's sidecar `id` must equal its `.tex`
   marker id. This is the link; there is no separate pointer field for footnotes.
3. **Mint collision-free short ids** against both the sidecar and the live `.tex`
   when creating a new Atom (`create_card.py` does this for footnotes).
4. **Don't fabricate entity ids in the `.tex`** or short ids in a sidecar — the
   namespaces don't cross.
5. **Trust the dedup/recovery passes only for unique content** — duplicated text
   can't be recovered unambiguously.
