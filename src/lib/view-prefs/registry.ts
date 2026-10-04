/**
 * VIEW_PREF_REGISTRY — the single source of truth for view-level
 * preferences (the ones surfaced in the editor's three-dots View menu plus
 * the panel-local Bibliography filter).
 *
 * Each entry declares its `kind` (toggle / enum / set), its persistence
 * `scope` (global = mirrors across windows; window = per-window), its
 * default, and (for menu-bearing entries) its label + group + per-value
 * labels. The store shape (`RegistryPrefs`), the shipped defaults
 * (`REGISTRY_DEFAULTS`), and the global-key set (`REGISTRY_GLOBAL_KEYS`)
 * are all *generated* from this table — so a pref cannot exist in the menu
 * but be missing from persistence. They come from the same source.
 *
 * Dependency-light by design: this module imports ONLY *types* from
 * `useViewPrefs` (`import type`), so there is no runtime import cycle
 * (`useViewPrefs` imports the runtime artifacts here, not vice-versa).
 */
import type { DividerLevel } from "@/hooks/useViewPrefs";
import type { MarkerType } from "@/cards/types";
// Runtime import of the HIGHLIGHT vocabulary, from the zero-import leaf it was
// moved to (task 677) precisely so this module can read it without importing
// `useViewPrefs` (which imports this one). It is the declared value DOMAIN of
// `hiddenHighlightTypes`, and a domain that is not the live union is not a
// validator.
import {
  ALL_HIGHLIGHT_TYPES,
  type HighlightType,
} from "@/lib/view-prefs/highlight-types";
// Runtime import, and cycle-safe: `marker-meta` imports only the runtime-leaf
// `card-registry` (itself type-only apart from the zero-import
// `stack/card-kinds`), and nothing in that graph imports view-prefs. The
// module header's "dependency-light" promise is about `useViewPrefs`, which
// stays type-only.
import {
  ALL_MARKER_TYPES,
  HIDEABLE_MARKER_TYPES,
  type HideableMarkerType,
} from "@/cards/marker-meta";
// The SHIPPED defaults — the one copy `tools/promote-defaults.mjs` rewrites
// (task 900). A JSON import, so it adds no module to the graph and no cycle.
import shippedDefaultsJson from "@/hooks/useViewPrefs.defaults.json";

export type ViewPrefScope = "global" | "window";
export type ViewPrefMenuGroup = "display" | "marginalia" | "highlights" | "dividers";

/**
 * `promote` — whether a *global* pref participates in the personal-prefs
 * promotion pipeline (the `dev-prefs-registry.json` whitelist). Defaults to
 * `true` (every global pref promotes). Set `promote: false` to FREEZE a pref's
 * shipped default at its registry `default`: a `/cleanup-virgil` promote-defaults
 * run then can't fold Gabriel's personal snapshot over it and silently drift the
 * shipped value (the `showParTitles` regression — task 057). The registry is
 * thus the SSOT for BOTH the default value AND whether it promotes;
 * `view-menu-registry-source.test.ts` cross-checks the JSON whitelist against
 * this flag in both directions. Ignored for `window`-scope prefs (they never
 * promote regardless).
 *
 * `menuRowId` — the stable DOM/menu-registry id of the row this toggle renders
 * as in the View menu. REQUIRED (task 274): the registry already owns the row's
 * label and its group, so owning its id is what makes the Display block fully
 * registry-driven — a new Display toggle is one row here and ZERO edits in
 * `MenuBar.tsx`. It is declared rather than derived from the key because these
 * ids are addressed by tests and the menu registry ("card-outline", not
 * "card-outline-chrome"), so a naming rule would have to be reverse-engineered
 * from the ids it must not change.
 */
