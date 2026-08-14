/**
 * Load-time panel-RENAME migration — the additive/rewrite twin of the purely
 * subtractive `dropUnknownPanelIds`.
 *
 * A pure module: it imports only TYPES (from `useViewPrefs` and the view-pref
 * registry), so it has ZERO runtime imports, `useViewPrefs.ts` can value-import
 * it with no cycle, and its suite runs in the bare node env with no mocks — the
 * same discipline `view-prefs-dock` and `view-prefs-derived` follow.
 *
 * WHY IT EXISTS (task 275). `loadPrefs` carried three hand-inlined panel
 * renames — `references` → `citations` + `bibliography`, `comments` → `notes` +
 * `revisions`, `suggestions` → `revisions` — and each one rewrote exactly TWO
 * things: `parsed.placements` and the legacy `activeLeft`/`activeRight`
 * scalars. But a `PanelId` is a key or member in ELEVEN persisted carriers, and
 * the other nine were never renamed. They failed in two directions, both
 * silent:
 *
 *  - **Subtractive carriers DROPPED the old id** instead of renaming it, because
 *    the cleaners run against the live registry: `dockStack` (via `clampStack`),
 *    `poppedOutPanels` (via `validPanelId`), `poppedOutOrigins`,
 *    `omniCategories` (via `filterOmniCategories`), `printOptions.panels` (via
 *    `filterPrintPanels`). A panel docked or floating under the old id simply
 *    VANISHED on the upgrade reload instead of becoming its renamed successor.
 *  - **Passthrough carriers KEPT an orphan key** forever: `panelHeights`,
 *    `panelModes`, `floatPositions`, `cardArchiveView`. The renamed panel lost
 *    its saved rect / band height / mode / archive-view, and the dead key
 *    re-serialized on every write.
 *
 * There was no `renamePanelId` semantic sibling to `dropUnknownPanelIds` —
 * only a subtractive cleaner and three copies of a two-carrier rename template.
 * So the rule this module exists to keep:
 *
 * > **A panel rename is a fact about an ID, not about one carrier.** It is
 * > declared ONCE in `PANEL_RENAMES` and applied by `applyPanelRenames` to
 * > EVERY PanelId-keyed carrier, before any subtractive cleaner runs.
 *
 * Reachability of the original defect was latent (`references` / `comments` /
 * `suggestions` predate the dockStack model and the float/mode/height/archive
 * carriers, so no real blob ever carried those keys under the old ids). The
 * cost was FORWARD: the stale two-carrier template was the thing the next
 * renamer would copy, and by then every one of those carriers is populated.
 *
 * ## The heir model
 *
 * Two of the three shipped renames are SPLITS (one panel became two), so a
 * rename names one `to` — the **heir**, which inherits the old id's identity in
 * every carrier — plus optional `alsoPlace` ids, which are genuinely NEW panels
 * and therefore join `placements` only. Every other carrier already has a
 * default for a new panel; inventing a dock slot or a float rect for one would
 * be fabricating state the user never set.
 *
 * ## Collision rule: the LIVE entry wins
 *
 * When a blob already carries the heir (e.g. `suggestions` folded into a
 * `revisions` that is already docked), the rename must not mint a duplicate.
 * The pre-existing `to` entry is kept as-is and the `from` entry is dropped —
 * it is the one the user has actually been using under the current build.
 *
 * ## Cross-side duplicates are NOT this module's job
 *
 * Renaming can leave the heir docked on both sides (old id left, heir right).
 * `clampStack` already excludes any right-side id present on the left, and it
 * runs after this — so the sided rewrites here stay per-side, rather than
 * re-deriving a rule the loader's cleaner owns.
 *
 * ## What this deliberately does NOT touch
 *
 * A blob-wide string rewrite would be actively destructive, because several
 * neighbouring vocabularies SPELL THE SAME WORDS while meaning something else:
 *
 * - `hiddenMarginaliaTypes` / `hiddenHighlightTypes` hold CARD kinds — `note`,
 *   `todo`, `archive`, `comment` — that collide by spelling with `PanelKind`s.
 *   They are `RegistryPrefs` fields, so the carrier census below excludes them
 *   BY CONSTRUCTION rather than by anyone remembering to skip them.
 * - `virgil-panel-colors` / `virgil-panel-typography` are keyed by card/theme
 *   keys (`citation`, `footnote`, `archive`, …) despite the "panel" in their
 *   names, and `poppedOutCards` / `cardFloatPositions` by float CARD keys. All
 *   four are other stores or non-carriers here.
 * - The shipped `*.defaults.json` sidecars and the non-persisted `PanelId`-keyed
 *   source maps (`PANEL_ICONS`, `PANEL_KIND_TO_BODY_KEY`, …) are SOURCE. A
 *   rename edits them; a load migration cannot.
 *
 * Scope of the fix, stated: this migrates the blob the CURRENT window loads.
 * Every other window's per-window blob is migrated by its own `loadPrefs` on
 * its own next load, which is the same self-healing shape the subtractive
 * cleaner already has — not a gap, but not instantaneous either.
 */
