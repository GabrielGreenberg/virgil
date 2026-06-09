# A2-audit — Anchoring & link model

> Read-only audit + design for the **A2** arena of the card-system refactor.
> Scope is **strictly the card anchoring + link model**: Mode A (paragraph/`textObjectIds`)
> vs Mode B (text-range / `linkedRange`); the `linkedAnchor` mark; the three-surface
> (text · margin · card) hover/select bridge; orphan handling; re-anchor-by-drag; and the
> `EntityKind`-vs-registry-`anchored` redundancy question. It **consumes** the landed A0
> (`CARD_REGISTRY` + predicates) and AF (`float:<domain>:<kind>:<id>` key grammar) foundations
> and proposes how the anchor layer adopts them. It touches the **text-object side only at the
> `Floatable` window layer** — never merges the two kinds.
>
> Verified against `HEAD = 588ae7e` on 2026-06-09. All `file:line` re-pinned against the current
> tree (the A0/AF audits were pinned at `d1b3ee3`/`486a462`; many of their refs drifted — see
> **Stale-ref corrections**). Best-effort exact; the impl chip should re-verify any it relies on.

---

## 0. TL;DR

- **A0 built `isAnchoredCardKind` / the registry `anchored` flag, but A2's surface never adopted it.**
  `isAnchoredCardKind` has **zero consumers** (`grep` confirms). Every anchoring consumer — the two
  hover bridges, the highlight reconciler, `marginalia.ts`, `marker-clicks.ts` — still imports
  `ANCHORED_CARD_KINDS` / `EntityKind` from `src/links/_shared/entity-hover.ts:22,38`. **This is the
  central A2 deliverable: retire the hand-kept `ANCHORED_CARD_KINDS` array and the `EntityKind` union,
  derive both from the registry.**
- **`EntityKind` is NOT fully redundant with `anchored` — but the residual info is itself
  registry-derivable.** `ANCHORED_CARD_KINDS` (13 kinds) is **byte-identical** to
  `{k | CARD_REGISTRY[k].anchored}` (verified: both = note, highlight, footnote, citation, archive,
  todo, report, report-request, example, revision-comment, revision-suggestion, cutter-comment,
  cutter-suggestion). So the *membership* is redundant. The one thing `EntityKind` carries that the
  boolean doesn't: **footnote/citation are anchored-for-hover but have no panel-card *entity*** —
  `findEntity` returns `undefined` for them (`entity-hover.ts:97-99`) and `isInlineAtomKind` treats
  them as always-present (`useAnchorHighlightReconciler.ts:97`). That distinction is **already a
  registry fact** (`markerType: null` + atom-backed; or a derivable `isInlineAtomKind` predicate).
  **Ruling: retire `EntityKind` as a hand-kept union; replace with `CardKind` narrowed by
  `isAnchoredCardKind`, and add one derived `isInlineAtomCardKind` predicate** for the atom carve-out.
  See §2 + Open Question (A).
- **Four parallel kind→token tables still live in the anchor layer** — each re-encodes a slice of the
  taxonomy by hand, and each is a place the comment/suggestion + cut drift resurfaces:
  `ANCHORED_CARD_KINDS`/`EntityKind` (entity-hover), `ANCHOR_CLICK_ROUTES` (marker-clicks),
  `entityKindToAnchorKind` + `legacyKindToCardKindString` (the marker-theme + mark-`kind`-attr maps),
  and `paragraphKindFor` (the CSS-token map). Two of these (`entity-hover` membership,
  `marker-clicks` routing) are straightforwardly registry-derivable; two (`legacyKindToCardKindString`,
  `paragraphKindFor`) are coupled to the **persisted on-disk `comment`/`suggestion` discriminator and
  the `data-link-card` CSS grammar** — they stay, but should read from a single declared map, not
  re-switch per consumer.
- **The anchor-resolution path is already well-unified** — `links.ts` has one `resolveLink` (Mode B
  prefers the mark, falls back to Mode A by uuid), one `getTextAnchor` / `getLinkedTextObjectIds`
  accessor pair, one `migrateCardLinks` legacy→canonical transform, one re-anchor factory
  (`textObjectSideReanchorSpec`). This is the *good* shape; A2 should not rebuild it. The work is
  **consumer-side**: make the kind-membership and kind→token edges registry-derived so they stop
  drifting.
- **Three key grammars coexist and are all coherent post-AF — keep them distinct (do NOT unify).**
  (1) `float:card:<kind>:<id>` = popout / `data-card-key` (AF SSOT, via `cardPopKey`→`buildFloatKey`);
  (2) `linkCardKey` = flat `<cardKind>:<id>` = `data-link-card` on the in-text atom/mark
  (`link-registry.ts:120-127`, **intentionally NOT migrated** to `float:`); (3) the raw DOM-id
  selectors `[data-link-id]` / `[data-uuid]` for the live anchor position. AF-fix correctly routed
  `cardKeyForEntity` through `buildFloatKey` (`entity-hover.ts:113`) and `usePanelCardHoverBridge`
  through `parseAnyKey` (`usePanelCardHoverBridge.ts:47`); the round-trip is verified by
  `entity-key-contract.test.ts` (5 passing). **No remaining hand-built legacy keys in `src/links/`**
  except the documented `linkCardKey` flat carve-out. The anchor→key→DOM round-trip is coherent.

---

## 1. Current reality (code-derived, EXACT `file:line`)

### 1.1 The two anchor modes — representation, creation, persistence, resolution

**The mode is DERIVED, not declared.** A `Link` whose `anchor.type === "textObject"` is Mode B iff
`anchor.targetKind === "linkedRange"`; every other `targetKind` (paragraph, heading, listItem,
exampleItem, atom blocks) is Mode A (`_shared/types.ts:13-19, 100-102`; `isModeB` at `:100`).