interface ToggleDef<D extends boolean = boolean> {
  kind: "toggle";
  scope: ViewPrefScope;
  default: D;
  label: string;
  menu: ViewPrefMenuGroup;
  menuRowId: string;
  /** The row's tooltip + `aria-description` — what the toggle governs when
   *  the label alone would mislead (task 806: "Check spelling" also silences
   *  the BROWSER's checker). Optional; rendered by the Display block. */
  hint?: string;
  promote?: boolean;
  /** How the pref reaches the SCREEN through CSS (task 927) — see
   *  `ViewPrefProjectionDecl`. Applied by ONE applier
   *  (`src/lib/view-prefs/projection.ts`) onto the projecting instance's own
   *  surfaces, never `<body>`. */
  project?: ToggleProjectionDecl;
  /** For a toggle with no CSS projection (or more than one effect): the code
   *  that reads the value as a prop. A `display` toggle must declare `project`
   *  or `consumedBy` — `view-pref-projection.test.ts` pins it, so a new row
   *  cannot ship inert. Documentation the test reads, not a runtime switch. */
  consumedBy?: string;
}

/**
 * A toggle's CSS projection (task 927). `when` is the pref VALUE at which the
 * projection is present — `{ class: "hide-card-titles", when: false }` paints
 * the class while the pref is OFF. An `attr` projection writes an inherited
 * HTML attribute (the native `spellcheck` switch) the same way.
 */
export type ToggleProjectionDecl =
  | { readonly class: string; readonly when: boolean }
  | { readonly attr: string; readonly value: string; readonly when: boolean };

/** An enum's CSS projection: one class per value, always present. Spelled as
 *  a template FUNCTION rather than a prefix string so the class family stays
 *  visible to `dead-css-hook-census.test.ts` (a `name-${v}` template is a
 *  producer it can see; a bare `"name-"` is not). */
export type EnumProjectionDecl = { readonly classOf: (value: string) => string };

interface EnumDef<V extends string> {
  kind: "enum";
  scope: ViewPrefScope;
  default: V;
  values: readonly V[];
  label: string;
  menu?: ViewPrefMenuGroup;
  valueLabels: Record<V, string>;
  promote?: boolean;
  /** See `EnumProjectionDecl` (task 927). */
  project?: EnumProjectionDecl;
}
interface SetDef<E extends string | number> {
  kind: "set";
  scope: ViewPrefScope;
  default: readonly E[];
  /** The MENU vocabulary: the members this pref renders a row for. NOT a
   *  validator — see `domain`. */
  members: readonly E[];
  /** The stored VALUE domain: every member a saved blob may legitimately
   *  carry. Defaults to `members` when omitted, which is right only where the
   *  two coincide (`dividerLevels`).
   *
   *  They are two different jobs, and conflating them silently deletes live
   *  state. `hiddenMarginaliaTypes` may legitimately hold the `error` marker
   *  type, which is deliberately NOT hideable and so absent from `members`
   *  (`NON_HIDEABLE_MARKER_TYPES`); `hiddenHighlightTypes` may hold `report`,
   *  which the menu likewise does not render. Validating either against
   *  `members` would drop exactly those — which is why
   *  `toggleViewPrefMember` refuses to validate against `members` at all.
   *  `coerceRegistryPrefs` reads THIS. */
  domain?: readonly E[];
  polarity: "present" | "hidden";
  label: string;
  menu?: ViewPrefMenuGroup;
  promote?: boolean;
  memberLabels: Record<string, string>;
}
export type ViewPrefDef = ToggleDef | EnumDef<string> | SetDef<string | number>;

/**
 * The full registry. Keys are `ViewPrefs` field names.
 *
 * DEFAULTS — one copy per key, never two (task 900). A PROMOTED global key
 * (`promote` not false) does not state its default here: it READS it from
 * `SHIPPED`, i.e. `useViewPrefs.defaults.json`, because that JSON is the file
 * the release promoter rewrites. A literal here would be a second copy the
 * promoter cannot see, and the first promotion of a changed View pref would
 * land a commit whose registry and JSON disagree. Only keys that never promote
 * — `promote: false` (frozen, task 057) and `window` scope — keep a literal,
 * and `view-menu-registry-source.test.ts` pins both halves.
 *
 * The `set` element types are stated on `SHIPPED` so the generated value type
 * yields the FULL element type — the menu may render only a subset of
 * `members`, but the stored value can include extra members (e.g. the `error`
 * marginalia type, which is deliberately not hideable —
 * `NON_HIDEABLE_MARKER_TYPES`).
 */
