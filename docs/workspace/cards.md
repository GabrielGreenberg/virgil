<!-- last-verified: 3d621676 2026-06-27 -->
<!-- derives-from: docs/architecture/VIRGIL.md#card-kind-taxonomy -->
<!-- covers-code: src/cards/types.ts, src/cards/card-registry.tsx, src/cards/predicates.ts, src/cards/has-content.ts, src/cards/lifecycle/run-event.ts, src/cards/lifecycle/card-lifecycle-signal.ts, src/cards/lifecycle/useCardLifecycleReconciler.ts, src/panels/panel-registry.ts, src/panels/_shared/card-archive-actions.tsx, src/panels/_shared/card-archive-view.tsx, src/panels/_shared/CardViewModeMenu.tsx, src/components/panel-primitives.tsx, src/lib/types.ts, src/hooks/useReports.ts, src/lib/ai-request-bridge.ts, src/cards/drop-specs/index.ts, src/components/drop-mode/card-drop-gesture.ts, src/components/icons/DropChevrons.tsx, src/hooks/useReconcileModeAAnchors.ts, src/links/resolve-card-anchor.ts -->

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

## The `CardKind` vocabulary — 15 kinds

`CardKind` (SSOT: [src/cards/types.ts](../../src/cards/types.ts), the type
layer beside the registry) is the canonical card vocabulary — **15 kinds** as
shipped:

`note` · `highlight` · `footnote` · `citation` · `example` · `todo` ·
`archive` · `report` · `report-request` · `revision-comment` ·
`revision-suggestion` · `cutter-comment` · `cutter-suggestion` · `bib` ·
`error`.

