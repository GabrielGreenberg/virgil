<!-- last-verified: 3a54711 2026-06-08 -->
<!-- derives-from: docs/architecture/VIRGIL.md#card-kind-taxonomy -->
<!-- covers-code: src/panels/_shared/types.ts, src/panels/panel-registry.ts, src/components/panel-primitives.tsx, src/lib/types.ts, src/hooks/useReports.ts, src/lib/ai-request-bridge.ts -->

# Cards (the kind taxonomy) — operational manifest

> **When to load.** Any task that creates, reads, or routes a Card —
> deciding which kind to make, which sidecar it lands in, what discriminator
> it carries, and which linkage class it has. This doc is the **taxonomy**:
> the field-level JSON schemas are [sidecars.md](sidecars.md), the linkage
> *mechanism* (anchor vs Atom link, what invalidates each) is
> [anchoring.md](anchoring.md), and the atomic write contract is
> [structure.md → the write path](structure.md#the-write-path). It fulfills the
> forward-pointers in [ontology.md](ontology.md) ("the card-kind shapes") and
> [atoms.md](atoms.md#citation) ("per-kind Card shapes").

Operational cut of [VIRGIL.md → Card-kind taxonomy](../architecture/VIRGIL.md#card-kind-taxonomy).
A **Card** is the parallel structure — "almost everything that isn't text"
([ontology.md](ontology.md)). This doc answers the three questions a skill asks
before it touches one: *which kind is this? where does it persist? how is it
tied to text?*

## The `CardKind` vocabulary — 17 kinds

`CardKind` (SSOT: [src/panels/_shared/types.ts](../../src/panels/_shared/types.ts))
is the canonical card vocabulary — **17 kinds** as shipped:

`note` · `highlight` · `footnote` · `archive` · `todo` · `bib` · `citation` ·
`comment` · `suggestion` · `cutter-comment` · `cutter-suggestion` ·
`revision-suggestion` · `report` · `report-request` · `example` · `ai` ·
`error`.

(Was 16 before the card-system refactor: `quotation` removed; `report` +
`report-request` added.)

`CardKind` is the **theming / keying / labeling** vocabulary — the shared key
space of five parallel registries, each its own SSOT (extend the registry,
never a parallel table — [VIRGIL.md → registries](../architecture/VIRGIL.md#the-single-sources-of-truth-registries)):

| Registry | File | `CardKind` → |
|---|---|---|
| `PANEL_REGISTRY` + `POLYMORPHIC_CARD_PANEL` | [panel-registry.ts](../../src/panels/panel-registry.ts) | the hosting `PanelKind` |
| `CARD_KEY_PREFIXES` | [panel-registry.ts](../../src/panels/panel-registry.ts) | popout-key prefix (`${prefix}:${id}`, persisted to localStorage) |
| `CARD_TYPE_LABELS` | [panel-registry.ts](../../src/panels/panel-registry.ts) | uppercase overline label (OmniView disambiguation) |
| `CARD_TITLE_LABELS` | [panel-registry.ts](../../src/panels/panel-registry.ts) | auto-title prefix, or `null` if the kind doesn't auto-title |
| `CARD_THEMES` | [panel-primitives.tsx](../../src/components/panel-primitives.tsx) | static accent theme |

## Two taxonomies: registry `CardKind` vs. the persisted discriminator

**The single most important recognition nuance.** The registry `CardKind` is
**not** the vocabulary stored on disk:

- The **persisted discriminator** (`card.kind` in the sidecar JSON) exists *only
  on the polymorphic panels' cards* and uses a **coarser** set: `note` /
  `highlight` (Notes), `comment` / `suggestion` (used by **both** Cutter *and*
  Revisions), `report` / `report-request` (Reports). Every **single-kind** panel's
  records carry **no `kind` field at all** — the file they live in identifies the
  kind.
- The **registry `CardKind`** re-qualifies the coarse Cutter/Revisions
  discriminators by **panel context** into `cutter-comment` / `cutter-suggestion`
  / `revision-suggestion` for popout keys, themes, anchored-card identity, and
  OmniView filters. So `comment` (the registry `CardKind`) means specifically the
  *Revisions* comment; a Cutter comment is `cutter-comment` though **both persist
  `kind: "comment"`** on disk.

Operationally: **never infer a card's registry `CardKind` from its on-disk `kind`
alone — you also need the sidecar file it came from.** A `kind: "suggestion"`
record in `cutter.json` is a `cutter-suggestion`; the same `kind: "suggestion"` in
`revisions.json` is a `revision-suggestion`. (A third axis, the linkedRange
highlight markers' `MARKER_KIND_TO_THEME_KEY`, is the marker-side palette key —
distinct again from both; you meet it only when styling a highlight, not when
routing a card.)

## The per-kind table

Grounded in `PANEL_REGISTRY` + `CARD_KEY_PREFIXES` + the card interfaces in
[src/lib/types.ts](../../src/lib/types.ts). **Linkage** is the *class* (the
mechanism is [anchoring.md](anchoring.md)): **anchor** = a Card's paragraph
pointer (Mode A) or text-range `linkedRange` pointer (Mode B), carried in
`links: Link[]`; **atom-link** = a bidirectional tie to an inline Atom, by **id
equality** (no `links` array). Field schemas are [sidecars.md](sidecars.md).

| `CardKind` | Host panel | Sidecar · key | On-disk `kind` | Linkage | Lifecycle |
|---|---|---|---|---|---|
| `note` | Notes (poly) | `notes.json` · `cards` | `"note"` | anchor (A or B) | `aiRequest` → Task `note` |
| `highlight` | Notes (poly) | `notes.json` · `cards` | `"highlight"` | anchor (B only — exactly one range) | `aiRequest` → Task `highlight` |
| `footnote` | Footnotes | `footnotes.json` · `footnotes` | — | **atom-link** to `\footnote{}`/`\thanks{}` (`id` = `\vfid`); unanchored OK | none |
| `archive` | Archive | `archive.json` · `snippets` | — | anchor (A; may pin many paragraphs) | none |
| `todo` | Todo | `todos.json` · `items` | — | anchor (A) | `done` bool; `aiRequest` → Task `todo` |
| `bib` | Bibliography | the **`.bib` file** (+ `bib-settings.json` / `annotations.json` / `bib-review-requests.json`) | — | **atom-link** to every `\cite{}` of its key | reviewed via `bib-review-requests.json` |
| `citation` | Citations | `citations.json` · `citations` | — | **atom-link** to cite commands (`id` = `\vcid`); `unanchored` flag | none |
| `comment` | Revisions | `revisions.json` · `cards` | `"comment"` | anchor (A or B) | `aiRequest` → Task `suggestion` |
| `suggestion` | *(homeless)* | stored as `cutter-`/`revision-suggestion` | `"suggestion"` | — | — (the bridge's generic Task kind) |
| `cutter-comment` | Cutter (poly) | `cutter.json` · `cards` | `"comment"` | anchor (A or B) | `aiRequest` → Task `suggestion` |
| `cutter-suggestion` | Cutter (poly) | `cutter.json` · `cards` | `"suggestion"` | anchor (A or B) | `status`; `author`; **Accept enqueues a Task** |
| `revision-suggestion` | Revisions | `revisions.json` · `cards` | `"suggestion"` | anchor (A or B) | `status`; `author` |
| `report` | Reports (poly) | `reports.json` · `cards` | `"report"` | anchor (A or B) | `author` byline (human/ai) |
| `report-request` | Reports (poly) | `reports.json` · `cards` | `"report-request"` | anchor (A or B) | `aiRequest` → Task `report` |
| `example` | Examples | `examples.json` · `examples` | — | **is a TextObject** (`exampleBlock`, `\vexid`/`\vxid`); sidecar is a metadata *shadow* | none |
| `ai` | *(Inbox)* | `ai-requests.json` · `requests` | — (carries `kind: AiRequestKind`) | flexible — anchor and/or atom-links, or neither | the full Task machine ([below](#the-task-card-ai)) |
| `error` | Errors | *(not persisted)* | — | maps to a `.tex` line / paragraph | ephemeral — re-derived each lint pass |

## The polymorphic panels

Three panels host **two** `CardKind`s each (registered `card: null`, resolved via
`POLYMORPHIC_CARD_PANEL`):

| Panel | Hosts | Shared key/theme | Note |
|---|---|---|---|
| **Notes** | `note` + `highlight` | each its own accent | Adding a note to a highlight spawns a **sibling** note sharing the anchor — **no morph**; both coexist in the one `cards` array. |
| **Cutter** | `cutter-comment` + `cutter-suggestion` | the **legacy `cut` key** (`CARD_THEMES.cut`) | One accent for the whole panel. |
| **Reports** | `report` + `report-request` | `report` | The newest panel — [below](#the-reports-panel). |

`getPanelByCardKind(kind)` resolves a kind to its panel — scanning
`PANEL_REGISTRY[*].card.kind` first, then `POLYMORPHIC_CARD_PANEL`. **Revisions
is *not* registered polymorphic** (its `card` is the single `comment` entry) but
it nonetheless hosts `revision-suggestion`, which `POLYMORPHIC_CARD_PANEL` maps
back to `revisions`.

## Homeless kinds: `suggestion` and `ai`

Two kinds have **no hosting panel** (`getPanelByCardKind` → `null`):

- **`suggestion`** — the *generic* "respond with a doc edit" kind. On disk it
  always lives as `cutter-suggestion` / `revision-suggestion`; the bare
  `suggestion` is the **bridge's** Task kind (`PANEL_TO_KIND` maps both `cutter`
  and `revisions` → `suggestion`). It exists so the keying/labeling tables are
  total, but it never names a panel.
- **`ai`** — the **Task**, cross-cutting by design. AI requests surface in *every*
  panel's inbox, so they have no parent panel; the Inbox is their surfacing
  surface. See [the Task Card](#the-task-card-ai).

## The Reports panel

The Reports panel ([src/panels/Reports/](../../src/panels/Reports/)) replaced the
Quotations panel in the refactor — polymorphic over `report` + `report-request`,
both in `reports.json` (`ReportsState = { cards: ReportItem[] }`), themed
`report`. The two kinds:

- **`report`** (`ReportCard`) — an authored **content** card: `author: "human" |
  "ai"`, an editable `title`, rich-text `content` (+ a plain-text `text` mirror).
  Renders an **AuthorByline** footer; an AI-authored report reads as **"AI"**,
  never "Claude".
- **`report-request`** (`ReportRequestCard`) — the user's **ask**: a titleless
  card with an `aiRequest` flag (placeholder *"What should Claude report on?"*).

**Lifecycle** (`src/hooks/useReports.ts`): the user creates a Report Request →
toggles its `aiRequest` flag, which bridges into `ai-requests.json` as a Task of
kind **`report`** → the [`answer-report-request`](../../editor/skills/answer-report-request.md)
skill researches + composes, then drafts a **new** `ReportCard` with `author:
"ai"` anchored to the same paragraph. It **never mutates the source request in
place**; a human can equivalently `addReport` directly (`author: "human"`).

Both kinds drag with one MIME (`MIME_REPORT`, the kind embedded in the payload),
re-anchor through the single `ctx.reports` drop API, and collapse to one "Reports"
OmniView filter. There is **no `quotations.json` → `reports.json` data migration**
— the refactor was a replacement, so a pre-refactor paper's `quotations.json` is
simply not read.

## The Task Card (`ai`)

A **Task** is a Card kind with a lifecycle the others lack — the unit of work the
user files and the Inbox surfaces ([VIRGIL.md → Tasks as a Card kind](../architecture/VIRGIL.md#tasks-as-a-card-kind)).
It is the `ai` kind, stored as an `AiRequest` in `ai-requests.json` · `requests`
(schema in [sidecars.md → `ai-requests.json`](sidecars.md#the-task-store-ai-requestsjson)).
What makes it special:

- **It is polymorphic over `AiRequestKind`** (8 values: `footnote` · `note` ·
  `highlight` · `citation` · `todo` · `suggestion` · `report` · `style-merge`) —
  a *second* axis, distinct from `CardKind`. The `kind` signals which subskill
  drains it.
- **Its linkage is the most flexible of any card.** A Task may anchor via
  `paragraphIds` (Mode A), carry Atom links, both, or **neither** — a "review the
  whole doc" Task has no anchor.
- **It carries the lifecycle machine** the other kinds don't: `status` (where it
  is) + `result` (how it ended) + an optional per-Task `safetyLevel` (1/2/3). The
  *vocabulary and the `safetyLevel` → subcommand mapping* are owned by
  [VIRGIL.md → Cowork pattern](../architecture/VIRGIL.md#cowork-pattern) and
  [structure.md → the write path](structure.md#the-write-path) — don't re-derive
  them; this doc only records that the `ai` card *is* where they live.
- **It is created two ways.** *Workflow A* — bridged from a card's `aiRequest`
  flag (`bridgeCardAiRequestFlag`, `linkedTo: { panel, cardId }`); *Workflow B* —
  synthesized on the fly for a chat-initiated call (`--synthesize-task`). Either
  way the Task, the result card, and the source-flag clear land **atomically
  through `apply_response.py`**, never a raw write.

A subtlety worth recognizing: **accepting a `cutter-suggestion`/`revision-
suggestion` enqueues a Task** rather than editing the `.tex` — the editor never
mutates the document on accept, so the textual replacement rides the same cowork
write path as everything else. That replacement is consummated skill-side by
[`/editor/accept-suggestion`](../../editor/skills/accept-suggestion.md) (chip 13):
it splices `original_text` → `suggested_text` through `apply_response.py`'s generic
`replace-span` texEdit — stale-guarded (a proposal whose `original_text` no longer
matches the anchored paragraph is refused, never blindly spliced) — flips the card
`status` → `accepted`, and completes the originating Task in one atomic commit;
`/editor/reject-suggestion` flips `status` → `rejected` with the `.tex` untouched.
This closes the **L3 (propose→review→apply) loop** — the last of the three safety
levels to ride the contract end to end (L1 silent · L2 auto+comment · L3
propose→accept→splice).

## Theme resolution and the key aliases — a renaming hazard

A card's accent resolves through two layers, and the names don't quite line up —
worth knowing before you touch any key:

- **`CARD_THEMES`** (static default, keyed by `CardKind`-ish strings; 13 keys).
  `error` (rust) and `aiRequest` (sky) are **system** accents, hardcoded so a
  user color-override can't re-tint them.
- **the user-customizable panel palette** (`PanelThemeKey` / `DEFAULT_PANEL_COLORS`)
  — read at runtime via `useCardTheme(panelKey)`. It uses **`revision`** where
  `CARD_THEMES` uses **`comment`** (same accent, two names); Cutter cards use the
  **`cut`** key.

Two aliases live in this gap: `comment` ⇄ `revision`, and the Cutter trio sharing
the legacy **`cut`** key. The Revisions popout prefix is `revision` (not
`comment`) for the same historical reason — *the persisted popout keys predate the
registry; don't rename them without a migration* (`panel-registry.ts`).

## Rules for skills

1. **Target the sidecar, not the panel.** A skill writes a Card by writing its
   sidecar file through the contract — never by driving the Panel UI.
2. **The on-disk `kind` is coarse.** Resolve the registry `CardKind` from
   *(sidecar file + on-disk `kind`)* together, never the `kind` alone.
3. **Pick linkage by kind.** `footnote`/`citation` are **atom-linked** (id
   equality, no `links` array); `note`/`todo`/`archive`/`comment`/`report` and the
   suggestion kinds are **anchored** (`links: Link[]`); `example` *is* a
   TextObject. Mechanism + invalidation: [anchoring.md](anchoring.md).
4. **`report` is content, `report-request` is an ask.** Answer a request by
   drafting a *new* `report` (`author: "ai"`) — don't overwrite the request.
5. **Create through `apply_response.py`.** The Task, the card, and the source-flag
   clear are one atomic transaction ([structure.md](structure.md#the-write-path)).