import type { RegistryPrefs } from "@/lib/view-prefs/registry";
import type { ViewPrefs } from "./useViewPrefs";

/** One panel rename.
 *
 *  - `from` — the retired id, as some past build persisted it.
 *  - `to` — the HEIR: inherits `from`'s slot/rect/mode/height/view/membership
 *    in every carrier.
 *  - `alsoPlace` — ids that came into existence WITH the rename (a split).
 *    Added to `placements` beside the heir, and nowhere else.
 *
 *  Typed as plain `string` rather than `PanelId`: `from` is by definition an id
 *  the live union no longer has, so the union cannot describe it. */
export interface PanelRename {
  readonly from: string;
  readonly to: string;
  readonly alsoPlace?: readonly string[];
}

/**
 * The three shipped renames, as DATA. Order matters: `comments` → `revisions`
 * runs before `suggestions` → `revisions`, so a blob carrying both lands on one
 * de-duplicated `revisions` rather than two.
 */
export const PANEL_RENAMES: readonly PanelRename[] = [
  // The old `references` panel split into `citations` + `bibliography`.
  // `citations` is the heir — it is what the pre-275 migration rewrote
  // `activeLeft === "references"` to.
  { from: "references", to: "citations", alsoPlace: ["bibliography"] },
  // The old `comments` panel split into `notes` + `revisions`. `revisions` is
  // the heir, for the same reason.
  { from: "comments", to: "revisions", alsoPlace: ["notes"] },
  // The standalone `suggestions` panel was folded INTO `revisions` (suggestion
  // cards now live alongside comment cards in one panel). A pure fold: no new
  // panel came into existence, so no `alsoPlace`.
  { from: "suggestions", to: "revisions" },
] as const;

/**
 * Legacy per-side scalars that hold a single panel id. Deleted by `loadPrefs`
 * AFTER they seed `legacyStack`, so they must be renamed before that — an
 * ancient blob with no `dockStack` derives its whole open layout from them.
 *
 * All FOUR are covered. The pre-275 inline template rewrote only the two
 * top-slot keys, so a legacy split layout whose SECOND band was the renamed
 * panel lost that band on upgrade — the same defect one field over.
 */
const LEGACY_ACTIVE_PANEL_KEYS = [
  "activeLeft",
  "activeRight",
  "activeLeftBottom",
  "activeRightBottom",
] as const;

/* ── The carrier census ───────────────────────────────────────────────── */

/** How a carrier holds panel ids.
 *
 *  - `placements`   — `{ id, side }[]`; the id is a FIELD of each entry.
 *  - `id-list`      — `PanelId[]`.
 *  - `sided-id-list`— `{ left: PanelId[]; right: PanelId[] }`.
 *  - `id-record`    — `Record<PanelId, V>`; the id is the KEY.
 *  - `print-panels` — an `id-record` one level down, at `.panels`. */
type CarrierShape =
  | "placements"
  | "id-list"
  | "sided-id-list"
  | "id-record"
  | "print-panels";

/** The hand-authored structural slice of `ViewPrefs`.
 *
 *  `RegistryPrefs`-owned fields are excluded BY CONSTRUCTION, so adding a view
 *  toggle stays ONE registry row with zero edits anywhere else (task 274) — a
 *  new `set`-kind pref must never land a compile error in this file. Panel ids
 *  live in the layout vocabulary, which is exactly what remains. */
type StructuralPrefs = Omit<ViewPrefs, keyof RegistryPrefs>;

