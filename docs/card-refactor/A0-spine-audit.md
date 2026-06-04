# A0-audit — the Card spine (card SSOT)

> Read-only audit + design for the **A0** foundation arena of the card-system refactor.
> Scope is **strictly the `Card` ontology spine** — the kind taxonomy and the registries
> that hand-sync to it. This chip proposes a single `CARD_REGISTRY` mirroring
> `TEXT_OBJECT_REGISTRY`, resolves the naming/keying warts, and defines the canonical
> predicates. It **consumes** AF's finalized `Floatable` contract (exposing
> `toFloatable(id, ctx): Floatable | null`) but designs **no** float-window internals,
> chrome, key grammar, or stack behavior — those are AF's. It **never merges** the two
> kinds (`TextObject` and `Card` stay ontologically distinct; no shared base type).
>
> Verified against `HEAD = d1b3ee3` on 2026-06-04. (AF was verified against `486a462`
> on 2026-06-01; the 3-day gap explains the largest single drift below — **Quotations was
> retired between the two audits**.) All `file:line` are best-effort exact; the impl chip
> should re-pin any that drift.

---

## 0. TL;DR

- **The cheat-sheet's taxonomy is materially drifted.** The real `CardKind` union has **17
  declared members, not 16** (`src/panels/_shared/types.ts:32`). It **excludes `quotation`**
  (the entire Quotations panel was deleted — zero `quotation` references survive in `src/`)
  and **includes `report` + `report-request`** (which the cheat-sheet omits). The cheat-sheet's
  `quote`/`quotation` warts are **already resolved by deletion**.
- **`CardKind` lives in `src/panels/_shared/types.ts:32` — that is canonical**, not
  `src/lib/types.ts` (which holds the card *data* shapes, not the kind union). Confirmed by
  `entity-hover.ts:13-16`.
