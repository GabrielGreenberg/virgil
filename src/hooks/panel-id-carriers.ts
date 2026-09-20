/**
 * THE CENSUS: which `ViewPrefs` fields carry panel ids, how each one holds
 * them, and which live registry decides whether an id it holds is still real.
 *
 * A pure module — it imports only TYPES — so both of its readers can value-
 * import it with no cycle, and both of their suites run in the bare node env
 * with no mocks.
 *
 * ## Why it is its own module (task 675)
 *
 * A `PanelId` is a key or member in ten persisted carriers (eleven until task
 * 678 retired the write-only `poppedOutOrigins`), and TWO
 * operations run over all of them at load. They are exact twins:
 *
 *  - the ADDITIVE one — `applyPanelRenames` (`rename-panel-id.ts`, task 275):
 *    rewrite a retired id to its heir in every carrier;
 *  - the SUBTRACTIVE one — `scrubUnknownPanelIds` (`dropUnknownPanelIds.ts`):
 *    drop any id that is no longer a member of its carrier's live registry.
 *
 * Task 275 built this census, but built it INSIDE the rename module — so only
 * the additive half read it. The subtractive half stayed four hand-inlined
 * functions over three hardcoded allowlists, each wired up by hand in the
 * loader — so FOUR panel-keyed carriers reached it with no key check at all.
 * `panelHeights`, `panelModes`, `floatPositions` and `cardArchiveView` kept a
 * retired id forever, re-serialized on every write, ready to apply a dead
 * panel's band height / float rect / mode / archive view to whatever newcomer
 * someday reuses the id. Nothing would have noticed, because nothing forced a
 * new carrier to join the scrub.
 *
 * So the rule this module exists to keep:
 *
 * > **"Which prefs fields are panel-keyed" is ONE fact, stated ONCE, and every
 * > operation over panel ids reads it.** A new collection-shaped layout field
 * > is a COMPILE ERROR here until it is classified — and classifying it once
 * > enrolls it in BOTH the rename and the scrub, in the same edit.
 *
 * That is the whole guard. Neither applier was ever the part that could
 * misbehave; a carrier nobody classified is.
 *
 * ## What this deliberately does NOT cover
 *
 * Several neighbouring vocabularies SPELL panel kinds while meaning something
 * else, and a blob-wide rewrite over them would be actively destructive:
 *
 * - `hiddenMarginaliaTypes` / `hiddenHighlightTypes` hold CARD kinds (`note`,
 *   `todo`, `archive`, `comment`). They are `RegistryPrefs` fields, so the
 *   census below excludes them BY CONSTRUCTION rather than by anyone
 *   remembering to skip them — and a new view toggle stays ONE registry row
 *   with zero edits here (task 274).
 * - `poppedOutCards` / `cardFloatPositions` are keyed by float CARD keys, and
 *   `panelWidths` / `omniHideAllCards` by `Side`. They are classified `null`
 *   below: an answer ("it is keyed by X"), not an omission.
 */
import type { RegistryPrefs } from "@/lib/view-prefs/registry";
import type { ViewPrefs } from "./useViewPrefs";

/** How a carrier holds panel ids.
 *
 *  - `placements`   — `{ id, side }[]`; the id is a FIELD of each entry.
 *  - `id-list`      — `PanelId[]`.
 *  - `sided-id-list`— `{ left: PanelId[]; right: PanelId[] }`.
 *  - `id-record`    — `Record<PanelId, V>`; the id is the KEY.
 *  - `print-panels` — an `id-record` one level down, at `.panels`. */
export type CarrierShape =
  | "placements"
  | "id-list"
  | "sided-id-list"
  | "id-record"
  | "print-panels";

/**
 * Which live registry says an id in this carrier is still real. The three sets
 * are NOT interchangeable — a carrier validated against the wrong one silently
 * drops live state:
 *
 *  - `panel` → keys of `PANEL_REGISTRY` (every `PanelKind`).
 *  - `omni`  → `OMNI_PANELS` kinds (the omni-eligible subset).
 *  - `print` → keys of `PRINT_PANELS` (`PrintPanelKey`, its own vocabulary).
 *
 * The sets themselves live with the scrub, which is the half that needs them
 * at runtime; naming them here keeps this module free of runtime imports.
 */
