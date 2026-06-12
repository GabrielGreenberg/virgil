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
 * is `"cutter-comment"`/`"cutter-suggestion"` but `cssToken` is `"cut"`), so
 * they are declared as two columns, not one.
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
  todo:                  { legacyDataKind: null,               cssToken: "todo" },
  archive:               { legacyDataKind: null,               cssToken: "archive" },
  report:                { legacyDataKind: "report",           cssToken: "report" },
  "report-request":      { legacyDataKind: "report-request",   cssToken: "report" },
  "revision-comment":    { legacyDataKind: "comment",          cssToken: "comment" },
  "revision-suggestion": { legacyDataKind: "comment",          cssToken: "comment" },
  "cutter-comment":      { legacyDataKind: "cutter-comment",   cssToken: "cut" },
  "cutter-suggestion":   { legacyDataKind: "cutter-suggestion", cssToken: "cut" },
  bib:                   { legacyDataKind: null,               cssToken: null },
  ai:                    { legacyDataKind: null,               cssToken: null },
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

if (process.env.NODE_ENV !== "production") {
  // R-C dev pin: the two divergent mappings the CSS contract hinges on. If a
  // future edit changes either, the on-disk/CSS tokens drift silently — make
  // it loud here, where the declaration lives.
  if (LEGACY_TOKEN_CROSSWALK["revision-comment"].legacyDataKind !== "comment") {
    console.error(
      `[legacy-token-crosswalk] revision-comment.legacyDataKind must be "comment" ` +
        `(the data-link-card token the CSS [data-link-card^="comment:"] rule reads), ` +
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
