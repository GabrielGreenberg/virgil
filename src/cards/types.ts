/**
 * Card spine — types. The single source of truth is `CARD_REGISTRY` in
 * `card-registry.tsx`; this is the type layer. Mirrors `src/text-objects/types.ts`
 * (`TextObjectMeta`).
 *
 * React-FREE: `Floatable` (and its `ReactNode`) is imported **type-only**, so the
 * React dependency is erased at compile time and quarantined in `src/floats/`.
 * Keep it that way — the JSX-building closures live in `card-registry.tsx`.
 */
import type { PanelThemeKey } from "@/lib/panel-theme";
import type { PanelKind } from "@/panels/_shared/types";
import type { DropSpec } from "@/components/drop-mode/types";
import type { Floatable } from "@/floats/types";
import type { CardFloatCtx } from "./card-float-ctx";
// Type-only (cycle-safe — erased at compile time): the AI-request wire
// vocabulary lives in `@/lib/types` and is a FROZEN external skill contract.
import type { AiRequestKind, AiRequestLink } from "@/lib/types";

/**
 * The card-spine kind union — the single source of truth. `panels/_shared/types`
 * re-exports this (the canonical home moved here, mirroring `TextObjectKind`
 * living beside `TEXT_OBJECT_REGISTRY`).
 *
 * 15 symmetric kinds. The Revisions/Cutter comment+suggestion pairs are spelled
 * `revision-comment`/`revision-suggestion` and `cutter-comment`/`cutter-suggestion`.
 * **Bare `comment`/`suggestion` are NOT spine kinds** — they remain only as the
 * on-disk `RevisionCard`/`CutterCard.kind` *data discriminator* (untouched on
 * disk + in the Python skill layer; bridged to the spine by `resolveCardKind`).
 * (The legacy `"ai"` kind — the per-panel display of UNLINKED ai-requests.json
 * entries — was retired in BUG #55b: note/todo requests migrate to real cards
 * with the per-card `aiRequest` flag; footnote/citation stay in the AIWindow.)
 */
export type CardKind =
  | "note"
  | "highlight"
  | "footnote"
  | "citation"
  | "example"
  | "todo"
  | "archive"
  | "report"
  | "report-request"
  | "revision-comment"
  | "revision-suggestion"
  | "cutter-comment"
  | "cutter-suggestion"
  | "bib"
  | "error";

/** `CARD_THEMES` key. ONE keyspace with the user-overridable color slots
 *  (A10/B): the registry themeKey vocabulary IS `PanelThemeKey` — the legacy
 *  `"comment"` alias for the revision identity is gone, and the old
 *  comment→revision crosswalk in `marker-meta.ts` is deleted. Includes the
 *  non-overridable system accents `aiRequest`/`error` (see
 *  `SYSTEM_THEME_KEYS`). */
export type ThemeKey = PanelThemeKey;

/**
 * Margin-marker namespace union — the categories the marginalia margin can
 * render. Canonical home is HERE, beside `CardMeta.markerType` (A6/R17);
 * `@/lib/marginalia` re-exports it so its existing importers are unchanged.
 * (It used to live in `lib/marginalia.ts`, which made this type layer import
 * from a UI lib module — an inverted edge.) Marker metadata that derives from
 * the registry (owning panel, theme key) lives in `src/cards/marker-meta.ts`;
 * the marginalia-local presentation fields (label / icon) stay
 * in `MARKER_META` (`lib/marginalia.ts`).
 */
export type MarkerType =
  | "note"
  | "archive"
  | "revision"
  | "cut"
  | "todo"
  | "report"
  | "error";

/** Creation provenance.
 *  - `user`    — has a "+" / action / drop creation path
 *  - `system`  — generated from a sidecar or the linter (`bib`, `error`)
 *  - `derived` — mirrors a `TextObject` harvested from the doc (`example`) */
export type CardOrigin = "user" | "system" | "derived";

