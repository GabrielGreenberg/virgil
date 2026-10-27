/**
 * The STRUCTURAL half of the view-prefs WINDOW vocabulary — the per-window
 * twin of `./structural-globals.ts` (task 1319).
 *
 * The view prefs live in two blobs, and until this table only one of them had
 * a load door. Every structural GLOBAL key is type-checked at load by a loop
 * derived from `STRUCTURAL_GLOBAL_PREF_KEYS`, and every registry key (either
 * scope) is coerced against its declared domain. The structural WINDOW keys —
 * dock stacks, float rects, panel modes, collapse flags — were adopted raw
 * through the closed-world `pickKnown` filter (which drops unknown KEYS, never
 * bad VALUES) plus a handful of hand `?? {}` overrides. So a stored string
 * `"false"` for `topbarRightCollapsed` was truthy, and a new window pref was
 * unvalidated unless someone remembered to hand-write a line for it.
 *
 * Likewise "session-only" was a hand override: `panelMRU` was zeroed at load,
 * but `persist` wrote every non-global key, so every recency bump cost a
 * localStorage write of a value always thrown away — and it shipped in the
 * defaults JSON besides.
 *
 * Now each structural window key DECLARES its stored shape (what `loadPrefs`
 * validates it against — invalid → the shipped default) and, where it is
 * session-only, `ephemeral` with a reason (never read from disk, never written
 * to it, never shipped as a default). `useViewPrefs` holds the compile-time
 * census: every `ViewPrefs` key is global, registry-owned, or a row here — a
 * new window field fails to compile until it is classified.
 *
 * Dependency-light by construction (zero imports), like its global sibling:
 * `useViewPrefs` imports it, never the other way round, and a node-environment
 * guard can read it without jsdom or mocking `@/lib/storage`.
 */

/** The two panel presentation modes. The `PanelMode` type derives from this. */
export const PANEL_MODES = ["docked", "floating"] as const;

/** The three card-archive view modes. `CardArchiveView` derives from this. */
export const CARD_ARCHIVE_VIEWS = ["active", "archived", "all"] as const;

/** How a window pref is stored — the shape its load door checks.
 *
 *  - `boolean`       — a real boolean (a stored `"false"` is NOT adopted).
 *  - `string-list`   — `string[]`; non-string members dropped.
 *  - `sided-list`    — `{ left: string[]; right: string[] }`.
 *  - `number-record` — `Record<string, number>`; non-finite entries dropped.
 *  - `rect-record`   — `Record<string, {x,y,width,height}>` of finite numbers.
 *  - `enum-record`   — `Record<string, V>` with `V` in `values`. */
export type WindowPrefShape =
  | { shape: "boolean" }
  | { shape: "string-list" }
  | { shape: "sided-list" }
  | { shape: "number-record" }
  | { shape: "rect-record" }
  | { shape: "enum-record"; values: readonly string[] };

/** A structural window key: its shape, and — when it is session-only — why.
 *  `why` is REQUIRED on an ephemeral key for the same reason the global
 *  table requires it on a promotion exemption. */
export type StructuralWindowDef = WindowPrefShape & {
  ephemeral?: { why: string };
};

export const STRUCTURAL_WINDOW_PREFS = {
  dockStack: { shape: "sided-list" },
  panelHeights: { shape: "number-record" },
  panelMRU: {
    shape: "sided-list",
    ephemeral: {
      why: "recency resets with the open set on reload — the eviction order is rebuilt by use, never restored",
    },
  },
  collapsedLeft: { shape: "boolean" },
  collapsedRight: { shape: "boolean" },
  panelWidths: { shape: "number-record" },
  poppedOutPanels: { shape: "string-list" },
  floatPositions: { shape: "rect-record" },
  panelModes: { shape: "enum-record", values: PANEL_MODES },
  poppedOutCards: { shape: "string-list" },
  cardFloatPositions: { shape: "rect-record" },
  topbarRightCollapsed: { shape: "boolean" },
  cardArchiveView: { shape: "enum-record", values: CARD_ARCHIVE_VIEWS },
} as const satisfies Record<string, StructuralWindowDef>;

