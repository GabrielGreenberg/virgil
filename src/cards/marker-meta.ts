/**
 * Registry-derived marker metadata (A6/R17). The margin's per-`MarkerType`
 * facts that are really CARD facts — which card kinds share a marker
 * namespace, which panel owns it, which theme key colors it — are derived
 * HERE from `CARD_REGISTRY`, the card-spine SSOT. The marginalia-local
 * presentation fields (`label` / `defaultSide` / `icon`) stay in
 * `MARKER_META` (`src/lib/marginalia.ts`), which composes these helpers.
 *
 * **Cycle-safe by construction**: this module imports only the runtime-leaf
 * `card-registry.tsx` plus types (`./types`, and `PanelThemeKey` /
 * `PanelKind` type-only). It must never import `@/lib/marginalia`,
 * `panel-registry`, or any card UI — `lib/marginalia.ts` imports *this*
 * module at init time to build `MARKER_META`.
 */
import type { PanelKind } from "@/panels/_shared/types";
import type { PanelThemeKey } from "@/lib/panel-theme";
import type { CardKind, MarkerType } from "./types";
import { CARD_REGISTRY } from "./card-registry";

/**
 * Runtime mirror of the `MarkerType` union, type-pinned in both directions:
 * `satisfies` rejects a stray member, and `_MarkerTypeExhaustive` fails to
 * compile if a union member is missing from the array. Because `MARKER_META`
 * is a `Record<MarkerType, MarkerMeta>`, "registry markerTypes ≡ MARKER_META
 * keys" reduces to "registry markerTypes ≡ this array" (checked by
 * `assertMarkerCoverage` below) — no runtime import of `MARKER_META` needed.
 */
export const ALL_MARKER_TYPES = [
  "note",
  "archive",
  "revision",
  "cut",
  "todo",
  "report",
  "error",
  "pending-change",
] as const satisfies readonly MarkerType[];
type _MarkerTypeExhaustive = MarkerType extends (typeof ALL_MARKER_TYPES)[number]
  ? true
  : never;
const _markerTypeExhaustive: _MarkerTypeExhaustive = true;
void _markerTypeExhaustive;

/**
 * Marker types that are NOT declared by any `CARD_REGISTRY` kind — they are
 * DERIVED in the margin from a card *status* (not owned by a dedicated card
 * kind), so the registry-coverage assertions must not flag them as orphan rows.
 *
 * `pending-change` (Phase 1c) is emitted for `status:"applied"`
 * revision-suggestion / cutter-suggestion cards. Those kinds already declare
 * their base `revision`/`cut` marker (a kind may declare only one `markerType`),
 * so the pending-change presence marker has no registry declarer. Its
 * panel/theme are pinned here (`PENDING_CHANGE_PANEL` / `…_THEME_KEY`) rather
 * than derived from the registry, and its palette is the fixed `#bfdbfe`
 * applied-range blue baked directly into `MARKER_META` (non-overridable).
 */
export const NON_REGISTRY_MARKER_TYPES: ReadonlySet<MarkerType> =
  new Set<MarkerType>(["pending-change"]);

/** Owning panel for the derived `pending-change` marker — it docks with the
 *  Revisions panel (the suggestion family's primary home; the cutter family
 *  shares the same blue presence marker). Drives only the marker's margin side. */
export const PENDING_CHANGE_PANEL: PanelKind = "revisions";
/** Theme slot the `pending-change` marker reports. It is NOT a real
 *  `PanelThemeKey` color slot — the marker's palette is the fixed `#bfdbfe`
 *  blue in `MARKER_META`, and `MarkerButton` short-circuits the override path
 *  for this marker so a user's Revisions-panel color override never re-tints
 *  it. Reuses the `"revision"` slot only so `panelThemeKeyForMarkerType` returns
 *  a valid `PanelThemeKey` (the value is never consulted for this type's color). */
export const PENDING_CHANGE_THEME_KEY: PanelThemeKey = "revision";

/* ── Eager derivation tables ──────────────────────────────────────────
 * Built once at module init. `CARD_REGISTRY` is a fully-initialized const
 * by the time this module evaluates (no import cycle), and the tables are
 * tiny (≤16 entries), so eager is simpler than lazy. Per-render callers
 * (e.g. `MarkerButton`) get O(1) lookups. */

const kindsByMarkerType = new Map<MarkerType, CardKind[]>();
for (const kind of Object.keys(CARD_REGISTRY) as CardKind[]) {
  const t = CARD_REGISTRY[kind].markerType;
  if (t == null) continue;
  const row = kindsByMarkerType.get(t) ?? [];
  row.push(kind);
  kindsByMarkerType.set(t, row);
}

