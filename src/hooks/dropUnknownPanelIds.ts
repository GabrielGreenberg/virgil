/**
 * Load-time defensive SCRUB: every panel id a stored blob carries that the
 * live registries no longer know is dropped, across every PanelId-keyed
 * carrier in ViewPrefs.
 *
 * THE ROOT FIX for the recurring stale-snapshot incidents (the retired
 * `quotations` panel kept round-tripping: saved prefs → the dev:preview
 * snapshot → promote-defaults → shipped `*.defaults.json`). A panel removed
 * from the codebase must never survive a prefs load: this drops any id/key
 * that is no longer a member of its carrier's live registry SSOT, so the
 * removed id can't propagate forward through any of those hops.
 *
 * WHICH carriers, and WHICH set each validates against, are not decided here:
 * both come from the census in `panel-id-carriers.ts`, which the additive twin
 * (`applyPanelRenames`) reads too. Until task 675 this module answered the
 * first question with four hand-inlined functions over three hardcoded
 * allowlists, and the loader wired each one up by hand — so FOUR panel-keyed
 * carriers reached it with no key check at all. `panelHeights`, `panelModes`,
 * `floatPositions` and `cardArchiveView` therefore kept a retired id FOREVER,
 * re-serialized on every write, ready to hand a dead panel's band height /
 * float rect / mode / archive view to whatever newcomer someday reuses the id
 * — and nothing forced a fifth carrier in. Now one walk
 * (`scrubUnknownPanelIds`) covers the table by construction, and a new
 * collection field is a compile error in the census until classified.
 *
 * The three canonical sets are NOT interchangeable — a carrier validated
 * against the wrong one silently drops LIVE state — so each carrier names its
 * vocabulary and this module holds the sets:
 *
 *  1. `panel` → keys of PANEL_REGISTRY      (PanelKind)
 *     [src/panels/panel-registry.ts]
 *  2. `omni`  → OMNI_PANELS kinds           (the omni-eligible subset)
 *     [OMNI_PANELS in src/panels/panel-registry.ts]
 *  3. `print` → keys of PRINT_PANELS        (PrintPanelKey)
 *     [src/lib/print.ts]
 *
 * Design contract:
 *  - PURELY SUBTRACTIVE: only drops unknowns. Never injects a missing panel
 *    here — the DEFAULT_* merges in the loader already supply those.
 *  - ALLOWLIST, not denylist: the valid-id sets are derived FROM the live
 *    registries, so this auto-tracks any future panel removal without a
 *    hardcoded list of retired ids.
 *  - MUST RUN AFTER `applyPanelRenames`. A retired id that has an heir is a
 *    rename, not an unknown; scrubbing first would delete the very state the
 *    rename exists to carry forward.
 *  - ORDER- and SIDE-preserving for the surviving entries.
 *  - MALFORMED-SAFE: bad input shapes return a sane empty/passthrough value
 *    instead of throwing.
 *
 * This is a pure module: it imports only the three registry SSOTs (all
 * tiptap/storage-free), so it (and its test) load without mocks in the
 * default node vitest env.
 */
import { PANEL_REGISTRY, OMNI_PANELS } from "@/panels/panel-registry";
import { PRINT_PANELS } from "@/lib/print";
import {
  PANEL_ID_CARRIERS,
  type CarrierVocabulary,
  type PanelIdCarrier,
} from "./panel-id-carriers";

/** Live allowlists, derived once from the registries. */
const PLACEMENT_ID_ALLOWLIST: ReadonlySet<string> = new Set(Object.keys(PANEL_REGISTRY));
const OMNI_CATEGORY_ALLOWLIST: ReadonlySet<string> = new Set(OMNI_PANELS.map((e) => e.kind));
const PRINT_PANEL_KEY_ALLOWLIST: ReadonlySet<string> = new Set(Object.keys(PRINT_PANELS));

/** Vocabulary → the live set that may keep a key. TOTAL over
 *  `CarrierVocabulary`, so a fourth vocabulary added to the census is a
 *  compile error here until its set is named. */
const VOCABULARY_ALLOWLISTS: Readonly<Record<CarrierVocabulary, ReadonlySet<string>>> = {
  panel: PLACEMENT_ID_ALLOWLIST,
  omni: OMNI_CATEGORY_ALLOWLIST,
  print: PRINT_PANEL_KEY_ALLOWLIST,
};