/** Declared lifecycle coverage. Booleans, not closures: the actual ops are
 *  per-doc hooks wired in `EditorPane`'s `CardLifecycleProvider`. The registry
 *  declares INTENT; a dev assertion checks the provider satisfies exactly the
 *  declared ops, so a gap is intentional-and-visible, never silent.
 *
 *  **CRITERION (A3/WS3 — what these flags actually drive).** These flags gate
 *  the anchor-text duplicate/delete *CASCADE* — the Mode-B `linkedAnchor`
 *  text-range walker (`duplicate-slice` / `delete-range` iterate the doc and
 *  call `get(kind)?.clone(id)` / `.delete(id)`), plus the inline-atom kinds
 *  (footnote/citation) whose markers ride the slice. They are NOT the card's
 *  own UI delete (every card can be dismissed from its panel regardless).
 *  So a kind is `{clone:true,delete:true}` IFF it is walker-reachable —
 *  either it carries an inline atom, OR it sets `bindAnchor:true` (a Mode-B
 *  text-range anchor the slice can re-bind). The all-false kinds are the
 *  Mode-A paragraph-anchored kinds (todo / report / report-request) and the
 *  origin:derived mirror (example) — no text-range anchor for the cascade to
 *  reach — plus `archive` (R18: ratified NO cascade; it survives anchor
 *  deletion). `assertLifecycleCoverage` + the E-4 criterion test pin this so a
 *  future chip can't "fill" a permanent gap without tripping a test. */
export interface CardLifecycleCapability {
  clone: boolean;
  delete: boolean;
  /** Mode-B re-anchor after clone. */
  bindAnchor: boolean;
}

/** The set of fields a `morph` drops — the fields the TO shape cannot hold.
 *  Drives both the generated confirm copy (so it's never direction-blind, the
 *  `REP-F6-03` class) AND the lifecycle unbridge decision: `"aiRequest"` in the
 *  list is the declarative trigger to clear the orphaned `ai-requests.json`
 *  entry on morph (the C8 lossy-morph-leak class). */
export type MorphDropField = "title" | "byline" | "aiRequest" | "body" | "keys" | "formatting";

/** Declarative content model (T4 §3.1). The single descriptor `cardHasContent`
 *  walks — both the panel-trash and margin-marker delete-confirm read it, so a
 *  kind can never silently delete user content the confirm couldn't see.
 *
 *  A named field must exist on the shape `cardHasContent` is CALLED with, which
 *  is not always the kind's sidecar record: `footnote` declares `title` (the
 *  `\thanks` label), which lives on the `\footnote` ATOM's node attrs, and its
 *  call sites compose `{ content, title }` from the node. `assertContentCoverage`
 *  checks the descriptor's internal consistency (null-ness, non-emptiness, one
 *  verdict per field) — it does NOT and cannot check field EXISTENCE, since
 *  types are erased and the composed shapes are built at the call site. Said
 *  plainly here because the previous wording claimed a pin that does not exist,
 *  and a guard that overstates its reach is worse than none (task 330).
 *
 *  All four field lists are matched against the card record by name. A field
 *  holding a Tiptap JSONContent doc (`bodyField`) is walked for visible text;
 *  the `textFields` / `authorConditionalFields` are matched as
 *  plain-string-or-array (non-empty array of keys, or trimmed-non-empty
 *  string). No field may appear in more than one list — that's a contradiction
 *  the walker can't resolve, and `assertContentCoverage` rejects it. */
export interface CardContentModel {
  /** Rich-body JSONContent field name on the record (e.g. `"content"`), or
   *  `null` for kinds whose body lives elsewhere (footnote body rides
   *  `attrs.content`, threaded in as `content` by the caller). */
  bodyField: string | null;
  /** Plain-text mirror fields that ALSO count (e.g. `"text"` on
   *  todo/report-request/report; `"title"` on report/footnote/note). A trimmed
   *  non-empty string, or a non-empty array (e.g. citation `keys`). */
  textFields: readonly string[];
  /** AI-prefilled fields that DON'T count as user content — the suggestion
   *  family's `original_text`, which is a read-only capture of the targeted
   *  passage on EVERY surface (AI or human authorship) and is recoverable from
   *  the document itself. Named here for documentation + the coverage
   *  assertion; the walker never reads them.
   *
   *  This list is for fields NO author can type into. A field whose
   *  user-content-ness depends on WHO authored the record belongs in
   *  {@link authorConditionalFields} — see the note there (task 241). */
  aiPrefilledFields: readonly string[];
  /** Fields that count as user content ONLY on a **human-authored** record —
   *  i.e. when `card.author !== "ai"` (an absent `author` reads as human,
   *  matching the sidecar migrations' own default, and failing SAFE toward
   *  confirming).
   *
   *  Why the model needs this axis (task 241): a static per-kind descriptor
   *  can't express a field whose user-content-ness depends on the record. The
   *  suggestion family's `suggested_text` is AI *prefill* on an AI card (which
   *  never renders the editable field grid — see `PendingAiRecordBody`) but the
   *  human author's typed, apply-load-bearing replacement on a human card
   *  (`replacement = user_text or suggested_text`, `apply_response.py`). Listed
   *  as `aiPrefilledFields` it read as EMPTY for a human draft whose only
   *  content was a typed replacement — hard-deleted with no confirm, and
   *  asymmetric with the apply path that treats it as real content. */
  authorConditionalFields: readonly string[];
}

