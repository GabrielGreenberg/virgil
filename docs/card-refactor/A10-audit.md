# A10-audit — Cross-cutting integrations (AI requests, collab, theming, persistence)

> Read-only audit + design for the **A10** Wave-2 arena of the card-system refactor.
> Scope is the four integrations that thread through *all* card kinds rather than
> living in any one panel: the **AI-request bridge** (+ the ephemeral `ai` card),
> **collab focus-claims** (docked + the new float chrome), **theming** (`themeFromAccent`
> + the hardcoded `aiRequest`/`error` accents), and **persistence integrity** (the safe
> debounced/stale-rejected write path for every card-bearing pref/sidecar).
>
> This chip **consumes** the landed foundations (A0 `CARD_REGISTRY` at `src/cards/`,
> AF `src/floats/` + `CardChromeTrailing`). It proposes registry-derived,
> single-accent shapes for the cross-cutting glue and never merges the two kinds.
>
> Re-pinned against **`HEAD = 588ae7e`** on 2026-06-09 (the SSOT and the Wave-1
> audits were written against `d1b3ee3`/`486a462`/`e7b7630` — every `file:line`
> below is re-verified against the current tree; corrections in the final §).

---

## 0. TL;DR

- **All four A10 surfaces already ride the *safe* paths and respect keystroke sanctity.**
  No arena file has an `editor.on('update'|'transaction')` subscriber; collab is
  interval-polled (`COLLAB_TIMINGS.pollMs`/`cardHeartbeatMs`/`penStaleMs`, never
  keystroke-bound); the AI-request bridge is async fire-and-forget; `panel-theme.ts`
  is a `localStorage` subscription store; `usePersistentState` debounces writes and
  rejects stale-pipeline writes. **A10 is a coherence/registry-derivation arena, not
  a bug-fix arena.**

- **Theming — the one real inconsistency §8 calls out is live and small.** Exactly two
  accents are hardcoded as string literals instead of derived from a registry token:
  `CARD_THEMES.aiRequest: themeFromAccent("#0ea5e9")` and
  `CARD_THEMES.error: themeFromAccent("#b45757")` (`panel-primitives.tsx:230-231`).
  `PanelThemeKey`/`DEFAULT_PANEL_COLORS` (`panel-theme.ts:14-25`,
  `panel-theme.defaults.json`) deliberately **omit** `ai`/`error` (they are
  non-user-customizable). **But the hardcoding runs deeper than the accent**: the
  `ai` and `error` *card bodies* paint with literal Tailwind `sky-*` / `red-*`
  classes that bypass `theme` entirely (`AiRequestCard` `panel-primitives.tsx:2021-2074`;
  `ErrorCard.tsx`). The deep fix is **one system-accent namespace in the JSON
  sidecar** (`ai`/`error` become `DEFAULT_PANEL_COLORS` entries marked non-overridable),
  so `themeFromAccent` is the *only* path and the card bodies consume `theme.*`
  tokens — no string-literal accent, no literal Tailwind color, anywhere.