export type StructuralWindowPrefKey = keyof typeof STRUCTURAL_WINDOW_PREFS;

/** Every structural window key, in declaration order. */
export const STRUCTURAL_WINDOW_PREF_KEYS = Object.keys(
  STRUCTURAL_WINDOW_PREFS,
) as StructuralWindowPrefKey[];

/** The session-only window keys, as a type — what the shipped-defaults
 *  `Omit` list names, so an ephemeral key can never ship in the JSON. */
export type EphemeralWindowPrefKey = {
  [K in StructuralWindowPrefKey]: (typeof STRUCTURAL_WINDOW_PREFS)[K] extends {
    ephemeral: unknown;
  }
    ? K
    : never;
}[StructuralWindowPrefKey];

/** The session-only window keys: reset at load, never persisted, never
 *  shipped as defaults. Derived from the `ephemeral` declarations. */
export const EPHEMERAL_WINDOW_PREF_KEYS = STRUCTURAL_WINDOW_PREF_KEYS.filter(
  (k) => (STRUCTURAL_WINDOW_PREFS[k] as StructuralWindowDef).ephemeral !== undefined,
) as EphemeralWindowPrefKey[];

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const stringsOf = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;

/**
 * Validate ONE stored value against its declared shape. Returns the repaired
 * value (bad members/entries dropped, a fresh object), or `undefined` when the
 * container itself is the wrong shape — the caller then adopts the default.
 * Ephemeral keys are not this function's concern; see `adoptWindowSlice`.
 */
export function normalizeWindowPrefValue(
  def: WindowPrefShape,
  v: unknown,
): unknown {
  switch (def.shape) {
    case "boolean":
      return typeof v === "boolean" ? v : undefined;
    case "string-list":
      return stringsOf(v);
    case "sided-list": {
      if (!isPlainObject(v)) return undefined;
      return { left: stringsOf(v.left) ?? [], right: stringsOf(v.right) ?? [] };
    }
    case "number-record":
      return recordOf(v, (x) => (isFiniteNumber(x) ? x : undefined));
    case "enum-record":
      return recordOf(v, (x) =>
        typeof x === "string" && def.values.includes(x) ? x : undefined,
      );
    case "rect-record":
      return recordOf(v, (x) =>
        isPlainObject(x) &&
        isFiniteNumber(x.x) &&
        isFiniteNumber(x.y) &&
        isFiniteNumber(x.width) &&
        isFiniteNumber(x.height)
          ? { x: x.x, y: x.y, width: x.width, height: x.height }
          : undefined,
      );
  }
}

/** A fresh record keeping only the entries `entry` accepts (non-`undefined`). */
function recordOf(
  v: unknown,
  entry: (x: unknown) => unknown,
): Record<string, unknown> | undefined {
  if (!isPlainObject(v)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    const e = entry(x);
    if (e !== undefined) out[k] = e;
  }
  return out;
}

/**
 * THE window load door: every structural window key that is stored, valid and
 * not ephemeral, repaired. A key absent from the result was absent, malformed,
 * or session-only — the caller adopts its default (or a legacy fold, for the
 * keys that have one).
 */
export function adoptWindowSlice(
  blob: Record<string, unknown>,
): Partial<Record<StructuralWindowPrefKey, unknown>> {
  const out: Partial<Record<StructuralWindowPrefKey, unknown>> = {};
  for (const k of STRUCTURAL_WINDOW_PREF_KEYS) {
    const def = STRUCTURAL_WINDOW_PREFS[k] as StructuralWindowDef;
    if (def.ephemeral || !(k in blob)) continue;
    const v = normalizeWindowPrefValue(def, blob[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}