/** Every collection-shaped structural field — an object or array, i.e. the only
 *  shapes that can carry an id at all. Derived, so a new layout collection is a
 *  COMPILE ERROR in `PANEL_ID_CARRIERS` until someone states whether it is
 *  panel-keyed. That is the whole guard: the applier was never the part that
 *  could misbehave — a carrier nobody classified is. */
type CollectionPrefField = {
  [K in keyof StructuralPrefs]-?: StructuralPrefs[K] extends object ? K : never;
}[keyof StructuralPrefs];

/**
 * TOTAL classification of the structural collections. `null` states "not
 * panel-keyed" and says what it IS keyed by — an answer, not an omission.
 */
const PANEL_ID_CARRIERS: Readonly<Record<CollectionPrefField, CarrierShape | null>> = {
  placements: "placements",
  dockStack: "sided-id-list",
  // Session-only: `loadPrefs` resets the MRU to empty right after this runs, so
  // renaming it is a no-op TODAY. It is classified honestly rather than
  // exempted — the day recency persists, the rename is already correct.
  panelMRU: "sided-id-list",
  panelHeights: "id-record",
  poppedOutPanels: "id-list",
  poppedOutOrigins: "id-record",
  panelModes: "id-record",
  floatPositions: "id-record",
  cardArchiveView: "id-record",
  omniCategories: "sided-id-list",
  printOptions: "print-panels",

  // Not panel-keyed:
  panelWidths: null, // keyed by Side (`"left"` / `"right"`)
  omniHideAllCards: null, // keyed by Side
  poppedOutCards: null, // keyed by float card key (`float:<domain>:<kind>:<id>`)
  cardFloatPositions: null, // keyed by float card key
};

/* ── Per-shape rewrites ───────────────────────────────────────────────── */

/** A rewrite returns the NEW value, or `undefined` for "nothing to do here"
 *  (wrong shape, or the old id simply isn't present). Malformed-safe by
 *  construction: an unrecognized shape is left untouched, never thrown on. */
type Rewrite = (value: unknown, from: string, to: string) => unknown | undefined;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** `PanelId[]` — rename in place, keeping the retired id's ORDER (a dock stack's
 *  index is its band position, and a rename should not reshuffle the columns).
 *
 *  On a collision the live heir keeps its OWN position and the retired entry is
 *  dropped — the same rule the record and placement rewrites follow, rather
 *  than renaming the retired id onto the heir's slot and moving the band. Only
 *  `to` is ever de-duplicated: a pre-existing duplicate of some other id is not
 *  this migration's to fix, and rewriting it would make the rename's blast
 *  radius wider than the rename. */
const rewriteIdList: Rewrite = (value, from, to) => {
  if (!Array.isArray(value)) return undefined;
  if (!value.includes(from)) return undefined;
  if (value.includes(to)) return value.filter((x) => x !== from);
  const out: unknown[] = [];
  let sawHeir = false;
  for (const x of value) {
    const next = x === from ? to : x;
    // A blob carrying the retired id TWICE would otherwise mint two heirs.
    if (next === to) {
      if (sawHeir) continue;
      sawHeir = true;
    }
    out.push(next);
  }
  return out;
};

/** `{ left: PanelId[]; right: PanelId[] }` — each side independently (see the
 *  header: cross-side duplicates belong to `clampStack`). */
const rewriteSidedIdList: Rewrite = (value, from, to) => {
  if (!isPlainObject(value)) return undefined;
  const left = rewriteIdList(value.left, from, to);
  const right = rewriteIdList(value.right, from, to);
  if (left === undefined && right === undefined) return undefined;
  return { ...value, left: left ?? value.left, right: right ?? value.right };
};

/** `Record<PanelId, V>` — move the value onto the heir's key IN PLACE, so key
 *  order is stable. A live heir entry wins the collision. */
const rewriteIdRecord: Rewrite = (value, from, to) => {
  if (!isPlainObject(value)) return undefined;
  if (!(from in value)) return undefined;
  const heirAlreadyThere = to in value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === from) {
      if (!heirAlreadyThere) out[to] = v;
      continue;
    }
    out[k] = v;
  }
  return out;
};

/** `printOptions` — an `id-record` at `.panels`; every other print option
 *  passes through untouched. */