export type CarrierVocabulary = "panel" | "omni" | "print";

/** One classified carrier: its shape (how the ids sit) and its vocabulary
 *  (which registry may keep them). Both operations need the shape; only the
 *  subtractive one needs the vocabulary — a rename is a fact about an id, and
 *  applies wherever that id is spelled. */
export interface PanelIdCarrier {
  readonly shape: CarrierShape;
  readonly vocabulary: CarrierVocabulary;
}

/** The hand-authored structural slice of `ViewPrefs` — `RegistryPrefs`-owned
 *  fields excluded by construction (see the header). Panel ids live in the
 *  layout vocabulary, which is exactly what remains. */
type StructuralPrefs = Omit<ViewPrefs, keyof RegistryPrefs>;

/** Every collection-shaped structural field — an object or array, i.e. the
 *  only shapes that can carry an id at all. Derived, so a new layout
 *  collection is a COMPILE ERROR in `PANEL_ID_CARRIERS` until someone states
 *  whether it is panel-keyed. */
export type CollectionPrefField = {
  [K in keyof StructuralPrefs]-?: StructuralPrefs[K] extends object ? K : never;
}[keyof StructuralPrefs];

/**
 * TOTAL classification of the structural collections. `null` states "not
 * panel-keyed" and says what it IS keyed by — an answer, not an omission.
 */
export const PANEL_ID_CARRIERS: Readonly<
  Record<CollectionPrefField, PanelIdCarrier | null>
> = {
  placements: { shape: "placements", vocabulary: "panel" },
  dockStack: { shape: "sided-id-list", vocabulary: "panel" },
  // Session-only: `loadPrefs` resets the MRU to empty right after both
  // operations run, so renaming and scrubbing it are no-ops TODAY. It is
  // classified honestly rather than exempted — the day recency persists, both
  // are already correct.
  panelMRU: { shape: "sided-id-list", vocabulary: "panel" },
  panelHeights: { shape: "id-record", vocabulary: "panel" },
  poppedOutPanels: { shape: "id-list", vocabulary: "panel" },
  panelModes: { shape: "id-record", vocabulary: "panel" },
  floatPositions: { shape: "id-record", vocabulary: "panel" },
  cardArchiveView: { shape: "id-record", vocabulary: "panel" },
  // Omni CATEGORIES are the omni-eligible PanelKinds — a strict subset. Scrub
  // it against the full panel registry and every non-omni panel id survives.
  omniHiddenCategories: { shape: "id-list", vocabulary: "omni" },
  // `printOptions` is not itself a carrier; its `.panels` record is, keyed by
  // `PrintPanelKey` — a vocabulary of its own that merely overlaps panel kinds.
  printOptions: { shape: "print-panels", vocabulary: "print" },

  // Not panel-keyed:
  panelWidths: null, // keyed by Side (`"left"` / `"right"`)
  omniHideAllCards: null, // keyed by Side
  poppedOutCards: null, // keyed by float card key (`float:<domain>:<kind>:<id>`)
  cardFloatPositions: null, // keyed by float card key
  appliedPrefMigrations: null, // keyed by nothing — migration ids, not panels
};

/**
 * Carriers a PAST build persisted that the live `ViewPrefs` type no longer
 * has. The type-derived census above is total over the LIVE collections and
 * therefore structurally cannot name one, so they are declared here.
 *
 * RENAME-ONLY, and that asymmetry is deliberate. Renaming them matters
 * whenever a LATER migration reads them: task 381's omni fold reads the
 * pre-381 per-side `omniCategories` blob to derive the side-free hidden set,
 * and it must see `revisions`, not the retired `comments`, or the heir lands
 * in the hidden set instead of the enabled one. SCRUBBING them would be at
 * best inert and at worst wrong — each is consumed by a fold that derives
 * against the live set itself (`hiddenFromLegacySides` returns
 * `OMNI_CATEGORIES.filter(c => !enabled.has(c))`, so an unknown id in the
 * input is already inert), and a fold that computes a COMPLEMENT can have its
 * meaning flipped by dropping members of its input.
 */
export const LEGACY_ID_CARRIERS: Readonly<
  Record<string, Exclude<CarrierShape, "placements">>
> = {
  omniCategories: "sided-id-list",
};
