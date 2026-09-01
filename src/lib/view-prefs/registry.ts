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
import type {
  MarginaliaType,
  DividerLevel,
  HighlightType,
} from "@/hooks/useViewPrefs";

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
  promote?: boolean;
}
interface EnumDef<V extends string> {
  kind: "enum";
  scope: ViewPrefScope;
  default: V;
  values: readonly V[];
  label: string;
  menu?: ViewPrefMenuGroup;
  valueLabels: Record<V, string>;
  promote?: boolean;
}
interface SetDef<E extends string | number> {
  kind: "set";
  scope: ViewPrefScope;
  default: readonly E[];
  members: readonly E[];
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
 * IMPORTANT: the `default` values here MUST equal `useViewPrefs.defaults.json`
 * (the promotion pipeline is byte-stable against that JSON). The `set` defaults
 * use an `as <ElementType>[]` cast so the generated value type yields the FULL
 * element type — the menu may render only a subset of `members`, but the stored
 * value can include extra members (e.g. a "report" marginalia type).
 */
export const VIEW_PREF_REGISTRY = {
  // Display group (flat toggles)
  // promote:false — ship default frozen at the registry value (task 057). A prior
  // promote-defaults folded Gabriel's personal snapshot and drifted this true→false;
  // opting out of promotion makes the registry the durable SSOT so it can't recur.
  showParTitles:        { kind: "toggle", scope: "global", default: true, label: "Paragraph titles", menu: "display", menuRowId: "par-titles", promote: false },
  showCardTitles:       { kind: "toggle", scope: "global", default: true, label: "Card titles",       menu: "display", menuRowId: "card-titles" },
  showLatexComments:    { kind: "toggle", scope: "global", default: true, label: "% comments",        menu: "display", menuRowId: "latex-comments" },
  showHeadingLabels:    { kind: "toggle", scope: "global", default: true, label: "Labels",            menu: "display", menuRowId: "heading-labels" },
  omniDimResting:       { kind: "toggle", scope: "global", default: true, label: "Dim cards at rest",  menu: "display", menuRowId: "omni-dim-resting" },
  cardOutlineChrome:    { kind: "toggle", scope: "global", default: false, label: "Card outline",       menu: "display", menuRowId: "card-outline" },
  // The browser's native spellcheck, made deliberate and switchable (task 517).
  // Reflected onto <body> by `spellcheck-policy.ts` — a single inherited HTML
  // attribute rather than a prop threaded into twelve `editorProps.attributes`
  // blocks. Default ON = today's behaviour; task 518's own checker flips it.
  checkSpelling:        { kind: "toggle", scope: "global", default: true, label: "Check spelling",      menu: "display", menuRowId: "check-spelling" },
  // Marginalia
  showMarginalia:       { kind: "toggle", scope: "global", default: true, label: "Show marginalia",   menu: "marginalia", menuRowId: "marginalia-show" },
  hiddenMarginaliaTypes:{ kind: "set", scope: "global", default: [] as MarginaliaType[], members: (["note", "archive", "todo"] as const) satisfies readonly MarginaliaType[],
                          polarity: "hidden", label: "Marginalia types", menu: "marginalia",
                          memberLabels: { note: "Notes", archive: "Archive", todo: "Todo" } },
  // Highlights
  showHighlights:       { kind: "toggle", scope: "global", default: true, label: "Show highlights",   menu: "highlights", menuRowId: "highlights-show" },
  hiddenHighlightTypes: { kind: "set", scope: "global", default: [] as HighlightType[], members: (["note", "todo", "comment", "cut"] as const) satisfies readonly HighlightType[],
                          polarity: "hidden", label: "Highlight types", menu: "highlights",
                          memberLabels: { note: "Notes", todo: "Todo", comment: "Revisions", cut: "Cuts" } },
  // Dividers
  dividerLevels: { kind: "set", scope: "global", default: [2, 4, 3, 1, 0] as DividerLevel[], members: [0, 1, 2, 3, 4, 5, 6] as const,
                   polarity: "present", label: "Show dividers for…", menu: "dividers",
                   memberLabels: { 0: "Parts", 1: "Chapters", 2: "Sections", 3: "Subsections", 4: "Subsubsections", 5: "Paragraph headings", 6: "Subparagraph headings" } },
  dividerWidth: { kind: "enum", scope: "global", default: "text", values: ["full", "mid", "text"],
                  label: "Divider preferences", menu: "dividers",
                  valueLabels: { full: "Full width", mid: "Mid width", text: "Text width" } },
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
): ReadonlyArray<{ key: ToggleViewPrefKey; id: string; label: string }> {
  return Object.entries(VIEW_PREF_REGISTRY)
    .filter(([, d]) => d.kind === "toggle" && d.menu === group)
    .map(([key, d]) => {
      const def = d as ToggleDef;
      return { key: key as ToggleViewPrefKey, id: def.menuRowId, label: def.label };
    });
}