/** The shipped JSON read as the registry's promoted defaults. The cast states
 *  the element types; it is not trusted blindly —
 *  `view-menu-registry-source.test.ts` validates every promoted value against
 *  the domain its registry row declares. */
const SHIPPED = shippedDefaultsJson as unknown as {
  showCardTitles: boolean;
  showLatexComments: boolean;
  showHeadingLabels: boolean;
  omniDimResting: boolean;
  cardOutlineChrome: boolean;
  checkSpelling: boolean;
  autocorrectTypos: boolean;
  showMarginalia: boolean;
  hiddenMarginaliaTypes: MarkerType[];
  showHighlights: boolean;
  hiddenHighlightTypes: HighlightType[];
  dividerLevels: DividerLevel[];
  dividerWidth: "full" | "mid" | "text";
};
/**
 * Menu labels for the per-type marginalia hide rows. The ANNOTATION is the
 * coverage assertion task 672 asked for: `Record<HideableMarkerType, string>`
 * is exhaustive, so a marker type added to `MarkerType` and not opted out in
 * `NON_HIDEABLE_MARKER_TYPES` fails to compile here until it is given a row
 * label — it can no longer ship invisible.
 *
 * Declared rather than derived from `MARKER_META.label`: those are singular
 * marker names ("Note", "Task") and reading them would make this
 * dependency-light module import the marginalia UI lib. Menu plurals are a
 * menu concern.
 */
const MARGINALIA_TYPE_LABELS: Record<HideableMarkerType, string> = {
  note: "Notes",
  archive: "Archive",
  revision: "Revisions",
  cut: "Cuts",
  todo: "Todo",
  report: "Reports",
};