/** Per-`CardKind` SSOT. Mirrors `TextObjectMeta`. */
export interface CardMeta {
  /** Display label / uppercase overline (was `CARD_TYPE_LABELS`). */
  label: string;
  /** Auto-title prefix at creation, or `null` to opt out (was `CARD_TITLE_LABELS`). */
  titleLabel: string | null;
  /** Popout-key prefix (was `CARD_KEY_PREFIXES`). **Preserved byte-for-byte**
   *  from the legacy table — `popKey`/`cardPopKey`/omni-ids/persisted
   *  `poppedOutCards` keys must not change. The revision pair's split
   *  (`revision-comment` → `"revision"`, `revision-suggestion` →
   *  `"revision-suggestion"`) is intentional drift that AF's `float:` grammar
   *  normalizes; A0 does not touch persisted keys. */
  keyPrefix: string;
  /** `CARD_THEMES` key (was the scattered per-card `themeKey` lookups). */
  themeKey: ThemeKey;
  /** Whether this kind participates in collab focus-claims (R28/D-2): its
   *  docked card claims on focus / releases on blur, and both docked + float
   *  trailing render the partner claim pill / presence dots. True for EXACTLY
   *  the 7 claim-bearing kinds (note, footnote, archive, report,
   *  report-request, revision-comment, cutter-comment) — an explicit facet,
   *  NOT derived from `anchored`/`origin`, so adding a kind can never silently
   *  make it claim-bearing (highlight / the suggestion kinds stay out). The
   *  claim's wire scope token is `collabClaimScope(kind)` (predicates.ts) ≡
   *  the registry `themeKey` — pinned byte-for-byte by
   *  `collab-claim-scope-contract.test.ts`. */
  collabClaims: boolean;
  /** Owning panel (was `PANEL_REGISTRY.card` + `POLYMORPHIC_CARD_PANEL`).
   *  `null` is now unused — it was the cross-panel `"ai"` kind's slot before
   *  #55b retired it; kept on the type for forward flexibility. */
  panel: PanelKind | null;
  /** Creation provenance. */
  origin: CardOrigin;
  /** Three-surface (text · margin · card) hover/anchor membership (was
   *  `ANCHORED_CARD_KINDS` / `EntityKind` / `MarginaliaMarker.entityKind`). A
   *  static capability flag — never computed by scanning the doc. */
  anchored: boolean;
  /** Margin-marker namespace, or `null` for kinds with no marginalia icon
   *  (footnote/citation render in-text atoms; bib unanchored; highlight = tint). */
  markerType: MarkerType | null;
  /** AI-request routing (R29), or absent for kinds whose cards carry no
   *  `aiRequest: boolean` flag. Declared on exactly 7 kinds (note, highlight,
   *  todo, cutter-comment, revision-comment, report-request, footnote — footnote
   *  joined in BUG #55). `kind` is the `AiRequest.kind` the bridged queue entry
   *  gets (which subskill picks it up); `linkPanel` is the `AiRequestLink.panel`
   *  wire token. BOTH halves are the FROZEN external skill contract
   *  (`editor/scripts/list_requests.py`) — wire bytes must not change (pinned by
   *  `ai-request-routing-contract.test.ts`). `linkPanel` is DECLARED, not
   *  derived from `.panel`: the registry panel for todo is `"todo"` but the
   *  wire token is `"todos"` (and notes hosts two kinds), so a derivation
   *  would silently corrupt the contract. */
  aiRequest?: { kind: AiRequestKind; linkPanel: AiRequestLink["panel"] };
  /** Declared lifecycle coverage (validated against the per-doc provider). */
  lifecycle: CardLifecycleCapability;
  /** The card's USER-CONTENT model — the single declarative descriptor both
   *  the panel-trash delete-confirm (`EditableCard.tryDelete`) and the
   *  margin-marker delete (`deleteMarginItem`) read to gate the
   *  "This item has text. Delete it?" confirm AND the orphan-worthiness test.
   *  Replaces the divergent per-kind `switch` in `cardHasContent` — NO kind may
   *  carry content the confirm can't see (the deficiency behind REP-F7-01 /
   *  CI-F7-01 / OMNI-F7-01 / FN-A1-02). A dev assertion (`assertContentCoverage`)
   *  pins that every kind declares this and names only fields the kind's record
   *  actually has.
   *
   *  The walker (`cardHasContent`) treats the card as "has content" iff ANY
   *  declared body/text field is non-empty (visible text) — plus, on a
   *  non-AI-authored record, any `authorConditionalFields` entry. `null` for the
   *  system kinds with no user content (`bib`/`error`) and for `highlight`
   *  (a color + range, no user-typed body) — a `null` descriptor ALWAYS reports
   *  "no content" (delete without confirm), which is the correct behavior for
   *  those kinds. */
  content: CardContentModel | null;
  /** In-document drop behavior, or `null` for kinds that don't re-anchor by drop. */
  dropSpec: DropSpec | null;
  /** Whether this kind gets the docked drop button — the (re)anchor gesture that
   *  enters drop-mode. A STATIC literal, NOT derived from `dropSpec != null`:
   *  `dropSpec` is installed by the boot-time side-effect import
   *  `@/cards/drop-specs` (folded onto the registry on the drop-dispatch path),
   *  which `predicates.ts` can't import without a cycle and which may not have
   *  run when a card header first paints — a dynamic gate would read `null` and
   *  wrongly hide the button. So `droppable` is declared per-kind here and PINNED
   *  to the real mechanism by a dev assertion + contract test:
   *  `droppable` ⇔ the kind's `dropSpec` allows a *re-anchor* placement
   *  (`inline-cursor` for in-text, `paragraph-side` for margin). `example` is
   *  `false` despite carrying a `dropSpec`, because its spec is a `between-blocks`
   *  block content-MOVE, not a card re-anchor (drop-button SYNTHESIS §7 design
   *  call); `bib`/`error` are `false` (no spec at all). */
  droppable: boolean;
  /** Where a (re)anchor drop for this kind LANDS — the declarative SSOT the drop
   *  button + controller dispatch through, replacing `dropSpec.allowedPlacements`
   *  introspection (drop-button SYNTHESIS §2). `"in-text"` = an inline caret /
   *  `\cite`-`\footnote` atom position (footnote/citation); `"margin"` = the
   *  paragraph horizontal band (note/highlight/todo/archive/report/…); `null` for
   *  kinds that take no drop button (`bib`/`error`, and `example` whose drop
   *  is a block move, not a re-anchor). DERIVED-CONSISTENT with the kind's
   *  `dropSpec.allowedPlacements`; a dev assertion pins the two so the declared
   *  policy can't drift from the mechanism. `droppable` ⇔ `dropPlacement !== null`. */
  dropPlacement: "in-text" | "margin" | null;
  /** The morph target for the polymorphic kind-chevron (A9), or `null` for the
   *  non-morphing kinds. When set, this kind can convert *in place* into
   *  `morph.to` (which always shares its panel — the chevron's options are
   *  `cardKindsForPanel(panel)`), preserving id/createdAt/anchor. `lossy: true`
   *  flags a conversion that drops fields the target shape can't hold (e.g.
   *  note→highlight discards the note body) so the UI can show a confirm. The
   *  actual data transform is registered out-of-band via `registerCardMorph`
   *  (a runtime-leaf indirection, mirroring `registerCardFloatable`), never
   *  imported into this card-UI-free module. A dev assertion checks every
   *  `morph !== null` kind has a registered converter and that `morph.to`
   *  shares the panel.
   *
   *  `drops` enumerates the fields the TO shape cannot hold (T4 §3.2). It drives
   *  the GENERATED confirm copy (so it can't lie or be direction-blind —
   *  `REP-F6-03`) and the lifecycle unbridge decision: `drops.includes("aiRequest")`
   *  is the declarative trigger to clear the orphaned `ai-requests.json` entry
   *  on a morph that drops an aiRequest-bearing kind's flag (the C8 leak class —
   *  `REP-F5-01` et al). `lossy` is kept as a static literal (back-compat with
   *  out-of-tree readers) and PINNED to `drops.length > 0` by
   *  `assertMorphCoverage`, so the two can never diverge. */
  morph: { to: CardKind; lossy: boolean; drops: readonly MorphDropField[] } | null;
  /** Whether this kind can serialize onto the Stack. `bib` is stackable despite
   *  being `system`, so this cannot be derived from `origin` — and the Stack
   *  spells that kind `"bibliography"`, so it cannot be derived from the name
   *  either. PINNED to the Stack's real vocabulary (`STACK_CARD_KINDS`,
   *  `src/lib/stack/card-kinds.ts`) by `assertStackCoverage()` at boot, with the
   *  mechanisms only a built float / a real drop can answer for pinned in
   *  `cards/__tests__/stack-coverage.test.ts` (task 259). A kind whose round
   *  trip isn't built declares `false` — there is no "stackable in principle". */
  stackable: boolean;
  /** Whether this kind can pop out into a `Floatable` window. The single
   *  DECLARATIVE source of truth for poppability: `registerCardFloatable`
   *  refuses to install a builder for a non-poppable kind, and the
   *  `isPoppable` predicate (the docked one-click pop-out control) reads this.
   *  Only `error` is `false` (ratified not-poppable, §3.5). Decoupled from
   *  `toFloatable` so poppability is statically inspectable without depending
   *  on boot-time registration order. */
  poppable: boolean;
  /** Two-class body typography (A9 §N2). `"borrowed"` renders the card body in
   *  the main-text serif face one size down (Source Serif 4 / 15px) — the
   *  apparatus kinds that quote document prose (footnote / archive / example).
   *  `"sans"` renders compact Inter / 12px (everyone else, including report —
   *  R11, which fixes its declared-vs-rendered serif mismatch). The default
   *  rows of `DEFAULT_PANEL_TYPOGRAPHY` (lib/panel-typography.ts) are DERIVED
   *  from this class via the panel↔primary-kind map; a dev assertion pins the
   *  declared class to the typography row so the two never drift. The mutable
   *  per-field override registry (the user's text-size stepper) is unchanged. */
  bodyClass: "borrowed" | "sans";
  /** Which SCHEMA this kind's body mounts (task 308) — orthogonal to
   *  {@link bodyClass}, which is typography only. `"card"` is the narrow
   *  authored-prose surface (`CARD_STARTER_KIT_CONFIG`: no heading / blockquote
   *  / codeBlock / horizontalRule, no expex, no highlight / textColor marks).
   *  `"excerpt"` is the full main-document vocabulary, for a kind whose body
   *  holds a verbatim SLICE OF THE DOCUMENT rather than prose the user typed
   *  into the card.
   *
   *  Declared per kind rather than inferred from `bodyClass`: "renders in the
   *  main-text serif face" and "can contain arbitrary document structure" are
   *  different questions, and three of the four `bodyClass: "borrowed"` kinds
   *  (footnote / example) hold authored or kind-specific content, not an
   *  arbitrary excerpt. Resolved ONCE in `EditableCard` and threaded to both
   *  body surfaces, so a kind can never render through two schemas.
   *
   *  A kind that declares `"excerpt"` is also asserting the other half of the
   *  contract: any DESTRUCTIVE capture writing into it is gated by
   *  `canMountInCardBody` (never delete what the destination cannot hold). */
  bodySchema: import("@/lib/tiptap/borrowed-schema").CardBodySchemaScope;
  /** AF integration point. Returns the shared `Floatable` presence, or `null`
   *  when this kind is not poppable (`error`). MUST be a pure per-id resolver —
   *  resolve one entity by id from `ctx`; NO full-doc descent (keystroke
   *  sanctity / AF §8). */
  toFloatable(id: string, ctx: CardFloatCtx): Floatable | null;
}
