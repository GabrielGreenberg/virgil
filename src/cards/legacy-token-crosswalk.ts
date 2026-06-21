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

/**
 * The persistent highlight TINT a `linkedAnchor` of the given kind paints, or
 * `null` for every non-highlight kind. The SINGLE source for the Adobe-style
 * yellow band: the three create sites (the drag-handle Highlight action, the
 * EditorPane highlight action, the notes-host Highlight) AND the once-per-doc
 * reload re-stamp all derive the tint from HERE, so a highlight's tint is
 * byte-identical on create and on reload — closing the "highlight tint vanishes
 * on reload" class (the serializer drops `data-tint-color`, so reload must
 * reconstruct it from the kind, not from the `.tex`).
 *
 * `kind` is the legacy `linkedAnchor.kind` namespace ("highlight" / "note" /
 * "revision" / …). A future per-card `highlightColor` override is layered by the
 * caller (it prefers a non-null card color), never here — this is the DEFAULT.
 */
export function defaultTintForLinkedAnchorKind(kind: string): string | null {
  return kind === "highlight" ? "#fbbf24" : null;
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
  if (LEGACY_TOKEN_CROSSWALK["cutter-comment"].cssToken !== "cut") {
    console.error(
      `[legacy-token-crosswalk] cutter-comment.cssToken must be "cut" (the ` +
        `data-paragraph-kind token the CSS rule reads), got ` +
        `"${LEGACY_TOKEN_CROSSWALK["cutter-comment"].cssToken}".`,
    );
  }
}
