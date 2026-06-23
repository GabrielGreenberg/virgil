# T6 — Auto-title schema flag + contained unified fixes

> Design doc for the LHS-panel fix sweep. DESIGN ONLY — no source edited.
> Source read at HEAD `7e47f91`. Cross-refs: `../CLASSES.md`, `../BUGLIST.md`, `../findings-index.json`.

---

## 1. Scope

This theme owns the one **approved schema change** of the sweep — the `titleAuto`
title-provenance flag that kills the auto-title shape-detection false-positive class
(C12) — plus **five "contained" classes** that each reduce to *one shared helper used
by many call sites*. The unifying meta-principle for the whole theme: **stop
re-deriving a fact from a lossy projection; carry the fact, or compute it once in a
single helper.** Auto-title re-derives provenance from a title's *shape*; the other
five re-derive (or duplicate, or asymmetrically mutate) a fact that wants one
authoritative computation.

Full bug-id roster (19 bugs across 6 classes):

| Class | Theme sub-area | Bug ids |
|---|---|---|
| **C12** | Auto-title schema flag | REP-A2-02 [HIGH], OMNI-F1-01 [MED], REP-F5-03 [MED], EX-A2-01 [LOW] |
| **C15** | Select/jump composition | CI-F2-01, EX-F2-01, FN-F2-01, SR-F1-02 [MED]; EX-F2-02, EX-F3-02, OUT-F3-02, SR-C1-01, SR-F2-01, SR-F5-01 [LOW] |
| **C16** | Plural-biblatex one-way + merge-vs-replace | BIB-A3-02, BIB-F5-04, CI-F5-01, CI-F5-02, CI-F7-01, CI-F7-02 [MED]; BIB-F5-05, CI-F5-03 [LOW] |
| **C24** | Compressed-summary clamp gap | REP-F5-04 [LOW]; BIB-F1-03, CI-F1-01, EX-F1-01, EX-F1-02, OMNI-F1-03, REP-F1-01 [COSMETIC] |
| **C25** | Header/strip count from subset | BIB-A1-01, FN-C1-01, FN-F1-03, FN-F2-02 [LOW]; CI-C1-01 [COSMETIC] |
| **C26** | Word-boundary `\b` regex | BIB-F7-04, SR-F1-03, SR-F1-04 [LOW]; SR-F1-05 [COSMETIC] |

Severity mix: 1 HIGH, 7 MEDIUM, 11 LOW, 11 COSMETIC (some bugs carry two class tags).
**Bugs resolved: 30 distinct ids** (some COSMETIC members are "by-design, won't fix"
and are explicitly called out in §6).

---

## 2. Root diagnosis

### C12 — the deep one (auto-title)