const panelByMarkerType = new Map<MarkerType, PanelKind>();
const themeKeyByMarkerType = new Map<MarkerType, PanelThemeKey>();
for (const [t, kinds] of kindsByMarkerType) {
  const panels = new Set(kinds.map((k) => CARD_REGISTRY[k].panel));
  const themeKeys = new Set(kinds.map((k) => CARD_REGISTRY[k].themeKey));
  if (process.env.NODE_ENV !== "production") {
    // Per-type uniqueness: every card kind sharing a marker namespace must
    // agree on its owning panel and theme key — a marker routes clicks and
    // colors per TYPE, so a split here would be silently wrong.
    if (panels.size !== 1) {
      console.error(
        `[MarkerMeta] markerType "${t}" maps to multiple panels ` +
          `(${[...panels].join(", ")}) across kinds ${kinds.join(", ")}.`,
      );
    }
    if (themeKeys.size !== 1) {
      console.error(
        `[MarkerMeta] markerType "${t}" maps to multiple theme keys ` +
          `(${[...themeKeys].join(", ")}) across kinds ${kinds.join(", ")}.`,
      );
    }
  }
  const panel = kinds.length > 0 ? CARD_REGISTRY[kinds[0]].panel : null;
  if (panel != null) panelByMarkerType.set(t, panel);
  const themeKey = kinds.length > 0 ? CARD_REGISTRY[kinds[0]].themeKey : null;
  // Post-A10/B the registry themeKey vocabulary IS PanelThemeKey (the
  // comment→revision crosswalk that used to bridge the one divergent token
  // is gone) — every marker-bearing themeKey is the color slot verbatim
  // (pinned by marker-meta-derivation.test.ts).
  if (themeKey != null) themeKeyByMarkerType.set(t, themeKey);
}

/** The card kinds that share marker namespace `t` (e.g. `cut` →
 *  `["cutter-comment", "cutter-suggestion"]`). */
export function cardKindsForMarkerType(t: MarkerType): CardKind[] {
  return kindsByMarkerType.get(t) ?? [];
}

/** The panel that owns marker namespace `t` — derived from the registry
 *  `.panel` of its card kinds (asserted unique per type). The non-registry
 *  `pending-change` marker (no declaring kind) returns its pinned panel. */
export function panelForMarkerType(t: MarkerType): PanelKind {
  if (NON_REGISTRY_MARKER_TYPES.has(t)) return PENDING_CHANGE_PANEL;
  const panel = panelByMarkerType.get(t);
  if (!panel) {
    // Unreachable when assertMarkerCoverage holds; throw loudly rather than
    // mis-route a marker.
    throw new Error(`[MarkerMeta] no panel derived for markerType "${t}"`);
  }
  return panel;
}

/** The user-overridable color slot for marker namespace `t` — the registry
 *  `.themeKey` verbatim (one keyspace post-A10/B). The non-registry
 *  `pending-change` marker returns its pinned slot; its palette is fixed in
 *  `MARKER_META` and `MarkerButton` skips the override path for it, so the slot
 *  is never consulted for its color. */
export function panelThemeKeyForMarkerType(t: MarkerType): PanelThemeKey {
  if (NON_REGISTRY_MARKER_TYPES.has(t)) return PENDING_CHANGE_THEME_KEY;
  const key = themeKeyByMarkerType.get(t);
  if (!key) {
    throw new Error(`[MarkerMeta] no theme key derived for markerType "${t}"`);
  }
  return key;
}

/** Dev-only boot assertion (call beside `assertMorphCoverage`): the set of
 *  distinct non-null `markerType`s declared in `CARD_REGISTRY` must equal
 *  `ALL_MARKER_TYPES` (≡ the `MarkerType` union ≡ `MARKER_META`'s keys, by
 *  the type pins above). Catches a registry kind declaring a markerType the
 *  margin has no row for, or a marker row no kind produces. */
export function assertMarkerCoverage(): void {
  if (process.env.NODE_ENV === "production") return;
  const declared = new Set<MarkerType>(kindsByMarkerType.keys());
  for (const t of ALL_MARKER_TYPES) {
    // Non-registry markers (e.g. `pending-change`) are derived from a card
    // STATUS, not declared by a kind — exempt them from the declarer check.
    if (NON_REGISTRY_MARKER_TYPES.has(t)) continue;
    if (!declared.has(t)) {
      console.error(
        `[MarkerMeta] MarkerType "${t}" has a MARKER_META row but no ` +
          `CARD_REGISTRY kind declares it.`,
      );
    }
  }
  for (const t of declared) {
    if (!(ALL_MARKER_TYPES as readonly MarkerType[]).includes(t)) {
      console.error(
        `[MarkerMeta] CARD_REGISTRY declares markerType "${t}" that is not ` +
          `in ALL_MARKER_TYPES / MARKER_META.`,
      );
    }
  }
}
