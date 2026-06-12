<!-- last-verified: bcca090 2026-06-12 -->
<!-- derives-from: docs/architecture/VIRGIL.md#card-kind-taxonomy -->
<!-- covers-code: src/cards/types.ts, src/cards/card-registry.tsx, src/cards/predicates.ts, src/panels/panel-registry.ts, src/components/panel-primitives.tsx, src/lib/types.ts, src/hooks/useReports.ts, src/lib/ai-request-bridge.ts -->

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

## The `CardKind` vocabulary — 16 kinds

`CardKind` (SSOT: [src/cards/types.ts](../../src/cards/types.ts), the type
layer beside the registry) is the canonical card vocabulary — **16 kinds** as
shipped:

`note` · `highlight` · `footnote` · `citation` · `example` · `todo` ·
`archive` · `report` · `report-request` · `revision-comment` ·
`revision-suggestion` · `cutter-comment` · `cutter-suggestion` · `bib` ·
`ai` · `error`.

(The card-system refactor removed `quotation`, added `report` +
`report-request`, renamed the bare `comment` spine kind to `revision-comment`,
and dropped bare `suggestion` from the spine — `comment`/`suggestion` survive
only as the on-disk data discriminators, [below](#two-taxonomies-registry-cardkind-vs-the-persisted-discriminator).)

Every per-kind fact hangs off **one registry**: `CARD_REGISTRY`
([src/cards/card-registry.tsx](../../src/cards/card-registry.tsx)), a
`Record<CardKind, CardMeta>` — one entry per kind carrying `panel` /
`keyPrefix` / `label` / `titleLabel` / `themeKey` / `anchored` / `markerType` /
`lifecycle` / `morph` / `stackable` / `poppable` / `bodyClass`. The
formerly-parallel tables are **derived** from it, never extended by hand
(extend the registry, never a parallel table —
[VIRGIL.md → registries](../architecture/VIRGIL.md#the-single-sources-of-truth-registries)):

| Derived accessor / table | File | `CardKind` → |
|---|---|---|
| `panelForCardKind` / `cardKindsForPanel` | [predicates.ts](../../src/cards/predicates.ts) | the hosting `PanelKind` (`CardMeta.panel`) |
| `CARD_KEY_PREFIXES` / `cardKeyPrefix` | [panel-registry.ts](../../src/panels/panel-registry.ts) / [predicates.ts](../../src/cards/predicates.ts) | LEGACY popout-key prefix (`${prefix}:${id}` — dual-read + migrated; live keys are `float:card:<kind>:<id>` via `cardPopKey`) |
| `CARD_TYPE_LABELS` | [panel-registry.ts](../../src/panels/panel-registry.ts) | uppercase overline label (OmniView disambiguation; `CardMeta.label`) |
| `CARD_TITLE_LABELS` | [panel-registry.ts](../../src/panels/panel-registry.ts) | auto-title prefix, or `null` if the kind doesn't auto-title (`CardMeta.titleLabel`) |
| `CARD_THEMES` | [panel-primitives.tsx](../../src/components/panel-primitives.tsx) | accent theme, keyed by `CardMeta.themeKey` |

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
  discriminators by **panel context** into `revision-comment` /
  `revision-suggestion` / `cutter-comment` / `cutter-suggestion` for popout
  keys, themes, anchored-card identity, and OmniView filters. So a Revisions
  comment is the spine kind `revision-comment` and a Cutter comment is
  `cutter-comment`, though **both persist `kind: "comment"`** on disk. The
  read-side classifier is `cardKindFromRecord(record, panel)`
  ([predicates.ts](../../src/cards/predicates.ts)) — an on-disk `kind` + the
  owning panel resolve to the spine kind.

Operationally: **never infer a card's registry `CardKind` from its on-disk `kind`
alone — you also need the sidecar file it came from.** A `kind: "suggestion"`
record in `cutter.json` is a `cutter-suggestion`; the same `kind: "suggestion"` in
`revisions.json` is a `revision-suggestion`.

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
| `revision-comment` | Revisions (poly) | `revisions.json` · `cards` | `"comment"` | anchor (A or B) | `aiRequest` → Task `suggestion` |
| `cutter-comment` | Cutter (poly) | `cutter.json` · `cards` | `"comment"` | anchor (A or B) | `aiRequest` → Task `suggestion` |
| `cutter-suggestion` | Cutter (poly) | `cutter.json` · `cards` | `"suggestion"` | anchor (A or B) | `status`; `author`; **Accept enqueues a Task** |
| `revision-suggestion` | Revisions (poly) | `revisions.json` · `cards` | `"suggestion"` | anchor (A or B) | `status`; `author` |
| `report` | Reports (poly) | `reports.json` · `cards` | `"report"` | anchor (A or B) | `author` byline (human/ai) |
| `report-request` | Reports (poly) | `reports.json` · `cards` | `"report-request"` | anchor (A or B) | `aiRequest` → Task `report` |
| `example` | Examples | `examples.json` · `examples` | — | **is a TextObject** (`exampleBlock`, `\vexid`/`\vxid`); sidecar is a metadata *shadow* | none |
| `ai` | *(Inbox)* | `ai-requests.json` · `requests` | — (carries `kind: AiRequestKind`) | flexible — anchor and/or atom-links, or neither | the full Task machine ([below](#the-task-card-ai)) |
| `error` | Errors | *(not persisted)* | — | maps to a `.tex` line / paragraph | ephemeral — re-derived each lint pass |

## The polymorphic panels

Four panels host **two** `CardKind`s each. Membership is *derived* from
`CardMeta.panel` via `cardKindsForPanel(panel)` / `panelForCardKind(kind)`
([predicates.ts](../../src/cards/predicates.ts)) — there is no hand-kept
polymorphic-panel map:

| Panel | Hosts | Shared key/theme | Morph |
|---|---|---|---|
| **Notes** | `note` + `highlight` | each its own accent | `note` ⇄ `highlight`, **lossy both ways** (a highlight has no body/title) — a confirm guards both flips (`morph.lossy` is true in both directions) |
| **Revisions** | `revision-comment` + `revision-suggestion` | the `revision` key | non-lossy both ways (the body rides into `user_text` and back) |
| **Cutter** | `cutter-comment` + `cutter-suggestion` | the **legacy `cut` key** (`CARD_THEMES.cut`) | non-lossy both ways |
| **Reports** | `report` + `report-request` | `report` | `report` ⇄ `report-request`, lossy both ways — [below](#the-reports-panel) |

Each pair is a reciprocal **morph pair** (`CardMeta.morph: { to, lossy }`): the
card converts *in place* into its panel sibling — preserving id / createdAt /
anchor, flipping the on-disk data discriminator — via the kind control on the
card header (and the popped float's title control), backed by a transform
registered through `registerCardMorph`
([card-registry.tsx](../../src/cards/card-registry.tsx)).

## The homeless kind: `ai` (and the ghost `suggestion`)

Exactly one kind has **no hosting panel** (`CardMeta.panel === null`,
`panelForCardKind` → `null`):

- **`ai`** — the **Task**, cross-cutting by design. AI requests surface in *every*
  panel's inbox, so they have no parent panel; the Inbox is their surfacing
  surface. See [the Task Card](#the-task-card-ai).

A bare **`suggestion`** is **not a `CardKind` at all** — it survives only as
(1) the on-disk data discriminator on `cutter-suggestion` /
`revision-suggestion` records, and (2) the *generic* "respond with a doc edit"
**Task kind** (`AiRequestKind`): the registry's `aiRequest` routing declares
both `cutter-comment` and `revision-comment` → Task kind `suggestion`.

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

## Theme resolution — one keyspace, shared identities

A card's accent resolves through **one keyspace**: the registry `themeKey`
vocabulary *is* `PanelThemeKey` (13 keys — the legacy `comment` alias for the
revision identity is gone). `CARD_THEMES`
([panel-primitives.tsx](../../src/components/panel-primitives.tsx)) is a
mechanical fold over `DEFAULT_PANEL_COLORS`
([panel-theme.ts](../../src/lib/panel-theme.ts)); a user color-override
replaces the accent and re-derives the palette (`useCardTheme(themeKey)`).
Worth knowing before you touch any key:

- **Shared identities** (one theme, several card kinds): `revision` colors both
  Revisions kinds; the legacy **`cut`** key colors both Cutter kinds; `report`
  colors `report` + `report-request`. `highlight` is distinct from `note`, so
  highlights read as their own accent inside the Notes panel.
- **System accents**: `aiRequest` (sky) and `error` (rust) are in
  `SYSTEM_THEME_KEYS` — non-overridable, so a user color-override can't
  re-tint them.
- **Popout-prefix hazard**: the `keyPrefix` values are **preserved
  byte-for-byte** from the legacy table because they're persisted
  (localStorage `poppedOutCards`, omni ids). The Revisions pair is the
  intentional drift: `revision-comment` → prefix `revision`,
  `revision-suggestion` → `revision-suggestion` (legacy persisted key `revision:s:<id>`, dual-read + migrated; live key `float:card:revision-suggestion:<id>`).
  *Don't rename a prefix without a migration* (`card-registry.tsx`).

## Rules for skills

1. **Target the sidecar, not the panel.** A skill writes a Card by writing its
   sidecar file through the contract — never by driving the Panel UI.
2. **The on-disk `kind` is coarse.** Resolve the registry `CardKind` from
   *(sidecar file + on-disk `kind`)* together, never the `kind` alone.
3. **Pick linkage by kind.** `footnote`/`citation` are **atom-linked** (id
   equality, no `links` array); `note`/`todo`/`archive`/`report` and the
   comment/suggestion kinds are **anchored** (`links: Link[]`); `example` *is* a
   TextObject. Mechanism + invalidation: [anchoring.md](anchoring.md).
4. **`report` is content, `report-request` is an ask.** Answer a request by
   drafting a *new* `report` (`author: "ai"`) — don't overwrite the request.
5. **Create through `apply_response.py`.** The Task, the card, and the source-flag
   clear are one atomic transaction ([structure.md](structure.md#the-write-path)).
