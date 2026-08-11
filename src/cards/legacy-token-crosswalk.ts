/**
 * Legacy-token crosswalk — the SINGLE-SOURCE declaration of the two on-disk /
 * CSS string namespaces a spine `CardKind` projects into:
 *
 *   1. `legacyDataKind` — the `data-link-card="<token>:<id>"` attribute value
 *      stamped by `createLinkedAnchor` (`links.ts`). Read by the
 *      `.linked-anchor[data-link-card^="<token>:"]` CSS rules.
 *   2. `cssToken` — the `data-paragraph-kind="<token>"` attribute value the
 *      anchor-highlight reconciler stamps on a Mode-A paragraph wrapper. Read
 *      by the `[data-paragraph-kind="<token>"]` CSS rules.
 *
 * These two namespaces DIVERGE for some kinds (e.g. cutter: `legacyDataKind`
 * is `"cutter-comment"`/`"cutter-suggestion"` but `cssToken` is `"cut"`; and the
 * revision kinds: `legacyDataKind` is the spine `"revision-comment"`/
 * `"revision-suggestion"` — unified onto the spine kind so the `data-link-card`
 * attr matches `linkCardKey`/`parseLinkCardKey` and `updateLinkedAnchorCard`,
 * with `"comment:"` kept only as a legacy CSS alias — but `cssToken` is the
 * legacy `"comment"`), so they are declared as two columns, not one.
 *
 * **R-C: this module does NOT migrate any token.** Every value here is
 * byte-identical to the literals it replaces (`legacyKindToCardKindString` in
 * `links.ts` + `paragraphKindFor` in `useAnchorHighlightReconciler.ts`); the
 * on-disk attributes and `globals.css` selectors are untouched. A2 centralizes
 * only the DECLARATION so the two scattered switches read one table. A dev
 * assertion (below) pins the revision→`"comment"` / cutter→`"cut"` mappings to
 * their legacy literals so a future edit can't silently drift the CSS contract.
 *
 * Light leaf: imports only the `CardKind` type. No registry, no React.
 */
import type { CardKind } from "./types";

interface LegacyTokens {
  /** `data-link-card` token (the link-atom layer's `<token>:<id>` grammar), or
   *  `null` if this kind never carries a `linkedAnchor` mark. */
  legacyDataKind: string | null;
  /** `data-paragraph-kind` token (Mode-A paragraph accent rail), or `null` if
   *  this kind paints no paragraph accent (tint-only or unanchored). */
  cssToken: string | null;
}

/** Per-`CardKind` legacy-token projection. Values are byte-identical to the
 *  pre-A2 literals — see the module docstring (R-C: no token migration). */
export const LEGACY_TOKEN_CROSSWALK: Record<CardKind, LegacyTokens> = {
  note:                  { legacyDataKind: "note",             cssToken: "note" },
  highlight:             { legacyDataKind: "highlight",        cssToken: null },
  footnote:              { legacyDataKind: null,               cssToken: null },
  citation:              { legacyDataKind: null,               cssToken: null },
  example:               { legacyDataKind: null,               cssToken: null },
  todo:                  { legacyDataKind: "todo",             cssToken: "todo" },
  archive:               { legacyDataKind: null,               cssToken: "archive" },
  report:                { legacyDataKind: "report",           cssToken: "report" },
  "report-request":      { legacyDataKind: "report-request",   cssToken: "report" },
  "revision-comment":    { legacyDataKind: "revision-comment",    cssToken: "comment" },
  "revision-suggestion": { legacyDataKind: "revision-suggestion", cssToken: "comment" },
  "cutter-comment":      { legacyDataKind: "cutter-comment",   cssToken: "cut" },
  "cutter-suggestion":   { legacyDataKind: "cutter-suggestion", cssToken: "cut" },
  bib:                   { legacyDataKind: null,               cssToken: null },
  error:                 { legacyDataKind: null,               cssToken: null },
};