| | **Mode A** (persistent-node anchor) | **Mode B** (text-range anchor) |
|---|---|---|
| **Shape** | `anchor.textObjectIds: string[]` (uuid(s)); `targetKind ≠ "linkedRange"` | `targetKind: "linkedRange"` + `anchor.textRange: { anchorId, textSnapshot }`; **also** carries `textObjectIds` (the containing paragraph uuid) — `_shared/types.ts:54-69` |
| **Backed by** | the block node's `uuid` attr in the PM doc | a `linkedAnchor` **mark** over the range (`src/lib/tiptap/linked-anchor.ts:16`) |
| **In `.tex`** | nothing (uuid is doc state; round-trips via source markers) | nothing — the mark is **app state, stripped on export, re-applied on load** (`linked-anchor.ts:11-13`) |
| **Created by** | `createAnchorLink` with explicit `textObjectIds` (`links.ts:349`) | `createAnchorLink` with `args.textRange` → `setMark("linkedAnchor", …)` (`links.ts:325-345`); or `createLinkedAnchor` (`links.ts:758`) |
| **Resolved by** | `resolveLink` Mode-A branch: `findParagraphByUuid` per uuid, first survivor wins (`links.ts:463-483`) | `resolveLink` Mode-B branch: `resolveTextRangeByAnchorId` (`links.ts:451-461`); **falls through to Mode A if the mark is lost** (`:463`) |
| **Accessor** | `getLinkedTextObjectIds(card)` (`links.ts:975`) | `getTextAnchor(card)` → `{ anchorId, anchorText }` (`links.ts:989`) |

**Persistence:** cards store `links: Link[]` in their sidecar JSON. Legacy pre-D8 cards carry
`paragraphIds`/`anchorId`/`anchorText` flat fields; `migrateCardLinks` (`migrate-card.ts:30`) +
`migrateLink` (`:60`) do a one-shot read-time transform to the canonical `Link` shape
(`type:"anchor"` + `paragraphIds` → `type:"textObject"` + `targetKind` + `textObjectIds`;
`targetKind` inferred: `textRange` present → `linkedRange`, else → `paragraph`, `:78-94`). The
mutator API (`addTextObjectLink`/`removeTextObjectLink`/`setParagraphLinks`/`setTextAnchorLink`/
`clearTextAnchorLink`, `links.ts:1122-1245`) is the single write path over `card.links`, replacing
every direct `card.paragraphIds` access (`:964-970` comment).

### 1.2 The `linkedAnchor` mark (Mode B backing) — `src/lib/tiptap/linked-anchor.ts`