const rewritePrintPanels: Rewrite = (value, from, to) => {
  if (!isPlainObject(value)) return undefined;
  const panels = rewriteIdRecord(value.panels, from, to);
  if (panels === undefined) return undefined;
  return { ...value, panels };
};

const REWRITES: Readonly<Record<Exclude<CarrierShape, "placements">, Rewrite>> = {
  "id-list": rewriteIdList,
  "sided-id-list": rewriteSidedIdList,
  "id-record": rewriteIdRecord,
  "print-panels": rewritePrintPanels,
};

function placementId(entry: unknown): unknown {
  return isPlainObject(entry) ? entry.id : undefined;
}

/**
 * `placements` — the one carrier that also lands `alsoPlace`.
 *
 * The heir keeps the old panel's INDEX and `side` (a rename should not move a
 * panel's strip icon), and the split's new panels are inserted immediately
 * after it on the same side. The pre-275 template filtered the old entry out
 * and pushed both successors onto the END; preserving position is both more
 * faithful to "rename" and what makes the heir's index reusable by the extras.
 */
function rewritePlacements(value: unknown, r: PanelRename): unknown | undefined {
  if (!Array.isArray(value)) return undefined;
  if (!value.some((p) => placementId(p) === r.from)) return undefined;

  const heirAlreadyPlaced = value.some((p) => placementId(p) === r.to);
  const out: unknown[] = [];
  let heirIndex = -1;
  for (const entry of value) {
    if (placementId(entry) === r.from) {
      // A live heir placement wins — drop the retired entry rather than mint a
      // second placement for the same panel.
      if (heirAlreadyPlaced) continue;
      out.push({ ...(entry as Record<string, unknown>), id: r.to });
      heirIndex = out.length - 1;
      continue;
    }
    out.push(entry);
    if (placementId(entry) === r.to) heirIndex = out.length - 1;
  }

  const extras = (r.alsoPlace ?? []).filter(
    (id) => !out.some((p) => placementId(p) === id),
  );
  if (extras.length > 0 && heirIndex >= 0) {
    const side = (out[heirIndex] as Record<string, unknown>).side;
    out.splice(heirIndex + 1, 0, ...extras.map((id) => ({ id, side })));
  }
  return out;
}

/* ── The applier ──────────────────────────────────────────────────────── */

function applyOne(
  blob: Record<string, unknown>,
  rename: PanelRename,
): Record<string, unknown> {
  let out: Record<string, unknown> | null = null;
  const write = (field: string, value: unknown) => {
    (out ??= { ...blob })[field] = value;
  };

  for (const [field, shape] of Object.entries(PANEL_ID_CARRIERS) as [
    string,
    CarrierShape | null,
  ][]) {
    if (shape === null) continue;
    const next =
      shape === "placements"
        ? rewritePlacements(blob[field], rename)
        : REWRITES[shape](blob[field], rename.from, rename.to);
    if (next !== undefined) write(field, next);
  }

  for (const key of LEGACY_ACTIVE_PANEL_KEYS) {
    if (blob[key] === rename.from) write(key, rename.to);
  }

  return out ?? blob;
}

/**
 * Rewrite every retired panel id in a raw prefs blob to its heir, across every
 * PanelId-keyed carrier.
 *
 * PURE: returns a new object when anything changed and the SAME object when
 * nothing did (so an already-migrated blob costs one shallow scan and no
 * allocation). Malformed carriers are left untouched rather than thrown on —
 * the loader's `try` would otherwise turn one bad key into a full reset to
 * defaults.
 *
 * `renames` is REQUIRED and deliberately undefaulted, for the reason
 * `clampStack`'s `max` is: a default is a decision nobody made. Production
 * passes `PANEL_RENAMES`; a suite passes its own table.
 *
 * MUST run BEFORE the subtractive cleaners (`filterPlacements`, `clampStack`,
 * `validPanelId`, `filterOmniCategories`, `filterPrintPanels`) and before the
 * legacy `active*` keys are deleted — those are precisely what turn an
 * un-renamed old id into a silent drop.
 */
export function applyPanelRenames(
  blob: Record<string, unknown>,
  renames: readonly PanelRename[],
): Record<string, unknown> {
  let out = blob;
  for (const rename of renames) out = applyOne(out, rename);
  return out;
}