export const VIEW_PREF_REGISTRY = {
  // Display group (flat toggles)
  // promote:false — ship default frozen at the registry value (task 057). A prior
  // promote-defaults folded Gabriel's personal snapshot and drifted this true→false;
  // opting out of promotion makes the registry the durable SSOT so it can't recur.
  showParTitles:        { kind: "toggle", scope: "global", default: true, label: "Paragraph titles", menu: "display", menuRowId: "par-titles", promote: false,
                          project: { class: "hide-par-titles", when: false } },
  showCardTitles:       { kind: "toggle", scope: "global", default: SHIPPED.showCardTitles, label: "Card titles",       menu: "display", menuRowId: "card-titles",
                          project: { class: "hide-card-titles", when: false } },
  showLatexComments:    { kind: "toggle", scope: "global", default: SHIPPED.showLatexComments, label: "% comments",        menu: "display", menuRowId: "latex-comments",
                          project: { class: "hide-latex-comments", when: false } },
  showHeadingLabels:    { kind: "toggle", scope: "global", default: SHIPPED.showHeadingLabels, label: "Labels",            menu: "display", menuRowId: "heading-labels",
                          project: { class: "hide-heading-labels", when: false } },
  omniDimResting:       { kind: "toggle", scope: "global", default: SHIPPED.omniDimResting, label: "Dim cards at rest",  menu: "display", menuRowId: "omni-dim-resting",
                          consumedBy: "EditorPane → OmniHost `omniDimResting` → OmniViewPanel `dimResting` ([data-omni-dim])" },
  cardOutlineChrome:    { kind: "toggle", scope: "global", default: SHIPPED.cardOutlineChrome, label: "Card outline",       menu: "display", menuRowId: "card-outline",
                          project: { class: "card-outline-chrome", when: true } },
  // The browser's native spellcheck, made deliberate and switchable (task 517).
  // Projected (task 927) as a single inherited HTML attribute on the
  // instance's own surfaces — the pane root and its FloatingPanels — rather
  // than a prop threaded into twelve `editorProps.attributes` blocks (see
  // `spellcheck-policy.ts`). Default ON = today's behaviour; task 518's own
  // checker reads the same value as a prop.
  checkSpelling:        { kind: "toggle", scope: "global", default: SHIPPED.checkSpelling, label: "Check spelling",      menu: "display", menuRowId: "check-spelling",
                          hint: "Virgil's spelling underline (a thin wavy line) — turning this off also stops the browser's own spellcheck (its dotted underline) everywhere in Virgil. Virgil has no grammar check.",
                          project: { attr: "spellcheck", value: "false", when: false },
                          consumedBy: "EditorPane `spellcheckEnabled` → SpellcheckProvider (Virgil's own checker)" },
  // The CURATED typo table (task 519), and deliberately its own row rather
  // than a second meaning for `checkSpelling`: underlining a word and
  // REWRITING it are different permissions, and a user may want either
  // without the other. Default ON.
  autocorrectTypos:     { kind: "toggle", scope: "global", default: SHIPPED.autocorrectTypos, label: "Autocorrect typos",   menu: "display", menuRowId: "autocorrect-typos",
                          consumedBy: "EditorPane `autocorrectEnabled` → SpellcheckProvider" },
  // Marginalia
  showMarginalia:       { kind: "toggle", scope: "global", default: SHIPPED.showMarginalia, label: "Show marginalia",   menu: "marginalia", menuRowId: "marginalia-show" },
  hiddenMarginaliaTypes:{ kind: "set", scope: "global", default: SHIPPED.hiddenMarginaliaTypes, members: HIDEABLE_MARKER_TYPES,
                          domain: ALL_MARKER_TYPES,
                          polarity: "hidden", label: "Marginalia types", menu: "marginalia",
                          memberLabels: MARGINALIA_TYPE_LABELS },
  // Highlights
  showHighlights:       { kind: "toggle", scope: "global", default: SHIPPED.showHighlights, label: "Show highlights",   menu: "highlights", menuRowId: "highlights-show" },
  hiddenHighlightTypes: { kind: "set", scope: "global", default: SHIPPED.hiddenHighlightTypes, members: (["note", "todo", "comment", "cut"] as const) satisfies readonly HighlightType[],
                          domain: ALL_HIGHLIGHT_TYPES,
                          polarity: "hidden", label: "Highlight types", menu: "highlights",
                          memberLabels: { note: "Notes", todo: "Todo", comment: "Revisions", cut: "Cuts" } },
  // Dividers
  dividerLevels: { kind: "set", scope: "global", default: SHIPPED.dividerLevels, members: [0, 1, 2, 3, 4, 5, 6] as const,
                   polarity: "present", label: "Show dividers for…", menu: "dividers",
                   memberLabels: { 0: "Parts", 1: "Chapters", 2: "Sections", 3: "Subsections", 4: "Subsubsections", 5: "Paragraph headings", 6: "Subparagraph headings" } },
  dividerWidth: { kind: "enum", scope: "global", default: SHIPPED.dividerWidth, values: ["full", "mid", "text"],
                  label: "Divider preferences", menu: "dividers",
                  valueLabels: { full: "Full width", mid: "Mid width", text: "Text width" },
                  project: { classOf: (v: string) => `dividers-width-${v}` } },
  // Bibliography filter (NOT in the View menu; panel-local; window scope)
  bibFilter: { kind: "enum", scope: "window", default: "cited", values: ["cited", "all"],
               label: "Bibliography filter", valueLabels: { cited: "Cited entries only", all: "Full bibliography" } },
} as const satisfies Record<string, ViewPrefDef>;