- **Collab is already registry-blind and consistent docked↔float — but keyed on a
  *fourth* hand-maintained token namespace.** Claims/selections key on
  `(panelKey, cardId)` where `panelKey` is the **PanelThemeKey-style visual token**
  (`"note"`, `"cut"`, `"revision"`, `"report"`, `"footnote"`, `"archive"`), *not* the
  `CardKind` and *not* the panel folder-id. Docked cards pass it as a string literal
  (`useCardClaim("cut", …)`, `panelKey="revision"`); the float side re-types the
  identical literals in `collabTrailing("cut", id)` etc. (`cards/floats/index.tsx`).
  The 7 collab cards (note, footnote, archive, report, report-request, revision-comment,
  cutter-comment) match docked↔float **by hand** — drift here is silent (a typo'd
  `panelKey` splits a card's claim across two namespaces with no type error). The deep
  fix: derive the collab claim-scope token from `CARD_REGISTRY` (the existing
  `themeKey`, which is exactly this token) so docked and float read **one** source.

- **AI requests cross *three* more hand-kept enums.** `AiRequestKind` (8:
  `footnote|note|highlight|citation|todo|suggestion|report|style-merge`,
  `types.ts:208`), `AiRequestLink["panel"]` (5 folder-ids:
  `notes|todos|cutter|revisions|reports`, `types.ts:236`), and `PANEL_TO_KIND`
  (`ai-request-bridge.ts:37`) each re-encode a card→request slice with their own
  tokens (`suggestion`, the folder-ids). None is registry-derived; the bridge runs
  in 5 per-panel hooks (`useNotes`/`useCutter`/`useRevisions`/`useReports`/`useTodos`)
  that hand-write the `panel` literal. The `ai` *card* (the request surface) stays
  poppable (ratified) — its `toFloatable` is registered (`cards/floats/index.tsx:469`),
  resolving `float:card:ai:<id>` via the same SSOT key builder as every other card.

- **Persistence is sound and already no-silent-data-loss — but split across three
  stores with three different safety models.** Card sidecars (notes/cutter/revisions/
  reports/todos/ai-requests) → `usePersistentState`/`writeSidecar` (debounced +
  stale-pipeline-rejected + per-file enqueue). Collab → `writeSidecar` directly
  (read-modify-write under a single chain, stale-rejected). **Float state**
  (`poppedOutCards` + `cardFloatPositions`, the AF key grammar) → **`localStorage`,
  window-scoped, NOT through `usePersistentState`** (`useViewPrefs.ts`). Panel colors
  → `localStorage` (`virgil-panel-colors`). The AF float-key migration **does**
  rewrite both float maps in lockstep (read-time `migrateFloatKeys` at
  `useViewPrefs.ts:462`; morph-time `remapCardPopKey`→`migratePoppedOutCards` at
  `EditorLayout.tsx:931`/`:1401`) — verified data-loss-safe. A10's job is to **audit
  that every card-key/schema change rides one of these safe paths**, not to unify the
  stores (different scopes justify different homes).

- **Net:** A10's deep fix is *not* a rewrite — it's **collapsing four cross-cutting
  hand-kept token namespaces (collab `panelKey`, theme accent literals,
  `AiRequestKind`/`AiRequestLink.panel`/`PANEL_TO_KIND`) onto `CARD_REGISTRY`**, so
  the registry is the single place a card's collab-scope, accent, and request-routing
  are defined — and the docked vs float vs bridge consumers read it, never re-type it.

---

## 1. Current reality (code-derived, EXACT file:line)

### 1.1 AI requests — the bridge + the ephemeral `ai` card

- **The bridge.** `bridgeCardAiRequestFlag(docId, link, value, ctx)`
  (`src/lib/ai-request-bridge.ts:69`) collapses per-card `aiRequest: boolean` flags into
  the unified `ai-requests.json` queue. Reads/writes the sidecar via
  `readSidecar`/`writeSidecar` (`:20`), gated on `getActiveHandle(docId)` (`:76`) and
  swallowing `isStalePipelineError` (`:133`). Best-effort: errors logged, not thrown
  (the card flag is the panel SSOT; the queue self-heals on next toggle).
- **`PANEL_TO_KIND`** (`ai-request-bridge.ts:37-43`) maps the 5 request-bearing panel
  folder-ids → a default `AiRequestKind`:
  `notes→note, todos→todo, cutter→suggestion, revisions→suggestion, reports→report`.
  Overridable per-call via `ctx.kind` (used so the Notes panel files `highlight`
  requests distinct from `note`, `useNotes.ts:269`).
- **Bridge call sites (5 per-panel hooks, NOT the float):**
  `useNotes.ts:238` (note) + `:264` (highlight), `useTodos.ts:91`, `useCutter.ts:308`,
  `useRevisions.ts:273`, `useReports.ts:242`. Each hand-writes the `panel` literal
  (`{ panel: "notes", cardId }`, etc.). **Because the bridge lives in the data hooks,
  it fires identically whether the card is docked or floated** — the float's
  `onSetAiRequest`/`setXAiRequest` callback is the same hook-owned function threaded
  through `CardFloatCtx`. No float-specific AI-request path exists (correct).
- **The `ai` card (the request surface).** `AiRequestCard`
  (`panel-primitives.tsx:1980`+) renders an `AiRequest` from the queue. Builds its
  popout key `const popKey = cardPopKey("ai", request.id)` (`:1980`) → `float:card:ai:<id>`,
  stamps `data-card-key={popKey}` (`:2008`). Registered poppable at
  `cards/floats/index.tsx:469` as `bareWindow: true` (bespoke in-body header until
  AF Stage 6). Theme: `const theme = CARD_THEMES.aiRequest` (`:2000`) — but see §2.1:
  the body paints with literal `sky-*` classes, not `theme`.
- **Three parallel kind/panel enums (none registry-derived):** `AiRequestKind`
  (`types.ts:208-216`, uses `suggestion`/`style-merge`), `AiRequestLink["panel"]`
  (`types.ts:235-238`, 5 folder-ids), `AI_REQUEST_KIND_LABEL`
  (`panel-primitives.tsx:1939`).

### 1.2 Collab — focus-claims (docked + the AF float chrome)

- **The hook.** `useCollab(docId)` (`src/hooks/useCollab.ts:141`). All mutations route
  through `mutate()` (`:174`) — read-modify-write under a single in-flight chain,
  re-reading disk via `readSidecar` then `mergeKeepingSelf` (`:197`) before
  `writeSidecar(handle, COLLAB_SIDECAR_FILE, next)` (`:205`), stale-rejected (`:207`).
  Handle resolved lazily (`getActiveHandle(id) ?? beginDocPipeline(id)`, `:189`).
- **Claim/selection API (keyed `(panelKind, cardId)`):**
  `claimCard(panelKind, cardId)` (`:462`), `releaseClaim()` (`:481`),
  `getCardClaim(panelKind, cardId)` (`:613`), `updateSelection(cards[])` (`:491`),
  `getCardSelections(panelKind, cardId)` (`:524`). Plus paragraph-cursor presence
  (`updateCursorParagraph` `:510`, `getCursorSelections` `:546`). Soft-selection
  de-dupes by `${panelKind}:${cardId}` serialization (`:497`).
- **`useCardClaim(panelKind, cardId)`** (`:699`) — the per-card helper every card
  consumes: returns `{ partnerClaim, claim, release }`, all scoped to
  `(panelKind, cardId)`. **`panelKind` is a free `string`** (`:700`).
- **The `panelKey` token is the PanelThemeKey-style visual token, hand-passed:**
  - Docked, via `EditableCard`→`CardClaimContext`: `panelKey="note"` (`NoteCard.tsx:132`),
    `"footnote"` (`FootnoteCard.tsx:139,217`), `"archive"` (`ArchiveCard.tsx:102`),
    `"report"` (`ReportCard.tsx:109`, `ReportRequestCard.tsx:116`), `"revision"`
    (`RevisionCommentCard.tsx:148`).
  - Docked, direct: `useCardClaim("cut", card.id)` (`CutterCommentCard.tsx:87`) +
    `getCardSelections("cut", card.id)` (`:89`).
  - **Float, via AF chrome:** `collabTrailing(panelKey, id)`
    (`cards/floats/index.tsx:92`) builds `<CardChromeTrailing panelKey={…} cardId={id}/>`,
    called with `"note"` (`:101`), `"footnote"` (`:154`), `"archive"` (`:180`),
    `"cut"` (`:207`), `"report"` (`:256,:281`), `"revision"` (`:403`).
- **`CardChromeTrailing`** (`panel-primitives.tsx:78`) is the AF-Session-6 extraction:
  it calls `useCardClaim(panelKey, cardId)` (`:87`) + `getCardSelections` (`:90`),
  renders the claim pill / presence dots, and **hosts its own
  `CardClaimContext.Provider`** (`:93`) so deeply-nested inputs (e.g. a title input
  rendered as a chrome slot) attach to the same claim. `FloatChrome` renders it
  blindly as the opaque `trailing` node (`FloatChrome.tsx:85`; `FloatWindow.tsx:164`).
- **The 7 collab cards** (those that render a claim pill / call `useCardClaim`): note,
  footnote, archive, report, report-request, revision-comment, cutter-comment.
  Float `collabTrailing` covers exactly these 7 (note/footnote/archive/cut/report×2/
  revision). **The docked↔float `panelKey` literals match for all 7** (verified
  pairwise). highlight/citation/example/todo/bib/ai/revision-suggestion/
  cutter-suggestion are *not* claim-bearing (highlight/citation/example are
  derived-or-read-mostly; suggestions have their own trailing; bib/ai are system).
- **Docked `EditableCard` trailing** (`panel-primitives.tsx:835-854`) mirrors
  `CardChromeTrailing`: per-card slot + claim-pill/presence + three-dot menu, wrapped
  in `CardClaimContext.Provider` (`:857`). So claim chrome is authored **twice** —
  once for docked (inside `EditableCard`), once for float (`CardChromeTrailing`).

### 1.3 Theming (§8)

- **The accent-derivation engine** (`src/lib/panel-theme.ts`): `themeFromAccent(accent)`
  (`:211`) → `{ accent, ...deriveCardPalette(accent) }`; `deriveCardPalette` (`:176`),
  `deriveMarkerPalette` (`:193`). One accent hex → full card palette (header tints,
  badge, border, title) + marker palette. **This is the canonical single-accent path
  §8 mandates, and it already works for every user-customizable kind.**
- **`PanelThemeKey`** (`:14-25`) — 11 tokens: `citation, bib, footnote, note, highlight,
  archive, todo, cut, revision, report, example`. **`ai` and `error` are deliberately
  absent** (non-customizable). `DEFAULT_PANEL_COLORS` (`:32`) loads from
  `panel-theme.defaults.json` (11 entries, same set).
- **The override store** (`:215-290`): `localStorage` key `virgil-panel-colors`,
  `getPanelColor`/`setPanelColor`/`clearPanelColor`, `subscribePanelColors` +
  `getPanelColorVersion` for `useSyncExternalStore`. Hex-validated on load/set.
- **`CARD_THEMES`** (`panel-primitives.tsx:212-239`): 13 themes, all
  `themeFromAccent(DEFAULT_PANEL_COLORS.<key>)` **except the two hardcoded literals**:
  ```
  aiRequest: themeFromAccent("#0ea5e9"),  // sky      (:230)
  error:     themeFromAccent("#b45757"),  // rust      (:231)
  ```
  Plus a `comment` alias (`themeFromAccent(DEFAULT_PANEL_COLORS.revision)`, `:226`)
  kept for legacy code paths. `cut`/`report`/`example` map both their kinds to one
  panel accent (correct, ratified).
- **The deeper hardcoding (literal Tailwind, bypasses `theme`):**
  - `AiRequestCard` body: `text-sky-500` (`:2021`), `text-sky-800` (`:2033`),
    `bg-sky-400` (`:2036`), `text-sky-600` (`:2035`), `border-sky-200/70` (`:2071`),
    `bg-sky-50/20` (`:2074`). Only `theme.headerDefault` is consumed (`:2017`).
  - `ErrorCard.tsx`: `const theme = CARD_THEMES.error` (`:15`) is consumed for
    `titleColor`, but the card also carries a local `warning: "#b45757"` literal
    (`:19`) and `popKey`/`toggleAtAnchor` dead popout wiring (`:11,:107,:110`).
- **Other `CARD_THEMES[…]` consumers** (must stay stable through any refactor):
  `SearchPanel.tsx:727` (`CARD_THEMES[SCOPE_TO_CARD_THEME[result.scope]]` — a
  search-scope→theme indirection), `ErrorCard.tsx:15`, `panel-primitives.tsx:2000`.

### 1.4 Persistence integrity (§8)

- **`usePersistentState`** (`src/hooks/usePersistentState.ts:74`) — the safe path for
  every card *sidecar*: debounced writes (default 300ms, `:80`,`:188`), flush-on-unmount
  /docId-change (`:166`,`:207`), `hasMutatedRef` guard against a late load stomping a
  user edit (`:98`,`:130`), live handle resolved per-write (`:108`), stale-pipeline
  rejection swallowed (`:155`), per-file serialization inside `writeSidecar`.
- **Card-bearing sidecars on this path:** notes, todos, cutter, revisions, reports,
  ai-requests, citations, examples, archive (each per-panel hook calls
  `usePersistentState(docId, "<panel>.json", …)`). **All card mutations + the
  AI-request queue go through the safe path** (the bridge's direct `writeSidecar` is
  the same storage layer, stale-rejected).
- **Collab sidecar** (`useCollab.ts`) — `writeSidecar` directly (not
  `usePersistentState`, because of its read-modify-write merge semantics), but **same
  safety guarantees**: per-file enqueue + stale rejection + the `mergeKeepingSelf`
  anti-clobber.
- **Float state** (`poppedOutCards`, `cardFloatPositions`) — `localStorage`,
  **window-scoped** (NOT in `GLOBAL_PREF_KEYS`, `useViewPrefs.ts:220-243`), so each
  browser window keeps its own float layout. **The AF float-key migration is
  data-loss-safe:**
  - read-time leg: `migrateFloatKeys(poppedOutCards, cardFloatPositions, …)` rewrites
    **both maps in lockstep** (`useViewPrefs.ts:462-472`); `selection:`/`sel:` keys
    dropped with a `console.warn` (`:473`).
  - morph-time leg: `remapCardPopKey(oldKey, newKey)` (`EditorLayout.tsx:931`) →
    `migratePoppedOutCards` (`useViewPrefs.ts:1401`) → `migrateFloatKeys` (both maps).
    Driven from `convertRevisionCard` (`EditorPane.tsx:800`), threaded via the
    augmented `revisionsHook` (`:814`) so the remap fires from every morph trigger.
  - reader variant: `reader-view-prefs.ts:160` has a matching `remapCardPopKey`
    (read-only library context; no-op-safe).
- **Panel colors** — `localStorage` (`virgil-panel-colors`), validated, subscription-
  backed. No migration needed (token set is stable; `ai`/`error` never persisted).

---

## 2. Warts / fragmentation / gaps catalog

### 2.1 Hardcoded `aiRequest`/`error` accents — the §8 inconsistency, plus literal-Tailwind bodies *(headline)*
- **WHAT:** Two of 13 `CARD_THEMES` are seeded from string-literal hexes
  (`themeFromAccent("#0ea5e9")`/`("#b45757")`) instead of a named accent token, so
  they sit outside the `DEFAULT_PANEL_COLORS` → `themeFromAccent` discipline every
  other kind follows. Worse, the `ai`/`error` card *bodies* paint with literal
  Tailwind `sky-*`/`red-*` classes that ignore `theme` entirely.
- **WHERE:** `panel-primitives.tsx:230-231` (the two literal accents);
  `AiRequestCard` body `panel-primitives.tsx:2021,2033,2035,2036,2071,2074`;
  `ErrorCard.tsx:15,19` (`theme` + local `warning` literal).
- **WHY it's wrong:** The whole point of §8 ("colors derive from one accent via
  `themeFromAccent`; semantic tokens only") is that a color change has one source.
  Today `ai`/`error` have **two** sources (the literal accent *and* the literal
  Tailwind classes), and the body classes don't even track the accent — change
  `#0ea5e9` and the body stays sky. They are also invisible to the
  registry-token discipline A0 established (the kinds exist in `CARD_REGISTRY` but
  their accent doesn't).
- **DEEPEST fix:** Add `ai` and `error` to the **JSON accent sidecar**
  (`panel-theme.defaults.json` + the `PanelThemeKey` union) as a **system sub-namespace
  marked non-overridable** (a small `SYSTEM_THEME_KEYS` set the color picker skips, so
  the "a footnote override must not re-tint errors" invariant the comment at `:227`
  protects is preserved by *policy*, not by *escaping the path*). Then
  `CARD_THEMES.aiRequest = themeFromAccent(DEFAULT_PANEL_COLORS.ai)` etc., and **rewrite
  the `ai`/`error` card bodies to consume `theme.*` tokens** (header/badge/title/border)
  with no literal Tailwind color — exactly as every user card already does. Net: one
  accent → one palette → one body, for *all 16 kinds*, no exception. (This also lets the
  registry expose `CARD_REGISTRY[k].themeKey` as the universal accent accessor — see 2.2.)

### 2.2 Theme accent reached via two name spaces (`themeKey` token vs `PanelThemeKey`)
- **WHAT:** A card's accent is reachable as `CARD_REGISTRY[kind].themeKey` (A0) **and**
  as a bare `PanelThemeKey` literal scattered at the consumer (`panelKey="revision"`,
  `getPanelColor("cut")`, etc.). They use the *same tokens* but are maintained
  independently.
- **WHERE:** `CARD_REGISTRY[…].themeKey` (`src/cards/card-registry.tsx`); `PanelThemeKey`
  (`panel-theme.ts:14`); literal consumers throughout the panels + `cards/floats/index.tsx`.
- **WHY it's wrong:** It's the §3.8/§6 A0 wart at the *cross-cutting* boundary —
  collab, marginalia, the color picker, and the theme all re-spell the same token by
  hand. A0 retired the *kind* drift; the *theme-token* drift across these consumers is
  A10's to close.
- **DEEPEST fix:** Make `CARD_REGISTRY[kind].themeKey` the single accent accessor and
  thread it (never a literal) into every cross-cutting consumer — collab `panelKey`
  (2.3), the float `collabTrailing`, the marginalia marker. `PanelThemeKey` stays the
  small visual namespace *type*, but it is only ever *reached via* the registry.

### 2.3 Collab claim-scope keyed on a 4th hand-maintained token, matched docked↔float by hand
- **WHAT:** Claims/selections key on `(panelKey, cardId)` with `panelKey` a free
  `string` that happens to equal the PanelThemeKey token. Docked cards and the float
  `collabTrailing` independently hand-type the literal; a mismatch is a silent
  claim-namespace split (no `tsc` error — `panelKey: string`).
- **WHERE:** `useCollab.ts:462,524,613,699-718` (all `panelKind: string`); docked
  literals (`NoteCard.tsx:132`, `CutterCommentCard.tsx:87`, `RevisionCommentCard.tsx:148`,
  etc.); float literals (`cards/floats/index.tsx:101,154,180,207,256,281,403`).
- **WHY it's wrong:** Two ontologically-coupled call sites (docked + float) must agree
  on an *untyped* token for collab to work. AF Session-6 moved the float trailing into
  `CardChromeTrailing` but re-typed the literals rather than deriving them — so the
  coupling is now spread across more files, not fewer. This is precisely the
  "scattered switch" the refactor exists to unify.
- **DEEPEST fix:** Derive the claim-scope token from the registry —
  `collabClaimScope(kind) = CARD_REGISTRY[kind].themeKey` (the token *is* the panel's
  visual identity, which is already the right grain: both cutter kinds share `cut`,
  both revisions share `revision`). Type `useCardClaim(scope: ThemeKey, …)` and have
  **both** `EditableCard` and `CardChromeTrailing` resolve the scope from the kind via
  the registry — neither hand-types a literal. One source; docked and float can't drift.

### 2.4 `AiRequestKind` / `AiRequestLink.panel` / `PANEL_TO_KIND` — three more hand-kept card↔request enums
- **WHAT:** The card→AI-request routing is encoded in three places with three token
  vocabularies: `AiRequestKind` (8, uses `suggestion`), `AiRequestLink["panel"]` (5
  folder-ids), and `PANEL_TO_KIND` (the folder-id→kind default).
- **WHERE:** `types.ts:208-216`, `types.ts:235-238`, `ai-request-bridge.ts:37-43`;
  the 5 hooks hand-write `{ panel: "<folder>", cardId }` (`useNotes.ts:240,266`,
  `useTodos.ts`, `useCutter.ts`, `useRevisions.ts`, `useReports.ts`).
- **WHY it's wrong:** Adding an AI-requestable card kind today means editing the union,
  the link-panel union, the bridge map, *and* the hook — the exact ~N-site fan-out A0
  collapsed for the spine. The `panel` folder-id and the `kind` are both derivable from
  the card kind (`panelForCardKind` already exists; the request-kind is a per-kind fact).
- **DEEPEST fix:** Declare per-kind AI-request routing in `CARD_REGISTRY` — an optional
  `aiRequest?: { kind: AiRequestKind; linkPanel: AiRequestLink["panel"] }` field on the
  request-bearing kinds (note/highlight/todo/cutter-comment/revision-comment/
  report-request). The bridge then takes `(cardKind, cardId, value, ctx)` and reads the
  routing from the registry; the 5 hooks pass their kind, never the folder/kind
  literals. `PANEL_TO_KIND` retires. (Keeps `AiRequestKind` as the skill-facing
  vocabulary — it's the *external* contract drained by Python skills — but stops the
  *card side* from re-encoding it.)

### 2.5 Claim chrome authored twice (docked `EditableCard` vs float `CardChromeTrailing`)
- **WHAT:** The "per-card slot + claim-pill/presence + (docked: menu)" trailing is
  built in two places with near-identical bodies.
- **WHERE:** `EditableCard` trailing `panel-primitives.tsx:835-854`; `CardChromeTrailing`
  `panel-primitives.tsx:92-103`. `CutterCommentCard` additionally hand-rolls the same
  pill/dots in its own `headerTrailing` (`CutterCommentCard.tsx:141-147`) because it
  doesn't route through `EditableCard`.
- **WHY it's wrong:** Three authorings of one collab-trailing shape; a change to the
  pill/dots ordering or the claim-context wiring must be made in 2–3 places. AF unified
  the *window* but left the *trailing content* duplicated.
- **DEEPEST fix:** One shared `<CollabCardTrailing scope={…} cardId={…} extras={…}/>`
  consumed by `EditableCard` (docked) AND `CardChromeTrailing` (float) AND the
  bespoke-trailing cards (cutter-comment). The docked-only three-dot menu rides in as
  an `extras` slot. Pairs with 2.3 (the scope comes from the registry).

### 2.6 `error` card carries dead popout wiring (theming-adjacent)
- **WHAT:** A0 ruled `error` not-poppable; `error` is correctly *not* registered in
  `cards/floats/index.tsx` (15 of 16 kinds registered). But `ErrorCard.tsx` still imports
  `popKey`, builds `cardKey = popKey("errors", err.id)` (`:107`), and wires
  `toggleAtAnchor` (`:110`) + the `isPoppedOut` branch (`:149`).
- **WHERE:** `ErrorCard.tsx:11,107,110,149,196`.
- **WHY it's wrong:** Dead capability that can't fire (no `toFloatable`, FloatHost
  renders nothing for `error`), and it keeps `error` looking poppable in the source.
- **DEEPEST fix:** Delete the popout wiring — **but this is A1 gardening's line item**
  (Session-6 handoff explicitly routes "ErrorCard's residual dead lift-wiring → A1").
  A10 only *notes* it because the `error` theming fix (2.1) touches the same file;
  coordinate the two diffs so A10's theming pass doesn't fight A1's deletion.

### 2.7 (gap, not a wart) No registry assertion that float collab-scope === docked collab-scope
- **WHAT:** Nothing pins the docked↔float `panelKey` agreement; it's verified only by
  reading both files.
- **WHERE:** absent.
- **WHY it's wrong:** AF added contract tests for the *key* seam
  (`card-key-seams-contract.test.ts`) but not for the *collab-scope* seam — the same
  class of "two consumers must agree on a derived string" the AF gate caught.
- **DEEPEST fix:** Once 2.3 lands (scope derived from the registry), add a contract test
  pinning `collabClaimScope(kind) === CARD_REGISTRY[kind].themeKey` for the 7 collab
  kinds, mirroring the AF seam tests.

---

## Target design

**The shape: collapse the four cross-cutting hand-kept namespaces onto `CARD_REGISTRY`,
consume them uniformly, and route every card-bearing write through one of the three
already-safe persistence paths (no new store).**

1. **Theming — one accent path for all 16 kinds.**
   - Extend the JSON accent sidecar + `PanelThemeKey` with `ai`/`error`; add a
     `SYSTEM_THEME_KEYS` set the color picker skips (preserves "non-customizable" by
     policy). `CARD_THEMES.aiRequest`/`.error` become `themeFromAccent(DEFAULT_PANEL_COLORS.*)`.
   - Rewrite `AiRequestCard` + `ErrorCard` bodies to consume `theme.*` tokens — zero
     literal Tailwind color, zero literal accent. `CARD_REGISTRY[kind].themeKey` is the
     single accent accessor every consumer reads.

2. **Collab — registry-derived claim scope, one trailing.**
   - `collabClaimScope(kind) = CARD_REGISTRY[kind].themeKey`; `useCardClaim` typed on
     `ThemeKey`. `EditableCard`, `CardChromeTrailing`, and the bespoke-trailing cards
     all resolve the scope from the kind via the registry — no literal `panelKey`.
   - One `<CollabCardTrailing>` shared by docked + float (2.5), with a docked-only
     `extras` menu slot.

3. **AI requests — registry-declared routing.**
   - Optional `CARD_REGISTRY[kind].aiRequest = { kind, linkPanel }` on the 6
     request-bearing kinds; `bridgeCardAiRequestFlag(cardKind, cardId, value, ctx)`
     reads routing from the registry; the 5 hooks pass their kind. `PANEL_TO_KIND`
     retires. `AiRequestKind` stays the external skill vocabulary. The `ai` card stays
     poppable through the same `cardPopKey("ai", …)` SSOT (unchanged).

4. **Persistence — audit, don't unify.**
   - Three stores stay (different scopes: sidecar = shared doc state; collab = shared
     presence; float layout = per-window UI). A10's DoD is a *check*: every card
     key/schema touched by this refactor rides `usePersistentState`/`writeSidecar`
     (sidecar) or the `migrateFloatKeys` lockstep (float keys). The `ai`/`error`
     accent addition needs **no migration** (`ai`/`error` were never persisted to
     `virgil-panel-colors`; defaults ship in the JSON).

**How it consumes the foundations:** every fix reads A0's `CARD_REGISTRY` (themeKey,
panel, the new `aiRequest` field) and AF's `cardPopKey`/`CardChromeTrailing`/`FloatChrome`
— no new cross-cutting table is introduced; four are deleted.

---

## Keystroke sanctity

**No per-keystroke risk in A10 — verified.** No arena file
(`ai-request-bridge.ts`, `useCollab.ts`, `panel-theme.ts`, `usePersistentState.ts`,
`cards/floats/index.tsx`) has an `editor.on('update'|'transaction')` subscriber (grep
clean). The cross-cutting work is all event- or interval-driven, never doc-size-bound:

- **Collab** polls on intervals (`COLLAB_TIMINGS.pollMs` `:250`; 1s label tick `:268`;
  `cardHeartbeatMs` `:299`; `penStaleMs` sweep `:570`) and writes on
  focus/blur/selection events — never per keystroke. `bumpActivity` is throttled
  (`activityThrottleMs`, `:445`). `getCardClaim`/`getCardSelections` are O(participants)
  map reads over the polled sidecar snapshot, called per-card-render (not per-transaction).
- **AI-request bridge** fires only on an `aiRequest`-flag toggle (a discrete user action),
  async + best-effort.
- **Theming** is a `localStorage`-backed `useSyncExternalStore` (`getPanelColorVersion`);
  re-renders only on a color change.
- **`usePersistentState`** debounces disk writes (300ms) and applies React state
  immediately — the doc-size-independent write coalescing AGENTS.md sanctions.
- **The proposed fixes add nothing per-keystroke:** registry reads (`themeKey`,
  `aiRequest`, `collabClaimScope`) are O(1) static-map lookups; the shared
  `<CollabCardTrailing>` renders per-card, gated by the same collab snapshot identity.

**None of the sanctioned `editor.on('update')` subscribers (AGENTS.md list) is in A10's
surface** — A10 touches no editor subscriber. **Verify (impl):**
`window.__virgilBusStats().emitCount` flat while typing into the main editor with an
`ai` float, a collab-claimed card float, and a color override active.

---

## Fragmentation table

| Surface | File(s) (`file:line`) | Disposition |
|---|---|---|
| Hardcoded `aiRequest`/`error` accents | `panel-primitives.tsx:230-231` | **FOLD** onto `DEFAULT_PANEL_COLORS` via a non-overridable `SYSTEM_THEME_KEYS` set; `themeFromAccent` becomes the only path |
| `ai`/`error` card bodies (literal Tailwind) | `panel-primitives.tsx:2021-2074`, `ErrorCard.tsx:15,19` | **REWRITE** to consume `theme.*` tokens; no literal color |
| `themeFromAccent` engine | `panel-theme.ts:176-213` | **KEEP** — the canonical single-accent path; unchanged |
| `PanelThemeKey` / `DEFAULT_PANEL_COLORS` / JSON | `panel-theme.ts:14-33`, `panel-theme.defaults.json` | **EXTEND** with `ai`/`error`; reach only via `CARD_REGISTRY[k].themeKey` |
| Panel-color override store | `panel-theme.ts:215-290` | **KEEP** (`localStorage`); skip `SYSTEM_THEME_KEYS` in the picker |
| Collab claim/selection API (`panelKind: string`) | `useCollab.ts:462,524,613,699` | **TYPE** scope as `ThemeKey`; consumers pass registry-derived token |
| Docked collab `panelKey` literals | `NoteCard.tsx:132`, `CutterCommentCard.tsx:87`, `RevisionCommentCard.tsx:148`, `FootnoteCard.tsx:139`, `ArchiveCard.tsx:102`, `ReportCard.tsx:109`, `ReportRequestCard.tsx:116` | **DERIVE** from kind via `collabClaimScope(kind)` |
| Float collab `panelKey` literals | `cards/floats/index.tsx:101,154,180,207,256,281,403` (`collabTrailing`) | **DERIVE** from kind via the registry — same source as docked |
| `CardChromeTrailing` | `panel-primitives.tsx:78-104` | **KEEP** as the float seam; resolve scope from registry; share body with docked (2.5) |
| Claim trailing authored twice/thrice | `panel-primitives.tsx:835-854` (docked) + `:92-103` (float) + `CutterCommentCard.tsx:141-147` | **UNIFY** into one `<CollabCardTrailing>` with an `extras` slot |
| `AiRequestKind` | `types.ts:208-216` | **KEEP** as external skill vocab; stop the card side re-encoding it |
| `AiRequestLink["panel"]` + `PANEL_TO_KIND` | `types.ts:235-238`, `ai-request-bridge.ts:37-43` | **RETIRE** `PANEL_TO_KIND`; routing declared in `CARD_REGISTRY[k].aiRequest` |
| Bridge call sites (5 hooks, literal `panel`) | `useNotes.ts:238,264`, `useTodos.ts:91`, `useCutter.ts:308`, `useRevisions.ts:273`, `useReports.ts:242` | **REWIRE** to `bridgeCardAiRequestFlag(cardKind, …)`; routing from registry |
| `ai` card poppability + key | `cards/floats/index.tsx:469`, `panel-primitives.tsx:1980,2008` | **KEEP** poppable (ratified); already on `cardPopKey("ai", …)` SSOT |
| `usePersistentState` (sidecar safe path) | `usePersistentState.ts:74-214` | **KEEP** — all card sidecars + AI-request queue ride it |
| Collab sidecar write path | `useCollab.ts:174-211` | **KEEP** — `writeSidecar` RMW, stale-rejected |
| Float-state persistence + key migration | `useViewPrefs.ts:220-243,452-478,1401`; `EditorLayout.tsx:931`; `reader-view-prefs.ts:160` | **KEEP** — lockstep `migrateFloatKeys`, verified data-loss-safe; A10 audits coverage only |
| `error` dead popout wiring | `ErrorCard.tsx:11,107,110,149` | **DELETE → A1 gardening** (coordinate with A10's `error` theming diff) |

---

## Definition of Done for this arena

1. **One accent path for all 16 kinds.** `ai`/`error` accents live in
   `DEFAULT_PANEL_COLORS` (marked system/non-overridable); `CARD_THEMES.aiRequest`/`.error`
   are `themeFromAccent(DEFAULT_PANEL_COLORS.*)`; the `ai`/`error` card bodies carry no
   literal Tailwind color or literal accent. `CARD_REGISTRY[k].themeKey` is the sole
   accent accessor.
2. **Collab claim-scope is registry-derived and singly-sourced.** `useCardClaim` typed
   on `ThemeKey`; docked + float resolve scope from the kind via the registry (no literal
   `panelKey`); one shared `<CollabCardTrailing>`; a contract test pins
   `collabClaimScope(kind) === CARD_REGISTRY[k].themeKey` for the 7 collab kinds.
3. **AI-request routing is registry-declared.** `CARD_REGISTRY[k].aiRequest` drives the
   bridge; the 5 hooks pass their kind, not the folder/kind literals; `PANEL_TO_KIND`
   retired; `AiRequestKind` preserved as the external skill contract; the `ai` card stays
   poppable on the `cardPopKey` SSOT.
4. **Persistence integrity audited, no new store.** Every card key/schema change in the
   refactor verified to ride `usePersistentState`/`writeSidecar` (sidecar) or
   `migrateFloatKeys` lockstep (float keys); the `ai`/`error` accent addition needs no
   migration; a console.warn records anything dropped.
5. **Keystroke sanctity intact.** No new `editor.on('update'|'transaction')` subscriber;
   `__virgilBusStats().emitCount` flat with an `ai` float + a claimed card float + a live
   color override.
6. **Dev-preview walk:** toggle a card's AI-request flag (docked + popped) → one queue
   entry; claim a card as a partner → pill shows docked AND in the float chrome with the
   same scope; override a panel color → only that kind re-tints (`ai`/`error` untouched);
   pop an `ai` card → renders with derived theme.

---

## Open questions for the human

- **(A10-Q1) System accents as non-overridable registry entries.** A10 recommends adding
  `ai`/`error` to `DEFAULT_PANEL_COLORS` + a `SYSTEM_THEME_KEYS` set the color picker
  skips, so `themeFromAccent` is the only path but the "non-customizable" promise holds.
  Accept, or keep them as escape-hatch literals (the current state, which §8 calls an
  inconsistency)? A10's pick: fold them in with the policy guard.
- **(A10-Q2) Rewrite the `ai`/`error` card bodies off literal Tailwind.** This is the
  deeper half of the theming fix (the bodies use `sky-*`/`red-*` directly). It's a
  visible UI diff (the exact tints shift slightly when derived from the accent). Do it
  now (A10), or split the body-restyle to A9 (appearance) and keep A10 to the accent
  source only? A10's pick: do the accent source here; flag the body restyle for A9 if
  the visual delta needs design sign-off.
- **(A10-Q3) Collab claim-scope token = `themeKey`.** The claim scope is the panel's
  visual identity (both cutter kinds share `cut`, both revisions share `revision`) —
  which is exactly `CARD_REGISTRY[k].themeKey`. Confirm reusing `themeKey` as the collab
  scope (vs introducing a separate `claimScope` field). A10's pick: reuse `themeKey` —
  they're the same grain and a second field would re-introduce drift.
- **(A10-Q4) AI-request routing field on `CARD_REGISTRY`.** Adding
  `aiRequest?: { kind; linkPanel }` puts a skill-facing concern (the `AiRequestKind`
  vocabulary) into the card registry. Acceptable coupling (the routing *is* a per-kind
  fact), or keep the bridge's own small registry-derived map seeded from the kind?
  A10's pick: registry field — it's the deep fix that kills the 3-enum fan-out.
- **(A10-Q5) Scope vs A9 (the `ai` body / appearance) and A1 (`error` dead wiring).**
  The `ai`/`error` theming touches files A9 (appearance) and A1 (ErrorCard gardening)
  also edit. Confirm A10 owns the *accent source + collab/bridge derivation*, A9 owns the
  *body typography/layout restyle*, A1 owns the *dead-popout deletion* — sequenced A1 →
  A10 → A9 on `ErrorCard.tsx` / `panel-primitives.tsx` to limit conflicts.

---

## Cross-arena seams

- **A0 (spine) — `CARD_REGISTRY` is A10's substrate.** A10 adds two registry surfaces:
  `themeKey` becomes the universal accent + collab-scope accessor, and a new
  `aiRequest?: { kind; linkPanel }` field. Shared surface: `src/cards/card-registry.tsx`,
  `src/cards/types.ts` (the `CardMeta` interface), `src/cards/predicates.ts` (a new
  `collabClaimScope`). A0's `themeKey`/`panel` fields are the existing seam.
- **A9 (appearance & typography) — the `ai`/`error` card bodies.** A10 fixes the *accent
  source*; A9 owns the *body restyle* (the literal-Tailwind → `theme.*` rewrite is a
  visible appearance change). Shared file: `panel-primitives.tsx:2005-2090` (AiRequestCard),
  `ErrorCard.tsx`. Also A9's morph chevron rides `FloatChrome.chromeSlots.title` — the
  same slot A10's revision morph control uses (`cards/floats/index.tsx:406,441`); A10's
  collab trailing and A9's morph title coexist in `FloatChrome` (`FloatChrome.tsx:55,57`).
- **A1 (gardening) — `error` dead popout wiring.** `ErrorCard.tsx:11,107,110,149` is A1's
  deletion; A10's `error` theming pass touches the same file. Sequence A1 before A10's
  ErrorCard diff. Shared file: `ErrorCard.tsx`.
- **AF (foundation, landed) — `CardChromeTrailing` + the float key SSOT.** A10's collab
  trailing IS the AF `CardChromeTrailing` seam (`panel-primitives.tsx:78`,
  `cards/floats/index.tsx:92`); A10's `ai` card poppability rides AF's
  `cardPopKey`/`buildFloatKey` (`panel-registry.ts:248`). A10 must not regress AF's
  `omniKey === data-card-key === cardPopKey` invariant when re-deriving the collab scope.
- **A3 (creation & lifecycle) — the AI-request bridge fires from the data hooks.** The
  bridge's 5 call sites live in the per-panel hooks A3 also touches (creation pipeline);
  the `aiRequest`-flag toggle is a lifecycle-adjacent mutation. Shared files:
  `useNotes.ts`, `useCutter.ts`, `useRevisions.ts`, `useReports.ts`, `useTodos.ts`.
- **A4 (selection/focus) — soft-selection presence.** `updateSelection`/`getCardSelections`
  (`useCollab.ts:491,524`) mirror the card *selection* model A4 owns; the presence dots
  reflect partner selections. If A4 changes the selection model, the collab
  `selectedCards` payload (`{ panelKind, cardId }[]`) must track the same `(scope, id)`
  pair A10 derives. Shared concept: the `(scope, cardId)` selection identity.
- **A5 (omni-view) — the multi-surface `ai` card + collab in omni.** The `ai` kind renders
  across panels and in omni; `convertRevisionCard`/the bridge thread through omni-host
  (`omni-host.tsx:486,567`). Collab presence should be consistent omni↔docked↔float (A10
  ensures the scope is the same in all three). Shared file:
  `editor-layout/panels/omni-host.tsx`.

---

## Stale-ref corrections (SSOT / older-audit refs that drifted at HEAD 588ae7e)

- **SSOT §8 / A0 §3.8 "`aiRequest` (`#0ea5e9`) and `error` (`#b45757`) are hardcoded
  accents":** still true, now at **`panel-primitives.tsx:230-231`** (A0 cited the same
  file without lines; confirmed verbatim). The *deeper* finding (literal Tailwind bodies)
  is new to this audit.
- **SSOT §7 A10 row "Files: ai-request-bridge.ts, useCollab.ts, panel-theme.ts,
  usePersistentState.ts":** all four exist at the cited paths;
  `ai-request-bridge.ts` is **136 lines** (single `bridgeCardAiRequestFlag` export);
  `useCollab.ts` **776 lines**; `panel-theme.ts` **290**; `usePersistentState.ts` **214**.
- **AF §5 "Card fills `trailing` with what `EditableCard` builds as `headerTrailing`
  (`panel-primitives.tsx:791-810`)":** the docked trailing assembly is now at
  **`panel-primitives.tsx:835-854`** (the file grew post-AF); `CardChromeTrailing` (the
  float extraction AF promised) landed at **`panel-primitives.tsx:78-104`** and is
  consumed via `collabTrailing` at **`cards/floats/index.tsx:92`**.
- **AF §1.5 / §1.10 "`PanelCard` unified header `:1683-1690`" + "`CardJumpChevron` `:376`":**
  the popped header moved into `FloatChrome` (`src/floats/FloatChrome.tsx`, the jump glyph
  drawn once at `:104`); the card-side popped-header branch is gone (AF Session-6/9). Any
  A10 reasoning that assumed the card renders its own popped header is stale — the float
  header is now `FloatChrome`, and the collab pill rides `chromeSlots.trailing`.
- **A0 §3.5 "`error` … wraps in `FloatCard` when popped (`ErrorCard.tsx:150-152`)":** the
  dead wiring persists but the lines shifted — `popKey` import `:11`, `cardKey` build
  `:107`, `toggleAtAnchor` `:110`, `isPoppedOut` branch `:149`. `FloatCard` itself is
  deleted (AF renamed → `FloatWindow`); ErrorCard's residual reference is to the
  now-removed self-wrap pattern, confirming it's dead. (Deletion = A1.)
- **SSOT §3 contract sketch lists `Floatable` without `bareWindow`/`title` node:** the
  landed `src/floats/types.ts` carries `bareWindow?` (`:91`) and `chromeSlots.title`
  (the morph slot AF reserved); A10's `ai`/`bib` floats use `bareWindow: true`
  (`cards/floats/index.tsx:330,473`) — the in-body-header degrade, not the unified chrome.
- **A0 §2.2 "poppable-today 14 cases":** at HEAD the registry registers **15**
  `toFloatable` builders (`cards/floats/index.tsx`) — all 16 real kinds except `error`.
  The A0 "14 cases" counted the pre-registry `renderPoppedCard` switch; the post-A0
  registry is the current truth.
- **`AiRequestLink["panel"]` is 5 folder-ids, not card kinds** (`types.ts:236`): the SSOT
  A10 row implies the bridge keys on kinds; it keys on folder-ids via `PANEL_TO_KIND`
  (`ai-request-bridge.ts:37`) — corrected in §1.1/2.4.