/**
 * Inverse map: legacy on-disk card-kind token → spine `CardKind`.
 *
 * Pre-refactor sidecars persisted pre-spine tokens in `links[].target.ref.kind`
 * (and per-card `kind` fields). These never appear as keys of
 * `LEGACY_TOKEN_CROSSWALK`, so they must be normalized at the load funnel
 * (`migrateCardLinks` in `src/links/migrate-card.ts`) before they reach any
 * `Record<CardKind, …>` index. Evidence each token is real:
 *
 *  • `"comment"` — pre-refactor revision cards; live in
 *    `samples/annotation-history/virgil/revisions.json` (and dev-doc copies).
 *    Maps to `"revision-comment"` (the comment kind; suggestions were a later
 *    split and always wrote spine kinds).
 *  • `"cut"` — pre-refactor cutter cards (fixture:
 *    `virgil-data/sync-test/virgil/cutter.json`). Previously rewritten by a
 *    local `rewriteLinkTargetKind` wrapper in `useCutter.ts`'s legacy
 *    `cuts[]` branch; that wrapper is deleted — the rewrite now happens
 *    solely here, applied by the shared funnel.
 *
 * Known-dead token, intentionally UNMAPPED: `"quotation"` (in
 * `virgil-data/sync-test/virgil/quotations.json`) belongs to the removed
 * quotations panel — its sidecar is never loaded (see the removed-panel note
 * in `src/lib/print.ts`), and no spine kind corresponds to it. If it ever
 * leaks in, `normalizeLegacyCardKind` returns `null` and the runtime-total
 * accessors below absorb it.
 */
const LEGACY_TOKEN_TO_CARD_KIND: Record<string, CardKind> = {
  comment: "revision-comment",
  cut: "cutter-comment",
};