export type ViewPrefKey = keyof typeof VIEW_PREF_REGISTRY;

/** The registry keys whose `kind` is `"set"` — the exact domain of the generic
 *  member toggle (`toggleViewPrefMember`). Derived from the table, so a new
 *  `set` pref joins it by declaration alone. */
export type SetViewPrefKey = {
  [K in ViewPrefKey]: (typeof VIEW_PREF_REGISTRY)[K] extends { kind: "set" } ? K : never;
}[ViewPrefKey];

/** The registry keys whose `kind` is `"toggle"` — the domain of
 *  `toggleViewPref`. (The generic setter accepts every key.) */
export type ToggleViewPrefKey = {
  [K in ViewPrefKey]: (typeof VIEW_PREF_REGISTRY)[K] extends { kind: "toggle" } ? K : never;
}[ViewPrefKey];

/* ── Type generation ──────────────────────────────────────────────────── */

type ValueOf<E extends ViewPrefDef> =
  E extends { kind: "toggle" } ? boolean :
  E extends { kind: "enum"; values: readonly (infer V)[] } ? V :
  E extends { kind: "set"; default: readonly (infer D)[] } ? D[] :
  never;

/** The slice of `ViewPrefs` generated from the registry. `ViewPrefs extends
 *  RegistryPrefs`, so these fields are owned here, not hand-authored. */
export type RegistryPrefs = {
  [K in ViewPrefKey]: ValueOf<(typeof VIEW_PREF_REGISTRY)[K]>;
};

/** Defaults for every registry key, ready to spread into `DEFAULT_PREFS`.
 *  `set` defaults are copied (fresh arrays) so no two reads share a mutable
 *  reference. */
export const REGISTRY_DEFAULTS: RegistryPrefs = Object.fromEntries(
  Object.entries(VIEW_PREF_REGISTRY).map(([k, def]) => [
    k,
    def.kind === "set" ? [...def.default] : def.default,
  ]),
) as RegistryPrefs;

/** The registry keys whose `scope` is "global" — folded into
 *  `GLOBAL_PREF_KEYS` so the persistence layer buckets them into the global
 *  blob. `bibFilter` (window) is correctly absent. */
export const REGISTRY_GLOBAL_KEYS = Object.entries(VIEW_PREF_REGISTRY)
  .filter(([, d]) => d.scope === "global")
  .map(([k]) => k) as Array<
  {
    [K in ViewPrefKey]: (typeof VIEW_PREF_REGISTRY)[K]["scope"] extends "global" ? K : never;
  }[ViewPrefKey]
>;

/** The global registry keys that PARTICIPATE in the personal-prefs promotion
 *  pipeline — every global key except those flagged `promote: false` (frozen to
 *  their registry default, task 057). This is the SSOT the dev-prefs whitelist
 *  must match; `view-menu-registry-source.test.ts` enforces both directions
 *  (promoted keys ⊆ whitelist; opted-out keys ∉ whitelist). */
export const REGISTRY_PROMOTED_GLOBAL_KEYS = REGISTRY_GLOBAL_KEYS.filter(
  // `as const satisfies` narrows each entry's literal type, so `promote` is only
  // present on entries that declare it; read it through the union type.
  (k) => (VIEW_PREF_REGISTRY[k] as ViewPrefDef).promote !== false,
);

/** All registry keys, in declaration order. */
export const VIEW_PREF_KEYS = Object.keys(VIEW_PREF_REGISTRY) as ViewPrefKey[];

/** The element type of a `kind: "set"` pref's stored array — what
 *  `toggleViewPrefMember` adds to / removes from that array. */
export type ViewPrefMember<K extends SetViewPrefKey> = RegistryPrefs[K][number];

/** A menu-group's toggle rows, in registry declaration order: the key that
 *  supplies the row's value + its stable row id + its label. The View menu's
 *  Display block renders straight off this, so a new Display toggle is ONE
 *  registry row and zero MenuBar edits (task 274). */