- **The real fragmentation is ~2× the cheat-sheet's count.** Adding a card kind today touches
  **~14 hand-synced definition sites across 10 files** (the cheat-sheet lists ~7 rows / "~11
  sync points") — *plus* **six parallel kind-enums** that each re-encode a slice of the
  taxonomy with **inconsistent tokens**: `CardKind` (17), pristine `CardKind` (6, uses `cut`),
  `StackCardKind` (12, uses `bibliography`), `EntityKind`/`ANCHORED_CARD_KINDS` (13), `MarkerType`
  (7, uses `cut`/`revision`), `PanelThemeKey` (11, uses `cut`/`revision`), `HighlightType` (5).
- **One concept, five names.** The Revisions comment+suggestion pair is keyed as
  `comment`/`suggestion` (data-kind + lifecycle key), `revision`/`revision-suggestion` (popout
  prefix), `comment`/`revision-suggestion` (entity + stack), `comment` (theme), and `revision`
  (marker + accent). This is the headline wart.
- **`error` is poppable in capability but dead in practice.** `ErrorCard` builds an `error:<id>`
  key, has a `toggleAtAnchor`, and wraps in `FloatCard` when popped — but **there is no
  `case "error"` in `renderPoppedCard`**, so a popped error renders nothing. **A0 ruling
  (§4, §9-Q): `error` is NOT poppable** — `toFloatable` returns `null`; delete the dead capability.
- **The work is the same shape AF found on the float side: formalize + rename + unify.** One
  `CARD_REGISTRY: Record<CardKind, CardMeta>` in a new top-level `src/cards/` (sibling to
  `src/text-objects/`, `src/links/`, `src/floats/`) drives `label` / `titleLabel` / `keyPrefix` /
  `themeKey` / `panel` / `origin` / `anchored` / `markerType` / `lifecycle` / `dropSpec` /
  `toFloatable`. Every satellite table and the four polymorphic-panel branches become
  registry-derived; the six parallel kind-enums collapse to one union + derived predicates.

---

## 1. Canonical home of `CardKind` (cheat-sheet question, resolved)

**`CardKind` is defined once, at `src/panels/_shared/types.ts:32-49`** — a 17-member string
union. This is canonical. `src/lib/types.ts` holds the *data records* (`UserNote`,
`RevisionCard`, `CutterCard`, `BibEntry`, …) and their `kind` discriminator literals
(`"comment"` / `"suggestion"`), **not** the `CardKind` union. `entity-hover.ts:13-16` states the
relationship explicitly ("…not the same as `CardKind` from `panels/_shared/types.ts`…").

Two **other** `…Kind` unions named or shaped like `CardKind` are *divergent local copies* (warts,
§3): `usePristineCardManager.ts:23` (`export type CardKind = note|cut|report|todo|footnote|citation`)
and `src/lib/stack/types.ts:31` (`StackCardKind`).

**Recommendation:** move the canonical union into the new `src/cards/types.ts` (co-located with
its registry, exactly as `TextObjectKind` lives beside `TEXT_OBJECT_REGISTRY`); `src/panels/`
re-exports it for ripple-minimization, then becomes a pure consumer.

---

## 2. The verified card taxonomy (code-derived)

### 2.1 The 17 declared kinds — corrected against the cheat-sheet

`src/panels/_shared/types.ts:32-49`:

```
note · highlight · footnote · citation · comment · suggestion ·
cutter-comment · cutter-suggestion · revision-suggestion ·
report · report-request · example · todo · archive · bib · ai · error
```

**Drift from the cheat-sheet's "16 kinds":**

| Cheat-sheet says | Reality | Note |
|---|---|---|
| includes `quotation` | **GONE** | No `src/panels/Quotations/`, **zero** `quotation` refs in `src/`. The whole panel was deleted post-`486a462`. The `quote`-theme / `quotation`-kind warts are **resolved by deletion**. |
| omits `report` | **present** (`report`) | Reports panel hosts it (`PANEL_REGISTRY.reports`). |
| omits `report-request` | **present** (`report-request`) | Reports is polymorphic (report + report-request). |
| "16 kinds, 13 anchored" | **17 declared**, 13 anchored | The extra two (`report`/`report-request`) net against the dropped `quotation`, and bare `suggestion` is vestigial (§3.1). |

**`suggestion` is vestigial as a *taxonomy* kind.** It exists in the union and in
`CARD_KEY_PREFIXES` only because it is the on-disk **data discriminator** for `RevisionCard` /
`CutterCard` (`{ kind: "comment" | "suggestion" }`, `src/lib/types.ts:100-115, 466-509`). No code
builds a `suggestion:<id>` popout key; `renderPoppedCard` has **no `case "suggestion"`**. The
registry-level synthetic kinds are `revision-suggestion` / `cutter-suggestion`. After cleanup the
union is **16 real kinds** (drop bare `suggestion`; rename `comment` → `revision-comment` for
symmetry — see §3.1).

### 2.2 Per-kind matrix (verified)

`A` = anchored (in `ANCHORED_CARD_KINDS`, `entity-hover.ts:21`); `Pop` = has a live
`renderPoppedCard` case (`floating-cards.tsx:192`); `Stk` = in `StackCardKind`
(`stack/types.ts:31`) **and** yields a non-null snapshot (`resolve-card.ts:74`); `LC` = has a
`CardLifecycleProvider` entry (`EditorPane.tsx:1801`); `Drop` = in the drop-mode `SPECS`
(`drop-mode/registry.ts:40`).

| Kind | Origin | A | Pop | Stk | LC | Drop | Panel | keyPrefix | themeKey | markerType |
|---|---|:-:|:-:|:-:|:-:|:-:|---|---|---|---|
| `note` | user | ✓ | ✓ | ✓ | ✓ | ✓ | notes | `note` | `note` | `note` |
| `highlight` | user | ✓ | ✓ | ✓ | ✓ | ✓ | notes | `highlight` | `highlight` | — (tint) |
| `footnote` | user | ✓ | ✓ | ✓ | ✓ | ✓ | footnotes | `footnote` | `footnote` | — (atom) |
| `citation` | user | ✓ | ✓ | ✓ | ✓ | ✓ | citations | `citation` | `citation` | — (atom) |
| `comment` *(→`revision-comment`)* | user/ai | ✓ | ✓ (via `case "revision"`) | ✓ | ✓ | ✓ (`revision`) | revisions | `revision` | `comment` | `revision` |
| `suggestion` *(vestigial)* | — | ✗ | ✗ | ✗ | ✓ (keyed `suggestion`!) | ✗ | — | `suggestion` | — | — |
| `revision-suggestion` | user/ai | ✓ | ✓ (via `case "revision"`) | ✓ | ✗ (keyed under `suggestion`) | ✓ (`revision`) | revisions | `revision-suggestion`† | `comment` | `revision` |
| `cutter-comment` | user/ai | ✓ | ✓ | ✓ | ✓ | ✓ | cutter | `cutter-comment` | `cut` | `cut` |
| `cutter-suggestion` | user/ai | ✓ | ✓ | ✓ | ✓ | ✓ | cutter | `cutter-suggestion` | `cut` | `cut` |
| `report` | user/ai | ✓ | ✓ | ✗ | ✗ | ✓ | reports | `report` | `report` | `report` |
| `report-request` | user | ✓ | ✓ | ✗ | ✗ | ✓ | reports | `report-request` | `report` | `report` |
| `example` | derived | ✓ | ✓ | ◑ (declared; `resolveCardData` returns `null`) | ✗ | ✓ | examples | `example` | `example` | — |
| `todo` | user | ✓ | ✓ | ✓ | ✗ | ✓ | todo | `todo` | `todo` | `todo` |
| `archive` | user | ✓ | ✓ | ✓ | ✗ | ✓ | archive | `archive` | `archive` | `archive` |
| `bib` | system | ✗ | ✓ | ✓ (`bibliography`) | ✗ | ✗ (intentional) | bibliography | `bib` | `bib` | — |
| `ai` | system | ✗ | ✓ | ✗ | ✗ | ✓ | (multi-panel) | `ai` | `aiRequest` | — |
| `error` | system | ✗ | **✗ (no `case`; dead capability)** | ✗ | ✗ | ✗ | errors | `error` | `error` | `error` |

† `revision-suggestion` keyPrefix is **declared but never used to build a live key** — live
revision-suggestion cards pop under the shared `revision:` prefix and are resolved from
`card.kind` (`floating-cards.tsx:450-481`). Same for the vestigial `suggestion` prefix.

**Counts:** anchored **13** · poppable-today **14 cases** (note, highlight, footnote, citation,
archive, cutter-comment, cutter-suggestion, report, report-request, todo, bib, citation,
revision[=comment+suggestion], ai, example — error/suggestion/revision-suggestion-prefix not
dispatched) · lifecycle-covered **8** · stackable **~11** (example declared-but-null) · drop-spec
**13 card prefixes** (+ `textobject` + `stack-pull`).

### 2.3 Lifecycle coverage — corrected gaps

`EditorPane.tsx:1801-1843` wires `CardLifecycleProvider` for **8** kinds: `footnote`, `citation`,
`note`, `highlight`, `comment`, **`suggestion`** (line 1826 — keyed under the bare data-kind, *not*
`revision-suggestion`), `cutter-comment`, `cutter-suggestion`.

**The real gaps are `todo`, `archive`, `example`, `report`, `report-request`** — five kinds with
no clone/delete/bindAnchor. The cheat-sheet's gap list ("todo, archive, quotation, example") is
wrong twice: `quotation` is gone, and it **misses `report` + `report-request`**. (`bib`/`ai`/`error`
have no lifecycle by design.) Whether these gaps are intentional is an **open question** (§9-A) —
`todo`/`archive`/`report`/`report-request` are anchored and clonable in principle, so the gap looks
like drift, not intent.

---

## 3. Warts catalog (in code)

### 3.1 `suggestion` vs `revision-suggestion` — one concept, five names *(headline)*
The Revisions comment+suggestion pair is encoded under **five different naming schemes**:

| Layer | comment token | suggestion token | Site |
|---|---|---|---|
| Data discriminator | `comment` | `suggestion` | `RevisionCard.kind` (`types.ts:86,101`) |
| Lifecycle registry key | `comment` | **`suggestion`** | `EditorPane.tsx:1821,1826` |
| Popout / dispatch prefix | `revision` | `revision` (shared!) | `floating-cards.tsx:450` (`case "revision"` resolves both) |
| Entity / stack kind | `comment` | `revision-suggestion` | `entity-hover.ts:21`, `stack/types.ts:31` |
| Theme key | `comment` | `comment` | `CARD_THEMES` (`panel-primitives.tsx:189`) |
| Marker / accent key | `revision` | `revision` | `marginalia.ts:240`, `panel-theme.ts:23` |

Cutter is **asymmetric** with Revisions: cutter splits its popout/drop into two prefixes
(`cutter-comment` / `cutter-suggestion`), while revisions share one (`revision`, resolved from
`card.kind`). Both `CARD_TYPE_LABELS.suggestion` and `.revision-suggestion` render "Revision"
(`panel-registry.ts:231,234`).

**Disposition (registry):** in `src/cards/types.ts`, rename `comment` → **`revision-comment`** and
**drop bare `suggestion`** from `CardKind` (it lives only as the `RevisionCard`/`CutterCard` `.kind`
field). The four synthetic kinds become symmetric: `revision-comment`, `revision-suggestion`,
`cutter-comment`, `cutter-suggestion`. The lifecycle registry re-keys `suggestion` →
`revision-suggestion`. The one residual polymorphism — both revision kinds share `keyPrefix:
"revision"` — is centralized in a single `resolveCardKind(key, ctx)` helper (§5.4) that branches on
`record.kind`, exactly as AF §4.2 prescribes ("keep `revision` as the kind token; don't invent a
`float:card:comment:` vs `float:card:suggestion:` distinction the data doesn't carry"). Whether to
also split `revision` into two prefixes for full symmetry with cutter is an **open question** (§9-B).

### 3.2 `cut` theme/marker/accent vs `cutter-*` kinds
The Cutter panel's two kinds (`cutter-comment`, `cutter-suggestion`) map to theme key **`cut`**
(`CARD_THEMES.cut`, `panel-primitives.tsx:197`), marker type **`cut`** (`MARKER_META.cut`,
`marginalia.ts:241`), and accent key **`cut`** (`PanelThemeKey`, `panel-theme.ts:22`). The pristine
manager (`usePristineCardManager.ts:23`) and `HighlightType` (`useViewPrefs.ts:27`) *also* use the
bare token `cut`. So one panel speaks `cutter-comment`/`cutter-suggestion`/`cut` depending on the
layer. (The legacy `cut:` **popout** prefix was already retired with the Cutter rebuild — confirmed
`architecture.md:138`.)

**Disposition:** keep `cut` as the *theme/marker/accent* namespace token (it's the panel's visual
identity, shared by both kinds — that's correct), but make it **registry-derived**: `CARD_REGISTRY`
maps both cutter kinds → `themeKey: "cut"`, `markerType: "cut"`. The divergent pristine `CardKind`
and `HighlightType` tokens get reconciled to the canonical kinds (§3.6).

### 3.3 `quote` theme vs `quotation` kind — RESOLVED BY DELETION
The cheat-sheet's wart ("`quote` theme vs `quotation` kind, opts out of `CARD_THEMES`, inline
styled") is **stale**. Quotations was deleted: no panel dir, no `quotation` `CardKind`, no `quote`
theme key in `CARD_THEMES` (verified `panel-primitives.tsx:175-202`), no marker. AF's §1.2 listing
of `QuotationGroupCard.tsx` and the `quotation:` prefix reflects the older `486a462` snapshot.
**Disposition:** drop from the wart list; note as a closed item. (AF's `QuotationGroupCard`
float-wrapper row, AF §1.2, is also moot — flag back to the management session so AF's impl scope
loses that file.)

### 3.4 Dual example key (`example:` vs `textobject:exampleBlock:`)
Two distinct popout keys coexist (`glossary.md:131`, `architecture.md:142`):
`example:<id>` → the **Examples panel card** (`ExampleCard`, dispatched at `floating-cards.tsx:519`),
vs `textobject:exampleBlock:<uuid>` → the **in-editor example block** (a `TextObject`, dispatched at
`floating-cards.tsx:496`). These are genuinely **two surfaces of two different ontologies** (a Card
mirroring the block vs the block itself). **Disposition:** A0 keeps them as two keys — under AF's
`float:` grammar they read as `float:card:example:` vs `float:textobject:exampleBlock:`, which is
legible. AF §10-Q4 and the parent doc's A1 (gardening) own any actual collapse; A0 just declares
`example` cleanly in `CARD_REGISTRY` with `origin: "derived"` (the card is harvested from the
`exampleBlock` node by `useExamples`).

### 3.5 `error` poppable in capability, dead in dispatch — **A0 RULING**
`ErrorCard.tsx` is fully popout-wired: imports `FloatCard` (`:11`) + `popKey` (`:12`), builds
`cardKey = popKey("errors", err.id)` → `error:<id>` (`:108`), exposes `toggleAtAnchor` (`:111`),
and renders inside `FloatCard` when `isPoppedOut` (`:150-152`). **But `renderPoppedCard` has no
`case "error"`** (`floating-cards.tsx:197-542`; falls to `default: return null`). So popping an
error renders **nothing** — AF §1.5 / §10-Q5 flagged this and handed the taxonomy call to A0.

**Ruling: `error` is NOT poppable.** `CARD_REGISTRY.error.toFloatable` returns `null`; the dead
`FloatCard` early-return + `toggleAtAnchor` are removed from `ErrorCard` (coordinate the deletion
with A1 gardening). Rationale:
1. **Error ids are ephemeral.** Errors are regenerated every `useLatexLint` pass (a structurally-
   null keystroke can re-run the lint), so a persisted `error:<id>` float key orphans almost
   immediately — popped state can't be honored coherently.
2. **It never worked.** No dispatcher case ever existed, so removing the capability is dead-code
   gardening, not a regression.
3. **`error` is system-generated and non-anchored**, like a transient diagnostic; there is no
   jump-to-source-and-edit workflow that a floating error serves.

`ai` stays poppable (stable sidecar ids; already dispatched at `floating-cards.tsx:483`). Net
poppable set = **15 of the 16** clean kinds (all except `error`). *Alternative* (if the human wants
errors floatable, §9-Q): wire `case "error"` and gate the key on a still-live error id — but that
fights the ephemeral-id problem and is not recommended.

### 3.6 Six parallel kind-enums with inconsistent tokens
Each re-encodes a slice of the taxonomy by hand; tokens drift (`cut` vs `cutter-*`, `bibliography`
vs `bib`, `revision` vs `comment`):

| Enum | Members | Site | Token drift |
|---|---|---|---|
| `CardKind` (canonical) | 17 | `panels/_shared/types.ts:32` | — |
| `CardKind` (pristine) | 6: note·**cut**·report·todo·footnote·citation | `usePristineCardManager.ts:23` | `cut`, omits most kinds |
| `StackCardKind` | 12 | `stack/types.ts:31` | **`bibliography`** (vs `bib`), `comment` |
| `EntityKind`/`ANCHORED_CARD_KINDS` | 13 | `entity-hover.ts:21,37` | `comment`+`revision-suggestion` |
| `MarkerType` | 7: note·archive·**revision**·**cut**·todo·report·error | `marginalia.ts:97` | `cut`, `revision` |
| `PanelThemeKey` | 11 | `panel-theme.ts:14` | `cut`, `revision` |
| `HighlightType` | 5: note·todo·**comment**·**cut**·report | `useViewPrefs.ts:23` | `comment`, `cut` |
| `CARD_THEMES` keys | 13 | `panel-primitives.tsx:175` | `comment`, **`aiRequest`** (vs `ai`), `cut` |
| `MarginaliaMarker.entityKind` (inline) | 13 | `marginalia.ts:111` | duplicate of `ANCHORED_CARD_KINDS` |

Plus satellite consumer unions: `CardContentKind` (`lib/cards/has-content.ts:22`), `MarginItemKind`
(`lib/cards/delete-margin-item.ts:46`), `RecentlyAddedKind` (`useRecentlyAddedTracker.ts:10`).

**Disposition:** all become **registry-derived** from the one `CardKind` + `CardMeta` fields.
`EntityKind`/`ANCHORED_CARD_KINDS` and `MarginaliaMarker.entityKind` → `{k | CARD_REGISTRY[k].anchored}`.
`StackCardKind` → the set of kinds with a non-null `snapshotForStack`. `MarkerType`/`PanelThemeKey`
stay as small *visual* namespaces but are reached via `CARD_REGISTRY[k].markerType` / `.themeKey`
(no hand-kept kind list). Pristine `CardKind`/`HighlightType` consume the canonical union.

### 3.7 Polymorphic-panel special-casing (4 panels, not 3)
The cheat-sheet says "3 polymorphic panels (Notes, Revisions, Cutter)". **Reality is 4**:
**Reports** is also polymorphic (`report` + `report-request`, `PANEL_REGISTRY.reports.card: null`,
`panel-registry.ts:89`). The mechanism is a `Partial<Record<CardKind, PanelKind>>` map,
`POLYMORPHIC_CARD_PANEL` (`panel-registry.ts:299-307`), with **7** entries (cutter-comment,
cutter-suggestion, revision-suggestion, report, report-request, note, highlight). Note Revisions is
*not* `card: null` — it declares `card: { kind: "comment" }` and lists only `revision-suggestion`
as the polymorphic add-on, so the "card: null ⇒ polymorphic" rule the cheat-sheet implies is itself
imprecise. Every consumer that maps kind→panel re-derives this (`getPanelByCardKind` +
`findEntity` switch + the dispatch cases).

**Disposition:** invert the dependency. Each `CardMeta` declares its `panel: PanelKind`;
`cardKindsForPanel(panel)` *derives* the hosted set. `PANEL_REGISTRY.card` and
`POLYMORPHIC_CARD_PANEL` both **retire**; the `card: null` special case disappears (a panel's kinds
are whatever points at it). The comment/suggestion shared-prefix residue is the one
`resolveCardKind` helper (§5.4).

### 3.8 Theme-key ↔ kind name mismatches
`CARD_THEMES` (`panel-primitives.tsx:175-202`) keys: `footnote, note, highlight, archive, todo, bib,
citation, comment, aiRequest, error, cut, example, report` (13). Mismatches vs `CardKind`:
`ai` → theme **`aiRequest`** (camelCase); `cutter-comment`/`cutter-suggestion` → **`cut`**;
`comment`/`revision-suggestion` → **`comment`**. `aiRequest` (`#0ea5e9`) and `error` (`#b45757`) are
**hardcoded** accents (not `themeFromAccent(DEFAULT_PANEL_COLORS.*)`) — the parent doc's A10
"hardcoded `aiRequest`/`error`" inconsistency. **Disposition:** `CardMeta.themeKey` makes every
mapping explicit and machine-checkable; A10 owns whether to promote `aiRequest`/`error` into
`DEFAULT_PANEL_COLORS`.

---

## 4. The card SSOT design — `CARD_REGISTRY`

### 4.1 Location (recommended)
**New top-level `src/cards/`** module, sibling to `src/text-objects/`, `src/links/`, and AF's
`src/floats/`:

```
src/cards/
  types.ts            CardKind (the union, moved from panels/_shared), CardMeta,
                      CardOrigin, CardLifecycleCapability, ThemeKey re-export
  card-registry.ts    CARD_REGISTRY: Record<CardKind, CardMeta>  (mirrors text-object-registry.ts)
  card-float-ctx.ts   CardFloatCtx (re-homes today's PoppedCardDeps; AF references the name only)
  predicates.ts       isCardKind / isAnchoredCardKind / isSystemCardKind / cardKeyPrefix /
                      panelForCardKind / cardKindsForPanel / resolveCardKind / stackableCardKinds
```

**Reasoning:** byte-for-byte parallel with `TEXT_OBJECT_REGISTRY` — the proven pattern the parent
doc says to mirror; co-locates the kind union with its registry; keeps the two ontologies as
sibling top-level modules (reinforcing "two kinds, never merged"); `src/panels/` and the six
satellite enums become consumers. **Wrinkle:** a `src/lib/cards/` already exists
(`has-content.ts`, `delete-margin-item.ts`). Recommendation: keep those as lower-level helpers and
have `src/cards/` import them, **or** fold them under `src/cards/` — resolve in impl; do not let the
name collision block the top-level `src/cards/` choice (the parallelism with `src/text-objects/` is
worth it).

### 4.2 `CardMeta` interface

```ts
// src/cards/types.ts
import type { ReactNode } from "react";
import type { CARD_THEMES } from "@/components/panel-primitives";
import type { PanelKind } from "@/panels/_shared/types";
import type { MarkerType } from "@/lib/marginalia";
import type { DropSpec } from "@/components/drop-mode/types";
import type { Floatable } from "@/floats/types";        // AF-owned contract

export type ThemeKey = keyof typeof CARD_THEMES;

/** 16 real kinds. Renames `comment` → `revision-comment`; DROPS bare
 *  `suggestion` (only ever the on-disk RevisionCard/CutterCard `.kind`
 *  discriminator, never a taxonomy kind). */
export type CardKind =
  | "note" | "highlight"
  | "footnote" | "citation"
  | "example"
  | "todo" | "archive"
  | "report" | "report-request"
  | "revision-comment" | "revision-suggestion"
  | "cutter-comment" | "cutter-suggestion"
  | "bib" | "ai" | "error";

/** Creation provenance.
 *  user    — has a "+"/action/drop creation path
 *  system  — generated from a sidecar or the linter (bib, ai, error)
 *  derived — mirrors a TextObject harvested from the doc (example) */
export type CardOrigin = "user" | "system" | "derived";

/** Declared lifecycle coverage. Booleans, not closures: the actual ops are
 *  PER-DOC hooks wired in EditorPane's CardLifecycleProvider. The registry
 *  declares INTENT; a dev-time assertion checks the provider satisfies exactly
 *  the declared ops, so a gap is intentional-and-visible, never silent. */
export interface CardLifecycleCapability {
  clone: boolean;
  delete: boolean;
  bindAnchor: boolean;   // Mode-B re-anchor after clone
}

/** Per-CardKind SSOT. Mirrors TextObjectMeta. */
export interface CardMeta {
  /** Uppercase overline label (was CARD_TYPE_LABELS). */
  label: string;
  /** Auto-title prefix at creation, or null to opt out (was CARD_TITLE_LABELS). */
  titleLabel: string | null;
  /** Popout/float key token (was CARD_KEY_PREFIXES). Float key is
   *  `float:card:<keyPrefix>:<id>`. The revision pair share `"revision"`;
   *  resolveCardKind() disambiguates from the record's `.kind`. */
  keyPrefix: string;
  /** CARD_THEMES key (was CardLink.themeKey + ad-hoc per-card lookups). */
  themeKey: ThemeKey;
  /** Owning panel (was PANEL_REGISTRY.card + POLYMORPHIC_CARD_PANEL). `null`
   *  for cross-panel kinds with no single home — only `ai`, which renders in
   *  Footnotes/Notes/Reports/Citations/Todo (architecture.md:101). */
  panel: PanelKind | null;
  /** Creation provenance. */
  origin: CardOrigin;
  /** Three-surface hover/anchor membership (was ANCHORED_CARD_KINDS / EntityKind
   *  / MarginaliaMarker.entityKind). */
  anchored: boolean;
  /** Gutter-marker namespace, or null for kinds with no marginalia icon
   *  (footnote/citation render in-text atoms; bib/ai unanchored; highlight = tint). */
  markerType: MarkerType | null;
  /** Declared lifecycle coverage (validated against the per-doc provider). */
  lifecycle: CardLifecycleCapability;
  /** In-document drop behavior, or null for kinds that don't re-anchor by drop
   *  (was the drop-mode SPECS record + per-panel drop-spec.ts). Specs are already
   *  ctx-parameterized (DropCtx), so the static object lives here directly. */
  dropSpec: DropSpec | null;
  /** AF integration point. Returns the shared Floatable presence, or null when
   *  this kind is not poppable (error). MUST be a pure per-id resolver — resolve
   *  one entity by id from ctx; NO full-doc descent (keystroke sanctity / AF §8). */
  toFloatable(id: string, ctx: CardFloatCtx): Floatable | null;
}
```

### 4.3 `toFloatable` + `CardFloatCtx` (AF integration)
AF §2 fixes the signature `toFloatable(id, ctx): Floatable | null` and the `Floatable` shape
(`key`, `domain`, `kind`, `id`, `title`, `surface`, `renderBody()`, `chromeSlots?`,
`jumpToSource()`, `canJump`, `snapshotForStack(source)`, `defaultSize?`, `spawnHint?`). A0 supplies
the card side:

- **`CardFloatCtx` ≈ today's `PoppedCardDeps`** (`floating-cards.tsx:45-185`) — the per-doc entity
  collections + selected-id slots + setters + `editorRef` + shared actions. A0 re-homes this type to
  `src/cards/card-float-ctx.ts`; the body of each `toFloatable` is the existing `case` body of
  `renderPoppedCard` (e.g. `note` resolves `ctx.notes.find(n => n.id === id)`, builds the
  `NoteCard`, wires `onJump`/`onUpdate`/…). The 15 surviving cases **move into the registry**, one
  per kind; the `renderPoppedCard` switch is **deleted** (AF's generic `FloatHost` calls
  `CARD_REGISTRY[kind].toFloatable(id, ctx)`).
- **`canJump`** is per-card (anchor presence), exactly as today:
  `getLinkedTextObjectIds(record).length > 0` (`floating-cards.tsx:201,223,290,…`). The
  `toFloatable` body computes it and sets `Floatable.canJump`.
- **`surface: "panel"`** for all card kinds (AF §1.10: cards use the beige `"panel"` shell, text-
  objects use `"card"`). A0 sets `surface: "panel"` inside each card `toFloatable`; AF §10-Q3 keeps
  the per-domain divergence — confirmed fine from the card side.
- **`snapshotForStack`** maps to today's `cardKeyPrefixToStackKind` + `resolveCardData` +
  `snapshotCard` (`resolve-card.ts`, `snapshot.ts`). In the registry it becomes per-kind: the
  ~11 stackable kinds return a `StackItem`; `report`/`report-request`/`ai`/`error` and (today)
  `example` return `null`. This **retires the prefix switch** AF §1.8 flagged and **closes the
  text-object-can't-snapshot gap by construction**.
- **`toFloatable` returns `null`** for the one non-poppable kind, **`error`** (§3.5 ruling). Every
  other kind returns a `Floatable`. (`ai` is poppable.)

### 4.4 Canonical predicates (replace the scattered tables)

```ts
// src/cards/predicates.ts
export const CARD_KINDS = Object.keys(CARD_REGISTRY) as CardKind[];

export const isCardKind = (s: string): s is CardKind => s in CARD_REGISTRY;

/** Replaces ANCHORED_CARD_KINDS, EntityKind, MarginaliaMarker.entityKind,
 *  and the polymorphic-panel anchor branches. */
export const isAnchoredCardKind = (k: CardKind) => CARD_REGISTRY[k].anchored;

export const isSystemCardKind = (k: CardKind) => CARD_REGISTRY[k].origin === "system";

/** Replaces CARD_KEY_PREFIXES + cardPopKey/popKey token lookup. */
export const cardKeyPrefix = (k: CardKind) => CARD_REGISTRY[k].keyPrefix;

/** Replaces getPanelByCardKind + POLYMORPHIC_CARD_PANEL. */
export const panelForCardKind = (k: CardKind) => CARD_REGISTRY[k].panel;

/** Derives the polymorphic-panel membership (notes→[note,highlight], etc.).
 *  Replaces PANEL_REGISTRY.card + POLYMORPHIC_CARD_PANEL entirely. */
export const cardKindsForPanel = (p: PanelKind) =>
  CARD_KINDS.filter((k) => CARD_REGISTRY[k].panel === p);

/** The set of kinds that can serialize onto the Stack (toFloatable yields a
 *  non-null snapshotForStack). Replaces the hand-kept StackCardKind union. */
export const stackableCardKinds = () =>
  CARD_KINDS.filter((k) => CARD_REGISTRY[k].origin !== "system" /* + a stackable flag */);

/** The ONE residue of comment/suggestion polymorphism. Given a popout/float
 *  key whose prefix may be shared (`revision`), resolve the concrete CardKind
 *  by reading the record's data-`.kind` from ctx. Centralizes the branching
 *  that today is duplicated across renderPoppedCard, resolve-card, findEntity,
 *  and entityKindToAnchorKind. */
export function resolveCardKind(key: string, ctx: CardFloatCtx): CardKind | null { /* … */ }
```

`PANEL_REGISTRY` slims to panel-only metadata (`kind`, `label`, `folder`, `omniEligible`,
`omniSide`, `defaultStripSide`); its `card: CardLink | null` field and `POLYMORPHIC_CARD_PANEL`
are deleted. `getPanelByCardKind`, `findEntity`, `cardKeyForEntity`, `entityKindToAnchorKind`
(`entity-hover.ts`) collapse onto the predicates above.

---

## 5. Keystroke sanctity

**How card data reaches cards today (verified, AGENTS.md-compliant):** panel card-source memos
gate on `useStructuralRevisions` per-category counters + the reactive `editor` instance — never an
`update`-counter. Popped floats specifically: the popout list is `prefs.poppedOutCards` (identity
changes only on open/close, never on a plain keystroke); `renderPoppedCard` (→ future
`toFloatable`) is a **pure per-id resolver** — each case does one `collection.find(x => x.id === id)`
(`floating-cards.tsx:199,221,242,…`), no full-doc walk. The `footnote` case reads
`editorRef.current?.getFootnotes()` **once per float render**, not per main-doc transaction
(`floating-cards.tsx:242`).

**How the SSOT preserves it:**
1. **`toFloatable` stays a pure resolver.** The contract (and a code comment) forbid doc descent;
   each kind's body is the existing `case` body verbatim — O(1)-by-id, no `editor.state.doc`
   traversal. Consistent with AF §8.2.
2. **No new `editor.on('update'|'transaction')` subscriber.** The registry is a static object +
   pure functions; predicates are O(1) map reads (`CARD_REGISTRY[k].anchored`, etc.) — they replace
   *hand-kept arrays*, not doc scans, so they add zero per-keystroke cost.
3. **`anchored` is a static boolean**, read in O(1) — it must never be computed by scanning the doc
   for the kind's markers (the live `anchoredIds` set in `PoppedCardDeps` is computed elsewhere,
   already gated; the registry only exposes the *capability* flag).
4. **Card-source memos keep gating on `useStructuralRevisions` + reactive `editor`** — the SSOT
   touches the *definition* tables, not the derivation path.

**Risks to watch in impl:** (a) a predicate accidentally implemented as a doc walk (e.g.
`stackableCardKinds` filtering live records) — keep predicates over the static registry only;
(b) `resolveCardKind(key, ctx)` reading `ctx.comments` is fine (O(1) find), but must not be called
in a per-transaction loop. **Verify:** `window.__virgilBusStats().emitCount` flat while typing N
plain chars with a card float open; floats must not re-render on a structurally-null keystroke.

---

## 6. Fragmentation table (`Surface | File(s) (file:line) | Disposition`)

| Surface | File(s) (`file:line`) | Disposition |
|---|---|---|
| `CardKind` union (canonical) | `src/panels/_shared/types.ts:32` | **MOVE** to `src/cards/types.ts`; drop bare `suggestion`, rename `comment`→`revision-comment`; `panels/` re-exports |
| `PANEL_REGISTRY.card` (CardLink) | `src/panels/panel-registry.ts:20-27,44-188` | **RETIRE** the `card` field; panel↔kind derives from `CARD_REGISTRY[k].panel` via `cardKindsForPanel` |
| `CARD_KEY_PREFIXES` | `src/panels/panel-registry.ts:193-211` | **REPLACE** with `CardMeta.keyPrefix`; `popKey`/`cardPopKey` delegate to `cardKeyPrefix(k)` |
| `CARD_TYPE_LABELS` | `src/panels/panel-registry.ts:222-244` | **REPLACE** with `CardMeta.label` |
| `CARD_TITLE_LABELS` + `nextCardTitle` | `src/panels/panel-registry.ts:251-277` | **REPLACE** with `CardMeta.titleLabel`; `nextCardTitle` reads the registry |
| `POLYMORPHIC_CARD_PANEL` + `getPanelByCardKind` | `src/panels/panel-registry.ts:299-316` | **DELETE**; `panelForCardKind` / `cardKindsForPanel` derive it |
| `CARD_THEMES` (+ `aiRequest`/`error` hardcoded) | `src/components/panel-primitives.tsx:175-202` | **KEEP** the theme objects; reach them via `CardMeta.themeKey`. A10 owns the hardcoded-accent fix |
| `CardLifecycleRegistry` wiring (keyed `suggestion`) | `src/components/EditorPane.tsx:1801-1843` | **KEEP** per-doc closures; re-key `suggestion`→`revision-suggestion`; **validate** the provided ops against `CardMeta.lifecycle` (dev assertion) |
| `ANCHORED_CARD_KINDS` / `EntityKind` / `findEntity` / `cardKeyForEntity` / `entityKindToAnchorKind` | `src/links/_shared/entity-hover.ts:21-155` | **REPLACE** with `isAnchoredCardKind` + `resolveCardKind`; the `findEntity`/`cardKeyForEntity` switches collapse onto predicates |
| `MarkerType` + `MARKER_META` | `src/lib/marginalia.ts:97,237-247` | **KEEP** the visual namespace; reach via `CardMeta.markerType` (kill the hand list) |
| `MarginaliaMarker.entityKind` (inline 13-kind union) | `src/lib/marginalia.ts:111-114` | **REPLACE** with `CardKind` filtered by `anchored` |
| `MIME_*` card constants + `ANCHOR_DRAG_TYPES` | `src/lib/marginalia.ts:49-90` | **DEFER to A1** (most are legacy HTML5-drag MIMEs; drop-mode replaced them). A0 notes, A1 gardens |
| Drop-spec `SPECS` registry | `src/components/drop-mode/registry.ts:40-63` | **FOLD** into `CardMeta.dropSpec`; `lookupSpec` reads the registry (keep the `textobject:linkedRange:` carve-out + `stack-pull`) |
| per-panel `drop-spec.ts` (×9) | `src/panels/{Notes,Todo,Archive,Cutter,Examples,Footnotes,Citations,Revisions,Reports}/drop-spec.ts` | **KEEP** the spec definitions co-located; the registry *references* them (mirrors `text-object-registry` importing `drop-adapters`) |
| `DropCtx` sub-bags + `StackPullApi` | `src/components/drop-mode/types.ts:114-203` | **KEEP** (per-doc ctx); unchanged — specs already take ctx |
| `renderPoppedCard` 15-case switch | `src/components/editor-layout/floating-cards.tsx:192-543` | **REPLACE** — each case body becomes `CARD_REGISTRY[kind].toFloatable`; AF's `FloatHost` dispatches. `case "textobject"` stays text-object-side |
| `PoppedCardDeps` | `src/components/editor-layout/floating-cards.tsx:45-185` | **RE-HOME** as `CardFloatCtx` in `src/cards/card-float-ctx.ts` |
| `StackCardKind` + `StackCardSnapshot` | `src/lib/stack/types.ts:31-70` | **DERIVE** the kind set from `stackableCardKinds`; snapshot payload stays (it's data-shaped) |
| `cardKeyPrefixToStackKind` + `resolveCardData` | `src/lib/stack/resolve-card.ts:26-130` | **RETIRE** the prefix switch; route via `Floatable.snapshotForStack()` (AF §6). `example` returning `null` becomes an explicit registry fact |
| `snapshotCard` per-kind serialization | `src/lib/stack/snapshot.ts` (e.g. `:99,134,162,195,252,265`) | **KEEP**; invoked from each kind's `snapshotForStack` |
| Pristine `CardKind` (6, uses `cut`) | `src/hooks/usePristineCardManager.ts:23-29` | **REPLACE** with the canonical union (subset by `origin === "user"` + a `pristineEligible` flag if needed) |
| `PanelThemeKey` / `DEFAULT_PANEL_COLORS` | `src/lib/panel-theme.ts:14-33` | **KEEP** the accent namespace; reach via `CardMeta.themeKey`/`markerType` |
| `HighlightType` (5, uses `cut`/`comment`) | `src/hooks/useViewPrefs.ts:23-28` | **RECONCILE** tokens to canonical kinds (the highlight-hiding toggles map to anchored kinds) |
| `CardContentKind` / `MarginItemKind` / `RecentlyAddedKind` | `lib/cards/has-content.ts:22`, `lib/cards/delete-margin-item.ts:46`, `useRecentlyAddedTracker.ts:10` | **CONSUME** the canonical union (satellite consumers; low-risk) |
| `error` popout capability (dead) | `src/panels/Errors/ErrorCard.tsx:11,12,108,111,150-152` | **DELETE** (A1 gardening) — `toFloatable("error")` returns `null` (§3.5 ruling) |
| Dual example key | `floating-cards.tsx:496,519`; `architecture.md:142` | **KEEP** two keys (two ontologies); legible under AF's `float:` grammar; A1 owns any collapse |

---

## 7. Definition of Done for the card spine

1. **Single card registry.** `CARD_REGISTRY: Record<CardKind, CardMeta>` in `src/cards/` is the
   only place a card kind is *defined*. Adding a kind = one entry (+ membership in any
   capability-derived set). **No edits** to `CARD_KEY_PREFIXES`, `CARD_TYPE_LABELS`,
   `CARD_TITLE_LABELS`, `POLYMORPHIC_CARD_PANEL`, `CARD_THEMES` lookup, `ANCHORED_CARD_KINDS`,
   `MarkerType`, the dispatch switch, `StackCardKind`, the pristine union, or `HighlightType`.
2. **`CardKind` canonicalized.** One union in `src/cards/types.ts`; bare `suggestion` dropped;
   `comment` → `revision-comment`. The six parallel kind-enums are registry-derived or consume the
   canonical union; the inline `MarginaliaMarker.entityKind` and `usePristineCardManager.CardKind`
   are gone.
3. **Naming/keying drift resolved.** No `suggestion`/`revision-suggestion` ambiguity; symmetric
   `{revision,cutter}-{comment,suggestion}` kinds; theme/marker/accent reached only via `CardMeta`;
   `cut`/`bibliography`/`aiRequest` token drift eliminated at the consumer boundary.
4. **Polymorphism is registry-derived.** `panelForCardKind` / `cardKindsForPanel` replace
   `PANEL_REGISTRY.card` + `POLYMORPHIC_CARD_PANEL`; the one comment/suggestion residue lives in a
   single `resolveCardKind`. No per-consumer polymorphic branch survives.
5. **Lifecycle coverage rationalized.** Each kind's clone/delete/bindAnchor is declared in
   `CardMeta.lifecycle` and validated against the per-doc provider; the `todo`/`archive`/`example`/
   `report`/`report-request` gaps are resolved to intentional (declared `false`) or filled (§9-A).
6. **`toFloatable` satisfies AF's contract exactly.** Every poppable kind returns a `Floatable`
   (`surface:"panel"`, `canJump` per-anchor, `snapshotForStack` per-kind); `error` returns `null`.
   AF's `FloatHost` dispatches solely via `CARD_REGISTRY[kind].toFloatable(id, ctx)`; the 15-case
   `renderPoppedCard` switch and `cardKeyPrefixToStackKind` are deleted.
7. **The two kinds stay distinct.** No shared base type with `TextObject`; `CARD_REGISTRY` and
   `TEXT_OBJECT_REGISTRY` are siblings that only both *produce* a `Floatable`.
8. **Keystroke sanctity intact.** No `update`-counter path; `toFloatable` resolvers and all
   predicates are O(1)-by-id / static-map reads; `__virgilBusStats().emitCount` flat on plain
   typing with a card float open.
9. **No silent data loss.** `keyPrefix` tokens are unchanged where persisted (`note`, `footnote`,
   `revision`, `cutter-*`, …) so existing `prefs.poppedOutCards` keys still resolve; any token
   change (e.g. were `comment`→`revision-comment` to alter a *persisted* key — it does not, the
   popout prefix is `revision`) rides AF's `float:` migration. The `suggestion` lifecycle re-key is
   internal (not persisted).

---

## 8. Open questions for the human

- **(A) Lifecycle gaps — intentional or drift?** `todo`, `archive`, `report`, `report-request`,
  `example` have no clone/delete/bindAnchor (`EditorPane.tsx:1801-1843`). `todo`/`archive`/`report`/
  `report-request` are anchored and clonable in principle, so the gap reads as drift. **Fill them**
  (wire the missing `clone`/`delete`/`bindAnchor` in the provider) or **declare them `false`**
  intentionally in `CardMeta.lifecycle`? (A0 recommends: fill todo/archive/report/report-request;
  leave `example` `false` — it's derived from the doc, cloned by duplicating the block.)
- **(B) Unify `suggestion`/`revision-suggestion`, and Revisions↔Cutter prefix asymmetry?** A0
  recommends dropping bare `suggestion`, renaming `comment`→`revision-comment`, and **keeping**
  `revision` as one shared popout prefix (resolved from `card.kind`, per AF §4.2). Should we instead
  **split** `revision` into `revision-comment:`/`revision-suggestion:` prefixes for full symmetry
  with cutter (cleaner, but a persisted-key migration), or **merge** cutter back to one `cutter:`
  prefix (fewer prefixes, but loses the existing split)? A0's pick: keep `revision` shared, leave
  cutter split, document the asymmetry — least migration, AF-aligned.
- **(C) Is `error` poppable?** A0 ruling: **No** — `toFloatable("error") = null`, delete the dead
  `ErrorCard` capability (§3.5). Confirm, or override to "yes, wire `case "error"` + a live-id
  guard" (not recommended — error ids are ephemeral per lint pass).
- **(D) `src/cards/` vs the existing `src/lib/cards/`.** A0 recommends top-level `src/cards/` for
  parallelism with `src/text-objects/`. Fold `src/lib/cards/{has-content,delete-margin-item}.ts`
  into it, or keep them as lower-level helpers imported by `src/cards/`? (A0: keep them, import.)
- **(E) Dual example key.** A0 leaves `example:` (panel card) and `textobject:exampleBlock:`
  (block) as two keys (two ontologies), legible under AF's `float:` grammar; the parent doc files
  the collapse under A1. Confirm A1 owns it.
- **(F) `origin` granularity.** A0 proposes `user | system | derived`. Is the `derived` value
  (only `example` today) worth a third state, or fold `example` into `user`? (A0: keep `derived` —
  it documents that the example *card* mirrors a doc `exampleBlock`, which matters for creation +
  stack semantics.)
- **(G) AF cross-check.** Quotations' deletion moots AF §1.2's `QuotationGroupCard.tsx` float-
  wrapper row and the `quotation:` prefix in AF §1.5 — flag to the management session so AF-impl's
  "15 inline FloatCard sites" count drops to 14 and excludes the deleted file.