/** A scrub returns the NEW value, or `undefined` for "nothing to do here" —
 *  wrong shape, or every id already live. MALFORMED-SAFE by construction: an
 *  unrecognized shape is LEFT UNTOUCHED rather than replaced with an empty
 *  value, because this walk runs on the raw blob BEFORE the defaults merge,
 *  where the loader's own post-merge filters still get their say. Mirrors the
 *  `Rewrite` contract on the additive side. */
type Scrub = (value: unknown, live: ReadonlySet<string>) => unknown | undefined;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** `PanelId[]` — keep live string members, in order. */
const scrubIdList: Scrub = (value, live) => {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((x) => typeof x === "string" && live.has(x));
  return out.length === value.length ? undefined : out;
};

/** `{ left: PanelId[]; right: PanelId[] }` — each side independently. */
const scrubSidedIdList: Scrub = (value, live) => {
  if (!isPlainObject(value)) return undefined;
  const left = scrubIdList(value.left, live);
  const right = scrubIdList(value.right, live);
  if (left === undefined && right === undefined) return undefined;
  return { ...value, left: left ?? value.left, right: right ?? value.right };
};

/** `Record<PanelId, V>` — drop dead KEYS, keeping the order and value of every
 *  survivor. This is the leg the five unscrubbed carriers needed. */
const scrubIdRecord: Scrub = (value, live) => {
  if (!isPlainObject(value)) return undefined;
  const entries = Object.entries(value);
  const kept = entries.filter(([k]) => live.has(k));
  return kept.length === entries.length ? undefined : Object.fromEntries(kept);
};

/** `{ id, side }[]` — the id is a FIELD. Entries that aren't `{ id: string }`
 *  are left to the loader's post-merge `filterPlacements`, which is the pass
 *  that owns shape validity (this one owns liveness). */
const scrubPlacements: Scrub = (value, live) => {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((p) => {
    const id = isPlainObject(p) ? p.id : undefined;
    return typeof id !== "string" || live.has(id);
  });
  return out.length === value.length ? undefined : out;
};

/** `printOptions` — an `id-record` at `.panels`; every other print option
 *  passes through untouched. */
const scrubPrintPanels: Scrub = (value, live) => {
  if (!isPlainObject(value)) return undefined;
  const panels = scrubIdRecord(value.panels, live);
  if (panels === undefined) return undefined;
  return { ...value, panels };
};

const SCRUBS: Readonly<Record<PanelIdCarrier["shape"], Scrub>> = {
  placements: scrubPlacements,
  "id-list": scrubIdList,
  "sided-id-list": scrubSidedIdList,
  "id-record": scrubIdRecord,
  "print-panels": scrubPrintPanels,
};

/**
 * Drop every panel id a raw prefs blob carries that its carrier's live
 * registry no longer knows — across EVERY carrier the census classifies.
 *
 * PURE: returns a new object when anything changed and the SAME object when
 * nothing did (so a clean blob costs one shallow walk and no allocation) —
 * the same discipline `applyPanelRenames` follows, and the reason the loader
 * can keep mutating the result in place.
 *
 * Deliberately NOT a replacement for the loader's specialised passes, which
 * enforce rules this one has no business knowing:
 *  - `filterPlacements` / `filterPrintPanels` run POST-merge, so a retired id
 *    baked into the shipped `DEFAULT_PREFS` is scrubbed too — this walk only
 *    ever sees the stored blob.
 *  - `clampStack` also dedupes within a side, excludes the other side's ids,
 *    strips the `omni`/`blank` layout sentinels and caps at `MAX_STACK`.
 *  - `validPanelId` additionally requires membership in the CLEANED placements.
 * Those stay. This one makes the carriers with no specialised pass — the five
 * that simply passed through — no longer the exception.
 */
export function scrubUnknownPanelIds<T extends Record<string, unknown>>(blob: T): T {
  let out: T | null = null;
  for (const [field, carrier] of Object.entries(PANEL_ID_CARRIERS)) {
    if (carrier === null) continue;
    const next = SCRUBS[carrier.shape](
      blob[field],
      VOCABULARY_ALLOWLISTS[carrier.vocabulary],
    );
    if (next === undefined) continue;
    (out ??= { ...blob })[field as keyof T] = next as T[keyof T];
  }
  return out ?? blob;
}