The architectural deficiency is **provenance discarded, then guessed back from
surface shape.** BUG #31 (the predecessor fix) correctly observed that persisting a
generated title (`"Report 8"`) was wrong, but its remedy threw away the wrong bit:
it stopped persisting the title *value* AND deleted the only record that the title was
machine-generated. To recover that lost bit on load, it added `isAutoTitle(kind,
title)` — a regex (`^<Label> <digits>$`) that **reconstructs an authorship judgment
from the rendered string**. This is structurally identical to the
*"derive-state-from-projection"* anti-pattern that recurs across the whole LHS audit
(C9 derives PM positions from a stale snapshot; C19 derives anchor-state from position
alone, ignoring the card's intent flag). Here the projection is the title text and the
discarded intent flag is *"who wrote this title."*

The flaw is intrinsic and unfixable at the regex layer: the function's input
(`"Report 8"`) is **provably ambiguous** — a generated title and a user-typed one are
byte-identical, so no matcher, however careful, can separate them. `panel-registry.ts`
even documents this as the accepted spec: `isAutoTitle` is *"per-kind precise"* and the
test (`auto-title.test.ts:59`) literally pins `isAutoTitle("report", "Report 8") ===
true` as **correct**. The five load-strip sites (`useReports.ts:57`, `useArchive.ts:28`,
`useNotes.ts:38`, `useTodos.ts:30` — strips the BODY `text`, `useExamples.ts:45`) all
inherit the false-positive: any user who names a report `"Report 8"`, a note `"Note 3"`,
a todo `"Task 5"`, a snippet `"Archive Text 1"`, or an example `"Example 4"` silently
loses it on the next load. Reports (HIGH) and todos are the most human-plausible; the
todo case is the worst because it strips the user's actual **body text**, not a title.

The single underlying deficiency: **the migrator must answer "was this title
auto-generated?" and the only honest answer is recorded provenance, not inferred
shape.**

### C15 — select/jump composition

Two selection authorities for one halo. A docked card body's `onClick` composes
`ac.onActivate()` (a **monotonic** store-select: `onSelect(id)`, always sets) with a
host-supplied **toggling** `onSelect` (`selectedId === id ? null : id`). On the first
click they agree; on the *re-click* they diverge — the store stays selected, the panel
id toggles to `null`, so the halo (often sourced from `ac.selected || isSelected`)
double-sources and the keyboard/operand target silently drops (FN-F2-01 also fires a
spurious second jump). Confirmed live in `FootnotePanel.tsx`: body `onSelect` at
`:160`/`:175` toggles, `onActivateFootnote` at `:73` sets monotonically. The Search
sub-family (SR-C1-01/F2-01/F1-02) is the same disease in a different organ: Search rolls
its **own** `selectedIdx` in lifted state (`SearchPanel.tsx:60`) instead of routing
through `useCycle`, so it lacks the **read-clamp** (`useCycle` clamps on read,
`panel-primitives.tsx:2793`) and reports impossible counters ("16 of 10"). The deep
deficiency: **selection is multiply-sourced; one click feeds two stores that don't
agree on toggle vs set, and index holders bypass the one clamp helper.**

### C16 — one-way mutation / merge-vs-replace ambiguity

Two siblings: (a) a state transition with **no symmetric inverse** —
`CitationCard.tsx:384` auto-*promotes* singular→plural (`type + "s"`) when rows gain
distinct postnotes, but `removeRow`/equalize never **demote** back, so the command
strands as `\cites` with one key (CI-F5-01/F7-02; and the bibPackage toggle CI-F5-02
never re-derives the command at all); (b) **one field-merge primitive serving two
intents** — `updateBibEntry` spreads-new-over-old (a merge) but is used where a
*replace* is meant (BIB-A3-02 "Replace with library" merges; BIB-F5-04 can't delete a
field because clearing-to-blank leaves an empty merge, never a removal). The deficiency:
**a mutation that knows only one direction, and a primitive that conflates "patch some"
with "set all."**

### C24 — compressed-summary clamp gap

The shared compressed-body pipeline (`compressedBodyStyle` + `makeCompressedSummary`,
`panel-primitives.tsx:153/186`) is **bypassed or mis-fed** at the edges. Three faces:
(a) bespoke chrome that never enters the pipeline — `CitationCard` short-circuits its
own multi-row header (`:751`, CI-F1-01), `BibEntryCard`'s header wraps freely
(BIB-F1-03), so the *header line* has no clamp; (b) the empty-blank: `compressedSummary
?? <CardEmptyText/>` (`panel-primitives.tsx:1145`) — `??` **never fires on `''`** and
the cards pass `makeCompressedSummary(...) || ''`, so empty bodies render a blank line
instead of the muted "empty" sentinel (REP-F1-01, OMNI-F1-03), and `makeCompressedSummary`
hard-slices at `80*lines` chars with **no ellipsis** (OMNI-F1-03); (c) the controlled-
input desync in `CardBodyTitle` (`:591`, uncontrolled `defaultValue`, sync gated on
edit-state) so an external title write can't reach the DOM (REP-F5-04). The deficiency:
**the clamp/empty/ellipsis logic is centralized but the empty-sentinel uses `??` over a
falsy-not-nullish value, and bespoke headers route around the helper.**

### C25 — count derived from a subset of what renders

A header badge counts **one sub-list** while the panel renders the **union**.
`FootnotePanel.tsx:132` uses `footnotes.length` for the badge but `items` (`:112`)
prepends `orphanedFootnotes` — badge says "2", three cards render (FN-C1-01/F1-03). The
keyboard sibling: `useCycle(footnotes, …)` (`:85`) cycles only the anchored sub-array,
so Arrow nav skips the orphans that render at the top (FN-F2-02). BIB-A1-01 is the
two-source-of-truth flavor (sidecar `citedKeys` vs live `allEditorCitations`). The
deficiency: **count and cycle read a narrower list than the one actually rendered.**

### C26 — `\b` assumes word-char-bounded tokens

A whole-word matcher prepends/appends bare `\b` without checking word-char adjacency.
JS `\b` is a *transition* between `\w` and `\W`; a token that begins/ends with a
non-word char (`+foo`, `foo!`, a citekey with `:`/`-`) gets a `\b` that asserts at a
`\W`↔`\W` seam that never exists → zero matches or a mis-rewrite. Two live sites share
the bug: `compileQuery` (`search-sources.ts:134`, SR-F1-04) and the citekey-rewrite
regex (`useCitations.ts:308`, BIB-F7-04). Siblings SR-F1-03 (matched-span not clamped)
and SR-F1-05 (breadcrumb infers nesting from stack length, not the explicit level attr)
are the same family of *"a string helper assumes a tidy input it doesn't validate."*
The deficiency: **`\b`-bracketing with no boundary-class fallback for non-word edges.**

---

## 3. The deep solution

The theme has **one true schema change (C12)** and **five "one-helper" consolidations.**
Each is the deepest fix that *also* improves the app, contrasted below with the shallow
per-bug patch I am rejecting.

### 3A. C12 — `titleAuto` provenance flag (the schema change)

**New abstraction: record the bit, never guess it.** Add an optional boolean
`titleAuto?: boolean` to every auto-titling card schema (the *title field's
provenance*, not a second title). Semantics: `titleAuto === true` means "the displayed
title was machine-supplied and may be discarded on load / never persisted as user
content"; `false`/absent means "user-owned, never strip."

- **Creation** (the 6 create sites + `syncFromEditor` for examples): a card born
  without a user title is created with `title: ""` *and `titleAuto: true`* — OR, if we
  want the generated label to actually show (a product call; see §3A note), `title:
  nextCardTitle(...)` + `titleAuto: true`. Either way the provenance is now **data.**
- **User edit** (the title setters: `updateReportTitle`, `updateSnippetTitle`,
  `updateExampleTitle`, `useNotes` setTitle, todo `updateItem`): the moment a human
  types into the title (or todo body), set `titleAuto: false`. The card is now
  user-owned forever.
- **Load migration** (the 5 strip sites): replace `isAutoTitle(kind, title) ? "" :
  title` with a **provenance read**: `record.titleAuto ? "" : title`. The shape regex
  is gone from the load path entirely.

**New helper (replaces `isAutoTitle` at runtime):**
```ts
// panel-registry.ts
/** Decide a card's effective title on load from RECORDED provenance, with a
 *  one-time legacy fallback to the shape heuristic for pre-migration records
 *  that have no `titleAuto` bit yet. */
export function resolveLoadedTitle(
  kind: CardKind,
  title: unknown,
  titleAuto: boolean | undefined,
): string {
  if (typeof title !== "string") return "";
  if (titleAuto === false) return title;          // user-owned → keep, always
  if (titleAuto === true) return "";              // recorded generated → drop
  // titleAuto === undefined → legacy record: fall back to the shape heuristic
  // ONCE (this is the only place isAutoTitle survives), then persist the
  // resolved provenance so we never guess again.
  return isAutoTitle(kind, title) ? "" : title;
}
```
`isAutoTitle` is **retained but demoted** — it is now reachable only as the
*one-time legacy fallback* inside `resolveLoadedTitle`, for records written before this
change that carry no `titleAuto`. After the migration write-back (`persistMigrationOnLoad:
true` already in place for these sidecars), every record has an explicit bit and the
heuristic is never consulted again. The false-positive window shrinks from "every load,
forever" to "the first load of a pre-T6 record" — and even that load only mis-fires on
the identical legacy edge that BUG #31 already had, so it is strictly no worse than
today and self-heals on first write.

**How it captures the whole C12 range:** all four members (REP-A2-02, OMNI-F1-01,
REP-F5-03, EX-A2-01) are the *same* false-positive at five sites; routing every site
through `resolveLoadedTitle` + stamping `titleAuto` on edit fixes them in one move.
EX-A2-01 is latent today (the example title isn't surfaced) but the migrator runs, so
the flag must be added there too for correctness when the surface lands (T-other may
wire it).

**Beyond the bug:** the app gains a real provenance bit it never had. Downstream this
unblocks honest behaviors that the shape-guess made impossible: an AI skill can write a
*generated* report title and mark it `titleAuto: true` so the user's later rename
sticks; the "+T" affordance can show a faded placeholder for `titleAuto` titles vs solid
for user ones; future "clear to default" / "regenerate title" actions become
expressible. It also removes a class of silent data loss from the trust surface — the
single worst outcome for a writing tool.

> **Rejected shallow patch:** "tighten the `isAutoTitle` regex" (e.g. exclude numbers a
> human is likely to type, or require a creation-time marker character). This cannot
> work — the inputs are byte-identical — and every tightening trades one false-positive
> for a false-negative (a real generated title that now persists). The whole point is
> that *shape is the wrong oracle.*

> **Note for the PLAN (product call):** whether a freshly-created card shows
> `nextCardTitle(...)` ("Report 8") as a *visible placeholder* (now safe, since
> `titleAuto:true` keeps it strippable) or stays blank (`title:""`) is a UX decision.
> The schema supports both; the design defaults to **keep `title:""`** to match current
> behavior and minimize visual churn, but flags this for the PLAN.

### 3B. C15 — one selection source + route all index holders through `useCycle`

**Unify on the store as the single selection authority.** The card body click must call
**one** primitive whose toggle semantics are agreed. Two equivalent shapes; pick (i):
(i) make the panel's `onSelect` **derive from the store** (`selectedId =
cardStore.selected?.id`, no local toggle) so a re-click is idempotent — the halo and
keyboard target stay put, no spurious jump; or (ii) make `ac.onActivate` toggle to match
`onSelect`. The audit's preferred direction (FN-F2-01 root) is (i): *"drive selectedId
from the store."* For Search, **delete the hand-rolled `selectedIdx`** and route
navigation through `useCycle(results, navigateToResult)`, inheriting its read-clamp
(fixes SR-C1-01/F2-01/F1-02 — impossible counters and stale indices vanish because the
clamp is computed once on read). SR-F5-01 (cross-side activation) and OUT-F3-02
(mirror-pane caret perturbation) and EX-F3-02 (no docked jump on expanded card) are the
*"jump composition"* tail — they get a **side/parity-checked jump** (only side-activate
a target on the same rail) and a **docked jump affordance independent of the body
editor**, both small additions to the same shared select/jump wiring.

> **Rejected shallow patch:** add an `if (selectedId === id) return;` guard in each
> panel's body onClick. That patches each panel one at a time, leaves two stores, and
> re-breaks the moment a new panel copies the dual-source pattern.

### 3C. C16 — symmetric command derivation + split merge/replace

**Make the plural a pure function of state, computed both ways.** Replace the one-way
`shouldPromote ? type + "s" : type` with a single `derivePlural(baseType, rows,
bibPackage)` that returns the canonical command shape for the *current* rows — promotes
when ≥2 rows have distinct postnotes AND the package is biblatex, **and demotes** (`type`
without trailing `s`) otherwise. Call it from **every** mutation that changes rows or
package (`setRowPostnote`, `removeRow`, `addRow`, and on bibPackage toggle) — so the
command can never strand (CI-F5-01/F7-02), and a package switch re-derives every card's
shape (CI-F5-02). It also dedups rows by citekey at the one derivation point (CI-F5-03).
For the field primitive, **split `updateBibEntry` into `mergeBibFields` (patch some) and
`replaceBibEntry` (set all)** — "Replace with library" calls `replaceBibEntry`
(BIB-A3-02), and the inline editor gains an explicit "remove field" that calls a
delete-aware path (BIB-F5-04). The tri-state bib-review status (BIB-F5-05) gets a
distinct "complete" rendering rather than collapsing to binary.

> **Rejected shallow patch:** add a `removeRow`-only demote branch. It fixes CI-F5-01
> but not the bibPackage toggle (CI-F5-02) or the next mutation that forgets to demote;
> a derived-shape function makes the invariant unforgeable.

### 3D. C24 — fix the empty-sentinel + route bespoke headers through the clamp

Three coordinated edits to the **shared** pipeline so every consumer benefits:
1. Change `compressedSummary ?? <CardEmptyText/>` to `compressedSummary || <CardEmptyText/>`
   (or, cleaner, have `makeCompressedSummary` return `undefined` on empty and have
   callers pass `|| undefined` instead of `|| ''`). One edit, fixes REP-F1-01 +
   OMNI-F1-03's empty-blank across notes/archive/footnote/revision cards.
2. Add a trailing ellipsis when `makeCompressedSummary` truncates (OMNI-F1-03's
   mid-word cut).
3. Add a per-line **header** clamp class so bespoke headers (`CitationCard` multi-row,
   `BibEntryCard` long title) stay one line collapsed (CI-F1-01, BIB-F1-03) — and make
   `CardBodyTitle` a **controlled** input keyed on its value so external title writes
   reach the DOM (REP-F5-04).
   The EX-F1-01/EX-F1-02 members are **by-design** (grid-content clamp ceiling /
   collapsed≡expanded editor parity, both adjudicated COSMETIC) — see §6.

> **Rejected shallow patch:** special-case `''` in each card's render. The `??`-vs-`||`
> fix at the single sentinel site is the whole class.

### 3E. C25 — count and cycle the rendered union

`FootnotePanel` already builds the merged `items` array (`:112`). Make the badge
`count={items.length}` (or `footnotes.length + orphanedFootnotes.length`) and build
`useCycle` over `items` (mapped to ids), not over `footnotes` alone — one change fixes
FN-C1-01, FN-F1-03 (count) and FN-F2-02 (keyboard) together. BIB-A1-01 collapses the
two cited-state sources to one (derive cited-ness from the live editor citations, the
same source the jump uses). CI-C1-01 is **by-design** (the strip count intentionally
reflects all cards including unanchored) — see §6.

> **Rejected shallow patch:** `count={footnotes.length + orphanedFootnotes.length}`
> only. Correct for the badge but leaves the keyboard cycle desynced; cycling `items`
> fixes both from the same array.

### 3F. C26 — a boundary-aware whole-word builder

Add one shared helper `wholeWordPattern(escaped)` that brackets with `\b` **only on
edges that are word-chars**, and uses a lookaround/`(?<!\w)…(?!\w)` style guard
otherwise — so `+foo`/`foo!`/`a:b` match. Both live sites (`compileQuery`
`search-sources.ts:134` for SR-F1-04, and the citekey-rewrite `useCitations.ts:308` for
BIB-F7-04) call it. SR-F1-03 clamps the matched `<mark>` span length (snippet renderer);
SR-F1-05 builds the breadcrumb from the explicit heading `level` attr, not the running
stack length. These are independent one-liners in the same "string-helper assumes tidy
input" family — bundled because they share the Search snippet/breadcrumb code path.

> **Rejected shallow patch:** drop whole-word for punctuation queries. That silently
> changes match semantics; the boundary-class builder keeps whole-word honest.

---

## 4. Data-model / schema / sidecar changes + migration

### Schema additions (the only schema change in the sweep)

Add **`titleAuto?: boolean`** to:

| Type | File | Notes |
|---|---|---|
| `ReportCard` | `src/lib/types.ts:126` | title field exists |
| `ArchivedSnippet` | `src/lib/types.ts:163` | title field exists |
| `TodoItem` | `src/lib/types.ts:180` | provenance applies to `text` (the body label) |
| `UserNote` | `src/lib/types.ts:407` | title field exists |
| `ExampleRef` | `src/lib/types.ts:363` | latent surface, but migrator runs |

`ReportRequestCard` has no title field → no flag needed. `HighlightCard` and the
null-`titleLabel` kinds (citation/comment/suggestion/ai/bib/error) are unaffected.

Optional but recommended for C16: a discriminated field-update is a **code** change, not
a schema change — `BibEntry.fields` stays `Record<string,string>`; deletion is honored
by `replaceBibEntry` writing the full map.

### Migration (versioned, back-compat)

The five sidecars (`reports.json`, `archive.json`, `notes.json`, `todos.json`,
`examples.json`) already migrate on load via `usePersistentState` `migrate(raw)` +
`persistMigrationOnLoad: true` (examples migrates inline in its own effect). The
migration is **forward-only and self-stamping**, requiring no version counter on the
file:

1. On load, for each record: if `titleAuto === undefined` (a pre-T6 record), compute it
   **once** via the legacy shape heuristic — `titleAuto = isAutoTitle(kind, storedTitle)`
   — and set `title` accordingly. This is exactly today's behavior for the legacy edge,
   so **no existing paper regresses** relative to current main.
2. `persistMigrationOnLoad: true` writes the now-stamped record back to disk, so the
   guess happens at most once per record, ever.
3. After that write, the record has an explicit bit and `resolveLoadedTitle` returns
   early — the shape heuristic is permanently retired for that record.

**Back-compat guarantees:**
- A pre-T6 paper opened in a T6 build: behaves identically to current main on first
  load (legacy heuristic), then self-heals. No data loss vs today.
- A T6-written paper opened in a **pre-T6** build (downgrade): the old build ignores
  the unknown `titleAuto` field and re-runs `isAutoTitle` — i.e. it falls back to
  today's (buggy) behavior. Acceptable: downgrade is rare and degrades to the *current*
  state, never worse.
- No file-format version bump is needed because the new field is additive and the
  migration is idempotent + self-stamping. (If the PLAN prefers an explicit sidecar
  `schemaVersion`, it can be added uniformly, but it is not required for correctness.)

---

## 5. Files

### Created
- `src/lib/whole-word.ts` (or co-located in `search-sources.ts`) — `wholeWordPattern()`
  shared boundary-aware builder (C26). *(Single new module; small.)*

### Modified — C12 (auto-title)
- `src/lib/types.ts` — add `titleAuto?` to the 5 types.
- `src/panels/panel-registry.ts` — add `resolveLoadedTitle()`; demote `isAutoTitle` to
  internal-fallback-only (keep exported for the test + the fallback).
- `src/hooks/useReports.ts` — migrators (`migrateReportRecord:57`) → `resolveLoadedTitle`;
  create (`addReport:147`) + `updateReportTitle:205` stamp `titleAuto`.
- `src/hooks/useArchive.ts` — `migrateSnippet:28`, `archiveContent:55`, `updateSnippetTitle:78`.
- `src/hooks/useNotes.ts` — `migrateNote:38`, create `:116`, setTitle `:224`.
- `src/hooks/useTodos.ts` — `migrateTodo:30` (body `text`), create `:60`, `updateItem:79`.
- `src/hooks/useExamples.ts` — load strip `:45`, `syncFromEditor:119`, `updateExampleTitle:68`.
- `src/panels/__tests__/auto-title.test.ts` — update the source-guard + add provenance cases.

### Modified — C15 (select/jump)
- `src/components/panel-primitives.tsx` — shared card body select wiring; ensure halo
  single-sourced from store; `useCycle` reuse.
- `src/panels/Footnotes/FootnotePanel.tsx` — body `onSelect:160/175` semantics, cycle source.
- `src/panels/Citations/CitationsPanel.tsx`, `src/panels/Examples/ExampleCard.tsx` — same.
- `src/panels/Search/SearchPanel.tsx` — delete `selectedIdx` state, route via `useCycle`;
  side-parity check for cross-rail activation (SR-F5-01); docked jump (EX-F3-02).
- `src/panels/Outline/OutlinePanel.tsx` — mirror-pane jump without shared-selection
  perturbation (OUT-F3-02).

### Modified — C16 (citation command / bib fields)
- `src/panels/Citations/CitationCard.tsx` — `derivePlural()` called from all row/package
  mutations (`setRowPostnote:371`, `removeRow:393`, `addRow:405`, package toggle).
- `src/hooks/useCitations.ts` — split `updateBibEntry` → `mergeBibFields` + `replaceBibEntry`.
- `src/panels/Bibliography/BibliographyPanel.tsx` / `src/components/BibEntryCard.tsx` —
  "Replace with library" → replace; inline editor field-delete; tri-state status render.

### Modified — C24 (compressed clamp)
- `src/components/panel-primitives.tsx` — empty sentinel `??`→`||` at `:1145`; ellipsis
  in `makeCompressedSummary:186`; header per-line clamp; `CardBodyTitle:591` controlled.
- `src/panels/Citations/CitationCard.tsx` — route the multi-row header through the clamp.

### Modified — C25 (counts)
- `src/panels/Footnotes/FootnotePanel.tsx` — `count={items.length}` `:132`; cycle over `items` `:85`.
- `src/panels/Bibliography/BibliographyPanel.tsx` — single cited-state source (BIB-A1-01).

### Modified — C26 (regex)
- `src/lib/search-sources.ts:134` — `compileQuery` uses `wholeWordPattern`.
- `src/hooks/useCitations.ts:308` — citekey rewrite uses `wholeWordPattern`.
- `src/panels/Search/SearchPanel.tsx` — clamp `<mark>` span (SR-F1-03); breadcrumb from
  `level` attr (SR-F1-05, `buildBreadcrumb:116`).

---

## 6. Bugs resolved + out-of-scope members

**Resolved (30 ids):**
- C12: REP-A2-02, OMNI-F1-01, REP-F5-03, EX-A2-01
- C15: CI-F2-01, EX-F2-01, FN-F2-01, SR-F1-02, EX-F2-02, EX-F3-02, OUT-F3-02, SR-C1-01, SR-F2-01, SR-F5-01
- C16: BIB-A3-02, BIB-F5-04, CI-F5-01, CI-F5-02, CI-F7-01, CI-F7-02, BIB-F5-05, CI-F5-03
- C24: REP-F5-04, BIB-F1-03, CI-F1-01, OMNI-F1-03, REP-F1-01
- C25: BIB-A1-01, FN-C1-01, FN-F1-03, FN-F2-02
- C26: BIB-F7-04, SR-F1-03, SR-F1-04, SR-F1-05

**In-scope-by-class but NOT fixed (adjudicated by-design / won't-fix):**
- **EX-F1-01** [COSMETIC] — the grid-content line-clamp ceiling is the intended compact
  preview; "fixing" it means a kind-specific preview height, out of the shared-helper
  scope.
- **EX-F1-02** [COSMETIC] — collapsed≡expanded editor parity (#43) is a deliberate prior
  decision; not a clamp bug.
- **CI-C1-01** [COSMETIC] — adjudicated *"not a defect mechanism"*; the strip badge
  intentionally counts all cards. Left as-is.
- **CI-F7-01** overlaps **C18** (delete-confirm via `cardHasContent`) — the *postnote/
  has-content confirm* half is C18's territory (T-other). T6 fixes only the **command-
  shape demote** half of CI-F7-01/F7-02. Flag for the PLAN to assign the confirm half.

**Notes on partial coverage:** BIB-F5-04's *"add a new field"* affordance is a UI
addition that may belong to a UI-surface theme (C7/T-other); T6 supplies the
delete-honoring `replaceBibEntry` primitive it needs. BIB-F5-02 (out-of-band sidecar
refresh) is **C17, not this theme** — do not expect T6 to make a skill-written
annotation reappear live.

---

## 7. Keystroke-sanctity + test impact

### Invariants touched
- **No new per-keystroke doc-walk.** C12 touches only sidecar load/create/edit paths —
  none on the keystroke path. C15/C25 read counts/lists already derived; `useCycle`'s
  read-clamp is O(1). C16/C24/C26 are event-handler/render-time only. **Nothing here
  subscribes to `editor.on('update')` or walks the doc per transaction**, so the
  AGENTS.md keystroke-sanctity sweep is untouched. Verify with `window.__virgilBusStats()`
  (emitCount flat on plain typing) after C15's FootnotePanel change, since the panel
  re-derives `items` — but that memo is already gated on the structural revisions, not a
  raw update counter, and we only widen what it counts/cycles, not when it recomputes.
- **C25 cycle source** must keep its gating on the same structural counters
  (`useStructuralRevisions`) the current `items` memo uses — do not introduce a
  `docVersion` counter to refresh the count.

### New tests
- **C12 (highest value):** extend `auto-title.test.ts` —
  (a) `resolveLoadedTitle`: `titleAuto:false` keeps `"Report 8"`; `titleAuto:true`
  drops it; `titleAuto:undefined` falls back to `isAutoTitle` (legacy parity).
  (b) Round-trip: create with `titleAuto:true` → user edits title → `titleAuto:false`
  persists → reload keeps the user's `"Report 8"`. **This is the regression-proof the
  HIGH bug demands.**
  (c) Migration idempotence: a pre-T6 record migrates once, self-stamps, second load
  reads provenance.
- **C16:** `derivePlural` round-trips (promote on distinct postnotes, demote on equalize/
  remove/package-switch); `replaceBibEntry` honors a field deletion that `mergeBibFields`
  would not.
- **C26:** `wholeWordPattern` unit tests for `+foo`, `foo!`, `a:b`, plain `foo`.
- **C25:** FootnotePanel count == rendered item count with orphans present; cycle visits
  orphans.
- **C15:** re-click idempotence (halo stays, no second jump); Search counter never
  exceeds total after list shrink.

### Existing tests likely affected
- `auto-title.test.ts` — the source-guard (`:186-202`) asserts migrators **contain**
  `isAutoTitle`; after T6 the load path calls `resolveLoadedTitle` (which *imports*
  `isAutoTitle`). Update the guard to assert `resolveLoadedTitle` (and that creation
  sites still don't call `nextCardTitle`). The positive/negative `isAutoTitle` cases
  stay valid (the function is unchanged, just demoted).
- Any snapshot test asserting a collapsed-card empty body is blank (C24 sentinel change
  now shows "empty").

---

## 8. Cross-theme dependencies & ordering

- **Shared file `src/hooks/useCitations.ts`** is touched by T6 (C16 split + C26 regex)
  **and by T1** (C1 rename chokepoint `updateBibKeyAndType`, C6 export-via-serializer).
  T6's C26 edit is *inside* `updateBibKeyAndType:308` — the same function T1 extends. **T1
  and T6 will collide here; the PLAN must sequence them (recommend T1 first, then T6
  rebases the `\b`→`wholeWordPattern` swap onto T1's expanded migrator), or co-assign the
  function.**
- **Shared file `src/components/panel-primitives.tsx`** — T6 (C15 select wiring, C24
  clamp) overlaps any theme touching the shared card body. The C15 select-source change
  intersects **T1/T2's card/citation identity+anchor model**: *if* T1/T2 introduce a
  stable surrogate id and re-key selection on it (their C1 fix locus), then C15's "single
  selection source" must read **that** id, not the mutable one. **Assumption stated for
  the PLAN: T1 and T2 share the card/citation identity+anchor model; T6's C15 fix assumes
  selection is keyed by whatever stable id T1/T2 settle on, and defers the key choice to
  them.** T6 does not itself change the selection *key*, only the *toggle/set semantics*
  and the *number of sources* — so the two changes compose, but should land **after** T1/T2
  fix the key, to avoid re-touching the wiring twice.
- **C18 overlap (CI-F7-01):** the delete-confirm half is C18 (T-other); T6 does the
  command-demote half. No file collision (`cardHasContent` is C18's; `CitationCard`
  command logic is T6's) but the PLAN should note the split ownership of that id.
- **Search (`SearchPanel.tsx`)** — T6 (C15/C26) overlaps **C9/C11** (search position
  staleness + migration-orphan jump). T6 deletes `selectedIdx`; C9/C11 fix the position
  source. These are *different* lines in the same file; recommend **C9/C11 (the HIGH
  search-jump fix) lands first**, then T6's `useCycle` swap rebases on the working jump.

**Ordering recommendation:** T1 → T2 → (C9/C11 search) → **T6**. T6 is mostly leaf
consolidations; landing it last lets it adopt the stable ids and working jumps the
earlier themes establish.

---

## 9. Risk + rollout

**Overall risk: LOW–MEDIUM.** The bulk of the theme is COSMETIC/LOW one-helper
consolidations. The one elevated risk is the **C12 schema migration touching five
persisted sidecars** — a botched migrator could strip a real title (the exact data loss
we're fixing). Mitigations make this safe:

- **Incremental, per-class.** Each of the six classes is independently shippable and
  independently revertable. Recommended landing order within the theme: **C26 →
  C24 → C25 → C16 → C15 → C12** (cheapest/lowest-blast-radius first; the schema change
  last, after the test harness around it is proven on the cheaper classes).
- **C12 de-risking:**
  - The migration is **strictly no-worse-than-today** on first load (legacy fallback ==
    current behavior) and self-heals — so a pre-T6 paper can't regress.
  - `persistMigrationOnLoad` already writes back; verify the write actually lands (the
    `resolveHandle` race noted in `usePersistentState.ts:100`) before relying on
    self-heal — but even if the write is skipped, every subsequent load re-runs the
    *same* idempotent fallback, so correctness doesn't depend on the write succeeding.
  - **No feature flag needed** because of the no-worse-than-today property; but if the
    PLAN wants belt-and-suspenders, gate the *strip* (return `""`) behind a flag and ship
    the *stamp* (write `titleAuto`) unconditionally first — that backfills provenance on
    real papers for a release before any strip behavior changes.
  - Use the frozen sample (`samples/annotation-history`) which exercises reports/notes/
    todos/archive/examples to smoke-test the round-trip live.
- **Downgrade safety:** verified additive-field tolerance (old build ignores `titleAuto`,
  degrades to current behavior).

Not a big-bang. No data backfill job — migration is lazy-on-load.

---

## 10. Implementation checklist (ordered, individually verifiable)

**Phase A — leaf consolidations (cheap, no schema):**
1. `wholeWordPattern()` helper + unit tests (C26). Swap `compileQuery:134` and
   `useCitations.ts:308`. *Verify:* search `foo!` whole-word matches; rename citekey
   `+foo`→`bar` rewrites in-text.
2. Clamp `<mark>` span (SR-F1-03) + breadcrumb from `level` (SR-F1-05). *Verify:* paste a
   long query; skip-level breadcrumb.
3. C24 empty sentinel `??`→`||` (`panel-primitives.tsx:1145`) + ellipsis in
   `makeCompressedSummary` + header clamp class + `CardBodyTitle` controlled. *Verify:*
   empty footnote shows "empty"; long bib title stays one line collapsed; external title
   write reaches the input.
4. C25 FootnotePanel `count={items.length}` + cycle over `items`; BIB-A1-01 single
   cited-source. *Verify:* badge == rendered count with orphans; Arrow nav hits orphans.

**Phase B — command/field semantics (C16):**
5. `derivePlural()` + call from all row/package mutations in `CitationCard`. *Verify:*
   promote then equalize → demotes; package toggle re-derives.
6. Split `updateBibEntry` → `mergeBibFields` + `replaceBibEntry`; wire "Replace with
   library" → replace; inline field-delete; tri-state status. *Verify:* replace drops
   local-only fields; clearing a field removes it.

**Phase C — selection unification (C15, after C9/C11 search lands):**
7. Single selection source in shared card body (halo from store; idempotent re-click).
   *Verify:* re-click footnote — halo stays, no double-jump.
8. Delete Search `selectedIdx`; route through `useCycle`; side-parity + docked jump.
   *Verify:* counter never exceeds total; same-rail activation doesn't replace Search.

**Phase D — the schema change (C12, last):**
9. Add `titleAuto?` to the 5 types (`types.ts`).
10. Add `resolveLoadedTitle()`; demote `isAutoTitle` to internal fallback.
11. Update all 5 migrators to `resolveLoadedTitle`; all create sites to stamp
    `titleAuto:true`; all title/body setters to stamp `titleAuto:false` on user edit.
12. Update `auto-title.test.ts` (source-guard + provenance round-trip + migration
    idempotence). *Verify:* create report → rename to "Report 8" → reload → title kept;
    legacy "Report 8" record → migrates once → self-stamps.
13. Live smoke-test on `samples/annotation-history` (refresh dev doc, type a numbered
    title in each kind, reload, confirm survival).