export function toggleRowsInMenuGroup(
  group: ViewPrefMenuGroup,
): ReadonlyArray<{ key: ToggleViewPrefKey; id: string; label: string; hint?: string }> {
  return Object.entries(VIEW_PREF_REGISTRY)
    .filter(([, d]) => d.kind === "toggle" && d.menu === group)
    .map(([key, d]) => {
      const def = d as ToggleDef;
      return { key: key as ToggleViewPrefKey, id: def.menuRowId, label: def.label, hint: def.hint };
    });
}

/** The registry keys whose `kind` is `"enum"`. */
export type EnumViewPrefKey = {
  [K in ViewPrefKey]: (typeof VIEW_PREF_REGISTRY)[K] extends { kind: "enum" } ? K : never;
}[ViewPrefKey];

/** An enum pref's pick-one options, `{ value, label }` in declared order — the
 *  shape `MenuRadioGroup` takes. Every enum-valued control (the View menu's
 *  divider width, the Bibliography panel's filter, …) renders off this, so an
 *  enum's values and their labels are stated once, here (task 931). */
export function enumOptions<K extends EnumViewPrefKey>(
  key: K,
): ReadonlyArray<{ value: RegistryPrefs[K]; label: string }> {
  const def = VIEW_PREF_REGISTRY[key] as unknown as EnumDef<RegistryPrefs[K] & string>;
  return def.values.map((value) => ({ value, label: def.valueLabels[value] }));
}

/* ── Value coercion: the registry as a VALIDATOR (task 677) ────────────── */

/**
 * Coerce a raw stored slice's registry-owned fields to their declared domains.
 *
 * WHY. `VIEW_PREF_REGISTRY` declares each pref's `kind`, its `values` (enums)
 * and its `domain` (sets) — and until this function existed, nothing read any
 * of them at load. A stored blob could carry `dividerWidth: "gigantic"` or
 * `showMarginalia: "yes"` and the app adopted it verbatim, then re-persisted
 * it as its own. The rare path validated (the legacy standalone
 * `virgil-divider-width` key did check its three spellings); the common path
 * trusted. "A registry earns its name by being read" — AGENTS.md.
 *
 * WHAT. Only keys PRESENT in `slice` are answered for, so the caller keeps
 * ownership of "absent means default": `loadPrefs` fills from `DEFAULT_PREFS`,
 * `normalizeGlobalSlice` from `REGISTRY_DEFAULTS`.
 *
 *  - `toggle` → must be a `boolean`, else the registry default.
 *  - `enum`   → must be one of `values`, else the registry default.
 *  - `set`    → must be an array, filtered to `domain ?? members`; a non-array
 *               falls back to a fresh copy of the registry default.
 *
 * A `set` is FILTERED rather than reset because it is a list of independent
 * answers: one unrecognised member must not cost the user the others. A
 * toggle or enum has one answer, so an unrecognised one leaves nothing to keep.
 */
export function coerceRegistryPrefs(
  slice: Record<string, unknown>,
): Partial<RegistryPrefs> {
  const out: Record<string, unknown> = {};
  for (const key of VIEW_PREF_KEYS) {
    if (!(key in slice)) continue;
    const def = VIEW_PREF_REGISTRY[key] as ViewPrefDef;
    const raw = slice[key];
    if (def.kind === "toggle") {
      out[key] = typeof raw === "boolean" ? raw : def.default;
    } else if (def.kind === "enum") {
      out[key] =
        typeof raw === "string" && (def.values as readonly string[]).includes(raw)
          ? raw
          : def.default;
    } else {
      const allowed = new Set<unknown>(def.domain ?? def.members);
      out[key] = Array.isArray(raw)
        ? raw.filter((m) => allowed.has(m))
        : [...def.default];
    }
  }
  return out as Partial<RegistryPrefs>;
}