/**
 * Drop placements whose `id` is not a live PANEL_REGISTRY key. Preserves the
 * order and `side` of the survivors. Non-array input → []; entries that aren't
 * `{ id }` objects are dropped.
 */
export function filterPlacements<T extends { id?: unknown }>(placements: unknown): T[] {
  if (!Array.isArray(placements)) return [];
  return placements.filter(
    (p): p is T =>
      p != null &&
      typeof p === "object" &&
      typeof (p as { id?: unknown }).id === "string" &&
      PLACEMENT_ID_ALLOWLIST.has((p as { id: string }).id),
  );
}

/**
 * Drop omni-category ids that are not omni-eligible PanelKinds. Preserves
 * order. Non-array input → []. Non-string / unknown entries dropped.
 *
 * Named for the per-SIDE lists it was written against; since task 381 the live
 * carrier is the side-free `omniHiddenCategories`, so the sided wrapper this
 * sat inside is gone — it had no production caller once the loader folded the
 * legacy blob through `hiddenFromLegacySides` (which drops unknown ids itself),
 * and a suite is not a consumer (task 202).
 */
export function filterOmniSide(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list.filter(
    (c): c is string => typeof c === "string" && OMNI_CATEGORY_ALLOWLIST.has(c),
  );
}

/**
 * Drop print-panel keys that are not live PRINT_PANELS keys. Preserves the
 * boolean value of each surviving key (and insertion order). Non-object input
 * → {}.
 */
export function filterPrintPanels(panels: unknown): Record<string, boolean> {
  if (!panels || typeof panels !== "object") return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(panels as Record<string, unknown>)) {
    if (PRINT_PANEL_KEY_ALLOWLIST.has(k)) out[k] = Boolean(v);
  }
  return out;
}

/**
 * Sanitize a per-side dock stack (the ordered list of docked panel ids).
 * Drops the omni/blank layout sentinels, unknown ids (not live
 * PANEL_REGISTRY keys), within-side duplicates, and any id already docked
 * on the other side (a panel can be docked at most once). Truncates each
 * side to `max` (the stack ceiling). Order-preserving; malformed input →
 * empty sides. Returned as `string[]`s so this module stays free of the
 * PanelId type (no import cycle with useViewPrefs); the caller casts.
 *
 * ASYMMETRY WITH `validPanelId`, stated rather than fixed (task 675): the
 * float cleaner in `loadPrefs` requires an id to survive PLACEMENT cleaning
 * too, while this one asks only that the id be a live `PANEL_REGISTRY` kind.
 * Vacuous today — `omni` is the only `defaultStripSide: null` panel (the one
 * kind that is registry-known yet never placed) and the sentinel skip above
 * already excludes it by name — so no id can currently be registry-known and
 * unplaced. It stops being vacuous the day a second presentation pod exists,
 * at which point a docked band could outlive its placement. Left as a comment
 * because tightening it blind would change dock behaviour with no live case to
 * verify against.
 *
 * `max` is REQUIRED and deliberately undefaulted (task 273). It used to carry
 * its own `= 3` while the runtime insertions read `MAX_STACK`, and the sole
 * caller passed nothing — two facts that must agree, kept as independent
 * literals with nothing forcing equality. A ceiling bump would then have left
 * the LOADER silently truncating a runtime-legal deeper stack on every reload.
 * A default here is a decision this module isn't entitled to make: the ceiling
 * belongs to the dock engine, so the caller states it.
 */
export function clampStack(
  stack: unknown,
  max: number,
): { left: string[]; right: string[] } {
  const src = (stack && typeof stack === "object" ? stack : {}) as {
    left?: unknown;
    right?: unknown;
  };
  const clean = (arr: unknown, exclude: ReadonlySet<string>): string[] => {
    if (!Array.isArray(arr)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const x of arr) {
      if (typeof x !== "string") continue;
      if (x === "omni" || x === "blank") continue;
      if (!PLACEMENT_ID_ALLOWLIST.has(x)) continue;
      if (seen.has(x) || exclude.has(x)) continue;
      seen.add(x);
      out.push(x);
      if (out.length >= max) break;
    }
    return out;
  };
  const left = clean(src.left, new Set<string>());
  const right = clean(src.right, new Set(left));
  return { left, right };
}