(The card-system refactor removed `quotation`, added `report` +
`report-request`, renamed the bare `comment` spine kind to `revision-comment`,
and dropped bare `suggestion` from the spine — `comment`/`suggestion` survive
only as the on-disk data discriminators, [below](#two-taxonomies-registry-cardkind-vs-the-persisted-discriminator).
The legacy **`ai`** CardKind was **retired** (#55b): there is no `AiRequestCard`
anymore — an unlinked note/todo AI-request becomes a *real* note/todo card
carrying a per-card `aiRequest` flag, while footnote/citation AI-requests stay
in the AIWindow. The Task itself persists in `ai-requests.json` as an
`AiRequest`, not as a card kind — [below](#the-task-ai-requestsjson).)

Every per-kind fact hangs off **one registry**: `CARD_REGISTRY`
([src/cards/card-registry.tsx](../../src/cards/card-registry.tsx)), a
`Record<CardKind, CardMeta>` — one entry per kind carrying `panel` /
`origin` / `keyPrefix` / `label` / `titleLabel` / `themeKey` / `collabClaims` /
`anchored` / `markerType` / `lifecycle` / `content` / `dropSpec` / `droppable` /
`dropPlacement` / `morph` / `stackable` / `poppable` / `bodyClass`. The
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
A Mode-A anchor now also carries an optional self-healing
`anchor.paragraphSnapshot` (plain-text capture of the anchored paragraph,
written at create + drop re-anchor) — the reload reconciler
([useReconcileModeAAnchors.ts](../../src/hooks/useReconcileModeAAnchors.ts),
SSOT [resolveCardAnchor](../../src/links/resolve-card-anchor.ts)) re-finds the
paragraph UUID-first, snapshot-fallback when the `%!v:` UUID got re-minted on
load. ADDITIVE/optional; mechanism in [anchoring.md](anchoring.md).

| `CardKind` | Host panel | Sidecar · key | On-disk `kind` | Linkage | Lifecycle |
|---|---|---|---|---|---|
| `note` | Notes (poly) | `notes.json` · `cards` | `"note"` | anchor (A or B) | `aiRequest` → Task `note` |
| `highlight` | Notes (poly) | `notes.json` · `cards` | `"highlight"` | anchor (B only — exactly one range) | `aiRequest` → Task `highlight` |
| `footnote` | Footnotes | `footnotes.json` · `footnotes` | — | **atom-link** to `\footnote{}`/`\thanks{}` (`id` = `\vfid`); unanchored OK | `aiRequest` → Task `footnote` (#55a) |
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
| `error` | Errors | *(not persisted)* | — | maps to a `.tex` line / paragraph | ephemeral — re-derived each lint pass |

The **Task** (`ai-requests.json` · `requests`) is **not a CardKind** — it persists
as an `AiRequest` (carries `kind: AiRequestKind`), surfaces in every panel's Inbox,
and has flexible linkage (anchor and/or atom-links, or neither). See
[the Task](#the-task-ai-requestsjson).

## The declarative content model — `CardMeta.content`

`CardMeta.content: CardContentModel | null` ([types.ts](../../src/cards/types.ts))
is the **single declarative descriptor** for "does this card hold user content?"
— it replaced a divergent per-kind `switch`. A `CardContentModel` names three
field lists on the kind's record: `bodyField` (a rich Tiptap JSONContent body
walked for visible text, or `null`), `textFields` (plain-string/array mirrors
that ALSO count — e.g. `title` on note/report/footnote, `text` on todo/report,
`keys` on citation), and `aiPrefilledFields` (the suggestion family's AI-filled
`original_text`/`suggested_text` — named for the coverage assertion but NEVER
counted as user content). `null` for the no-user-content kinds (`highlight` /
`bib` / `error`) — a `null` descriptor always reports "no content."

One walker reads it: `cardHasContent(kind, card)`
([src/cards/has-content.ts](../../src/cards/has-content.ts)), consumed by BOTH
the panel-trash confirm (`EditableCard.tryDelete`,
[panel-primitives.tsx](../../src/components/panel-primitives.tsx)) and the
gutter-marker delete (`deleteMarginItem`) — so no kind can silently delete
content the confirm couldn't see. Every declared field is pinned to the record
shape by `assertContentCoverage` (card-registry.tsx).

## Per-card archive — the set-aside affordance

Every **user-authored** card carries an optional `archived?: boolean`
([src/lib/types.ts](../../src/lib/types.ts), on each card record). Archived cards
hide from a panel's active view, the OmniView, and the gutter — set aside
reversibly rather than deleted. This is **wholly distinct** from the text-object
Archive PANEL (the `archive` CardKind, which *moves text objects*).

- **`isArchivable(kind)`** ([predicates.ts](../../src/cards/predicates.ts)) —
  derived from provenance: `origin === "user"`, MINUS two exceptions.
  `highlight` is delete-only (a bodyless range tint; archiving would orphan the
  tint) and `footnote` is delete-only (pending a footnote-lifecycle follow-up —
  the subsystem doesn't model "unanchored" the way citations do; **user
  decision**). So the archivable set is note/citation/archive/todo/report/
  report-request + the comment/suggestion pairs.
- **`archiveRemovesAtom(kind)`** (= `isInlineAtomCardKind`) — for the atom kinds,
  archiving splices the `\footnote{}`/`\cite{}` marker out of the `.tex` (behind
  a confirm) and does NOT re-insert it on unarchive (returns as an unanchored
  ref). With `footnote` now delete-only, this is reachable only for `citation`.
- **The button** — `CardArchiveButton` / `MenuArchive`
  ([panel-primitives.tsx](../../src/components/panel-primitives.tsx)) mounts
  beside the trash, self-wired from the **`CardArchiveActionsProvider`**
  ([card-archive-actions.tsx](../../src/panels/_shared/card-archive-actions.tsx),
  identity-stable so a body keystroke never re-renders every card).
- **The View menu** — a three-dot "View Active / View Archives / View All"
  selector (`CardViewModeMenuItems`,
  [CardViewModeMenu.tsx](../../src/panels/_shared/CardViewModeMenu.tsx)) over a
  shared `CardArchiveView` mode
  ([card-archive-view.tsx](../../src/panels/_shared/card-archive-view.tsx)); the
  list applies `filterByArchiveView(items, view, getArchived)`.

## Card-lifecycle reconciler — selection survives delete/morph

A card's delete / morph incurs a cross-store obligation: the per-doc `cardStore`
selection/hover/expansion slots, keyed `{kind, id}`, must be PRUNED (delete) or
RE-KEYED `{fromKind→toKind, id}` (morph). The sidecar-backed kinds (report /
note / cutter / revision) have no doc-node the `DocStructureBus` reports, so the
single delete/morph executor `runCardLifecycleEvent`
([src/cards/lifecycle/run-event.ts](../../src/cards/lifecycle/run-event.ts))
PUBLISHES a `card-deleted` / `card-morphed` signal
([card-lifecycle-signal.ts](../../src/cards/lifecycle/card-lifecycle-signal.ts)),
and `useCardLifecycleReconciler(store)`
([useCardLifecycleReconciler.ts](../../src/cards/lifecycle/useCardLifecycleReconciler.ts),
mounted once per pane, threaded **this doc's** store from `getCardStore(docId)`
— the singleton was scoped per-doc behind a `CardStoreContext` seam so a
delete/morph in doc B never touches doc A's selection under multi-doc
keep-alive) prunes/re-keys that store. This is an explicit
user-action channel — NOT a `DocStructureBus` subscription, so it doesn't touch
keystroke sanctity or the +1-not-+3 invariant.

## Drop facets — the (re)anchor button

Two `CardMeta` facets drive the **card drop button** — the neutral chevron glyph
([DropChevrons.tsx](../../src/components/icons/DropChevrons.tsx)) that enters
drop-mode to (re)anchor a card. It mounts on the docked card header
(`CardDropButton`, [panel-primitives.tsx](../../src/components/panel-primitives.tsx))
and on a popped-out card float's chrome (FloatChrome), through the shared gesture
[card-drop-gesture.ts](../../src/components/drop-mode/card-drop-gesture.ts). It
replaced the retired Shift-grab drop-mode entry and the removed panel→gutter
native drag (`event-bridges/panel-drops.ts` + `anchor-rebind.ts`, both DELETED).

- **`droppable: boolean`** — does the kind get the button. Read via
  `isDroppable(k)` ([predicates.ts](../../src/cards/predicates.ts)). True for
  every anchored/atom kind; **false** for `bib` / `error` (no anchor)
  and `example` (its `dropSpec` is a `between-blocks` block content-MOVE, not a
  card re-anchor).
- **`dropPlacement: "in-text" | "margin" | null`** — where a (re)anchor drop
  LANDS. `"in-text"` for the atom kinds (`footnote` / `citation` — inline caret /
  `\cite`-`\footnote` position); `"margin"` for the paragraph-anchored kinds;
  `null` ⇔ `!droppable`. Read via `cardDropPlacement(k)`.

These are **STATIC literals**, not derived from `dropSpec != null`: specs are
folded onto the registry at boot by the `@/cards/drop-specs`
([drop-specs/index.ts](../../src/cards/drop-specs/index.ts)) side-effect import,
which may not have run when a header first paints. A dev assertion
(`assertDropFacetCoverage`, card-registry.tsx, run from the drop-specs boot
module) + `drop-facet-contract.test.ts` pin the declared facets to the real
`dropSpec.allowedPlacements`. Dropping an *unanchored* footnote/citation
**creates the atom** in place (a `createAtom` branch on the move spec).

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

Each pair is a reciprocal **morph pair** (`CardMeta.morph: { to, lossy, drops }`):
the card converts *in place* into its panel sibling — preserving id / createdAt /
anchor, flipping the on-disk data discriminator — via the kind control on the
card header (and the popped float's title control), backed by a transform
registered through `registerCardMorph`
([card-registry.tsx](../../src/cards/card-registry.tsx)). `drops` enumerates the
`MorphDropField`s the TO shape can't hold (`title` / `byline` / `aiRequest` /
`body` / `keys`) — it drives the generated confirm copy AND the unbridge:
`drops.includes("aiRequest")` is the declarative trigger to clear the orphaned
`ai-requests.json` entry (the report→report-request flip). `lossy` is pinned to
`drops.length > 0` by `assertMorphCoverage`.

## The ghost kinds: `ai` and `suggestion` (neither is a `CardKind`)

Two names look like card kinds but aren't. The Task lives in `ai-requests.json`
([the Task](#the-task-ai-requestsjson)), not the registry — there is no panel-less
`ai` `CardMeta`. Both are cross-cutting by design (a Task surfaces in *every*
panel's Inbox, with no parent panel of its own):

- **`ai`** is **retired as a `CardKind`** (#55b). It survives only as the second
  taxonomic axis — the `AiRequestKind` *Task kind* values — and as the
  `ai-requests.json` store. An unlinked note/todo AI-request is now a real
  note/todo card with an `aiRequest` flag, not an `AiRequestCard`.
- A bare **`suggestion`** is **not a `CardKind` at all** — it survives only as
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

Both kinds re-anchor through the drop button → the single `ctx.reports` drop API
([Reports/drop-spec.ts](../../src/panels/Reports/drop-spec.ts)) and collapse to
one "Reports" OmniView filter. (The legacy panel→gutter native `MIME_REPORT`
drag was retired with the drop-button rework — see [drop facets](#drop-facets--the-reanchor-button).)
There is **no `quotations.json` → `reports.json` data migration**
— the refactor was a replacement, so a pre-refactor paper's `quotations.json` is
simply not read.

## The Task (`ai-requests.json`)

A **Task** is the unit of work the user files and the Inbox surfaces
([VIRGIL.md → Tasks as a Card kind](../architecture/VIRGIL.md#tasks-as-a-card-kind)).
It is **no longer a `CardKind`** (the `ai` kind was retired, #55b) — it lives
purely as an `AiRequest` in `ai-requests.json` · `requests` (schema in
[sidecars.md → `ai-requests.json`](sidecars.md#the-task-store-ai-requestsjson)),
with the result landing as a *real* card of the appropriate kind. What makes it
special:

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
  them; this doc only records that the Task *is* where they live.
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