- **The mark** (`:16-69`): `inclusive:false` (typing at edges doesn't extend); attrs `anchorId`,
  `kind` (legacy per-kind colour token, default `"note"`), `linkId`, `linkKind:"anchor"`, `linkCard`
  (= `linkCardKey` value), `tintColor` (Adobe-style persistent highlight). Render policy lives in the
  pure `linkedAnchorRenderAttrs` (`linked-anchor-attrs.ts`); the `"transient"` sentinel `kind` marks
  the cardless selection-grab handle and omits `data-link-card` (`:27-30, 57-68`).
- **Three orphan guards, all `appendTransaction` + `readPendingDiff` (keystroke-sane, §Keystroke):**
  - `LinkedAnchorGuard` (`:78`) — Mode B: on `diff.removedAnchors`, fires `virgil-anchor-orphaned`
    `{ anchorId, kind }` in `setTimeout(0)` (`:92-100`); also strips `linkedAnchor` from pasted slices
    to avoid id collisions (`:104-118`).
  - `TextObjectOrphanGuard` (`:153`) — Mode A: on `diff.removedBlocks`, fires
    `virgil-textobject-orphaned` `{ uuid, typeName }` (`:164-172`); each Mode-A hook
    (`useTodos`/`useReports`/`useExamples`/`useArchive`) sweeps its own `links[]`.
  - `MarginaliaAnchorGuard` (`:196`) — the safety net: when an anchored uuid-bearing block vanishes
    (tracked via `anchoredUuidsRef`) OR any `linkedAnchor` was removed, **re-inserts an empty
    paragraph carrying the same uuid** at the deletion site (`:240-285`) so the card's anchor stays
    valid. The "remove a card → explicit gutter delete" contract (`:190-193`).

### 1.3 The three-surface hover/select bridge

Three DOM surfaces (in-text mark/atom · margin gutter icon · panel card) resolve to one entity
`{ id, kind: EntityKind }` held in a module-scope store. The bridges:

| Surface | Bridge file:line | Reads | Emits |
|---|---|---|---|
| **panel card → entity** | `usePanelCardHoverBridge.ts:24` | `[data-card-key]` (= `float:card:<kind>:<id>`) via `parseAnyKey` (`:47`); gated on `parsed.domain === "card"` + `ANCHORED_KINDS.has(parsed.kind)` (`:49-50`) | `setHoveredEntity(id, kind)` |
| **in-text → entity** | `useTextHoverBridge.ts:46` | `.linked-anchor[data-link-id]` via an `anchorId → {entityId,kind}` map built from `getTextAnchor` over notes/cutter/comments/reports (`:57-82`); plus `data-citation-id`/`data-footnote-id`/`data-link-card` atoms (`:112-141`) | `setHoveredEntity` + dispatches `virgil-linked-anchor-click` (`:183`) |
| **store (all three)** | `anchored-card-store.ts:82` (`cardStore`) | module-scope `useSyncExternalStore` state: `stickySet[]` + `transient` + `hover` of `AnchoredCardRef { kind: EntityKind, id }` (`:36-39`) | repaints all three surfaces |
| **highlight reconciler** | `useAnchorHighlightReconciler.ts` | reconciles selection/hover → stamps `data-card-selected`/`data-card-hovered` on `[data-card-key="${cardKeyForEntity(ref)}"]` (`:284-291`) + on `.linked-anchor`/`data-paragraph-kind` spans | the paint |

`cardKeyForEntity(ref)` (`entity-hover.ts:109`) = `buildFloatKey({domain:"card", kind, id})` — the AF
SSOT. The reconciler queries `[data-card-key="<that>"]`, and the card stamps the same key via
`useAnchoredCard` → `cardPopKey` → `buildFloatKey` (`useAnchoredCard.ts:59`). **The round-trip is
byte-identical** (pinned by `entity-key-contract.test.ts`).

### 1.4 Orphan handling when an anchor's text-object is deleted

Covered by the three guards in §1.2. Net contract: a card never silently orphans through an editor
edit — `MarginaliaAnchorGuard` re-inserts the uuid-carrying placeholder for anchored blocks; the two
orphan-event guards notify hooks to clear stale `links[]` for the non-preserved cases. The Mode-A
sweep is event-driven from `diff.removedBlocks`; the per-hook handler is required to be `O(removed)`
via a pre-built inverted index (`linked-anchor.ts:140-142` doc).

### 1.5 Re-anchor-by-drag

One generic factory: `textObjectSideReanchorSpec` (`drop-mode/util/text-object-side-reanchor.ts:28`).
Every attachment kind's `drop-spec.ts` (Notes/Todo/Archive/Cutter/Revisions/Reports) calls it with a
`kindLabel` + a `getApi(ctx): ParagraphAnchorApi` getter. The spec: `allowedPlacements:
["paragraph-side"]`; `classifyDrop` → no-op/apply/confirm by comparing `api.getAnchorTextObjectIds(id)`
to the drop target (`:34-53`); `applyDrop` snapshots+strips any Mode-B anchor via
`api.preserveModeBAnchor` + `removeLinkedAnchor` (`:68-75`), then `removeTextObjectLink`/
`addTextObjectLink` to re-point Mode A (`:76-84`). `extractId(cardKey)` = `parseAnyKey(cardKey)?.id`
(`:90-94`) — colon-safe, dual-grammar. Registered onto `CARD_REGISTRY[kind].dropSpec` by
`src/cards/drop-specs/index.ts` (the two revision kinds share `revisionDropSpec`, `:39-40`).

### 1.6 The key grammars (post-AF, all coherent)

| Grammar | Builder / parser | Carried on | Migrated to `float:`? |
|---|---|---|---|
| `float:card:<kind>:<id>` | `cardPopKey`→`buildFloatKey` (`float-key.ts:37`); `parseAnyKey` (`:80`) | `data-card-key` (panel cards, omni entries) | **yes** (the AF SSOT) |
| `<cardKind>:<id>` (flat) | `linkCardKey` (`link-registry.ts:125`); `parseLinkCardKey` (`:130`) | `data-link-card` (in-text atoms + Mode B marks) | **NO — intentional carve-out** (`link-registry.ts:120-124` doc) |
| `[data-link-id]` / `[data-uuid]` | raw selectors in `resolveLink` (`links.ts:457,473`) | the live in-doc anchor element | n/a (DOM ids, not popout keys) |

---

## 2. Finding F1 — `isAnchoredCardKind` built but unadopted; `ANCHORED_CARD_KINDS`/`EntityKind` still hand-kept *(HEADLINE)*

**WHAT.** A0 shipped `isAnchoredCardKind(k) = CARD_REGISTRY[k].anchored` (`predicates.ts:25`) explicitly
to replace `ANCHORED_CARD_KINDS` / `EntityKind` / `MarginaliaMarker.entityKind` (`predicates.ts:23`
comment; `cards/types.ts:88-90` comment). **But it has zero consumers** — every anchoring site still
imports the hand-kept array/union from `entity-hover.ts`.

**WHERE.**
- Definition (unadopted): `src/cards/predicates.ts:25` (`isAnchoredCardKind`).
- Still-canonical hand-kept source: `src/links/_shared/entity-hover.ts:22-38` (`ANCHORED_CARD_KINDS`
  array + `EntityKind = (typeof ANCHORED_CARD_KINDS)[number]`).
- 14 files import `EntityKind`; direct `ANCHORED_CARD_KINDS` array consumers:
  `usePanelCardHoverBridge.ts:16,22`; (and `marginalia.ts:112` consumes `EntityKind` for
  `MarginaliaMarker.entityKind`, `:111-112`).

**WHY it's wrong.** The whole point of A0 was "one place a card kind is *defined*." The anchored
membership is now declared **twice**: once as `anchored: true` across 13 `CARD_REGISTRY` entries
(`card-registry.tsx`), once as the literal 13-element `ANCHORED_CARD_KINDS` array. They are currently
in sync (verified byte-identical) but nothing enforces it — adding the 14th anchored kind means editing
both, and the array is string-typed so tsc won't catch a miss. This is exactly the parallel-enum drift
class A0 set out to kill, surviving in the one arena (A2) whose job is to consume the predicate.

**Is `EntityKind` redundant with `anchored`? (the §A2 open question — DECIDED.)**
- **Membership: fully redundant.** `{k | CARD_REGISTRY[k].anchored}` === `ANCHORED_CARD_KINDS`,
  verified.
- **The one residual distinction `EntityKind` *use* encodes:** footnote/citation are in
  `ANCHORED_CARD_KINDS` (hover-eligible, since their atoms participate in three-surface hover) but have
  **no panel-card entity** — `findEntity` returns `undefined` for them (`entity-hover.ts:97-99`) and
  the reconciler short-circuits them as always-present via `isInlineAtomKind` (atom existence is the
  editor's job, `useAnchorHighlightReconciler.ts:94-99`). That "anchored-but-atom-backed-not-card"
  bit is **already a registry fact** — these two are exactly the anchored kinds with `markerType: null`
  *and* an inline atom (`origin:"user"`, atom-node link kind). It is cleanly derivable, not extra
  information the boolean can't reach.
- **Ruling:** retire the hand-kept `EntityKind` union and `ANCHORED_CARD_KINDS` array. Replace with a
  type alias derived from the registry and one new predicate:
  ```ts
  // src/cards/predicates.ts
  export const isInlineAtomCardKind = (k: CardKind): boolean =>
    CARD_REGISTRY[k].markerType === null && (k === "footnote" || k === "citation");
  // entity-hover.ts:
  export type EntityKind = CardKind & { __anchored: true }; // or: keep `EntityKind = CardKind`
  export const ANCHORED_CARD_KINDS = CARD_KINDS.filter(isAnchoredCardKind);
  ```
  `EntityKind` can simply *become* `CardKind` (anchored membership is enforced at the use site by
  `isAnchoredCardKind`), eliminating a union that must be maintained. Where a narrowed type genuinely
  helps (e.g. `AnchoredCardRef.kind`), use a branded subset derived from the predicate, not a literal
  list. See Open Question (A) for the `EntityKind = CardKind` vs branded-subset tradeoff.

**DEEPEST FIX.** `entity-hover.ts` becomes a **pure consumer** of `src/cards/predicates.ts`:
`ANCHORED_CARD_KINDS = CARD_KINDS.filter(isAnchoredCardKind)`; `EntityKind` derived; `findEntity`'s
footnote/citation `undefined`-return stays (it's the atom carve-out, now reflected by
`isInlineAtomCardKind`). Every importer (`usePanelCardHoverBridge`, `marginalia`,
`anchored-card-store`, the reconciler) keeps importing the *name* but it's now registry-backed. Add a
dev assertion (mirroring A0's lifecycle assertion) that the derived set equals the registry's
`anchored:true` set, so the seam can't silently drift.

---

## 3. Finding F2 — `findEntity` is a hand-written per-kind switch that re-derives panel membership + the comment/suggestion split

**WHAT.** `findEntity(ref, collections)` (`entity-hover.ts:63-101`) is a 9-arm switch that (a) routes
each `EntityKind` to its collection (`notes`/`cutterCards`/`comments`/`todos`/`archiveSnippets`/
`reports`/`examples`), and (b) re-implements the comment/suggestion + report/report-request split by
reading `card.kind !== "suggestion"` / `=== "report-request"` (`:72-96`). It's the runtime resolver
behind every three-surface lookup.

**WHERE.** `src/links/_shared/entity-hover.ts:63-101`. The `EntityCollections` interface (`:45-61`)
is a hand-listed bag of 7 collection slots.

**WHY it's wrong.** Two registry-derivable facts are re-encoded by hand:
1. **kind → collection** is the inverse of `panelForCardKind` — `note`→notes panel, `cutter-*`→cutter,
   etc. The switch is a fourth place (after `panel-registry`, the dispatch, the drop-specs) that learns
   the panel topology.
2. **the comment/suggestion + report split** is the *same* `record.kind` disambiguation A0 centralized
   conceptually as `resolveCardKind(key, ctx)` (A0 §5.4 / `predicates.ts:9-12` TODO) — but that helper
   was **never built** (`grep` finds no `resolveCardKind` in `src/cards/`). So the split lives here
   *and* in `useTextHoverBridge.ts:66,72,78` *and* in `paragraphKindFor`/`legacyKindToCardKindString`.

**DEEPEST FIX.** Build the deferred `resolveCardKind(record, ctx)` in `src/cards/predicates.ts` (A0
left it as the one residue, `predicates.ts:9-12`). `findEntity` keeps the collection-routing (it
genuinely needs the per-doc collection bag — that's `CardFloatCtx`-shaped, not static), but the
comment-vs-suggestion / report-vs-request branch reads the **one** `resolveCardKind` helper instead of
re-switching on `card.kind`. Better: thread the collection bag as `CardFloatCtx` (A0 already re-homed
`PoppedCardDeps` there) so `findEntity` and `toFloatable` resolve entities through one ctx shape, not
two parallel collection interfaces (`EntityCollections` vs `PoppedCardDeps`). That collapses the
`EntityCollections` hand-list onto the existing float ctx.

---

## 4. Finding F3 — four parallel kind→token tables in the anchor/highlight layer

**WHAT.** Beyond `findEntity`, four more hand-written kind→token switches each re-encode a slice of the
comment/suggestion/cut/report drift:

| Table | file:line | Maps | Drift token |
|---|---|---|---|
| `ANCHOR_CLICK_ROUTES` | `marker-clicks.ts:13-45` | EntityKind → `{panelId, cardKind, entrySelectorBase}` | duplicates panel topology |
| `entityKindToAnchorKind` | `entity-hover.ts:130-144` | EntityKind → marker-theme key (`note`/`highlight`/`revision`/`cutter-*`) | `revision` (collapses both revision kinds) |
| `legacyKindToCardKindString` | `links.ts:734-752` | `LinkedAnchorKind` → on-disk discriminator | `revision → "comment"` (the persisted token) |
| `paragraphKindFor` | `useAnchorHighlightReconciler.ts:63-76` | CardKind → CSS `data-paragraph-kind` token | `comment`, `cut` (CSS grammar) |

Plus the satellite `LinkedAnchorKind` union (`links.ts:718-726`, 7 members: note/highlight/revision/
cutter-comment/cutter-suggestion/report/report-request) and `MARKER_KIND_TO_THEME_KEY`
(`EditorLayout.tsx:80`).

**WHY it's wrong / nuanced.** These split into **two classes**:
- **Registry-derivable (retire the table):** `ANCHOR_CLICK_ROUTES`'s `panelId`/`cardKind` columns are
  `panelForCardKind(k)` + the kind itself; `entityKindToAnchorKind`'s output is exactly
  `CARD_REGISTRY[k].markerType` collapsed (note→note, revision-*→revision via `markerType:"revision"`,
  cutter-*→cut... — **wait, it returns `cutter-comment`/`cutter-suggestion` split, not `cut`**, because
  the *anchor tint* keeps the cutter split while the *marker* collapses to `cut`; that asymmetry is
  real and must be preserved, see Open Question (B)).
- **Persistence/CSS-coupled (keep, but single-source):** `legacyKindToCardKindString` emits the
  **on-disk `comment`/`suggestion` discriminator** (untouched on disk + in the Python skill layer per
  `cards/types.ts:24-26`); `paragraphKindFor` emits the **`data-link-card^="<kind>:"` CSS token** which
  aligns with the same legacy discriminator (`useAnchorHighlightReconciler.ts:59-62` doc). These can't
  become the spine kind without a disk migration + a CSS rewrite — out of A2 scope. But they should
  read from **one declared `spineKind ↔ legacyDataKind ↔ cssToken` map** (a small registry-adjacent
  table), not four independent switches.

**DEEPEST FIX.** (1) Derive `ANCHOR_CLICK_ROUTES` and `entityKindToAnchorKind` from the registry
(`panelForCardKind` + `markerType` + the cutter anchor-tint carve-out). (2) Collapse
`legacyKindToCardKindString` + `paragraphKindFor` + the `data-link-card` CSS coupling into one declared
crosswalk table (e.g. `CARD_REGISTRY[k].legacyDataKind` / a sibling `LEGACY_DATA_KIND` map in
`src/cards/`), single-sourced so the on-disk/CSS tokens are declared once. This is the same
"declare-once, derive-everywhere" move A0 made for labels/prefixes/themes — extended to the
anchor-layer's legacy-token edge.

---

## 5. Finding F4 — `EntityCollections` vs `PoppedCardDeps`/`CardFloatCtx` are two parallel per-doc bags

**WHAT.** The anchor layer's `findEntity` takes `EntityCollections` (`entity-hover.ts:45-61`) — a
7-slot hand-listed collection bag (notes, highlights?, cutterCards, comments, todos, archiveSnippets,
reports?, examples). The float layer's `toFloatable` takes `CardFloatCtx` (= old `PoppedCardDeps`,
re-homed to `src/cards/card-float-ctx.ts` per A0). Both are "the per-doc card collections by kind,"
listed independently.

**WHERE.** `src/links/_shared/entity-hover.ts:45-61` (`EntityCollections`); `src/cards/card-float-ctx.ts`
(`CardFloatCtx`); the `floating-cards.tsx` module is now reduced to the `PoppedCardDeps` shape comment
(`:175-179`).

**WHY it's wrong.** Two interfaces describe the same per-doc data ("resolve a card by `(kind, id)`").
`findEntity` and `toFloatable` are both "resolve one entity by id from a ctx bag" — A0's `toFloatable`
even says so (`cards/types.ts:104-108`). Keeping two bags means a new card kind is threaded into both.

**DEEPEST FIX.** Unify on `CardFloatCtx` (or a shared `CardCollections` sub-shape it embeds).
`findEntity` becomes `findEntity(ref, ctx: CardFloatCtx)`; `EntityCollections` retires. This also lets
`resolveCardKind(record, ctx)` (F2) and `findEntity` share the one bag, closing the F2/F3
record-`.kind` duplication at the source. Optional/legacy-caller compatibility (the Reader paths that
pass partial bags, `:48-51,56-59` comments) is preserved by making the embedded collections optional,
exactly as `EntityCollections` already does.

---

## 6. Finding F5 — the `linkedAnchor` mark's `kind` attr is a fifth, soon-dead token namespace

**WHAT.** The mark carries a `kind` attr (`linked-anchor.ts:30`, default `"note"`) whose value comes
from `cardKindToLegacyAnchorKind(cardKind)` (`links.ts:372-387`, e.g. `revision-comment → "revision"`)
or `legacyKindToCardKindString` for the `linkCard` half. It's described as "Legacy ... Kept until the
mark's `kind` attr is dropped in Phase 3 cleanup" (`links.ts:370-371`) and "Phase 3 cleanup" of the
attr (`linked-anchor.ts:25-30`).

**WHY it's wrong.** It's a sixth token namespace (after spine kind, key prefix, theme, marker, on-disk
discriminator, CSS token) that exists only for a legacy colour fallback the render policy
(`linkedAnchorRenderAttrs`) mostly supersedes. It's a declared-dead surface.

**DEEPEST FIX.** This is **A1-gardening-adjacent** (dead-token removal), but A2 owns the anchor model:
flag it for the impl to drop the mark's `kind` attr once `linkedAnchorRenderAttrs` no longer needs it
(verify the `"transient"` sentinel is preserved — that one is load-bearing, `linked-anchor.ts:27-30`).
Coordinate with A6 (marginalia colour) + A1 (gardening). Low-priority; not a correctness bug.

---

## Target design

The anchor layer becomes a **pure consumer of `CARD_REGISTRY` + predicates**, with one resolution path,
one entity-ctx bag, and a single declared legacy-token crosswalk. Nothing in the resolution mechanics
(`resolveLink`, the mark, the guards, the re-anchor factory) is rebuilt — they are already unified and
keystroke-sane.

1. **`entity-hover.ts` → registry consumer.** `ANCHORED_CARD_KINDS = CARD_KINDS.filter(isAnchoredCardKind)`;
   `EntityKind` derived (or `= CardKind`); a dev assertion pins derived-set === registry-`anchored`.
   `isInlineAtomCardKind` added to `predicates.ts` for the footnote/citation carve-out.
2. **One `resolveCardKind(record, ctx)`** built in `src/cards/predicates.ts` (the deferred A0 helper).
   `findEntity`, `useTextHoverBridge`, and any `card.kind === "suggestion"` branch route through it —
   the comment/suggestion + report/report-request split lives in exactly one place.
3. **One entity ctx bag.** `findEntity(ref, ctx: CardFloatCtx)`; `EntityCollections` retires; the
   anchor layer and the float layer resolve entities through the same shape.
4. **`ANCHOR_CLICK_ROUTES` + `entityKindToAnchorKind` registry-derived** from `panelForCardKind` +
   `markerType` (+ the cutter anchor-tint carve-out, preserved explicitly).
5. **One declared legacy-token crosswalk** (`spineKind ↔ legacyDataKind ↔ cssToken`) single-sources
   `legacyKindToCardKindString` + `paragraphKindFor` + the `data-link-card` CSS coupling. On-disk and
   CSS tokens unchanged (no migration); only the *declaration* is centralized.
6. **Three key grammars stay distinct and documented** — `float:card:` (popout/`data-card-key`),
   flat `linkCardKey` (`data-link-card`), raw DOM ids. AF-fix already made the first coherent; A2 adds
   no new grammar and removes no carve-out.
7. **Mark `kind` attr** flagged for removal once render policy no longer needs it (coordinate A1/A6).

**How it consumes the foundations:** A0's predicates (`isAnchoredCardKind`, `panelForCardKind`,
`cardKindsForPanel`, the new `resolveCardKind`/`isInlineAtomCardKind`) replace every hand-kept anchor
table; A0's `CardFloatCtx` replaces `EntityCollections`; AF's `buildFloatKey`/`parseAnyKey` (already
adopted at `entity-hover.ts:113`, `usePanelCardHoverBridge.ts:47`) remain the `data-card-key` round-trip.

---

## Keystroke sanctity

**No per-keystroke risk introduced; one sanctioned subscriber lives in this arena.**

- **The three orphan guards** (`LinkedAnchorGuard`, `TextObjectOrphanGuard`, `MarginaliaAnchorGuard`,
  `linked-anchor.ts`) are **ProseMirror `appendTransaction`** plugins, not `editor.on('update')`
  subscribers. Each is `O(1)` bail on `!tr.docChanged` (`:86,161,213`) and consumes the **already-computed**
  `readPendingDiff(newState)` (`:90,162,217`) — they walk only `diff.removedAnchors` /
  `diff.removedBlocks` (O(edit-size)), never the doc. **This is the correct event-driven pattern** and
  must be preserved: the registry-derivation work in §2-§5 is all static-table consolidation and adds
  **zero** per-transaction cost.
- **`useTextHoverBridge`'s `anchorIdMap`** (`useTextHoverBridge.ts:57-82`) is a `useMemo` gated on the
  **entity collections** (`[notes, cutterCards, comments, reportCards]`) — those change on card-source
  re-derivation (already `useStructuralRevisions`-gated upstream per AGENTS.md), NOT on every keystroke.
  The DOM listeners read identity off attributes at event time, no doc walk.
- **The predicates** (`isAnchoredCardKind`, the future `resolveCardKind`) must stay O(1) static-map
  reads — `resolveCardKind(record, ctx)` does one `collection.find(x => x.id === id)`, never a
  per-transaction loop (mirrors the `toFloatable` purity rule, `cards/types.ts:104-108`).
- **`reanchorByText`** (`links.ts:885-938`) does a full `editor.state.doc.descendants` walk — but it
  fires **only on an explicit re-anchor action** (lost-mark recovery), never per keystroke. Acceptable;
  flag only if the impl ever moves it onto a transaction path.

**Verify (impl chip):** `window.__virgilBusStats().emitCount` flat while typing N plain chars with an
anchored card hovered/selected and a card float open; the three-surface paint must not re-derive on a
structurally-null keystroke.

---

## Fragmentation table

| Surface | File(s) (`file:line`) | Disposition |
|---|---|---|
| `ANCHORED_CARD_KINDS` array + `EntityKind` union | `src/links/_shared/entity-hover.ts:22-38` | **DERIVE** from `CARD_KINDS.filter(isAnchoredCardKind)`; `EntityKind` → `CardKind` (or branded subset); dev assertion pins equality |
| `isAnchoredCardKind` (built, unadopted) | `src/cards/predicates.ts:25` | **ADOPT** everywhere (currently 0 consumers) |
| `findEntity` 9-arm switch + comment/suggestion split | `src/links/_shared/entity-hover.ts:63-101` | **KEEP** collection routing; route the `.kind` split through one `resolveCardKind`; take `CardFloatCtx` not `EntityCollections` |
| `EntityCollections` interface | `src/links/_shared/entity-hover.ts:45-61` | **RETIRE** → `CardFloatCtx` (shared with `toFloatable`) |
| `resolveCardKind(record, ctx)` (deferred, never built) | `src/cards/predicates.ts:9-12` (TODO) | **BUILD** — the one comment/suggestion residue, single-sourced |
| `isInlineAtomCardKind` (the footnote/citation carve-out) | none yet | **ADD** to `predicates.ts`; replaces `isInlineAtomKind` (`useAnchorHighlightReconciler.ts:97`) |
| `ANCHOR_CLICK_ROUTES` | `src/components/editor-layout/event-bridges/marker-clicks.ts:13-45` | **DERIVE** `panelId`/`cardKind` from `panelForCardKind` + kind |
| `entityKindToAnchorKind` | `src/links/_shared/entity-hover.ts:130-144` | **DERIVE** from `markerType` (+ explicit cutter anchor-tint carve-out) |
| `legacyKindToCardKindString` + `LinkedAnchorKind` | `src/links/links.ts:718-726, 734-752` | **SINGLE-SOURCE** into one legacy-token crosswalk; on-disk token unchanged |
| `paragraphKindFor` (CSS token map) | `src/links/_shared/useAnchorHighlightReconciler.ts:63-76` | **SINGLE-SOURCE** into the same crosswalk; CSS grammar unchanged |
| `MarginaliaMarker.entityKind` | `src/lib/marginalia.ts:111-112` | already deduped to `EntityKind`; rides F1 (becomes registry-derived) |
| `cardKindToLegacyAnchorKind` (mark `kind` attr) | `src/links/links.ts:372-387` | **FLAG** mark `kind` attr for removal (A1/A6 coord); preserve `"transient"` sentinel |
| `linkedAnchor` mark + 3 orphan guards | `src/lib/tiptap/linked-anchor.ts:16,78,153,196` | **KEEP** — correct event-driven shape; do not touch |
| `resolveLink` / `getTextAnchor` / `getLinkedTextObjectIds` / mutator API | `src/links/links.ts:422,975,989,1122-1245` | **KEEP** — one canonical resolution path already |
| `textObjectSideReanchorSpec` re-anchor factory | `src/components/drop-mode/util/text-object-side-reanchor.ts:28` | **KEEP** — already generic + registry-registered |
| `migrateCardLinks` / `migrateLink` | `src/links/migrate-card.ts:30,60` | **KEEP** — one legacy→canonical transform |
| `linkCardKey` flat `<kind>:<id>` (`data-link-card`) | `src/links/link-registry.ts:120-127` | **KEEP** — intentional non-`float:` carve-out, documented |
| `cardKeyForEntity` → `buildFloatKey` | `src/links/_shared/entity-hover.ts:109-114` | **KEEP** — AF-fix already correct (round-trip tested) |
| `anchored-card-store` (sticky/transient/hover) | `src/links/_shared/anchored-card-store.ts` | **KEEP** mechanics; only `AnchoredCardRef.kind` type rides F1 (A4 owns the selection model) |

---

## Definition of Done for this arena

1. **`ANCHORED_CARD_KINDS` + `EntityKind` are registry-derived.** No hand-kept anchored-kind literal;
   `isAnchoredCardKind` is the single membership source; a dev assertion pins derived === registry.
2. **`isAnchoredCardKind` has real consumers** (was 0); the EntityKind-question is resolved by ruling.
3. **One `resolveCardKind(record, ctx)`** centralizes the comment/suggestion + report/report-request
   split; no consumer re-switches on `card.kind === "suggestion"`.
4. **One entity ctx bag** — `findEntity` takes `CardFloatCtx`; `EntityCollections` retired.
5. **`ANCHOR_CLICK_ROUTES` + `entityKindToAnchorKind` registry-derived** (panel + marker), cutter
   anchor-tint carve-out preserved explicitly.
6. **One legacy-token crosswalk** single-sources `legacyKindToCardKindString` + `paragraphKindFor` +
   the `data-link-card` CSS coupling; on-disk + CSS tokens **unchanged** (no migration, no data loss).
7. **Mode A/B resolution path untouched** — `resolveLink`, the mark, the three guards, the re-anchor
   factory, `migrateCardLinks` all keep their (already-unified, keystroke-sane) shape.
8. **Three key grammars stay distinct + documented**; the `data-card-key` round-trip stays byte-identical
   (the `entity-key-contract.test.ts` + `card-key-seams-contract.test.ts` stay green).
9. **Keystroke sanctity intact** — no new `editor.on('update')` subscriber; the orphan guards stay
   `appendTransaction` + `readPendingDiff`; `emitCount` flat on plain typing with an anchored card live.

---

## Open questions for the human

- **(A) `EntityKind` → `CardKind`, or a branded anchored-subset?** A2 ruling: retire the hand-kept
  union. The cleanest is `EntityKind = CardKind` (membership enforced at use sites by
  `isAnchoredCardKind`), which deletes a maintained union outright. Alternative: a branded
  `type AnchoredCardKind = CardKind & Brand<"anchored">` derived from the predicate, giving tsc-level
  narrowing on `AnchoredCardRef.kind` at the cost of a brand helper. A2 recommends `= CardKind` +
  runtime predicate guards (simplest; the few narrowing sites are cheap). Confirm.
- **(B) The cutter anchor-tint vs marker asymmetry — preserve or normalize?** `entityKindToAnchorKind`
  returns the **split** `cutter-comment`/`cutter-suggestion` for the *anchor tint* (`entity-hover.ts:140-141`)
  while the *marker* collapses both to `cut` (`markerType:"cut"`). Revisions share `revision` for both.
  This asymmetry is intentional today (each cutter suggestion-vs-comment pair can carry its own anchor
  tint, `:127-129` doc). Keep it (the registry-derivation carries an explicit carve-out), or normalize
  cutter to also share one anchor tint? A2 recommends **keep** (least churn, matches Decisions' cutter
  split). Confirm.
- **(C) On-disk `comment`/`suggestion` discriminator — confirm it stays.** `legacyKindToCardKindString`
  emits `"comment"` for revision-comment (`links.ts:748`), persisted on disk + read by the Python skill
  layer (`cards/types.ts:24-26`). A2 does **not** migrate it; the spine↔disk bridge stays. Confirm A2
  only centralizes the *declaration*, never rewrites disk — and that the Python skill layer's
  `comment`/`suggestion` contract is out of A2 scope.
- **(D) `resolveCardKind` ownership.** A0 deferred building it (`predicates.ts:9-12`) to "stage A0.7"
  citing it "needs `CardFloatCtx` + the three suggestion key forms." It was never built. Does A2 own
  building it (it's the anchor-layer's biggest consumer), or does it belong to a late-A0 follow-up that
  A2 then consumes? A2 recommends **A2 builds it** (A2 is where the `.kind` split proliferates). Confirm
  the seam with whoever finishes A0's `resolveCardKind`.
- **(E) Mark `kind` attr removal — A1, A6, or A2?** The `linkedAnchor.kind` legacy colour attr
  (`linked-anchor.ts:30`; `cardKindToLegacyAnchorKind`, `links.ts:372`) is declared dead ("Phase 3
  cleanup"). It's gardening (A1) + colour (A6) but lives in the anchor model (A2). Who lands the
  removal? A2 recommends A2 flags + A1 lands (with A6 verifying colour parity).

---

## Cross-arena seams

| Arena | Shared surface | Where (file:line) |
|---|---|---|
| **A0** (spine) | `isAnchoredCardKind`/`panelForCardKind`/`cardKindsForPanel` predicates A2 must adopt; the **deferred `resolveCardKind`** A2 builds; `CardFloatCtx`/`PoppedCardDeps` that replaces `EntityCollections`; the new `isInlineAtomCardKind` | `src/cards/predicates.ts:9-12,25,34,40`; `src/cards/card-float-ctx.ts`; `src/cards/card-registry.tsx` (`anchored`/`markerType`/`panel`) |
| **AF** (floats) | the `float:card:<kind>:<id>` grammar A2's `cardKeyForEntity`/`usePanelCardHoverBridge` round-trip; `buildFloatKey`/`parseAnyKey` | `src/floats/float-key.ts:37,80`; `src/links/_shared/entity-hover.ts:113`; `src/links/_shared/usePanelCardHoverBridge.ts:47` |
| **A3** (creation & lifecycle) | `createAnchorLink`/`createLinkedAnchor` (anchor creation is A2's model, invoked by A3's creation pipeline); the re-anchor `bindAnchor` lifecycle cap A2's drag uses; the Mode-B `preserveModeBAnchor` hook | `src/links/links.ts:318,758`; `src/components/drop-mode/util/text-object-side-reanchor.ts:68` |
| **A4** (selection/focus) | `anchored-card-store` (sticky/transient/hover) is A4's primary file but holds `AnchoredCardRef.kind: EntityKind` — rides A2's F1 type change; `useIsSelected`/`useIsExpanded` consume the entity ref | `src/links/_shared/anchored-card-store.ts:34,36-39`; `useAnchoredCard.ts:50` |
| **A5** (omni) | `usePanelCardHoverBridge` + `cardKeyForEntity` drive omni-entry hover/jump; the omni `categoryOf` path reads `parseAnyKey(data-card-key).kind` → `panelForCardKind` | `usePanelCardHoverBridge.ts:37-51`; `entity-key-contract.test.ts:76-82` |
| **A6** (marginalia) | `MarginaliaMarker.entityKind` rides F1; `markerType`/`entityKindToAnchorKind`/`MARKER_KIND_TO_THEME_KEY` are the marker-paint edge A2 derives; the mark `kind` attr colour (F5) | `src/lib/marginalia.ts:111-112`; `entity-hover.ts:130-144`; `EditorLayout.tsx:80,3633,3659` |
| **A9** (card appearance / morph) | `cardKindsForPanel` (the morph set) shares the panel-topology A2's `findEntity` re-derives; the comment/suggestion split A2 centralizes is the same the morph chevron converts | `src/cards/predicates.ts:40`; `entity-hover.ts:72-96` |
| **A10** (theme) | `entityKindToAnchorKind` → `MARKER_KIND_TO_THEME_KEY` → `PanelThemeKey`; the `aiRequest`/`error` hardcoded accents (anchor layer doesn't touch them, but the theme-key edge is shared) | `entity-hover.ts:130-144`; `EditorLayout.tsx:80`; `cards/types.ts:46-49` |

---

## Stale-ref corrections

The A0 + AF audits were pinned at `d1b3ee3`/`486a462`; A0+AF landed since. Corrections relied on:

- **`CardKind` canonical home.** A0 audit §1 said `src/panels/_shared/types.ts:32`. **Now
  `src/cards/types.ts:28-44`** (16 kinds); `panels/_shared/types` re-exports. Per
  `CARD-SYSTEM-REFACTOR.md:70`.
- **`ANCHORED_CARD_KINDS` tokens.** A0 audit listed `comment` (the old data-kind). **Now
  `revision-comment`/`revision-suggestion`** (`entity-hover.ts:32-33`) — already on the canonical
  spelling; `findEntity` cases use the new names (`entity-hover.ts:89-96`).
- **`cardKeyForEntity` implementation.** Pre-AF it hand-built a legacy `<kind>:<id>` key (the NO-GO
  seam). **Now `buildFloatKey({domain:"card",…})`** (`entity-hover.ts:113`) — AF-fix landed.
- **`parseAnyKey` location.** Not in the A0/AF audits as a concrete file. **`src/floats/float-key.ts:80`**
  (colon-safe dual-grammar parser; `revision:s:` → `revision-suggestion` normalization at `:108-122`).
- **`renderPoppedCard` 15-case dispatch switch** (A0 audit §2.2 / AF §1.5, `floating-cards.tsx:192-543`).
  **RETIRED** — `floating-cards.tsx` is now reduced to the `PoppedCardDeps` shape; AF's `FloatHost`
  dispatches (`floating-cards.tsx:175-179`). Any A2 ref to the old dispatch is dead.
- **`isAnchoredCardKind`/predicates.** Did not exist at the A0-audit pin. **Now
  `src/cards/predicates.ts:25`** (built, but **0 consumers** — the F1 gap).
- **`resolveCardKind` (card-spine helper).** A0 §4.4/§5.4 proposed it. **Not built** — no
  `resolveCardKind` in `src/cards/` (grep confirms). NOTE: a *different* `resolveCardKind(link)` exists
  at `link-registry.ts:147` (link-kind→cardKind, unrelated) — do not conflate.
- **`EntityCollections` slots.** A0 audit referenced `PoppedCardDeps` at `floating-cards.tsx:45-185`.
  That file is now slimmed; `CardFloatCtx` lives at `src/cards/card-float-ctx.ts`. The parallel
  `EntityCollections` is still at `entity-hover.ts:45-61` (the F4 unification target).
- **AF audit's `cardFloatPositions`/migration refs** (`useViewPrefs.ts:119-121,429-455,1377`): not
  re-pinned here (out of A2 scope); the lockstep migration landed per `CARD-SYSTEM-REFACTOR.md:55` and
  lives partly in `float-key.ts:169` (`migrateFloatKeys`).
