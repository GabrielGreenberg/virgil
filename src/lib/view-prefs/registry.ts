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

interface ToggleDef<D extends boolean = boolean> {
  kind: "toggle";
  scope: ViewPrefScope;
  default: D;
  label: string;
  menu: ViewPrefMenuGroup;
}
interface EnumDef<V extends string> {
  kind: "enum";
  scope: ViewPrefScope;
  default: V;
  values: readonly V[];
  label: string;
  menu?: ViewPrefMenuGroup;
  valueLabels: Record<V, string>;
}
interface SetDef<E extends string | number> {
  kind: "set";
  scope: ViewPrefScope;
  default: readonly E[];
  members: readonly E[];
  polarity: "present" | "hidden";
  label: string;
  menu?: ViewPrefMenuGroup;
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
  showParTitles:        { kind: "toggle", scope: "global", default: true, label: "Paragraph titles", menu: "display" },
  showCardTitles:       { kind: "toggle", scope: "global", default: true, label: "Card titles",       menu: "display" },
  showLatexComments:    { kind: "toggle", scope: "global", default: true, label: "% comments",        menu: "display" },
  showHeadingLabels:    { kind: "toggle", scope: "global", default: true, label: "Labels",            menu: "display" },
  omniDimResting:       { kind: "toggle", scope: "global", default: true, label: "Dim cards at rest",  menu: "display" },
  // Marginalia
  showMarginalia:       { kind: "toggle", scope: "global", default: true, label: "Show marginalia",   menu: "marginalia" },
  hiddenMarginaliaTypes:{ kind: "set", scope: "global", default: [] as MarginaliaType[], members: ["note", "archive", "todo"] as const,
                          polarity: "hidden", label: "Marginalia types", menu: "marginalia",
                          memberLabels: { note: "Notes", archive: "Archive", todo: "Todo" } },
  // Highlights
  showHighlights:       { kind: "toggle", scope: "global", default: true, label: "Show highlights",   menu: "highlights" },
  hiddenHighlightTypes: { kind: "set", scope: "global", default: [] as HighlightType[], members: ["note", "todo", "comment", "cut"] as const,
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

/** All registry keys, in declaration order. */
export const VIEW_PREF_KEYS = Object.keys(VIEW_PREF_REGISTRY) as ViewPrefKey[];