const hasOwn = (obj: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(obj, key);

/**
 * Normalize a possibly-legacy on-disk card-kind token to a spine `CardKind`.
 *
 *  • Spine kinds pass through unchanged.
 *  • Known legacy tokens map per `LEGACY_TOKEN_TO_CARD_KIND`.
 *  • Unknown tokens → `null` (caller decides; the load funnel keeps the link
 *    as-is and the runtime-total accessors below make the stray token
 *    harmless).
 */
export function normalizeLegacyCardKind(kind: string): CardKind | null {
  if (hasOwn(LEGACY_TOKEN_CROSSWALK, kind)) return kind as CardKind;
  if (hasOwn(LEGACY_TOKEN_TO_CARD_KIND, kind)) {
    return LEGACY_TOKEN_TO_CARD_KIND[kind];
  }
  return null;
}

/** Dev-only loud-once registry for unknown tokens hitting the accessors. */
const warnedUnknownTokens = new Set<string>();

function warnUnknownToken(fn: string, kind: string): void {
  if (process.env.NODE_ENV === "production") return;
  if (warnedUnknownTokens.has(kind)) return;
  warnedUnknownTokens.add(kind);
  console.error(
    `[legacy-token-crosswalk] ${fn}: unknown card-kind token "${kind}" — ` +
      `not a spine CardKind. Returning null. If this token exists in persisted ` +
      `sidecar data, add a mapping to LEGACY_TOKEN_TO_CARD_KIND so the load ` +
      `funnel (migrateCardLinks) normalizes it.`,
  );
}

/** The `data-paragraph-kind` token for a spine kind, or `null`. Single source
 *  for the reconciler's `paragraphKindFor`. Runtime-total: an unknown token
 *  (legacy on-disk kind that slipped past normalization) returns `null`
 *  instead of throwing, with a loud dev-only error. */
export function cssTokenForCardKind(kind: CardKind): string | null {
  const entry = LEGACY_TOKEN_CROSSWALK[kind];
  if (!entry) {
    warnUnknownToken("cssTokenForCardKind", kind);
    return null;
  }
  return entry.cssToken;
}

/** The `data-link-card` token for a spine kind, or `null` if the kind never
 *  carries a linked-anchor mark. Single source for `links.ts`'s
 *  `legacyKindToCardKindString` (via its `LinkedAnchorKind → CardKind`
 *  adapter). Runtime-total: unknown token → `null` + loud dev-only error. */
export function legacyDataKindForCardKind(kind: CardKind): string | null {
  const entry = LEGACY_TOKEN_CROSSWALK[kind];
  if (!entry) {
    warnUnknownToken("legacyDataKindForCardKind", kind);
    return null;
  }
  return entry.legacyDataKind;
}

/** Legacy `linkedAnchor` mark `kind` attr → spine `CardKind`. The mark's `kind`
 *  is the LEGACY mark-attr namespace (note, highlight, todo, revision, the two
 *  cutter kinds, the two report kinds), NOT a spine kind — only `revision`
 *  folds (→ `revision-comment`); every other live value equals its spine kind.
 *  The dead-but-persisted `cut` alias is handled separately in
 *  `dataLinkCardTokenForLegacyMarkKind`. */
const LEGACY_MARK_KIND_TO_CARD_KIND: Record<string, CardKind> = {
  note: "note",
  highlight: "highlight",
  todo: "todo",
  revision: "revision-comment",
  "cutter-comment": "cutter-comment",
  "cutter-suggestion": "cutter-suggestion",
  report: "report",
  "report-request": "report-request",
};

/** Spine `CardKind` → the legacy `linkedAnchor.kind` mark-attr token (the
 *  INVERSE of `LEGACY_MARK_KIND_TO_CARD_KIND`). The mark's `kind` attr lives in
 *  the LEGACY namespace, so a card MORPH must re-derive it from the NEW spine
 *  kind to stop the mark lying about the old one — see
 *  `restampLinkedAnchorForKind` (links.ts). Both revision spine kinds collapse
 *  to the single legacy mark kind `"revision"` (the reapply pass stamps both as
 *  "revision"), so this is not a strict bijection — hence a hand-declared table,
 *  dev-pinned below against the forward map. `null` for kinds that never carry a
 *  `linkedAnchor` mark (footnote/citation/example/archive/bib/error). */
const CARD_KIND_TO_LEGACY_MARK_KIND: Partial<Record<CardKind, string>> = {
  note: "note",
  highlight: "highlight",
  todo: "todo",
  "revision-comment": "revision",
  "revision-suggestion": "revision",
  "cutter-comment": "cutter-comment",
  "cutter-suggestion": "cutter-suggestion",
  report: "report",
  "report-request": "report-request",
};

/** The legacy `linkedAnchor.kind` mark-attr token a spine `CardKind` paints, or
 *  `null` if the kind never carries a mark. Single source for the card-morph
 *  mark restamp (`restampLinkedAnchorForKind`). */
export function legacyMarkKindForCardKind(kind: CardKind): string | null {
  return CARD_KIND_TO_LEGACY_MARK_KIND[kind] ?? null;
}

/** Legacy `linkedAnchor` mark `kind` attr → spine `CardKind`, or `null` for a
 *  token this map doesn't cover. Single source for the FORWARD projection the
 *  `links.ts` mark-collectors need (`legacyAnchorKindToCardKind`,
 *  `linkedAnchorKindToCardKind`) — the inverse of `legacyMarkKindForCardKind`.
 *
 *  Covers the eight real legacy mark kinds (note/highlight/todo/revision/the two
 *  cutter kinds/the two report kinds). Does NOT cover the dead `"cut"` alias (see
 *  `dataLinkCardTokenForLegacyMarkKind`) or the `pending-ai-*` render sentinels
 *  (which are NOT card marker kinds) — callers layer those on top before falling
 *  through to this accessor. */
export function legacyMarkKindToCardKind(kind: string): CardKind | null {
  return LEGACY_MARK_KIND_TO_CARD_KIND[kind] ?? null;
}

/**
 * The `data-link-card` token a `linkedAnchor` mark falls back to when it carries
 * NO explicit `linkCard` — i.e. a mark re-stamped by the once-per-doc
 * `applyLinkedAnchors` → `reanchorByText` RESTORE pass, which passes no cardId
 * (so `linkCard` is `""`). The render layer (`linkedAnchorRenderAttrs`) appends
 * `":"` to build the `[data-link-card^="<token>:"]` prefix the per-kind CSS tint
 * rules read.
 *
 * SSOT: every live kind's token comes from `LEGACY_TOKEN_CROSSWALK`, so it can
 * never drift from the CSS selectors. The hand-rolled switch this replaced
 * (in `linked-anchor-attrs.ts`) covered only note/highlight/cut/revision — so a
 * restored `todo` / `cutter-comment` / `cutter-suggestion` / `report` mark fell
 * through to an EMPTY token and its Mode-B range tint silently vanished on
 * document reload (jump-to/range still recovered; only the paint was lost).
 *
 * Returns `null` for the `transient` sentinel (the cardless plain-grab handle —
 * no tint) and any unrecognised kind, so the caller emits an empty token.
 *
 * The legacy `cut` alias — dead in live code but still present on older
 * rich-content marks (see `normalize-rich-content-marks`) — is preserved
 * byte-identically as `"cut"`; its CSS rule resolves to the same red accent as
 * `cutter-comment`. (No spine kind carries the `legacyDataKind` `"cut"`, so it
 * cannot come from the crosswalk.)
 */
export function dataLinkCardTokenForLegacyMarkKind(kind: string): string | null {
  if (kind === "cut") return "cut";
  const cardKind = LEGACY_MARK_KIND_TO_CARD_KIND[kind];
  if (!cardKind) return null;
  return legacyDataKindForCardKind(cardKind);
}

/** Prefix of an ACCENT-SENTINEL tint value (see `accentTintForToken`). */
export const ACCENT_TINT_PREFIX = "accent:";

/**
 * Build the accent-sentinel tint for an in-text accent `token` — the value a
 * `linkedAnchor.tintColor` carries when its band is the kind's LIVE theme
 * accent rather than a per-instance hue.
 *
 * Why a sentinel and not a resolved hex (task 174): `tintColor` is a DOCUMENT
 * attribute, so a resolved hex freezes theme state into the user's prose. The
 * highlight band shipped `"#fbbf24"` — byte-identical to
 * `DEFAULT_PANEL_COLORS.highlight`, i.e. copied out of the theme and then
 * frozen — so overriding the Highlight panel color repainted the card, the
 * float and the in-text active ring (all of which read the live
 * `--link-anchor-accent-highlight` var stamped by `EditorLayout`) while the
 * band itself, the ENTIRE in-text identity of a highlight, stayed amber. That
 * is an unguarded escape from the #27 invariant: an in-text anchor's color
 * derives from the same accent source as its card outline.
 *
 * The sentinel is not a color, so `linkedAnchor.renderHTML` emits it as the
 * `data-tint-color` attr WITHOUT an inline `--tint-color` (no untrusted text in
 * `style`), and one static globals.css rule per token resolves it:
 *
 *   .linked-anchor[data-tint-color="accent:highlight"] {
 *     --tint-color: var(--link-anchor-accent-highlight, #fbbf24);
 *   }
 *
 * so the band follows a panel-color override LIVE — no re-stamp pass, no doc
 * walk on a color change, no keystroke-sanctity exposure. A per-instance hue
 * (the `#bfdbfe` pending-AI bands; a future per-card `highlightColor`) still
 * rides the attr as a literal hex and wins via the inline var.
 *
 * The token comes from `LEGACY_TOKEN_CROSSWALK`, the same table
 * `IN_TEXT_ANCHOR_ACCENTS` derives the CSS var name from, so the sentinel can
 * never name a token the accent map doesn't stamp.
 */
export function accentTintForToken(token: string): string {
  return `${ACCENT_TINT_PREFIX}${token}`;
}

/** The accent token an accent-sentinel tint names, or `null` for a literal hue
 *  (a per-instance hex) — the inverse of `accentTintForToken`. */
export function accentTokenFromTint(tint: string | null | undefined): string | null {
  if (typeof tint !== "string" || !tint.startsWith(ACCENT_TINT_PREFIX)) return null;
  const token = tint.slice(ACCENT_TINT_PREFIX.length);
  return token || null;
}

/**
 * The persistent highlight TINT a `linkedAnchor` of the given kind paints, or
 * `null` for every non-highlight kind. The SINGLE source for the Adobe-style
 * highlight band: the three create sites (the drag-handle Highlight action, the
 * EditorPane highlight action, the notes-host Highlight) AND the once-per-doc
 * reload re-stamp all derive the tint from HERE, so a highlight's tint is
 * byte-identical on create and on reload — closing the "highlight tint vanishes
 * on reload" class (the serializer drops `data-tint-color`, so reload must
 * reconstruct it from the kind, not from the `.tex`).
 *
 * The highlight value is an ACCENT SENTINEL, not a hex — see
 * `accentTintForToken`. No migration is needed for the pre-174 frozen
 * `"#fbbf24"`, and for a stronger reason than "the reload heals it": the attr
 * has **no on-disk carrier at all** — the serializer emits a bare `\vlid{id}`
 * and the parser rebuilds the mark with `tintColor: null` — so the old value
 * can only exist in a LIVE session's memory. Every doc open reconstructs the
 * tint from HERE (`reapply-mode-b-anchors`), and `applyLinkedAnchors` re-stamps
 * any mark whose live `tintColor` disagrees, so a session that spans the code
 * change converges on its next load.
 *
 * `kind` is the legacy `linkedAnchor.kind` namespace ("highlight" / "note" /
 * "revision" / …). A future per-card `highlightColor` override is layered by the
 * caller (it prefers a non-null card color), never here — this is the DEFAULT.
 */
export function defaultTintForLinkedAnchorKind(kind: string): string | null {
  // `pending-ai-change`: the light-blue band the headless AI-change applicator
  // paints over an applied-but-not-yet-kept suggestion (Phase 0). A
  // pending-DELETE variant renders the struck text differently in a later UI
  // phase; the tint string is what the Phase 0 unit tests assert.
  if (kind === "pending-ai-change") return "#bfdbfe";
  // `pending-ai-request`: the SAME light-blue band, painted over the anchored
  // text of an OPEN AI request (a note/todo/report-request/revision-comment/
  // cutter-comment card whose `aiRequest` flag is set) — the request-open twin
  // of `pending-ai-change`. A DISTINCT kind (independent lifecycle: request
  // marks clear on flag-off, applied marks clear on Keep/Revert) mapped to the
  // identical hex so the two look the same (Gabriel, 2026-07-03).
  if (kind === "pending-ai-request") return "#bfdbfe";
  // `highlight`: the theme-derived band. The token is read off the crosswalk
  // (not written as a literal) so the sentinel, the `data-link-card` selector
  // and the `--link-anchor-accent-<token>` var can never name three different
  // strings. Non-null by construction — `highlight.legacyDataKind` is
  // `"highlight"`, pinned by the dev assertion below.
  if (kind === "highlight") {
    const token = LEGACY_TOKEN_CROSSWALK.highlight.legacyDataKind;
    return token ? accentTintForToken(token) : null;
  }
  return null;
}

if (process.env.NODE_ENV !== "production") {
  // R-C dev pin: the two divergent mappings the CSS contract hinges on. If a
  // future edit changes either, the on-disk/CSS tokens drift silently — make
  // it loud here, where the declaration lives.
  if (LEGACY_TOKEN_CROSSWALK["revision-comment"].legacyDataKind !== "revision-comment") {
    console.error(
      `[legacy-token-crosswalk] revision-comment.legacyDataKind must be "revision-comment" ` +
        `(the data-link-card token the CSS [data-link-card^="revision-comment:"] rule reads — ` +
        `unified onto the spine kind so updateLinkedAnchorCard + the render fallback agree; ` +
        `"comment:" is kept only as a legacy CSS alias), ` +
        `got "${LEGACY_TOKEN_CROSSWALK["revision-comment"].legacyDataKind}".`,
    );
  }
  if (LEGACY_TOKEN_CROSSWALK.highlight.legacyDataKind !== "highlight") {
    console.error(
      `[legacy-token-crosswalk] highlight.legacyDataKind must be "highlight" — the ` +
        `tint SSOT builds the band's accent sentinel from it ` +
        `("${accentTintForToken("highlight")}"), and globals.css resolves that exact ` +
        `attribute value to var(--link-anchor-accent-highlight). A changed token ` +
        `silently un-paints every highlight band, got ` +
        `"${LEGACY_TOKEN_CROSSWALK.highlight.legacyDataKind}".`,
    );
  }
  if (LEGACY_TOKEN_CROSSWALK["cutter-comment"].cssToken !== "cut") {
    console.error(
      `[legacy-token-crosswalk] cutter-comment.cssToken must be "cut" (the ` +
        `data-paragraph-kind token the CSS rule reads), got ` +
        `"${LEGACY_TOKEN_CROSSWALK["cutter-comment"].cssToken}".`,
    );
  }
  // Pin CARD_KIND_TO_LEGACY_MARK_KIND as the faithful inverse of
  // LEGACY_MARK_KIND_TO_CARD_KIND: every legacy mark kind must round-trip
  // (markKind → spine → markKind). If a future edit adds a mark kind to one map
  // but not the other, the morph restamp would stamp a stale/absent kind.
  for (const [markKind, spine] of Object.entries(LEGACY_MARK_KIND_TO_CARD_KIND)) {
    if (CARD_KIND_TO_LEGACY_MARK_KIND[spine] !== markKind) {
      console.error(
        `[legacy-token-crosswalk] CARD_KIND_TO_LEGACY_MARK_KIND["${spine}"] must be ` +
          `"${markKind}" (the inverse of LEGACY_MARK_KIND_TO_CARD_KIND), got ` +
          `"${CARD_KIND_TO_LEGACY_MARK_KIND[spine]}".`,
      );
    }
  }
}
