<!-- last-verified: aea05929 2026-09-20 -->
<!-- derives-from: AGENTS.md#laws -->

# A registry earns its name by being read

> **A table that declares per-kind behaviour is an SSOT only if something READS it. A published export is alive only if something CALLS it — and a re-export is not a caller.**

This is the "dead SSOT" class (task 202), and it is worse than having no table at all: the next agent reaches for the declared path believing it is the enforced one. `src/links/` was a phased migration whose read half landed and whose write half never did. `createLink` + its three kind builders sat exported with **zero callers for three months** while real footnote/citation creation went through the atom commands and real anchors through `createLinkedAnchor`. `LINK_REGISTRY` announced itself as "the single source of truth for the Link taxonomy" and no component or hook read it: its `connectorStroke` styled a `<LinkConnector>` hard-deleted in `96675ca1`, its `multiplicity: "one"` was "enforced at runtime in `createLink`" by an `enforceMultiplicity` nobody invoked (and would not have helped: 1:1 holds by construction at CREATE time, since each link mints its own target card id, but nothing re-mints on an in-document copy/paste of an atom — so deleting the unreachable enforcer costs nothing, while calling the property *enforced* would have been a second false claim), and its `cardKind` column was decided in `collectLinksFromEditor`. Two more files said "Phase 0: stub" in the present tense.

**The mechanism that hid it was the barrel.** `links.ts` re-exported the whole subtree, so `enforceMultiplicity`, `LINK_REGISTRY`, `resolveCardKind` and `resolveLinkPanel` each had a "reference" in `src/` and every grep a reviewer would run came back green. So the census in [src/links/\_\_tests\_\_/link-surface-honesty.test.ts](../../../src/links/__tests__/link-surface-honesty.test.ts) strips `export { … } from "…"` clauses — and string literals, since the dead `createLink`'s own throw message (`` `createLink: kind "…" not supported.` ``) was otherwise its only "caller". Imports are deliberately kept (an unused import is a lint error, so an import really is a use). Scope is `src/links/**` value exports; the allowlist is **empty**, and an entry there must justify why a symbol earns its keep with no caller — WIRE it or DELETE it.

What survived the cut is the half that ships: the `LinkKind` union in [src/links/\_shared/types.ts](../../../src/links/_shared/types.ts) is the taxonomy (a union with a doc comment, not a parallel table), and [src/links/link-dom-contract.ts](../../../src/links/link-dom-contract.ts) owns the marker DOM contract — `data-link-id` / `data-link-kind` / `data-link-card` plus the `<cardKind>:<cardId>` grammar. Deleting alone would have left the live half as loose as the dead half was, so the same commit made it load-bearing: **every marker producer emits the attribute names from those constants** (`linked-anchor-attrs.ts`, `footnote.ts`, `citation.ts`, and the drop-mode ghost's clone list, which must mirror them), and **nothing spells a `<cardKind>:<cardId>` token by hand, emitting or querying** — `linkCardKey`/`parseLinkCardKey` do. That second rule is the one with reach: a QUERY that restates the grammar (`[data-link-card="citation:${id}"]`, five sites) breaks by silently not matching, with no type error and nothing to grep. A CSS selector — and a JSX attribute, which has no computed-name syntax — may still write the attribute NAME inline; `globals.css` has no other option.

The prose half is guarded too: no file under `src/links/**` may promise an unbuilt phase ("Phase 2 wires this up", "not yet wired"; lettered phases count, since this subsystem numbers as many with a letter as a digit). A note about what a phase *did* is fine and common. As with every copy check, the regex pins the SHAPE of the promise; only a reader pins whether a sentence is honest.

**Two limits worth knowing before you trust it.** The call census is a bare-name grep with no module resolution, so a dead export whose name collides with a live symbol anywhere in either silo still reads alive — a distinctive name is the only thing standing between a future scaffold and a silent exemption. And `VALUE_EXPORT` reads the `export function|class|const|let NAME` forms only, so `export default`, a bare `export { local }` re-publication, and a destructured `export const { a, b } =` are not censused declarations. Both are known holes with a filed follow-up, not oversights — a guard that overstates its own reach is the failure mode this whole section is about. What the census DOES enforce, it enforces exactly: a suite is not a consumer (`callSites` splits test hits from real ones, because on the pre-fix tree the deleted `cardKindToLegacyAnchorKind` reported fourteen callers, every one of them its own test), and both barrel spellings are stripped — the one-statement `export { X } from "…"` and the split `import { X } … export { X };` that is already the idiom in this very directory.

### The stored-copy half: a LIVE answer is never frozen into a record

Same law, other tense (task 205). "Which side does this card's margin chrome live on?" is a function of where the owning panel is docked **right now** — and it had three hand-maintained answers plus two consumers, only one of which was dock-aware. The marginalia grid resolved `override > panelSides[panelId] > row default` per pass and FOLLOWED the dock; the Mode-A anchor **rail** read `link.anchor.margin.side`, a value frozen into the sidecar at create time by `inferMarginSide` — a hardcoded `report|report-request → left, default → right` switch whose own docstring claimed to read the panel registry and never did. Nothing refreshed the stored side, ever. So docking Notes / Todo / Revisions / Cutter to the LEFT (or Reports RIGHT) put the marker on one edge and the kind-colored rail on the other, against `globals.css`'s own stated intent ("a kind-colored vertical line on the same side as the margin marker"). It read as latent for a year because the two tables agree on every *default*; the bug is that one of them ignores the *dock*.

> **A value that is a live function of app state is resolved at READ time from one authority — never computed once and stored on the record.** A stored copy cannot be wrong at write time and cannot be right afterwards; it drifts silently, and the surface that reads it disagrees with the surface that recomputes.

[src/lib/margin-side.ts](../../../src/lib/margin-side.ts) is that authority: `resolveMarginSide(panel, panelSides, override?)` with `marginSideForMarkerType` / `marginSideForCardKind` as the two keyed doors, and the DEFAULT derived from `PANEL_REGISTRY[panel].defaultStripSide` rather than restated. Both consumers call it with the same live dock map (`EditorPane`'s `marginaliaPanelSides`, already the map `<Marginalia>` packs against — a `useMemo` over the placement list, so threading it into the reconciler adds no per-keystroke and no per-render work). Three rules it earned:

- **Delete the stored copy; don't merely align it.** `anchor.margin` is gone from the `Link` type, from every site that wrote it (four in `links.ts`, the two synthesized Mode-B links, the migrator's carry-forward, the two reconciler rebuilds, and the agent-side `create_card.py`) and from its one reader. Leaving it written-but-unread would be the dead-SSOT failure above, one file over: the next agent reaches for `link.anchor.margin.side` believing it is the side. Legacy sidecars still carrying the key keep it until something rewrites their link: the migrator's canonical branch is a pass-through, but the load-time anchor reconciler REBUILDS the anchor object in its two relocating branches (`resolve-card-anchor.ts` hybrid-cleanup and `relocateBySnapshot`) and persists the result, so the key does quietly disappear there. Harmless — nothing reads it — but worth saying accurately rather than claiming disk is untouched. The agent-side writer is included in the delete: `editor/scripts/create_card.py` no longer emits the key, and its `--margin` flag is now an explicitly-documented no-op (kept only so a stale skill bundle doesn't crash on an unrecognized flag) with every skill that taught it updated.
- **A derived column that nothing reads is still dead.** Deriving `MARKER_META[t].defaultSide` from the registry was the first cut — and once the grid asked `marginSideForMarkerType` instead, the column was written by `meta()` and read by nobody. It is deleted too: the default lives once, on `PANEL_REGISTRY`.
- **Say which question a shared table is answering.** `defaultStripSide` serves two: *where does this card's margin chrome paint* (this SSOT) and *where does this panel's STRIP dock/open* (five placement sites, which disagree among themselves on the last-resort fallback for the one null-sided panel — a real latent fork, filed separately, deliberately untouched here because it decides where a pod opens, not where chrome paints).

The same task retired the marginalia builder's second orphan formula: the re-pin dock flag was `resolveCardAnchor(…).source === "orphan"`, a parallel path to `resolveAnchorState` that structurally could not see a card's declared intent. It now asks the SSOT (`state !== "anchored"` — the margin's question is binary, expressed *on top of* the SSOT rather than beside it), and `resolveAnchorState`'s witness parameter admits a uuid as well as a position, since being `number`-only is exactly why this surface couldn't call it. CI: [src/lib/\_\_tests\_\_/margin-side-ssot.test.tsx](../../../src/lib/__tests__/margin-side-ssot.test.tsx) — the defect-catching leg drives the REAL reconciler against a REAL editor under a left-docked Notes panel and asserts the rail's `data-margin-side` equals the grid's marker side (it fails on the pre-fix read); the census legs pin `src/` + `library/` free of `anchor.margin`, `inferMarginSide`, `MarkerMeta.defaultSide`/`panelId`, any `source === "orphan"` comparison, and any `defaultStripSide` read outside the SSOT and the named strip sites — plus a THIRD root, `editor/`'s Python writers and skill markdown, which the two-silo habit does not reach and where a fifth `margin` writer survived this task's own first cut. Two of those legs earned their own repairs under review: the `orphan` needle must run against comments-stripped source (the code-only stripper blanks the very literal it greps for, so the leg was unfalsifiable), and the stripper is a one-pass SCANNER rather than a regex chain — chained template-then-string stripping let a backtick inside a double-quoted string swallow 7 kB of a real production file, the task-202b runaway, which a declaration-count self-check now pins.

#### The derived-column half: 205's ladder reached two surfaces out of three

Same law, same question, one surface further (task 381) — and the case where the
derivation existed, was correct, and had exactly one consumer: the chrome that
decorates the answer, never the thing being placed.

A panel has ONE side. Task 205 established the ladder for MARGIN chrome
(`placements[].side ?? defaultStripSide`) and two other surfaces kept their own
answers. The strip-item filter inlined the ladder verbatim (harmless, a third
copy). The OMNI COLUMN did not derive at all: which column a category's cards
rendered in came from `prefs.omniCategories[side]` — stored per-side
enabled-category lists, seeded once from a `registry.omniSide` column and
re-derived by nothing. So dragging a panel's strip icon across moved its markers
and its rail (205's ladder) and left its omni cards in the old column, which in
Gabriel's own stored state additionally hides all cards, so they vanished
outright.

**The derivation that answers the right question already existed.**
`deriveCategorySides(placements)` shipped with the filter menu and its ONLY
consumer was the menu's chip list: it decided which rows a strip's filter
offered while the CARDS beside it read the stored table. A half-consumed SSOT —
the task-273 "a helper only SOME siblings call is not an SSOT" shape, in the
form where the sibling that skipped it is the one the user looks at.

> **One side fact per panel: `defaultStripSide` is the default,
> `placements[].side` is the user's live choice, and everything downstream —
> strip icon, margin marker, anchor rail, omni COLUMN, filter chips — DERIVES
> from [`@/lib/panel-side`](../../../src/lib/panel-side.ts) (`resolvePanelSide` /
> `panelSidesFromPlacements`). `margin-side` is the card-chrome DOOR onto that
> leaf, not a second ladder.**

Six rules it earned:

- **The stored copy is DELETED, not merely aligned** (205's own rule, applied to
  its remaining surface). `registry.omniSide` and `DEFAULT_OMNI_CATEGORIES` are
  gone; `prefs.omniCategories` — a pair of per-side lists carrying BOTH side and
  visibility — became `omniHiddenCategories`, side-free. Leaving the side half
  written-but-unread is how the next reader concludes the column is stored.
- **Stored as HIDDEN, not enabled**, so a newly omni-eligible panel is visible by
  DECLARATION: no default list to keep in step with the registry, and nothing to
  migrate when one ships. The two facts are combined in exactly one place
  (`omniCategoriesForSide`), read by both hosts — the main app and the Reader,
  whose own `READER_CATEGORY_SIDES` was a third hand-built map of registry
  defaults sitting beside cards that read the stored lists.
- **A side-free fact takes no `side` argument.** `toggleOmniCategory(cat)` lost
  its side parameter rather than keeping it and ignoring it — a defaulted or
  vestigial argument is a decision nobody made, and the filter menu only ever
  lists categories the side already owns. `resetOmniSide(side)` keeps its side
  because the AFFORDANCE is per-menu; what it resets is visibility, since side
  membership is derived and has no default to restore.
- **`omniHideAllCards` stays per-SIDE, and the suite says why.** It describes a
  COLUMN ("show nothing in this gutter"), not a category, so it has no panel
  whose placement it could derive from — pinned so a later sweep does not fold it
  into the side-free set by symmetry.
- **A shipped default change is INERT without a migration, and worse than inert
  with the cron.** `loadPrefs` merges `DEFAULT_PREFS.placements` only for ids the
  blob is MISSING, so flipping `reports` to RIGHT (Gabriel's ask) reaches nobody
  who has ever opened the app — and the Tue/Fri promote-defaults cron folds the
  personal snapshot's `placements` back over the shipped JSON, so a
  defaults-only flip is UNDONE on the next tick (task 326's aiMarker shape).
  [`PANEL_SIDE_MIGRATIONS`](../../../src/hooks/panel-side-migrations.ts) is the one-shot
  that makes it durable: once the stored value says right, the snapshot folds
  right and the cron converges.
- **A side flip is not idempotent by construction, so it carries an ID.** A
  RENAME is self-cancelling (the retired id is gone); a side flip is not — the
  user may deliberately drag the panel back, and a migration that re-applied
  every load would silently undo that forever. The id is recorded in
  `appliedPrefMigrations`, a GLOBAL pref (because `placements` is global — a
  per-window marker lets every other window re-apply the flip), and the
  no-stored-state branch records every migration as applied, or the newest user
  is the one "a deliberate drag sticks" fails for. The `from` side is part of the
  match, so a user who had already moved the panel is untouched.

The legacy per-side blob folds once at load (`hiddenFromLegacySides`: absent from
BOTH stored sides ⇒ hidden) and the key is then `delete`d, so it cannot
round-trip and re-fold over a hide/show made in between. `rename-panel-id` gained
a `LEGACY_ID_CARRIERS` list for it — a carrier the live `ViewPrefs` type no
longer has, which the type-derived census structurally cannot name, the same
reason `LEGACY_ACTIVE_PANEL_KEYS` exists — so a pre-381 blob's `comments`
becomes `revisions` BEFORE the fold reads it, rather than folding to "revisions
was never enabled". `filterOmniCategories` went with the carrier: it had no
production caller once the fold landed, and a suite is not a consumer (task 202).

CI: [card-side-derivation.test.ts](../../../src/lib/__tests__/card-side-derivation.test.ts)
sweeps every omni panel × {all-left, all-right, unplaced} and asserts the strip,
the rail, the marker and the omni column give ONE answer — with a counter proving
the sweep crossed configurations where the RETIRED stored rule genuinely
disagrees, so it cannot pass by the two answers being trivially equal. Its defect
legs reimplement the retired rule locally rather than re-parameterising the live
one. The leg with teeth is the CENSUS: the derivation was never the part that
could misbehave — a surface reading a stored per-side list is, and
`prefs.omniCategories[side]` type-checked perfectly — so `omniSide` and
`DEFAULT_OMNI_CATEGORIES` are pinned dead, the surviving `omniCategories`
mentions are allowlisted per NAME with their reason (both halves asserted, so a
stale entry cannot pre-authorize a real read), and every omni HOST is DISCOVERED
from its own `getOmniEnabled` derivation and required to enter the shared door.
[view-prefs-side-migration.test.ts](../../../src/hooks/__tests__/view-prefs-side-migration.test.ts)
drives the REAL `loadPrefs` for the halves neither can see: that the loader
applies the migration BEFORE the default merge, and folds the legacy key exactly
once. Measured by neutering each half in turn — restoring the stored-list column
takes 2 legs, restoring the pre-381 FORK (chips derive, cards do not) 2 more,
dropping the loader's migration 3, dropping the legacy fold 1, reverting the
registry flip 4 and the defaults-JSON flip 2, and hand-intersecting in one host 1.

**Owed, not claimed:** the preview eyeball. This class is NOT FSA-masked (view
prefs work in the dev preview), so the check is cheap and real — Reports on the
right rail by default, its markers and rail on the right, its omni cards in the
right column, and dragging ANY panel's strip icon across moving its cards with it.

#### The subscription half: every RENDERER of a live value subscribes

Same law, the half 205 and 381 both PRESUPPOSE (task 493) — and the case where
the read was live, the derivation was right, the comment said "override-aware",
and the subscription did not exist.

A card kind's accent is painted by FIVE renderers. Four re-derive the moment the
user picks a colour in a panel's picker: the docked card (`useCardTheme` →
`useSyncExternalStore`), the margin marker, the in-text anchor (an effect keyed
on `getPanelColorVersion`), and the highlight band (pure CSS off the anchor
accent var). The fifth — a popped-out card float — did not. `cardFloatable`
computed `headerTint` / `accentTint` with
`themeFromAccent(getPanelColor(CARD_REGISTRY[kind].themeKey))` and BAKED the
hexes onto the `Floatable`, and nothing in
`FloatHost → FloatWindow → FloatChrome → FloatingPanel` subscribed to the store.
`EditorPane` is `memo()`'d with no prop derived from panel colours, so a swatch
click caused **no render anywhere in that subtree**: the open float kept the old
header strip and the old window ring while everything else re-tinted — two
colours for one card in one window. It self-healed on the next unrelated
`EditorPane` render (a keystroke, a selection change), which is why it read as
intermittent rather than broken.

**This corrects a claim task 175 made and never verified.** 175's write-up listed
the float among the surfaces that already followed; its verification step was a
preview eyeball owed and never run, which is why the false claim survived.

> **A value that is a live function of app state is resolved at READ time from
> one authority (205) — and every RENDERER of it SUBSCRIBES. A live READ with no
> subscription is not a consumer; it is a value frozen at whatever moment its
> holder was last built.** So the colour leaves the value object entirely: a
> `Floatable` declares `themeKey` and the WINDOW resolves the paint.

Six rules it earned:

- **The fix is a RESHAPE, not a hook call.** Adding `useThemeVersion()` to
  `FloatWindow` closes M1 and M2 in two lines and leaves the hex on the
  `Floatable`, where the next reader takes it as a resolved value again. A
  `Floatable` is a DESCRIPTION of what to render, re-derived once per float-map
  rebuild; a colour that can change under it does not belong frozen inside one.
  What crosses the contract is the KEY — a fact about the float that cannot go
  stale.
- **The chrome stays card-blind.** `FloatChrome` receives a resolved tint, never
  a kind, exactly as its own comment requires; `PanelThemeKey` is a generic
  theme-registry name, not card vocabulary, so `src/floats/` naming one crosses
  no ontology.
- **The subscription is UNCONDITIONAL and the key is OPTIONAL**, which is why
  `useThemeVersion` is exported rather than the keyed `useCardTheme` being
  reused: a text-object float declares no key, a hook may not be conditional, and
  the cost of the neutral case is one version-counter compare.
- **The pure derivation is exported for the TEST and censused OUT of
  production.** `resolveFloatAccent` exists so the producer contract ("a note
  float's declared key resolves to the note theme's `headerDefault`") can be
  stated without the suite restating the accent → theme derivation — which is the
  fork this task closes. A production caller of it would be the pre-493 defect
  under a new name, so the census pins its readers to the hook alone.
- **M3 — the two halves of one identity read from ONE table.** `cardFloatable`
  DERIVED its theme key while every docked card RESTATED it as a literal
  (`useCardTheme("note")`, … — 15 sites). They agree today, so this was latent
  drift rather than a live defect: re-theme a kind in `CARD_REGISTRY` and the
  float follows while the docked card does not. `useCardKindTheme(kind)`
  ([src/cards/use-card-kind-theme.ts](../../../src/cards/use-card-kind-theme.ts)) is the
  one door; the KIND literal stays at the call site (a `NoteCard` IS the note
  kind, and there is no second table there), and the THEME KEY leaves it.
- **Do NOT solve this by re-rendering `EditorPane` on a colour change.** That
  re-renders the whole pane — editor included — on every swatch click, for a 24px
  header strip.

The same pass deleted three DEAD props on `AppliedRecordBody`
(`cardKind` / `panelKey` / `themeKey`), declared and destructured by nothing, two
of which restated the accent binding as literals at their two call sites — the
task-227 WIRE-it-or-DELETE-it rule, and two fewer copies of the fact M3 unifies.

CI: [float-accent-follows-override.test.tsx](../../../src/floats/__tests__/float-accent-follows-override.test.tsx)
renders the REAL chain (`FloatHost` → real `FloatWindow` → real `FloatChrome` →
real `FloatingPanel`) for a real note card inside `PoppedCardsContext`, reads the
painted `backgroundColor` off **`document.body`** — the panel PORTALS, so RTL's
`container` is empty and a leg reading it passes vacuously — then does the ONE
thing that happens (`act(() => setPanelColor("note", …))`) and asserts BOTH the
header strip and the float root's `--link-anchor-color` moved. Two controls keep
it honest: a docked `useCardKindTheme` reader re-renders and repaints in the same
harness, and an override on ANOTHER kind leaves this float alone. **No pre-493
suite could see any of this**: `card-floatable-header-tint` asks the BUILDER for
its hex (which was always live — rebuilding the floatable after an override
yields the new colour), and every chrome suite hands `FloatChrome` a
hand-supplied tint, so a RENDERED float failing to follow a store change is
unrepresentable in all of them. Its legs 1-2 are RENEGOTIATED in place with the
reason at the site, as is `card-theme-override-guardrail`'s task-175
`useCardTheme("todo")` pin — both stated the retired shape, and the contract each
asserts is unchanged. The leg with teeth is the CENSUS: the hook was never the
part that could misbehave, a chain that stops asking it is — so
`resolveFloatAccent` has exactly one production reader, the `Floatable` contract
carries a key and neither retired hex field, no float-chain file spells
`getPanelColor`/`themeFromAccent`, and no card component hands ANY panel-theme
hook a literal key. Measured by neutering each half in turn: dropping the
subscription takes 3 legs, and a docked card reverted to a literal 1.

**Owed, not claimed:** the preview eyeball, and it is exactly the check 175 never
got. NOT FSA-masked (localStorage + CSS + React state), so the unit contract is
durable proof and the eyeball is cheap: pop a todo out, set Todo → Purple, and
watch the float's header strip and window ring move with the docked card.

#### The seed half: a DETECTED answer never overwrites a DECLARED one

Same law read in reverse (task 344). Above, a live answer was frozen into a record; here a
GUESS overwrote the authoritative record — and the two defects that made it were each
invisible on their own.

**The detector was fed bytes its own contract forbids.** `detectBibPackage` handed the WHOLE
RAW `.tex` — preamble, body, comments, verbatim blocks — to `detectPreambleBibFamily`, whose
docstring says in as many words to pass the inert-stripped preamble. So a commented-out
`% \usepackage{biblatex}`, the single most ordinary thing in an academic preamble, outranked a
live `\usepackage{natbib}`; so did a verbatim-quoted package line in a methods paragraph. The
requirements side has projected inert bytes away since P4 and its comment explains exactly why.
Two detectors, one question, opposite discipline.

**And the answer was written into the user's record.** `refreshBib` did
`if (data.detectedPackage) setState(…)` — and the detector never returns null (it defaults), so
the guard was always true. The Citations panel's own Package control was discarded on every doc
open AND every `DOC_BIB_CHANGED_EVENT`; since `usePersistentState.update` persists the whole
state object, the next unrelated citations write made the mis-detection durable, whereupon the
SAVE path reads `citations.json` as authoritative, hands it to `ensurePreambleRequirements` as
`declaredBibFamily`, and injects the wrong `\usepackage` into the `.tex`. Biblatex under
natbib-style `\citep` usage leaves an undefined `\citep`: **the paper stops compiling.**
`storage-fsa.ts`'s own comment claimed the family was "never overridden by detection once set."

> **A detector that cannot report "I found nothing" is a SEED, never an authority.** It answers
> the VIEW where nothing is declared and writes to no record — and it believes only the bytes
> the compiler would, through the same projection every sibling detector uses.

Five rules it earned:

- **The projection is a NAMED door, not an option bag.** [`projectDetectableLatex`](../../../src/lib/latex-lexer.ts)
  (`projectLiveLatex` at the NARROW verbatim family) is what "which bytes may a detector
  believe?" means; `latex-requirements`' `projectDetectableBody` and `bib-family`'s
  `detectBibFamily` both call it, so the P3 fork-F1 family decision cannot be re-made per
  caller. Kept NARROW deliberately: the requirements pass injects `\usepackage` lines off this
  projection, so widening it to `VERBATIM_ENVS_FULL` changes saved `.tex` bytes rather than
  tidying anything. Inline `\verb` stays live for the same byte-compatibility reason — both are
  stated residuals at the door, not oversights.
- **Ask each half of the question where it lives.** The `\usepackage` half is asked of the
  PREAMBLE, split on the PROJECTED text so a commented-out `\begin{document}` cannot move the
  boundary, and failing OPEN (no marker ⇒ the whole projection is preamble) so a fragment still
  answers. The command-usage FALLBACK stays whole-source on purpose: a `\citep` inside a
  `\newcommand` is real usage, and narrowing a fallback can only lose detections. What it gains
  is inertness.
- **The record must be able to say "nobody has chosen."** `CitationsState.bibPackage` is
  OPTIONAL now, and `migrate` normalizes through `asBibFamily` instead of defaulting to
  `"biblatex"`. That fabricated default is *why* the stomp could not be gated: "the user chose
  biblatex" and "nobody has spoken" were the same value. Detection resolves at READ time
  (`stored ?? detected ?? DEFAULT_BIB_FAMILY`) and writes nothing, which also retires the
  ordering hazard a gated write would carry — `refreshBib` races the sidecar load, so any
  "write only if unset" guard would have to be evaluated against the LOADED state, and a
  non-writer has no race to lose.
- **The baseline is spelled ONCE, and the disagreement was not cosmetic.** `DEFAULT_BIB_FAMILY`
  ( = `"natbib"`, the family `VIRGIL_BASELINE_PACKAGES` ships) had three hand copies that
  disagreed: the detector fell back to natbib while the hook's EMPTY state and its inert twin
  said biblatex. So the hook announced biblatex, then changed to the detected family — and
  `CitationCard`'s package-change effect reads any CHANGE of that value as a user toggle and
  re-derives every citation's command shape. On the majority of documents an ordinary doc OPEN
  looked like a package switch. One constant makes the common case settle with no change at all.
- **No silent correction, and that is the pre-existing decision rather than a new one.** A
  document stored as natbib whose preamble later hard-loads biblatex is a CONFLICT, and
  `reconcileBibFamily`'s locked user decision is *warn, never rewrite*. Detection correcting the
  record would be that rewrite by another route.

CI: [bib-family-detection-authority.test.ts](../../../src/lib/__tests__/bib-family-detection-authority.test.ts)
(detection + the census) and [citations-bib-family-seed.test.tsx](../../../src/hooks/__tests__/citations-bib-family-seed.test.tsx)
(the authority half, through the REAL hook — a stored natbib under a `.tex` that detects
biblatex, the `DOC_BIB_CHANGED_EVENT` re-stomp, and the bytes that reach disk). The leg with
teeth is the CENSUS: the door was never the part that could misbehave, a second call site
feeding it raw bytes is — which is exactly what shipped, spelling no needle any behavioural test
of the door could see. So only `bib-family.ts` may call the raw-byte primitives, only the lexer
may spell the projection's option bag, and the hook may not spell a family literal. Measured by
neutering each half in turn: the projection takes 5 legs, the seed-not-stomp rule 4, the shared
baseline 1.

**Residual, stated.** Documents whose `citations.json` already carries a family *written by the
pre-344 stomp* keep it, and it is now authoritative — right by the no-silent-correction rule,
and fixable in one click from the panel, but it does mean the fix does not retroactively undo
what the old behaviour persisted. And the mount-time settle is narrowed rather than closed: a
biblatex document still transitions once from the baseline to its resolved family on load, where
`CitationCard`'s effect can re-derive command shapes — now toward the CORRECT family. Closing it
properly means the effect riding the explicit `setBibPackage` EVENT instead of a value diff (the
"read the DEVICE, not the derived change" rule, one subsystem over), which is a change to the
citation-command pipeline rather than to this one.

##### …and the same detector rule had a THIRD reader, sitting inside the emitter

Same rule, one layer down (task 345). 344's law — *a detector believes only the bytes the
compiler would* — was applied to the two detectors that look like detectors. It missed the one
that does not: `declareFromRawLatex` ([latex-serializer.ts](../../../src/lib/latex-serializer.ts)), the
P4 "requirements by emission" declaration for a **raw-passthrough** block. Every other `need()`
site in that file declares from the NODE MODEL — the serializer knows an `exampleBlock` emits
`\ex`, a gloss `\begingl`, a `graphicsBlock` an `\includegraphics` — and so searches for
nothing. A `texBlock`'s `code` and a `figureBlock`'s `extras` are the only inputs that reach a
declaration where the emitter has no idea what the bytes mean, so it has to SCAN them. It
scanned the RAW string.

> **A requirement declared by SCANNING bytes is a DETECTION wherever it sits, so it projects.
> A declaration read off the node model is exempt — the line is not "did a regex touch user
> bytes" but "is a regex SEARCHING user bytes for a package's vocabulary".**

That distinction is drawn where it is because the looser one has a counterexample in the same
file: the `textColor` mark validates a user-authored hex with `/^[0-9A-F]{6}$/` and then declares
xcolor beside the `\textcolor[HTML]{…}` it is itself about to write. A regex runs over something
the user wrote, and projecting a hex colour would be nonsense — it shapes bytes the emitter
emits, it does not search them.

Because `assembleLatex` UNIONs declared with detected ("the two never subtract"), the
unprojected half always won: a commented-out `\includegraphics` in a figure's `extras` injected
`\usepackage{graphicx}`, and a paragraph EXPLAINING expex inside a `\begin{verbatim}` wrote a
`\newenvironment{xlist}` macro into the user's preamble on the strength of prose. Injecting a
package a document never runs can break a previously compiling paper — which is the reason the
requirements side has projected since P4, in a comment directly above the vocabulary the
non-projecting half was already importing from. Case D is the everyday one: commenting an old
figure path out while trying a new one is ordinary editing, and a raw-passthrough block is
precisely where a user parks LaTeX they are *not* running.

Three rules it earned:

- **The projection lives INSIDE the declaration, not at its two call sites**, so a third caller
  cannot forget it and there is no second spelling of "inert" for the two halves to drift on.
  It spells `projectDetectableLatex` — the named door, never an option bag (344's rule).
- **The vocabulary was forked too, and that was the deeper half.** `TIKZ_RE` was shared and the
  other four regexes were hand-copied between `declareFromRawLatex` and `BODY_DETECTORS`,
  byte-for-byte, while the collector's own header described the shared-predicate design the
  copies had already half escaped. `PACKAGE_DETECTORS`
  ([latex-requirement-collector.ts](../../../src/lib/latex-requirement-collector.ts)) is now the one
  table both read. Byte-neutral when it landed — the regexes were identical — which is exactly
  why it needed doing before the next vocabulary change landed in one half only.
- **A "declares nothing" leg needs a live CONTROL somewhere**, or it passes when the vocabulary
  is simply broken. And the injected-bytes probe needs a BARE preamble: `CLASSIC_PREAMBLE`
  already ships graphicx / xcolor / natbib / expex, and `xcolor` is on `ALWAYS_REQUIRED_IDS`, so
  against the default seed "did this inject a package?" has no observable answer at all — the
  per-member sweep reads `serializeTopLevelBlock(...).requirementIds` instead.
- **"Declared from the node model" is a claim about the MECHANISM, not a promise that the bytes
  are live.** `graphicsBlock` is the near miss worth knowing, because it is the shape the next
  member of this class will have: it declares graphicx off its node TYPE while its whole payload
  is one free-form `command` attr that `applyGraphicsCommandEdit` stores verbatim when it can't
  parse it, so a commented-out command still declares. Left alone deliberately — fail-open is
  the right direction for a node whose type says what it is, graphicx is in
  `VIRGIL_BASELINE_PACKAGES` so the over-declaration is unobservable, and a commented command
  stops being a `graphicsBlock` on the next parse anyway.
- **A needle that rides on another needle's evidence is unfalsifiable.** The census's first cut
  asserted "at least N−1 of the needles fire in the collector", which absorbs exactly one
  silently-broken needle — and the tikz needle matches nothing outside the collector (it was the
  one member already shared), so that leg was its ONLY evidence anywhere. The liveness assertion
  is exact now, and the canary spells all five shapes rather than two.

**Residuals, stated rather than implied.** The projection is inherited WHOLE, including the
door's own over-strip — a raw `%` inside a `\verb|100%|` or a `\url{…a%20b}` truncates the rest
of that line — and since both readers now project, nothing rescues it: a live `\includegraphics`
sharing such a line goes undeclared. The failure direction flips from over-injection (which
silently breaks a compiling paper) to under-injection (a loud `Undefined control sequence`),
which is the better trade and not a free one. The projection is also stateful over the string it
is GIVEN, so a `code` beginning mid-verbatim reads LIVE here and INERT in the whole-body
detector — per-block isolation, the conservative direction. And the class has known-open members
this task deliberately did not close, so the section does not read as drained: the **preamble
boundary** was still resolved by a raw `indexOf("\begin{document}")` at five sites — **closed by
task 375**, which found it was five sites in `src/` plus two more in the Python skills and worse
than this note recorded (see "The boundary half" below); `StyleApplyDialog.diffPreambles` counts
commented-out packages as things a style swap will destroy; and `compile-service`'s `hasBiblatex`
probe scans unprojected while its own neighbour `reference-resolution.ts` projects.

CI: [raw-passthrough-declaration.test.ts](../../../src/lib/__tests__/raw-passthrough-declaration.test.ts)
— fixtures A/B/D through the REAL `serializeToLatex` with two live controls, plus a per-member
sweep (driven FROM `PACKAGE_DETECTORS`, so a new package is covered by declaration alone, and
supplying the live half for the ids the fixtures don't control) asserting the declaration and
the projected detector agree on the same raw bytes in both the comment and verbatim shapes. The
leg with teeth is the CENSUS, swept over BOTH silos: the declaration function was never the part
that could misbehave — a caller handing it raw bytes is, and so is a SECOND scanner spelling its
own copy of the vocabulary, which is invisible to every behavioural test of this function.
Measured, that sweep needs no allowlist — 763 production files, one hit, the collector. Measured
by neutering each half in turn: dropping the projection takes 5 legs, re-forking the vocabulary
WITH a drifted member 2 (a byte-identical re-fork trips only the census, which is the point),
and hoisting the projection to the call sites 1 — behaviour identical, rule broken.

### The field half: a context field is a promise that some `run()` consults it

Same law, third tense (task 227). The export census above asks whether a published symbol is CALLED and structurally **cannot** see a declared field that is written but never read — so `ActionContext` accumulated three of them.

> **A field on a context/seed bag is an SSOT only if something READS it. Construction is not consumption: a value ten callers build and nobody consults is dead, and the plumbing makes it read as load-bearing.**

`ActionContext.position` (`ActionPosition = "cursor" | "passage-end"`) declared the **insertion-placement policy** in a JSDoc that named real surface-specific defaults, was threaded through `EditorActionsHandle.runAction`'s seed, forwarded by the bridge, and mirrored by four suites — while **no site in `src/` ever passed a value and no `run()` ever read one.** The policy it named lived hardcoded in the legacy dispatcher ([drag-handle-actions.ts](../../../src/components/editor-layout/card-actions/drag-handle-actions.ts), the footnote/citation collapse to `range.to`). `cardLifecycle` was the same shape one field over: its doc claimed the lifecycle actions used it, and those actions reach a `CardLifecycleApi` through a *different* channel entirely (`cardRun` → `ctx.dispatch` → `useDragHandleActions`, which closes over its own copy from `DragHandleActionsDeps`). Both are DELETED — re-add either **with** its first real reader, never ahead of one.

Three rules it earned, two of them from the guard's own first version being wrong:

- **Scope the read needle by TYPE-awareness, not by name alone.** The census's first version searched all of `src/` for `ctx.<field>` and was unsound in the *permissive* direction: `surface` reported alive off [editor-extensions.ts](../../../src/lib/editor-extensions.ts)'s `ctx.surface === "float"`, where `ctx` is an `EditorExtensionsCtx` and the file never mentions `ActionContext`. It now counts only files that REFERENCE `ActionContext` — a file that reads one is a file that types one. The residual (a namesake `ctx` *inside* such a file; `action-registry.ts` already has two) is stated in the guard rather than papered over, exactly as the export census states its own two limits.
- **Anchor the can-see canary on a field that cannot be retired.** The first version proved "the census isn't blind" with `toContain("surface")` — the one field the census would have flagged had it been sound. A canary standing on the defect is not a canary; it is now anchored on `editor`/`view`/`ref` plus a live read-site count.
- **One copy of the stripper.** A census that must not count a name in prose needs comment+literal blanking, and this is the THIRD to need it — after 202b's runaway (a backtick inside a double-quoted string ate 7 kB and nine declarations, silently, suite green) and 205's unfalsifiable leg. The one-pass scanner moved to [\_source-scan.ts](../../../src/lib/__tests__/_source-scan.ts) and both censuses import it; re-deriving a fourth copy is how the first two defects happened.

CI: [action-context-honesty.test.ts](../../../src/lib/actions/__tests__/action-context-honesty.test.ts). Rule 1 — every `ActionContext` field has a production read. Rule 2 — every `runAction` seed member NAMES a context field (the seed can only carry what the context can hold, and rule 1 keeps the context to what something consumes). Plus a swallow self-check, a pinned proof that `library/` has no `ActionContext` consumer, and `PERMITTED_DEAD_CONTEXT_FIELDS` — **one** entry, `surface`, which is the pre-existing third hit recorded honestly rather than swept: it is the only REQUIRED field in the census, ten production sites write it, and it is a member of the plugin-land `runAction` seed, so retiring it is a materially bigger call than the two that were retired. Its declaring JSDoc names its consumer as `command-input.ts` — a file this same registry's header records as DELETED through CHIP 7a. The reader was removed and the field was not. The set can only SHRINK. A hit is WIRE-it or DELETE-it.

Flagged, not fixed, and invisible to this guard by construction: `ActionContext.dispatch` has three production reads, and **every one is gated behind `ctx.ref.kind !== "cursor"`** while its sole supplier (the bridge) always synthesizes a `CursorRef` — so no `ctx.dispatch?.()` can fire from that path. The census asks whether a read EXISTS, never whether it can EXECUTE; that is a different guard.

### The component half: an IMPORT is a claim that the file renders it

Same law, one medium over (task 495) — and the case where the dead export was a
whole FEATURE, its architecture doc opened by asserting the render that did not
happen, and the only instrument that could have seen it was drowned in its own
noise.

"Preference mode" is the ctrl+click-a-token-to-edit-it feature: turn the mode
on, `<body>` gains `data-pref-mode="on"`, every element carrying `data-prefs` /
`data-panel-theme` lights up, and ctrl+clicking one opens a picker for the
tokens it names. **None of it was reachable.** `EditorLayout` imported
`PreferenceModePicker` and never rendered it — and that picker was the only
place `usePreferenceMode`'s `on` was ever read, while its `toggle` had NO reader
anywhere (`EditorLayout` destructured both and used neither). So no button, menu
row or shortcut could flip the mode, the hook's body-attribute effect could only
ever REMOVE the attribute, the two rulesets gated on it (four selectors) were
unreachable, and four components went on stamping `data-prefs=` for a walker
that never mounted. `data-panel-theme` was consumer-ONLY — read by the picker
and by those rules, produced by nothing, while `panel-primitives` promised "the
header `<div>` below gets its own `data-panel-theme` annotation".

**And the docs asserted the opposite**, which is the load-bearing half.
`PreferenceModePicker.tsx`'s own Lifecycle contract opened with *"1. Host
(EditorLayout) renders `<PreferenceModePicker />` unconditionally"*, and
`usePreferenceMode.ts`'s threading map put a *"[top-bar button]"* under
`EditorLayout.tsx` that *"renders the toggle button; uses isOn & toggle()"* —
two files, two false claims, and the second went on to give a step-by-step guide
to EXTENDING the feature, so the next agent asked to make something
ctrl-clickable would have followed it and shipped a stamping site into a void.
The class this file names repeatedly ("a comment describing a retired mechanism
is how the next reader concludes the invariant is held"; task 395's "the prose
outlived the mechanism"), with the guide attached.

It was **superseded, not abandoned mid-build**: the render site was removed in
the same commit that introduced `SmartPreferences`, which IS mounted, DOES read
`usePanelColor`, and covers the same tokens through a modal. So the picker's job
was being done by a live surface and what remained was its corpse — which is why
the answer is DELETE (task 202's rule: *WIRE-it-or-DELETE-it, and a dead SSOT is
worse than none*) rather than a re-wire.

> **A component IMPORT is a claim that this file renders it.** A PascalCase
> value binding imported into a production module and never mentioned again is
> either a feature that does not render or a stale trace of one that moved —
> the same lie either way, and invisible: `tsconfig.json` sets no
> `noUnusedLocals`, so the compiler is silent BY CONFIGURATION.

Six rules it earned:

- **The census asks the BINDING, not the file.** The obvious form — *does a
  `<Name` tag exist somewhere in the repo?* — is VACUOUS on this very defect:
  `PreferenceModePicker` is a real component whose module really is imported, so
  a question keyed on the FILE passes while the binding is dead.
- **"Used a second time AT ALL", not "appears in JSX".** A JSX-only needle flags
  every legitimate non-JSX use of a component value (`React.createElement(Foo)`,
  a `Foo` handed to a registry, a `typeof Foo`), trading an EMPTY allowlist for
  a list of exemptions. The permissive form still catches the reported shape,
  because a dead import is dead in every spelling. Stated reach, the other
  direction: a binding MENTIONED but not actually rendered satisfies it — the
  same limit the dead-PROP sibling states about a prop destructured and dropped.
- **SCREAMING_SNAKE is out of scope, and that is what keeps the allowlist
  empty.** A constant is not a claim about rendering, it is eslint's question,
  and including it would put ~10 pre-existing hits into a list this census needs
  empty to be worth anything. A component name is PascalCase — at least one
  lowercase letter — which is the test React itself uses. That cannot separate a
  component from a PascalCase TYPE imported without the `type` keyword, and the
  census found one on its first run (`Side`, unused, deleted with the rest):
  recorded rather than narrowed, since the over-collection costs nothing while
  the allowlist is empty and narrowing it is a compiler's job.
- **M5 is DELETE and NOT "wire it", and the reason is the interesting one.**
  `useLoadPanelColors` was an exported hook with zero consumers whose docstring
  said "Load overrides on first client mount" — and moving the override load
  into its effect would REINTRODUCE the defaults-then-override flash that audit
  tick 33 refuted on the strength of the current shape: `loadPanelColors()` is
  read **synchronously in `EditorLayout`'s render body**, so the very first
  paint already carries the user's override. It is the tidier-looking
  implementation that would be WRONG, which is precisely why leaving it exported
  was a trap.
- **The half-alive third state is worse than either resolution.** Restoring the
  feature was a live option and the state was wrong under EVERY answer, so the
  docs half could have landed regardless — but with a live successor there is no
  capability to lose, and a feature reachable only by editing source is not
  reachable.
- **`findLeafByKey` went with it.** Alive only for the picker, in a module
  (`preferences-tree.ts`) that stays because five other consumers do read it —
  the file survives, the export does not.

**The noise IS the finding.** The census named EIGHTEEN bindings on the pre-495
tree and every one of them was in `EditorLayout.tsx` — no other production
`.tsx` in either silo had a hit. Seventeen besides the picker: `VirgilEditor`,
`FloatingPanel`, `DockOutline`, `CardLiftOutline`, `OmniFilterMenu`,
`ExamplesPanel`, `Side` and all ten panel `*Host`s, every one residue of the
extraction that moved it into `EditorPane` or an `editor-layout/` submodule.
`npm run lint` reported 89 warnings on that one file (69 after this), so an
unused import was ambient noise rather than a signal: the warning that would
have caught the eighteenth was buried under seventeen.

**Deleting an import can remove a module LOAD, so each one was checked for an
import-time side effect** — and one had a real one. `Editor.tsx` opens with a
bare `import "@/text-objects/floats";`, a registration barrel whose body runs
eleven `registerFloatBody` calls; `VirgilEditor`'s import statement SURVIVES the
edit but now binds only the `EditorHandle` interface, and under `isolatedModules`
a type-only-used binding is ELIDED, so `EditorLayout` genuinely stops loading it.
Safe because `EditorPane` value-imports the same module and `EditorLayout`
statically imports `EditorPane` — but the surviving statement is a false comfort,
and the ordering shift it causes is only harmless because every read of that
registry is render-time (`text-object-floatable.tsx`), never a module-scope
const, which is the invariant `stack-capture.ts` already records ("an affordance
must not depend on import order").

CI: [dead-component-import-guardrail.test.ts](../../../src/__tests__/dead-component-import-guardrail.test.ts)
— the sibling of [dead-panel-prop-guardrail.test.ts](../../../src/panels/__tests__/dead-panel-prop-guardrail.test.ts),
which asks the same question one level in (a declared PROP nobody reads).
Population DISCOVERED from what the repo ships (`trackedFiles`, both silos,
production `.tsx`) and pinned PER SILO — the two roots collapse independently,
and a library pin written as a path SUBSTRING answers true in any checkout that
happens to live under a directory called `library`. Allowlist EMPTY, with a
SYNTHETIC can-see canary spelling every shape that must and must not flag —
including a component named only in the comment above its own import, which is
exactly the disguise the reported defect wore. Beside it a retirement leg pins
ten needles dead in both silos, reading COMMENT-STRIPPED source on purpose: this
repo's convention is to renegotiate a retired claim in place with the reason at
the site, and a raw-source needle would make writing that sentence a test
failure — outlawing the very prose the fix is made of.

**And it carries the swallow self-check `_source-scan.ts`'s own header asks
every caller for**, because this census needs it more than a `toContain`-shaped
one does: 61% of its collected bindings sit at exactly TWO occurrences (the
import plus one use), so ONE swallowed line is a spurious failure with no
diagnostic. The obvious form of that check has no teeth and was MEASURED to have
none — a swallow eats to end of LINE, so counting surviving `import` lines sees
nothing, and planting a real JSX apostrophe leaves them all intact. So the
question is asked of the scanner itself: `swallowedLines` (exported from
`_source-scan.ts`, one implementation rather than one per caller, for the reason
`strip` has one) reports every line on which a quoted string opened and met a
newline. Measured by planting `Loading… it's almost ready` in a real component:
the leg fails and names `LoadingScreen.tsx:8`.

Measured by neutering back to the pre-495 tree: both legs fail, naming all 18
dead imports and every retired file; re-adding the `dataPrefs` prop alone fails
the retirement leg.

**The residual this filed is CLOSED by task 515.** 495's deletion ORPHANED a
capability of a shared primitive: `PreferenceModePicker` was the only production
consumer of `SystemDialog`'s `variant="anchored"` — and of the `at={{x,y}}` and
`outsideClickGuard` props that serve it — so all three had zero callers, pinned
only by `system-dialog-variants.test.tsx`, and a suite is not a consumer. Neither
census could see it: this one asks about IMPORTS, and the dead-PROP sibling asks
whether a prop is read in its OWN declaring file, which `outsideClickGuard` was.
Deleting an unused VARIANT of a shell every dialog in the app mounts is a decision
about the dialog system rather than a consequence of retiring a picker, so what
landed with 495 was the half that is unarguable — the false prose — and the
capability was left standing and honestly labelled. 515 took the decision
(DELETE: `<Menu>` + `useFloatingMenuPosition` already own the two anchored shapes
STYLE_GUIDE routes elsewhere, so the caller it was waiting for was not coming)
and, because the reason it had to BE a decision was that no instrument could see
the shape, left one behind — see "The taxonomy half" below.

**Owed, not claimed:** nothing. This is pure module wiring plus CSS — not
FSA-masked, and the deletion is type-checked. The one visible change is a
`cursor: help` and a hover outline that could never appear.

#### The taxonomy half: a declared VARIANT is a promise that some caller asks for it

Same law, the axis 495 could not reach (task 515) — and the case where the
finding was filed as a DECISION precisely because no instrument could see it.

`SystemDialog`'s `variant` axis is a declared TAXONOMY (`STYLE_GUIDE.md` →
"Positioning variants"): one shell, principled placement variety, a table telling
the next author which member to reach for. 495 left it with a member nothing
asked for — `"anchored"`, plus the `at={{x,y}}` prop and the `outsideClickGuard`
escape that existed to serve it — and the memo's own sentence is the whole
diagnosis: *neither existing census can see the shape, which is why it is a
decision, not a guard.* `dead-component-import-guardrail` asks about IMPORTS and
this is a string union; the dead-PROP sibling asks whether a prop is read in its
OWN declaring file, and `outsideClickGuard` was. So it sat half-alive for four
months with the whole suite green and its own behavioural legs passing — because
a suite is not a consumer (task 202), and here the suite was the ONLY thing
standing behind three pieces of a shell every dialog in the app mounts.

> **A member of a declared taxonomy is a promise that the app does that thing.
> Every member has a production CALLER, or it is not a member.** The default
> member is called by OMISSION (an unadorned `<SystemDialog>` IS a modal
> caller), which the census has to state or it indicts the commonest shape there
> is.

Six rules it earned:

- **The instrument is what turns the next occurrence from a memo into a failing
  test.** The deletion alone is the surgical half; the reason this needed a task
  at all was that nothing could SEE it, and shipping the deletion without an
  instrument leaves the next orphaned member to be found by a human reading the
  file — which is how this one was found, four months late.
- **Membership is DISCOVERED on BOTH sides.** The union's members are read out
  of the shell's own `export type SystemDialogVariant` declaration and the
  DEFAULT out of its destructuring default, so a fourth variant is covered by
  declaring itself; the population is the shared `<SystemDialog>` element walk.
  A hand list inside the guard that outlaws hand lists is this defect one level
  up.
- **ONE population, two questions.** `dialog-cued-default-census` (task 389) was
  already walking every production `<SystemDialog>` ELEMENT, so the variant
  census does not open a second walk: both filter
  [_dialog-sites.ts](../../../src/components/__tests__/_dialog-sites.ts). Two
  enumerations of "who the dialog sites are" is how one guard comes to be
  scanning a set the other no longer is — task 415's rule for the write-door
  population, one subsystem over. That refactor is behaviour-neutral and its
  eight legs are the proof.
- **An UNRESOLVABLE site fails CLOSED.** A `variant={someExpr}` is a site the
  census cannot read, and a site it cannot read is one that can silently become
  the last caller of a member — the whole failure being closed. It gets its own
  leg with an empty expected list rather than being waved through. No production
  site is dynamic today; if a real one ever needs to be, that is a decision to
  take deliberately, not one a regex should make.
- **The allowlist is EMPTY, and that is a claim rather than a default.** There
  is no true statement of the form "this variant is part of the taxonomy but
  nothing may call it" — which is exactly the sentence a `describedBy`-shaped
  exemption would have forced, and why the census is scoped to the VARIANT union
  and not to every prop of the shell. That scope was MEASURED, not assumed: of
  the twelve members of `SystemDialogProps` exactly one (`describedBy`, the ARIA
  counterpart of `labelledBy`) has no production caller, and an a11y counterpart
  mandated by the pattern is not the same class as an untaken positioning
  capability. The sibling unions were measured too and are fully called
  (`ButtonVariant` 5/5, `SystemDialogSize` 5/5), so the phenomenon was specific
  to this union rather than general — the refinement this file's own central
  principle carries ("deep" is not "broadest blast radius").
- **The retirement leg watches the two pieces a rename can bring back.**
  `variant="anchored"` cannot return silently — it would not typecheck — but
  `outsideClickGuard` and `at` are ordinary optional members of the shell's own
  interface, so re-adding either type-checks, renders, and is invisible to every
  behavioural test of the dialog. It reads COMMENT-STRIPPED source, because this
  repo renegotiates a retired claim in place with the reason at the site and the
  docblock explaining the deletion names both — a raw-source needle would outlaw
  the very prose the fix is made of.

CI: [system-dialog-variants-census.test.ts](../../../src/components/__tests__/system-dialog-variants-census.test.ts).
The behavioural legs in `system-dialog-variants.test.tsx` are RENEGOTIATED in
place with the reason at the site rather than silently dropped: nothing survives
to re-scope (the `at` clamp and the guard existed for that variant alone, and its
"closes on a plain outside mousedown" half is the draggable leg, driven through
the same rAF-armed listener), and what replaces them is the census, which asks
the question that suite structurally could not. Measured by neutering: re-adding
the member and its two props to the shell fails 2 legs, naming `anchored` and
`outsideClickGuard` by name.

**Owed, not claimed:** nothing. Pure type-checked deletion of a code path with no
caller; the surviving variants' own legs are the regression net.

#### The selector half: a CSS hook is a claim that something stamps it

Same law, the CSS medium (task 525) — and the case where two maintenance
sweeps read a dead rule, reasoned about it, and TOKENIZED it.

The repo runs the two adjacent halves of this question and neither can see
this one: `phantom-css-var` asks whether a `var()` READ resolves to a
definition, `inert-preference-controls` asks whether a declared token has a
READER. Both are about CUSTOM PROPERTIES. The missing third is about the
SELECTOR — *does this hook have a PRODUCER?* — and eleven hooks had none:
`.citation-node-bar` / `.citation-node-text` (sub-elements of a citation DOM
that no longer exists), `.footnote-highlight-marker`, `.footnote-content-editor`,
`.footnote-card-drop-target`, `.note-editor`, `.note-marker-selected`,
`.hide-scrollbar`, `.toolbar-scroll`, `library.css`'s `.paper-render-pod`, and
the attribute value `[data-paragraph-kind="report-request"]`.

> **A class or attribute value the stylesheet matches on is a claim that
> something stamps it on an element.** Where the vocabulary is OPEN (class
> names) the census is a grep with a small STATED allowlist; where it is
> CLOSED (an attribute whose writer's codomain is declared) the census is a
> DERIVATION with an EMPTY one.

Six rules it earned:

- **A dead rule is worse than no rule, and here that is measured rather than
  argued.** `.footnote-highlight-marker` was migrated onto `var(--footnote-200)`
  by §8's rust consumer sweep — with a comment reasoning about the change — and
  `.footnote-card-drop-target` onto `--footnote-50` by the same pass;
  `.paper-render-pod`'s own comment described a wiring (*wraps
  `<EditorContent>`* inside RightDetail) that no longer exists, beside a
  `PaperRender.tsx` that writes the same pod tokens inline. Three sweeps read
  the declared path and believed it was the enforced one.
- **The two halves are DIFFERENT SHAPES, and the closed one is the leg with
  teeth.** `data-paragraph-kind`'s only writer is `cssTokenForCardKind`, so its
  legal value set IS the crosswalk's `cssToken` column — which is how
  `report-request` was dead *by derivation* rather than by deletion: that
  kind's `cssToken` is `"report"` (the fork `legacy-token-crosswalk.ts` exists
  to declare), so the rule was a Mode-A restatement of the Mode-B
  `data-link-card` vocabulary, where `report-request:` IS live. Two same-named
  namespaces, one of which the attribute can never hold. The Mode-B leg is the
  same shape: the `legacyDataKind` column plus whatever
  `normalizeLegacyCardKind` accepts, asked of that function rather than
  re-listing the legacy pair.
- **A census whose hits are DELETIONS fails OPEN.** A class is produced by a
  literal, by `class-${…}` (a literal prefix before an interpolation) or by
  `${…}-class` (an interpolation before a literal suffix) — measured, the
  literal-only reading reports 43 hits of which 26 are template families
  (`heading-wrapper-l${n}`, `show-dividers-${n}`, `rtf-content-${variant}`), a
  census nobody would read. Both directions bring it to 17, of which 11 were
  genuinely dead. A missed producer costs one allowlist entry; an over-report
  costs a deletion of live chrome.
- **The allowlist carries two DIFFERENT claims and each is re-checked.**
  `dependency` names the package that stamps the class (CodeMirror's
  `cm-editor`, citeproc's `csl-*`, TipTap Placeholder's `is-editor-empty`,
  KaTeX's `katex-display`) and a leg walks that package for the string, so an
  upgrade that renames it fails here instead of leaving a standing licence.
  `routed` is a DECLARED affordance whose producer is unwired — `iconbtn-lg` /
  `iconbtn-on-dark` (documented steps of a size scale) and `.is-menu-open` (a
  designed grab-handle state the handle never receives while its DragHandleMenu
  is up). Deleting one retires a design and wiring one changes what the app
  looks like; both are Gabriel's call, so they are parked with the question
  stated rather than decided unattended.
- **A dead SELECTOR can prop up a live-looking TOKEN.** Deleting
  `.footnote-highlight-marker` turned `--footnote-200` into a `phantom-css-var`
  orphan — its only reader had been that rule. Recorded beside `--footnote-300`
  as an unused rung of the deliberate `--footnote-*` tint scale (a scale is a
  vocabulary, not an alias), and it is the tidiest statement of why the two
  censuses are not the same question.
- **The retirement leg reads COMMENT-STRIPPED source**, because every deletion
  left a note at the site naming what it removed — this repo renegotiates a
  retired claim in place — so a raw-source needle would outlaw the very prose
  the fix is made of. Its canary asserts the notes are still THERE, so a leg
  that passes because someone deleted the explanation fails instead.

CI: [dead-css-hook-census.test.ts](../../../src/__tests__/dead-css-hook-census.test.ts).
Measured by neutering each half in turn: restoring one dead class rule takes 2
legs, restoring the `report-request` rule 1, a planted dead `data-link-card`
prefix 1, a stale allowlist entry 1, an allowlist entry that has gained a
producer 1, a `dependency` entry whose package no longer ships the class 1, and
deleting a retirement note 1. Three downstream contracts are RENEGOTIATED in
place with the reason at the site rather than re-scoped: `phantom-css-var`'s
orphan set (gains `--footnote-200`), `in-text-anchor-accents`' non-vacuity floor
(20 → 19 reads, the token itself untouched — its Mode-B read is live), and
`affirmative-green-tokens`' raw-green allowlist (loses the two
`.note-marker-selected` hexes, a shrink).

**Owed, not claimed:** nothing user-visible should change, which is the point —
every deleted hook could never match an element. Not FSA-masked.

### The producer half: a callback a NodeView CONSUMES has a PRODUCER at the one mount that could pass it

Same law, the tense none of the halves above can see (task 534) — and the case
where the consumer read the field, the component destructured the prop, three
surfaces implemented the behaviour, and the ONE place that could have supplied
it never did.

`<VirgilEditor>` declared `onConfirmLabelRename` and `isLabelTaken` as optional
props; `Editor.tsx` mirrored them into refs and threaded them into the extension
factory's `callbacks` bag and onto the `EditorHandle` proxy; the heading
strip's lozenge (a vanilla-DOM NodeView), the figure's lozenge
(`FigureAnnotation`) and eight float bodies all READ them. The sole production
mount — `EditorPane` — supplied every SIBLING (`onConfirmHeadingDelete`,
`onConfirmFigureDelete`, `onOpenHeadingTypeMenu`) and neither of these two. So
every rename of a `\label{…}`, from any surface, on any paper, since
`0f1761ef`, ran with `updateRefs` false: **the declaration moved and every
`\ref` naming the old key was left behind** — a `??` in the compiled PDF, with
no dialog, no warning, no log line, for five months. `onConfirmFootnoteMove` had
rotted the same way behind a comment asserting that "EditorLayout always wires
the callback", and `onAddComment` / `onArchive` were declared, destructured and
read by nothing. Every one of those props is OPTIONAL, so all of it type-checked.

**Why no existing instrument could see it.** `action-context-honesty` asks
whether a declared FIELD is read; `dead-panel-prop-guardrail` asks whether a
declared PROP is consumed by its own component. Both were satisfied: the
consumer read the field, the component destructured the prop. What nobody asked
was whether anything ever PASSES it — the missing half of "a registry earns its
name by being read" is that a callback earns its name by being SUPPLIED.

> **A callback the editor CONSUMES has a PRODUCER at the mount that could pass
> it, or it is not on the bag.** The ref-mirror, the `callbacks` bag and the
> `EditorHandle` proxy are three layers of plumbing that carry a value from the
> mount to a NodeView; each of them is a promise that a host answers, and the
> promise is checked at the mount, not at the consumer.

Seven rules it earned:

- **ONE door for the rename, not three copies of the walk.**
  [`renameLabelWithRefs`](../../../src/lib/tiptap/label-rename.ts) locates the declaring
  node (by live position on the page, by uuid from a float or the Outline),
  refuses a key another declaration already claims, collects every `labelRef`
  naming the old key, asks the confirm, and moves the declaration AND every ref
  in ONE transaction — one undo step, one autosave arm, no window in which the
  paper is inconsistent. The heading strip, the figure lozenge and the Outline's
  `handleUpdateLabel` all enter it. Pre-534 the first two each carried a private
  copy of the walk (both dead) and the third carried none at all
  (`updateHeadingLabelByUuid`, deleted).
- **The door FAILS TOWARD NOT ORPHANING.** A rename with no confirm handler in
  hand carries its refs. The confirm exists to let a user deliberately KEEP refs
  on the old key (they mean to re-declare it), and "nobody wired a dialog" is
  not that decision. The census keeps production from ever reaching the default;
  the default is a statement about what a missing wire must COST.
- **The label predicate has ONE home.** `isLabelTaken` was a prop threaded
  through `EditorProps`, a ref on `HeadingCallbackRefs`, a member of the
  `callbacks` bag, a proxy on `EditorHandle`, and a `isLabelTakenRef` block in
  eight float bodies and `ExampleCard` — nine proxy sites for a predicate
  `@/lib/labels` already answered from the live document. Every consumer reads
  `isLabelTaken(editor, candidate, own)` directly now, and the prop, the ref,
  the bag member and the proxy are DELETED. That is what makes the commit gate
  and the live "label already in use" warning read the SAME predicate, so they
  cannot disagree (the rule the Outline commit earned as OUT-F8-03, now held by
  every surface).
- **A duplicate is REFUSED, not committed.** The figure lozenge used to commit
  a conflicting key with only a warning; now every surface answers `conflict`:
  on Enter the input stays open with its warning lit, on blur the edit is
  abandoned. Decided rather than inherited — a warning beside a commit that
  proceeds is the false-affordance class one field over.
- **The door moves the `label` and NOTHING ELSE.** A `labelRef`'s `displayText`
  is re-derived by the numberer's own `appendTransaction` on any structural
  change, and a label rename IS one — so the display follows on the same
  dispatch. Two writers of one derived attr is how they come to disagree.
- **ONE consolidated confirm dialog in `EditorPane`** (`useConfirmDialog`) now
  produces BOTH missing callbacks — `onConfirmLabelRename` (its words spelled
  once, beside the door, as `labelRenameConfirmCopy`) and
  `onConfirmFootnoteMove` — rather than a second dialog per callback.
- **The census is the leg with teeth, and its population is DISCOVERED.**
  [editor-callback-producer-census.test.ts](../../../src/components/__tests__/editor-callback-producer-census.test.ts)
  parses `EditorProps` for every OPTIONAL function-typed member — so a callback
  added tomorrow is covered by declaring itself — and asks three things: it is
  READ in `Editor.tsx` (declaration + destructure + a use, or it is
  `onAddComment` again), it is PASSED at the sole production `<VirgilEditor>`
  mount (exactly one, pinned: a second mount is a second place for a producer to
  go missing), and every member of the extension factory's `callbacks` bag is
  one of those props and is threaded into the bag `Editor.tsx` builds. Beside
  it: the predicate has no prop / ref / proxy anywhere, the retired Outline
  primitive stays retired, the door's callers are an EXACT set (the three
  producers plus the door), and the ref walk (`.label === oldLabel`) is spelled
  in the door and in exactly one exemption — `ref.ts`'s re-point of a SINGLE ref
  at a different existing label, a different gesture whose `return false;` is
  pinned so it cannot become a second walk. Allowlist EMPTY.

CI: [label-rename-refs.test.tsx](../../../src/lib/tiptap/__tests__/label-rename-refs.test.tsx)
drives the door's contract, the REAL heading NodeView through its label input,
the REAL `FigureAnnotation` through RTL, and the REAL `useEditorOps` Outline
handler — and its DEFECT legs assert that the `labelRef`'s `label` MOVED, never
that a transaction was dispatched. **No pre-534 suite could see any of this**:
`structural-edit.test.ts` drove the label WRITE one layer below the NodeView
where the refs were never walked, and every heading / figure fixture in the repo
renames a label no `\ref` points at. Measured by neutering each half in turn:
**A** (the two producers removed from the mount) fails the census's leg 2;
**B** (the door's no-confirm default flipped to orphan) 2 legs; **C** (the
conflict gate removed) 3 legs; **D** (the Outline handler answering its own
confirm with NO) 1 leg — the Outline DEFECT leg, which is the surface that had
no walk at all.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live editor
gesture plus a `.tex` round trip — no disk), so the check is cheap and real:
label a figure, `\ref` it from a paragraph, rename the label from the figure's
lozenge — the dialog asks, "Update references" rewrites the `\ref` (read the
code view) — then the same from a heading's strip and from the Outline's inline
label editor.

#### The kind half: a rule stated for THREE of FIVE declaring kinds, and a registry that saw TWO

Same door, the two producers 534 never drove (task 553) — and the case where
the census that pinned the door's callers as an EXACT set was asking the wrong
question of the right population. `\label{…}` is declared by FOUR block kinds
(`heading`, `figureBlock`, `exampleBlock`, `exampleItem` — every block node the
schema gives a `label` attr), and 534 routed the heading strip, the figure
lozenge and the Outline's editor through `renameLabelWithRefs`. The example
family's two "Ex. · label" pods each carried a byte-identical private
`commitLabel` that wrote `setNodeMarkup(pos, undefined, { …attrs, label })` and
nothing else: renaming `ex:one` → `ex:first` from the pod left every
`\ref{ex:one}` stranded — and the numberer, whose gate IS a `LabelEntry`
change, dutifully re-resolved each one to `??`, which is what the compiled PDF
printed. No dialog, no warning; a key a heading already owned was committed
beside it. 534's census asked *who CALLS the door* and *who WALKS a ref*; a
commit that does neither spells no needle. Task 404's rule, one census over.

**And the registry underneath was half-blind.** `collectLabelKeys` — the ONE
"is this key already taken?" walk every label editor and the door's refuse
rung consult — hand-listed `heading` and `figureBlock`. So a key an example or
an item declared was FREE to every duplicate check in the app: the heading strip
wrote `ex:one` beside the example that owned it, and the door's "refuse a
claimed key" rung could not see half the paper's declarations.

> **The declaring kinds are ONE schema-pinned set, `LABEL_DECLARING_NODE_TYPES`
> ([node-attr-sets.ts](../../../src/lib/node-attr-sets.ts) — every BLOCK type carrying
> a `label` attr, so the inline `labelRef` atom, which carries the key it
> REFERENCES, falls out), read by the registry and by the census. Every
> producer enters the door; the census asks the QUESTION — who WRITES a
> `label` attr — over every ProseMirror attr-writing verb, and a write that is
> not a rename of a declaration says why, per line.**

Six rules it earned:

- **Two byte-identical pods became ONE factory.** `createExampleLabelPod`
  ([expex.ts](../../../src/lib/tiptap/expex.ts)) owns the pod's render, the inline
  input session (the 529 latch, the 548 lifetime), the live warning and the
  COMMIT — which is the heading strip's byte for byte: a claimed key is REFUSED
  (Enter keeps the input open with the warning lit; leaving the field abandons
  the draft), everything else enters the door against the write TARGET. The
  copies had already drifted from the heading in exactly the way twins do.
- **The write target is MAIN in a float.** The pods gain the `host` +
  `onConfirmLabelRenameRef` options `FigureBlock` already takes, threaded from
  the same `callbacks` bag — so 534's producer census covers the new consumers
  by construction, and an example float's rename walks the whole paper's refs
  rather than the float's one example. `locateExampleNode` resolves by live
  `getPos` on the view's own editor and by uuid on any other.
- **The live warning SNAPSHOTS the key set once, at edit start** —
  [label-key-warning.ts](../../../src/lib/tiptap/label-key-warning.ts), ONE helper for
  the heading strip and both pods, with the figure lozenge (React) snapshotting
  the same way. Pre-553 the heading strip called `isLabelTaken` on every `input`
  event: a full `doc.descendants` walk plus a regex over every `\label{` text
  node, per CHARACTER typed into a 10-character chrome field. Sound because the
  set cannot change while the chrome input holds focus (`stopEvent` keeps PM
  out); the COMMIT still asks the live predicate, so a stale snapshot can only
  delay the warning, never admit a duplicate. The pure half is
  `isLabelTakenIn(keys, …)`; the editor form composes it.
- **The census discovers by the QUESTION.**
  [label-write-census.test.ts](../../../src/lib/tiptap/__tests__/label-write-census.test.ts)
  sweeps both silos for `setNodeMarkup` / `updateAttributes` /
  `setNodeAttribute` calls whose arguments carry a `label` key — string
  literals KEPT and line-aligned, because `setNodeAttribute(pos, "label", v)`
  names the attr as a string — and every hit is the door or carries an
  in-place `label-write-exempt: <why>` in the lines directly above it.
  Allowlist EMPTY; the exemptions are an exact set that can only shrink.
- **…and it found a member the audit did not name.** The figure SOURCE
  popover's raw-body writeback (`applyFigureEnvBodyEdit`) re-extracts `label`
  from the env body the user typed and writes it bare. Whether a source edit
  that renames `\label{fig:a}` should ask the confirm and carry the refs, and
  whether one that types a claimed key should REFUSE the save (the lozenge's
  answer) or accept it, is a product decision about a Save-button surface —
  exempted with that reason at the site and ROUTED rather than guessed. Until
  it is taken, a rename from there orphans exactly as it always has.
- **The 534 exact-set pin is RENEGOTIATED, not widened silently**: `expex.ts`
  is the fourth producer, with the reason at the site that the pin could not
  see it.

CI: the example legs in
[label-rename-refs.test.tsx](../../../src/lib/tiptap/__tests__/label-rename-refs.test.tsx)
drive the REAL pods over a fixture that carries a labelled example AND a
labelled item, each `\ref`'d once — **no pre-553 fixture in the repo had a
`labelRef` naming an example key**, so the orphan was unrepresentable in all of
them — and assert the ref's `label` AND that no ref reads `??` afterwards (the
numberer's own verdict). Beside them: the registry leg (the heading strip
refuses `ex:one`), the schema pin (the set = the block types declaring `label`,
and `labelRef` is excluded), and the warning-cost legs (12 characters cost ONE
document walk, on the heading and on both pods — a `descendants` spy, with the
snapshot's own walk as the canary). Measured by neutering each half in turn: a
pod that bypasses the door takes 9 legs (6 behavioural + 3 census), the
pre-553 two-kind registry 2, a per-keystroke warning walk 1, and a fifth
declaring kind left out of the set 3.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live editor
gesture plus a `.tex` round trip — no disk): `\ref` an example, rename its label
from the pod — the dialog asks, "Update references" rewrites the `\ref` — then
type a heading's key into the pod and watch it refuse.

### The vocabulary half: a token two layers must agree on is spelled ONCE

Same law, fourth tense (task 255) — and the one where deleting the dead declaration would have been the *smaller* half of the truth.

The finding was a textbook dead facet: `TEXT_OBJECT_REGISTRY[kind].sourceMarker` declared `vexid`/`vxid`/`vlid` under a header advertising **"source-marker round-trip"** among the things the rest of the system reads off the registry, and after task 064 removed its last proxy reader (`meta.sourceMarker?.idLength === 4`) **nothing read it for five weeks**. But the round trip it claimed to drive carried the same tokens as hardcoded literals in the serializer's nine emit sites, the parser's seven recognition sites *and* its block-boundary command list, the footnote-body parser/serializer, `SHIM_COMMAND_NAMES`, the `.bib` uid regexes, and a line of UI copy in the style editor that named three of the seven. Nothing structural held those copies together.

> **A token that two layers must agree on byte-for-byte is spelled in ONE place, and every layer reads it there. Nothing spells a `\v*` marker command by hand — emitting, parsing, or declaring.**

[src/lib/latex-markers.ts](../../../src/lib/latex-markers.ts) is that place: `VIRGIL_MARKERS`, keyed by the entity each marker identifies, so the record IS the kind→marker map. Four rules it earned:

- **Put the SSOT where the layer that needs it can reach it.** The registry facet was decorative *by construction*, not by neglect: the registry is editor-coupled (TipTap `Editor`, the doc-structure bus, the drop adapters), so the parser and serializer can never import it. That is also why "wire the round-trip to read the registry" was the wrong shape of fix and the module has **zero imports** — a leaf every low-level consumer can take. A facet the layer that needs it cannot import will be re-copied, every time.
- **Derive the subsets from FACETS, not from a second list.** `containsInternalMarker`'s guard set (the reparse refusal for untrusted suggestion text) is every marker with `file:"tex"` + `position:"inline"`; the parser's block-boundary set is `file:"tex"` + `position:"block"`; `SHIM_COMMAND_NAMES` is *all* of them, because every marker is written into a file LaTeX may compile, so a new one cannot be added and left undeclared. Each facet has real readers — a facet nobody reads is the thing this section is about.
- **Frozen bytes are DATA, not a spelling.** `style-library.ts`'s `LEGACY_CLASSIC_PREAMBLE_V0`/`_V1` still name three markers inline and must: they record what past build generations wrote, and the v2 migration gate is exact byte equality, so deriving them would seal those libraries out of the upgrade. That is the census's one allowlist entry, and it can only shrink.
- **The two failure modes are silent in opposite directions.** A renamed command with a stale *parser* makes Virgil emit a document it cannot read back; with a stale *shim list* it emits one LaTeX cannot compile. Neither is a type error, and no round-trip suite could catch either — every one of them spells the token the same way the code it tests does.

Deliberately NOT folded in: the `%!v:xxxx` block anchor and texBlock's `%!vtex:begin/end` sentinel are a different FORM (a trailing comment, no preamble shim) with their own regexes in [uuid.ts](../../../src/lib/uuid.ts); merging two grammars buys a bigger table, not a smaller fork.

CI: [latex-marker-ssot.test.ts](../../../src/lib/__tests__/latex-marker-ssot.test.ts) — the leg with teeth is the **census** (both silos, comments stripped and literals KEPT, since the drift lives in literals), because the module was never the part that could misbehave; a call site spelling its own copy is. It has a THIRD root too (`library/` + `editor/` skill markdown and Python, which the two-silo habit does not reach): markdown cannot import the SSOT, so that leg asserts MEMBERSHIP — every marker-shaped command the skills teach an agent to write is still one the vocabulary knows, which is exactly the rename hazard. `docs/` is deliberately out of that leg, since a design memo may name a marker nobody built. Plus a canary + stripper swallow self-check, the shim/inline-set wiring pins, and a per-marker emit→parse round trip through the REAL parser and serializer, keyed on the `VirgilMarkerId` union so a new marker is a **compile error** until someone states how it survives a save/reload. Three of its legs fail on the pre-fix tree.

#### The deploy half: a convention SIX consumers follow is not a convention

Same law, other medium (task 365) — and the case where the SSOT was never
written down at all, so it existed only as an idiom six files had each
re-derived, and the seventh simply didn't know about it.

Virgil ships as a static export that may be served from the origin root OR from
a subdirectory (`NEXT_PUBLIC_BASE_PATH=/virgil`, what `deploy.yml` sets). Next
prefixes the URLs it generates itself — page routes, `next/font`, chunk
`<script>`s — and touches nothing you build by hand. Every asset under `public/`
is reached by a hand-built string, so every one of them owes the prefix. Six
consumers hand-rolled the same three lines; three did not, and all three failed
SILENTLY and only in production:

- **The Library PDF tab** (`PdfView`'s `VIEWER_SRC`) requested
  `<origin>/pdfjs/web/viewer.html` — outside the app — and rendered the host's
  404 page inside the pane. This is the one Gabriel reported.
- **The `apple-touch-icon` `<link>`** 404'd the iOS home-screen icon, with no
  symptom anyone would ever file.
- **The service worker's TeX precache** — the DATA half, and the one no source
  census would have found. `scripts/build-tex-bundle.mjs` emitted ONE spelling
  into TWO tables whose consumers apply DIFFERENT bases: `tex-core-manifest.ts`
  is prefixed by its consumer, while `sw.js` resolves each entry with
  `new URL(p, self.location.href)` — against its own SCOPE, where a leading
  slash DISCARDS the base and escapes to the origin root. Under `/virgil` all 82
  assets 404'd at install, swallowed by the SW's per-asset `try/catch`: the P1
  offline-compile pillar was simply not there, with no error and no symptom
  until the user went offline.

> **Every URL that reaches a `public/` asset is built by ONE door —
> [`publicAssetUrl`](../../../src/lib/public-asset-url.ts). A path stored in a DATA table
> is public-RELATIVE and each consumer applies its OWN base; where two tables
> have consumers with different bases, they get two spellings, stated at the
> generator.**

Four rules it earned:

- **Dev CANNOT see this class.** With an empty basePath every root-absolute
  string is accidentally correct, which is why all three shipped and why the
  door's own suite carries an opt-in leg over a real
  `NEXT_PUBLIC_BASE_PATH=/virgil` export (`npm run preview:pages`).
- **The env read's SPELLING is load-bearing, and it was measured, not assumed.**
  Against a real basePath build, `process.env.NEXT_PUBLIC_BASE_PATH ?? ""`
  compiles to the literal `"/virgil"`, while the `typeof`-guarded form three of
  the folded-in copies used compiles to
  `void 0 !== shim.default && "/virgil" || ""` — a runtime conditional whose
  false branch is `""`, i.e. **the bug itself**, reachable silently wherever
  Next's `process` shim is absent. A guard whose failure mode is the defect is
  worse than no guard. The build-smoke leg pins the inlined literal, because it
  is the one thing no unit test can see: get it wrong and every other leg still
  passes while production serves an unprefixed URL.
- **Membership is DISCOVERED, because a hand list could only be missing a name**
  — and here it would have been missing the two that matter. The census's
  vocabulary is the real `public/` tree ∪ the dirs the build scripts emit into
  it, since `examples/` and `skill-bundle/` are build output and do not exist in
  a fresh checkout at all.
- **The exemption is scoped to the DATA shape it justifies.** `tex-core-manifest`
  is allowlisted as a table whose consumer prefixes — and a second leg requires
  that file to name no URL-consuming API, so the exemption cannot silently cover
  a `fetch` added beside the table later.

CI: [public-asset-url-ssot.test.ts](../../../src/lib/__tests__/public-asset-url-ssot.test.ts).
The leg with teeth is the **census** — the door was never the part that could
misbehave, a call site that never asks it is, and that call site type-checks
perfectly. It blanks `publicAssetUrl(...)` ARGUMENTS before matching, so the
question it asks is exactly "is this literal reaching the door?"; a positive twin
pins that only the door reads `NEXT_PUBLIC_BASE_PATH` at all. Beside it: the SW
half driven through `sw.js`'s OWN resolution expression (read out of the file, so
the two cannot disagree), and the reported defect driven through the REAL
`PdfView`. Measured by neutering each half in turn — the PdfView fork takes 3
legs, and the SW strip, the shipped manifest, the generator's second spelling,
the icon link and a re-forked prefix copy take 1 each.

##### The boundary half: the scan whose answer moves a SPLICE

Same rule, and the one the two sections above each recorded as an open residual
and neither could close from where it stood (task 375). A detector that believes
inert bytes reads the wrong ANSWER; the preamble/body boundary is a scan whose
answer decides where the document is CUT and where a splice LANDS, so the same
mistake writes a broken `.tex` instead of merely misreporting one.

Every reader located it with an exact-literal
`indexOf("\begin{document}")` / `indexOf("\end{document}")` over RAW bytes,
searched from index 0. Five members follow from that one decision. All five are
silent, all five are FIXED POINTS, and all five land on **OPEN** —
`readDocBundle` runs the save pipeline and then fires `writeReStampedTexOnLoad`
unconditionally, before the user has typed anything. Measured through the real
save cycle:

- **M1 — a preamble that merely MENTIONS `\end{document}` empties the whole
  body.** `endDoc` searched from 0 lands BEFORE `beginDoc`, so the body is
  ejected into the postamble: the editor shows one blank paragraph and the saved
  `.tex` carries two `\begin{document}` with a `\usepackage` after the first. A
  comment, a `\verb`, or a `\newcommand{\stopnow}{\end{document}}` all reach it.
- **M2 — a commented-out `% \end{document}` in the body is severed from its `%`
  and goes LIVE.** The cut lands inside the comment; the rest of the paper is now
  after `\end{document}` and never prints. Commenting out an early
  `\end{document}` to truncate a compile is one of the most ordinary things an
  author does.
- **M3 — a commented-out `% \begin{document}` is UN-COMMENTED by the requirement
  injector.** The splice lands between the `%` and the token, leaving the `%`
  alone on its own line and the token live — so the user's real `\usepackage`
  lines end up *after* `\begin{document}`, a hard LaTeX error, with the real
  begin following as a second one.
- **M4 — a verbatim-quoted `\end{document}` cuts the body mid-verbatim.** A paper
  that DOCUMENTS LaTeX loses everything from that line into the postamble, and a
  `%!v:` anchor is written into what remains of the block, where it prints
  literally in the PDF.
- **M5 — `\begin {document}` is read as "brand-new document".** TeX skips spaces
  while scanning the argument, so that is the same token; an exact literal misses
  it, `extractPreambleAndPostamble` answers null, and the null was read as *the
  file is new*. The whole file went through the body fallback while a style seed
  wrote a **different** `\documentclass` above the user's own.

**And no gate could catch any of it**, because `tex-preservation`'s `splitRegions`
used the SAME exact literal: a cut document measures with everything under body
on both sides and reports a shortfall of **0** in both regions. The word-measure
gates (350-D / 357) are structurally blind to a boundary that MOVED.

> **The preamble/body boundary is a question about LIVE bytes, asked at ONE door
> — [`findDocumentBoundary`](../../../src/lib/latex-lexer.ts) — and the end is searched
> FROM the end of the begin token, never from 0.** A splice needs an offset into
> the RAW string, so the projection behind it BLANKS rather than deletes.

Seven rules it earned:

- **The design's own premise was FALSE, and checking it is what made the fix
  real.** The filed task said `projectDetectableLatex` "blanks bytes, so offsets
  are already preserved — confirm that and state it, since the whole design rests
  on it". It does not: it DELETES them and re-joins the lines, so an index into
  it is not an index into the source, and every injector that spliced at one
  would have spliced at the wrong place. `projectLiveLatex` gained a
  `preserveOffsets` mode — the ONE difference between the two forms is what an
  inert span BECOMES (a space, not a hole), so the two can never drift on WHICH
  bytes are inert, which is what every detector in the app depends on.
- **The family is FULL here and NARROW for detectors, and that asymmetry is
  deliberate.** A detector stays narrow for byte-compatibility of package
  injection (the P3 fork F1); a boundary is a structural question — the one
  `findSectioningCommands` asks — and an `\end{document}` inside a `lstlisting`
  or a `\verb|…|` is not a boundary by any reading. That is M4.
- **The token is a GRAMMAR, not a literal.** `\begin[ \t]*\{[ \t]*document[ \t]*\}`
  — horizontal whitespace only, deliberately, because `\s*` would let the token
  span a blank line, which is a `\par` and not a continuation. A `\begin%\n{document}`
  comment continuation is still not matched: a stated residual, and exactly
  today's behaviour, so no regression rides on it.
- **The user's own SPELLING is carried, never re-canonicalized.** For the
  ordinary token the preserved slice IS the literal byte for byte, which is what
  makes carrying the spaced form free; rewriting it would be a silent edit of a
  line nobody asked us to touch.
- **`null` from the boundary means "I cannot say", never "this file is new".**
  [`resolveWriteDelimiters`](../../../src/lib/latex-parser.ts) is the door every save path
  enters, and it has three answers: an EMPTY file seeds from the style (the
  brand-new case the seed was written for), a located boundary gives the user's
  verbatim delimiters, and **bytes with no locatable boundary** — a fragment a
  master file `\input`s, a preamble-only file, a mid-edit `.tex` — gives
  `{ preamble: "", postamble: "" }`: the whole file is body, so it is written
  back as body with nothing prepended. **A `.tex` with bytes in it must never have
  its preamble replaced by a write nobody asked for**; where we cannot say where
  the preamble ends, the honest answer is to add none. `assembleLatex` reads
  `??` rather than `||` for exactly that: an explicit empty preamble is an
  ANSWER, where `undefined` (a caller that stated nothing) still falls back.
- **The generic primitive earns its keep in ONE silo and is not exported in the
  other.** Python gets `first_live_index_of`, because `region-replace`'s
  `endMarker` is caller-supplied; TypeScript does not, because over there every
  boundary question IS the document boundary and an export with no caller is the
  dead-SSOT shape (task 202). Stated at the Python site rather than mirrored for
  symmetry.
- **The gate must split the document the way the parser does**, or it stays blind
  to the very thing it guards — so `tex-preservation`, `write-preservation` and
  `_common.py`'s `split_regions` all take the same rule. The Python port is held
  to the TS one by a second GOLDEN section in the shared corpus
  (`preservation-corpus.json`'s `boundaryCases`, generated from the shipped TS
  implementation) plus a membership leg pinning `VERBATIM_ENVS_FULL` — which
  caught this task's own port carrying an extra `alltt` the TS family
  deliberately excludes.
- **Unterminated ⇒ TRANSPARENT, and the adversarial pass on this fix is what
  found it.** The projection's default swallows an unclosed verbatim open to the
  end of the source, matching how TeX lexes it — right for a detector, which
  should fail toward not-detecting, and wrong for a boundary: a half-typed
  `\begin{comment}` in a preamble is an ordinary mid-edit state in the code pane,
  and swallowing to EOF erases the `\begin{document}` under it, so the boundary
  vanishes and the save writes the whole file back as body with a `%!v:` anchor
  on every preamble line. That is this repo's own 350/356 rule one layer down.
  `unterminatedIsLive` is OPT-IN, so no detector's answer moved, and a CLOSED
  open is still opaque — which is M4, and the control that keeps the rule from
  reopening it.

Converted: both parser sites, `stripPreamble`, `ensurePreambleRequirements`,
`injectTitleFieldsIntoPreamble`, `mergeTitlesIntoStylePreamble`,
`applyRequirementsToFile`, both preservation gates, `useDocumentStyle.setStyle`
(the whole-preamble style swap — the most destructive splice Virgil makes),
`StyleEditorModal`'s validator (whose two private regex copies rejected a style
blob for a token the compiler never sees), `bib-family`'s and `livePreamble`'s
own splits, and on the Python side `split_regions`, `apply_response.py`'s
`region-replace` splice and its one-`\begin{document}` structural invariant. The
dev backend's three hand copies of the seed rule folded into one
`buildDevSerializeOpts`, the twin of `storage-fsa`'s.

CI: [preamble-boundary-liveness.test.ts](../../../src/lib/__tests__/preamble-boundary-liveness.test.ts).
**No pre-375 suite could see any of this**: every `.tex` fixture in the repo
spells its boundary the one way the code happened to handle, exactly once, live —
so a boundary that MOVES is unrepresentable in all of them, which is how five
members shipped with 7 860 tests green. Each leg drives the REAL save pipeline
over TWO cycles with controls through the identical harness, and asserts content
is inside the printed BODY rather than merely present in the FILE — presence is
what a moved boundary preserves, and asserting it is how such a leg passes
vacuously. The leg with teeth is the CENSUS: no production file may pair a
boundary token with a search verb or a regex (allowlist EMPTY — a hit is
MIGRATE-it), and every file that merely SPELLS one must be a declared EMITTER,
so a new file has to say whether it writes a token or looks for one. Measured by
neutering each half in turn: the live projection takes 7 legs, the token grammar
3, the from-bodyStart ordering 1 (the `\newcommand` shape — M1's comment form is
closed by EITHER half, which is why that leg exists), and the seed rule 1.

**Residuals, stated.** The projection's own over-strip is inherited whole (the 345
residual): a raw `%` inside a `\verb|100%|` or a `\url{…a%20b}` truncates the rest
of that LINE, so a `\begin{document}` SHARING such a line is not found and the
file is written back as body-only. Measured, the write gate REFUSES that write —
the regions disagree across the two sides — so the failure direction is a banner
the user must acknowledge rather than a silent loss, and `\begin{document}` shares
its line with nothing in any real paper. The comment-continuation spelling
`\begin%\n{document}` is likewise not matched, which is exactly today's behaviour.
Neither is closed here, because both belong to the projection's own residual list
rather than to the boundary.

**Owed, not claimed:** a real-FSA open of a paper with a commented-out
`\end{document}`. Nothing here is FSA-masked — it is all `.tex` bytes through the
real save cycle — but the class lands on OPEN, so one eyeball is worth having.

#### The reader half: a LINK resolves where the READER is, not where the author sat

Same law, the other end of the same deployment (task 506) — and the case where a
stated limit was right about one layer and wrong about the one an agent reads
from.

A skill is authored in the repo and READ on a user's synced folder, and the two
layouts are not the same shape:

```
repo                        synced folder
editor/skills/X.md     →    .claude/commands/editor/X.md
editor/scripts/Y.py    →    .virgil/scripts/editor/Y.py
docs/workspace/Z.md    →    .claude/virgil/Z.md
```

In the repo `editor/skills/` and `editor/scripts/` are siblings; on disk
`.claude/commands/editor/` and `.virgil/scripts/editor/` are not. Task 461's
`skill-include-links.test.ts` asserted only the REPO half and named the bundle
half as a stated limit — but its reasoning ("both builders map `<silo>/skills/*`
→ `claude-commands/*` and `<silo>/scripts/*` → `scripts/*`, so the relative shape
survives") is true of the BUNDLE path, where those two ARE siblings under
`public/skill-bundle/<silo>/`, and FALSE of the DISK path. So the 25 links
spelled `../scripts/<helper>.py` were counted as safe while landing at
`.claude/commands/scripts/…`, which exists nowhere; and the 13 spelled
`../../docs/workspace/<doc>.md` landed at `.claude/docs/workspace/…` while the
file itself sat two directories away at `.claude/virgil/<doc>.md`. **Thirty-eight
dead pointers in shipped skills** — a responder skill following one on a real
paper folder gets nothing.

> **A relative link in shipped markdown is re-spelled at the bundle boundary as
> the target's SHIPPED path relative to the linking file's own SHIPPED path —
> both halves read out of ONE map, so they cannot disagree by construction.**
> [`library/build/bundle-sources.mjs`](../../../library/build/bundle-sources.mjs) is that
> map (`shippedPathMap` / `shippedBytes`), and it is also the ONE answer to
> "which files ship?" — four builders and two guards used to hold six
> hand-written copies of that filter.

Seven rules it earned:

- **The rewrite is DERIVED, not a prefix table.** `rewriteScriptPathsForPaper`
  (the pre-existing prose-prefix rewrite, which fixes `python3
  editor/scripts/X.py` INVOCATIONS and is editor-only for a stated reason) is a
  hand-kept pair list. The LINK rewrite reads the map, so a link family nobody
  has written yet is correct for free — and the manifest docs' own pointers into
  the skill set (`.claude/virgil/cards.md` → `../commands/editor/…`) came right
  with no rule about them at all.
- **A link whose target does NOT ship is left exactly as authored**, and whether
  such a pointer belongs in a shipped SKILL is a separate question the guard asks
  separately. Rewriting it would be inventing a path; deleting it would be losing
  a pointer a maintainer reading the repo wants.
- **A repo-only SKILL is declared by a property the corpus already reads.**
  `dream`, `reflect`, `iterate-virgil-editor` and `iterate-skill` open their
  `description` with `Developer-only` — exactly what `virgil/skills/start.md`
  rule 1 routes on ("Do not offer one to an end user"). The builders read the
  SAME declaration and do not ship them, which turns that rule from advisory into
  structural (a skill that is not there cannot be offered) and removes ~72 KB of
  no-op prompt from every paper folder. Discovered, never a name list. They stay
  MIRRORED into `.claude/commands/<silo>/`, because that mirror is the repo's own
  developer surface.
- **The freshness guard needs TWO populations, and they are the same fact.** A
  paper-shaped mirror carries what the bundle SHIPS in the bytes it ships them
  with; the repo's dev mirror carries every non-underscore skill from unrewritten
  source. One `paper` flag decides both, because the shipped SET and the shipped
  BYTES both come from the same module.
- **A drift check asks the bundle what it BUILT FROM rather than re-deriving the
  transforms.** Markdown does not ship verbatim, so a check that DIFFS shipped
  bytes against the SSOT must know every transform — and the day one is added and
  that side has not learned it, every command markdown reports as drifted, every
  night, which is the fastest way to make a check ignorable. `dream.py`'s §1
  preflight used to parse the builder's `PAPER_SCRIPT_PREFIXES` out of the `.mjs`
  source and went quietly `None` for three days when task 374 changed that
  constant's shape. Each sub-manifest now records `sourceDigests` — per shipped
  file, its `repoPath` plus the sha256 of the bytes it was built FROM — and the
  drift check knows no transform at all. Sixty lines of parser and four tests
  deleted; fail-closed on a bundle with no digests, because an empty list there
  would read as "clean" for the whole silo.
- **The census asks the QUESTION, not the mechanism** (task 404's rule). Leg 2
  sweeps every shipped `.md` in every subsystem — the manifest docs included —
  and is satisfied BY CONSTRUCTION, so what it pins is that the rewrite is WIRED,
  which is the part that can silently stop happening.
- **Leg 3's population is SKILL markdown, and the exclusion is stated rather than
  allowlisted.** The operational manifest carries ~200 pointers into `src/**` and
  `docs/architecture/` — provenance notes for a maintainer reading the doc in the
  repo, not navigation an agent performs — and whether a reference doc should
  carry them at all is a product question about that doc's audience. Leg 2 still
  covers its links whose targets DO ship, which is the half that was silently
  broken.

CI: [skill-include-links.test.ts](../../../library/lib/__tests__/skill-include-links.test.ts)
(461's repo leg, plus the two above, both allowlists EMPTY),
[build-editor-bundle.test.ts](../../../editor/build/__tests__/build-editor-bundle.test.ts)
(which transforms a given file takes), and
[skill-bundle-freshness.test.ts](../../../editor/skills/__tests__/skill-bundle-freshness.test.ts)
(the two populations). Measured by neutering each half in turn: dropping the link
rewrite takes 1 leg naming all 38 dead pointers, a shipped skill pointing at a
non-shipping file 1, and reverting `dream.py` to the prefix parse 1. **No pre-506
suite could see any of this**: 461's leg resolves against the REPO tree, where
every one of the 38 links is perfectly valid.

**Verified on a REAL synced layout** rather than only structurally: after a
rebuild, `library-data/`'s `.claude/commands/**` holds **zero** unresolved
relative links (326 resolve); the 204 that do not all sit in `.claude/virgil/`
and are exactly the manifest-doc residual named above.

#### The twin half: a parser that shares SOME vocabularies is how the rest drift

Same law, and the case where the SSOT existed, was read by one layer, and hand-copied by its twin (task 341). `footnote-content.ts` is a COMPLETE second inline parser and serializer — it is what reads and writes every `\footnote{}` body and every note/todo/report/archive card body — built deliberately as a twin of the main one in `latex-parser.ts`. Four vocabularies had already been unified across that seam, each by its own task and each with a comment at the site saying so (`smartenStraightQuotes` 209, `matchInlineVerbAt` 264, `matchCommandToken` 338, `CHAR_ESCAPE_TABLE` 339). Three had not, and every one of them was silent in the direction that matters:

- **Math delimiters.** The fork knew `$…$` and nothing else, so `\(x^2\)`, `$$E=mc^2$$` and `\[x^2\]` in a card body fell through to the PROSE buffer and were char-escaped: `^` became `\textasciicircum{}`, which in math mode typesets a **literal caret**, so every superscript and subscript in the body was lost in the PDF. And the damage was **invisible in the editor forever** — the fork's unescape rung maps the spelling back to `^` on the way in, so the footnote kept looking right while the file on disk stayed permanently wrong.
- **Cite names.** A hand alternation of 17 against the registry's 27, so ten commands (`\fullcite`, `\nocite`, `\citetitle`, `\citeurl`, `\citedate`, `\smartcite`, `\smartcites`, `\footfullcite`, `\citenum`, `\citetext`) became grey monospace text inside a card body while behaving as citations one node up — no card, no panel row, no `.bib` linkage, and the `\vcid` **deleted from the `.tex`** on the next save, since the marker branch consumed it and the cite branch never fired to re-emit it.
- **The cite ARGUMENT grammar**, which is the one that proves sharing a name list is not enough: the fork hand-wrote the multi-cite loop with the per-key brackets consumed only before the FIRST key, so `\footcites[p1][q1]{alpha}[p2][q2]{jones_21}` — a name it already had — let its tail fall through to prose and had the citekey escaped to `\{jones\_21\}` on disk.

> **A registry publishes the whole OPERATION, not the piece that was easiest to share.** The cite scanner (`matchCiteCommandAt`, [cite-commands.ts](../../../src/lib/cite-commands.ts)) answers vocabulary AND argument shape in one call; the math scanner (`matchInlineMathAt`, [latex-lexer.ts](../../../src/lib/latex-lexer.ts)) owns the four delimiter pairs and their escape-aware close search — the same shared-scanner shape `matchInlineVerbAt` already had. Both inline parsers call them at the same position in the same branch order.

Four rules it earned:

- **PARITY is the contract; byte-identity is a stronger claim the reference itself does not meet.** Measured on the pre-fix tree, body text already normalizes `\(x^2\)` and `$$E=mc^2$$` to `$x^2$` / `$E=mc^2$`. So "round-trips byte-identically" and "behaves exactly as body text does" cannot both hold, and the second is the one that names the defect. The suite pins parity plus **idempotency** (the canonical form is a fixed point, so nothing accumulates across saves) and records the normalization as pre-existing main-parser behaviour this task deliberately does not touch. Widening it to preserve the delimiter is a change to the DOCUMENT surface, not a fork repair.
- **An id parked by a marker binds to the atom that follows it, or to nothing.** `pendingCitationId` was a bare field cleared only when a citation consumed it, so a marker whose atom the scanner failed to recognize kept its id alive for the rest of the body and handed it to the NEXT citation — two cards resolving to one identity, the later one writing its edits into the earlier one's `.bib` entry. That was routinely reachable in the fork (whose vocabulary was ten names short) and reachable anywhere by a hand-typed stray marker. [`PendingMarkerId`](../../../src/lib/latex-markers.ts) parks the POSITION alongside the id, so the binding is structural rather than careful, and an unclaimed marker is dropped — right, since it names an atom that is not there. Both markers (`\vfid`, `\vcid`) and both parsers take it.
- **A block-level command inside an ARGUMENT is not a block boundary.** `readParagraph` tested `BLOCK_BOUNDARY_COMMAND_RE` at any depth, so `Text.\footnote{Display \[x^2\] here.}` split at the `\[`: the `\footnote` lost its argument and was demoted to a grey `latexCommand`, `{Display` and `here.}` became prose in two different paragraphs, and the document round-tripped to `\footnote\{Display` / `\[…\]` / `here.\}` — which LaTeX errors on ("Paragraph ended before \footnote was complete") and which emits no `\vfid`, so it had stopped being a footnote at all. The test is now depth-gated. Only the COMMAND test is: the blank-line and comment breaks stay unconditional, and that is exactly what bounds an unbalanced `{` in hand-written source to its own paragraph instead of the rest of the file.
- **The census counts a LIST, not a mention.** "No file spells a cite name" is the wrong needle — a `"\\cite{}"` seed for a fresh citation card is a legitimate default value, and routing it through the registry would buy an index, not an invariant. The needle is *three or more DISTINCT registry names on one line, in code* (comments stripped, string literals KEPT, since the drift lives in regex literals and quoted arrays), which is what an alternation, an array or a Set looks like and what a single seed never does.

**The recorded residual, named rather than allowlisted in silence:** `src/lib/bib-parser.ts` (and `library/lib/bib-parser.ts`, a whole-file copy of it — its own pre-existing fork) holds three more hand lists. Deliberately not folded in, for a stated reason: it answers a DIFFERENT question — parsing a complete command STRING into normalized typed parts — and its natbib/biblatex split IS that normalization, deciding whether pre/post-notes are whole-citation or per-key, not merely recognizing a name. Its lists are also not the registry's: they carry `fullcites` / `footfullcites`, which `KNOWN_CITE_COMMANDS` does **not** have, so deriving them would silently DROP two real biblatex commands unless the vocabulary is widened first — a judgement call about what Virgil recognizes, not a de-duplication. Two other residuals measured in passing and left alone because both are pre-existing and independent of this seam: a `\\[2pt]` hard break with optional spacing is torn into two paragraphs at the block level — **closed by task 349 M4**, see "The provenance half" below — and `$$…$$` demotes display math to inline on BOTH surfaces.

CI: [card-body-inline-parity.test.ts](../../../src/lib/__tests__/card-body-inline-parity.test.ts). Its shape is the whole point — **every pre-existing suite exercises ONE fork at a time** (the parser suites drive body text, the footnote-content suites drive card bodies, and each spells its fixtures the way the code it tests happens to handle them), so a divergence between them is *unrepresentable* in either, which is exactly how three vocabularies drifted with 6 972 tests green. Every leg here drives BOTH surfaces over the SAME bytes, and the vocabularies are swept FROM the SSOTs (`for (const cmd of KNOWN_CITE_COMMANDS)`, `MULTI_CITE_NAMES`, `CHAR_ESCAPE_TABLE`), so a future registry addition is covered by declaration alone. Measured by neutering each half in turn: the math scanner takes 8 legs, the multi-cite repetition 8, the positional marker binding 2, the paragraph gate 2 — and re-introducing a hand alternation in the fork trips the census, which is the shape it exists to prevent. The ten missing cite names were measured directly against the pre-fix tree rather than by that neuter, which under-reports five of them because the old alternation prefix-matched `\citet`/`\cite` out of `\citetitle`/`\citeurl` and then fell through.

#### The default half: what a system does not model, it CARRIES — and a hand list can only be missing a name

Same round trip, one branch over (task 342) — and the case where the two halves of a construct's handling were answered by two DIFFERENT kinds of thing, so they could only agree about the constructs somebody had enumerated.

`\begin{env}` dispatches through one switch with six modeled cases and a `default:`. That default branch neither took the block's uuid nor declared its body literal, and both omissions were invisible in the same way — **the first save looks perfect**:

- **Identity.** The trailing `%!v:` anchor is EMITTED per node TYPE (the serializer emits one for any carrier paragraph that has a uuid, unconditionally) and was HARVESTED per environment NAME, from a hand list of exactly the six names the switch happened to model. So `align` / `equation` / `table` / `tabular` / `center` / `abstract` / `theorem` — every env Virgil doesn't model — was written WITH an anchor and read back WITHOUT one: `assignUuids` minted a fresh uuid **every save**, and the orphaned line was re-read as a standalone empty paragraph. Measured over four cycles on `\begin{align}`: one stray `%!v:` line and one phantom blank block per save, unbounded, with the uuid walking `7a3c → 3f63 → e770 → dbe1` — so every note / todo / archive / marginalia card anchored to that block orphaned on every save, with **no edit by the user**. `itemize` was a clean fixed point beside it, which is why it read as latent.
- **Byte-literalness.** The carrier text wore the `latexCommand` mark, whose serializer path runs `smartenStraightQuotes`. A fancyvrb `\begin{Verbatim}` body reading `print("hi")` came back `print(``hi'')` on the first save — stable on the corrupted form, invisible in the editor forever (the unescape rung maps it back on the way in), and visibly wrong in the compiled PDF as literal backticks. `alltt` and `comment` the same; `lstlisting` was clean, being on the list.
- **And a third, found by measurement rather than by the report:** the whole-document `\n{3,}` collapse stashed only the verbatim FAMILY — another list of names — so an `align` body with a three-blank-line gap came back with one.

> **An environment the system does not model is BYTE-LITERAL by definition, and it carries its own identity.** It is raw source being conveyed through — nothing downstream is entitled to rewrite it, and the node that conveys it is a node like any other. Where a capability is EMITTED from the node model and CONSUMED from a list of names, the list is the bug: delete it, don't extend it.

Four rules it earned:

- **The right list of exceptions was EMPTY, so the derivation replaces the list rather than growing it.** Every branch of the switch produces a node and the serializer anchors every carrier node that has a uuid, so the harvest is unconditional for every env name. Safe by construction rather than by care: `NODE_UUID_ANCHOR` is start-anchored with `[ \t]*`, so it can match nothing but an anchor on the SAME line as the `\end{env}` just consumed — which is precisely where this env's own carrier would have put it. (Check the one asymmetry before copying this: an env branch that produced NO node would still have to CONSUME the anchor rather than leave it in the stream.)
- **Widening the vocabulary fixes the names you thought of; moving the DEFAULT fixes the ones you didn't.** Making `default:` the byte-literal carrier covers every environment Virgil will ever fail to model, including ones that don't exist yet. `VERBATIM_ENVS_FULL` then decides only the RICHER treatments — the `codeBlock` node, first-close-wins end-finding, and inertness to every scanner that projects live LaTeX (`\documentclass` detection, `\label`/`\ref` resolution, the syntax checker) — never whether the user's bytes are safe. That also collapsed the family's own special-case branch into `default:`, which now produces byte-identical nodes.
- **The membership criterion is what the membership BUYS, and that is what keeps `alltt` out.** The family is "does this body execute as LaTeX?", so `Verbatim`/`BVerbatim`/`LVerbatim` (+ starred) and `comment` joined — the linter already knew the last two, and the SSOT was the SHORTER list, and the one the round trip read. `alltt` looks verbatim and isn't: `\`, `{` and `}` keep their meanings, so its refs are real refs and its braces are real braces. Its bytes are safe anyway, which is exactly the point of the default.
- **The collapse asks "did WE write these bytes?", not "is this env verbatim?"** — the same substitution one file over. `SERIALIZER_GENERATED_ENVS` (quote / itemize / enumerate / figure / figure* / xlist) is the serializer's own emit set and the stash is its COMPLEMENT, so a carried env is protected whether or not anyone named it. Bare `verbatim` is deliberately not a member although its wrapper is generated: its BODY is the thing the collapse must not touch.

**Residual, stated:** the stash's non-greedy tail stops at the first `\end{<same name>}`, so a carried env nested inside another of the same name leaves the outer tail unstashed. Correct for the whole verbatim family (non-nestable by construction) and a stale-blank-line risk only for a self-nested `tabular`/`align` — which the pre-342 code got wrong for *every* env rather than one shape of one. Serializer cost was measured rather than assumed, since the pattern now runs against every `\begin{` instead of four names: 1 000 `align` blocks 1.2 ms, 1 000 unmatched `\begin{}` 1.2 ms, against a 1 000-paragraph prose baseline of 1.6 ms.

CI: [unmodeled-env-roundtrip.test.ts](../../../src/lib/__tests__/unmodeled-env-roundtrip.test.ts). Its shape is the point and it is why the pre-fix tree was green: **the accumulation is invisible to a single round trip** — cycle 1 looks perfect — and every existing round-trip suite spells its fixtures with the envs the code happens to model. So each leg runs the REAL `parseLatex` → `assignUuids` → `serializeBodyOnly` loop over four cycles, asserting byte-identity from cycle 1, an unchanged uuid, and an unchanged top-level block count, with `itemize`/`quote`/`lstlisting`/`verbatim` as passing CONTROLS so no leg passes vacuously. Two censuses carry the teeth — no file but the lexer may spell a family member in code, and every literal `\begin{env}` the serializer emits must be a declared generated env (membership DISCOVERED from that file's own source, never re-listed in the guard) — plus a behavioural leg driving the real parser per declared member, which is the direction with the consequences: a STALE member would collapse user-written bytes. Measured by neutering each half in turn: the uuid hand list takes 18 legs, the `latexCommand` mark 18, the family-scoped stash 2, a re-declared linter list 2, a stale generated member 2, an undeclared emit 1.

**…and the first of those censuses was itself a hand list (task 358).** It watched ONE member (`lstlisting`), so widening the vocabulary did not widen the guard: the five names 358 was filed about joined the SSOT with the census blind to any fork that spelled them, and a fancyvrb-only copy (`Verbatim` + `BVerbatim`) would have passed. Every needle is now built FROM `VERBATIM_ENVS_FULL`, in the three shapes a fork actually takes, each measured to drain to EMPTY on the current tree: **A** a second COPY of the list (≥2 distinct members within four lines — one member's name proves nothing, since `comment` is a revision/cutter record kind and `minted` is a local in the drop controller); **B** a hand-spelled family ENV (`\begin{<member>}` / `\end{<member>}`, the single-member fork — a private skip or terminator, which decides both end-finding and inertness privately); **C** a per-member special CASE (the bare quoted literal). Only C needs exemptions and both are scoped to the shape they justify: the parser's `case "verbatim":` per LINE by source fragment, since it is the one member with a modeled node; and the NAME `comment`, whose collision with the card record kind is **checked** rather than asserted (a leg reads `kind: "comment";` out of `src/lib/types.ts`, so a rename retires the exemption with it) and which A and B still cover. Stated limit: C sees quoted spellings, so a bare `lstlisting` identifier — a variable name, not a family decision — is no longer flagged. The two REPORTED fixtures are pinned in the reporter's own spelling in [nested-construct-opacity.test.ts](../../../src/lib/__tests__/nested-construct-opacity.test.ts) beside an `it.each` sweep of the same property over every member; the `comment` one fails when the names are removed, while the fancyvrb one is a PROPERTY pin — measured, it still passes under that neuter, because 342's default carrier is a second independent net for the bytes.

#### The attr half: what one side WRITES from a derivation, the other must not READ from a hand list

Same round trip, one field over (task 343) — and the case where both halves were already lists of node types, one derived and one hand-written, so they could only agree about the kinds somebody had remembered.

`parTitle` (the optional user-typed title in the strip above a block) and `collapsed` are **sidecar-only**: `\partitle{}` is parsed for legacy migration and nothing serializes it, so `virgil/virgil.json` is the sole carrier and `mergeSidecarTitles` is its only reader anywhere in `src/`. The WRITE walked `UUID_BEARING_NODE_TYPES` — which includes `exampleBlock`; the READ hand-listed four names. Exactly five node types declare a `parTitle` attr, so exactly one was write-only. Click the title strip above an expex example, type a name, save: the title lands on disk correctly, the reload refuses to look at it, and the **next save serializes the now-title-less doc back over the entry**. Destroyed with no warning and no undo, while paragraph / bulletList / orderedList / texBlock behaved — which is why it read as flaky rather than broken.

> **Where two halves of a round trip must agree about which node types carry an attr, they read ONE declaration — and because the parser and serializer are TipTap-free by construction, that declaration is CHECKED against the real schema in CI rather than maintained by hand.**

[src/lib/node-attr-sets.ts](../../../src/lib/node-attr-sets.ts) is the declaration — `UUID_BEARING_NODE_TYPES` (moved out of the serializer), `TITLED_NODE_TYPES`, `COLLAPSIBLE_NODE_TYPES` — an import-free leaf, the placement rule `latex-markers.ts` earned in task 255: a facet the layer that needs it cannot import will be re-copied, every time. Four rules it earned:

- **The premise is CHECKED, not restated** — the same instrument task 148 earned one registry over. The sets can't be derived where they live, but a suite can build the REAL main-editor schema and assert each one equals the node types declaring that attr, so a schema addition fails the build instead of silently going write-only. Measured: the schema's `uuid` set was already exactly the serializer's sixteen-name list, so the pin costs nothing today and is the only thing that will notice tomorrow.
- **Symmetry is made structural on BOTH sides.** `extractSidecarData` now asks the same two sets it is read back by, so "what is written is what can be restored" is a property rather than a coincidence. Behaviour-neutral today (TipTap drops undeclared attrs, so a non-titled type cannot carry a meaningful `parTitle`) — the point is that a write set broader than the read set is precisely the shape that destroyed the title.
- **`collapsed` was the one-member hand list beside it**, gated `node.type === "texBlock"` inline. Only `texBlock` declares it, so that list was *true* — and a one-member hand list is exactly what becomes the next 343 when a second collapsible kind ships. It is a checked set now for the same reason.
- **The same class was live one branch over, and measurement is what found it.** `assignUuids` minted from its own hand list of seven and skipped **`texBlock`** and **`exampleItem`**, both of which it happily *dedups* against the derived set. A uuid-less texBlock serializes as `%!vtex:begin ` with an empty id, which the parser cannot match: the block comes back as a `latexComment` plus a paragraph whose raw LaTeX has been through smart typography (`--` → `–`) — the user's passthrough source shredded, silently. So the mint is now the DEFAULT (every uuid-bearing type except `paragraph`, whose identity is genuinely conditional: non-empty, not inside a container), which is 342's rule applied to a list of kinds instead of a list of env names. This heals rather than changes: the parser and `BlockUuidBackfill` — whose own eligibility is already schema-derived (`spec.attrs.uuid !== undefined`) — cover every real document, which is why the gap had stayed latent.
- **And a mutator's GATE is part of the mutator.** `needsUuidWork` is the read-only twin both save backends consult *before* they deep-copy and run `assignUuids` at all, and it carried its own copy of the same list of seven — so moving the mint to a derivation and leaving the gate behind would have shipped a heal that production can never reach, with the sibling equivalence suite still green because it pinned the pair over HAND-WRITTEN fixtures and therefore spoke only for the kinds someone had thought to write down. It reads the SSOT too, and its sweep is driven per member OF the set. The general form: **when a rule moves to a derivation, the predicate that decides whether the rule RUNS is a second implementation of it** — and a `?`-shaped equivalence test between the two proves nothing about the members neither side enumerates.

CI: [node-attr-sets.test.ts](../../../src/lib/__tests__/node-attr-sets.test.ts). The round-trip legs are driven **per member OF the set**, so the next titled kind cannot ship write-only — it arrives with no fixture and the coverage leg fails first — and each runs two full cycles, because cycle 1 shows the loss and cycle 2 is where the sidecar entry is *overwritten*. The four working kinds stay as passing controls so no leg passes vacuously. The census forbids any file that touches a sidecar `paragraphs` map from re-listing three or more titled node types (the legitimate `CONTAINER_TYPES` sets name two and answer a different question, so they sit below the needle rather than in an allowlist), with synthetic canaries rather than ones standing on the drained defect. Three properties of it are load-bearing: its scope is **DISCOVERED** from the accessor rather than hand-listed (a hand list inside the guard that outlaws hand lists is this defect one level up — it could only speak for the files someone remembered); it splits on `;{}` so it sees a `||` **CHAIN** as well as a bracketed array, because the two lists this task deleted had different shapes and a bracket-only needle would have been blind to the second one in the very commit that fixed it; and the import leg strips comments and requires a real binding `import`, since `toContain("@/lib/node-attr-sets")` over raw source is satisfied by a comment reading "mirrors …, keep in sync" — the fork the whole task exists to prevent. The MINT half is deliberately **not** censused and the suite says so: `assignUuids`' list named only one *titled* type, so a titled-name needle is structurally blind to it and widening it to all sixteen names flags every legitimate content classifier in these files (measured: seven sites). That half is guarded behaviourally instead, by the sibling equivalence sweep — which is strictly stronger than a grep, and is what caught the real one. Measured by neutering each half: the read-set derivation takes 2 legs, the `assignUuids` default 4, the `needsUuidWork` gate 2 (`texBlock` and `exampleItem`, exactly).

#### The carrier half: what a system does not TYPESET, it still has to CARRY

Same round trip, and the construct that appears in every real `.tex` (task 347). 342's rule — *what the system does not model, it CARRIES* — had never been applied to the `%` comment, so a comment was **three different things in three places**: carried (at the head of a line), invisible (inside an expex body), and prose-to-be-escaped (mid-line). Every member was a **fixed point**, so no later save healed it, and all of it landed on OPEN, since `readDocBundle` runs the save pipeline and then fires `writeReStampedTexOnLoad` unconditionally. Measured at `552eeda7`:

- **DELETED.** A `%` line inside an `\ex`/`\pex` body was dropped outright — the user's writing, gone on the first open. `parseExampleBodyAsBlocks` runs `parseBody` (which builds a correct `latexComment` node) and then filters its children to a whitelist an example item's schema can hold; `codeBlock` had been given a byte-literal carrier paragraph by task 264 and `latexComment` never was. `itemize`, `quote` and `figure` all preserved theirs, which is what localizes this to the one splitter rather than to a policy.
- **PROMOTED.** A mid-line `%` fell into the prose buffer, and the char-escape table then rewrote it to `\%`. So `% TODO cite` and `% fix this` — the most ordinary annotations in academic LaTeX — **started typesetting in the compiled PDF**, and afterwards nothing could distinguish a promoted comment from a `\%` the user actually wrote. `Growth of 5%` began printing the text LaTeX had been discarding; `continues%` at end of line, which is TeX's line-JOIN idiom, became a printed percent that keeps the space.
- **SPLIT.** A comment line between two prose lines ended the paragraph, and the serializer then wrote a blank line around the `latexComment` block it had made — so one LaTeX paragraph became two in the PDF.
- **DE-IDENTIFIED.** `stripUuidAnchor`'s end-anchored regex failed whenever anything followed the anchor, so `Some prose. %!v:aaaa % user note` (reachable by typing in the code pane) lost the block's uuid on the next save, orphaning every card, marginalia marker and sidecar title keyed on it.

> **A comment is CONTENT. What LaTeX declines to typeset, Virgil re-emits verbatim — and it needs a representation to do that, because a construct with no representation falls into the prose buffer and the escape table decides its meaning.**

`LATEX_COMMENT_TAIL_MARK` ([latex-lexer.ts](../../../src/lib/latex-lexer.ts)) is the third member of the carrier family, beside `latexCommand` ("raw LaTeX the editor doesn't model") and `latexVerbatim` ("these bytes are literal"). It says something stricter than either: **not typeset at all**. It is a separate mark for the two reasons task 264 gave for splitting `latexVerbatim` off `latexCommand` — a mark that declares attrs changes the JSON shape of every existing carrier, and two distinct mark types can never be merged into one text node — and, like its sibling, it is re-derived from the source bytes on every parse, so it needs no representation in the `.tex` and nothing to migrate. Six rules it earned:

- **The recognition belongs INSIDE the inline scanner, not ahead of it.** A pre-split of the paragraph text on `%` would have been the obvious move and would have broken task 338's own `\url{http://ex.com/a%20b}` case. By the time the carrier branch is reached, every command / verb / math matcher has already declined this byte, so a `%` inside a `\url{}`, a `\verb|…|` or `$…$` was consumed as part of that construct and never reaches it. The `\%` escape is safe for the same structural reason: an escaped percent enters the `\` branch and is consumed by `matchCharEscapeAt`.
- **The default is OFF, and the default is the load-bearing half.** A comment tail owns everything to the end of its LINE, so it may only be recognized where the emitted form actually ends a line. `parseInlineContent` recurses into six braced ARGUMENTS (`\texttt{}`, `\textbf{}`, a `\footnote{}` body, a heading, a gloss cell, a figure caption), and there the next byte the serializer writes is the closing `}` — a carrier would comment out the brace and break the document. So the two block-level paragraph callers opt IN (`PARAGRAPH_INLINE`) and a new caller has to state that its content is line-final before it can get one. Escaping to `\%` inside a braced argument is the CORRECT behaviour, not a divergence.
- **The line obligation is the carrier's own, and it is reachable from the KEYBOARD.** Nothing the serializer writes after a tail may share its line, or it stops appearing in the PDF while round-tripping perfectly — this task's defect arriving through typing instead of through save. Closed at both ends: `inclusive: false` on the mark (text typed at the trailing edge does not inherit it) and `closeCommentTail` at the emit end. Byte-neutral for everything the parser produces, which always leaves the newline at the head of the next prose run. The one `lineFinal` exemption is stated where it is taken: a paragraph and a list-item head, whose next bytes are a `%!v:` anchor — comment bytes — and then a newline.
- **The anchor IS a comment, which is what makes the identity fix small.** `stripUuidAnchor` gained one optional group for a comment remainder after the anchors, so the anchor may ride at the end of a tail (`… % user note %!v:aaaa`) — canonicalized once on the first save and stable after. It still requires the anchors to be present, so it can never mistake a trailing `\url{…a%20b}` for one.
- **The paragraph break was a MODEL error, not a formatting one.** In LaTeX a `%` line between two non-blank lines is discarded with its newline, so `A\n% c\nB` is ONE paragraph. `readParagraph` no longer breaks there. The two shapes that genuinely separate paragraphs still do, because both are blank-line shapes — and the distinction the pre-347 parser could not draw is precisely the one LaTeX draws.
- **…and dropping that break re-opened 338's hazard until the boundary test learned the same rule.** A block-level command inside a COMMENT is not a block boundary — 341's brace-depth gate, one construct over — so `% \end{itemize}` was being split into an empty `%` plus a live-looking terminator. The gate reads `startsLineComment` (the SCAN's rule, deliberately NOT TeX's), so `readParagraph` and `findMatchingEnv` agree by construction about where a construct ends; reading the wider rule here is the layer disagreement whose one failure direction swallows the rest of the document.

**Task 338's recorded premise was FALSE and is corrected rather than left standing** — in its own task file and at the definition that taught it. It read: *"mid-line a `%` is ordinary prose it preserves byte-for-byte — verified against the real parser."* The `\url` half was true; the first half was verified on the PARSE side and the EMIT side was never asked. The narrowing 338 made was right and must not be reverted; what was wrong was the reason given for it being harmless.

CI: [comment-carrier-roundtrip.test.ts](../../../src/lib/__tests__/comment-carrier-roundtrip.test.ts). Every pre-347 suite spells its fixtures the way the code it tests happens to handle them and exercises one construct at a time, so a comment reaching the escape table was **unrepresentable** in all of them — which is how this shipped for a year with the suite green. Each leg drives the REAL save pipeline over TWO cycles (cycle 1 is where the loss happens; cycle 2 is what proves nothing accumulates), with the controls — `itemize`/`quote`, a block-boundary comment, 338's own `\url`, and a genuinely AUTHORED `\%` — through the identical harness so no leg passes vacuously. Measured by neutering each half in turn: the emit escape takes 12 legs, the parse branch 11, the paragraph break 2, the expex carrier 2, the anchor remainder 1, the line obligation 1, the in-comment boundary gate 1. **The M4 leg's first draft passed under its own neuter** and is worth remembering: it grepped `%!v:` in the emitted bytes, and a DEAD marker stranded inside a comment still matches — so it read the identity as preserved while a fresh uuid had been minted beside it. It asks the parsed node's `uuid` attr now. The same pass found the `\ex` leg satisfied by the paragraph fix rather than by the splitter carrier, so a comment-BEFORE-prose shape was added, which is the one that reaches it.

**Residuals, stated.** The carrier is scoped to the MAIN document body: `footnote-content.ts`, the second inline parser (card bodies and `\footnote{}` arguments), keeps escaping `%` to `\%` — correct there by the argument rule above, and a deliberate asymmetry rather than a fork to close. A mid-line `% \end{env}` after prose is still read as live by both the scan and the boundary gate, which is 338's own stated residual, unchanged in kind. And the two paragraph legs of the round trip move bytes exactly once: an anchor typed before a comment is canonicalized to sit after it, and a paragraph ending in a comment inside an expex body gains one blank line before its `\xe`.


#### The position half: a marker is DETACHED where it is APPENDED

Same round trip, and the case where one marker's two halves each stated its position independently — with a comment in the emitter asserting that they agreed (task 348). Every block emitter appends its `%!v:` anchor after its own last byte, which is where `stripUuidAnchor` takes it off; the **`listItem`** did not. It wrote the anchor after the item's HEAD LINE and let tail children follow beneath it (`\item Head. %!v:me` / `\begin{itemize}…\end{itemize} %!v:child`), while `ITEM_TRAILING_UUID_REGEX` read from the end of the whole item SLICE. For an item with a tail those are different places, and neither is exotic — a sub-list under a bullet, or a bullet with two paragraphs.

Measured through the real save pipeline, two consecutive saves of Virgil's OWN canonical output: the item took whatever uuid sat at its slice end — for a nested list, **its own child's** — and the child was re-minted as a duplicate. It **never converged**: every save shuffled again, on a document nobody was editing, so any note / todo / archive / marginalia card anchored to that item or that sub-list pointed at a uuid that had moved to a different node, and the disk ledger, the `DiskWatcher` and git all saw a moving `.tex`. The un-consumed head-line marker then rode the next parse as content (pre-347 it was `\%`-escaped into printed text; post-347 it survives as comment bytes — the identity defect underneath is the same either way).

> **Where a marker is written and where it is read are ONE rule, stated once. A construct's `%!v:` anchor is APPENDED to the end of its serialized body and DETACHED from the end of that body — [`appendUuidAnchor` / `detachUuidAnchor`](../../../src/lib/uuid.ts), exact inverses, and nothing spells the token by hand.**

Six rules it earned:

- **Put the anchor where the reader can find it WITHOUT knowing the structure.** The reader has a flat slice; only the emitter has the node tree. So the position that can be stated once is the one that needs no structural knowledge — the end. Reading from the head instead was the smaller diff and is not generally possible: an item whose head paragraph WRAPS across lines (ordinary hand-written LaTeX) puts the head's last line somewhere no flat rule can identify.
- **Stacking is safe because the detach takes exactly ONE, greedy-prefixed.** An item whose last tail child is uuid-bearing now ends `\end{itemize} %!v:child %!v:me`, and the greedy prefix means the LAST anchor wins — innermost-first by construction. This is why the item's door is **not** `stripUuidAnchor`, which consumes a whole RUN: sharing that one would recover the parent's id by destroying the child's. A block never has this shape (its inner children serialize with uuids suppressed), which is the honest reason the two doors differ rather than a tidier one.
- **The upgrade is part of the fix.** Reading an existing document with the new rule alone would take the slice-end anchor exactly as the pre-fix reader did — shuffling every nested item's identity ONE more time on the upgrade save, orphaning the cards this task exists to protect. `detachItemAnchor` therefore carries a narrowly-signed legacy branch: more than one line AND the FIRST line ends with an anchor. Under the current emitter a tail-bearing item's first line ends with the head's prose and a single-line item has no second line, so neither can be mistaken for it; and it is deliberately the FIRST line rather than "any line but the last", since a deep nesting puts a grandchild's `\end{itemize} %!v:…` on a non-last line and a looser rule would steal it. **Stated gap:** a legacy item whose head WRAPPED is not recoverable — it degrades to the pre-fix behaviour once and is stable after.
- **The SEPARATOR was the same defect in the structural axis, and its rule is the PARSER's own.** The head was joined to the tail by a single `\n`, which does not end a paragraph — so an item with a second paragraph came back MERGED into one on the next open, the user's paragraph break destroyed with no edit, and since 347 a comment line inside an item does the same. The separator now asks [`startsBlockBoundary`](../../../src/lib/latex-lexer.ts), the predicate `readParagraph` itself reads (moved to the lexer leaf so both halves can reach it). A nested `\begin{itemize}` is self-delimiting, so it keeps its single newline and **every existing document's nested lists reformat by nothing at all** — which a hand list of self-delimiting child kinds would also have achieved, and would have gone stale the way 342's did.
- **The token's EMIT form is spelled once, everywhere.** The fifteen hand-built `` ` %!v:${uuid}` `` strings in the serializer (and the `%!v:blank` sentinel) now go through `uuidAnchorSuffix` / `uuidAnchorToken`. Byte-neutral — the whole round-trip corpus is the proof — and it is what gives the census something to ask.
- **The pre-fix suites could not see any of this, and the reason is the fixture.** Every list round-trip suite spells its items with a SINGLE paragraph, where the head line IS the slice end and the two positions coincide by accident; the disagreement is unrepresentable in all of them. Nothing about care would have helped.

CI: [list-item-anchor-position.test.ts](../../../src/lib/__tests__/list-item-anchor-position.test.ts) drives the REAL `parseLatex` → `assignUuids` → `serializeBodyOnly` loop over FOUR cycles per item shape (a single trip looks perfect for the two-paragraph case and merely *starts* the shuffle for the nested one), keying every uuid by STRUCTURAL PATH so a steal reads as two changed paths and a re-mint as one, with the simple and wrapped single-paragraph items as passing CONTROLS. The leg with teeth is the **census**: the pair was never the part that could misbehave — an emitter spelling its own template is, and that is exactly what shipped. Measured by neutering each half in turn: the pre-fix pair takes 10 legs, the separator 2, the upgrade branch 3. The emit position ALONE takes 1 — the wrapped head with a tail — and that is recorded rather than hidden, because the upgrade branch is a fully general reader for a single-line head and masks a reverted emit everywhere else; that shape is in the fixture list precisely to keep the emit rule honest.

**Residuals, stated.** The census covers the EMIT form; the READ side still has four private `%!v:` regexes (`stripUuidAnchor`, `latex-paragraph-map`, and the two preamble helpers) answering differently-shaped questions — a separate sweep, not claimed here. `exampleItem` was checked rather than assumed and does **not** share this bug: it carries a `\vxid{…}` PREFIX marker, which is positionally bound to the item's own token and needs no end-of-body rule; `blockquote` serializes its children with uuids suppressed and anchors after `\end{quote}`, measured stable. Two adjacent quirks were measured while checking those siblings and left alone as pre-existing and independent: a multi-paragraph `blockquote` glues its `\end{quote}` onto its last paragraph (top level and inside an item alike), and `parseExampleBodyAsBlocks` DROPS a nested `itemize` inside an expex `\a` item outright — the second is content loss and is recorded for triage rather than folded in here.

##### The reach half: a census that discovers by MECHANISM cannot see a reader that only asks the QUESTION

Same set, and the case where the SSOT was right, the write side was right, the
round trip was right, and the guard that would have caught the rest had a
POPULATION scoped to the write side's silo (task 404).

343 gave `parTitle` its declaration and pinned it with a census whose scope is
DISCOVERED rather than hand-listed — the rule this file states everywhere, and
correctly applied. What it discovered by was the sidecar `paragraphs` MAP: the
mechanism the WRITE side uses. So its population was the parser and the
serializer, and **five UI READERS each hand-listed THREE of the set's six
members**, none of them ever in the population:

| reader | what it costs |
|---|---|
| `section-path.ts` — the shipped breadcrumb primary | the breadcrumb omits the titled block you are standing in |
| `OutlinePanel.tsx` | no Outline row at all: nothing shows the title, renames it, or folds it |
| `SearchPanel.tsx` | a hit inside the block breadcrumbs to the section instead |
| `EditorLayout.tsx` — the section tracker's legacy fallback | a fast-path/fallback divergence |
| `reader-view-prefs.ts` — the Reader's twin | the same, one surface over |

A title typed on a `texBlock`, a `forestBlock` or an `exampleBlock` was written,
persisted, reloaded onto the node — and invisible on every surface that could
have shown it. Nothing threw; the round trip that 343 pinned was intact the
whole time. **The suite's third layer was even NAMED "the round-trip layer holds
no second hand list" — the scope sentence IS the defect.**

> **Discover a census's population by the QUESTION, not by the MECHANISM.** The
> question here is the ATTR NAME; the mechanism is one silo's way of touching
> it. A file that only ASKS ("is this block titled?") writes no sidecar map,
> spells no write-side API, and is invisible to any predicate written about how
> the answer gets to disk.

Six rules it earned:

- **The defect is a partial READER, not a missing affordance**, and the framing
  is what scopes the fix. Nothing in the Outline can CREATE a title; the Outline
  could only fail to show one that already existed. So the fix is five call
  sites, not a new surface.
- **It must LEAD with the shipped primary.** `computeSectionPathAt` is the path
  that actually runs; the `EditorLayout` / `reader-view-prefs` walks are its
  FALLBACKS. Converting the fallbacks alone is a no-op that introduces a
  fast-path/fallback divergence — the thing each fallback exists not to be.
- **A written decision is renegotiated in place, never silently contradicted.**
  `section-path.ts` carried one — *"tex/expex par-titles are deliberately not
  breadcrumb entries"* — which read as a bug-compatible port of the fallback's
  vocabulary rather than independent product judgment. It is retired with its
  reason at the site: a breadcrumb that omits the block you are standing in is
  the invisibility bug by another name.
- **Where the derived flag is TOTAL, the flag IS the membership test.**
  `BlockEntry.parTitled` is `deriveParTitled(attrs)`, and ProseMirror drops an
  undeclared attr — so only a member can carry one and there is no second
  vocabulary to drift. `section-path` reads the flag alone; the four JSON/PM
  walkers, which see raw nodes, ask `TITLED_NODE_TYPES.has(...)`.
- **The MUTATOR's domain is the set too, and a NEGATIVE guard is not a domain.**
  `renameParTitleByUuid` guarded `node.type.name !== "heading"` — right about the
  one type it names (`OUT-F8-04`) and wrong at both ends: it admits every titled
  kind by luck, and it admits every type that declares no `parTitle` at all,
  where PM drops the attr, `setAttrs` reports success, and the rename is a
  mis-write that silently did nothing. The positive test refuses a heading for
  exactly the same reason it refuses a `figureBlock` — neither is a member.
- **The IMPORT leg stays narrow while the HAND-LIST leg widens**, and that
  asymmetry is deliberate: "does the file that must enumerate node types read the
  SSOT?" is a claim about the round-trip layer, and a NodeView that declares
  `parTitle` on ONE node type answers no set question and owes no import. Two
  populations, two questions — widening both would be a census demanding a
  dependency nothing needs.
- **The DECLARATION is not a copy of itself.** The pre-404 predicate excluded the
  leaf by accident (it touches no `paragraphs` map); the attr-name predicate has
  to STATE the exclusion, and states it by PATH rather than by segment content —
  an allowlisted segment goes stale the moment a member is added, and would
  excuse the same literal appearing elsewhere.

**Deliberately NOT generalized to `COLLAPSIBLE_NODE_TYPES` /
`UUID_BEARING_NODE_TYPES` / `CARD_BODY_BLOCK_ATOMS`** — checked, and none has a
partial reader. The phenomenon is specific to `parTitle`'s UI silo, and widening
here would be the "broadest blast radius" mistake the central principle warns
against.

**DISPLAY is undifferentiated, stated at the site:** every titled kind's Outline
row takes the one `--par-title-color-dense` ink, because that is what the set
already means. Typing the rows by kind is a `STYLE_GUIDE` decision worth its own
pass.

CI: the widened census in
[node-attr-sets.test.ts](../../../src/lib/__tests__/node-attr-sets.test.ts) is the leg
with teeth, and its membership assertion names all five readers plus the mutator
— reverting ANY ONE of them to its three-name chain can only fail the hand-list
leg while that file is in the population at all. Beside it, the behavioural
halves are swept FROM the set, so a seventh titled kind arrives with no fixture
and fails before it can ship: `renameParTitleByUuid` is driven per member in
[structural-edit.test.ts](../../../src/lib/tiptap/__tests__/structural-edit.test.ts) with
`figureBlock` as the control the negative guard admitted, and `extractHeadings`
per member in
[outline-fold-by-uuid.test.ts](../../../src/panels/Outline/__tests__/outline-fold-by-uuid.test.ts)
— a row exists, and its uuid is INSERT-STABLE, so the persisted fold bucket still
holds the same string after a block is added above. Measured by neutering each
half in turn: each of the five readers takes the census (measured per reader, not
assumed), the negative mutator guard takes 1, and the pre-404 OutlinePanel chain
takes 6 — three missing kinds × two legs, with the three working kinds passing as
controls.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live editor gesture
plus a JSON walk — no disk), so the check is cheap and real: give a `texBlock` a
title from its pod's `+T`, and the Outline shows it, renames it, and folds it.


#### The multiplicity half: a scan that recognizes a CONSTRUCT must recognize how MANY

Same round trip, and the case where the model held exactly one of something a
figure may carry several of — so the extras strip cut EVERY occurrence while the
emitter re-wrote ONE (task 379). Three members, all silent, all landing on OPEN
via `readDocBundle`'s unconditional load-writeback, and none of them visible to
the write gate (the shortfall is 3 word tokens against
`PRESERVATION_SLACK_WORDS = 4`):

- **A second figure-depth `\label` was DELETED, and the WRONG one survived.**
  `extractFigureAttrs` kept `labels[0]` — the first in source order — while the
  strip cut them all. `\caption` calls `\refstepcounter{figure}`, so a `\label`
  written after the caption is the key that names the figure and one written
  before it names whatever was stepped last (normally the section). So
  `\includegraphics{a}\label{fig:one}` + `\caption{c}\label{fig:two}` came back
  with `fig:two` gone and `fig:one` silently PROMOTED from naming nothing to
  naming the figure: every `\ref{fig:two}` in the paper became `??`, and every
  `\ref{fig:one}` started resolving to a number it had never had.
- **A caption-carried label plus a body-level one looked fine for ONE cycle.**
  Cycle 1 kept both (the attr held `fig:out`, the caption's own bytes held
  `fig:in`); cycle 2 read `labels[0]` as the in-caption `fig:in`, suppressed the
  figure-level emit as a duplicate declaration, and cut `fig:out` out of extras —
  so the body-level key vanished on the SECOND save. Not a fixed point, which is
  the one thing the corpus invariant could have caught if any fixture had had the
  shape.
- **Two figure-depth `\caption`s OSCILLATED forever.** The scan takes the first
  and the strip cut only that one, so the leftover was re-emitted from `extras` —
  i.e. AHEAD of the caption the model kept. The two traded places on every save
  of a document nobody was editing, moving the `.tex` under the disk ledger, the
  DiskWatcher and git.

> **The model holds ONE caption and ONE label, so the strip cuts exactly those
> two and everything else survives — on the SIDE OF THE CAPTION it was written
> on.** `extras` is the body before the caption and `trailingExtras` the body
> after it; the emitter writes `extras + \caption + \label + trailingExtras`.
> And the label the model keeps is the one LaTeX would resolve `\ref` to: the
> FIRST at or after the caption, falling back to the first when there is none.

Four rules it earned:

- **The position is the whole of it, and a plain `extras` is not enough.** The
  site's pre-379 note said leaving extras in `extras` "would move it ahead of the
  caption on re-emit and oscillate", and measurement confirmed that for the
  no-caption pair. But oscillation is the lesser half: a label re-emitted on the
  wrong side of the caption **stops naming the figure**, silently. So the carry
  is position-aware — task 342/356's "carry what you cannot model, in the
  position it was in", read one axis in.
- **No cut can straddle the pivot, which is what makes the split arithmetic
  honest.** The pivot is the caption's start (or the binding label's, or the end
  of the body), the caption cut begins exactly there, and a binding label outside
  the caption lies wholly on one side of it. Stated at the site rather than left
  to be re-derived.
- **The second caption cost nothing extra.** Nothing in the split is
  label-specific — it cuts the two commands the model holds and carries the rest
  — so the caption oscillation closed by construction rather than by a second
  rule. That is the test of whether a fix is at the right altitude.
- **`extractLabel` was DELETED rather than corrected.** An exported helper with
  ZERO callers anywhere (task 202's dead-SSOT shape) that stated the RETIRED rule
  — the next reader reaching for it would have re-introduced the defect with a
  name that looked authoritative.

**Stated normalizations, both one-time and idempotent.** A `\caption` written
INSIDE a transparent box env (`\begin{center}…\caption{C}…\end{center}`, a very
common idiom) now stays inside it, where pre-379 the whole box was extras and the
caption was re-emitted after `\end{center}`. And a trailing comment after the
caption stays after it rather than being hoisted above. Both are improvements in
fidelity and both are fixed points from cycle 1.

CI: [figure-multi-label-roundtrip.test.ts](../../../src/lib/__tests__/figure-multi-label-roundtrip.test.ts).
Its shape is the point: `figure-roundtrip.test.ts` has asserted "every `\label`
survives EXACTLY once" over a corpus since task 245 and was **green on the
pre-379 tree**, because no fixture in the repo had ever carried two figure-depth
labels — a vacuous invariant, which is the same blindness the `\caption*` star
(376 M4) and the `parTitle` write-set (343) each shipped behind. Every leg runs
TWO cycles (cycle 1 is where a loss lands, cycle 2 is where an oscillation shows)
and asserts bytes, survivor and fixed point together, with four single-label
fixtures as passing CONTROLS. The corpus gains four entries so its own invariants
speak for the shape at all. Measured by neutering each half in turn: reverting to
`labels[0]` takes 4 legs, reverting to the cut-every-label strip takes 10.

**Residual, stated.** The DECLARATION scan (`declareFromRawLatex`) reads the two
halves as ONE joined string rather than twice, because the projection is stateful
over what it is given and a `\begin{verbatim}` opened in `extras` and closed in
`trailingExtras` must be seen as the pair it is — which also keeps task 345's
census at its deliberately brittle "exactly two callers".

#### The provenance half: a construct with no representation becomes PROSE, and the escape table then decides its meaning

Same round trip, and the case where the carrier rule was applied to environments (342) and comments (347) and never to the things a COMMAND is made of — its arguments — nor to the two ACTIVE characters a document is written with (task 349). The escape/typography rungs are correct about prose and are handed bytes that were never prose, so they rewrite them as if the user had typed those characters. All seven members; every one was a **fixed point** (no later save healed it) and every one landed on OPEN, since `readDocBundle` runs the save pipeline and then fires `writeReStampedTexOnLoad` unconditionally:

- **A command's THIRD argument (M1–M3).** The unknown-`\command` reader consumed `[…]` groups only BEFORE the braces and capped the braces at TWO, so the third fell into the prose buffer and its braces were escaped as literals. `\definecolor{myblue}{rgb}{0.2,0.4,0.8}` and `\resizebox{3cm}{!}{Some content}` reached the compiler with two arguments and **the paper stopped compiling**; `\addcontentsline{toc}{section}{Introduction}` still compiled and silently produced a wrong ToC plus stray printed text, which is worse in one way — nothing tells the user. The fixed ORDER was the same defect one axis over: `\newcommand{\x}[1]{…}` puts its optional argument after a brace, so the bracket loop had already finished and `[1]` was escaped to `{[}1{]}`.
- **A break's own argument run (M4).** `\\[2pt]` — the residual task 341 recorded — needed TWO fixes, and either alone leaves the bytes wrong. `readParagraph`'s `\[` test fires at the SECOND backslash of `\\[`, where the accumulated `result` holds only ONE, so the `/\\\\\s*$/` guard that exists to suppress exactly this break can never match for the abutting shape: the paragraph split, `Line one\` was emitted with a dangling backslash, and `\[2pt]` became an **unterminated display-math opener**. And with the split fixed the `[` still fell into the prose buffer, where task 037's `protect` member wrapped it as `{[}` and the PDF printed a literal `[2pt]`.
- **A `~` TIE and a bare `{…}` GROUP (M5, M6).** Both are ACTIVE characters in bare unmarked text, which is the residual task 339 recorded against its own table: `emit: "always"` wrote `\textasciitilde{}` for a tie and the parse rung collapsed BOTH spellings to the same character, so `Fig.~1` and `Section~\ref{sec:a}` — the standard idiom — came back as a **printed tilde**, unrecoverably (nothing downstream could tell a promoted tie from one the user meant). A bare `{a, b}` is a LaTeX GROUP: it scopes and prints nothing, and escaping it to `\{a, b\}` **changes what the PDF says**.
- **A non-Latin accented letter (M7).** `typographyToLatex` NFD-decomposed anything and folded any combining mark `ACCENT_TABLE` knew, so Greek `ή` was written to disk as `\'{η}` and Cyrillic `й` as `\u{и}` — **stable inside Virgil forever** (the parse rung composes them straight back to the same glyph) and wrong in the `.tex`, where an accent command over a non-Latin base is an `inputenc`/pdflatex error.

> **A byte that arrived as LaTeX leaves as LaTeX. Where a construct's arguments are part of the construct, the atom carries ALL of them; where an ACTIVE character has a Unicode counterpart, the provenance lives in the DOCUMENT MODEL as two different characters; and a transform defined over one script asks the SCRIPT, not the code point.**

Nine rules they earned:

- **A cap of two is a hand list wearing an integer's clothes.** [`matchCommandArgumentRun`](../../../src/lib/latex-lexer.ts) consumes every abutting group in whatever ORDER, bounded three ways rather than by a guessed count: the SSOT scanners (`extractBraced` / `extractBracketed`) FAIL CLOSED on an unbalanced group, so the run ends exactly where the pre-349 code ended; a group spanning a blank line is refused, which bounds a caller that hands over a wider slice than one paragraph; and the group count is capped at TeX's own `#1`…`#9`. Unbounded consumption is what task 338 spent a whole task preventing, so the bound is stated rather than assumed.
- **It closed three fork divergences on the way past** (341's twin rule). `footnote-content.ts` had its own copy of the cap AND of the fixed order, and — unlike the main parser — **no `{[}`-protection check at all**, so a prose bracket abutting a command was folded into it there and not here. One door, one answer.
- **Ask `isEscaped`, not a wider `/\\\\/` guard.** The M4 boundary fix states the rule at the right altitude — a construct begins at a LIVE backslash, never at the tail of an escaped pair — and it leaves the `\\`-then-newline case the old guard was written for reading exactly as before, since there the boundary fires at a third, unescaped backslash. `matchLineBreakAt` lives beside `startsBlockBoundary` because the two are halves of one question (where a `\\` token ENDS, and whether what follows begins a new block) and the defect was the two answering differently.
- **A bare `\\` keeps its MODEL; an argument-bearing one takes the carrier.** Virgil does not model break spacing, so `\\*` / `\\[2pt]` / `\\*[1ex]` ride the raw-LaTeX mark (342's rule) while a plain `\\` stays the `hardBreak` node Shift+Enter produces. A modelled spacing ATTR is the richer treatment and a schema change across three body surfaces; the carrier is what makes the bytes safe today. The match is ABUTTING-only, stated at the door: LaTeX skips spaces before the `*`/`[`, but reading that wider rule would swallow a genuinely prose `[` one space after a break — and the serializer's own `{[}` protection means the abutting form is the only one Virgil's output can produce.
- **A GLYPH beats a mark, where Unicode has the character.** M5 is `{ text: U+00A0, tex: "~", kind: "glyph" }` in `CHAR_ESCAPE_TABLE` — a third declared `kind`, stated because the claim differs from `escape`/`protect`: the pair is a MODEL distinction, not a safety one, and the direction that matters is INWARD. Two code points in the document is strictly stronger than a mark (which degrades the first time an edit splits or merges a run — the objection the task's own Design section raised) and it renders as what it is, a space that does not break, rather than as grey monospace between `Section` and a `\ref` chip. It is deliberately NOT in `LITERAL_TABLE` beside the dashes: that rung is suppressed for code spans, and a `~` inside `\texttt{a~b}` is a tie exactly as it is outside one. Free consequence worth knowing: a bare U+00A0 arriving by PASTE used to reach disk verbatim, where pdflatex+inputenc may refuse it, and is now written as the tie it means.
- **Nothing is dropped from the table, because the fix is PROVENANCE.** An ASCII `~` the user types as prose still emits `\textasciitilde{}`, and an escaped `\{` still parses to a literal brace and re-emits escaped. The `escape` and `glyph` members for the tilde coexist with nothing to order: `escapeLatexChars` is a single-pass character scan keyed on the character, so the two are disjoint by construction, and the parse rung is longest-`tex`-first, so `\textasciitilde{}` still wins wherever both could match.
- **M6 takes 342's carrier and marks only the BRACES.** Marking the whole group raw would grey out the user's words, which is worse than the bug for `{a, b}`; 347's comment carrier is the wrong family member, since its promise (*not typeset at all*) is false for braces that scope. `matchBraceGroupAt` is bounded exactly as `matchCommandArgumentRun` is — `extractBraced` fails closed on an unbalanced group, a blank line refuses, and "is this a `{[}` protection?" is ASKED of `CHAR_ESCAPE_TABLE` rather than re-spelled.
- **The set of POSITIONS a scanner must offer is derived too.** Both inline parsers gated the non-backslash members on a literal `text[i] === "{"`, so `~` was emitted correctly by `escapeLatexChars` and unreachable on the way back in. `CHAR_ESCAPE_LEADS` comes off the table (today `{` and `~`), so a new member is reachable by declaration alone — the same "a hand list can only be missing a name" rule 342 earned, applied to reachability instead of vocabulary.
- **A leg with no measurable byte difference is asserted on the MODEL.** Deleting the `{[}`-protection check is byte-neutral (an absorbed `{[}` re-emits raw; an unwrapped one is re-escaped by the prose rung), so a byte assertion there has no teeth. What actually differs is whether the user can EDIT those characters — grey-monospace raw LaTeX versus prose — which is the whole reason the rule exists, so that is what the leg reads.

CI: [non-prose-bytes-roundtrip.test.ts](../../../src/lib/__tests__/non-prose-bytes-roundtrip.test.ts). Every pre-349 round-trip suite spells its fixtures the way the code it tests happens to handle them and exercises one construct at a time, so a command's third argument — or a Greek accented letter — reaching the escape table was **unrepresentable** in all of them. Each leg drives the REAL save pipeline over TWO cycles (cycle 1 is where the loss happens, cycle 2 proves nothing accumulates), with the controls through the identical harness: `\textcolor{red}{warning}`, a bare `\\`, a prose `[` after a break, an unterminated `\\[` and an unbalanced `{`, `café` / Vietnamese `ặ` / `søster`, a `~` inside `\url{}` / `\verb` / math / a comment tail, and an ESCAPED `\{` plus a brace typed in the EDITOR — the two controls that keep the prose direction honest. The leg with teeth is the **CENSUS**, because both fixes are shared DOORS and a behavioural test of a door structurally cannot see a SCANNER that never asks it — which is exactly what shipped. It requires both inline parsers to gate on `CHAR_ESCAPE_LEADS` and to carry a group through `matchBraceGroupAt` (341's twin rule), sweeps both silos for a `matchCharEscapeAt` caller that skips the derived set, and asserts the files it EXAMINED are exactly the two scanners so a needle matching nothing cannot pass for the wrong reason. Measured by neutering each half in turn: the pre-349 cap+order takes 7 legs, the M4 boundary gate 4, the M4 carrier 3, the accent script guard 3, the `{[}` protection 1, the M5 glyph member 7, the M6 group carrier 6, a hand-gated lead set 8, and a card fork that stops calling the group door 2.

**Residuals, stated.** M5 changes two derived numbers that are not bytes: a tie is now WHITESPACE to `word-count-core`'s `/\s+/` split, so `Fig.~1` counts as two words rather than one (arguably the truer answer — the PDF prints two — but a visible change), and the same is true of any plain-text projection. Search is unaffected in either direction: neither `~` nor U+00A0 ever matched a typed space. M6 is scoped to a BARE group the source already carried as syntax; the tie is scoped to the MAIN document body and the card-body fork, and `footnote-content.ts` still escapes `%` to `\%` for the reason 347's residual gives. One byte does move exactly once on a group holding a trailing comment (`{a % c}` gains the newline `closeCommentTail` owes it) — which CLOSES a group the source had left open, and is a repair rather than a rewrite.

#### The type-time half: a carrier applied when the bytes are WRITTEN, not when they are read

Same round trip, and the case where every rule above was correct and the
DOCUMENT MODEL had a fourth carrier nobody had declared (task 360).

`latexVerbatim`, `latexCommentTail` and `latexCommand` each say what their bytes
are. A BARE text node says nothing — and it was carrying raw LaTeX all the same:
`tiptap/latex-command.ts`'s decoration plugin exists precisely to paint a
bare-text `\command` span grey-monospace WHILE THE USER TYPES IT, without
marking it, and the autosave fires 1500 ms later. So `escapeLatexChars` was
handed a run that was raw LaTeX by intent and prose by document model, with no
way to tell them apart. Task 339 shipped the only honest guess available — *a run
with no backslash cannot be LaTeX, so escape it whole; a run with one is
ambiguous, so leave its ambiguous members alone* — and filed two residuals:
a source `\textbackslash{}emph` came back as a LIVE `\emph` on the first save,
and a run mixing a literal brace with a typed command kept its braces raw, so
`see {this} and \emph{that}` lost its printed braces to the PDF.

> **Bare text is PROSE, by construction.** A raw-LaTeX span takes the
> `latexCommand` mark as soon as an edit WRITES one — in the same dispatch, from
> the same lexer door the parse rung reads — and the two inline parsers carry a
> CONTROL SYMBOL rather than buffering its backslash. The vocabulary at a
> backslash is then TOTAL, so `CHAR_ESCAPE_TABLE` emits its whole vocabulary
> unconditionally and the `emit` field that declared the narrowing is deleted
> with it.

Six rules it earned:

- **Promotion needs a WRITER — and so does DEMOTION** (the symmetric half, task
  390, below). The carrier marks only a construct the transaction's own changed
  ranges TOUCH, and un-marks only a run they touched that the scanner no longer
  claims. Merely existing is not evidence in either direction: a literal
  backslash that arrived from a source `\textbackslash{}` is byte-identical to a
  typed command, so promoting it on an unrelated keystroke elsewhere in the
  paragraph would re-create the very corruption this closes — and the parse rung
  carries constructs this scanner deliberately declines, so demoting one on an
  unrelated keystroke is that corruption's mirror image. That the correctness
  rule and the keystroke-sanctity rule turn out to be the SAME rule — *look only
  at what the edit did* — is what makes the cheap implementation the correct one
  rather than a compromise.
- **A document REPLACEMENT is not a writer.** `setContent` (the load, the
  code-pane bridge's re-parse) replaces `0…docSize` in one step and its content
  already carries whatever marks the parse rung decided; scanning it would
  promote every literal backslash in the file, on OPEN, with no gesture. Detected
  by TipTap's own `preventUpdate` meta plus a structural whole-doc test as the
  backstop for a raw dispatch. Undo/redo is skipped through prosemirror-history's
  exported `isHistoryTransaction` — restored content must keep exactly the marks
  it had, and a re-derivation there ping-pongs.
- **The vocabulary is the LEXER's** — `scanRawLatexSpans` reads the same doors,
  in the same order, that both inline parsers read at a backslash (line break →
  control word + `matchCommandArgumentRun` → accent → `matchControlSymbolAt`). A
  local copy is how the decoration's own `matchCommandLength` came to cap
  arguments at two and know nothing of task 349's argument-run rules.
- **A typed `{…}` group is LaTeX only if it CONTAINS LaTeX, and that asymmetry
  with the parse rung is deliberate.** 349 M6 carries the braces of EVERY bare
  group, because a group in the SOURCE is syntax the source already carried; a
  group the user TYPES is not — `see {this}` is prose whose braces must print.
  So 339's evidence rule is applied at GROUP granularity here. Both answers are
  fixed points (a typed `{this}` saves as `\{this\}` and parses back to literal
  braces; a source `{this}` saves as `{this}` and parses back to a group), so
  nothing oscillates.
- **The control symbol is the member that makes the vocabulary total, and it was
  found by MEASUREMENT.** Both parsers' unknown-command fallback reads a control
  WORD; everything else at a `\` fell into the prose buffer. Against this repo's
  own corpora `\;` (16), `\ ` (14) and `\,` (9) occur in ordinary body prose —
  `U.S.\ Route`, the standard abbreviation idiom — and they round-tripped ONLY by
  the accident that the escape rung refused to touch a backslash. Once `\` is
  escaped unconditionally an un-carried `U.S.\ Route` reaches the `.tex` as
  `U.S.\textbackslash{} Route`, a printed backslash. Two twin divergences closed
  at the same door: the card fork buffered `\\` as two literal backslashes, and
  the main parser buffered an UNKEYED cite name (`\citep and more`) where the card
  fork already reached the marked answer through its unknown-command fallback.
- **`inclusive: false`, the boundary its two siblings already took.** ProseMirror
  defaults marks to inclusive, so prose typed at the trailing edge of a command
  INHERITED the carrier — which is why `serializeMarks`' latexCommand branch
  smart-quotes at all. With the mark derived from the text, inheritance is not
  merely unnecessary but wrong, and the scanner re-extends the mark itself while a
  command is still being typed. Deliberately NOT `code: true` unlike the other
  two: smartening a typed quote inside a `\command` run is what keeps a stray
  inherited mark emitting valid `.tex`, and that net stays.

**And the decoration and the mark are now the SAME state, which they have to
be.** A `AddMarkStep` carries an EMPTY step map, so neither of the decoration
plugin's probes could see the promotion, and a decoration left standing over a
now-marked run painted a second `.latex-cmd` over the one the mark renders
itself. The set is rebuilt whenever this mark's presence changes (O(steps)).
Recorded residual: a literal backslash from a source `\textbackslash{}` is still
painted grey by the bare-text decoration although it emits escaped — the one
place the grey and the bytes disagree, and the one that promotion-on-write turns
into a command the moment anyone edits it.

CI: [typed-raw-latex-carrier.test.ts](../../../src/lib/tiptap/__tests__/typed-raw-latex-carrier.test.ts).
Every leg drives a REAL editor and types CHARACTER BY CHARACTER, because the
defect lives in the gap between what a keystroke leaves in the document and what
a save then makes of it — a shape no parse→serialize suite can reach, which is
why 339 could only describe it. Both surfaces are driven (the card body is a
second inline parser AND a second editor), the cost legs count entries into the
lexer door (one keystroke in a 60-paragraph document scans ONE block; a block
with no `\` and no `{` scans none), and `char-escape-table-ssot.test.ts` loses its
one derived exemption — every member round-trips from source now, and the block
that asserted *a bare text node is a real carrier* is renegotiated in place to
assert the opposite with the reason at the site. Measured by neutering each half
in turn: the carrier plugin takes 15 legs, the unconditional escape 21, the
promotion gate 2, the replacement gate 1, the history gate 1, `inclusive: false`
3, and the control-symbol carrier 6.

**Residuals, stated.** A select-all-then-type replaces the whole document too, so
raw LaTeX arriving that way is not promoted — escaped as the literal characters
it is, which round-trips; a missed promotion, never a corruption. A char-escape
spelling typed by hand (`\%`, `\&`) takes the carrier here and is un-escaped to
its literal character by the next parse, so the grey heals to a plain glyph on
reload — the type-time and parse-time answers differ by design, and both are
fixed points. Inside a `\texttt{}` span a control symbol splits the wrapper
(`\texttt{a\,b}` normalizes once to `\texttt{a}\,\texttt{b}`, idempotent
thereafter), which is the price of carrying bytes the fork used to destroy.
**Owed, not claimed:** a preview eyeball of the type-time feel — typing
`\emph{hi}` in prose, saving, reloading.

##### The other direction: deleting what made a run LaTeX is a WRITER too

Same carrier, and the case where the derivation was true on the way UP and a
one-way ratchet on the way down (task 390). 360 states that the mark IS derived
from the text; its fourth rule then declared the plugin **ADDITIVE only**, on the
sound ground that the parse rung carries constructs this scanner deliberately
declines (the braces of a source `{a, b}` group, 349 M6), so a re-derivation that
also removed would strip them on the next keystroke in that paragraph. That
ground argues for SCOPING the removal, not for refusing it — and refusing it left
two things wrong at once:

- **The mark could never come off.** Type `\` in front of a word, delete the `\`,
  and the word stays grey **forever** (Gabriel's screenshot: `Overall`,
  `Scenario`, rendered as raw-LaTeX runs with no backslash in sight). No
  affordance short of deleting and retyping the word; for a bare word, only a
  full reload's re-parse healed it. And the block gate compounded it — the scan
  ran only where the text still held a `\` or a `{`, so the one block a deletion
  had just emptied of both leads was the one block a demotion-aware scan would
  never have looked at.
- **…and a stale carrier is a BYTE hazard, not cosmetics.** The mark's serializer
  contract is EMIT RAW. Type `x \% y`, delete the `\`, and the `%` sits under the
  mark and reaches the `.tex` **live**, commenting out the rest of that source
  line — which post-347 the next parse reads back as a comment tail. Same story
  for `&`, `_`, `#`. The gap silently flipped the emission semantics of whatever
  the user left behind.

> **One scanner, two texts, the same question.** Promotion asks *did this edit
> WRITE this construct?* of the NEW text. Demotion asks it of the OLD text —
> because a construct the user has just dismantled leaves nothing in the new text
> to gate on. The mark then comes off exactly the touched runs the scanner no
> longer claims, and off nothing else.

Five rules it earned:

- **The old text is not a convenience, it is the only thing that can answer.**
  Deleting the `{` of `{\bf hi}` orphans its `}` six characters away: the
  deletion's own changed range is ZERO-WIDTH at the start of the block, `\bf hi}`
  says nothing about the pair, and the old scan says everything — both braces
  carry the group's own extent, which is the field `RawLatexSpan` already had for
  promotion's sake. Gating on the changed ranges alone closes the reported bug
  and leaves its group twin live, which is how a surgical "backspace removed a
  `\`" fix would have shipped.
- **Adjacency has to count, and it is the SAME predicate promotion uses.** A
  deletion's changed range is zero-width in the new document, so a
  strict-overlap test makes the commonest demotion there is invisible. One
  `touches`, both directions, so the two halves cannot come to disagree about
  what "the edit reached this" means.
- **Protect broadly, demote narrowly.** Every span the new scan produces
  protects, whether or not this edit touched it and whether or not promotion
  declined it for an OPAQUE crossing. A missed demotion is the status quo; a
  wrong one changes the bytes. The OPAQUE disjunct is the one with no other
  witness: mirroring promotion's own guard four lines above reads as a tidy-up
  and destroys `\foobar{<citation chip>}` — measured, that one-line change
  passed every other leg in the file, so it has a leg of its own.
- **A BRACE IS NOT A CONSTRUCT ON ITS OWN, so an INTACT marked pair never
  demotes.** The carrier marks a `{`/`}` only as a group's DELIMITERS —
  promotion gives the pair one shared extent and marks them together — so a
  demotion that takes one and leaves the other emits *unbalanced* LaTeX: the
  demoted brace goes through the escape rung to `\}`, the next parse reads it
  as the literal character it now is, and the surviving `{` has no partner. The
  paper stops compiling, and the 357 write gate cannot see it (`\}` against `}`
  moves zero word tokens). The shape that reaches it is ordinary: the two braces
  of a SOURCE bare group are permanently stale here (349 M6 carries them, this
  scanner declines them), they are two SEPARATE marked runs, and the adjacency
  rule reaches exactly one of them for a keystroke immediately before the `{`,
  immediately before the `}`, or immediately after it — all three of which
  emitted unbalanced braces, MEASURED. **Both-or-neither was the first fix and
  is not the right one**: it keeps the output balanced and still escapes a pair
  when the edit reaches both sides, which for `caf{\'e}s` means deleting the
  accented letter silently turns a grouping into printed braces. A brace demotes
  only when its matching marked partner is GONE, which is strictly better on
  every case — the group twin (`{\bf hi}` minus its `{`) still demotes its
  orphan, and `\emph{hi}` minus its lead now saves as `emph{hi}`, exactly what a
  re-parse of those bytes produces, where escaping the pair diverged from it.
- **The block gate gains its third disjunct, and most of the demotion it opens
  is FREE.** Scan the block when it still CARRIES the mark even with no lead
  left — and then skip the scan, because with no `\` and no `{` it is provably
  empty. The marked-run walk costs nothing extra either: it rides the walk that
  already had to happen to build the text. Measured: a stranded bare word costs
  ZERO scans, a keystroke beside a settled command still costs ONE, and the
  broken-construct recovery costs a second — of that one block's prior text.
  **What is NOT free, stated because the first draft of this section said it
  was:** a block holding a run this scanner permanently declines while the parse
  rung carries it — again the source bare group — has a "stale" run forever, so
  every keystroke anywhere in that block pays the recovery. Block-bounded, never
  document-bounded, so the law holds; roughly 2x the carrier's per-keystroke
  work in that one paragraph, and pinned by its own leg rather than described.
  **And the trigger class is RARER than that reads**, measured rather than
  guessed: swept over every `.tex` in the repo, essentially every bare-looking
  group inside `\begin{document}` is a `]{…}` command argument, which the
  scanner CLAIMS (so it is covered and never pending); the only genuinely bare
  groups sit inside a `texBlock`, which `allowsMarkType` skips before any of
  this runs; and the `{\'e}` → `{é}` idiom the docstring names appears in the
  `.bib` files and in ZERO document bodies. Stated so the next reader prices it
  correctly — it is a real per-keystroke doubling in a paragraph that has the
  shape, and almost no paragraph does.
- **The result is parse-consistent, so nothing oscillates.** `\emph{\bf hi}`
  minus its lead demotes `emph` and the group's prose and keeps the braces and
  the `\bf` — which is exactly what parsing `emph{\bf hi}` produces. Where the
  two answers differ they differ for the reason 349 M6 already records (a typed
  group is not a source group), and both sides are fixed points.

**Residuals, stated.** A PASTE is a writer in both directions, symmetrically with
360's own rule, so a pasted run's non-brace bytes demote; its brace pairs do not,
by the rule above. And the recovery is not free on every block — see the cost
rule. Both are the standing typed-vs-source group asymmetry, touch-scoped, and
the mirror of the residual promotion already carries (an edit INSIDE a literal
backslash promotes it).

CI: the same [typed-raw-latex-carrier.test.ts](../../../src/lib/tiptap/__tests__/typed-raw-latex-carrier.test.ts),
in its own shape — a REAL editor, typed character by character, then the real
deletion. The leg with teeth is the SCOPE leg, and it needs a block holding BOTH
a source-minted bare group and an unmodeled command, because the divergence is
unrepresentable with either alone. Measured by neutering each half in turn: the
pre-390 promotion-only plugin takes 10 legs, the block gate 5, the touch scoping
2, the old-text recovery 2, narrowing the protective cover to touched spans 3,
dropping the brace rule entirely 6, weakening it to both-or-neither 3, dropping
the OPAQUE disjunct from the cover 1, and scanning every block instead of the
touched ones 2.
**Owed, not claimed:** the preview eyeball — type `\Overall`, backspace the `\`
(the word returns to prose immediately); type `\%`, backspace the `\`, save and
reload (the `%` is still prose and the line is intact).

###### The family half: the law was about CARRIERS, and one of three had it

Same law, and the case where it was written down for a MARK and owed by a
FAMILY (task 407). 390 gave `latexCommand` both directions. Its two siblings
were left one-way for five weeks, and the reason the gap was invisible is
structural: the only re-derivation plugin in the family is keyed to
`markType = this.type`, so a reader looking for "where does the mark come off?"
finds an answer that is complete about the one mark it names.

- **The comment tail was the SILENT leg.** The parser pushes a whole tail
  INCLUDING its `%` as ONE text node; ProseMirror rebuilds a backspaced text
  node as `text.slice(1)` carrying the same marks array (`inclusive: false` is
  consulted only for insertion at a boundary, never for deletion), and nothing
  anywhere removed the mark. The serializer's arm then emits the run's bytes
  VERBATIM with **no `%` re-prefix anywhere** — it assumes `raw` already begins
  with one, which is precisely the assumption a demotion-less carrier breaks.
  So `x % TODO cite` minus its `%` reached the `.tex` as LIVE BODY TEXT and the
  user's annotation started TYPESETTING in the PDF, in all three of the
  serializer's line shapes, as a FIXED POINT — the next parse reads unmarked
  prose and the `%` is gone for good.
- **The inline `\verb` twin is LOUD.** Delete its lead and `verb|100% sure|`
  reaches the `.tex` with a live `%` that comments out the rest of that source
  line. Delete a delimiter and the paper stops compiling, and on re-parse
  `matchInlineVerbAt` returns -1, so the bytes are not verbatim to the parser
  either.
- **Neither is caught by anything.** `write-preservation`'s gate does not run at
  all after an UNDOABLE edit, and Backspace is one.

> **The unit of the law is the CARRIER, and the axis it is stated on is
> `(mark, FORM)` — not `mark`.** Each row asks ONE anchored question of a run's
> own text: *does this run still SPELL what its carrier says it is?* A row whose
> answer is `null` is a REFUSAL carrier — arbitrary bytes with no grammar, which
> no edit can break and which must NEVER demote.

The table is [`CARRIER_ROWS`](../../../src/lib/latex-lexer.ts), in the TipTap-free leaf
both the `.tex` layers and the TipTap layer already read for this vocabulary.
Six rules it earned:

- **`latexVerbatim` wears TWO opposite claims, and the axis correction is the
  whole fix.** The inline `\verb` form is a CONSTRUCT with a spelling; the other
  four push sites are the schema's REFUSAL — an unmodeled environment, a
  `\begingl…` gloss, an example child, a `verbatim` env inside an example. At
  demotion time a run's own text cannot tell a DAMAGED inline `\verb` from an
  arbitrary carrier: both fail every lexer door. **A text-shape predicate is
  therefore a blacklist and it LEAKS** — it would demote all four carrier
  shapes, and a demoted carrier leaves through the escape rung
  (`\`→`\textbackslash{}`, `{`→`\{`), destroying a screenful of the user's
  source on ONE keystroke. Strictly worse than the stale mark being fixed.
- **So the row is PROVENANCE, recorded where it is known.**
  `verbatimMark(form)` takes a REQUIRED argument — a defaulted one would be a
  decision nobody made, and the two answers are opposite claims — and the attr
  travels with the mark across every later split. It is the JSON-shape change
  `latexVerbatim`'s own header gives as its reason for NOT being an attr on
  `latexCommand`, and it is affordable here for a reason that does not
  generalize: this repo controls both producers (the parser emits the attrs key
  unconditionally, exactly as `Mark.toJSON()` does) and the mark is rare, where
  `latexCommand` is on every raw run in every document.
- **Every unrecognized answer is the REFUSAL row.** A card body persisted before
  the attr existed carries no attrs at all, and a clipboard round trip through a
  DOM that never rendered it carries none either. A missed demotion is the
  status quo; a wrong one escapes the user's source, so `verbatimFormOf` reads
  anything but `"inline"` as `"carrier"`.
- **The rows are WHOLE-RUN, which is what makes the sibling half CHEAPER than
  the arm it sits beside** — one anchored match per marked run in a touched
  block, no `subtractCover`/`mergeRanges`, no `markedBracePairs` (a brace inside
  a `\verb` run was never a group delimiter) and no `brokenConstructs` old-text
  pass. The run IS the construct, so an edit that can break it lies inside it or
  is adjacent to its boundary, which `touches` already counts in both
  directions. It rides `readBlock`'s existing walk, so a block carrying no
  sibling mark pays one `Set.has` per child and nothing else.
- **Merged by ROW, not by mark-set identity.** ProseMirror merges adjacent text
  nodes only on identical mark ARRAYS, so another mark landing inside a `\verb`
  run splits it into three; asking each third whether it spells a `\verb` run
  answers no three times and demotes all three.
- **The comment row is NEWLINE-TOLERANT**, because `closeCommentTail`
  explicitly documents an interior newline as reachable by EDITING and
  re-comments its continuation lines. A claim written as "the whole run is one
  comment line" would demote exactly the shape the serializer has an arm for.
- **`isOpaqueRun` no longer hand-lists the siblings** — it reads
  `CARRIER_MARK_NAMES`, derived from the rows, so the family census exists in
  one place. That predicate is what keeps a `latexCommand` scan out of a
  sibling's bytes, and a fourth carrier would have been invisible to it while
  being perfectly visible to the table.

**Stated collateral, pinned rather than discovered:** a demoted tail that
CARRIED LaTeX prints it — `% see \cite{a}` → ` see \textbackslash{}cite\{a\}`.
Law-consistent (the bytes ARE prose now) and a fixed point, but surprising.

**And the card fork's missing comment arm is the RIGHT answer, not the inverse
inconsistency it reads as.** `footnote-content.ts` has a verbatim arm and no
comment-tail arm while `borrowed-schema.ts` REGISTERS the mark on card
surfaces — but everything that fork emits lands inside `\footnote{…}`, so a raw
`%` would comment out the closing brace. The main serializer can emit one raw
only because `serializeInlineSequence` discharges the carrier's LINE obligation,
and a braced argument has nowhere to put that newline.

CI: [carrier-family-demotion.test.ts](../../../src/lib/tiptap/__tests__/carrier-family-demotion.test.ts)
drives the REAL `buildEditorExtensions("main")` stack over the REAL parse and
then serializes, with a two-cycle fixed-point check on every red leg. **No
pre-407 suite could see any of this**: grepping `removeMark|Backspace|
deleteRange` across the four carrier suites returns ZERO — every one of them
drives PARSE → SERIALIZE over source the parser produced, where a carrier run
always spells its own construct and the divergence is unrepresentable. Measured
by neutering each half in turn: the pre-407 one-way plugin takes 11 legs, a
text-shape blacklist over the refusal row 7, a form-less `verbatimMark` 8, the
whole-run merge 1, a whole-run comment claim 1, the touch scoping 1 (and it
needs an ALREADY-BROKEN run, which no intact fixture can represent), an
unrendered `form` attr 1, and the hand-listed `isOpaqueRun` 1.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked — type
`x % TODO cite`, backspace the `%`, and open the code view: the annotation must
be escaped prose, not a live comment.

###### The container half: two spellings of one fact, and only one declared

Same family, the BLOCK the three marks sit beside (task 512) — and the case
where the fact was declared, correctly, in a vocabulary the layer that had to
read it does not speak.

`latexComment` declares `marks: ""`, and that IS "byte-literal container": a
node admitting no marks can never wear a carrier, so Virgil has no way to say
which of its characters are raw LaTeX, which is what verbatim MEANS. The prose
index reads exactly that (`blockCarriesProse`, rule 2). TipTap's INPUT-rule
runner asks the identical question in the framework's own vocabulary —
`$from.parent.type.spec.code` — and `latexComment` did not answer it. So every
type-time transform fired inside a `%` comment. Measured on the pre-512 tree:

- typing `a--b "q" c---d` gave `% todo a–b “q” c—d` — curly quotes and en/em
  dashes written into the comment's own SOURCE BYTES, which the serializer
  emits raw. It round-trips, so the cost was cosmetic-in-source rather than
  corruption, which is why it was filed `low`;
- typing `` `code` `` **DELETED both backticks**. StarterKit's `code` MARK rule
  matched, failed to apply a mark this node forbids, and kept its deletion
  anyway. That one is LOSSY, and it is the reason the fix is the FRAMEWORK's
  declaration rather than a predicate inside `SmartQuotes`: a gate confined to
  our own rules closes the reported symptom and leaves its worse sibling live,
  in the same block, at the same layer.

> **Where two layers must agree about one fact, a node DECLARES it in both
> vocabularies and a census pins them as ONE SET** — here every markless
> textblock declares `code`, and every `code` textblock is markless. **And a
> declaration that carries a DERIVED side effect declines it explicitly:**
> ProseMirror resolves `spec.whitespace || (spec.code ? "pre" : "normal")`, so
> `code` silently changes how the DOM PARSER reads the node — a clipboard
> behaviour with nothing to do with input rules.

Four rules it earned:

- **The whitespace flip is DECLINED, not inherited, and the hazard is real
  rather than theoretical.** A comment is ONE `%` source line, so under `"pre"`
  a newline surviving out of pasted markup makes `% ${textContent}` emit
  `% line one\nline two` and put the SECOND LINE LIVE in the `.tex` — the
  corruption class this cluster exists to prevent, introduced by its own fix.
  `whitespace: "normal"` is stated at the site, so DOM parsing is byte-identical
  to the pre-512 tree and the input-rule gate is bought on its own. Measured:
  dropping that one line fails two legs, one of them the live-second-line pin.
- **The two members want OPPOSITE whitespace answers, so the pin is a MAP.**
  A `codeBlock` is genuinely multi-line and PM's derived `"pre"` is right for
  it; requiring an explicit declaration everywhere would be bureaucracy with no
  defect behind it. The exact `{ codeBlock: "pre", latexComment: "normal" }`
  pin catches a drift in either direction and makes a change a DECISION.
- **The MARK half stays asymmetric and was MEASURED, not assumed.** The task
  named the comment-TAIL mark as a suspect; driven through the real stack it is
  already covered by its own `code: true` — typing inside a tail run leaves the
  characters literal, while typing AFTER one smartens, which is correct because
  `inclusive: false` makes what follows genuine prose that the serializer puts
  on its own line. Both are pinned as non-regressions. `latexCommand` remains
  deliberately NOT `code` (`latex-command.ts` says why in place): smartening a
  quote typed into a stray inherited command span is what keeps it emitting
  valid `.tex`. Do not "unify" that away.
- **Every OTHER input rule was swept before the scope was drawn.** Inside a
  comment, `- `, `# `, `1. `, `> `, `$x$`, `\emph{a}` and a nested `%` were all
  ALREADY declined — by the schema, not by a gate — so the phenomenon was
  exactly two rules wide and the fix is sized to it.

CI: [comment-block-typography.test.ts](../../../src/lib/tiptap/__tests__/comment-block-typography.test.ts)
drives the REAL `buildEditorExtensions("main")` stack, typing one character at a
time through the shipped `handleTextInput` prop — a single `insertContent` fires
no input rule at all and would pass on the pre-512 tree. **No pre-512 suite
could see any of this**: `smart-quotes-dash-inputrules.test.ts` builds a minimal
stack with no `latexComment` in it, so a comment block is unrepresentable in
every one of its legs. The legs with teeth are the two AGREEMENT pins in
[prose-index.test.ts](../../../src/lib/__tests__/prose-index.test.ts) — the declaration
was never the part that could misbehave, a future markless verbatim node that
declares only one spelling is. Measured by neutering each half in turn: dropping
`code` takes 4 legs, dropping `whitespace: "normal"` takes 3.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked (a live editor
gesture plus a `.tex` round trip — no disk), so the check is cheap and real:
type `"` and `--` after a `%` in a comment block and open the code view.

#### The dispatcher half: the LAST layer that still read "unterminated" as "yours"

Same round trip, and the case where the law had been written down twice, applied
twice, and left unapplied at the branch that fires most often (task 356). Task
350 closed `\ex` and `\begingl`; the lexer's own `skipOpaqueConstructAt` states
the policy outright ("Unterminated ⇒ TRANSPARENT"). The generic `\begin{env}`
DISPATCHER — the branch every list, quote, figure and unmodeled environment
enters — still took `ctx.src.slice(ctx.pos)` and `ctx.pos = ctx.src.length` when
`findMatchingEnv` answered -1.

Four members, and the order below is the order they bite:

- **The dispatcher's EOF slurp.** The whole document tail became one environment
  body, and the modeled branches then kept only what their node can hold —
  `parseList` keeps `\item` slices, `figure` keeps its recognised attrs — so the
  tail was DESTROYED, not merely mis-shaped. The serializer then wrote the
  `\end{X}` the user never typed, making it a fixed point. **The routine trigger
  is not a typo'd or commented-out close: it is TYPING.** In the code pane the
  user writes `\begin{itemize}` and, for the seconds before the close exists,
  every keystroke re-parses a document whose tail is inside that environment.
- **`splitListItems` destroyed an item-less body on WELL-FORMED input.**
  `firstItemPos > 0 ? content.slice(0, firstItemPos).trim() : ""` conflated "no
  `\item` anywhere" (-1) with "an item at offset 0" (no preamble), so a body with
  content but no item reported zero items AND an empty preamble, and `parseList`
  substituted one empty `listItem`. `\begin{itemize}\input{bullets}\end{itemize}`,
  a tuning-only body (`\itemsep`), items hidden inside a `verbatim` — every byte
  gone, emitted as `\begin{itemize}\item\end{itemize}`. No unterminated close, so
  no fail-closed arm anywhere could have caught it.
- **The title family was TWO scans that disagreed twice.** Neither
  `stripTitleFieldsFromText` nor `parsePreambleTitleFields` predated the
  `%`-projection SSOT, so `%\title{old draft}` above the live `\title{…}` was
  PROMOTED to be the document title while the real one was stripped and never
  emitted — and the strip swallowed the trailing newline, fusing the orphaned `%`
  onto the NEXT preamble line and commenting that out too. And the strip was
  strip-ALL against a keep-FIRST parse, so an `amsart`/ACM multi-`\author`
  preamble lost every author but one. All of it under the 350-D gate's word slack.
- **expex `[opts]` were filtered down to `exno=`.** `[everypar={\itshape}]`,
  `[aboveexskip=1ex]` and every other key were consumed and discarded — a
  typographic instruction destroyed on OPEN, costing zero words.

> **"Unterminated ⇒ transparent" is a law about the LAYER, so it holds at every
> layer: a construct whose end nobody can find is not that construct, and the
> parser puts its cursor back on the opener and carries the bytes. And a modeled
> branch that meets a body outside its model has exactly two honest answers —
> carry the whole environment, or throw. Never keep the fraction it recognises.**

Five rules it earned:

- **The refusal is the CARRIER, spelled once.** `pushVerbatimEnvCarrier`
  ([latex-parser.ts](../../../src/lib/latex-parser.ts)) was the environment dispatcher's
  `default:` arm and is now also what a modeled branch takes when it refuses —
  task 342's rule ("what the system does not model, it CARRIES") read one level
  in, at the BODY instead of at the env name. `parseList` answers `null` and the
  caller carries; routing the body through `listPreamble` was the other candidate
  and is strictly worse, since the serializer would then emit an `\item` the user
  never typed.
- **A refusal is scoped to a body with CONTENT.** A genuinely empty
  `\begin{itemize}\end{itemize}` is not a refusal — there is nothing to lose, and
  the one-empty-item node is the editable thing the user wants.
- **Two scans of one question is the defect; ONE scan read by both halves is the
  fix.** `findPreambleTitleFields` is comment-aware through `matchCommentTailAt`
  (TeX's rule, escape-aware, so `\%` is never a comment and a mid-line `%` still
  shadows the rest of its line), and `hoistablePreambleTitleFields` states the
  shared rule: a field is hoisted only when it occurs exactly ONCE live. A
  repeated field stays RAW in the preserved preamble, in its original order.
  **Order is why the obvious symmetric fix is wrong:** hoisting the first and
  leaving the rest raw re-injects the first into the canonical block just before
  `\begin{document}`, which moves the FIRST author to LAST. Cost, stated: a
  multi-author paper's authors are not editable from the title strip. Data over
  affordance.
- **`exno` is INTERPRETED and the rest is CARRIED, and the two cannot drift.**
  `rawOptions` holds the raw bracket run and the serializer emits it verbatim,
  falling back to `[exno=N]` only for a node built programmatically (no source
  bytes). `exnoOverride` stays parsed because the renumberer reads it — and
  nothing WRITES it, which is what makes carrying the raw run safe rather than a
  staleness hazard.
- **A guard that overstates its reach is the thing being fixed.** Two shipped
  suites pinned the pre-356 losses as intended behaviour — `unmodeled-env-roundtrip`
  spelled its list fixture as a bare `body` (passing only because that body was
  destroyed), and `latex-roundtrip-titles` asserted outright that a duplicate
  `\title` is DELETED, "first occurrence wins". Both are renegotiated in place
  with the reason at the site, not quietly re-scoped.

Same pass closed the census's own `%!vtex:begin` twin (a stranded begin marker
folded the document tail into one opaque texBlock, or deleted its own line) and
two silent whitelist drops in the serializer that are unreachable from the parser
today — which is exactly why they had been left dropping: `listItem` took
`children.slice(1)` while emitting an empty head whenever child 0 was not a
paragraph, and the two example-family if/else-if chains, which match the schema
TODAY, had no terminal `else`.

**Verdicts on the rest of the census's triage list, recorded rather than skipped:**
`tokenizeGlossCells`' `cells.join(" ")` and the `latexComment` trim are
whitespace-only normalizations that are fixed points — safe. `stripFigureOwnCommands`
cuts exactly the ranges the serializer re-emits from attrs, which its own comment
states and the round trip proves — safe. `serializeNode`'s `default:` arm (emits
children, drops the wrapper) and `serializeInline`'s childless `return ""` are
REAL silent drops and are deliberately NOT fixed here: making them refuse needs a
decision about what a refusal on the SAVE path does, which is task 357's subject
(the 350-D gate's refusal is itself inert today). Footnote `richJsonToLatex`'s
flattening (a list becomes `· a; · b`) is a modeling gap in the card-body schema,
not a member of this class.

CI: [content-loss-round-2.test.ts](../../../src/lib/__tests__/content-loss-round-2.test.ts).
Every pre-356 env / list / title fixture in the repo is WELL-FORMED and
single-valued, so each of these losses was **unrepresentable** in all of them —
which is how they shipped green. Each leg drives the REAL save pipeline over TWO
cycles (cycle 1 is where the loss happens; cycle 2 proves nothing accumulates,
and every one of these was a fixed point) with controls through the identical
harness. The leg with teeth is a SOURCE CENSUS over both parsers: any assignment
that lets a cursor or a bound reach the end of a source string must carry an
`unterminated-ok:` justification within the eight lines above it — no allowlist, a
hit is JUSTIFY-it or FAIL-CLOSED-it, and the eight surviving sites are justified
in place (line-bounded comment scans, or already-bounded bodies). The census reads
CODE, which this task's own fixes make load-bearing: they explain themselves by
quoting the pre-fix line verbatim, so a raw-source grep would flag its own
explanation. `_source-scan` gains a LINE-ALIGNED mode (`codeOnlyLines`) for it —
the fourth private stripper variant this repo was about to grow. Measured by
neutering each half in turn: the env fail-closed arm takes 4 legs + the census,
the list refusal 6, the title comment-awareness 2, the title symmetry 1 (the
orphaned-`%` leg needs BOTH, which is what the pre-356 tree actually was), the raw
options 2, the vtex arm 1 + the census, the two serializer drops 1 each, and a
single dropped marker the census alone.

**Owed, not claimed:** a real-FSA eyeball. Everything here is proven by the unit
contract; the code-pane mid-typing trigger in particular is worth watching once in
the running app.

#### The arity half: the door that answers "what are this command's arguments?" was read by the CARRIER only

Same round trip, and the case where the SSOT existed, was correct, was bounded
three ways, and was adopted by exactly one of its two kinds of caller (task
376). Task 349 built `matchCommandArgumentRun` for one question — *what are this
command's arguments?* — and it answers it for any arity, any order, star
included. **Only the CARRIER path adopted it.** Every matcher for a construct
Virgil actually MODELS still hand-wrote `name` + a literal `{`.

So a legal spelling the hand regex did not accept had one of two outcomes, and
the first is the quiet one: the construct was **DEMOTED** to the raw carrier
(bytes safe, model gone, every feature derived from the node silently dead), or
it was **CLAIMED and re-emitted without the part the matcher could not see**
(bytes changed). Six members, all fixed points, all landing on OPEN via
`readDocBundle`'s unconditional load-writeback:

- **M1 — `\section[Intro]{Introduction}` was a PARAGRAPH.** For all seven
  commands, starred and unstarred, plus the `\section {X}` / `\section\n{X}`
  spellings TeX accepts. The bytes round-tripped (349/360's carrier did its job)
  and the whole heading apparatus was dead for an ordinary construct: no Outline
  row, no folding, no section number, no `\label`/`\ref` resolution, no
  `\partitle`, no focus band, no heading word counts, and grey monospace where a
  styled heading belongs.
- **M2 — the level↔command vocabulary was spelled FOUR times** (the parser's
  regex, the serializer's level-indexed array, `HEADING_TYPES`, and
  `document-class.findSectioningCommands`) **and only the copy that decides
  nothing got the grammar right** — the compat checker accepted the bracket AND
  the whitespace, so it correctly saw a `\chapter[Short]{X}` the parser had
  already thrown away. `headingTypeCommand` had zero callers anywhere: a dead
  SSOT (task 202's class).
- **M3 — a list's `[options]` were DELETED.** `\begin{enumerate}[label=(\roman*)]`
  came back bare, so the list reverted from (i)/(ii) to 1./2. in the PDF. Three
  word tokens, under `PRESERVATION_SLACK_WORDS = 4`, so the write gate was
  silent. `figure` kept its `[htbp]` and the unmodeled-env carrier re-emitted its
  bracket; this branch was the outlier, and task 340 had fixed the identical
  defect one level down for the per-ITEM `\item[label]`.
- **M4 — `\caption*` lost its star**, so the figure began consuming a figure
  number and a List-of-Figures row and **every later figure renumbered**, with
  every `\ref` to them printing a different number. One byte, zero word tokens —
  invisible to every gate.
- **M5 / M6 — `\footnote[3]{…}` was not a footnote** (no node, no `\vfid`
  marker, no card, no panel row) and **`\title[Short]{Long}` was not a title
  field** (not hoisted, not editable in the title strip).

> **A MODELED construct reads the same argument door the carrier does — and
> consumes its OWN declared arity, not the maximal run.** The door is
> [`matchStarOptBraceAt`](../../../src/lib/latex-lexer.ts) (`*`, `[opt]`, the one `{req}`
> the model holds) over `matchCommandArgumentRun`'s PARTS, and
> `matchSectioningCommandAt` over that, derived from `HEADING_TYPES`. A
> construct whose spelling carries a fact the model cannot hold is REFUSED to
> the carrier, never claimed and re-emitted incomplete.

Six rules it earned:

- **One scanner, two arities, and the difference is load-bearing.**
  `matchCommandArgumentRun` is deliberately MAXIMAL — every abutting group up to
  nine — which is right for the CARRIER (whose job is to keep bytes together)
  and wrong for a modeled construct: `\footnote{a}{b}` is a footnote whose body
  is `a` followed by a bare prose group, and a maximal read would swallow `{b}`
  into the note. So the modeled door reads the run's GROUPS and stops at the
  first brace. Extending the run to publish its parts is what makes that
  possible without a second scanner.
- **The gap before the FIRST argument is skipped and gaps between groups are
  not.** TeX skips spaces while scanning for an argument, so `\section {X}` is
  the same document as `\section{X}`; a gap spanning a BLANK LINE is refused,
  because a `\par` cannot appear inside an argument scan and refusing there
  keeps a bare `\section` at the end of a paragraph from reaching into the next
  block. The between-groups rule is `matchCommandArgumentRun`'s existing one and
  this door does not renegotiate it.
- **A star the model cannot carry is a REFUSAL, not a swallow.** There is no
  `\footnote*` or `\title*` in LaTeX, so those doors decline a starred spelling
  and the carrier keeps the bytes — task 356's rule, and precisely the failure
  M4 was: a star claimed and then dropped.
- **M4 reads the star into the fact it already IS.** In LaTeX `\caption*` means
  *unnumbered float*, which is what `figureBlock.numbered` means — so the parser
  sets `numbered: !captionStarred` and the emitter writes the star back from it,
  rather than a second parallel `captionStarred` attr the two could disagree
  about. That also gives the `numbered` toggle the persistence it never had:
  nothing serialized it before, so it did not survive a save.
- **Put the vocabulary where the layer that needs it can reach it.**
  `heading-types.ts` is now an import-free LEAF owning `SectioningCommand`
  (`document-class.ts` re-exports it), because the lexer is itself a leaf every
  low-level consumer takes — the placement rule `latex-markers.ts` and
  `node-attr-sets.ts` earned. `headingTypeCommand` is wired rather than deleted:
  it is the serializer's level→command lookup now.
- **A carried-raw fact rides the NODE, not a re-read of the source.**
  `heading.shortTitle`, `listOptions` and `footnote.numberOverride` are opaque
  attrs with `keepOnSplit: false` — the `listItem.itemLabel` shape (340): a
  heading split at Enter must not mint a sibling carrying a running head the
  user never typed, on a section it does not name.

The same pass took the `[^\]]*` env-option capture to `extractBracketed` (which
is brace-depth aware, so `[label={[\arabic*]}]` is captured whole rather than
truncated mid-option) — a shape that was survivable only while the options were
being deleted anyway.

**Stated residuals, two.** `\footnote[3]`'s override is carried and deliberately
NOT fed to `numberFootnotes`: in LaTeX the optional form also does not STEP the
counter, so honouring it in Virgil's own chrome means renegotiating every
following footnote's number — a bigger change than carrying the byte, and one
the bytes do not depend on. And the EXCERPT body schema mounts StarterKit's
plain `Heading`, which declares none of `label` / `numbered` / `uuid`, so an
archived section already loses those on capture and now loses `shortTitle` with
them — a PRE-EXISTING attr-level gap in the capture/schema-symmetry law (whose
guard asserts node and mark TYPES, not attrs), widened by one field here rather
than introduced.

CI: [optional-argument-matchers.test.ts](../../../src/lib/__tests__/optional-argument-matchers.test.ts).
Every pre-376 fixture in the repo spells these constructs the one way the code
happens to handle, so an optional argument or a star reaching a modeled matcher
was **unrepresentable** in all of them. Each leg drives the REAL save pipeline
over TWO cycles with its plain-form CONTROL through the identical harness, and
asserts the node TYPE as well as the bytes — a heading that round-trips as a
carrier IS the defect, and a byte assertion alone cannot see it. The sectioning
legs are swept FROM `HEADING_TYPES`, so an eighth level is covered by
declaration alone. The leg with teeth is the CENSUS — the door was never the
part that could misbehave, a call site that spells the vocabulary itself is —
with its one exemption keyed to the per-class capability TABLE (a different
question: which commands does this class DEFINE?) rather than to the file, and a
second leg asserting that exemption still covers something. Measured by
neutering each half in turn: the sectioning door takes 18 legs, the list options
4, the caption star 3, the title door 3, the footnote door 2, the brace-aware
bracket scanner 1 — and the serializer's level-indexed array takes exactly ONE,
the census, because it emits byte-identical output.

#### The two-homes half: a datum with two homes, and every reader picking by convention

Same law, twelfth tense (task 403) — and the case where the SSOT was not dead,
not stale, not half-consolidated, but **doubled**: a citation's
`[prenote][postnote]` existed BOTH top-level on `ParsedCiteCommand` and per-entry
on `entries[]`, and each of the three consumers guessed which home was
authoritative, with three DIFFERENT guesses.

- `parseNatbibCommand` put the notes at the top level (natbib's brackets govern
  the WHOLE citation) and left `entries[]` note-less;
- `parseBiblatexCommand` put them per-entry **and mirrored `entries[0]`'s onto
  the top level**;
- `serializeCiteCommand` read `entries[]` only, so a natbib
  `\citep[p.~22]{k}` round-tripped as `\citep{k}` — the note silently DROPPED;
- the panel's `rowsFromCommand` mirrored `entries[0]`'s note onto EVERY row;
- the display formatter guessed a third way, from the command NAME plus the
  document's package — and it was the only one of the three that was RIGHT.

The panel's guess is the one that writes bytes. For a biblatex
`\cites[p. 1]{a}{b}` — which the UI itself emits — row `b` inherited `"p. 1"`,
and the next `persist()` wrote `\cites[p. 1]{a}[p. 1]{b}` into the user's
`.tex`: **a page range invented on a citation that never had one**, permanent
from then on, reachable with no package flip and no unusual gesture (any fresh
mount re-derives the rows — a reload, or the same citation rendered as a float
or in omni).

> **The tell for this class is always a COMMENT asserting which home is
> authoritative next to code that does not check.** The fix is not to make the
> readers agree; it is to make the second home UNREPRESENTABLE — a discriminated
> union whose WHOLE arm's entries carry no note field and whose PER-KEY arm
> carries no top-level note — and then to publish the ONE projection every
> reader actually wants.

[src/lib/cite-command-model.ts](../../../src/lib/cite-command-model.ts) is that model.
Six rules it earned:

- **The discriminant is the SYNTAX, not the package.** One bracket group before
  one brace group is WHOLE — natbib always, and biblatex's singular forms too
  (`\parencite[p. 1]{a,b}`); a repeated `[…]{…}` is PER-KEY, which is the only
  thing biblatex's plural `\xxxs` forms buy. Keying on the package instead is
  what made `\parencite[p. 1]{a,b}` re-serialize as
  `\parencites[p. 1][]{a}[p. 1][]{b}` — the same invention one command shape
  over, and it fell out of the model with no second rule.
- **ONE projection, read by both renderers.** `resolveCiteNoteRows` places a
  whole-citation note where LaTeX itself renders it — prenote before the FIRST
  key, postnote after the LAST — and nowhere else. The display formatter and
  the panel's editable rows are the same question asked twice, so they read the
  same answer instead of each deriving it. That is what makes the two agree BY
  CONSTRUCTION rather than by two implementations staying in step.
- **The discriminant is REQUIRED and undefaulted at the serializer.** Every
  call site had to name its arm, which is the point: a defaulted `noteScope`
  is a decision nobody made, and the compiler naming the four sites is what a
  comment saying "For natbib" could never do.
- **A lossy user action WARNS before it writes, once, at the altitude the
  decision is made.** natbib cannot represent divergent per-key notes, so a
  biblatex→natbib flip really does drop one — and the confirm lives at the
  Package control (ONE decision the user makes once) rather than in each card's
  flip effect, which would ask N times and still miss the archived cards. The
  predicate `citeNotesDroppedByPackage` is DERIVED by running the REAL
  serializer and reading the answer back through the REAL parser, never by
  restating the flatten rule — a second statement of the rule is the thing this
  whole section is about.
- **…and the same-package click still WRITES.** Picking the package the view
  already shows is how a user confirms a DETECTED seed as their own choice
  (task 344 made the stored family optional), so the gate's early return is
  "nothing can be lost", not "nothing happens".
- **The Library silo's whole-file copy stops being a fourth copy of the
  ANSWER.** `library/lib/bib-parser.ts` had re-typed the entire model and had
  already diverged (the empty-key filter and the `matchedGroup` guard never
  landed there), while its serialize half had no caller at all. It reads the
  leaf now — the placement rule `latex-markers.ts` and `node-attr-sets.ts` each
  earned — and its dead half is deleted rather than re-exported. Visible in the
  task-341 census, whose allowlist went from two entries to one.

**Declared normalization, stated rather than claimed away:** a biblatex
`\parencite[p. 1]{a,b}` is re-spelled `\parencites{a}[p. 1]{b}` by the card's
next save, because the card's rows ARE per-key (each row owns a `+range`
input). One-time, idempotent, and the single note stays on the single key that
owns it — where pre-403 the same save DUPLICATED it onto both.

CI: [cite-note-homes.test.ts](../../../src/lib/__tests__/cite-note-homes.test.ts) runs
every byte leg over TWO cycles (this class's fixed points are what make an
invention permanent) with controls through the identical harness, and
[citation-note-mirroring.test.tsx](../../../src/panels/Citations/__tests__/citation-note-mirroring.test.tsx)
drives the REAL card and edits a DIFFERENT row — the invention's whole cost is
in what `onUpdateCitation` receives, and a rows-only assertion passes on an
implementation that renders right and writes wrong. The leg with teeth is the
CENSUS: the model was never the part that could misbehave, a call site that
places the note by its own convention is, and `parsed.prenote` type-checks
perfectly on the arm that has it. So no production file outside the SSOT may
re-declare the parse/serialize model, every file that parses a command AND
touches a note must ask `resolveCiteNoteRows` (allowlist EMPTY), and the
Package control must ask before it writes. Measured by neutering each half in
turn: the pre-403 mirroring takes 8 legs, the entries-only serialize read 3,
and the package gate 1.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked — this is `.tex`
bytes through the real save cycle — so the check is cheap and real: make a
multi-key biblatex cite with a range on the first key only, reload, and look at
the other key's row and the source.

### The membership half: a per-kind capability is spelled once, and its guard is the sibling every other facet already has

Same law, fifth tense (task 259) — and the case where the dead facet and the missing guard were the *same* fact.

`CARD_REGISTRY[k].stackable` had **zero production readers**: nothing anywhere asked it. Meanwhile "which card kinds the Stack carries" was hand-restated in six more places that all had to stay in lockstep — the `StackCardKind` union, the `StackCardSnapshot` payload union, each float's `snapshotForStack` being a real `snapshotCard(…)` vs `() => null`, `CARD_PLACEMENTS`, the `applyCardDrop` switch, and the `snapshotCard` / `summarizeStackItem` switches — plus a hand-kept array in `float-snapshot.test.ts` and a `StackPullApi` whose per-kind factories were partly optional. Only one of those (`CARD_PLACEMENTS`, a `Record` over the union) was compile-enforced.

**Every failure mode was silent, and they were silent in different directions**: a missing `applyCardDrop` case meant the bar painted, `classifyDrop` said `apply`, the gesture completed and **no card was created**; a missing `snapshotCard` case returned null, and the drop handler closes the float *outside* its `if (item)` guard, so the popout vanished with nothing on the Stack; an optional `StackPullApi` method reached through `?.` no-oped for a whole kind. None is a type error, none throws, and no round-trip suite catches any of them, because each suite spells the vocabulary the same way the code it tests does.

And the facet had already drifted, exactly where the guard would have caught it: `example` declared `stackable: true` with a `() => null` snapshot, an empty placement list and a documented placeholder pull branch — **stackable in name at every link of the chain and in fact at none.** Alone among the drop-adjacent facets, the Stack had no coverage assertion; `assertMorphCoverage`, `assertContentCoverage`, `assertDropFacetCoverage` and `assertPanelTypographyCoverage` each pin theirs to the real mechanism.

> **Declare a per-kind capability ONCE, derive the union from that declaration, and pin every remaining mirror to it — by the compiler wherever the mirror is data, by a boot assertion where the two mirrors are static, and by a contract test where only a built object or a real dispatch can answer. A capability whose mechanism isn't built is declared `false` and left out of the vocabulary, not carved out of the guard.**

[src/lib/stack/card-kinds.ts](../../../src/lib/stack/card-kinds.ts) is the declaration (`STACK_CARD_KINDS`, with `StackCardKind` derived from it) plus the `CardKind ↔ StackCardKind` bridge — `bib` ↔ `bibliography` is the one name the two vocabularies disagree on, and it was hand-spelled at four sites. Four rules it earned:

- **Put the SSOT where the layer that must read it can reach it** — the same rule the marker vocabulary earned. `card-registry.tsx` is a documented runtime LEAF (a heavier import re-forms the `panel-registry → predicates → card-registry → …` cycle), so the vocabulary lives in a module with **zero runtime imports** rather than in `stack/types.ts`, which carries its own `@/lib/types` edge. `stack/types.ts` re-exports it, so no consumer changed.
- **Three tiers of pin, chosen by what each can actually see.** COMPILER: `CARD_PLACEMENTS` is a `Record` over the union, `StackCardSnapshot` is held to it by an `Exact<>` assertion at the declaration, and all four dispatch switches carry `const unhandled: never` arms (the local idiom — `default: { const x: never = v; void x; return <safe default>; }`, never a throw, since the payload comes from a shallowly-validated `localStorage` envelope). BOOT: `assertStackCoverage()` pins `stackable ⇔ in the vocabulary`, `stackable ⇒ poppable` (the only capture path is a popped float's `snapshotForStack`), and the bridge's injectivity. TEST: the two mechanisms neither can reach — whether a *built* `Floatable` really snapshots, and whether each `applyCardDrop` arm really calls its factory.
- **An optional per-KIND method is a missing switch case wearing a different hat.** Every `StackPullApi` factory is now required; optionality is reserved for per-FIELD enhancements, where absence loses a side-channel rather than the card — and even `setAnnotation` failed that test (an absent one silently dropped the user's bib note on every cross-doc pull), so the *call* stays conditional and the *method* does not.
- **No allowlist, and that is the load-bearing choice.** `assertContentCoverage`'s `allowedNull` carves out kinds that legitimately have no content — a true statement. There is no true statement of the form "this kind is stackable but cannot be stacked", so `example` left the vocabulary rather than entering an exception list: re-add it WITH its first real mechanism (synthesizing an `exampleBlock` on pull), after which the compiler names every other site. Removal is safe by evidence, not by assumption — `git log --all -S` shows no build ever wrote an `example` snapshot, and a hand-planted blob fails closed through the same retired-kind path the suite pins.

CI: [stack-coverage.test.ts](../../../src/cards/__tests__/stack-coverage.test.ts) — the boot assertion silent on the real registry and loud on each drift shape *individually* (so a future edit that guts one branch fails), plus the mechanism legs. The one that catches the ORIGINAL shape is per-kind: drive the REAL `applyDrop` against a recording `StackPullApi` and require a required-factory call, because a kind declared in all six places whose branch does nothing is exactly what shipped. [float-snapshot.test.ts](../../../src/cards/__tests__/float-snapshot.test.ts)'s hand-kept list is retired — it now sweeps `CARD_REGISTRY[k].stackable` and asserts the null half too, from a resolvable record (a `Floatable` that built and *refused*, not one that failed to resolve). Note the honest limit these share with their four siblings: the assertion `console.error`s rather than throwing, and `morphs/index.ts` loads on first sidecar-hook use — so the suite's spy, not the app, is where it has teeth.

### The consolidation half: a helper only SOME siblings call is not an SSOT

Same law, sixth tense (task 273) — and the one where the SSOT was already *written*. `dockOpen` was deliberately extracted as **the** shared docked-open helper, owning three invariants a caller is apt to drop: the **sentinel clear** (a docked band's `[data-dock-slot]` portal target only exists in an expanded, non-blank column), the **cap + LRU eviction**, and the **MRU coupling** (a band that leaves a stack leaves the recency list). Then the consolidation stalled. `redockPanel` re-implemented insertion inline; five setters re-derived the close branch; three re-derived the mode-dispatch/float-open branch; and `clampStack` carried its own `max = 3` beside `MAX_STACK`, with the sole caller passing nothing — so the LOADER owned a second ceiling that a future bump would have left silently truncating a runtime-legal stack.

> **A shared helper is an SSOT only if every sibling path calls it. Half an extraction is worse than none: the invariants the helper encodes drift out of each path that re-derives them, one silent omission at a time — and the next agent reads the helper as the enforced path.**

The proof is what the gap cost: `redockPanel`'s inline copy never cleared the sentinel, so dragging a float onto a *collapsed* side inserted the band and left the column folded — the panel's portal target absent, the panel rendering nothing (task 272, patched surgically at the symptom; retired here at the root, where it falls out for free). Nothing failed: the setter ran, the state was well-formed, every test was green.

[src/hooks/view-prefs-dock.ts](../../../src/hooks/view-prefs-dock.ts) is the engine — `placeInStack` (insertion: sentinel clear, `panelModes`, prior-float + prior-dock shed, cap + `leastRecentlyUsed` eviction, index-or-append, MRU bump) and `removeFromStack` / `closePanel` / `closeAllPanels` / `floatOpen` / `undockToFloat` / `openInMode`. Four rules it earned:

- **Extract to a module, not to a closure.** The old helpers lived *inside* the hook body, so nothing could test them without `renderHook` + jsdom + the storage/BroadcastChannel mocks — which is why the sibling paths were only ever pinned end-to-end, and why a missing sentinel clear had no cheap contract to violate. The engine is now the WRITE twin of the read-only [view-prefs-derived](../../../src/hooks/view-prefs-derived.ts) leaf and follows the same import discipline (types only from `useViewPrefs`, so no runtime cycle), and its suite runs in the bare node env with no mocks at all.
- **Publish whole OPERATIONS, never the pieces.** `stackFor` / `withStack` / `mruFor` / `withMRU` / `bumpMRU` / `pruneMRU` / `leastRecentlyUsed` are module-PRIVATE, and `notePanelUse` is an engine operation precisely so the last of those can be. An exported piece is an invariant waiting to be skipped: a setter that can reach `withStack` + `bumpMRU` re-derives the whole insertion, omits the sentinel clear, and spells none of the census's needles while doing it — the original defect, reproducible with CI green. The public surface is pinned by the suite, so a new export is a decision someone makes on purpose.
- **A defaulted argument is a decision nobody made** — the same rule the unbridge mode earned. `clampStack`'s `max` is now REQUIRED, so the ceiling is stated by the caller from `MAX_STACK` rather than guessed by a module that isn't entitled to own it. `Function.length` pins it at runtime.
- **The optional argument that stays optional is a real fork, stated.** `placeInStack`'s `freeSpacePx` is a caller measurement; supplied ⇒ a newcomer that can't get `MIN_BAND_PX` displaces the stalest band, omitted ⇒ only the hard cap evicts. Redock passes none *by design*: a drag-drop has no measurement, and refusing a deliberate user drop — or evicting a *different* band — for breathing room is worse than a tight fit.
- **Victim SELECTION was never the broken part.** `leastRecentlyUsed` (task 251) was already shared and already correct; only a ~4-line cap-check wrapper was duplicated. Generalizing the *policy* would have been the "deep = broadest blast radius" mistake — the fix is one insertion path, not one eviction rule.

CI: [view-prefs-dock-engine.test.ts](../../../src/hooks/__tests__/view-prefs-dock-engine.test.ts). The leg with teeth is the **census** — nothing below `loadPrefs` in `useViewPrefs.ts` may name `dockStack` / `panelMRU` / `poppedOutPanels` at all. Three details are load-bearing and each was a hole in the guard's own first draft: the needle is the BARE name, not the `dockStack:` key form (which ES shorthand — `{ ...p, poppedOutPanels }`, the realistic accident — defeats silently); string literals are KEPT and only comments stripped (blanking literals would erase a computed `p["dockStack"]`, the same unfalsifiable-leg mistake task 205 made); and the split is BELOW the loader rather than at the hook entry, so a pure helper hoisted to module scope — a zero-behavior-change cleanup — can't walk out of the guard. Alongside it: the engine's export list is pinned (see the operations rule above), and `clampStack`'s signature is pinned by SOURCE as well as arity, because `max?: number` erases at emit and reports the same `Function.length` while making `out.length >= undefined` always false — no ceiling at all, a worse regression than the drifting second one. A test of the engine alone structurally cannot catch any of this: the engine was never the part that misbehaved. Every needle fails on the pre-fix tree. Two limits are stated in the suite rather than papered over — the region above the split is exempt by construction, and the float half's `panelModes` / `floatPositions` can't be censused (`setFloatPosition` writes them legitimately).

#### The writer half: a generic API only SOME keys use is the same stall, one door over

Same file, same class, the *write* side (task 274) — and the case where the SSOT was not merely half-consolidated but half-consolidated **per kind**. `VIEW_PREF_REGISTRY` generated the store shape, the shipped defaults and the global-key set; a registry-driven `setViewPref(key, value)` / `toggleViewPref(key)` was added on top, the three newest Display toggles were routed through it — and the migration stopped there. Ten hand-written twins survived beside it, each byte-equivalent to the generic path for its `kind`: four boolean togglers (`toggleParTitles`, `toggleLatexComments`, `toggleMarginalia`, `toggleHeadingLabels`) plus a fifth wearing a value-setter's clothes (`setShowHighlights`, whose only caller was `() => setShowHighlights(!prefs.showHighlights)`); two enum setters (`setDividerWidth`, `setBibFilter`); and three copies of one includes/filter/append (`toggleHighlightType`, `toggleMarginaliaType`, `toggleDividerLevel`), which existed only because the generic API had **no `set` door at all** — `toggleViewPref` early-returned on non-toggle and `setViewPref` could only overwrite the whole array. `reader-view-prefs.ts` mixed both call forms inside a single object literal, five lines apart.

> **A generic keyed API is an SSOT only if it covers every KIND the vocabulary declares. A missing door isn't a gap — it's a standing instruction to hand-write the next twin, and each twin then drags a per-pref name through every layer between the store and the control.**

The cost was never a wrong toggle (every copy did identical naive work); it was the *thread*. One pref = one hook setter + one `EditorPaneMenuBarBundle` read field + one bundle setter + one `MenuBarProps` pair + one entry in ViewMenu's `Pick` + two rows in the checked/toggle maps + a line in EditorLayout's bundle *and* its dep array + the Reader's twin of the same. Nine artifacts per behavioural fact, none of them enforced against the registry.

Four rules it earned:

- **Complete the kinds, then the value travels by key too.** `toggleViewPrefMember(key, member)` is the missing third door, and its domain is DERIVED (`SetViewPrefKey` = the keys whose `kind` is `"set"`), so a new `set` pref joins by declaration. With all three doors present, `EditorPaneMenuBarBundle`'s twelve per-pref read fields collapse to one `prefs: RegistryPrefs` and MenuBar's twenty-five view props to five — `viewPrefs`, `availableDividerLevels`, and the three writers. A new toggle / enum / set pref is now ONE registry row and zero edits anywhere else.
- **What stays a prop is what isn't a pref.** `availableDividerLevels` (heading levels present in the doc) and `activeDividerLevels` (its intersection with the pref, which the `show-dividers-N` class tokens read) are DERIVATIONS, so they keep their own fields. The three `new Set(prefs.hidden*Types)` memos in EditorLayout and the Reader are deleted rather than moved: `prefs.hiddenMarginaliaTypes` is already reference-stable per field, so reading the array directly serves `memo()` strictly better than minting a fresh Set each render did.
- **A menu row's stable ID belongs to the registry.** The Display block was "registry-driven" for its label and membership while its row ids sat in a hand list in `MenuBar.tsx` — so a new toggle still needed a MenuBar edit. `menuRowId` is now a REQUIRED `ToggleDef` field and `toggleRowsInMenuGroup("display")` builds the block. It is declared, not derived from the key, because the ids are addressed by tests and the menu registry (`"card-outline"`, not `"card-outline-chrome"`) — a naming rule would have to be reverse-engineered from ids it must not change.
- **The `set` door deliberately does NOT validate membership.** The registry's own header says a stored `set` value may include members the MENU doesn't render (the "report" marginalia type). A `member ∈ def.members` check would silently no-op exactly those — a behaviour change wearing a guard's clothes. `members` is the render vocabulary; the stored array is the value. Pinned in the suite so a future "tightening" is a decision rather than a slip.

CI: [view-pref-writer-ssot.test.ts](../../../src/hooks/__tests__/view-pref-writer-ssot.test.tsx). The leg with teeth is the **census**, because the three doors were never the part that could misbehave — an eleventh twin written beside them is: no registry key may appear as a literal object KEY anywhere in `useViewPrefs.ts` (the doors write `{ ...p, [key]: … }` with a *computed* key, so a literal one is a twin by construction), and the ten retired setter names + the twelve per-pref MenuBar props they fed must have zero production occurrences in either silo. Comments **and string literals** are stripped for the first needle — the opposite of the dock-engine census's choice one section up, and for a stated reason: the hook's legacy-key migration table names registry fields as string VALUES (`field: "showHeadingLabels"`), which is a read-side mapping rather than a write, so keeping literals would indict it. The needle is name-EXACT, which is the right precision: `BibliographyPanel`'s `onSetBibFilter` is a presentational prop the host binds to `setViewPref("bibFilter", v)`, not a second store door. Measured on the pre-fix tree, the census names all ten twins. The behavioural legs sweep `VIEW_PREF_REGISTRY` per kind (every toggle flips, every enum value writes, every set member adds-then-removes) rather than enumerating prefs, so a new pref is covered by declaration alone. Stated limit: the census sees the `key:` form, so a hypothetical `p["showParTitles"] = …` write would pass — no such form exists in this immutable store.

### The other half: a shared WALKER is not a shared ANSWER

Same law, seventh tense (task 122) — and the one where the SSOT was not merely half-consolidated but half-*scoped*. `word-count-core` was the canonical categorization walker (task 112) and every surface used it. What no surface owned was the FILTER: "how many words is that" reads the user's `useWordCountConfig` include-set, and that reduce lived privately inside `WordCountPanel`. So the consumers with no reduce of their own read the precomputed, unfiltered `WordCounts.total` instead — the Cutter goal strip (and the `initialWords` baseline `setGoal` freezes from it) and the selection counter, which additionally kept its own flat-text walker and therefore produced a single uncategorized number the config had nothing to filter.

> **Deriving the same DATA is not answering the same QUESTION. When a shared record must be reduced against live app state to become the number a user sees, the reduction belongs beside the walker — and the precomputed unreduced answer is DELETED, not left alongside it.**

With the default config (comments off) a document the panel headlined as 10 words drove a cut goal measured against 15, and the config file's own stated intent ("Comments are noise for the running total — opt-in only") was violated one panel over. Resolved decision (Gabriel): the cut goal and the selection counter follow the panel's filter — one number, and it's the one the panel shows.

[src/lib/word-count-core.ts](../../../src/lib/word-count-core.ts) now owns both halves: `collectCategoryParts` decides which bucket, `includedTotals(counts, include)` decides which buckets count. Four rules it earned:

- **Delete the precomputed answer; making it unrepresentable IS the guard.** `WordCounts` → `CategoryCounts` (`words`/`characters`, per category, nothing else). A consumer can no longer reach an unfiltered total by accident — only by summing `ALL_CATEGORIES` itself, which the census forbids outside the module. The same cut retired `sentences`/`readingTime`/`countSentences`, which had **zero readers** — keeping `total` alive to feed a dead reading-time string would have preserved exactly the field the bug read.
- **Words and characters come back TOGETHER.** One include-set read, one call, so a surface cannot filter one and not the other — task 121's contract made structural instead of duplicated.
- **The summation rule is module-PRIVATE; publish whole operations.** An exported `sumIncluded` is an invitation to re-derive "the total" from `counts.words` at the next call site, which is the fork this closes. `includedTotals` and `sumIncludedWords` (the Outline's per-section ranges, now expressed through the same rule) are the whole public surface.
- **A second producer, not a second walker.** The selection counter cuts its range with `doc.slice(from, to, true)` and hands the block fragment to the canonical walker, so a selection and the document are the same kind of thing (`CategoryCounts`) counted the same way. `includeParents` is load-bearing: without it a selection inside ONE textblock resolves to the shared depth and returns BARE INLINE nodes — no paragraph, no heading — and the block walker silently counts zero for the commonest selection there is.

CI: [word-count-filter-ssot.test.ts](../../../src/lib/__tests__/word-count-filter-ssot.test.ts). The selection legs drive a REAL editor (the `includeParents` distinction is invisible to any hand-built fixture); the leg with teeth is the **census**, because the door was never the part that could misbehave — a call site that doesn't ask it is: no production file outside the module may `reduce` over the include-set, the four retired field names must have no production site, and every file supplying the goal strip's `currentWords` must import the door. All three fail on the pre-fix tree.

**Two residuals, stated.** A goal set before this change keeps an `initialWords` baseline measured on the old ruler, so its progress bar reads high until the goal is re-set (a progress bar, not data — deliberately not migrated); and toggling a category mid-goal moves the live number against that frozen baseline, which is inherent to "the goal follows the panel filter" and was the decision. Deliberately NOT folded in: `getAnchorSummary`'s "selection · 14 words" badge, which counts a captured plain-text snapshot with no category structure to filter — a different question, not a fourth divergence.

### The premise half: a per-kind table that asserts a SCHEMA fact must be CHECKED against the schema

Same law, eighth tense (task 148) — and the one where the table was not dead, not stale and not half-consolidated. It was simply **untrue**, and nothing in the system was entitled to notice.

`TEXT_OBJECT_REGISTRY[kind].actions` curates what a grab-bar menu may offer per kind, and one of its buckets carried a stated premise: `NON_PROSE_BLOCK_ACTIONS` drops footnote / citation / suggest-edit because there is "no place to embed inline insertions in non-prose blocks / structural containers." True for the block ATOMS (`displayMath`, `texBlock`, `graphicsBlock`) and for the `text*` verbatim kinds. False for the four **containers** filed beside them — `bulletList`, `orderedList`, `exampleBlock`, `figureBlock` — each of which holds prose a caret can sit in. So the grab bar greyed three actions at an example while the lightning bolt, which resolves the caret's *immediate textblock parent*, enabled all three one position inside it, and `/footnote` landed the atom there quite happily.

> **A gate answers where the action ACTS, not where the gesture happened to point. And a per-kind table that asserts something about the schema is asserted against the schema in CI — the registry is editor-coupled and cannot check its own premise, so nothing else will.**

[`blockRangeAllowsAction(doc, from, to, action)`](../../../src/text-objects/text-object-registry.ts) is the one door every surface now enters: the grab bar with the block ref's resolved range, the caret surfaces with `from === to`, the selection menu with its span, and the dispatcher's defence-in-depth re-check with the range it is about to splice. Actions that act ON a block still read the range START's curated set (byte-identical to the old `posBlockAllowsAction`, which is now the caret form of this). The `INLINE_INSERT_ACTIONS` family — footnote / citation / suggest-edit, the three that act at an inline POSITION — is answered by the textblocks the range can REACH, every one of which must permit it. Four rules it earned:

- **The family is the thing that could not be answered per kind, and `highlight` is deliberately not in it.** Highlight is mark-backed like suggest-edit, but the true atom blocks keep it as a *pinned clean no-op* (no text ⇒ it early-breaks), so it stays a per-KIND policy answer. `CONTAINER_SENSITIVE_ACTIONS` in the dispatcher is derived as the family + highlight rather than re-listed.
- **Requiring EVERY reachable textblock is the fail-closed direction, and it retired two silent doors of its own.** A selection running from prose into a `titleField` can no longer land the `\title{\cite{}}` task 061 exists to prevent (the old gate asked only `resolved.from` while the atom lands at `range.to`), and a quote or list item whose body is a `codeBlock` can no longer take a footnote into a `text*` node. Cost, stated: a container mixing prose and verbatim greys at the container level even where the landing would have been fine — the caret surface still allows it, so nothing is unreachable.
- **The premise is checked, not restated.** `typeHostsInlineInsert(type, action)` walks the ContentMatch automaton from a kind's node type and asks each reachable textblock whether it admits that inline node (or the `linkedAnchor` mark, for suggest-edit). CI sweeps every kind × the family and fails any drop the schema contradicts, with **one** allowlist entry — `titleField × citation`, "a title has no bibliography," a genuine editorial policy the schema knows nothing about. The set can only shrink.
- **Un-gating is worthless without fixing where the atom goes.** The two inline-atom branches collapse a block ref to its content-range END to put the marker "at the end of the passage" — and for a CONTAINER that is a position *between block children*, which nothing downstream repairs: TipTap's `setTextSelection` clamps to doc bounds, ProseMirror's `TextSelection` constructor only `console.warn`s (once per page load), and `insertContent` then asks the fitter to make room, which **fabricates** a trailing block. A grab-bar footnote on a block quote appended a phantom empty paragraph holding only the marker; on a list, a phantom extra bullet; on a figure, whose caption slot is full, the marker escaped to a new top-level paragraph. Schema-valid every time, `doc.check()` clean, no duplicate uuids, anchored to no word — which is why nothing ever failed. This shipped on `blockquote` / `listItem` / `exampleItem` (PROSE_ACTIONS containers all) long before 148, so [`inlineInsertPos`](../../../src/text-objects/text-object-registry.ts) fixes it for them too rather than only for the kinds this task un-gates.

**`NO_INLINE_LANDING_INSIDE` is the one set all three rules read** — the gate's reachable-textblock walk, the schema premise, and the landing resolver — so "may it land" and "where does it land" can never answer differently. Its two members are editorial facts the schema cannot express, and both were found by driving the real dispatch: an `exampleGloss`, because a `glossCell` is a *column* of an interlinear gloss and an atom in the last cell of the last tier changes that column against every other tier (the alignment destruction `dropEmptiedSourceBlock` refuses, "The identity half" above); and a `figureCaption`, because writing into an EMPTY one flips the `hasCaption` provenance both figure numberers gate on (task 319), silently renumbering every later figure and every `\ref` to them. That second entry is also why `figureBlock` stays on the reduced set although its content expression is prose: its ONLY body is that caption. The landing resolver is therefore a hand walk rather than `Selection.near(…, -1)` — `near` descends into whatever sits last, and for both shapes "whatever sits last" is precisely where the atom must not go.

**Residual, deliberate and pinned in the suite:** the lightning / slash surfaces still permit a footnote at a caret the user placed *inside* a figure caption (`figureCaption` is not a `TextObjectKind`, so it takes the gate's defensive allow). That is the one divergence in this class left standing, because closing it means TIGHTENING a surface the resolved decision said to leave permissive. CI: [container-body-inline-insert.test.ts](../../../src/lib/actions/__tests__/container-body-inline-insert.test.ts) — the schema census is the leg with teeth (the gate was never the part that could misbehave; a table stating a falsehood about the schema was), alongside a real-editor cross-surface parity sweep over BOTH menu surfaces, real-transaction landing legs, and the fail-closed pair. Every defect leg fails on the pre-fix tree.

### The reader half: a declared PREFERENCE is a promise that a pixel reads it

Same law, ninth tense (task 326) — and the one where the declaration was not dead, not stale, not untrue, but **unconsumed at the last inch**.

`mathColor` and `mathPrefixColor` were complete on every plumbing axis and consumed on none: an `EditorPreferences` field, a shipped default, a labelled row in Editor › Code & Math ("Color of rendered math expressions"), a `PREF_TO_CSS` row so `EditorLayout` wrote `--math-color` onto `:root` on every prefs change, a `dev-prefs-registry` source, and a first-paint seed in the managed `PROMOTE-DEFAULTS` block. And **zero `var(--math-color)` reads in either silo**. So a user opened the picker, chose a color, and watched a control that had never done anything — while `STYLE_GUIDE.md`'s own inline-atom list described inline math as "mono purple" for a year and the glyphs took KaTeX's inherited body ink.

> **A preference is an SSOT only if something READS it — and "reads it" means a pixel, not a plumbing layer.** The write is not the consumption: a token `:root` carries and no rule consults is a labelled control that cannot work. Where no consumer is possible, DELETE the declaration rather than leave the picker.

Both halves shipped. `mathColor` was **wired** — one `color` on `.inline-math` / `.display-math` / `.math-popover-preview`, which is the whole mechanism because KaTeX declares `color` on nothing of its own and draws its two non-glyph marks from `currentColor` by two different routes: `border-color` on `.katex *` (the fraction bar is a `.frac-line` border-bottom) and `fill/stroke` on `.katex svg` (the sqrt radical is an SVG path, not a border). It prints in that ink deliberately — the `@media print` block flattens exactly two inline atoms to `color: inherit`, and its own comment scopes that to the CHIP look ("lose the chip border and tinted background so they read as plain prose"), while `.footnote-marker` and `.latex-comment` already print colored. `mathPrefixColor` was **retired** — it promised to color "$ delimiters and prefixes", and `renderMath` runs KaTeX with `output: "html"`, so no delimiter survives into the DOM: there was no element it could ever have painted, and a picker that cannot work is worse than an absent one. Retiring means every site (interface, defaults JSON, tree row, `PREF_TO_CSS`, `dev-prefs-registry`, both `globals.css` seeds), the same "delete the stored copy, don't merely align it" rule the margin-side half earned.

Three rules it earned:

- **The guard runs the direction no existing one could.** `phantom-css-var.test.ts` asks whether a `var()` READ resolves to a definition; this is a definition with no read, and the two are structurally blind to each other. `atom-chrome-tokens.test.ts` (task 194 — the *mirror image* defect, a rule with a literal and no preference) asks whether an atom's rest rule spells a literal, and `.inline-math` declared no `color` at all, so it answered honestly "clean". [inert-preference-controls.test.ts](../../../src/__tests__/inert-preference-controls.test.ts) is the reverse census: every `PREF_TO_CSS`/`DERIVED_CSS` `cssVar` has a reader (leg A), and every leaf of `PREFERENCES_TREE` moves a pixel (leg B).
- **Ask the mechanism which prefs a derived token depends on; don't parse the compute.** A pref can reach the document through a DERIVED token instead of its own — `commentColor`'s own `--comment-color` has no reader and its `hexToRgba`-derived `--comment-bg` does — so leg B establishes the dependency by PERTURBATION against the real `compute` (change the pref, see whether the output moves). A source-parsing version would have to restate the `?? fallback` shape that makes `fontSerif` a real dependency of `--font-headers-family`.
- **Record the other hits honestly; do not widen the allowlist in silence.** The census's first run found **eight** more unread tokens, five of them labelled dialog rows: Suggestions › Mark background / Mark border (the anchor-accent family paints that chrome instead), Panels › Header size (`.panel-header-title` takes color and family from prefs and its size from the `--panel-font-size` inheritance), and the Fonts dialog's Display / Logo pickers (both faces are reached as the bare `next/font` vars, skipping the override rung the sans/serif/mono chains have). Each is PRE-EXISTING, each needs a visual decision about which element takes the value — which is why they are recorded with a stated reason rather than fixed beside the math pref, whose consumer was unambiguous. Both lists may only SHRINK.

**Retiring a preference is not durable until the promoter prunes.** `usePreferences.defaults.json` is not hand-maintained — `tools/promote-defaults.mjs` folds Gabriel's mirrored localStorage blob into it on a Tue/Fri cron that commits and **pushes to main** behind a `JSON.parse` gate with no tsc and no tests. His blob comes from `loadPrefs`'s `{ ...DEFAULT_PREFS, ...JSON.parse(raw) }`, re-serialized whole, so a key retired from the interface is never pruned from his storage, and the mirror POSTs it verbatim. The `replace-all` strategy copied EVERY snapshot key, so a retirement was undone on the next tick — and `check-prefs-coverage` is blind to it by construction (it asserts interface ⊆ defaults; an EXTRA key is not a failure). Proof rather than theory: `aiMarkerText`/`aiMarkerBg`/`aiMarkerBorder` were retired in `1c0c52be` and were back in the JSON the next day (`ffa7dfe0`), where they sat unread for two months until this task deleted them. So `applyAll` now IGNORES (and logs) keys the target does not declare — the snapshot supplies VALUES, never vocabulary. Both `replace-all` targets are closed vocabularies in tracked source, so a legitimately new key is always already present and survives untouched — but what closes each is a TEST, not a type, and the tool's comment says so, because the obvious answer is wrong twice: `DEFAULT_PREFS` and `DEFAULT_PANEL_COLORS` are both `as` CASTS (the thing `print.ts` already says out loud about its own), so the real nets are `check-prefs-coverage` check 1 and `panel-theme-key-freeze`'s hand-written `FROZEN_THEME_KEYS` exact-set assertion. The trade this accepts is stated there too: a pref added to the interface and forgotten in the JSON used to be healed silently by the next tick and is now dropped every tick, with only a launchd log line to show for it — deliberate, since a shipped default no interface declares is worse than a loud missing one. Leg C of the census is the net under the mechanism, with an EMPTY allowlist: no shipped default may be an orphan.

**A file that RENDERS the control is not a witness that the control works.** Channel 3 excludes the two vocabulary files AND every prefs control surface (`FontsDialog`, `PreferencesModal`, `PreferenceTree`, `SmartPreferences`; `PreferenceModePicker` was a member until task 495 retired it) — because an inert picker's own dialog names its key, and a bare-name grep would otherwise exonerate it off exactly the surface whose emptiness IS the bug. That exclusion is also what covers the second control surface leg B cannot see: `PREFERENCES_TREE` is not the only labelled-row source (`FontsDialog` binds its own `<FieldRow>`s straight to prefs), so a Fonts-dialog pref reaching no token now falls to leg C as an ORPHAN rather than passing everything. It is a pure tightening — measured when it landed, the inert set does not move, since every real font pref reaches pixels through its own `--font-*` token or a derived one.

The stated limits are in the suite's header: a read inside another custom property's definition counts as a read without chasing whether that host is itself read (no pref token is alias-only today); channel 3 is a deliberately generous bare-name grep; leg B's coverage of the Fonts dialog is indirect, so its diagnosis there is right about the fact and vague about the row (folding a second surface into leg B needs that surface to become DATA — JSX rows are not enumerable); `perturb` has no boolean arm because no boolean pref exists yet, and if one lands it fails toward a false ACCUSATION rather than a false exoneration; and **"read" is not "visible"** — a token consumed by a rule whose selector never matches passes here. Only an eyeball settles that. Same commit drained the CSS half of the stripper fork onto one scanner — [_source-scan.ts](../../../src/lib/__tests__/_source-scan.ts)'s `cssCommentsStripped`, the rule task 227 earned after two censuses were burned by private variants. All four call sites now read it: the two hand-rolled twins in `phantom-css-var` / `atom-chrome-tokens` (byte-identical scanners, differing from the shared one only in preserving newlines, so `phantom-css-var`'s CSS `file:line` reports stop drifting by every multi-line comment above them) and `css-invalidation-guardrail`'s regex, which was a fourth variant with two failure modes of its own: it DELETED rather than blanked, so `:has/* c */(` would join into a live-looking `:has(`, and a non-greedy `[\s\S]*?` leaves an UNTERMINATED comment at EOF intact.

### The composition half: a SELECTOR is part of the contract, not a caller's private string

Same law, tenth tense (task 204) — and the one where the SSOT was alive, read, and correct, and had simply stopped one rung short of the form its consumers actually needed.

`link-dom-contract.ts` owned two rungs: the attribute NAMES (`DATA_LINK_*`) and the token GRAMMAR (`linkCardKey` / `parseLinkCardKey`). It did not own the SELECTOR — the composition of a name with a value — which is the **only form either is ever used in at a query site**. So task 202's census closed the producers and wrote *"READS stay free"* into its own leg, on the stated ground that `` `[${DATA_LINK_CARD}="${key}"]` `` reads worse than the literal it would replace. That ground was correct and the conclusion drawn from it was not.

> **A value that two layers must agree on is spelled once; so is the ADDRESS built from it. Where a name and a value meet, the composition belongs to the contract — a call site that assembles its own selector is a second speller of both.**

The sibling grammar had all three rungs the whole time and nobody noticed the asymmetry: `data-card-key` has `cardPopKey` (build), `parseAnyKey` (read) **and** `cardDomSelector` (address), the last pinned byte-exact by `card-key-seams-contract.test.ts`. `data-link-card` had two. Four rules it earned:

- **The missing rung made the wrong answer the better-reading one.** This is the generalizable part. A guard whose compliant form is uglier than the violation loses, and it loses *quietly* — as an exemption written into the guard with a reasonable-sounding justification, which is exactly what "READS stay free" was. When a census must exempt a whole category on ergonomic grounds, the finding is usually a missing primitive, not a necessary exception. The four builders ([link-dom-contract.ts](../../../src/links/link-dom-contract.ts): `linkIdSelector`, `linkKindSelector`, `linkCardSelector`, `linkCardIdSelector`) read *better* than what they replaced, which is why the exemption could then be deleted rather than argued with. A fifth (`linkCardKeySelector`, taking a pre-built token) was written and retired in the same pass — every legacy-token site BUILDS a mark attr and none QUERIES, so it would have shipped with no caller, and the in-file call from its own sibling was enough to make the export census pass. **A sibling call is not a consumer**: that is this directory's own law reaching one rung further than the census can.
- **A PRESENCE test earns no builder and gets none.** `` `.linked-anchor[${DATA_LINK_ID}]` `` has no value to interleave, so the bare interpolated constant reads fine. The rule is drawn at composition, not at "mentions a name" — a builder for every occurrence would be the churn the original judgment call rightly feared.
- **The build census could not see a hand PARSE, and one was live.** `HAND_BUILT_TOKEN` matches interpolation shapes, so it watches a token being *constructed* and is blind to one being *taken apart*. `useTextHoverBridge` read `getAttribute("data-link-card")` and then ran `indexOf(":")` + two slices — `parseLinkCardKey` re-typed, four lines from a module that exports it, with every 202 leg green. Both failure modes are the same one and neither is a type error: **the query stops MATCHING rather than stops compiling.**
- **A duplicated COMPOSITE address is the same defect one size up.** `marker-clicks.ts` and `panel-selection.ts` each spelled `[data-footnote-entry="<id>"], [data-link-card="footnote:<id>"]`, byte for byte, in two files with no shared owner. That one is not the link contract's to own (`data-footnote-entry` is the panel's own vocabulary), so it went to the module that already had the per-panel table: `panelEntrySelector` is exported and `marker-clicks` calls it. **Put the SSOT where the question is already answered**, not where the newest constant happens to live.

CI: [link-surface-honesty.test.ts](../../../src/links/__tests__/link-surface-honesty.test.ts), the same suite, widened. The name census is now TOTAL over both silos — write, query, or bare `getAttribute` — with the two boundaries that genuinely cannot participate stated rather than pretended away (`globals.css`, which imports nothing, and a JSX attribute, which has no computed-name syntax, so the two panel cards spell the name and single-source the VALUE). A second allowlist, `PERMITTED_ATTR_NAME_MENTIONS`, covers the two dev-only `console.error` strings that name an attribute as PROSE — and it is keyed by a **fragment of the prose, not by the file**, which the adversarial pass on this fix is what earned. The obvious file-scoped form (the idiom its sibling list uses) justifies a READ mention and would hand back the WRITE coverage the file already had; one of the two files is `links.ts`, the module whose four query sites this task converted and therefore the likeliest place for a fifth to appear. The stale-entry leg could not have caught that drift either, since a file-scoped version can only re-test the same needle the census uses — which an operative selector satisfies exactly as well as a sentence does. **An exemption must be scoped to the shape it justifies**: per-line here, and never excusing a write. Beside the build leg sits a parse leg (a colon-split whose preceding 10-line window names the card attribute), and the builders themselves are pinned byte-exact against **both** the constants they compose and the literal strings that shipped before this task — a cleanup that moves the DOM contract is a behaviour change wearing a refactor's clothes. Both defect legs fail on the pre-fix tree.

The stated limits: the parse needle's window is coarser than a scope (the alternative is parsing declarations to find the enclosing function, precision it does not need), and the name census is a literal grep — `"data-link-" + "id"` or a `dataset.linkCard` camelCase access would slip through, neither of which is an idiom this repo uses anywhere.

### The exhaustiveness half: a completeness guard whose reference set is a HAND-LIST is a tautology

Same law, eleventh tense (task 260) — and the one where the guard existed, ran in CI, was read, and checked the wrong two things against each other.

`assertActionCoverage` advertised `VIRGIL_ACTION_REGISTRY` as the **COMPLETE SSOT** and asserted it "in BOTH directions": its step-5 leg compared `EXPECTED_ACTION_IDS` (the manifest) against the union of the `COVERED_*` slices, and promised in prose that "if a future chip adds an `ActionId` to the union, it MUST add it to `EXPECTED_ACTION_IDS` + a `COVERED_*` entry + a row — otherwise this guard trips." Both sides were hand-authored `readonly <SubUnion>[]` arrays. The `ActionId` union — the actual master vocabulary — was the reference of neither.

> **A completeness guard is only as strong as what its reference set is PINNED to. An array typed `readonly K[]` enforces SUBSET (every element is a member); only a `Record<K, …>` enforces SUPERSET (every member is present). A union has no runtime enumeration, so union-completeness is a COMPILE-TIME property or it is nothing — a runtime leg comparing two hand-lists is a tautology wearing a guard's clothes.**

The invariant held for **card / format / heading** and only by accident: each of those three has an incidental exhaustive `Record` elsewhere (`CARD_ACTION_PRESENTATION`, `FORMAT_ACTION_ROWS`, `HEADING_ID_LEVEL`) that a new member breaks first, which then makes `covered` auto-expand and the equality leg trip. **atom / title / non-heading-block** had no such Record, and `Partial<Record<ActionId, ActionSpec>>` + an `as` cast made a missing row legal besides. Measured on the pre-fix tree by adding three scratch members (`AtomActionId | "eqref"`, `NonHeadingBlockActionId | "verbatim"`, `TitleActionId | "keywords"`): **zero** production errors for two of them, `assertActionCoverage()` → `[]`, and an action reachable from a consumer that resolves to nothing at runtime.

**The severity, stated precisely, because the adversarial pass on this fix caught the first draft overstating it.** The project typecheck was **red**, not green — one error, from `applicability-collab-gate.test.ts`'s `EXPECTED_MODE` (`Record<ActionId, ActionSelectionMode>`), a test's expected-value table that happens to be exhaustive. So the hole was not CI-invisible; it was **CI-misdirected**. That error names a missing selection-MODE entry, and adding the three ids there satisfies it completely while still shipping three actions the registry cannot resolve. **A net that names the wrong obligation teaches the next author to discharge the wrong obligation** — which is why the pin belongs at the declaration even though something, somewhere, went red.

Four rules it earned:

- **Give every family the shape the accidental ones already had, then DERIVE.** Six `Record<<Family>ActionId, ActionSpec>` row tables spread into an annotated total `Readonly<Record<ActionId, ActionSpec>>`; `EXPECTED_ACTION_IDS` and every `COVERED_*` slice read those keys through `keysOf`. A new member of any family fails to compile **at that family's exhaustive table** — the ROW table for atom / title / block / format, and (measured) the presentation / level table it derives FROM for card / heading, whose row tables are `mapRecord` results and therefore cannot be missing a key; their annotations still refuse a degraded `mapRecord`. A whole new FAMILY fails at the assembly, and `_ACTION_ID_PARTITION_PROOF` beside it turns "property 'x' is missing" on a six-line spread into `{ "an ActionId family has no exhaustive row table": "x" }` — the diagnostic, not the mechanism, and it only ever speaks for that case, since a within-family error fires first. The two halves of `BlockActionId` are `HeadingActionId` and `Exclude<BlockActionId, HeadingActionId>`, so they partition by construction rather than by a second list.
- **Say where the guarantee moved, and demote the leg that no longer carries it.** Step 5 now compares two DERIVED sets, so it can no longer establish completeness — it is a derivation-fork check (a slice re-hand-listed, a row spread in from outside a family table), and its comment says exactly that. Leaving the old prose would have been the worse half of this defect: a guard that overstates its reach is the failure mode this whole section is about.
- **The census is the leg with teeth; the type pin is the mechanism.** The annotation was never the part that could misbehave — a `COVERED_*` re-hand-listed beside it is, and no runtime test can see that. So [action-union-exhaustiveness.test.ts](../../../src/lib/actions/__tests__/action-union-exhaustiveness.test.ts) reads SOURCE: the total annotation with no `Partial`/`as`, an exhaustive family table per family each spread into the registry, every id list derived through `keysOf`, and no re-hand-listed manifest, with a declaration-count swallow self-check and defect fixtures that are synthetic rather than live lines (a canary must not stand on the defect). **The census discovers the family tables from `_FamilyCoveredActionId`'s own `keyof typeof` clauses rather than listing them** — a hand list inside the guard that outlaws hand lists is this defect one level up, and it would sit green while a seventh family's table was annotated `Record<string, …>`. Its remaining reach is stated in the suite rather than implied: the re-hand-listed needle is NAME-scoped and FILE-scoped, so a manifest called `ALL_IDS`, or moved one file over, passes.
- **A type-level leg needs an ACCEPTING CONTROL, for the same reason a defect leg does.** `const _registryIsTotal: Record<ActionId, ActionSpec> = VIRGIL_ACTION_REGISTRY` goes red if the registry ever returns to `Partial` — and would pass for the wrong reason if the registry quietly became `any`. So a `@ts-expect-error`'d twin over `Record<ActionId | "scratch-action", ActionSpec>` sits beside it: type it `any` and the expected error disappears, `TS2578` fires, the build goes red. (An index SIGNATURE is *not* such a route — measured, `Record<string, ActionSpec>` reddens the positive leg directly. The control's first draft claimed otherwise, and naming a mechanism that does not exist is the same overstatement this section is about.) Both are enforced by `tsc --noEmit` (which includes `**/*.ts`), not by vitest — they live in the suite that explains them rather than in production source, where they would read as live code.

**One more accident fired pre-260, on one family only:** `titleFieldRow`'s parameter was hand-typed `"title" | "author" | "date"` instead of `TitleActionId`, so the `.map` failed and named the row *builder* rather than the missing row. That parameter now names the union, so the accident is gone and the declared pin does the work.

Same *class* as task 259 (a per-kind capability that "looks pinned" and isn't) and adjacent to the parked 228 (this same assertion's consumer-**reconciliation** symmetry, a different axis, still open).

#### The reverse half: a completeness guard runs in the direction that ROTS

Same law, the DOCS-vs-code instance (task 562) — and the case where the guard
was designed, built, graduated to an error, run on every push, and asked its
question in exactly one direction. `check-coherence.mjs` check 2 ("type
accounting") verified that every type EXPORTED from `src/lib/types.ts` is NAMED
in VIRGIL.md's Public-type registry or its delegated enumeration. It never asked
the reverse — that every NAME still EXISTS. So `DocumentPayload` (deleted in
task 417), and `UserComment` / `CommentsState` (deleted in A1 gardening) stayed
enumerated in the skill-facing manifest `sidecars.md` — the last two with full
field-level schemas, so a skill reading it believed `comments.json` had a live
typed shape to write against — and a `**58** exported` count sat two exports
stale in three places, with CI green and the SKETCH's own staging note saying
"58/58 accounted". The v0.1.105 release refresh agent flagged the count as
unresolved and declined to change one side alone, which is how it was found.

> **A completeness guard between two sets asks BOTH inclusions, and its
> reference set is what the code EXPORTS, never what the doc NAMES.** Forward:
> every export is named. Reverse: every name resolves — to an export of one of
> the registry section's OWN `covers-code` sources, or to a declaration the
> naming doc makes (`<!-- type-externals: JSONContent (why) -->`). A stated
> `**N** exported` count is a claim about code and is checked as one.

Six rules it earned:

- **The naming SURFACES are discovered from the graph, never hand-listed**: the
  registry section, every local `.md#section` it links, and the WHOLE body of
  every graph node whose `derives-from` targets the registry section. That last
  arm is the one with teeth here — the dead `comments.json` schema sat OUTSIDE
  the delegated Coverage section, in "Legacy / dead types", where a
  section-scoped reverse arm walks past it. A doc derived from the type registry
  IS a type-naming doc.
- **The universe is the registry section's `covers-code`, which is why `Link`
  needs no special case.** `Link` is exported by `src/links/_shared/types.ts`,
  not by `types.ts`, and the registry section already covers that file (and
  `src/panels/_shared/types.ts`) — the doc had been recording the fact
  ("doc-of-record elsewhere") without the check being able to read it.
- **An external is DECLARED by the doc that names it, and a declaration that has
  stopped excusing anything is an error** — one a covers-code source does
  export, or one the doc names nowhere. The list can only shrink. TipTap's
  `JSONContent` is the one member.
- **A delegation follows links to GRAPH NODES only.** The registry links to the
  check's own `*.SKETCH.md` as a pointer to the DESIGN; sketches are excluded
  from the graph by construction (`discoverDocs`), so they cannot be naming
  surfaces — measured, the first cut indicted the SKETCH's own prose about the
  stale 58.
- **A schema-shaped token claims its LEADING identifier.** The manifest states a
  sidecar's shape as `` `TypeName { field; … }` ``, so a bare-PascalCase reading
  walks past exactly the form the dead schema was written in.
- **The count is pinned, not deleted.** A number a reader takes as fact about
  code is the thing that rotted; the check now reads every `**N** exported` on a
  naming surface against the real export count. The unbolded restatements
  ("all 58", "two of the 58") were reworded to carry no number.

**The task's own arithmetic was wrong, and checking it is what sized the fix.**
It read 58 named − 3 absent = 55 against 57 exported and concluded the
enumeration was also MISSING two types. Measured, the Coverage index names all
57 exports; its 61 tokens were 57 + the three dead names + `Link`. So the
enumeration needed no recomputing — the counts and the corpses did.

CI: fixtures E–J in [check-coherence.smoke.mjs](../../../tools/check-coherence.smoke.mjs)
drive the REAL CLI over a miniature registry graph: the forward direction (which
had NO smoke coverage before), the reverse on all three surfaces (registry,
delegated section, derived doc outside it — in schema form), the count pin, the
undeclared external and both stale-declaration shapes, the section-in-whole-doc
dedupe, and the two accepting controls (a sibling covers-code type, a declared
external). Measured against the pre-562 script: **14 legs fail** — every reverse,
count and externals leg — and the forward and clean legs pass, which is the point.
The real check ran on the stale docs and named exactly the three dead types,
`JSONContent`, and the four `**58**`s, and nothing else.

### The dialect half: what a system DOES model, it gives back in the form it was given

Same round trip, and the case that is the carrier doctrine's other side (task
355). Task 342's rule — *what the system does not model, it CARRIES* — kept a
linguex paper byte-intact by refusing to claim it (task 350). This one models
it, and the interesting question is then not whether the bytes survive but
whether they come back in the SAME SYNTAX.

Linguistics papers number examples with one of two mutually incompatible
packages, and a real paper loads both:

```
expex     \ex \label{s1} … \xe      (an explicit close)
linguex   \ex.\label{s1} …          (terminated by a blank line)
```

> **A per-example `dialect` attr, and the serializer writes each example back
> in ITS OWN dialect.** Converting on open would rewrite every example in a
> co-authored file Virgil was merely asked to READ — an Overleaf diff bomb —
> and, since both packages define `\ex`, it would need a `\usepackage{expex}`
> that BREAKS the paper. Faithful round-trip is the Virgil-shaped answer;
> convert-on-open was considered and rejected.

Six rules it earned:

- **FORM decides which dialect; the PACKAGE decides whether to model.** The
  period is the per-SITE discriminator ([latex-lexer.ts](../../../src/lib/latex-lexer.ts)
  `matchExpexOpenerAt` / `matchLinguexOpenerAt`, neither consulting a preamble —
  a fragment, a card body and a paste have none), so a mixed document is read
  example by example. Whether Virgil may CLAIM a linguex site is a different
  question, asked once of the LIVE preamble (`preambleLoadsPackage` →
  `livePreamble`, the 344/345 detector law) and held as module state beside
  `seenTitleFields`, because it is a per-DOCUMENT fact and `ParseContext` is
  per-SLICE — a document capability threaded through four sub-context
  constructors is one someone forgets at the fifth.
- **The bound is the GRAMMAR's, not the code's.** A linguex example has no
  closing command; it ends at the paragraph break. So `linguexExampleEnd` stops
  at the first blank line (or block boundary), and task 350's swallow-to-EOF is
  **unrepresentable** here — a property that survives only while nothing bolts a
  "continuation" heuristic onto that scan. Do not add one.
- **What is not modelled is refused WHOLE.** `\exg.` / `\exi.` / `\exr.` are
  different control words, so the control-word boundary declines them and 342's
  carrier takes their bytes with no list to maintain; `\z.`, a glossed part
  (`\bg.`) and a third nesting tier are detected and REFUSE the example, which
  falls back to the same carrier. Never half-parsed — 350 defect C's rule
  (*never emit a node that serializes to less than it consumed*), one dialect
  over.
- **One assembly, two splitters.** The dialects agree on nothing before the
  split and everything after it, so `assembleExampleBody` is shared and every
  consumer downstream — numbering, cards, the panel, drop specs, the float
  bodies — is dialect-BLIND by construction rather than by care. The SERIALIZER
  is deliberately NOT shared (the two assemblies differ line for line, and the
  expex walker's separator coupling describes a grammar linguex does not have).
- **A live compile hazard fell out of the same discriminator.** The
  requirements FALLBACK detector matched `\ex` with no period lookahead, so a
  linguex `\ex.` — carried raw post-350, or modelled post-355 — declared expex
  and `ensurePreambleRequirements` injected `\usepackage{expex}` AFTER the
  user's own `\usepackage{linguex}`. Both define `\ex`, the later load wins, and
  every example in the paper stops compiling: a preamble the user never wrote,
  breaking a document that compiled before Virgil opened it. Fixed at
  [PACKAGE_DETECTORS](../../../src/lib/latex-requirement-collector.ts), and the detector
  is CHECKED against the opener SSOT rather than restated (148's instrument),
  since it sits in a leaf that cannot import the lexer.
- **A NEW example takes the document's DOMINANT dialect, derived from the
  document** ([example-dialect.ts](../../../src/lib/example-dialect.ts)) — purely linguex
  mints linguex, empty / expex / MIXED mints expex. Derived rather than
  re-asking the preamble, because a linguex example only exists in the tree
  because the parse found the package; and the fallback direction is the safe
  one, since expex is injected from the emit itself where linguex never is. The
  task text's gloss ("linguex iff the package is loaded and expex is not") is
  materially worse for the papers this exists for: Gabriel's own loads BOTH and
  writes linguex, so it would start minting expex into a linguex file.

**Stated normalization:** author layout INSIDE an example is canonicalized once
(header line, one part per line, the prose of a single example riding the header)
and is a fixed point from cycle 1 — the same one-time normalization every other
construct in the serializer performs. Part letters are derived from POSITION,
which is what linguex's own 26 aliases are for, so an in-order source reproduces
byte-for-byte and an out-of-order one normalizes.

CI: [linguex-dialect-roundtrip.test.ts](../../../src/lib/__tests__/linguex-dialect-roundtrip.test.ts)
drives the REAL save pipeline over two cycles per leg, with an expex example and
a linguex paper with the package COMMENTED OUT as controls through the identical
harness. Every pre-355 example fixture in the repo is spelled in expex, so a
dialect divergence was unrepresentable in all of them. The leg with teeth is the
**census**: the parse and the serializer were never the part that can misbehave —
a CONSUMER that starts special-casing the dialect is, and it would type-check
perfectly. So the literal `"linguex"` may appear in production code only in the
five layers that DECIDE the dialect; a hit is a design question, not an allowlist
entry. Measured by neutering each half in turn: dropping the modelling takes 10
legs, the extent scan's marker skip 4, the detector lookahead 2, the refusal
vocabulary 2, the preamble projection 2.

**Owed, not claimed:** a preview eyeball and a real-FSA open of Gabriel's own
co-authored linguex paper. What is proven here is the `.tex` round trip end to
end, which is not FSA-masked.

#### The injection half: a package family the document may load ONE member of

Same dialect, the PREAMBLE (task 543) — and the case where the injector was
right about every package it knew and blind to the one relation between them.
Gabriel: *"Can you auto-detect and auto-add any necessary packages (e.g. for
forest expex linguex or anything else)?"* Most of that existed (P4, tasks 345
/ 355 / 385); what the sweep over his real papers found was not a missing
row but a missing RULE. Three members, measured through the real save
pipeline on the pre-543 tree:

- **A linguex `\ex.` pasted into a document with no example package got
  NOTHING.** The linguex arm's docstring said *"Requirements: NONE,
  deliberately"* — its stated reason being that a declaration would inject
  linguex beside a loaded expex and break the paper. True of the INJECTOR,
  wrong as a reason to leave the EMIT undeclared.
- **A gb4e paper had `\usepackage{expex}` injected after `\usepackage{gb4e}`
  on the first open.** gb4e (the third `\ex` package, which Virgil never
  models — its `\begin{exe}` is carried raw, task 342) is what FIVE of
  Gabriel's Dropbox papers load. The carried `\ex` tripped the expex
  detector, both packages define `\ex`, the later load wins, and every
  example in the paper stops compiling — task 355's hazard, one package
  over, on a preamble the user never wrote.
- **An expex example under a linguex-only preamble injected expex after
  linguex** — 355 closed the false DETECTION (a `\ex.` read as expex) and
  left the genuine expex example's injection unreconciled.

> **`EXAMPLE_PACKAGE_FAMILY`** ([example-dialect.ts](../../../src/lib/example-dialect.ts):
> expex, linguex, gb4e) **is the set of packages that each define `\ex`, of
> which a document may load EXACTLY ONE. A loaded member outranks the model's
> need for any other member: that need is dropped and SURFACED, never
> injected — the bib family's "warn, never rewrite" posture, read as a second
> family. And every emit declares what it emits:** the linguex arm declares
> `linguex` from the node model, and `PACKAGE_DETECTORS` gains the row for a
> CARRIED `\ex.` — the paste case, which then heals itself (cycle 1 injects,
> cycle 2 models and mints markers, cycle 3 is the fixed point).

Five rules it earned:

- **A declaration is not an injection decision.** The emit-site says what its
  bytes need; whether the injector may LAND that need is a question about the
  preamble, asked once in `ensurePreambleRequirements`. Conflating the two is
  how "never declare linguex" came to be the guard for "never inject beside
  expex" — and left the paste case with no declaration at all.
- **A loaded-only member is a member.** gb4e has no inject line (nothing emits
  its syntax) and belongs in the family anyway, because the exclusion rule
  reads the family and the family is about who OWNS `\ex`. A family that
  listed only what Virgil can write would re-open the gb4e member the moment
  someone tidied it.
- **ONE conflict channel, discriminated by `family`.** `RequirementConflict`
  ([latex-requirements.ts](../../../src/lib/latex-requirements.ts)) replaces
  `BibFamilyConflict` at every callback (`onRequirementConflict`, threaded
  bridge → `CodeEditor` → `EditorLayout`); a second callback for the second
  family is two chances to wire one. The shell's copy is COMPOSED from the
  record's fields, never branched on a dialect literal — the task-355 census
  is what keeps a consumer from special-casing the dialect, and it now
  allowlists `latex-requirements.ts` as a DECIDING layer.
- **Neither loaded + both needed ⇒ expex alone, linguex surfaced.** The
  baseline dialect (`VIRGIL_BASELINE_PACKAGES` ships it, `dominantExampleDialect`
  mints it for a mixed document) is the one member with a claim; injecting
  both would be the hazard the family exists to prevent.
- **Coverage is asked of the SCHEMA, not of the last construct someone
  added.** [package-requirement-coverage.test.ts](../../../src/lib/__tests__/package-requirement-coverage.test.ts)
  pins an EXACT-set fixture per node and mark type the real main schema
  declares and asserts, per fixture, that the fallback detector rescues
  nothing the emit-site did not declare — so a modeled construct cannot ship
  without its package again; every detector row must have an inject line (a
  row with none detects nothing); every `need("…")` literal must be a registry
  id; and the linguex detector must agree with `matchLinguexOpenerAt`. The
  family legs drive the REAL save pipeline over every loaded × needed cell.

**Audited and recorded, not closed.** The sweep over 26 real preambles found no
construct Gabriel writes that the vocabulary misses; the theoretical gaps are
stated with their reasons: `amsmath`-only environments (`align`, `gather`,
`cases` …) inside carried envs — every Virgil-authored preamble ships amsmath
and no real paper lacked it; `booktabs` / `multirow` rules inside a carried
`tabular`, `\url` / `\href` (which of `url` / `hyperref` to inject is a product
call), and `tikz-qtree`'s `\Tree` — each needs a membership vocabulary this
codebase has no SSOT for, and a hand list there is the drift every census here
exists to prevent. Each is one `PACKAGE_DETECTORS` row plus one registry row
if a real paper ever needs it.

**Residuals, stated.** A Virgil-authored preamble ships expex, so linguex
bytes pasted into a FRESH Virgil document are surfaced as a conflict rather
than injected — the rule's honest answer, and the user's own preamble is one
line away. And the notice travels only the code-pane serialize (as the bib
notice always has); the disk-save path passes no callback.

**Owed, not claimed:** a real-FSA eyeball on a gb4e paper (open one of the
five, confirm `\usepackage{expex}` is NOT added and the notice names gb4e),
and Coherence Intro compiling with every package found. Not FSA-masked at the
`.tex` level — the family legs are the durable proof.


#### The display half: a fragment shown to a READER is projected, not printed

Same vocabulary, other DIRECTION (task 368) — and the case where every rung was
correct, shared and censused, and a whole family of surfaces never entered any
of them.

A `.tex` document reaches the screen through one of the two inline PARSERS. A
great deal of LaTeX never takes that road: a citation's `[prenote][postnote]`
lives on the atom as raw command BYTES, and a `.bib` entry's `author` / `title` /
`year` are raw field bytes read straight out of the file. Both are then rendered
as DISPLAY TEXT, and `formatInlineCitation` — the ONE formatter every citation
surface reads (the inline chip, the Citations panel preview and card meta, the
card-body surfaces live and static, the float bodies, the footnote hover preview,
the drag ghosts) — interpolated them into its output with no projection at all.
So Gabriel's chip rendered `(Kehler, 2002, ex.\textasciitilde{}38,
p.\textasciitilde{}22)`: the four literal words `textasciitilde`, shown to the
reader, from valid source. Nothing threw, the `.tex` was correct, and the body
text one line away showed the same bytes correctly.

> **A raw-LaTeX fragment shown as DISPLAY TEXT is projected through ONE door —
> [`latexToDisplayText`](../../../src/lib/latex-typography.ts) — derived from the same
> tables the parse rungs read, and it is TOTAL by PASSING BYTES THROUGH rather
> than by guessing: a construct the tables do not know arrives at the reader
> exactly as it sits in the file. DISPLAY ONLY — nothing it returns is ever
> written back.**

Five rules it earned:

- **Project the OUTPUT once, not the ten interpolations.** `formatInlineCitation`
  is now a two-line wrapper over a module-PRIVATE `formatInlineCitationRaw`, so
  every command branch is covered — including the ones a future dispatch case
  adds — and there is no per-branch decision for anyone to forget. The raw
  dispatch stays private because an exported one is a SECOND display door, and
  the one a caller reaches for is the one that skips the projection.
- **The branch order MIRRORS `parseInlineContent`**, so a fragment that could
  have been body text projects to the characters body text would have shown.
  That agreement is the whole point — two surfaces rendering one vocabulary two
  ways is the class — and it is pinned as a leg rather than asserted.
- **The reachability set is DERIVED from all four tables**, and that is the rule
  that was measured rather than assumed: the first cut's hand-written character
  class held the "interesting" leads (backslash, brace, tilde, quote) and bailed
  on `15--20`, so the en dash was never folded with every other leg green. The
  LITERAL rung has no interesting lead at all.
- **No vocabulary is invented.** `\emph{x}` displays as `\emph{x}` and a BibTeX
  grouping brace survives (`L{ó}pez`), because going further needs two SSOTs this
  codebase does not have — which commands are formatting wrappers whose argument
  should survive, and what a bare `{…}` means in each medium (task 349 M6 decided
  a `.tex` group's braces are CARRIED; BibTeX says a field's braces are pure
  grouping and never print). Hand-listing either inside a display helper is the
  drift every census here exists to prevent. Recorded as a residual, with the
  question routed to Gabriel rather than answered alone.
- **A projection is a VIEW.** The stored `command` attr and the `.bib` bytes are
  untouched, pinned over two full save cycles — this fix must not become the
  one-directional rewrite the whole vocabulary exists to prevent.

Same pass drained the two remaining **twin forks** across the inline parsers
(341's rule), because the display door would otherwise have been a THIRD copy of
each: the `\ldots|\dots|\LaTeX|\TeX` alternation, hand-written in both and
whose ellipsis half was a second spelling of `LITERAL_TABLE`'s own `latexForms`
(now `matchTextMacroAt`, with the ellipsis entries DERIVED from that table); and
the `` `` ``/`''` quote-pair test, hand-written in both with the serialize half
spelled a fourth time inside `smartenStraightQuotes` (now `QUOTE_PAIR_TABLE` +
`matchQuotePairAt` + a derived `QUOTE_PAIR_LEADS`, read by all four). Both
conversions are byte-identical, which is exactly why they were worth doing before
the next vocabulary change landed in one half only.

CI: [citation-display-projection.test.ts](../../../src/lib/__tests__/citation-display-projection.test.ts).
The leg with teeth is the CENSUS — the door was never the part that could
misbehave, a formatter that interpolates without asking it is, and that
type-checks perfectly. Membership is DISCOVERED (`export function format*` in
BOTH bib-parsers, since `library/lib/bib-parser.ts` is a whole-file copy and a
projection landed on one side only is a Library app that still shows
`\textasciitilde{}`), each member must call the door inside its own declaration
region, and the one exemption — `formatBibliography`, which returns citation-js
HTML behind its own sanitizer — is keyed by NAME with its reason. Measured by
neutering each half in turn: stubbing the door takes 11 legs, reverting the ONE
call site 5 (the census among them), and re-forking either parser vocabulary 1.

**Residual, CLOSED by task 409** — the bib ROW surfaces; see "The row half"
immediately below. One unrelated asymmetry found in passing was routed to the
catcher with the brace question:
`serializeCiteCommand` reads pre/post from `entries[]` while `parseNatbibCommand`
deliberately stores them top-level, so the round trip through those two functions
drops a natbib annotation (no shipped path is known to reach it — the atom keeps
its raw bytes — but the shape is how a silent drop ships).

##### The row half: a census discovers by MECHANISM, so the surface that reads the FIELD is invisible to it

Same door, the surface family it could not see (task 409) — and the case where
the projection was right, its census was right, and the census's POPULATION was
derived from the one mechanism the offending surfaces do not use.

368's census discovers its members from the bib-parsers' `format*` EXPORTS.
That is the correct population for a formatter and structurally blind to a
COMPONENT that reads `entry.fields.title` into JSX itself — which is the whole
bib ROW family: the Library list row (the most-viewed bib surface in the app),
the entry picker, the two bib cards, the Citations per-key rows, the paper
detail header. Every one of them printed `L{\'o}pez` and `\&` verbatim beside
body text that rendered the same bytes correctly. The sharpest single piece of
evidence: ONE picker row already projected its AUTHOR
(`formatAuthorsTruncated` has projected since 368) beside a RAW title.

> **A raw `.bib` field reaching a reader goes through ONE per-field accessor —
> [`bibFieldDisplay(entry, name)`](../../../src/lib/bib-parser.ts) — and the census that
> polices it asks the QUESTION (who reads a field?) rather than the MECHANISM
> (who exports a formatter?).**

Seven rules it earned:

- **Per-FIELD, never a record.** A `bibEntryDisplayFields(entry) → Record<…>`
  over a hand-listed 17-field set is a new SSOT-of-field-names — the drift this
  file legislates against everywhere — and it allocates a whole record for a
  caller that wants one. Every field is projectable (the door cheap-bails on
  ASCII), so the field name is the caller's own.
- **Presence is PRESERVED**, and that is load-bearing rather than tidy. The
  accessor answers `undefined` iff the field is ABSENT, so every converted site
  keeps its `?? catalogValue` chain byte-for-byte; a door that coalesced absent
  and empty to `""` would let an empty bib title shadow a real catalog title.
- **The name logic runs on PROJECTED text.** Five surname formatters split on
  `" and "` and a comma, and the projection can neither create nor destroy
  either — so the field is projected at the READ and the helpers are untouched.
  That is what keeps the projection ONE accessor instead of a call at fifteen
  JSX sites, which is the shape that goes raw again with the sixteenth.
- **The write-back hazard is REFUTED, and checking it is what made the fix
  cheap.** Not one input in either silo is seeded from a rendered string —
  every editor seeds from `entry.fields` — so a projection at the JSX sites
  cannot round-trip into the `.bib`. Pinned as a leg (the field editor's input
  values must hold the BYTES), because it is the premise the whole fix rests on.
- **A projected header above a RAW source pod, in one card, is CORRECT**
  (Gabriel, decision 2): a rendered view above its source, the same
  relationship the editor has to the code pane. `BibEntryCard`'s "BibTeX
  Fields" pod, `BibCard`'s `ExpandedFields` grid and the whole of
  `BibEditModal` stay raw and say why at the site. Projecting the third is the
  one change in this family that WOULD write a rendering into the file.
- **The SORT keys project too** (decision 3), and the case took measurement to
  state honestly: `L{\'o}pez` does NOT sort wrong — ICU treats the interior
  braces as punctuation and collates it under "l" either way. What moves is a
  field whose FIRST character is the escape, since ICU's default collation is
  `alternate: non-ignorable`: a leading `\` or `{` sorts before every letter
  and files the entry at the TOP of the list. `\'Alvarez` is the ordinary shape
  of that. `BibliographyPanel`'s list and its cited-EXPORT share ONE comparator
  (two is how the exported byte order drifts from what the user was looking
  at), and the accepted cost is stated: the first `cited.bib` export after this
  is a one-time deterministic re-ordering — a diff, not a loss.
- **The exemptions are in-place MARKERS, not a table.** `bib-display-exempt:`
  (governing its line and the next 12) and `bib-display-exempt-file:`, each
  stating one of three declared reasons — and the third is the one the obvious
  display/edit split misses: a NON-DISPLAY read reaches no reader at all (field
  equality, a numeric-sort `parseInt`, a synthetic catalog record, a BibTeX
  block emitted into an AI-request note, the fuzzy-search haystack). A naive
  `.fields.<name>` regex fires on all of them.

The census's own population is the finding one level up: it found
`library/components/PaperHeader.tsx` — the paper detail header, absent from the
task's hand-built census, and the one production caller of the leaf-pure
`BibEntryChrome` whose raw read was always one level up in it. Two of the
task's census entries were WRONG and are recorded as such rather than "fixed":
`bib-entry-chrome.tsx` never touches `entry.fields` at all, and `BibEditModal`
is the edit surface. The dead `formatMediumCitationParts` (a 3-field record
helper with test-only callers, in BOTH silos) was DELETED rather than converted
— a suite is not a consumer.

CI: [bib-row-display-projection.test.tsx](../../../src/lib/__tests__/bib-row-display-projection.test.tsx)
(the accessor's contract, the two DECIDED behaviours a later reader would file
as bugs — the grouping braces survive, absence is `undefined` — the sort, and
the CENSUS) and [bib-row-raw-vs-projected.test.tsx](../../../src/components/__tests__/bib-row-raw-vs-projected.test.tsx),
which drives the REAL `BibEntryCard` and asserts BOTH directions in one card:
the header projects, the fields pod does not, and the editor seeds from bytes.
The 368 census's discovery widened to cover the new accessor, so it is
auto-enforced there too. Measured by neutering the card's three field reads:
2 behavioural legs and the census fail; the raw-pod legs stay green, which is
exactly the pre-409 tree.

**Residuals, stated.** The projection is PARTIAL by decision: BibTeX's grouping
braces survive (`L{ó}pez`), because a full BibTeX-semantics projection needs a
vocabulary this codebase has no SSOT for and hand-listing one is the drift
every census here exists to prevent. The fuzzy-search HAYSTACK
(`catalog-search.ts`, `bib-searcher.ts`'s Fuse keys) is deliberately unprojected
— whether typing "López" should match `L{\'o}pez`, and whether typing `\'o`
should stop matching, is a decision about MATCHING semantics rather than about
what a reader sees. And the Library list's sort keys are projected for the same
reason the Bibliography panel's are, but feed no export, so they carry no
one-time diff.

**Owed, not claimed:** the preview eyeball. NOT FSA-masked — open the Library
list with an accented-surname entry.

##### The passage half: a CAPTURE that flattens is a loss no RENDERER can undo

Same door, the QUOTE a card keeps of the paper (task 488) — and the case where
the fix has to be in two places because the phenomenon is in two places.

Gabriel, from a real paper: *"when you make an AI request for revision, the
original is rendered as plain text without formatting — should be more like an
archive card."* The "Original" a revision / cutter card shows had FOUR
renderers and THREE answers: `useExcerptCue` and the read-only `original_text`
field painted the raw STRING in a `whitespace-pre-wrap` block (so a
skill-authored original — real `.tex` — showed `\emph{...}` / `$x$` /
`\cite{k}` as SOURCE), the two pending-change foldouts each HAND-SPELLED
`richLatexToJson(...)` → `BorrowedMainText`, and the collapsed cues showed
`text.replace(/\s+/g, " ")`.

**And the render fork was only half of it.** A Mode-B anchor's capture is
`doc.textBetween(from, to, " ")`, which drops every MARK and — because
ProseMirror's default `leafText` is empty — every inline ATOM outright: a
citation, a `$x$` or a `\ref` inside the selection contributes NOTHING to that
string. So for the case Gabriel actually reported the formatting was gone
BEFORE any surface saw it, and a render-time parse recovers exactly nothing.
The catcher's recommended surgical fix (project at display time) would have
fixed the skill-authored originals and left the reported one flattened.

> **A captured passage has ONE door
> ([captured-passage.tsx](../../../src/panels/_shared/captured-passage.tsx)) with a
> two-rung ladder — the RICH capture taken at anchor time, else the BYTES
> parsed at display time — and it is rendered as borrowed main text on every
> surface, because a captured passage IS main text.** The string stays the
> currency: the apply path splices `user_text || suggested_text` as BYTES, the
> copy button copies bytes, and nothing the door produces is written back.

Seven rules it earned:

- **The capture is a SECOND field, not a change to the first.** `anchorText` is
  the RELOCATION currency — the `textSnapshot` a Mode-B anchor is re-found by
  on reload (`reapply-mode-b-anchors`) — so it must stay plain doc text.
  Re-spelling it as `.tex` bytes would have unified the currency and broken
  anchor recovery, which is why `LinkedAnchorRecord.content` /
  `AnchorRef.anchorContent` / `card.selectedContent` sit BESIDE the string
  rather than replacing it. Optional at every rung, so there is no migration:
  every pre-488 card takes the parse rung.
- **The display capture does NOT enter `prepareCardBodyCapture`, and the reason
  is the import graph as much as the semantics.** That door exists to prove a
  DESTRUCTIVE capture's destination can hold the payload; nothing is deleted
  here, and a passage the render surface cannot represent already falls back to
  plain text through `StaticBorrowedText`'s own refusal contract. Asking it
  would also drag the resolved card-body schema — and so the whole extension
  stack — into `links.ts`, a module every card surface pulls in (measured: it
  broke eleven suites with `Cannot find module '@/lib/storage-fsa'`). So the
  slice→JSON conversion moved to a LEAF
  ([slice-capture.ts](../../../src/lib/tiptap/slice-capture.ts)) that both doors read,
  which is what keeps the payload the destructive door VALIDATES byte-identical
  to the one the display capture takes.
- **STATIC, not `BorrowedMainText`.** Nothing here is editable, so an editor
  buys nothing and costs a mount (the card-presence-tier doctrine). Converting
  the two pending-change foldouts onto the door RETIRES two live editors as
  well as unifying the answer — `BorrowedMainText` stays right for a card's OWN
  body (`ExampleCard`), which is the one scoped exemption on the census.
- **The one-line cue reads the SAME resolution.** A collapsed card projects the
  door's own JSON through `richJsonToPlainText`, so the cue and the expanded
  excerpt cannot disagree about what the passage says. `suggested_text`
  deliberately stays raw and says so at the site: it is EDITABLE currency the
  user is composing, and its cue must show the bytes they typed.
- **The door drops `color` from the panel body style.** `.rtf-content-footnote`
  sets a hard ink, so a passage that wrote its own colour would win over the red
  "Original" cue the field vocabulary assigns; the CSS rule hands the ink back
  (`color: inherit`) and drops the 2.5rem min-height and padding
  `.rtf-content` reserves for a caret. An excerpt is a QUOTE inside a card, not
  a body.
- **The parse is MEMOIZED on `(latex, content)`.** The rung mints a fresh object
  per call and `StaticBorrowedText` memoizes its HTML on `value` IDENTITY, so
  without it the passage re-parses and re-serializes on every render of the host
  card. O(passage), never O(doc), and off the keystroke path either way — but a
  card re-renders for plenty of reasons that have nothing to do with it.
- **The rich twin travels with the string it is the twin of.** The morphs carry
  it (a morph is not a re-capture), the sidecar migrate carries it through
  UNCHANGED with no snapshot fallback (the link's `textSnapshot` is the plain
  relocation string — synthesising a body from it would put a second, lossier
  answer where the parse rung already gives the right one), and `pull-seed`
  lists it as a per-doc BINDING beside `selectedText`.

CI: [captured-passage.test.tsx](../../../src/panels/_shared/__tests__/captured-passage.test.tsx)
drives the REAL `createLinkedAnchor` over a fixture carrying an inline ATOM
beside marked text — the atom is what makes the capture leg falsifiable, since
`textBetween` cannot represent it at all — plus the ladder, the REAL render
surface, and the CENSUS. The two rich-render legs live in the renegotiated
[RevisionRequestCard-excerpt.test.tsx](../../../src/panels/Revisions/__tests__/RevisionRequestCard-excerpt.test.tsx),
which stubs only `BorrowedMainText`, so the passage renders for real. **No
pre-488 suite could see any of this**: that suite asserted the excerpt string
was PRESENT (which the flat block satisfied perfectly) and every pending-change
suite `vi.mock`s the rendering surface away — what was never asked is whether
the passage arrives with its marks and atoms at all. The leg with teeth is the
CENSUS (no panel file parses a captured passage itself, renders one through a
live editor surface, or spells the borrowed static surface outside the door; the
capture is taken at the ONE anchor minter; the slice→JSON conversion has ONE
implementation). Measured by neutering each half in turn: dropping the capture
takes 2 legs, a ladder that ignores it 3, the pre-488 plain excerpt block 2, and
a re-forked parse in a panel 1.

**Owed, not claimed:** a real-FSA eyeball. Anchor capture is the FSA-masked
class, so the durable proof here is the unit contract — select a passage with
italics and a citation, make an AI revision request, and open the card.

#### The composition half: a CARRIER says how a run's bytes are made, not what wraps them

Same round trip, one question up (task 377) — and the case where the carrier
doctrine was right about the bytes it was defending and silently discarded their
CONTEXT.

A text run's marks answer two different questions. The three CARRIERS answer
*how are this run's own bytes produced?* — byte-literal (`latexVerbatim`),
raw-LaTeX-with-smart-quotes (`latexCommand`), not-typeset-at-all
(`latexCommentTail`). The WRAPPERS answer *what encloses it?* — `bold`,
`italic`, `underline`, `code`, `textColor`. `serializeMarks` decided the first
with three early `return`s sitting **above** its wrapper loop, so a run wearing
both kinds emitted only its carrier and **the wrapper was DELETED**. The parser
APPENDS a formatting mark onto whatever its recursion returned, so that
combination is not exotic; `\textsc` is unmodeled and is the standard small-caps
/ gloss-abbreviation command, which makes this ordinary linguistics and
philosophy prose. The card/footnote fork had the identical two returns above the
identical loop (341's twin rule). Five members, every one a FIXED POINT from
cycle 1, all landing on OPEN:

- **M1** `\textbf{\textsc{Smith}}` → `\textsc{Smith}`; `\textcolor[HTML]{…}{\textsc{x}}`
  → the colour gone; `\textbf{\verb|a|}` → the bold gone; and the RUN form
  `\emph{a \textsc{b} c}` → `\emph{a }\textsc{b}\emph{ c}`, one wrapper split
  into two with the middle piece bare.
- **M2** the same in the card/footnote fork.
- **M3** a mark around an inline ATOM: `\emph{\citep{x}}` → `\vcid{…}\citep{x}`,
  because the sequence walker emitted the atom and discarded its marks.
- **M4** `inCode` was not propagated: only the `\texttt` branch passed anything,
  so a command nested INSIDE a code span had its body typographied and a raw
  U+2013 / U+00E9 was written into the `.tex` — `\texttt{\textbf{x--y}}` came
  back `\texttt{\textbf{x–y}}`, where the source's two hyphens must PRINT as two
  hyphens. `\texttt{x--y}` (one level) was always right, which is why it read as
  latent. Both parsers had the gap.
- **M5** `\texttt{caf\'e}` → `\texttt{caf}\'\texttt{e}` — the split re-binds the
  accent, which now takes `\texttt` as its argument.

> **Two stages, stated once: PRODUCE the run's inner bytes (the carriers decide
> this), then WRAP them. And the unit of wrapping is the RUN — the maximal
> adjacent span sharing one wrapper signature — never the node.**

[src/lib/mark-composition.ts](../../../src/lib/mark-composition.ts) is the SSOT
(`WRAPPER_MARK_TYPES`, `markWrapSignature`, `applyWrapperMarks`,
`composeInlineRun`), an import-free leaf for the reason `latex-markers.ts` and
`node-attr-sets.ts` each earned. Five rules it earned:

- **The RUN, not the node, and M5 is the proof.** Per-node wrapping is correct
  about each node's own bytes and wrong about their neighbours: it splits one
  `\texttt{…}` into three, and a split landing between an argument-taking control
  symbol and its argument CHANGES WHAT THE COMMAND TAKES. A rule stated as "wrap
  each node" cannot express that; a rule stated as "wrap the run" fixes M1's
  split form and M5 with the same line.
- **`code` is a WRAPPER that is nonetheless read at stage 1**, and that is not an
  exception to the split — it is the one wrapper that changes how the inner bytes
  are PRODUCED (typography suppressed). Stated at the site so the next reader
  does not "tidy" it into stage 2.
- **What must sit OUTSIDE a wrapper breaks the run.** The `\vlid` / `\vlidend`
  anchor transitions are an `outerPrefix`, and a non-empty prefix flushes the
  group — so a marker can never land inside one set of braces, structurally
  rather than incidentally. The comment carrier is `standalone` for the stronger
  reason: it owns the rest of its LINE, so anything merged after it inside
  `\textbf{…}` — the closing brace included — would be commented out.
- **An ATOM's marks are the run's business.** The walker's non-text arm emits the
  node and the RUN wraps it, so `\emph{\vcid{…}\citep{x}}` round-trips. The atom
  keeps its marks in the parsed JSON already; nothing had to be re-derived.
- **`inCode` is INHERITED by every mark recursion**, in both parsers. The emit
  side always read the fact correctly; the two rungs simply read it at different
  depths, which is the whole of M4.

**Declared normalization:** two adjacent nodes the model happens to keep apart
with identical wrapper marks now merge (`\textbf{a}\textbf{b}` → `\textbf{ab}`).
One-time, idempotent, and it typesets identically — the same class of one-time
canonicalization the serializer already performs for author layout.

**Stated residual:** a NESTED formatting mark still splits its parent's run —
`\textbf{a \emph{x} b}` normalizes once to
`\textbf{a }\textbf{\emph{x}}\textbf{ b}`, because the two signatures differ.
Sharing a common wrapper SUFFIX would restore byte-identity there, and it is
deliberately not done here: the phenomenon this task closes is DELETION, the
split form loses nothing and is idempotent, and suffix-sharing turns a linear
fold into a hierarchical build over interleaved mark orders — more risk than the
verbosity is worth.

CI: [carrier-mark-composition.test.ts](../../../src/lib/__tests__/carrier-mark-composition.test.ts).
Every leg drives the REAL save pipeline over TWO cycles and over BOTH surfaces
(main body, the fork's own doors, and a real `\footnote{}` body in a real
document), with `\textbf{plain bold}` / `\textbf{\emph{both}}` / `\texttt{x--y}`
as CONTROLS through the identical harness — the defect needs a CARRIER or an
ATOM as the child, so a suite whose fixtures are plain prose cannot represent it,
which is exactly why every pre-377 round-trip suite was green. **No gate could
see any of it**: `\textbf` is not a content word, `x--y` and `x–y` both tokenize
to `{x, y}` under `WORD_RE`, and the accent case is a 1-token shortfall under the
4-word floor. The leg with teeth is the CENSUS — the composition was never the
part that could misbehave, a THIRD file spelling the five commands is, and that
is literally what shipped: no production file outside the SSOT may emit a wrapper
command, both inline serializers must enter `composeInlineRun`, and the needles
are DERIVED from `WRAPPER_MARK_TYPES` so a sixth wrapper joins by declaring
itself. Measured by neutering each half in turn: the pre-377 carrier return takes
14 legs, the discarded atom marks 5, the main parser's `inCode` 3, the fork's 1,
and a third speller 1.

#### The splitter half: a comment is inert to EVERY scan on the surface, or to none

Same round trip, and the case where the rule had been written down, shared, and
adopted by every scanner on the surface EXCEPT the three that decide where a
construct's parts begin (task 378). `scanLive`, `findPreambleTitleFields` (356),
`scanFigureBody` and `readParagraph`'s block-boundary test had all been taught
that a line-leading `%` is inert. The **body splitters** had not — so a construct
the author had deliberately commented OUT was PROMOTED into the printed document.
Six members, every one a FIXED POINT (no later save healed it), all landing on
OPEN via `readDocBundle`'s unconditional load-writeback:

- **M1 `splitListItems`.** `% \item Draft alternative.` became a **live, printed
  bullet**, with the orphaned `%` stranded alone on its own line.
- **M2 `splitPexBody`.** `% \a Draft alternative.` became a live example part —
  and expex computes each part's printed label from POSITION, so a phantom part
  **renumbers every part after it** and every `\ref` that names one.
- **M3 the gloss `tierPattern`**, a bare `/g` regex over the raw body: a
  `% \glb old //` minted a spurious live tier AND the orphaned `%` was tokenized
  into the row above as extra `glossCell`s, silently changing the column
  alignment the tier notation exists to express. Not even a fixed point.
- **M4 the same builder DELETED everything before its first tier marker.**
  Segments are built marker-to-marker, so `[0, markers[0].start)` was read by
  nothing and the node carried no field for it: a `% Mandarin, adapted from Li
  (2005)` note — or a `\setlength` tuning line — was simply GONE on the first
  save. The asymmetry that makes it unarguable: the same comment SURVIVES one
  line above the gloss, where `parseExampleBodyAsBlocks` explicitly carries it.
- **M4b …and a gloss body with CONTENT but NO tier marker was destroyed
  outright** — `\begingl\nsome text\n\endgl` → `\begingl\n\gla  //\n\endgl`.
  The `splitListItems` shape task 356 closed for lists, still live here, on
  WELL-FORMED input.
- **M5 `splitLinguexBody` was correct only BY ACCIDENT** (the `%` itself cleared
  its `lineStart` flag) — and its SERIALIZER twin then emitted a blank line after
  a carried comment, which in linguex is the example's **TERMINATOR**: on the
  next save every part after the comment fell OUT of the example, `\vxid`
  identity and all.

**No gate could see any of it.** M1–M3 MOVE words rather than losing them, so the
write gate's multiset measure scores a shortfall of ZERO; M4 costs four word
tokens in this fixture and fewer in the common shorter forms, at or under
`PRESERVATION_SLACK_WORDS = 4`.

> **A line-leading `%` is inert to every scan that walks raw bytes, read through
> ONE primitive — [`skipLineCommentAt`](../../../src/lib/latex-lexer.ts). A REGEX scan,
> which cannot use a byte walk, gets the projection instead: SCAN PROJECTED,
> SLICE RAW. And a segment that is TOKENIZED rather than carried must hold no
> inert bytes at all — a construct whose body carries some is REFUSED whole.**

Six rules it earned:

- **The primitive is the NARROW rule, deliberately.** `startsLineComment`, not
  TeX's own any-unescaped-`%`, for the reason task 338 records: a terminator scan
  reading the wider rule calls a LIVE `\end{env}` inert and swallows the rest of
  the document. The mid-line `%` therefore stays exactly as task 347 left it, and
  the suite pins that so a later widening is a decision rather than a slip.
- **The failure direction is what makes the narrow rule safe here.** A splitter
  that skips a line it should not have skipped keeps those bytes inside the slice
  it is currently building — nothing is dropped, only unsplit — while one that
  fails to skip PROMOTES a comment into live output. Only one of those costs the
  user's document.
- **Declining to mint the tier was only half of M3.** A tier's segment is
  tokenized into CELLS, so inert bytes left inside one come back as columns. A
  row node has no slot for what it does not model, and inventing one per row
  would be guessing which tier a free-standing comment belongs to — so the gloss
  REFUSES (task 356's rule) when the projection diverges from the raw body at or
  after the first marker. One test covers a comment, a `\verb` run and a
  verbatim body instead of three.
- **A refusal is carried BYTE-LITERALLY, not through the prose fall-through.**
  `\endgl` is a block boundary, so `readParagraph` ends the paragraph before it
  and the two are rejoined with a BLANK LINE — a `\par` inside a construct we
  have just declined to model. The carrier also re-absorbs its own trailing
  `%!v:` anchor, exactly as the `\begin{env}` carrier does, or the anchor is
  re-read as a standalone empty block: one stray line per save, unbounded.
- **The pre-marker region is the one place that DOES have a slot**, so M4 keeps
  the model rather than refusing: `glossPreamble` on `exampleGloss`, raw and
  opaque, the `listPreamble` / `rawOptions` shape one construct over, with
  `keepOnSplit: false` for `itemLabel`'s reason.
- **The join owns the separator, so no assembly piece may end with a newline of
  its own.** The comment carrier's serializer appends one (task 347's "a comment
  owns its line"), and both example assemblies joined pieces with another. For
  expex that is a `\par` in a construct that does not take one; for linguex it is
  the terminator, which is where it was measured.

CI: [comment-blind-splitters.test.ts](../../../src/lib/__tests__/comment-blind-splitters.test.ts).
Every list / example / gloss fixture in the repo is spelled the one way the code
happens to handle — with no comment in it — so each member is **unrepresentable**
in all of them, which is how they shipped green. Each leg drives the REAL save
pipeline over TWO cycles (cycle 1 is where the loss happens; cycle 2 proves
nothing accumulates) with the same fixture minus its `%` as a CONTROL through the
identical harness, so no leg can pass by making everything inert. The leg with
teeth is the CENSUS, and its membership is DISCOVERED rather than listed: the
population is every byte-walking scan that steps over an opaque construct,
because a scan that has to know a `\verb` run is not its business has to know a
comment is not either. Measured by neutering each half in turn: M1 takes 2 legs,
M2 2, the projected tier scan 2, the gloss preamble 2, the no-marker refusal 1,
the assembly join 1 — and removing the linguex comment skip fails ONLY the
census, which is precisely the "correct by accident" claim, stated.

**Residual, stated.** Non-comment unmodeled bytes AFTER the last tier's `//` are
still tokenized into that tier's cells; only the pre-marker region has a carrier.
Pre-existing and independent of comments (which the divergence test now refuses),
so it is recorded rather than fixed under an unmeasured guess.

#### The direction half: a table that CONVERTS must be able to convert back

Same round trip, and the case where the SSOT was one table, correct in one
direction, and read by nobody who could tell (task 380). `TEXT_MACRO_TABLE` maps
a backslash-led macro whose whole output is literal text onto that text. Two of
its four members had **no reverse direction at all**, and the two halves of the
defect were mirror images of each other — one lossy on PARSE, one lossy on EMIT:

- **M1 `\LaTeX` / `\LaTeX{}` / `\TeX` were DELETED from the user's only copy on
  OPEN**, with no edit — `Written in \LaTeX{} by hand.` came back
  `Written in LaTeX{} by hand.`, a fixed point from cycle 1, on both inline
  surfaces and inside headings. In the PDF `\LaTeX` typesets the stylized logo
  and the plain word does not, so the paper's rendering changed and the command
  was unrecoverable — the user could not even type it back, because task 360's
  type-time carrier marks a typed `\LaTeX` and the next parse converted it to
  text again. The `{}` left behind became a stray empty group.
- **M2 is the mirror image: the emit was the lossy direction.** The glyph → LaTeX
  map wrote `\ldots` with **no `{}` token break**, and TeX gobbles every space
  after a control word — so `So on… and so forth.` printed "So on…and so forth.",
  a space the user typed deleted IN THE PDF ONLY, for every ellipsis followed by
  a word. The `.tex` round trip was perfectly stable, so nothing downstream
  noticed.

- **M3 was found by probing the fix and is the same fork one member over.** A
  text macro inside a `\texttt{}` CODE SPAN was converted on the parse rung
  while the EMIT rung suppresses typography under a `code` wrapper — so
  `\texttt{a\ldots b}` came back `\texttt{a… b}`, a raw U+2026 written into the
  `.tex` on the first save. Task 377 M4 closed exactly this asymmetry for `--`
  and the accents and left the text macro out; the branch is `inCode`-gated now,
  in BOTH parsers, and the macro takes the raw-LaTeX carrier there like every
  other command.

**No gate could see any of it**: the `\LaTeX`→`LaTeX` conversion changes zero
word tokens under `WORD_RE = [A-Za-z0-9]+`, and M2 and M3 change no words at all.

> **A macro may join the PARSERS' vocabulary only if it stands for a GLYPH the
> document model holds — because that glyph is the only thing the serialize rung
> can restore it from.** A macro whose output is a typeset LOGO has no such
> character, so it is not a text macro: it is an ordinary unmodelled
> zero-argument command and belongs to the raw-LaTeX carrier, like every other
> one. And the mirror: **a glyph that leaves as LaTeX must leave as LaTeX that
> MEANS THE SAME THING**, which for a control word includes not eating what
> follows it.

Five rules it earned:

- **The parse table is DERIVED WHOLE from `LITERAL_TABLE`**, so "what the parser
  converts, the serializer restores" is structural rather than a property of who
  remembered to write a reverse map. Nothing may be stated in it; a new
  command-shaped literal joins by declaring itself where its glyph lives.
- **A reverse map was the wrong fix, and rejecting it is the interesting half.**
  `LaTeX` → `\LaTeX` would rewrite every literal occurrence of the word the user
  typed as PROSE into a command — worse than the bug. When a one-directional
  table cannot be made bidirectional, the answer is to stop converting, not to
  guess an inverse.
- **A DISPLAY projection may read the wider vocabulary, because a view never
  writes back** (task 368's rule, from the other side). So the logos live in a
  display-only table and `matchDisplayMacroAt` is module-PRIVATE: a name that can
  travel is a name a document writer can reach, and the destruction comes back.
- **The token break is DERIVED from the token CLASS, not declared per member.**
  `{}` iff the canonical form is a CONTROL WORD — a backslash plus a letter run,
  exactly the class TeX gobbles after — so a character run (`--`, `---`), where
  `{}` would print as a stray group, cannot pick one up, and a control symbol
  (which terminates itself) cannot either.
- **An emit-side token break is only safe if the PARSE side consumes it.**
  Without that, `\ldots{}` reads back as the glyph plus a raw-carried empty group
  (task 349 M6's bare-group carrier) and re-emits as `\ldots{}{}` — two more
  bytes on every save, forever. A SECOND group is content and is left alone.

**Declared normalizations, both one-time and idempotent:** a bare `\ldots` gains
its `{}` on the first save, and the accepted alias `\dots` settles on the
canonical `\ldots{}`. The second is PRE-EXISTING and worth stating precisely,
because the task text asserted the opposite — measured on the pre-380 tree,
`\dots` already normalized to `\ldots`. The glyph is what the model holds, so the
alias has nowhere to live and `latexForms[0]` is what "canonical" means.

CI: [text-macro-round-trip.test.ts](../../../src/lib/__tests__/text-macro-round-trip.test.ts).
Every leg runs TWO cycles over BOTH inline surfaces and inside a heading, swept
FROM the tables so a new member is covered by declaration alone, with live
CONTROLS through the identical harness (the word "LaTeX" typed as prose, and a
character-run literal). **No pre-380 suite could see this**: every round-trip
fixture in the repo spells its typography the one way the code happens to handle,
and the two legs that named the macros at all pinned the CONVERSION as intended
behaviour — the defect asserted as the contract, renegotiated in place here. The
leg with teeth is the CENSUS: the door was never the part that could misbehave, a
writer that spells a logo macro itself or reaches the wider vocabulary is, and
neither is visible to any behavioural test of the shared door. Measured by
neutering each half in turn: restoring the logos to the parse vocabulary takes 6
legs, dropping the emit token break 5, dropping the parse-side consumption 7,
hand-writing one member into the derived table 6, and dropping the `inCode` gate
2 (1 per parser — the twin rule, measured per fork).

**Residual, stated.** A `latexCommand`-carried run is projected for a READER by
`latexToDisplayText` (the citation and bibliography surfaces) but not by
`richJsonToPlainText`, so a card preview / drag ghost / search projection of a
body holding `\LaTeX` now shows the command rather than the word — exactly as it
already does for `\emph{x}` and every other carried command. Routing that
projection through the display door is task 368's law applied to a second
surface, with its own census, and is out of scope here.

#### The carrier half, declared: a node whose model IS its bytes says so

Same round trip, and the case where the rule was right and the mechanism that
enforced it had to RECOGNIZE its own output after the fact (task 383).

`collapseBlankRuns` is the one pass entitled to tidy generated `.tex`, and it
must never touch bytes the serializer CARRIED. It decided which was which by
matching `\begin{env}…\end{env}` out of the finished string — a heuristic
recovery of information the emitter had and threw away, and it can only see two
things: an environment, and one whose opener arguments close on the opener's own
line. Two shipped nodes carry bytes it can see neither way. `texBlock`'s body
sits between `%!vtex:` sentinels, so a 3+ newline run inside it lost a blank line
on the FIRST save — silently, idempotently, in the node whose whole contract is
passthrough. `forestBlock`'s `source` may open `\begin{forest}[Root` across a
line break, which defeats the argument matcher and the tail alike.

> **A node whose model IS its bytes KNOWS they are carried, so it SAYS so.**
> `carriedSource(bytes)` wraps an emitted verbatim span in a sentinel pair that
> `collapseBlankRuns` stashes before it collapses anything and strips on the way
> out. For attr-carried source the property is then structural; the recognizer
> survives only for the generic env CARRIER, whose bytes no emitter declares.

Three rules it earned:

- **Declared spans are stashed BEFORE recognized ones.** A `\begin{…}` inside
  carried source is then already a placeholder, so it cannot confuse the
  recognizer — which is a second, free correctness win over the pre-383 order.
- **The sentinels never escape, and that is stated rather than hoped.** Every
  path that emits them ends at `collapseBlankRuns` (`assembleLatex` for the
  per-block pipeline, `serializeToLatex`/`serializeBodyOnly` for the whole-doc
  walk); `serializeParagraphInline` is the one export that skips the collapse
  and it serializes a PARAGRAPH, where no block atom can appear. The restore
  also strips an unpaired sentinel defensively.
- **`forestBlock` is the model this makes cheap.** Task 383 claims
  `\begin{forest}…\end{forest}` whole — `source` holds the entire environment
  verbatim, the serializer emits it plus `uuidAnchorSuffix(uuid)`, and the
  renderer (task 384) is a pure derivation that cannot subtract from it. So the
  342/356 refuse-whole law is satisfied trivially: there is no structured tree at
  the document layer to lose anything from. Its one parser subtlety is that a
  forest's leading `[` is the TREE, not an option — the dispatcher's bracket
  scanner is skipped for that env, or on a body whose brackets do not balance
  the terminator search starts past the real `\end{forest}` and two trees fold
  into one.

The pod both wearers render through is shared too — `SourcePodNodeView`
in place, `source-pod-body` popped out, `.source-pod*` in CSS with only the HOST
class naming a node (`STYLE_GUIDE.md` → "Source pods"). CI:
[forest-block-roundtrip.test.ts](../../../src/lib/__tests__/forest-block-roundtrip.test.ts)
drives the REAL save pipeline over TWO cycles per shape, with the generic
carrier and an UNTERMINATED opener as controls; measured by neutering each half
in turn, the parser claim takes 13 legs, the declared carry 2 (one of them the
shipped texBlock defect) and the bracket-scanner guard 1.

#### The view half: a derived VIEW may refuse freely, and must do so LOUDLY

Same node, the other direction (task 384) — and the case where the vocabulary
laws above (342/355/356: *model a subset, refuse WHOLE outside it, never guess*)
apply to something that is not a parse at all.

`forestBlock`'s model is its bytes, so a RENDERER over those bytes cannot lose
anything: a refusal costs the user a picture, never a byte. That asymmetry is
the whole design, and it inverts the usual cost of refusing. Where a parser's
refusal means carried source in place of a modelled node — a real loss of
affordance — a view's refusal means a badge instead of a drawing, over an
untouched document. So the subset can be small and honest rather than wide and
hopeful.

> **A VIEW derived from bytes renders exactly what it understands and BADGES
> everything else — LOUDLY, VISIBLY, ATTACHED to the object, and NAMING the
> construct it refused.** A drawing produced by ignoring a layout option the
> author wrote is a MISRENDER wearing a feature's clothes: it is well-formed,
> plausible, and the user has no way to detect it. A badge naming `for tree` is
> a limitation they can see, work around and file.

Seven rules it earned:

- **Render and refusal come from ONE parse.** They are two halves of a single
  verdict, and a surface that asked twice could paint a badge over a tree.
  `deriveForestPod` answers both, and both pod surfaces read it — the same
  "one implementation, per surface" rule the pod chrome itself follows, for the
  same reason: a float that badged differently from the docked block would make
  a lift change the diagnosis. The SEAM is generic and the BADGE is not, which
  is the line "deep ≠ broadest blast radius" draws: `SourcePodConfig.derive`
  returns `{ preview, banner }` and the pod styles neither, so the next kind
  whose bytes can be drawn inherits the chrome, the toggle, the print rules and
  the memo — while `.forest-refusal-badge` stays named after its one wearer
  until there is a second.
- **The refusal is SPECIFIC or it is nothing.** A closed `ForestRefusalKind`
  union, one sentence per kind composed in ONE function (`describeForestRefusal`)
  that the badge and the suite both read, and a byte offset. The suite has a leg
  PER unsupported construct class asserting the kind AND the echoed token,
  because a refusal that fires for the wrong reason is a wrong message — it
  sends the user to change a byte that was never the problem — and every such
  leg would pass on a parser that refused everything.
- **It is a WARNING, not an alarm** (STYLE_GUIDE → "RED means an action would
  destroy content WITHOUT a net"). Amber, over intact bytes, with the source
  right under it.
- **Nothing derived is persisted.** No `renderable` attr, no sidecar note, no
  cached parse — which is what makes growing the whitelist additive with no
  migration: each new key moves inputs from the badge to the render.
  [forest-render-derived.test.ts](../../../src/lib/__tests__/forest-render-derived.test.ts)
  drives two save cycles over accepted and refused sources and asserts the two
  are indistinguishable downstream, with the node's attr key set asserted as a
  CLOSED set rather than as "does not contain X" — a future "just cache it on
  the node" must be a failing test, not a name someone forgot to add to a
  denylist.
- **The geometry is PURE and its invariants are swept, not pinned.**
  [layout.ts](../../../src/lib/forest/layout.ts) is a contour-based tidy tree (variable
  widths; a sibling is pushed right by exactly what clears every shared depth),
  DOM-free for the reason the marginalia grid packer is: a pinned pixel is a fact
  about the last commit, where "no two labels overlap", "a parent is centered
  over its children's span" and "a roof spans the box it claims" are true of
  every tree or of none. Measured by neutering the contour to depth 0 — three
  overlap legs fail.
- **`roof` resolves to ONE box, and which box is not obvious.** A roofed
  INTERNAL node keeps its label and gains a synthesized child holding its
  descendants' leaf text under the triangle (forest's own semantics — the
  internals genuinely disappear); a roofed LEAF wears the triangle itself, the
  `[{the dog},roof]` idiom. A roof INSIDE a roofed subtree is refused rather than
  silently swallowed: two interacting triangles are exactly the guess this
  grammar exists not to make.
- **It reads TeX's OWN comment rule, and that is the one place this grammar
  deliberately parts from the parser.** Every byte-walking scan in the parser
  reads the NARROW line-leading `startsLineComment`, because a construct-
  TERMINATOR scan that believes a mid-line `%` calls a live `\end{env}` inert
  and swallows the rest of the document (task 338). Nothing here terminates a
  construct — the source is already claimed and its ends are fixed — and the
  narrow rule would MISRENDER: `[S %draft` is a node labelled "S" in forest and
  would have rendered as one labelled "S %draft", which is precisely the
  silently-wrong picture the whole design refuses. Where a mid-line comment does
  eat a delimiter, the refusal that follows is the one forest's own compiler
  gives.
- **A view that parses whatever is PASTED into it states its bounds — on EVERY
  recursive axis, not the obvious one.** The scanner, the roof flattening and
  the layout's three walks all recurse, so a pasted `[`×10 000 would not refuse:
  it would throw a `RangeError` out of a React render, and this app has no error
  boundary anywhere. `MAX_FOREST_DEPTH` (64) and `MAX_FOREST_NODES` (512) are
  refusals instead, far past any real syntax tree and far short of anything that
  hurts. The half worth remembering is that the first cut bounded only the axis
  it was thinking about: a LABEL's `{}` nesting is its own recursion, and a
  single node with a deeply braced label costs depth 0 and one node, so neither
  cap could see it — measured, a balanced 10 000-level group overflows the stack
  and a 4 000-level one costs 50 ms of superlinear re-scanning synchronously in
  render. A bound whose failure mode is a badge is a bound worth having; one
  whose failure mode is a crash is a latent trap, and "I bounded the recursion"
  is a claim per axis.
- **A comment rule adopted for a scan is adopted for every scan that scan
  DEPENDS on.** Reading TeX's rule in `skipInert` / `scanLabel` / `scanOptions`
  and then resolving a label's `{…}` group with the shared, comment-BLIND
  `findMatchingBrace` fails in both directions at once: a `}` inside a `% …`
  line closes the group early and the real `}` falls through as ink (a
  well-formed tree carrying a brace forest never prints — the silently-wrong
  picture again), while a `{` inside a comment produces a spurious `unbalanced`
  refusal on source TeX reads as balanced. The same shape one field over: the
  option scan STEPPED OVER comments to find its terminator and then sliced its
  token RAW from that span, so `[NP,roof % triangle]` refused with "node option
  `roof % triangle`" — an option the user never wrote, with `roof` visible
  inside the thing it called unsupported. Both were found by the adversarial
  pass, both are the module contradicting its own stated subset, and both are
  now assembled from the LIVE spans.
- **…and a primitive that publishes HALF an operation is how the fourth scanner
  gets it wrong** (task 406, the residual of the residual). `matchCommentTailAt`
  answers a REPRESENTATION question — *which bytes are the comment* — and stops
  short of the newline; every caller assembling TEXT also needs the READING
  answer — *where does TeX RESUME*, past the newline TeX discards and past the
  continuation line's leading indent (state N). That second half was re-derived
  per scanner, correctly in `scanLabel` and nowhere else, so `scanOptions`
  spliced the continuation's bytes into its token and refused LOUDLY with
  `node option \`ro\nof\`` on `[NP,ro%\nof]` — a user breaking forest's only
  legal option across a `%` continuation, which TeX reads as `roof`. It ships as
  a documented PAIR now (`skipCommentContinuationAt`, immediately below its
  sibling), because a caller genuinely has to CHOOSE — and the half that proves
  it is the NEGATIVE one, stated at both ends: the byte carrier in
  `parseInlineContent` must NOT call the door, since the newline is the USER's
  byte and is carried into the `latexCommentTail` node. **A cleanup that made
  the two "consistent" would silently eat a line break out of the source on
  every save.** Task 273's rule ("publish whole OPERATIONS, never the pieces")
  in its mildest form — and note the census here was worth almost nothing: five
  of six callers were already right, two of them *precisely because* they do not
  skip. The value was the door and the two sentences beside it, not the sweep.
- **A view measured with NO BOX must be told when it gets one.** A `forestBlock`
  inside a folded section stays MOUNTED — `.section-folded` is a node
  DECORATION, not an unmount — so its first layout runs with every rect at 0×0
  and is placed from canvas estimates, and NOTHING in the effect's dependency
  list changes when the section is unfolded. Fold state is persisted per doc and
  restored on open, so that is an ordinary starting condition rather than a
  race, and the failure is permanent and silent: edges converging beside their
  labels, a roof spanning the wrong width. Un-hiding is not an event a component
  can see, so the 0 → non-zero BOX is the signal — ONE app-wide
  `ResizeObserver` ([measure-watch.ts](../../../src/lib/forest/measure-watch.ts), the
  `card-near-zone` shape), whose callback is a width compare plus a
  `degraded()` read and which bumps nothing for a tree that measured cleanly.
  The companion half is that the two measurement rungs must be
  INTERCHANGEABLE: the DOM reports a border box and the canvas reports text, so
  the fallback adds the label's own padding back or a canvas-measured tree draws
  every label off-centre from where it was placed — and the canvas rung is
  exactly the one a hidden first render takes, so the two compound.
- **Keystroke sanctity for a derived view is a question about the CALLBACK, not
  the subscription.** This NodeView never sees the editor, which proves nothing
  on its own: a React NodeView is re-rendered by its host for reasons it does not
  control, and a re-render that re-parses, re-measures and re-lays-out is O(tree)
  per keystroke however innocent its subscription list looks — the `float-sync`
  shape. So the pod memoizes the derivation on `(derive, source)` (which is why
  the config is a module-scope CONSTANT: a per-render literal is a new memo key
  every render), the view memoizes on tree identity, and
  `window.__forestRenderStats()` counts parse / measure / layout / render
  SEPARATELY so a regression names itself.

**The cost suite's own shape is the lesson.** Its burst legs — type twenty
characters three paragraphs away, assert every counter flat — prove the
user-visible contract and are worth having, and they were MEASURED to stay green
with the pod's memo deleted, because ProseMirror does not re-render a NodeView
whose node did not change. An invariant with no leg is a habit (task 334), so
each bail got a leg that can actually see it: the pod's memo is driven by a
parent that re-renders for its own reasons, and the view's `memo` comparator is
visible only to a RENDER counter (the effect deps already stop the measure and
the layout, so an unbailed re-render reconciles every label element and re-runs
no effect — cheap enough to be invisible to the other three counters, and
O(nodes) all the same). Both fail when neutered; without those two legs, both
bails were deletable in silence.

**Six of the seven findings the adversarial pass confirmed were in this
cluster's own seams rather than in its algorithms**, which is worth recording as
a pattern: the grammar's three were each the module disagreeing with a rule it
had just written down, and the chrome's three were a per-kind inline style
becoming a shared class (a wrapper that started catching clicks the pod used to
pass through; a scroll box that positioned the pod's own corner against its
CONTENT, so the one control that reaches the source slid out of reach on exactly
the trees that need it; a print rule that reset the frame and left the clipping).
None was visible to any behavioural test of the piece it lived in.

CI: [forest-grammar.test.ts](../../../src/lib/forest/__tests__/forest-grammar.test.ts),
[forest-layout.test.ts](../../../src/lib/forest/__tests__/forest-layout.test.ts),
[forest-render-cost.test.tsx](../../../src/components/__tests__/forest-render-cost.test.tsx),
[forest-render-derived.test.ts](../../../src/lib/__tests__/forest-render-derived.test.ts),
[forest-chrome-contract.test.ts](../../../src/lib/forest/__tests__/forest-chrome-contract.test.ts)
(the ink, the amber tier and the print rules in BOTH directions — the tree
prints, the frame / corner / badge do not).

**Owed, not claimed:** the preview eyeball. Nothing here is FSA-masked — it is a
render over bytes — so pasting two or three real trees from a paper (subset
members and a `for tree=` refusal) and looking at both states is a cheap, real
check that a worktree cannot run.

##### The tail half: an anchor appended after USER-EDITABLE bytes needs those bytes to END where the reader looks

Same node, and the case where task 348's position law was correct, was cited by
the arm that broke it, and held only by an accident the source pod removed (task
387, the cluster's DATA-SAFETY adversarial pass).

348 says a construct's `%!v:` anchor is APPENDED to the end of its serialized
body and DETACHED from the end of that body — one rule, so the two ends cannot
disagree. For every other construct the emitter BUILDS the body, so they are the
same place by construction. `forestBlock`'s body is a user-editable ATTR, and
both pod write doors (`SourcePodNodeView.setSource`, the float's write-back)
store CodeMirror's buffer verbatim, with no normalizer on the node spec. So the
two ends coincided only while nobody put a byte after `\end{forest}`.

> **The renderer accepts `\s*` after the closer and the anchor reader accepts
> `[ \t]*`. A source in that gap renders perfectly and DE-ANCHORS silently.**

One press of Enter after the closer — or a paste, since every editor line-copies
with a trailing newline — put the anchor on its own line, where
`NODE_UUID_ANCHOR` cannot see it. Measured through the real save pipeline: the
tree came back uuid-less, `assignUuids` minted a fresh id, and the stranded
` %!v:ab12` line took the parser's standalone-anchor branch and became an EMPTY
PARAGRAPH holding the old identity. Every card, marginalia marker and
sidecar-only `parTitle` keyed on that uuid followed it onto a blank line;
`collapsed` was dropped outright (a `paragraph` is in `TITLED_NODE_TYPES` and not
in `COLLAPSIBLE_NODE_TYPES`). A fixed point after one cycle, with no edit to the
document itself — **the task-342 class verbatim**, and invisible to every gate:
the write gate's multiset word measure is unchanged, and 384's `END_RE` tolerates
`\s*$`, so the refusal badge stayed green for exactly this shape.

Three rules it earned:

- **Normalize at the EMIT site, not at the doors.** The serializer's arm trims
  the source's trailing whitespace before appending the anchor, so the append
  point and the detach point coincide *by construction* rather than by two write
  doors remembering to agree. The shipped siblings show both shapes and are the
  reason this is forest-specific: `texBlock` is immune because its anchor rides a
  `%!vtex:begin` SENTINEL LINE, and `graphicsBlock` — the only other
  `${bytes}${anchor}` emitter — is immune only because its edit door happens to
  `.trim()`. `forestBlock` was the one emitter of that shape whose every write
  door wrote raw.
- **It is a whitespace normalization, and idempotent.** Whitespace before the
  closer's own line end is not content and the arm appends `\n\n` regardless,
  so cycle 1 canonicalizes and cycle 2 is byte-identical.
- **Residual, stated: NON-whitespace after the closer is left alone because it
  is already LOUD.** A trailing `% note` or a second pasted environment makes
  `END_RE` refuse, and 384's badge names it. A fix that made the quiet case loud
  and the loud case quiet would be the wrong trade.

**A bookkeeping SENTINEL is invisible to every predicate the serializer asks
about its own output.** The same pass found 383's `carriedSource` marker leaking
into a question one arm over: `listItem` chooses its head/tail separator with
`startsBlockBoundary(tailText…)`, which is anchored `^\\(…|begin|…)` and
therefore answered *false* for a `forestBlock` tail child whose true first bytes
are `\begin{forest}` but whose emitted first bytes are the NUL-led sentinel
(stripped only later, in `collapseBlankRuns`). The item gained a blank line — a
LaTeX `\par` inside `\item`, typesetting the tree as a fresh indented paragraph
— while a nested `\begin{itemize}` in the identical slot was correct. That makes
it the cluster's own regression rather than a shared property: forestBlock is the
one node whose real first bytes ARE a boundary and are hidden behind the
sentinel. The predicate now reads `withoutCarrySentinels(…)`, a named helper
beside `carriedSource` so the next such question inherits it.

**And the renderer painted text the source does not say.** TeX's end-of-line `%`
is the standard CONTINUATION idiom — the `%` discards the rest of its line
INCLUDING the newline, and the next line is entered in state N so its leading
spaces are eaten — so `[{Deter%\nmine}]` typesets `Determine`. `matchCommentTailAt`
returns the newline's INDEX rather than a position past it, so `scanLabel`'s
`i = c.end` landed ON the `\n`: the branch pushed a space, the next iteration
pushed the newline as text, and the whitespace collapse turned the pair into ONE
space where TeX yields none. The parse answered `ok`, the badge stayed silent,
and the tree read `Deter mine` — the silently-wrong picture 384's whole design
exists to refuse. The site's own comment asserted the opposite ("the whitespace
collapse below makes that difference invisible in a label") and is corrected
there rather than left standing. Only `scanLabel` was affected: `skipInert`, the
brace matcher and the option scan all skip whitespace anyway.

CI: [forest-source-tail-integrity.test.ts](../../../src/lib/__tests__/forest-source-tail-integrity.test.ts).
**No pre-387 suite could see any of the three.** Every `source` fixture in the
repo ends EXACTLY at `\end{forest}` (they all come from a parse, which slices to
the closer), so a trailing byte is unrepresentable in all of them; the cluster's
one list fixture asserts the MODEL SHAPE (`paragraph` head + `forestBlock` tail)
and never the bytes; and every grammar fixture spells its labels without the `%`
continuation. Each leg carries its control through the identical harness — an
untouched tree is byte-identical, a nested list keeps its single newline, a
second PARAGRAPH keeps its `\par`, an ordinary line break inside a label is still
one space, and an escaped `\%` is still ink. Measured by neutering each half in
turn: the trailing trim takes 4 legs, the sentinel strip 1, and the label
continuation 3.

**Owed, not claimed:** the preview eyeball — open a tree's source pod, press
Enter after `\end{forest}`, save and reload with a note card anchored to it. This
class is not FSA-masked (it is `.tex` bytes through the real save cycle), so the
check is cheap and real.

###### The tail's other half: an exemption is scoped to the shape it JUSTIFIES

Same emit site, same law, and the case where the fix above was right about the
bytes it examined and was then read as covering the tail (task 405). 387 trimmed
trailing WHITESPACE before the append and recorded NON-whitespace as a residual
on one stated ground: *"that shape is already LOUD, because `END_RE` refuses it
and the 384 badge names it."*

**The badge is loud BEFORE the save and gone AFTER it, and the transition is
exactly the save that does the damage.** Two shapes, both reachable by one
ordinary gesture in a surface the user TYPES in:

- **A trailing `% note`.** `uuidAnchorSuffix` always prepends a space, so the
  emitted line is `% note %!v:ab12`. `NODE_UUID_ANCHOR` is `^[ \t]*`-anchored
  and the dispatcher tries it right after `\end{forest}` — a miss — so the tree
  comes back uuid-less and `assignUuids` mints a fresh one, while the stranded
  line becomes a **`latexComment` holding the old id**. That comment is in
  `UUID_BEARING_NODE_TYPES` and in NEITHER `TITLED_NODE_TYPES` nor
  `COLLAPSIBLE_NODE_TYPES`, so `mergeSidecarTitles` **DESTROYS the pod's
  `parTitle` and its `collapsed` state** on the way past — task 343's read sets,
  arriving as a loss rather than as a refusal.
- **A second pasted `\begin{forest}`.** The anchor lands after tree B's closer,
  so tree B harvests it and the title and the collapse migrate with it.

Only the IDENTITY is silent — unlike tasks 342/348 the user must first type
bytes the pod visibly refuses, and the document visibly restructures. That is
why this was `normal` and not `high`, and it is also why the "already loud"
argument was so nearly right.

> **Where the emitter does NOT own the body, the end of the ATTR and the end of
> the CONSTRUCT are different places, and the anchor goes at the CONSTRUCT's.**
> [`anchorCarriedBody`](../../../src/lib/uuid.ts) is the rule, beside the 348 pair;
> [`carriedEnvEnd`](../../../src/lib/latex-lexer.ts) and
> [`graphicsCommandEnd`](../../../src/lib/figures/parse-attrs.ts) are the two scanners,
> each the SAME primitive the node's own parser branch reads. The bytes the
> reader will not claim follow the anchor, where they round-trip as themselves.

Six rules it earned:

- **The scanner is INJECTED, not dispatched on.** Only the emitter knows which
  construct it is writing, and the whole invariant is that its answer comes from
  the scanner the READER uses — `matchBeginEnvAt` + `findMatchingEnv` for an
  env, `matchIncludegraphics` for the command. A two-entry dispatch table inside
  the door would be a hand list that has to stay in step with the two emitters,
  which is the drift this file legislates against everywhere else.
- **`null` OMITS the anchor.** Bytes that open no recognizable construct are
  bytes whose node is not coming back as itself, so appending only decides WHO
  steals the identity. Omitting re-mints on reload and orphans the cards
  LOUDLY, which is a fact the user can see. That is design option (b) applied
  exactly where option (a) has nothing to hold on to.
- **The sentinel was weighed and declined.** `texBlock` is immune to this whole
  class because its anchor rides a `%!vtex:begin <uuid>` LINE rather than the
  body's last byte, and generalizing that shape would have been the safest
  possible fix — at the price of changing the emitted bytes of every well-formed
  tree in every paper. Its arm now carries the `carried-anchor-exempt:` marker
  that says so, rather than being immune by an accident nothing states.
- **`graphicsBlock` stops being immune by ACCIDENT.** Its edit door happens to
  route through `extractGraphicsAttrs`, which returns the MATCHED substring and
  drops a tail outright — true, pinned, and not a property of the emit site. Its
  `attrs === null` fallback stores raw text verbatim, and there the door now
  omits rather than handing the id to the paragraph those bytes become.
- **Two carried spans, not one.** The head and the tail are each wrapped in the
  383 carry sentinel with the anchor between them, so an interior blank run in
  either half still survives `collapseBlankRuns`.
- **The third door had to agree too, and that is what made the badge honest.**
  `END_RE` is `\end{forest}\s*$` — it resolves to the LAST closer in the string,
  where the parser and the emitter stop at the FIRST properly-matched one. That
  gap is why BOTH messages were wrong: a trailing note refused as "not a
  `\begin{forest}…\end{forest}` environment" (it is one, plus a note), and a
  second tree refused as "content after the tree", naming tree A's own closer as
  the offending content. The renderer reads `carriedEnvEnd` now and names the
  tail for what it is (`after-environment` / `second-environment`), so the
  writer, the reader and the renderer hold ONE view of that boundary.

**Decided, stated at the site: no commit-time refusal at the pod.** It is a
surface the user types in, and refusing a commit mid-edit would be Virgil's only
such refusal. What the pod does with the extra bytes is LOSE them, one block
over, as themselves — which it already did; what changed is that the first tree
keeps its uuid, its title and its collapse instead of handing all three away.

CI: [carried-body-anchor-position.test.ts](../../../src/lib/__tests__/carried-body-anchor-position.test.ts).
Every leg drives the REAL save pipeline over TWO cycles carrying the SIDECAR
(nothing serializes `parTitle` or `collapsed` into the `.tex`, so a round trip
that drops it cannot see the loss at all) and asserts the parsed node's `uuid`
ATTR, never a `%!v:` grep of the emitted bytes — a dead marker stranded inside a
comment still matches the grep, the trap that sank the first draft of 387's own
M4 leg. The FIXED POINT is cycle 3, not cycle 2, and the leg says why: the
displaced bytes come back as a block with no id, so `assignUuids` mints one for
them on the next open — the ordinary path for any new block, and precisely the
settle the pre-405 emitter never reached, where the TREE was the block being
re-minted every cycle forever. The leg with teeth is the CENSUS: membership is
DISCOVERED from the serializer's own arms (a `case` spelling `carriedSource(` or
`anchorCarriedBody(` is a node whose model IS its bytes), each must enter the
door or carry the marker, the allowlist is EMPTY, and the retired
`${attr}${anchor}` shape is pinned to its two legitimate non-members by REPORT
rather than excluded by name. Measured by neutering each half in turn: the
pre-405 append takes 9 legs, the omit-on-`null` rule 3, the badge half 3 (one of
them 387's own renegotiated leg), and the dropped exempt marker 1.

**Owed, not claimed:** the preview eyeball — paste a tree, press Enter after
`\end{forest}`, type `% note`, save and reload with a note card anchored to it.
Not FSA-masked (`.tex` bytes through the real save cycle), so the check is cheap
and real.

##### The projection half: a schema's vocabulary is every PROJECTION's vocabulary

Same pass, and the case where two hand-written tables had a comment telling the
next author to keep them aligned, and `forestBlock` was added and they were not.

A card body's schema admits six BLOCK ATOMS (`CARD_BODY_BLOCK_ATOMS`, now
declared in the import-free leaf [node-attr-sets.ts](../../../src/lib/node-attr-sets.ts)
and re-exported by `borrowed-schema.ts` as `BORROWED_BLOCK_ATOM_NAMES`, whose own
contract test pins it against the REAL card and main-editor extension lists in
both directions). A block atom keeps its content in ATTRS, so a walker with no
arm for it does not degrade — it falls through to `if (node.content) …` and
returns `""`.

> **Every PROJECTION of a card body is TOTAL over the block-atom vocabulary that
> body's SCHEMA registers.**

`richJsonToPlainText` losing an arm costs a blank preview. `richJsonToLatex` is
what a `\footnote{}` body is SERIALIZED with, so losing one costs the user's
bytes: a forest tree dropped or pasted into a footnote/note body mounted happily,
rendered, and was DELETED from the `.tex` on the next save — no throw, no
warning, the rest of the body intact, while its shipped sibling `texBlock`, whose
arm sat four lines away, kept its bytes. Both tables are now
`Record<CardBodyBlockAtom, …>`, so a new block atom is a COMPILE ERROR rather
than a silent deletion.

Two rules it earned:

- **The vocabulary lives where the layer that needs it can REACH it** — the
  placement rule `latex-markers.ts` and `node-attr-sets.ts` each earned.
  `footnote-content.ts` is on the TipTap-free `.tex` side and cannot import the
  extension list, which is exactly why it re-typed the vocabulary and exactly how
  the re-typed copy came to be missing a member.
- **An INLINE-registered atom keeps its own arm.** `displayMath` is in
  `BORROWED_INLINE_ATOM_NAMES`, not the block table, and is still an attr-carrier
  the fall-through would erase — so it is handled beside the table with the
  reason at the site, rather than smuggled into a set it is not a member of.

CI: [card-body-block-atom-projection.test.ts](../../../src/lib/__tests__/card-body-block-atom-projection.test.ts),
swept FROM the vocabulary so a new kind arrives with no fixture and the coverage
leg fails first. **No pre-387 suite could see this**: the footnote-content suites
drive bodies of prose plus inline atoms — the shape a footnote body normally has
— so a block atom reaching either walker is unrepresentable in all of them, and
the borrowed-schema contract asks only whether the two SCHEMAS agree, never
whether anything downstream can represent what they admit. The leg with teeth is
the CENSUS, and its membership is DISCOVERED by the SHAPE the defect had — a
walker dispatching on `node.type === "<atom>"` for two or more block atoms —
because a bare "names ≥2 atoms" needle indicts ten files that merely carry a
union, a registry key or a kind list, and answers a different question
(measured). Measured by neutering each half: dropping the forest arms takes 3
legs, restoring the pre-387 if-chain 5.

**Residual, stated.** `richJsonToLatex` collapses whitespace — a footnote body is
INLINE — so a tree projected into one arrives on a single line. That is the
shipped `texBlock` behaviour and it is what forest's own whitespace-insensitive
grammar tolerates; the contract this closes is that no byte is lost, not that the
layout survives an inline flattening.

##### The display half: a label a READER looks at enters the display DOOR

Same node, the UX/PERF/GUARD-INTEGRITY pass (task 388, adversarial run 2) — and
the case where the design's own headline rule was applied to every construct the
grammar REFUSES and to none of the bytes it ACCEPTS.

A forest node label is a raw-LaTeX fragment shown to a human. Task 368 built one
door for exactly that question (`latexToDisplayText`) and gave it a census that
discovers members from the bib-parsers' `format*` exports — so it is
structurally blind to a scanner in `src/lib/forest/`. `scanLabel` pushed every
non-escape byte into the label verbatim (its whole vocabulary was a private
seven-entry `LABEL_CHAR_ESCAPES`) and the view put it straight into a span. So
`` [{``the dog''}] `` — the universal gloss-quoting convention for tree labels —
is ACCEPTED, no badge fires, and the pod paints eight ASCII characters where the
compiled PDF shows curly quotes. Same for `S--O` (two hyphens, not an en dash)
and `Fig.~1` (a literal tilde, not a tie). **An accepted source drawn as a
picture it does not say, which is the one outcome task 384's design exists to
refuse** — and the user has no way to detect it.

> **A raw-LaTeX fragment shown as DISPLAY TEXT enters the door wherever it
> lives**, including inside a renderer's own scanner. The projection is about
> what accepted bytes LOOK like; it never widens what is accepted.

Three rules it earned:

- **Project the ASSEMBLED run, after the structural branches have taken their
  bytes.** Math, groups, comments and the delimiters are consumed first, so the
  door only ever sees prose plus the char escapes the scanner already resolved,
  and it passes anything it does not know straight through. A `\command` in a
  label still refuses at the backslash branch, BEFORE any of this — pinned by
  its own leg, because the tempting reading of "enter the door" is "accept what
  the door accepts".
- **The flat `labelText` is rebuilt from the PROJECTED segments**, not from a
  raw accumulator kept beside them. It is the canvas measurement rung and the
  a11y string: `` ``x'' `` is six bytes and `“x”` is three, so a raw flat string
  hands the two measurement rungs different widths — the exact contract
  `borderBoxFromTextWidth` exists for.
- **The whitespace collapse runs BEFORE the projection and never after.** `\s`
  matches U+00A0, so a second pass flattens the `~` TIE the door has just
  produced back into an ordinary space — measured, that was the fix's own first
  cut.

The same pass closed two more, both of which were BLANK rather than wrong:

- **The T1 static card tier painted NOTHING for a source pod.** A block atom
  keeps its payload in ATTRS, so a `renderHTML` that emits only a wrapper `<div>`
  projects to an empty element wherever the NodeView is not what renders —
  `renderBorrowedHtml`'s static tier (whose own doctrine is that it paints
  "visually identical" to the live tier, and the live tier here is the pod's
  card-context `<pre>`) and the CLIPBOARD, since ProseMirror serializes a copied
  slice through the node spec's `toDOM`. `sourcePodStaticBody`
  ([src/lib/tiptap/source-pod-static.ts](../../../src/lib/tiptap/source-pod-static.ts))
  is the shared child spec both source-pod nodes now emit — a bare string child
  becomes a TEXT node, so the bytes are escaped by the serializer, and the node
  stays `atom: true`, so `parseHTML` still reads the source off the ATTRIBUTE
  and ignores the child. This is task 387's projection law with a THIRD member:
  `richJsonToLatex`, `richJsonToPlainText`, and the static HTML tier.
- **The RO's `degraded()` gate had no leg**, which the run measured: deleting
  `if (!waiter.degraded()) continue;` from `measure-watch.ts` left all 212 legs
  of the cluster green. The gate is what the module's whole docstring rests on
  ("a tree measured from real boxes ignores every fire"), and jsdom reports 0×0
  for everything — so a NON-degraded first measure is unrepresentable without
  stubbing the rect read, which is exactly why the hidden-case leg could ship
  while its complement could not be seen. **And the harness that drives it was
  itself fragile in a way worth carrying forward:** the suite mounts a real
  CodeMirror (every refused pod pins to its source surface) and CodeMirror
  constructs a `ResizeObserver` of its own, so a single shared `deliver` binding
  is whichever observer was built LAST. The stub records observers
  PER INSTANCE and delivers to the one that actually observed the host.

CI: the projection legs live in
[forest-grammar.test.ts](../../../src/lib/forest/__tests__/forest-grammar.test.ts) and are
asserted AGAINST THE DOOR rather than against hand-written glyphs — the contract
is that the two agree, so a vocabulary change moves both or neither — with a
plain-prose control, since a leg comparing two calls of one function passes on a
projection that mangles everything. The static tier is the third sweep in
[card-body-block-atom-projection.test.ts](../../../src/lib/__tests__/card-body-block-atom-projection.test.ts),
matched against the markup with every ATTRIBUTE stripped: the payload is already
in the markup as `source="…"`, so a raw `toContain` passes on the very output
the leg exists to indict. Measured by neutering each half: the label projection
takes 6 legs, the static body 2, the `degraded()` gate 1.

**Residuals, filed rather than fixed** (`inbox/2026-08-20-from-worker-388-…`):
the slash popup DELETES the typed text before it discovers the action is
disabled — lossy, and shared by every view-only slash command, in a file this
cluster never touched; a COLLAPSED source pod prints a two-line truncated
preview, which is neither of Virgil's two existing postures (a folded section
prints nothing, an expanded pod prints its body) and needs a render change plus
a product call; `figureBlock` and `graphicsBlock` still project to nothing in the
static tier, each named with its reason in the sweep's own
`NO_STATIC_PROJECTION`. **Owed, not claimed:** the preview eyeball — this run was
unattended and could not start a dev server.

**The fourth residual is now a DECIDED posture rather than an open one (task
412): an edge to an outer child MAY cross a roofed middle sibling's triangle,
and that is accepted and pinned.** Edges and roofs are built from the placed
boxes in two loops that do not know about each other, so where a parent has ≥3
children and a NON-OUTER one is a roofed LEAF, an outer sibling's edge clips the
triangle's flank. Gabriel's ruling: the reading is a line clipping a triangle
tip rather than a misread tree, and routing edges around obstacles is a real
layout feature with its own failure modes — it would either move labels
(renegotiating every pin the placement already carries) or bend edges, a look
nobody asked for. Three things make the acceptance honest rather than silent, and
the second is the one that took the measuring:

- **The comment is at the roof-building loop**, because silence there is how the
  next reader concludes the engine considered it — and it says the upstream
  `forest` question is **UNVERIFIED** rather than borrowing authority it has not
  checked.
- **The obvious fixture is a FALSE ALL-CLEAR, so it ships as a passing control.**
  A roofed INTERNAL middle child — which is what the filing memo proposed — puts
  no roof on the sibling row at all: `flattenRoofs` gives it a synthesized
  roofed ONLY-child one row down, and an only child can never be a middle
  sibling. The crossing needs the `[{x},roof]` LEAF spelling AND a left sibling
  label wide enough (~46 characters under the suite's own width metric) to swing
  the parent's centre past the triangle. A worker following the memo would have
  measured a clean tree and concluded the engine already routes.
- **The sweep is an EXACT SET over the corpus, not a fixture.** Every shape is
  asked which of its edges cross a roof, and the set that does must be exactly
  the member that DECLARES it — so a future layout change that introduces a
  crossing in some other shape fails rather than shipping quietly. Beside it, the
  declared crosser's numbers are pinned outright, and a property leg says an edge
  can never enter its OWN child's roof (the triangle's interior lies strictly
  below the apex, where that edge terminates).

The intersection test is exact convex clipping, deliberately not point sampling:
a sampled probe reports a grazing clip as a miss, or a real one as a hairline,
from where its samples happened to land — and it did, during this task's own
diagnosis, before the analytic form replaced it. **A pin decided by sampling
density is not a pin.** CI:
[forest-layout.test.ts](../../../src/lib/forest/__tests__/forest-layout.test.ts) ("edges
vs roofs"). Measured by neutering each half in turn: the memo's fixture as the
corpus member takes 3 legs, a roof-height drift 1, and a hypothetical routing
change 4.

### The liveness half: a page event is not a window event, and "who is alive" is the browser's to say (task 603)

`pagehide` fires on every RELOAD and on entry to the back/forward cache, so a
handler that deletes per-window state on it races the very reader that state
exists for (the reload's tab restore, keyed by a sessionStorage window id that
survives the reload by design). And the old windows registry — a heartbeat
record every window rewrote every 30 s — had no reader at all. Both retired:

- **No page event deletes the tab record** (`tabs/<windowId>`). `writeTabs`
  stamps `savedAt`; the startup `sweepTabRecords` (doc-index.ts) deletes a
  record only when its window is not alive AND it is older than
  `TAB_RECORD_MAX_AGE_MS` (30 days, so a browser-restored window still gets
  its tabs). A pre-603 record without a stamp is stamped, not deleted.
- **Liveness is a Web Lock, not a heartbeat.** Each window holds
  `virgil-window/<id>` for the page's life
  ([window-liveness.ts](../../../src/lib/multi-window/window-liveness.ts));
  `navigator.locks.query()` is the reader. An idle live window is never swept.
- **A persisted `pagehide` still releases doc locks** (a frozen page must not
  keep a paper from its peers); the matching persisted `pageshow` awaits that
  release, then re-claims the shown papers through `claimEach` — the same
  claim-or-drop rule as the session restore — and a paper a peer took leaves
  through `retireOpenDoc`.

CI: [tab-record-lifetime.test.ts](../../../src/lib/__tests__/tab-record-lifetime.test.ts)
(sweep + census: no `touchWindow`/`forgetWindow`/windows registry) and
[useFiles-page-lifecycle.test.tsx](../../../src/hooks/__tests__/useFiles-page-lifecycle.test.tsx)
(reload restores; bfcache re-claim ordering and drop). Neutered against the
pre-603 hook + doc-index: 10 of 12 legs fail, the reload leg with the lost tabs.

### The census half: the guard that asks the law's own question has ONE implementation (task 634)

> **A completed migration leaves a PREDECESSOR behind, and "did anything ever
> call it?" is a question no reviewer runs.** So the law gets a MACHINE:
> [`_export-census.ts`](../../../src/lib/__tests__/_export-census.ts) — a
> source-reading census that names any value export in a censused module with no
> NON-TEST caller, with re-export clauses stripped before counting, because *a
> barrel entry proves the symbol was published, never that it was wanted.*

The card spine's own vestiges are the case that forced the extraction, and their
shape is the general one. Two migrations landed — the INVERSION (each kind
declares its `panel:` in `CARD_REGISTRY`, so membership derives) and the AF KEY
FLIP (`float:card:<kind>:<id>`, no prefix segment at all) — and `predicates.ts`
recorded both in the present tense while what they replaced sat two files away,
exported, derived, commented "Don't hand-edit", and read by nobody:
`PANEL_REGISTRY.card`'s hand-written `keyPrefix` + `themeKey` columns (16 literals
duplicating the registry), `CARD_KEY_PREFIXES`, and three predicates
(`isSystemCardKind` / `stackableCardKinds` / `canMorph`) with zero callers of any
kind, not even a test.

Four rules the pass earned, each the half a plain deletion would have missed:

- **A census catches an unread EXPORT; it cannot catch a hand-written DUPLICATE
  of a derived fact.** `CardLink.keyPrefix` was read by nobody — but one reader
  would have silenced the census while the two copies drifted, and
  `themeKey: ThemeKey` is a 13-member union, so a wrong-but-valid value compiles
  clean. So pair the census with the fix this codebase already prefers: **delete
  the duplicate rather than pin it.** `PanelRegistryEntry.card` collapsed to
  `CardKind | null` — the panel's PRIMARY kind, the one fact `popKey` reads — and
  the whole `CardLink` interface went with the two dead columns.
- **A test-only export is DEAD, but a PARITY ORACLE is not.** The census counts a
  suite's hits separately for the reason task 202 found: a guard that treats a
  suite as a consumer says "alive" about every dead export that was ever tested.
  The exception is narrow and must be stated: where a LIVE legacy PARSER exists,
  the frozen generator whose output it must keep matching is that parser's
  specification, and deleting it moves the frozen shape into the suite with
  nothing pinning the two together. `nextCardTitle` is allowlisted on exactly
  that ground (`isAutoTitle`'s spec, via `resolveLoadedTitle`'s legacy fallback);
  its retirement is the parser's.
- **A frozen legacy token does not live on the LIVE spine.** `CardMeta.keyPrefix`
  claimed to be "preserved byte-for-byte" for a key grammar that had since
  changed, on the registry the next contributor reads to learn the current one.
  It moved, byte-identical, to
  [`LEGACY_TOKEN_CROSSWALK.legacyKeyPrefix`](../../../src/cards/legacy-token-crosswalk.ts)
  beside `legacyDataKind` and `cssToken` — the module whose whole promise is that
  its values are frozen namespaces no live grammar reads. `Record<CardKind, …>`,
  so a new kind still cannot skip the question.
- **A checker keyed on the SYNTAX of a field is one refactor from deriving
  `false` for everything.** `check-coherence.mjs` asked "does this panel host a
  card?" by testing whether `card:` was an object literal, plus a
  `POLYMORPHIC_CARD_PANEL` map the inversion had already deleted — so that `Set`
  was always empty, notes/reports/cutter silently answered `false`, and three
  `warn`-only findings had been wrong for months. It now asks `CARD_REGISTRY`'s
  `panel:` declarations, the same SSOT the app reads, and FAILS OPEN (skip, never
  all-false) when the registry cannot be parsed.

Scope is a DECISION, not a discovery. The census takes any file list, so widening
is one line — and the suite header names the five members a spine-wide scope
flags today (`accentTokenFromTint`, `cardKindsForMarkerType`,
`PANEL_TO_CATEGORY`, and the `CardLifecycleProvider` / `useCardLifecycle` context
half that is task 635's subject), each needing its own disposition. A census that
lands with a five-entry allowlist is weaker than one that lands with the
deletions done.

CI: [card-spine-export-census.test.ts](../../../src/cards/__tests__/card-spine-export-census.test.ts)
(the verdict + the allowlist-staleness leg + a code-only pin on the retired
vocabulary) and [link-surface-honesty.test.ts](../../../src/links/__tests__/link-surface-honesty.test.ts),
now reading the same machinery — its own `readdirSync` population (the pre-429
gitignored-scratch bug) and five-stage regex chain (the task-202b runaway that
ate 7 kB of a live file) both retired onto `_source-scan`'s `trackedFiles` and
one-pass scanner. Teeth: a re-added dead export fails the census, and so does one
"referenced" only by a barrel re-export.

### The reachability half: a checker whose subject is a component-local literal is not checked at all (task 635)

> **A coverage assertion is only as good as CI's ability to reach its SUBJECT.**
> Where the thing declared lives in a module, a suite can call the checker and be
> done. Where it is built inside a component — a `useMemo` closing over per-doc
> hooks — the checker can only ever fire at dev runtime, and the suite that
> "arms" it ends up building a FIXTURE derived from the declaration it is meant
> to be measured against. That suite verifies the checker, not the thing checked,
> and the gap is invisible precisely because the file is green.

The card spine has seven `assert*Coverage` functions. Six take no argument: their
subject is a module-level registry (or one a boot-time registrar mutates), so a
CI leg that calls them checks the real thing.
[`assertLifecycleCoverage`](../../../src/panels/card-lifecycle-registry.tsx) is
the one that takes its subject as a parameter, and that parameter is
`EditorPane`'s `cardLifecycleRegistry` memo. So the census question the law asks
of exports — *does anything read this?* — has a sibling for GUARDS: **does
anything run this against the value it is about?** For months the answer was no,
and three things each looked like they covered it and did not:
`lifecycle-coverage-assertion.test.ts` (synthetic fixture, and honest enough to
say so in its own header), the type system (`Partial<Record<CardKind, …>>`, so
dropping a declared op typechecks and ships), and the assertion itself (`return`
on `NODE_ENV === "production"`).

**The remedy is the SOURCE-READING LEG, and it is already this repo's idiom** —
`card-anchor-authority-census`'s `marginaliaMarkers` slice,
`confirm-suppression`, `stack-pull-content-fidelity`, `marginalia-lane-regime`:
name the binding, slice its literal out of the component, assert on it, and fail
with *"renamed? re-point this leg"*. Preferred over exporting the builder for a
test to call, which drags every per-doc hook into a fixture surface and reshapes
production to suit a suite.

**Four properties such a leg needs, because one that parses nothing passes
forever.** A source-reading guard is compliance-shaped by default: it must pin
(1) that it parsed something AND that what it parsed is well-typed against the
real vocabulary (every key a real `CardKind`) — an empty map and a garbled parse
fail differently; (2) that every member it found is one the leg MODELS, failing
OPEN on an unknown (task 634's rule 4 again — a fourth lifecycle op must stop the
file, not be silently dropped from the comparison); (3) that the scanner did not
swallow a line INSIDE the slice (`swallowedLines` — corruption is confined to one
line and survivable everywhere else, but here it would report a capability gap
that does not exist); and (4) that the literal it read is the value actually
handed to the consumer — else the leg is itself an unread registry, one level up.
Parse inside a leg, never in the `describe` body: a collection-time throw makes
vitest report *"no tests"* with the message buried, and a guardrail should name
the leg it broke.

**And the corollary about DOORS.** This registry shipped two delivery halves —
a React-context provider and a direct API constructor — and only the second was
ever called, because its consumers are hooks the building component already owns.
The module header described the dead path in the present tense for months. One
construction site is what makes a source-reading leg TOTAL rather than a sample,
so the unread door was deleted and the module added to the export census's
population in the same pass: the deletion is the easy half, and the population
entry is what refuses the third door.

CI: [lifecycle-coverage-assertion.test.ts](../../../src/panels/__tests__/lifecycle-coverage-assertion.test.ts),
[card-spine-export-census.test.ts](../../../src/cards/__tests__/card-spine-export-census.test.ts).

---

## The FOURTH-SURFACE half (task 639)

> **A surface a registry claims to cover is covered only when the registry
> reconciles it against a vocabulary that is ALIVE — one the surface's own code
> reads, not a hand list describing it.** Where no such vocabulary exists, the
> honest move is to BUILD one and make it load-bearing, not to declare the
> membership and add a doc-comment conceding the hazard.

`ACTION_REGISTRY` calls itself the SSOT for "every editing action Virgil exposes
across its FOUR action surfaces". Three were reconciled against something live:
slash against `VIRGIL_COMMANDS` → `SLASH_NAME_TO_ACTION_ID` (forward, return and
map-key legs), and both MENUS by *rendering from the rows*. The fourth,
typed-LaTeX input, was `CARD_IDS_WITH_TYPED_RULE` — a two-element `Set` whose own
doc stated the hazard plainly: *"a hand list whose hazard ('it can only be
missing a name') is real and accepted."*

**What that cost, measured at `88044ee9`.** The live typed surface had FIVE
members, exactly enumerable because each one calls the shared collab gate
(`grep -rn collabReadOnly src/lib/tiptap`): `\cite{}`, `\footnote{}`, `$`, `$$`,
`% `. The registry accounted for TWO. Both math rows read `surfaces: { lightning:
true }` while `math.ts` installed live `handleTextInput` plugins two files away —
the registry and the extension contradicting each other *in writing*. And
`latex-comment` had no row at all.

**The guard was not failing to catch the drift; it was ENFORCING it.** The block
leg forbade exactly what was true (`row.surfaces.grab || row.surfaces.typed ||
row.surfaces.keyboard` → *"claims a surface it does not expose"*), so correcting
a math row's flag turned `assertActionCoverage` RED. This is the shape to watch
for: when a guard's *complement* arm is a hand-written forbid-list, a correction
and a regression are indistinguishable to it, and the file teaches the next
author to re-introduce the falsehood.

**The remedy is a census that the surface itself reads.**
[`typed-latex-input-rules.ts`](../../../src/lib/tiptap/typed-latex-input-rules.ts)
holds id → trigger pattern for all five rules, and each extension MATCHES with
the object it reads from there. That makes the table load-bearing in three
directions at once, which is what separates a registry from a description:

1. **Extension → census.** Delete an entry and its rule stops compiling
   (leaf-sharing, the `CITE_RE_FULL` / `FOOTNOTE_RE_FULL` idiom generalized).
2. **Census ↔ rows.** `typedOwners()` replaces the hand set, and the
   reconciliation arm runs the slash arm's legs: forward (every census id has a
   row claiming `typed`), return (every `typed`-claiming row is a live owner),
   and **regex IDENTITY** — `row.inputRulePattern === TYPED_LATEX_INPUT_RULES[id]`,
   because `/a/ !== /a/` and a re-spelling is precisely the drift leaf-sharing
   exists to prevent. A shape check (`toBeInstanceOf(RegExp)`) cannot see it.
3. **Census ↔ SOURCE.** The table still could not see a SIXTH rule added
   tomorrow. So `typed-latex-census.test.ts` reconciles the key set against the
   property that made the surface enumerable in the first place: a file under
   `src/lib/tiptap` pairing `handleTextInput(` with `collabReadOnly(` IS a typed
   member. It leans on `typed-latex-collab-gate.test.ts` deliberately — a rule
   skipping the gate escapes this census and trips that one, so neither can be
   satisfied by weakening the other.

**Two corollaries worth carrying.**

*The typed question belongs to ONE arm, not to six slices.* It had been asked
per-slice (the card leg declared, the heading/block/atom/title legs
blanket-forbade, the format leg partitioned), which is exactly how the six came
to answer it differently. Duplicating a cross-cutting question per slice is the
mechanism by which slices disagree.

*A surface with two PROVIDERS is still one surface.* The typed flag is also
legitimately owned by the three markdown WRAPPERS, whose rules are StarterKit's
(task 427) and which no Virgil census can scan. `typedOwners()` unions the two
halves rather than carving an exemption, so the return leg stays total.

**And the delegation corollary, for the census that catches you.** Giving
`latex-comment` a real row meant giving the kind a second creator — so the
paragraph→comment mutation moved into a shared plain-PM leaf
([`latex-comment-convert.ts`](../../../src/lib/tiptap/latex-comment-convert.ts)),
with the task-578 markless-`text*` refusal travelling INSIDE it, where a third
surface cannot omit it. That immediately broke `input-rule-atom-census.test.ts`,
whose needle is body-scoped: the handler no longer spelled a replace verb, so it
silently stopped being a member. **A census that loses members silently is how a
census rots.** The fix is to FOLLOW the hop, never to exempt it — the census now
carries a `DELEGATED_CREATORS` table and verifies both halves (the caller really
calls it; the callee really asks the door before replacing). The obligation moves;
it is never dropped.

CI: [action-coverage-assertion.test.ts](../../../src/lib/actions/__tests__/action-coverage-assertion.test.ts)
(the INVERSION leg: dropping `surfaces.typed` on a math row must trip, where
setting it used to),
[typed-latex-census.test.ts](../../../src/lib/tiptap/__tests__/typed-latex-census.test.ts),
[action-union-exhaustiveness.test.ts](../../../src/lib/actions/__tests__/action-union-exhaustiveness.test.ts),
[input-rule-atom-census.test.ts](../../../src/lib/tiptap/__tests__/input-rule-atom-census.test.ts).

### The stub half: a MOCK is a copy of a surface, and a copy needs a reader (task 640)

> **`vi.mock` with a factory replaces a module WHOLESALE, so a hand-written
> factory is a full copy of another module's export surface — with the property
> that every name it omits becomes `undefined` in that suite, silently, and the
> suite stays GREEN.** A copy of a surface is the same object this law is about:
> it earns its name only if something reads the original. Nothing did, in 298
> files.

The subject was `@/lib/storage`, which every suite reaching the tiptap extension
barrel must stub (`storage.ts` picks its backend with a raw
`require("@/lib/storage-fsa")`, and vitest's alias applies only to ESM `import`,
so the real module cannot load under the runner). Measured at `88044ee9`, with
44 value exports: **298 files hand-enumerated that surface in FOUR idioms** —
`STORAGE_FNS` (202), `names` + `Object.fromEntries` (80), `names` + a `stub`
loop (15), `FNS` (1) — and a dozen distinct name sets among them. Every one
omitted `listSidecarNames` and `deleteSidecarSiblings`. **183 omitted
`mutateSidecar`**, the serialized read-modify-write door the write-path law is
built on. Fourteen stubbed `enqueueDocWrite` or `snapshotPriorBundle`, names the
module does not export — the fossil of a rename that reached most copies and not
all. And **96 bound `isDevStorage` to a FUNCTION** where the real export is the
boolean `false`: a truthy value, so every `if (isDevStorage)` in those suites'
graphs silently took the dev branch.

**Both failure directions are invisible from the test file**, which is the point.
An omitted export means either the suite never reaches that door (so the mock is
concealing that a whole write door is untested there) or a `?.` swallows the miss
and the test passes while proving nothing; the file cannot tell you which. A
phantom name means nothing at all — `mod.enqueueDocWrite = vi.fn()` is a property
on an object, and no type checks it. Task 558 had already hand-edited 25 of these
in one commit to retire `writeBib` for `mutateBib`; the result was MORE variants,
not fewer, because a fix applied file-by-file to a copied surface can only
re-partition it.

**The remedy is derivation, and the constraint is that the obvious derivation is
unavailable.** `vi.importActual("@/lib/storage")` inside the factory is the
textbook answer and it cannot be used here: importing the real module is the
exact failure the stub exists to avoid. The next single source is the module's
own SOURCE TEXT, which is this repo's census idiom already
([_source-scan.ts](../../../src/lib/__tests__/_source-scan.ts)) — so
[_mock-storage.ts](../../../src/lib/__tests__/_mock-storage.ts) reads
`storage.ts`'s value exports and builds one `vi.fn()` per name.
`mockStorageModule(overrides?)` THROWS on an override naming a non-export,
because a silently-ignored typo is how a suite comes to prove nothing.

**Three mechanics worth stating, because each one cost a run.**

1. **`vi.mock` hoists above the imports, so the factory may not DEREFERENCE an
   outer binding — only close over one.** `vi.mock("@/lib/storage", mockStorageModule)`
   throws `Cannot access 'mockStorageModule' before initialization`: the argument
   is evaluated at hoist time. The 18 pre-existing suites that close over a local
   `mockRead` work for the mirror-image reason — their `(...a) => mockRead(...a)`
   wrapper only dereferences when CALLED. The form that is order-safe regardless
   of where the helper import sits is the async dynamic import *inside* the
   factory: `async () => (await import("@/lib/__tests__/_mock-storage")).mockStorageModule()`.
2. **A census detector must not be able to HANG.** The first cut asked for "an
   array of string literals" with a repeated group around a quantified
   alternation; on the first unclosed bracket in a 2 kB region it backtracked
   catastrophically and the suite ran for minutes instead of failing. Innermost
   bracket spans (`\[[^[\]]*\]`) plus a linear scan inside them answers the same
   question in linear time. A guard that hangs is worse than one that is wrong:
   the wrong one tells you something.
3. **The anti-vacuity leg must quote the idioms it retired.** After a complete
   migration the detector's population is empty, so "zero offenders" and "my
   regex stopped matching" look identical. The census feeds itself one sample per
   retired idiom and asserts the detector still fires, and asserts the population
   it swept is > 1000 files with > 100 storage mockers in it. (This is why the
   census file exempts ITSELF from the offender sweep — its samples are hand
   lists on purpose.)

**The leg that stays alive after the migration** is the one worth copying
elsewhere: *no storage mock binds a name the module does not export*, asked of
ALL ~455 files that mock the barrel — including the ~120 bespoke per-suite
fixtures that legitimately keep their own object literals, which the migration
did not touch. A completeness census goes vacuous the moment it succeeds; a
**validity** census over the same population does not, and it is what catches the
next rename leaving a stale stub in a fixture. Paired with an independent route
on the other side — every `export const x = backend.x` in `storage.ts` must
exist on BOTH `storage-fsa.ts` and `storage-dev.ts` — the phantom class is closed
at its source as well as at its copies.

What was deliberately NOT generalized: 34 suites stub the barrel with a `Proxy`
catch-all, which is complete by construction and has never drifted, and ~120
carry bespoke fixtures with real behaviour. Neither is a copy of the surface.
PROFILE's refinement — "deep ≠ broadest blast radius" — applies: the class is
*hand-enumerated surface*, not *storage mock*.

CI: [storage-mock-derivation.test.ts](../../../src/lib/__tests__/storage-mock-derivation.test.ts).

---

## The dialect half (task 2026-09-18-646 — the feature-flag registry)

A convention nobody checks becomes whatever the last writer did. Virgil had
sixteen `localStorage` switches and no list of them, so each reader invented its
own answer to "what does ON look like": `=== "1"` in four clone modules,
`=== "on"` in the two soak flags, `!== "0"` in pending-changes, `!== "off"` in
the geometry kill-switches, and `v !== "0" && v !== "false"` in keep-alive.
Setting `virgil:card-tiers = "1"` — the spelling every neighbouring flag used,
and the obvious one to reach for — did nothing, silently, on a flag the perf
program was actively waiting to soak-and-flip.

**A per-row dialect is the drift. The dialect belongs to the READER, not the
row.** `src/lib/feature-flags.ts` declares each flag's `default`, `status`,
`requires`, an `ssr` value only where it deliberately differs, and a `legacy`
sentinel; `readFlag(key)` decides everything else once. The vocabulary is
universal in both directions (`1|true|on|yes` / `0|false|off|no`,
case-insensitive), and every legacy sentinel is already a member of it — so the
dialect only ever ADDS spellings, never retires one, and no switch a user has
already set changes meaning. The row's `legacy` field is not documentation: the
census asserts it parses to `!default`, so it cannot rot into a lie.

**The failure branches are part of the dialect.** Every reader had *two* of
them — no `window`, and `localStorage` throwing — and re-derived both. All
sixteen already agreed that a throw means "the default", so that is now stated
once. What genuinely differed was SSR: three default-ON flags deliberately
report OFF server-side to avoid a hydration mismatch. That difference is real, so
the row DECLARES it (`ssr`) and the census refuses a redundant one. The audit
had read `pending-changes`' two branches as a flag "disagreeing with itself";
they were two different questions wearing one shape, and the fix is to give each
a name, not to make them agree.

**`requires`: a flag combination can lose data.** `virgil:inline-atom-lifecycle`
gates a reconciler that registers as a policy on the identity-bus consumer, and
that consumer exists only when `virgil:identity-cascade` is on. The two were
written as independent switches. Child ON + parent OFF disabled BOTH footnote
orphan writers at once — the legacy event bridges bailed *because the child flag
was on*, and the reconciler never registered *because there was no consumer* —
so a deleted footnote was dropped instead of recorded. Nothing prevented,
detected, or documented it. The fix is not a guard that reports the bad state
but an edge that makes it **unrepresentable**: `readFlag` resolves `requires`
transitively, so the child reads OFF unless its parent is on, and an override
cannot escape it either — not even in a test. A dev `console.warn` fires once
per unmet edge (a per-read warn on a hot path would be its own performance bug).

**The census is TOTAL, which is what makes it hold.** Every `virgil:` string in
`src/**` + `library/**` must be either a `FLAG_REGISTRY` row or a declared
`NON_FLAG_VIRGIL_KEYS` row (stored data, a dismissal stamp, an event name) — a
new key is classified or it fails. Leg 2 then asserts no production file reaches
`localStorage` for a flag outside the reader. Both legs pass on "zero hits",
which is exactly what a broken needle produces, so the five retired dialects are
replayed as fixtures the needle must FIND — including the `const FLAG_KEY = "…"`
indirection the four clone modules used, which a literal-only needle would have
missed. The SSOT's own exemption is pinned to what it actually exempts: its one
read now takes a VARIABLE key, so if it ever moves back to a literal the
exemption would start hiding a real hit.

CI: [feature-flag-registry.test.ts](../../../src/lib/__tests__/feature-flag-registry.test.ts),
[footnote-orphan-flag-combination.test.tsx](../../../src/components/editor-layout/event-bridges/__tests__/footnote-orphan-flag-combination.test.tsx).

---

## The over-declaring half (task 647)

**A surface can go dead in two directions, and only one of them stalls.**
`src/links/` (task 202) went dead by STALLING: a phased migration landed its read
half, its write half never arrived, and the barrel kept every grep green. The
identity cascade went dead the opposite way — by **over-declaring**. Each of its
rollout stages published the vocabulary for the stage after it, and the consumer
either never came or came in a different shape. Nothing was abandoned; everything
was written slightly too early, which looks like diligence and reads like drift.

**A dispatched arm can still be dead, and the CONSTRUCTOR will not say so.**
`IdentityChange` carried a third arm, `{ kind: "bibEntry"; retype }`, dispatched
by `replaceBibEntry` on every real `.bib` type change. So `retypeChange` had a
production caller and read alive. Both registered `bibEntry` migrators open with
`if (!isRenameCitekey(change)) return;`, so every one of those dispatches reached
no line of code — for three months, with a suite pinning the fan-out green. The
only symbol that could have told anyone was the NARROWER, `isRetype`, whose
callers were all tests. **On a fan-out bus, the live/dead question is asked at the
consumer's narrower, never at the producer's constructor** — a constructor proves
something is sent, a narrower proves something is received.

**Retire it, don't feed it — when the arm is a category error.** The cascade
documents itself as the single writer for any identity-CHANGING operation, and
the retype arm's own comment conceded "NO identity move (same uid, same key)". A
retype changes a field of an entry whose identity is untouched; folding it in
"for consistency" bought a dead arm plus a defensive bail in every consumer
forever. The union is now two arms, each with a registered production migrator.
What was checked before deleting, recorded so a reinstatement knows: the `.bib`
write never depended on the fan-out, and no surface keys on an entry's TYPE. An
arm that lands ahead of its consumer is the shape being retired — re-add it WITH
its migrator or not at all.

**The census found a name the audit did not, one commit old.** Task 645 published
`CARD_ATOM_DOM_ID_SELECTOR` with zero callers — not even a test — under a
doc-comment naming the ghost clone and the hover bridge as its reason to exist.
Neither could ever have used it: the ghost REMOVES each attr (it needs the list),
and the hover bridge must answer WHICH KIND matched, which a joined selector
erases by construction. **A justification that names consumers is not evidence
they can consume it**; the census asks the only question that is.

**Prefer deleting a name to inventing a reader for it — check whether the
"duplication" is one.** `ATOM_REGISTRY.label` had four values and no reader, and
three surfaces hand-spell "Footnote"/"Citation" nearby. Pointing them here would
have been the larger-looking fix and the wrong one: human names live in three
registries that deliberately DISAGREE (`CARD_REGISTRY.label` says "Task" where
`CARD_ACTION_PRESENTATION` and `AIWindow` say "Todo"; "Report" against "Request
report"). They coincide on two English words and nowhere else, so an SSOT
spanning them asserts an identity their own neighbouring rows falsify, and
couples menu copy to the atom taxonomy. An Atom has no naming surface of its own,
so there was no fourth vocabulary to own. *Deep ≠ broadest blast radius:* verify
the phenomenon is general before generalising the fix.

**What the shared machinery cannot see, at its widest.** The census reads
`export function|class|const|let NAME`, so it covers neither CLASS METHODS
(`IdentityCascade.migratorCount`, `IdentityBusConsumer.policyCount` — the same
audit called both uncalled; both in fact carry registration assertions, which is
how a bare-name grep gets a method wrong in the other direction) nor REGISTRY
FIELDS. The field case is not merely unbuilt but unbuildable here: `callSites` is
a bare-name grep and `label` occurs hundreds of times across both silos as a node
attr, a menu string and a dataset key, so such a leg would read alive whatever
the truth. Stated, not papered over — a guard that overstates its reach is the
failure mode this law is about.

**And a "NEVER dropped" header the loop did not keep.**
`sidecar-uid-migrate.ts` promised orphaned annotations are never dropped while
implementing insert-if-absent: an orphan whose citekey resolved onto an
already-occupied uid was neither written nor carried forward, and `rehomed` was
set regardless, so the caller PERSISTED the object it had vanished from. One
silent, irreversible transition. The policy is now stated ONCE
(`placeAnnotation`) and used by both the v2 re-home loop and the legacy branch —
shadowed means KEPT, and a shadow-only pass reports no re-home, which restores
the same-reference no-op contract the old flag was quietly breaking. A preserved
bucket re-homes the moment the occupant clears; a discarded one is gone. **A
doc-comment stating a guarantee is part of the contract: make it true or correct
it — a later reader will rely on it, and here the code was one line away.**

CI: [identity-surface-honesty.test.ts](../../../src/lib/identity/__tests__/identity-surface-honesty.test.ts)
(third caller of [_export-census.ts](../../../src/lib/__tests__/_export-census.ts)),
[sidecar-uid-migrate.test.ts](../../../src/lib/identity/__tests__/sidecar-uid-migrate.test.ts)
(the collision branch — three of its four legs fail on the pre-fix loop),
[useCitations-replace-bib.test.tsx](../../../src/hooks/__tests__/useCitations-replace-bib.test.tsx)
(the retype pin renegotiated: the type lands on disk and NOTHING fans, on both flag paths).

---

## The attr-literal half — "rebuild from scratch" is the wrong verb for an edit (task 658)

`MAIN_STARTERKIT_NODE_ATTRS.heading` declares what a heading carries: `label`
(its `\label{}`), `uuid` (its IDENTITY), `numbered` (its `*`), `sectionNumber`,
and `shortTitle` (its `\section[short]{…}`). Three write sites changed a
heading's LEVEL, and only one of them had ever read that table:

| surface | spelling | outcome |
|---|---|---|
| the heading-annotation chip's type menu | `setNodeMarkup(pos, undefined, { ...node.attrs, level })` | correct |
| `headingRun` — the SSOT behind the BlockType dropdown levels 1–4 **and** the four slash `\chapter`/`\section`/… commands | `setBlockType(from, to, heading, { level, numbered: true })` | rebuilt |
| the dropdown's out-of-scope levels 0/5/6, which skip the registry | `setNode("heading", { level, numbered: true })` | rebuilt |

`setBlockType` / `setNode` compute the new node's attrs **from the object they
are handed**, so every key it does not name falls back to its schema default.
Demoting a `\section*[Short]{Introduction}\label{sec:intro}` from the dropdown
therefore deleted the user's `\label` (every `\ref` to it left dangling in their
`.tex`), deleted the `[short]` running head, forced the starred section numbered
(renumbering every section after it), and re-minted the `uuid` — orphaning every
card anchored to that heading. Silently, in the user's only copy.

**The rule.** A literal attr object is the verb "rebuild this node from
scratch." It is right for a genuine CONVERSION — a paragraph becoming a heading
has no heading attrs to keep — and wrong whenever the node already exists and
the user is changing ONE of its properties. Where both cases reach one call
site, the decision is per-NODE, so it belongs in `setBlockType`'s attrs-FUNCTION
form, not in a literal: a mixed range (a heading and a paragraph selected
together) has no single correct literal, which is the structural proof that the
literal was never expressible.

**Preserve by CONSTRUCTION, not by remembering the list.** The door
([heading-level.ts](../../../src/lib/tiptap/heading-level.ts) —
`headingAttrsForLevel` / `setHeadingLevelInRange`) spreads `node.attrs` rather
than enumerating keys, so the next attr added to the table is carried without an
edit there. The enumerating alternative (hand the same `setBlockType` a merged
literal) is a smaller diff that restates "which attrs matter" at a second site —
the drift that caused this. `sectionNumber` and `shortTitle` were both added
AFTER `headingRun` was written; that is exactly how the list came apart.

**Identity is carried, not rescued.** `block-uuid-backfill`'s re-parent transfer
REFUSES a same-type write by design (`if (oldParent.node.type ===
newParent.node.type) return null;` — a same-type in-place write is the caller's
own statement about that node, and honouring it would silently undo a deliberate
`uuid: null`). So nothing downstream could have saved the heading's id; it had
to ride in the spread attrs. The backfill then sees a uuid whose owner left the
doc in the same batch (`removedUuids`) — a move, not a duplicate — and keeps it.

**What is NOT preserved, on purpose.** `sectionNumber` is derived display state
owned by the section numberer, which re-solves the whole document after any
structural change; a heading that becomes a subsection genuinely gets a
different number. The door carries the attr through the write and the numberer
lands after it. Pinning the old number would assert a bug.

CI: [heading-level-attr-preservation.test.ts](../../../src/lib/actions/__tests__/heading-level-attr-preservation.test.ts)
— four surfaces over one fixture carrying a label, a `[short]` title,
`numbered: false` and a uuid; a `.tex` leg (the `\label` and `[short]` survive
and the section stays starred); the conversion and mixed-range legs; and a
CENSUS that discovers the write population from the tree, so a fourth surface
cannot slip the door. Pre-fix nine of its fourteen legs fail and the five chip /
conversion legs pass — that asymmetry is the finding. Plus M8c in
[reparent-identity-conservation.test.ts](../../../src/lib/tiptap/__tests__/reparent-identity-conservation.test.ts)
(the same-type case, stated where M8/M8b would otherwise imply it was covered).

## The narrowest-list half — N hand-kept lists lose a feature at the SHORTEST one (task 666)

**Rule.** When several consumers need the same MEMBERSHIP answer ("which
collections carry a Mode-B text anchor?"), the answer is derived ONCE from a
declared facet and handed to every consumer as a TOTAL type. Not N lists kept
in sync by eye — because N lists do not fail loudly when they disagree; the
feature simply stops existing wherever the shortest list runs out.

**The shape.** "Which card collections carry a Mode-B (`linkedRange`) anchor?"
was asked in four places, as four hand-written lists:

| site | count |
|---|---|
| `useLinkedAnchorReconciler` (the orphan reaper's alive-set) | 6 |
| `reapply-mode-b-anchors` (the load-time mark re-apply) | 6 |
| `EditorLayout`'s `hoveredAnchorId` literal | 4 |
| `useTextHoverBridge` (the text→card direction) | 4 |

The two short ones cost real features, in *opposite* directions. The hover
bridge's omission made a **highlight's** and a selection-created **todo's**
anchored text dead to hover AND click — painted, tinted, inert. The shell's
omission made hovering a **highlight's** or a **report's** CARD light no text.
Each direction alone reads as "that kind just doesn't do that"; together they
were invisible.

**Three things made it survivable, and each is a lesson.**

1. **The membership fact was already written down — twice — and still not
   read.** `reapply-mode-b-anchors` said reports "must be re-applied like every
   other Mode-B kind — omitting them was a latent BUG1 instance";
   `useLinkedAnchorReconciler` said todos "MUST be in the alive-set". Two
   comments recording that the class had bitten before, on a list that could
   still be written short. *A comment naming a bug class is evidence the class
   needs a TYPE, not a better comment.*
2. **A generic MECHANISM was mistaken for a generic ANSWER.** The hook's own
   header claimed "One listener handles every kind generically." True of the
   DOM read; false of the kind set, which was hardcoded in its argument list.
   (Compare "The other half: a shared WALKER is not a shared ANSWER", above —
   same confusion, mirrored.)
3. **OPTIONALITY hid the shell's hole.** `EntityCollectionSlots.highlights` and
   `.reportCards` were `?:` "so legacy callers still compile" — so the literal
   that omitted them compiled, and the entity resolved to `undefined`, which
   looks exactly like "no such card" rather than "you forgot a slot."

**The fix, and what generalizes.** Membership is now DERIVED, from a facet that
already existed: `LEGACY_TOKEN_CROSSWALK[kind].legacyDataKind`, whose own
contract reads verbatim "`null` if this kind never carries a `linkedAnchor`
mark". No new registry facet was added — *prefer reading a declared fact over
declaring it a second time.* The slot BINDING (which bag array hosts which
kind, and in what order — highlights must stay LAST for overlap last-wins) is
declared in one table in `src/cards/mode-b-collections.ts`, CHECKED against the
derived membership by a dev canary and by
`src/links/_shared/__tests__/mode-b-collection-set.test.ts`.

The forcing function is the TYPE, not the census: `ModeBBag` is
`Record<ModeBSlot, …>`, total over the slot union, so **a narrow consumer no
longer compiles.** The census is the second rung (every consumer imports the
SSOT; none re-lists the names; allowlist EMPTY), and the two Mode-B slots on
`EntityCollectionSlots` are now REQUIRED — a caller with none passes `[]`
explicitly. A membership question whose wrong answer is *silence* must be made
unrepresentable, not merely tested.

**Residual, honestly stated.** The slot binding is a declared table, not a
derivation: nothing in the registry answers "which array of the per-doc bag
does this kind live in" (the `notes` panel hosts `note` AND `highlight` across
two arrays, so the panel facet cannot answer it). Adding a Mode-B kind to an
EXISTING slot costs zero edits; a kind that needs a NEW slot costs one row —
and omitting it fails the census rather than losing a feature.

CI: `mode-b-collection-set.test.ts` (the census + the derivation),
`useTextHoverBridge-mode-b-kinds.test.tsx` (the first test that ever mounted
this hook — its absence is how this shipped).

## The alibi half — a dead SSOT's duplicates share its NAME (task 668)

> **A census keyed on a bare NAME is not merely blind to a dead predicate — it is
> ANTI-correlated with one.** What proves a predicate dead is that the decision
> sites re-derive it; a re-derivation is written under the same name; so the
> duplication that is the finding is also the alibi. The mitigation the shared
> census rested on — "scaffolding usually gets a distinctive name" — is exactly
> the case a duplicated predicate cannot satisfy.

`src/links/` published `isModeB` (the derivation its own header calls the
definition of Mode B), re-exported it from `links.ts`, and never imported it.
Twenty-three sites hand-wrote `targetKind === "linkedRange"` instead. The
dead-export census reported it ALIVE on four hits — one of them
`resolve-card-anchor.ts`'s own `const isModeB = link.anchor.targetKind ===
"linkedRange"`.

**The measurement.** `referenceHits` (in
[`_export-census.ts`](../../../src/lib/__tests__/_export-census.ts)) discounts
`const` / `let` / `var` / `function` / `class` declarations of the name. The
export's OWN declaration is one of those, so `callSites` no longer takes a
`declaredIn` to subtract it — one answer to "which hit is the definition?",
not two. The `editor-layout` census's private copy of the counting loop reads
the same function; its population stays its own, because the population was
never where the hole was.

**The residual, still stated.** No module resolution. A dead export whose name
collides with an unrelated LIVE symbol still reads alive. What closed is the one
collision a dead SSOT is guaranteed to have.

### The two-answers corollary

`isModeB`'s twenty-three duplicates did not agree: eight additionally tested
`textRange`, fifteen did not. A hand-rolled predicate does not merely duplicate
an answer — it **forks** it, silently, and the fork is invisible until someone
counts. Both answers now have a name (`isModeB` for membership,
`isRangedModeB` for payload) and the type stopped lying: `ModeBAnchorLink` had
declared `textRange` non-null while the guard narrowing into it never checked
it.

### The dialect half, second instance

The sibling leg — "no file promises an unbuilt phase" — was keyed on the word
`Phase` and argued at its own door that LETTERED phases must count. Correct
about one axis of the dialect, silent about the other: this subsystem numbers
with **Chip** just as often, and all four surviving false promises sat there.
One had teeth — it told a reader `reanchorByText`'s `paragraphUuid` was
"accepted-and-ignored" eighteen lines above the code that consumes it, and a
caller who believed it would pass a uuid believing it inert and lose the
Mode-B recovery (the uuid-scoped search returns `null` with NO doc-wide
fallback). The vocabulary is now a named list (`STAGE_WORDS`, `FUTURE_VERBS`)
and the verb may sit on EITHER side of the stage token — the original pattern
required the verb after it, which its own dialect's commonest wording ("its
body **lands** in Chip 6") does not satisfy.

**CI:** `link-surface-honesty.test.ts` — "the promise leg sees EVERY stage
dialect", "a LOCAL declaration of an export's name is not a caller", and the
`Mode-A/B membership has ONE speller` census. All three are planted-defect
legs: each fails against the pre-fix tree (4 promises, 21 hand-rolled
deciders), because a leg that can only report what it already sees has no way
to say it is blind.

---

## Task 669 — the row carries its own cohort

A registry can be read by the RENDERER and still re-derived by the GESTURE the
renderer arms. "Which paragraphs is this card on?" has an authority —
`resolveCardAnchorRows` / `buildCardAnchorPass` (`src/links/card-anchor-rows.ts`),
the four-rung resolver whose row set is deliberately seeded with
`res.paragraphId` so a card recovered through its `linkedAnchor` mark or its
`paragraphSnapshot` still paints a marker beside the paragraph it was recovered
ON. The margin's marker builder read that authority. The marker's **Delete**
did not: `deleteMarginItem` answered its one remaining question — *is this the
card's LAST anchor?* — from `getLinkedTextObjectIds(card)`, the card's STORED
pids.

For a recovered card those two lists are **disjoint**, and disjoint is worse
than merely different: the stored-pid diff removed nothing, reported a phantom
sibling, and routed a single-anchor card into the MULTI-ANCHOR branch, whose
`handlers.unanchor(cardId, <a pid the card does not store>)` is a no-op. Delete
on such a marker did nothing at all — no confirm, no deletion, no feedback, no
error — and only a reload healed it (the stored link is rewritten only by the
load-only Mode-A reconcile). All six card-bearing marker kinds reach that one
door, so a single fork was six kinds' worth of defect.

**The half this adds.** Where a gesture is armed PER ROW, threading the answer
as a separate argument is still a fork waiting to happen — the next kind's
`onDelete` can simply not pass it. So the cohort ships **on the row**:
`MarginMarkerRow.cardPids` is every pid the card draws a marker for, and
`deleteMarginItem` takes a REQUIRED `anchorPids`. You cannot hold the pid you
are deleting without the list it belongs to, and a new marker kind cannot
compile without deciding. The mount-gap fallback is not a second answer either:
with no index the authority's rows ARE the raw stored pids, so old rule and new
rule agree there **by construction** rather than by coincidence.

Corollary retired in the same change: the multi-anchor branch's comment "do NOT
strip the text-range mark — it's still bound to the other paragraph(s)" was
FALSE for exactly the recovered case (there were no other paragraphs), so a
recovered card's `linkedAnchor` mark was never cleaned up either. Reaching that
branch now means other markers really are painted.

**CI:** `margin-delete-recovered-anchor.test.tsx` — real editor, real authority,
real margin reader, real delete door, end to end; its two recovered-anchor legs
fail against the restated stored-pid rule (planted-defect self-check), with the
multi-anchor, ordinary-stored-pid and mount-gap controls beside them.

---

## Task 671 — two gates, one fact: the SECOND reader must not re-derive it

669's half was a gesture re-deriving what the renderer already read. This is the
same shape one level up: **where one fact governs two gates, the gates must come
out of ONE resolution, not two expressions that agree by review.** Nothing was
missing here — no registry unread, no export uncalled. Both expressions existed,
both were maintained, and they were *wrong in opposite directions*, which is the
tell that agreement was never structural.

The fact: **does this pane paint margin markers?** `EditorPane` answered it
twice, 800 lines apart —

```
render:  if (menuBar?.prefs.showMarginalia === false) return []
floor:   !!menuBar && showMarginalia !== false && !zenMode && !compressX
```

— and the floor's two extra terms were justified, in FIVE docstrings, by a
marker-hiding no code performed. **Zen** painted every note / todo / cut /
report icon while dropping the very floor that guarantees them room, so
narrowing the zen margin degraded them away with no explanation and walked the
LEFT margin down into the fold-chevron band (task 670). The **Library Reader**
did the inverse: `!!menuBar` meant "not the Reader" only until F#16 gave it
`readerMenuBar`, since when it had been forcing 184px of floored margin onto a
read-only paper view.

**The half this adds.** A docstring is not a join. Where the second reader's
answer is *supposed* to track the first's, it must be the FIRST'S VALUE, not a
restatement of its terms — and when the second gate is legitimately narrower,
the narrowing term ships in the same resolution, named as what it is about.
`resolveMarginaliaLane({showMarginalia, zenMode, compressX})`
(`src/lib/marginalia.ts`) returns `{hosted, reserved}`: `hosted` is what the
render gate returns `[]` on, `reserved` is what the margin floor and the drag
clamp read, `reserved ⟹ hosted` by construction, and the ONE term by which
`reserved` is narrower — a compressed code-split — is about the FLOOR rather
than the markers (the icons still paint, degrading down the lane resolution).
`EditorPane` makes exactly one call; the two gates read its two halves.

Two sub-rules the fix turns on:

- **A stand-in term expires silently.** `!!menuBar` encoded "is this the
  read-only Reader" as a proxy for a fact about chrome, and F#16 falsified it
  without touching this file or any test. A proxy term must be deleted when the
  real predicate exists, not repaired.
- **Occupancy is not enablement.** The floor deliberately does NOT key on marker
  COUNT, even though an empty margin is floored: the lane is not the markers'
  alone — `RIGHT_LANE_BANDS` seats the selection bolt and the scrollbar gutter,
  `LEFT_LANE_BANDS` the fold chevron. "Is the lane ENABLED" is the pane
  question; "is it currently OCCUPIED" is a different one, and answering the
  first with the second would reflow the prose column on every first-card
  create/delete.

**CI:** `marginalia-lane-policy.test.ts` — the matrix {normal, zen, zen+split,
Reader, compressed split, toggle off} with BOTH gates asserted per cell;
`reserved ⟹ hosted` over the whole input space; a structural census that
`EditorPane` holds exactly one `resolveMarginaliaLane(` call and each gate reads
one half; and a docstring census that nothing still claims the Reader hides
markers or spells `no menuBar` to mean "the Reader".

---

## The value-domain half (task 677)

> **A registry that declares a pref's legal VALUES is a validator only if the
> load path asks it. And `members` — the vocabulary a menu RENDERS — is not
> that validator.**

`VIEW_PREF_REGISTRY` has always declared `values` for its enums and `members`
for its sets, and until task 677 nothing read either at load. A stored blob
could carry `dividerWidth: "gigantic"` or `showMarginalia: "yes"` and the app
adopted it verbatim, then re-persisted it. The app validated the RARE path and
trusted the common one: the legacy standalone `virgil-divider-width` key did
check its three spellings.

The trap in fixing it is the one the registry itself warns about: a naive
`members` filter is WRONG. `members` is the MENU vocabulary — the rows the
View menu draws — and a stored set may legitimately hold members the menu does
not render (`hiddenMarginaliaTypes` may hold `error`, which is deliberately
not hideable; `hiddenHighlightTypes` may hold `report`). Validating against
`members` silently deletes exactly those, which is why
`toggleViewPrefMember` refuses to validate against it at all.

So `SetDef` gained a separate optional `domain` — the stored VALUE domain,
pointed at the live union (`ALL_MARKER_TYPES`, `ALL_HIGHLIGHT_TYPES`), falling
back to `members` only where the two coincide (`dividerLevels`) — and
[`coerceRegistryPrefs`](../../../src/lib/view-prefs/registry.ts) reads it:
toggles must be boolean, enums must be in `values`, sets are FILTERED to
`domain ?? members`. A set is filtered rather than reset because it is a list
of independent answers — one unrecognised member must not cost the user the
others; a toggle or enum has one answer, so an unrecognised one leaves nothing
to keep.

Reading the live union at runtime meant the highlight vocabulary had to leave
`useViewPrefs` (which imports the registry) for the zero-import leaf
[`view-prefs/highlight-types.ts`](../../../src/lib/view-prefs/highlight-types.ts),
re-exported from its old home. The alternative was a hand copy of the union
inside the registry — the fourth-hand-list shape task 672 deleted one field
over.

CI: [view-prefs-peer-sync-normalization.test.tsx](../../../src/hooks/__tests__/view-prefs-peer-sync-normalization.test.tsx)
(the domain legs, including the two `members`-would-have-dropped-it cases).

## The rollout-flag half — a flag may gate a FORMAT, never a behaviour (task 689)

Same law, in the tense a staged rollout puts it in. A registry can go unread not
because nobody wrote the reader, but because the reader was written **inside an
`if` that is false on every shipping build**.

`editor/scripts/citekey_keyed_sidecars.json` is the census of which sidecars
hold a citekey, and it names three: `citations.json`, `annotations.json`,
`bib-review-requests.json`. The skill side honours all three
(`apply_response.py`'s `renameCitekey`, one re-keyer each, pinned by
`test_rename_citekey_cascade.py`). The app side honoured **one**. Renaming a
citekey in the Bibliography panel rewrote `references.bib`, patched
`citations.json`, and stopped — because the whole fan-out (the editor
`\cite{}` doc-rewrite, the float-key remap, the panel-selection re-point) sat
inside the flag-ON branch of `useCitations.updateBibKeyAndType`, and
`virgil:identity-cascade` is `default: false`. Three consequences, all silent:

- every `\cite{oldKey}` in the paper became a **dangling reference that will
  not compile**, while the panel showed the rename as done;
- the sidecar half was then **UNDONE**: the next `syncFromEditor` re-derives
  `citations.json` from the doc's still-unrewritten atoms, so the user watched
  the rename half-apply and then partly un-apply;
- the entry's **annotation vanished** — with the flag off, annotations are a
  flat citekey → html record, so the note sat under a key that no longer named
  an entry. DATA LOSS at the app's own door, and the exact case
  `identity-cascade.ts`'s own header names as the reason the cascade exists.

`bib-cite-rewrite.ts`'s header states the bug verbatim as its purpose. The fix
was written, reviewed, merged, and unreachable.

> **A rollout flag may gate a FORMAT — an on-disk shape, a migration, a thing
> that is a commitment to soak. It may not gate BEHAVIOUR. When a fix and a
> format land in one flag, the fix ships to nobody, and the suite that pins the
> flag-off branch "so the existing suite is green" is pinning the bug.**

So the fan-out came OUT of the flag rather than the flag being flipped. Flipping
`virgil:identity-cascade` to `default: true` would have fixed the rename by also
committing every existing paper to a uid-keyed **v2 sidecar migration** — a much
larger promise than a rename deserves. Lifting the behaviour out is both the
deeper fix and the smaller blast radius: the flag now gates exactly the sidecar
FORMAT, and the two new re-keyers (`useAnnotations.renameAnnotationKey`,
`useBibReview.renameBibKey`) are written to be correct on **both** shapes rather
than on the flag-off one. They have to be: the v2 shape is not actually
rename-proof either. `orphanByKey` is citekey-keyed by construction, and a
uid-carrying review row still holds the `bibKey` the skill side reads to find
its entry. A "this surface is uid-keyed so a rename is a no-op for it" claim is
worth re-asking per FIELD, not per file.

**Two things the collapse exposed, which is the usual dividend of deleting a
branch nobody ran.**

- The flag-ON branch matched the `.bib` entry **by uid** — "so the rename
  targets the entry by identity, not by the about-to-change key". That reads
  right and is wrong: `runBibMutation` runs the mutator TWICE, once over the
  hook's view and once — the run that lands — over a **fresh parse** of the
  file inside the authority's write section, and `parseBibFile` **mints a new
  uid for every markerless block on every parse**. A uid is durable only where
  the file carries the entry's `\vbid{}` marker, which a user's existing
  `references.bib` does not. So a uid-matched rename matched the view and
  matched nothing on disk: it would have landed **nowhere**, for everyone, the
  moment the flag was flipped. The old key is the file's own coordinate and has
  not changed yet at match time — it addresses both runs identically. *A
  surrogate id is only an address across a boundary it actually survives.*
- The legacy branch's bare-`\b` citekey matcher is retired with the branch. It
  has no boundary at `:`, so `smith:2020` renamed to `newsmith:2020` — the key
  mangled, in the user's file. It survived because a leg pinned the branch
  as-is; `wholeWordPatternFor` is what the other branch already used.

And one unrelated crash the flag-off path was hiding: `useBibReview`'s load did
`data ?? EMPTY`, which covers a MISSING file but not one that exists without a
`requests` array (an empty `{}`, a hand-edited or half-written sidecar). Every
later `state.requests.some` then threw during render and took the pane down —
on the default path only, since the flag-ON path happened to be rebuilt by
`migrateBibReviewToUid` on its way through. Normalize the SHAPE, not just the
absence.

CI: [rename-fanout-default-build.test.tsx](../../../src/hooks/__tests__/rename-fanout-default-build.test.tsx)
(the user-facing leg — real hooks, real ProseMirror doc, the real migrators
EditorPane registers; asserts the `\cite{}` atoms rewrite top-level AND
footnote-nested, and that the annotation and the bib-review rows move, under
`describe.each` over BOTH flag settings — every flag-OFF leg fails on the
pre-fix tree),
[useCitations-cascade-rename.test.tsx](../../../src/hooks/__tests__/useCitations-cascade-rename.test.tsx)
(dispatch + the explicit PARITY leg + the punctuation citekey on both paths;
the old "the cascade was NOT invoked (flag OFF)" leg is renegotiated, not
preserved), and
[citekey-keyed-sidecars-census.test.ts](../../../src/lib/identity/__tests__/citekey-keyed-sidecars-census.test.ts)
— which now checks the manifest against the **app** half too: every `rekey`
file must name an app-side re-keyer, that re-keyer must be reached from a
`bibEntry` cascade migrator, and `useCitations.ts` must not read the flag at
all. The behavioural suite registers its own migrators and so cannot see the
EditorPane wiring being deleted; the census can.

## The gratuitous-precondition half — a lookup that serves ONE branch may not gate the others (task 697)

> **Where a call needs a value on one branch only, the branch that does not
> need it must not be gated on having it.** The value degrades; the call does
> not. And a recovery affordance may never be disabled by the very condition
> it recovers from.

`ai-requests.json` rows are keyed `(docId, kind, cardId)`. Filing a row needs
the card — `text`, `paragraphIds`, `selectedText` are read only on the
`value=true` ADD branch. **Closing** one needs nothing but the key: a drop and
a `"terminate"` both match on `(panel, cardId)` and read no context at all.
`EditorPane`'s lifecycle forwarder had always said so at its own site, in
passing: *"ctx fields are read only on the ADD path, so a placeholder is
fine."*

Five panel hooks nevertheless wrote their setter as one statement —

```ts
const card = state.cards.find((c) => c.id === id);   // for the ADD context
update(/* flip the card's flag */);
if (card) bridge({ ...card, aiRequest: value }, value, mode);   // ← the gate
```

— so a card missing from the render-time snapshot skipped the bridge call
entirely. The AI window's **Cancel** on a card-linked row is the escape hatch
for a row whose card is gone, and it was inoperative in exactly that state: no
row removed, no flag changed, no error, no feedback, and `/editor/review` kept
draining the row forever. Four earlier tasks (219 delete, 313 the unbridge
mode, 093 archive, 681 the removal-door census) exist to stop rows outliving
their cards; **when they work the button is unnecessary, and when they fail the
button is dead.** Same gate on `clearAiRequestForKind`, so archiving a card the
snapshot had lost left its row open too, and a `loadError` on any card sidecar
(empty default, `ai-requests.json` reading fine) made every Cancel in that
panel inert for the session.

The fix is the separation, stated ONCE. `bridgeFlagForCard(docId, kind, id,
value, mode, card, context)` in [src/lib/ai-request-bridge.ts](../../../src/lib/ai-request-bridge.ts)
owns the rule: card present → the caller's rich context; card absent and
`value=false` → `ABSENT_CARD_CONTEXT` (the forwarder's placeholder, now named);
card absent and `value=true` → **refused and loud**, because a row linked to a
card that does not exist is the stranded state the door exists to clear. All
seven flag-bearing kinds take that door, `useFootnotes` included — it never had
the gate, it is the shape the others were fixed INTO, and it joins so an eighth
kind cannot reintroduce the gate by copying a neighbour.

Two smaller readings of the same law came with it:

- **Ask the question you mean.** `FAMILY_CANCEL.panel` asked *"is there a
  link?"* and routed anything linked to the card path. It now asks whether the
  link **resolves** (`cardLinkResolves`, the `(kind → owning collection)`
  fan-out of `setAiRequestForKind` read as a predicate). An UNKNOWABLE card —
  a panel still loading, or one whose read ERRORED — answers `true`, so cancel
  keeps the linked path and never rewrites a sidecar it could not read.
- **A dispatcher with no `default` is a silent no-op.** `setAiRequestForKind`
  is now total: a kind with no `aiRequest` routing falls through quietly (it
  has no row), and a kind that DECLARES routing but has no case closes its row
  from the bridge directly and says so in dev.

Both CI guards that read this code by GREP had to learn the second door, and
that is the half worth remembering: `unbridge-mode-wiring-guardrail`'s
`CALL_FORMS` and `card-removal-door-census`'s `BRIDGE_DOORS`. The census's
scope gate was `src.includes("bridgeCardAiRequestFlag(")`, so three hooks
dropped silently out of scope the moment they moved to the new door — the
census would have kept passing while covering three fewer hooks. **A grep-based
guard names an implementation detail; a refactor that changes that detail
disarms the guard without failing it.** The coverage floor (`>= 11` doors) is
what caught it.

CI: `ai-request-absent-card-bridge.test.ts`,
`ai-request-cancel-absent-card.test.tsx`, `ai-window-cancel-routing.test.ts`,
`unbridge-mode-wiring-guardrail.test.ts`, `card-removal-door-census.test.ts`.

---

## The rationale half — a declaration's REASON is read by people, so check it too (task 721)

The law's usual shape is a table nobody reads. This is the mirror image: a
table that IS read, under a sentence that is not.

`CARD_REGISTRY` declared the duplicate/delete cascade permanently OFF for
`todo`, `report` and `report-request`, each row carrying the same hand-written
reason — that the kind is paragraph-anchored and carries no text-range anchor
for a walker to reach. The registry's own derivation says otherwise:
`carriesModeBAnchor` ([src/cards/mode-b-collections.ts](../../../src/cards/mode-b-collections.ts))
computes Mode-B membership from `anchored` + the crosswalk's `legacyDataKind`
and names all three among the nine. The walkers key on the MARK, never on the
flag — so the flag never described reachability; it only decided whether a
reachable kind was *served*. Duplicating a passage therefore carried its note
and silently dropped its todo and its report, and the copy lost the anchor
outright (`duplicate-slice` strips a mark whose card will not clone).

Three things kept it alive for months, and each is the lesson:

- **The rationale was copied, not derived.** Three registry rows, the
  `assertLifecycleCoverage` docblock, and the criterion test all repeated it.
  Four copies of a sentence, zero checks of it.
- **The word "permanent" closed the question.** A declaration that announces it
  is settled is the one nobody re-derives. If a value is genuinely ratified,
  the ratification belongs somewhere a test can read — task 721 put it in
  `RATIFIED_EXCEPTIONS`, a named empty list in the criterion suite, so an
  exception has to be argued in code rather than asserted in prose.
- **The guard was circular.** `lifecycle-cascade-criterion.test.ts` defined
  "walker-reachable" as `isInlineAtomCardKind(k) || lifecycle.bindAnchor` — the
  flag under test. It asked whether the declaration agreed with itself, and it
  always did. **A criterion test that reads the thing it is judging is not a
  criterion test.** It now derives reachability from the mark
  (`isInlineAtomCardKind || carriesModeBAnchor`) and pins the declaration to it
  in both directions, plus `bindAnchor === carriesModeBAnchor` exactly.

And the half that is new: **the prose is guarded too.** A Mode-B kind's own
registry row may not contain a phrase denying it has a text-range anchor
(brace-depth sliced per row, so a comment elsewhere contrasting the two modes
is unaffected). It bans the sentence, which means it also refuses a row that
QUOTES the old rationale while correcting it — deliberately: describe what a
row used to declare, don't reprint it. A correct flag under a false rationale
is one refactor away from being wrong again, because the next author reads the
sentence.

The fix itself was parity, not an exception: the three kinds now declare
`{ clone: true, delete: true, bindAnchor: true }` and are wired in
`EditorPane`'s `cardLifecycleRegistry` from doors that already existed —
`useReports.cloneReport` / `cloneRequest` / `bindAnchor` had sat published and
unreachable behind the false flag, labelled "future-proofing — dead code
today", and both deletes are the already-composed UNBRIDGING wrappers, so a
cascade delete of a flagged card closes its `ai-requests.json` row exactly as
the panel trash does. Only `useTodos.cloneTodo` had to be written.

CI: `lifecycle-cascade-criterion.test.ts` (derived criterion + the per-row
prose census), `duplicate-slice-mode-b-cascade.test.ts` (the real walker, over
every Mode-B kind), `useTodos-clone-envelope.test.ts`,
`lifecycle-coverage-assertion.test.ts`.

#### The chooser half: derived OPTIONS, hand-written ACTION

Same law at a narrower seam (task 722), and the variant worth naming on its
own: a menu whose CHOICES come from the registry and whose DISPATCH is a
literal. The user's selection is tested and then thrown away.

`CARD_REGISTRY` declares each morphing kind's target once —
`morph: { to: "report-request", lossy: true, drops: [...] }` — and validates it
hard at boot (shares the panel, reciprocated by the target, `lossy` pinned to
`drops`). Two consumers read it: the generated confirm copy
(`CARD_REGISTRY[morph.to].label`) and the `card-morphed` signal. **Nothing on
the dispatch path did.** All fifteen kind-chevrons — seven docked cards and
their eight float-chrome twins — re-derived the target as

```tsx
onKindChange={(k) => { if (k !== "report") onConvert(id, "report-request"); }}
```

a not-me test that consults the selection and a hardcoded partner that
ignores it. TypeScript could not see it: `onConvert` was typed to a per-pair
union and the handler passed a literal member of that union, never the `k` it
had just tested. The same re-derivation ran twice more in the host — the morph
`mutate` switch keyed on the FROM kind, and four per-pair adapters that
recovered the from-kind by INVERTING a data `toKind`
(`toKind === "report-request" ? "report" : "report-request"`).

No user-visible defect today, because every morphing panel holds exactly a
pair: `k !== me` and `morph.to` agree by coincidence, not by construction. The
menu, though, came from `cardKindsForPanel(panel)` — *every* kind sharing the
panel — so a third kind added to a morphing panel would appear in the menu and
morph the card to the hardcoded other one, while the confirm dialog, generated
from `morph.to`, named the correct target. A dialog that names one outcome and
performs another.

> **Where a chooser's options are derived, its action is derived from the SAME
> fact — and the selection is what travels.** A handler that binds the user's
> choice and dispatches a literal has a decorative parameter.

Both halves now read one `morph.to`, in
[card-registry.tsx](../../../src/cards/card-registry.tsx):

- `morphOptionsFor(kind)` builds the menu from the morph ROUTE (the kind plus
  its declared target), ordered by panel membership rather than defined by it.
  A third kind no route reaches is simply not offered — so an option whose
  action goes elsewhere is unrepresentable, not merely avoided. It returns the
  identical list for all eight kinds today, so no chevron changed.
- `resolveMorphTarget(fromKind, selected)` is the one door between the
  selection and the mutation, and every chevron passes `k` through to it via
  the single `CardMorphHandler` shape `(fromKind, id, toKind)`.
- `assertMorphCoverage` gained the tie: a declared `morph.to` that
  `morphOptionsFor` does not offer is a target no user can select.

The simplification is the real prize. The four inverting adapters are DELETED —
the cards pass their own spine kind, so there is nothing left to invert — and
the chokepoint's `mutate` switch keys on the RESOLVED TARGET, because the
data discriminator each per-doc hook wants (`"suggestion"`,
`"report-request"`, …) is a fact about the kind the card is BECOMING. The hooks'
own `(id, dataToKind)` signatures are untouched: they name their sidecar's
on-disk discriminator, which is not a spine kind. `WithMorphDoor<T>` in
`EditorPane` (the `WiredTodosHook` pattern) states that the hook bag's
`convertCard` IS the chokepoint, so no surface can reach the raw per-sidecar
mutation past it.

CI: `morph-target-from-registry.test.ts` — menu/route parity for every morphing
kind, and the third-kind proof done by INSTALLING a fixture kind rather than by
reasoning about one (unreachable → not offered and resolves to null; declared
as the target → offered, dispatched, and named by the confirm copy, with the
old literal's kind unreachable). `morph-chevron-dialect-census.test.ts` bans the
SHAPE at all fifteen sites: no handler compares its parameter to a card-kind
literal, and every handler passes its parameter on (the body after the arrow,
so the parameter's own declaration can't satisfy the rule — it did, and a
planted selection-dropping handler passed until the slice was tightened). A
handler may still name its OWN kind: that is the FROM argument, the same kind
the component writes in `kind="…"` two lines above. What it may not do is
decide the TARGET.

#### The forwarding half: a host re-deriving what its child already decided

Task 724 — the chooser half one layer out, and the same tell: the value the
child handed up is consulted, or never named at all, and the host answers the
question again for itself.

A card component tells its host two things — *"I was activated"* and *"jump to
me, here is my element."* `src/cards/floats/index.tsx` mounts fifteen card
bodies for the popped-out window and forwards both for ten of them. **Five
re-derived them**, and each re-derivation was wrong:

```tsx
onSelect={() => ctx.setSelectedFootnoteId(isSelected ? null : fn.footnoteId)}   // ×4
onJump={() => ctx.editorRef.current?.scrollToExample(ex.exampleId)}             // ×1
```

The first is the **C15 toggle**. `useAnchoredCard.onBodyActivate` is monotonic
by construction: it `store.select(ref)`s first, mirrors the host slot second,
and jumps only when the card was not already selected. A host slot that can say
`null` therefore reaches into the one selection authority and undoes the select
that ran three lines earlier — so the second click of a popped-out footnote,
footnote-ref, citation or example card dropped its halo and its in-text marker
highlight, and the third click, finding `wasSelected` false again, re-scrolled
the document. `body-activate-composition.test.tsx` had forbidden exactly this
since C15. It stayed green throughout, because it only ever exercised a
SYNTHETIC host. **A rule stated against a stand-in polices nothing; it has to be
read off the real call sites.**

The second drops the element `ExampleCard` resolved with `closest('[data-card]')`
— and `scrollToExample` branches on it: *with* an element it aligns the block to
the card's Y only if needed; *without* one it focuses the main editor, plants the
caret inside the example block and scrolls unconditionally. `Examples/omni.tsx`
carries a comment documenting that same drop as a defect it already fixed
(EX-F3-03). The float was the surface the fix never reached — which is the
argument for a guard rather than a sixth careful edit.

The fix makes forwarding the only representable option
(`src/cards/floats/body-contract.ts`):

- `selectMirror(slot, id)` holds the panel setter through `SelectSlot =
  (id: string) => void`. The real setters are
  `Dispatch<SetStateAction<string | null>>` and legitimately clear from
  click-away, so the narrowing is at the BODY's end of the slot, where `null` is
  never right — and the toggle stops compiling rather than stopping being
  written.
- `editorJump(ref, door, id)` names the door and the id and never the parameter,
  so the element cannot be discarded on the way through. `IdJumpDoor` is derived
  from `EditorHandle` (every `(id, sourceEl?) => void` member), not hand-listed.

CI: `float-body-contract-census.test.ts`, over every `.tsx` under `panels/`,
`cards/` and `components/editor-layout/` — R1, no card-body `onSelect`
expression can resolve to `null`; R2, every card-body `onJump` forwards its
element (a bound parameter must appear in the body AFTER the arrow; a handler
binding none may not CALL anything, since `() => {}` is the inert stand-in a
draft or unanchored card legitimately passes and `() => jump(id)` is a dropped
element). Planted in all three directions against the real tree. The type half
is pinned by a `@ts-expect-error` on `selectMirror(slot, null)`, which fails the
build if the narrowing is ever widened back.

One exemption, and it is DERIVED rather than granted: the two Errors mounts pass
`() => jump.jump(err)` because the capability they forward (`ErrorJump.jump`)
has no element parameter to put one in, and neither does the door beneath it
(`scrollToParagraphId(uuid)`) — a missing CHANNEL in another authority, not a
host recomputing its card's answer. The census reads `error-jump.ts` for that
signature, so the exemption evaporates the day the channel exists, and it is
pinned to exactly those two sites so a third element-less jump cannot borrow a
reason written for them.

## The last-writer half — a duplicate derivation OUTRANKS its owner by running later (task 725)

> **Where one derivation is implemented twice, the copy that runs LAST is the
> authority, whatever the comments say.** A second implementation does not
> merely risk drifting from the first: it silently overwrites it. And the
> owner cannot repair the damage, because a copy that writes only ATTRIBUTES
> trips no structural gate — so the wrong answer STANDS.

A footnote's number is a derivation over the document's footnotes in order,
with one subtlety: a `\thanks` is a title-page acknowledgement, renders `A`,
and therefore takes `number: 0` and does **not** step the counter. That rule
was written four times:

1. `latex-parser.ts` `numberFootnotes` — the **load-time** pass. Thanks-blind.
2. `lib/tiptap/footnote.ts` `appendTransaction` — the live numberer. Correct.
3. `lib/tiptap/footnote.ts`, the typed-`\footnote{}` input rule. Correct.
4. `Editor.tsx` `EditorHandle.renumberFootnotes`. Thanks-blind, undoable, no
   equality bail — and its two callers ran it *after* `insertInlineAtom`'s
   dispatch, i.e. after (2) had already numbered the same transaction right.

Three things this cost, each of which points somewhere other than the copy:

- **The reader saw it at LOAD, not at edit.** The editor is constructed with
  `content: initialContent`, and that is **not a transaction** — so (2) never
  runs at mount and whatever (1) wrote is what the paper displays. In any
  imported paper with an author note, the thanks ate slot 1 while rendering
  `A`, so *every* footnote after it showed one too high the moment the file
  opened. The acknowledgement's own corrupted number is invisible by
  construction, which is exactly why this hid.
- **The owner could not heal it.** The live numberer's gate is
  `added / removed / order-changed`; an attr-only renumber trips none of them.
  A wrong number therefore persisted until the user added or deleted a
  footnote — the repair mechanism was blind to the damage.
- **Running last is not a detail.** (4) was written as a *helper*, and the
  helper became the authority purely by call order. Nothing at either call
  site said so.

**The fix is not to make the copies agree.** Teaching (1) and (4) the `\thanks`
rule would leave the next change to be made in four places, which is how the
rule got three spellings in the first place. The derivation moved to one owner,
`src/lib/footnote-numbering.ts` — `footnoteNumbersFor` (the pure rule) and
`writeFootnoteNumbers` (the rule + the position-stability and equality-bail
properties every transaction caller needs) — (1), (2) and (3) call it, and (4)
is **deleted**, interface member included, so the door cannot be reopened by a
future caller reaching for a name that is still there.

**Guard:** `footnote-number-authority.test.ts`, against the real tree, in three
rules — R2 no module outside the owner writes a footnote `number` through
`setNodeMarkup`; R3 none steps a counter into a `number` field; R4 any module
that *computes* a footnote number must IMPORT the owner (the rule that keeps
the parser honest: it may write numbers, but only ones the owner handed it).
All three are planted in both directions, and each of the three deleted copies
is verified to trip them. Behaviour is pinned separately by
`footnote-thanks-numbering.test.ts`, whose load-time leg fails on HEAD~.

**Corollary worth carrying:** when a helper's value is "make sure it's right
after I changed something", check whether the owner already ran inside the same
transaction. If it did, the helper is not a safety net — it is a second writer
with worse information.

---

## The retirement half (task 726)

> **A mechanism does not die when its last caller goes away — it dies when
> someone says so, in a place CI reads.** A layer nothing runs stays perfectly
> self-consistent: it type-checks, it keeps its tests, and its comments go on
> describing a feature in confident plain English. The rationale is the thing
> that gets read, so a dead layer is not neutral — it actively teaches the next
> reader something false.

The `example` card kind carried a card-level metadata layer declared in five
places and wired in none:

1. `src/hooks/useExamples.ts` — a complete per-doc sidecar hook (read, migrate,
   merged write, `updateExampleTitle`, `deleteExample`) whose only occurrence of
   `useExamples(` anywhere in `src/` or `library/` was its own definition.
2. `sidecar-value.ts` declared `examples.json` `mount: true` — "the doc-mount
   bundle pre-reads this, because a hook owns it". None did.
3. `sidecar-merge.ts` held its record-merge rule, and `host-writability.ts`
   mapped `example → "examples.json"`, both for a file no production module
   opened.
4. `CARD_REGISTRY.example` declared `textFields: ["title"]` under a comment
   asserting a "panel-only display title". `ExampleCard.tsx` has never contained
   the string `title`.
5. The Python skill side refused to write `examples.json` with a rationale
   naming `useExamples.syncFromEditor` — a function deleted two tasks earlier.

**What made it durable is more interesting than what made it dead.** Task 570
deleted this hook's editor-derived *reconcile* on exactly the right ground, and
wrote "WIRE-it-or-DELETE-it" into `load-time-reconcile-census.test.ts`. It left
the hook standing. The lesson was recorded; what it could not do was **fail**.
And the phantom was load-bearing in the one way that matters: `assertContentCoverage`
refuses a kind with neither `bodyField` nor `textFields`, so `example` passed the
boot guard **on the strength of a field that does not exist**. Delete the phantom
and the guard fires — which is why a dead declaration nobody can remove without
breaking CI is worse than one nobody reads.

**Two lists became derivations, and one absence became a declaration.**

- `assertContentCoverage` used a three-name `allowedNull` hand-list. The harm a
  content model prevents is a card-level DELETE destroying typed text, so the
  permission now derives from the thing that causes the harm:
  `lifecycle.delete === false` (no delete → nothing for a confirm to guard),
  which covers `bib`, `error` and now `example`. Exactly one **granted**
  exemption survives, `highlight` — it does delete, and legitimately without a
  confirm, because it is a colour over a range. `CONFIRMLESS_BY_GRANT` is
  exported so the suite reads the same value the boot guard does, and a leg
  fails if the grant ever names a kind the derivation already covers (a no-op
  hiding in a list that should hold only real exemptions).
- `SIDECAR_VALUE` gained a `legacy?: true` column. A retired sidecar keeps its
  row for ONE reason — the conflict scanner's base vocabulary is the whole
  table, so a `examples (conflicted copy …).json` a folder already holds stays
  recognisable — and `legacy` says that out loud. `SIDECAR_COLLECTIONS`'s
  totality leg now subtracts legacy rows itself, so retiring the next sidecar is
  a one-word diff instead of three silent deletions across three tables, and a
  legacy row that *keeps* a merge rule fails.
- `ExampleCard` builds its own body rather than going through `EditableCard`,
  the one place that resolves `bodySchema` — so its two `BorrowedMainText`
  mounts took that component's hardcoded `"card"` default and agreed with
  `CARD_REGISTRY.example.bodySchema` **by coincidence**. They read the registry
  now. A facet nothing reads is not an SSOT, even when it happens to be right.

**Guard:** `sidecar-hook-caller-census.test.ts`, against the real tree, in three
rules — R1 a per-doc sidecar hook (one whose code reaches `readSidecar` /
`writeSidecarMerged` / `mutateSidecar` / `usePersistentState`) must have a
production CALLER; R2 a `mount: true` row must be SPELLED by some production
module other than the four SSOT tables; R3 a `legacy` row is `mount: false` and
spelled by nothing. All three planted in the falsifying direction (a synthetic
caller-less hook; `examples.json` flipped back to `mount: true`; the retired
name re-spelled in a production module), each verified to fail. R1's one
allowlist — the two hooks consumed by other hooks — is itself checked in the
falsifying direction, so it can never excuse a dead one.

**Corollary worth carrying:** when a deletion makes a guard fire, ask whether
the guard was measuring the right thing. Here it was not — it asked "does this
kind name a field?" when the question is "can this kind delete typed text?" A
phantom that satisfies a proxy is the proxy's fault as much as the phantom's.

## The copy half — a SENTENCE is a reader too, and it never re-reads (task 727)

> **User-facing copy that states a fact a registry owns is a second copy of that
> fact, and it is the copy nothing updates.** A panel does not know how its cards
> are made. The registry knows. The panel knows the NOUN.

The Examples panel's empty state — the first thing anyone reads about examples —
said: *"No examples. Click the `(1)` glyph in the formatting toolbar to insert
one."* There is no `(1)` glyph. There is no glyph: the MenuBar's example controls
were retired, and a repo-wide search for the literal found the panel's sentence,
`STYLE_GUIDE.md` quoting that sentence as the MODEL of a good empty state, and
`panel-empty-state-contract.test.ts` quoting it in a failure message. Three
copies of one lie, and a new user following it exactly produced nothing.

The two live ways to make an example were declared one file over the whole time
(`surfaces: { slash: true, lightning: true }`, `slashName: "ex"`), and
`assertActionCoverage` reconciles that `slashName` against the live
`VIRGIL_COMMANDS` in both directions. So the truth was not hard to reach — it
was simply never asked for.

**Why the existing guard could not see it, and why that reason was wrong.**
`panel-empty-state-contract.test.ts` pinned that an empty state "names what's
missing and teaches the way in", and its own header conceded the limit in
plain words: *"A regex pins the SHAPE of a how-to; only a reader pins whether it
is honest."* It wrote that after Outline shipped the same defect ("use the
Section dropdown in the toolbar" — a control that did not exist), and it was
read as a limit for another release. The limit was never "a test cannot know the
truth". It was **"a sentence cannot, because it is a copy."** Replace the copy
with a projection and truth stops being a property a reader has to check.

**The three-way split this lands.** Every empty state now states each fact from
whoever holds it:

| fact | owner | how |
| --- | --- | --- |
| the NOUN ("No examples yet.") | the panel | ordinary copy |
| the ROUTE | `VIRGIL_ACTION_REGISTRY` | `creationRoutesFor(id)` → `<CreationHint action="…" />` |
| the "+" | `CardListPanel` | `PanelAddProvider`, fed by the button it is about to render |

The third is not decoration, and it is the half that generalises the lesson past
strings: `ExamplesPanel` also declared an `onAdd` prop that **no host has ever
passed**, so the header "+" it existed to paint was never painted. A panel
asserting *"click + to create one"* is asserting a control it does not know it
has — the same defect as the glyph, one control over. A panel can no longer
claim a "+" at all; it asks. `<CreationHint action>` is typed `ActionId`, so the
link to the registry is a COMPILE-TIME one: retire the row and the panel stops
building. There is no spelling of a surface left for a stale string to live in.

**Two derivation rules worth keeping.** (1) The ⚡ margin menu and a block's grab
bar are two triggers on one `ActionsMenuPanel` body, so naming both is naming one
route twice — the first surface a row declares wins. (2) Two clauses maximum: a
sentence listing four ways in is a list, not an instruction.

**Guards.** `creation-routes.test.ts` pins the derivation (including that every
`\name` the copy can print is a live `VIRGIL_COMMAND_NAMES` entry, and that
dropping a surface flag drops its clause). `creation-hint-add-affordance.test.tsx`
drives the REAL `CardListPanel` with and without an `onAdd` and reads the
rendered sentence. And leg 5 of `panel-empty-state-contract.test.ts` asks the
question the header said no census could — **not** "is this sentence true?" but
**"where did it come from?"**: an empty state that names a toolbar, a glyph, a
dropdown, a button, a `\command` or a "+" without deriving it fails, with all
three historical sentences planted and verified failing on the real tree. Two
stated limits: it sees a named CONTROL, never a paraphrase (Bibliography's "add
citations in the editor" is out of reach, and is deliberately unconverted because
that panel's "+" makes something else), and the derivation's own honesty is the
registry's problem, pinned one file over.

**The generalisation, for the next one.** The rule is task 306's ("a panel's
add-menu derives its card-type LABELS from the registry") one column over: label
then, ROUTE now. Same class. Before writing a sentence that tells a user where a
control is, ask which table already knows — and if one does, the sentence is not
copy, it is a view.

## The half-generalized half — a CSS selector is a declaration, and it has no producer (task 730)

> **A rule written for N kinds while only ONE kind can satisfy it is not a
> generalization — it is a claim no reader can check.** Where a behaviour's
> CONSUMER is widened to a family and its PRODUCER stays per-kind, the widened
> consumer reads as evidence that the family is wired, and the missing kind is
> invisible at every site a maintainer would look.

`.is-popped` dims a source pod and takes it out of the pointer path while its
float is open — the one thing keeping a pod's two surfaces from both being live
over a single `source` attr. Task 384 generalized the CSS to
`:is(.tex-block, .forest-block).is-popped .source-pod { opacity:.45;
pointer-events:none }`. Nothing generalized the producer:

- The predicate was a ref, `texBlockIsPoppedRef`, named per-KIND at every hop —
  `EditorPane` → `Editor` prop → `EditorExtensionsCtx` → `TexBlock.configure` →
  `TexBlockOptions.isPoppedRef` → `SourcePodConfig.isPopped`. Six declarations,
  one kind.
- So `forestBlock` — the pod's other wearer, the one the CSS had just been
  widened for — never got the class. Its docked pod stayed fully opaque and
  fully editable beside its float.
- A grep for `isPopped` in `ForestBlockNodeView.tsx` returned nothing, and the
  CSS said the opposite. The comment that *did* state the gap sat in a third
  file.

**The shape of the fix: delete the thread, don't fork it.** A per-kind thread
cannot be extended to a second kind without becoming two threads, and the
question it carries — "is there an open float for this block?" — was never a
fact any NodeView owned. It is a fact about the FLOAT STORE, and the float key
grammar (`float:<domain>:<kind>:<id>`) already names both halves of the answer.
So the shared pod asks the store directly, from the node's own `(kind, uuid)`:
`useIsFloatPopped` ([src/hooks/usePoppedCards.ts](../../../src/hooks/usePoppedCards.ts))
over `poppedKeysHoldFloat` ([src/floats/float-key.ts](../../../src/floats/float-key.ts)),
a dual-read that compares PARSED keys so the canonical, pre-flip and pre-D10
spellings answer alike. All six per-kind declarations are gone; a third
pod-bearing kind inherits the dimming with nothing added anywhere.

Two things fell out that the thread had been hiding:

- **The ref was never reactive.** A predicate ref read during render subscribes
  to nothing; `texBlock`'s pod re-rendered on the float toggle only because
  something else in the tree happened to. The context hook re-renders on the
  store, which is what the chrome always claimed to do.
- **`TEX_POD_CONFIG` could finally become a constant**
  ([src/lib/tiptap/tex-pod-config.ts](../../../src/lib/tiptap/tex-pod-config.ts)).
  Its `isPopped` field was the only per-render value in it, which is why
  `texBlock` alone spelled its pod config as an inline literal at the NodeView —
  the exact thing `FOREST_POD_CONFIG`'s own docstring warns against (the pod
  memoizes on the config). The half-generalized producer had been forcing a
  second, worse spelling of the sibling it was supposed to match.

**Guard:** `src/floats/__tests__/popped-keys-hold-float.test.ts` (the predicate,
every grammar, falsifying twins on both halves of the key) and
`src/components/__tests__/source-pod-popped-dim.test.tsx` (both wearers get the
class from the store, neither gets it from someone else's float). The second
suite fails on pre-730 code in exactly the forest leg.

**Residual, pinned rather than assumed:** the float body's write-back is a
whole-buffer replace from local state, so a second live writer WOULD clobber.
What makes that unreachable is not only the dim but the float's re-read of its
node on any foreign transaction touching its source (`useMainTransactionSync` →
`syncFromMain`) — a convergence the float body's own source doesn't show, since
it contains no `useEffect`. `src/components/__tests__/source-pod-float-no-clobber.test.tsx`
pins it, so the second line of defence can't be removed on the strength of the
first.

---

## Task 733 — an SSOT with two readers, and the third surface that needed it most

`surfaceIsEditable` ([src/lib/tiptap/surface-editable.ts](../../../src/lib/tiptap/surface-editable.ts))
was written to end a bug class, and its own header names the class: on MAIN,
`view.editable` is a **lie** whenever the host mounted the pane read-only,
because `Editor.tsx` pins `view.editable = true` for the view's entire lifetime
(PM's `contenteditable="false"` broke selection routing in the Library Reader)
and carries the user-facing answer in `editableRef`. Task 524 found it for the
atom grab, 579 for the spellchecker, and the door exists so a third finder would
not have to.

It had exactly **two readers** — `spellcheck-decorator.ts` and
`inline-atom-grab.ts` — and neither was the grab bar, the surface carrying
Archive, Delete and Duplicate. In the Library Reader the handle renders (its
only gate is `editor.isEditable`, the flag the Reader deliberately pins true),
the menu opens, every row reads enabled, and the destructive confirm fires:
`cleanupAndComputeDeleteRange` runs each anchored card's lifecycle `delete` and
the anchor retarget, and *then* dispatches a transaction `readOnlyEnforcer`
drops on the floor. The paragraph stays; its footnote and citation cards leave
the panels until reload. (Not durable — `isSidecarWriteAllowed` and
`libraryPaperWriteAllowed` refuse the disk writes — but a silent no-op plus
phantom panel loss all the same.)

**Why it had only two readers, and the remedy.** The predicate needs the
`editableRef` HANDED to it, which only a surface BUILT with it can do; both
readers are plugins that get it as an extension option. Every other affordance
holds an `Editor` or a bare `EditorView` and nothing else, so each one spelled
the question privately as `editor.isEditable` / `!view.editable` — the very
copies the SSOT exists to prevent. A prop drilled through every menu would have
been a fifth copy. Instead **the editor publishes the answer**: `readOnlyEnforcer`
(main-only) exposes the ref it already enforces on as its extension STORAGE, and
`surfaceEditableNow(target)` reads it from an `Editor`, or from a bare view via
`owningEditor` (task 642's back-pointer). A surface with no enforcer — a card
body, a float, a raw PM harness — publishes nothing, resolves `null`, and is
answered by `view.editable` alone, which is honest there. So the conversion is a
no-op everywhere except the surface that was lying.

**The caller audit, and the rule it yields.** `collabReadOnly` is `!view.editable`
— the PEN axis, a constant `false` on MAIN. Each caller was asked one question:
*can this seam's mutation escape `filterTransaction`?*

- **Moved to `surfaceEditableNow`** — the seams with a half ProseMirror cannot
  filter (a sidecar write, a card registration, a lifecycle `delete`, a second
  document): the grab/lightning card dispatcher, `drop-mode/commit-seam.ts`,
  `drop-mode/hit-test.ts`. The `ActionContext.canEdit` suppliers move with them
  (`DragHandleMenu`, `ActionsMenuPanel`, `MenuBar`, the actions bridge), so the
  rows GREY from the same question the seam REFUSES on.
- **Kept on `collabReadOnly`** — the pure-PM seams, where the enforcer is the
  real backstop and a constant gate costs a dropped transaction, never a
  stranded card: the typed-LaTeX input rules, `insert-inline-atom.ts`, and
  `RichTextField.tsx` (a card body, where `view.editable` is honest).

**Reader-writable kinds.** `READER_CHROME.editableCardKinds` permits notes, so
the note row could in principle have stayed enabled. It greys with the rest: a
note created from the grab bar lands a Mode-B `linkedAnchor` MARK, which is
itself a `docChanged` transaction the enforcer refuses — an enabled note row is
another dead affordance.

**One tolerance, stated.** `surfaceEditableNow` treats a view that does not MODEL
`editable` (a hand-built harness view, a foreign embed) as editable rather than
read-only, matching the no-over-gating default every absent answer in this app
takes (`ActionContext.canEdit`: absent ⇒ editable). Every real ProseMirror view
sets the flag, so the SSOT answers each production call.

**Guard:** `src/components/editor-layout/card-actions/__tests__/host-read-only-grab-surface.test.tsx`
builds the state no sibling suite could express — `view.editable === true` AND
`editableRef.current === false` — and holds the door, the greying, and the
ORDERING claim (`archive`/`delete` stop before the confirm, the anchored-card
cleanup and the anchor retarget, which "the doc is unchanged" alone cannot
make, since the enforcer produces that outcome anyway while every irreversible
side effect still runs). Twelve of its legs fail when either gate is reverted.
