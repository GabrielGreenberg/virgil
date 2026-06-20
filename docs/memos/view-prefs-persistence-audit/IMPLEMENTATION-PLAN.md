# VIEW_PREF_REGISTRY — Implementation Plan (editor spine)

> Authoritative spec for the deep fix. Audit context: ./AUDIT.md. User-approved scope:
> deep registry; par-titles/%comments GLOBAL; cover editor toggles + Bibliography filter +
> Library Text/PDF + Library parity; panels re-float on reload; Preference mode → session-only.

## 0. Verified facts that shape the design (line-anchored against the worktree)

- `useViewPrefs.ts`: `ViewPrefs` interface (`:73-195`), `DEFAULT_PREFS` built from `defaultPrefsJson` spread + 4 literal overrides (`:213-225`), `GLOBAL_PREF_KEYS` (`:247-266`), `GlobalPrefKey` type (`:267`), `GLOBAL_PREF_SET` (`:268`), `pickGlobal` (`:290-311`), `legacyMigrations` (`:373-417`), the load-return override block (`:621-642`) with the three hard-resets `panelMRU` (`:628`), `poppedOutPanels` (`:637`), `poppedOutOrigins` (`:638`), `persist` (`:683-717`), the hook's public return (`:1408-1464`). `loadPrefs` is **not exported** today (`:334`).
- The audit's `BibliographyPanel.tsx:109` is `useState<"cited" | "all">("cited")` — enum values are **`"cited" | "all"`**, not `"cited" | "full"`. Keep the real values.
- EditorPane menu wiring is at `:4687-4690` (audit said `:4738` — line drift; code identical).
- `ViewMenu` is a **named export, prop-controlled** component (`MenuBar.tsx:535`), and an existing test (`menubar-dropdowns-keyboard.test.tsx:223-258`) mounts it directly with a full `ViewMenuProps` bag and asserts labels, `menuitemcheckbox` roles, indentation, and close-on-toggle. **Hard constraint:** registry may drive *which* rows render + grouping, but `ViewMenu` must keep taking `checked`/`onToggle` per row from props, or that test must be rewritten. Keep the prop API; make the *internal row list* registry-derived.
- `showParTitles`/`showLatexComments` consumed only through the `menuBar` bundle → `viewToggleClasses()` (`chrome-config.ts:72-73`) → `hide-par-titles`/`hide-latex-comments` classes. No standalone localStorage key ever existed → **no migration needed**.
- Promotion pipeline: `dev-prefs-registry.json` `promotable[0].whitelist` (`:8-25`) is a hand-maintained list of global keys baked into `useViewPrefs.defaults.json`. It lacks par-titles/latex-comments. Both the whitelist and the defaults JSON must gain the two new global keys.
- `dropUnknownPanelIds.ts` exports `filterPlacements` etc., derived from `PANEL_REGISTRY` — the precedent for Bug 5's id-validation.

## 1. New file: `src/lib/view-prefs/registry.ts`

Pure, dependency-light. Imports ONLY types from `useViewPrefs` (`import type` — no runtime cycle).

### 1a. Entry shape

```ts
import type { MarginaliaType, DividerLevel, DividerWidth, HighlightType } from "@/hooks/useViewPrefs";

export type ViewPrefScope = "global" | "window";
export type ViewPrefMenuGroup = "display" | "marginalia" | "highlights" | "dividers";

interface ToggleDef<D extends boolean = boolean> {
  kind: "toggle"; scope: ViewPrefScope; default: D; label: string; menu: ViewPrefMenuGroup;
}
interface EnumDef<V extends string> {
  kind: "enum"; scope: ViewPrefScope; default: V; values: readonly V[];
  label: string; menu?: ViewPrefMenuGroup; valueLabels: Record<V, string>;
}
interface SetDef<E extends string | number> {
  kind: "set"; scope: ViewPrefScope; default: readonly E[]; members: readonly E[];
  polarity: "present" | "hidden"; label: string; menu?: ViewPrefMenuGroup;
  memberLabels: Record<string, string>;
}
export type ViewPrefDef = ToggleDef | EnumDef<string> | SetDef<string | number>;
```

### 1b. The full registry (keys = ViewPrefs field names)

```ts
export const VIEW_PREF_REGISTRY = {
  // Display group (flat toggles)
  showParTitles:        { kind: "toggle", scope: "global", default: true, label: "Paragraph titles", menu: "display" },
  showLatexComments:    { kind: "toggle", scope: "global", default: true, label: "% comments",        menu: "display" },
  showSectionIndicator: { kind: "toggle", scope: "global", default: true, label: "Current section",   menu: "display" },
  showHeadingLabels:    { kind: "toggle", scope: "global", default: true, label: "Labels",            menu: "display" },
  // Marginalia
  showMarginalia:       { kind: "toggle", scope: "global", default: true, label: "Show marginalia",   menu: "marginalia" },
  hiddenMarginaliaTypes:{ kind: "set", scope: "global", default: [] as MarginaliaType[], members: ["note","archive","todo"] as const,
                          polarity: "hidden", label: "Marginalia types", menu: "marginalia",
                          memberLabels: { note: "Notes", archive: "Archive", todo: "Todo" } },
  // Highlights
  showHighlights:       { kind: "toggle", scope: "global", default: true, label: "Show highlights",   menu: "highlights" },
  hiddenHighlightTypes: { kind: "set", scope: "global", default: [] as HighlightType[], members: ["note","todo","comment","cut"] as const,
                          polarity: "hidden", label: "Highlight types", menu: "highlights",
                          memberLabels: { note: "Notes", todo: "Todo", comment: "Revisions", cut: "Cuts" } },
  // Dividers
  dividerLevels: { kind: "set", scope: "global", default: [2,4,3,1,0] as DividerLevel[], members: [0,1,2,3,4,5,6] as const,
                   polarity: "present", label: "Show dividers for…", menu: "dividers",
                   memberLabels: { 0:"Parts",1:"Chapters",2:"Sections",3:"Subsections",4:"Subsubsections",5:"Paragraph headings",6:"Subparagraph headings" } },
  dividerWidth: { kind: "enum", scope: "global", default: "text", values: ["full","mid","text"],
                  label: "Divider preferences", menu: "dividers",
                  valueLabels: { full:"Full width", mid:"Mid width", text:"Text width" } },
  // Bibliography filter (NOT in the View menu; panel-local; window scope)
  bibFilter: { kind: "enum", scope: "window", default: "cited", values: ["cited","all"],
               label: "Bibliography filter", valueLabels: { cited:"Cited entries only", all:"Full bibliography" } },
} as const satisfies Record<string, ViewPrefDef>;

export type ViewPrefKey = keyof typeof VIEW_PREF_REGISTRY;
```

IMPORTANT: `dividerLevels` default `[2,4,3,1,0]`, `dividerWidth` default `"text"`, `hiddenHighlightTypes`/`hiddenMarginaliaTypes` `[]` — must equal `useViewPrefs.defaults.json` (`:83-102`), NOT the legacy-migration `"full"` fallback. Use `default: ... as MarginaliaType[]` / `as HighlightType[]` / `as DividerLevel[]` so `ValueOf` yields the FULL element type (the menu renders only a subset of members, but the stored value may include `"report"` etc.).

## 2. Type generation (in registry.ts)

```ts
type ValueOf<E extends ViewPrefDef> =
  E extends { kind: "toggle" } ? boolean :
  E extends { kind: "enum"; values: readonly (infer V)[] } ? V :
  E extends { kind: "set"; default: readonly (infer D)[] } ? D[] :
  never;
export type RegistryPrefs = { [K in ViewPrefKey]: ValueOf<(typeof VIEW_PREF_REGISTRY)[K]> };

export const REGISTRY_DEFAULTS: RegistryPrefs = Object.fromEntries(
  Object.entries(VIEW_PREF_REGISTRY).map(([k, def]) => [k, def.kind === "set" ? [...def.default] : def.default]),
) as RegistryPrefs;

export const REGISTRY_GLOBAL_KEYS = (Object.entries(VIEW_PREF_REGISTRY)
  .filter(([, d]) => d.scope === "global").map(([k]) => k)) as Array<...>; // narrow to global keys
```

- `ViewPrefs` becomes `export interface ViewPrefs extends RegistryPrefs { …structural fields only… }`. DELETE from the body the 8 moved fields (`showMarginalia`,`hiddenMarginaliaTypes`,`showSectionIndicator`,`showHeadingLabels`,`dividerLevels`,`dividerWidth`,`showHighlights`,`hiddenHighlightTypes`); do NOT add `showParTitles`/`showLatexComments`/`bibFilter` manually (they come from `RegistryPrefs`).
- `DEFAULT_PREFS`: `{ ...REGISTRY_DEFAULTS, ...(defaultPrefsJson as Omit<ViewPrefs, RegistryKeysInJson | "bibFilter" | "printOptions" | "omniCategories" | "cardArchiveView" | "suppressArchiveAtomWarning">), printOptions, omniCategories, cardArchiveView:{}, suppressArchiveAtomWarning:false }`. **JSON spread comes AFTER `REGISTRY_DEFAULTS`** so the 8 promoted fields keep their JSON values (promotion pipeline byte-stable). `bibFilter` (window) is excluded from the JSON cast; `REGISTRY_DEFAULTS` supplies it.
- `GLOBAL_PREF_KEYS` = `["printOptions","placements","pageWidth","editorLeftMargin","editorRightMargin","editorTopMargin","editorBottomMargin","codePaneRatio","omniCategories","omniHideAllCards", ...REGISTRY_GLOBAL_KEYS] as const`. `bibFilter` correctly absent → per-window.
- `pickGlobal`: replace 18-line object with a loop `for (const k of GLOBAL_PREF_KEYS) out[k]=p[k]`.

### Structural fields that STAY hand-authored in ViewPrefs
`placements, dockStack, panelHeights, panelMRU, collapsedLeft/Right, blankLeft/Right, panelWidths, editorSplit, editorSplitRatio, codePaneRatio, poppedOutPanels, poppedOutOrigins, floatPositions, panelModes, poppedOutCards, cardFloatPositions, pageWidth, editor{Left,Right,Top,Bottom}Margin, printOptions, topbarRightCollapsed, omniCategories, omniHideAllCards, cardArchiveView, suppressArchiveAtomWarning`.

## 3. useViewPrefs.ts edit list
1. Import registry artifacts.
2. `ViewPrefs extends RegistryPrefs`; delete the 8 moved field decls.
3. `DEFAULT_PREFS`: prepend `...REGISTRY_DEFAULTS`; widen the `Omit<…>` to also omit `bibFilter`.
4. `GLOBAL_PREF_KEYS`: structural globals `+ ...REGISTRY_GLOBAL_KEYS`.
5. `pickGlobal`: loop builder.
6. `legacyMigrations`: unchanged.
7. **Bug 5** load-return (`:621-642`): remove unconditional `poppedOutPanels:[]` + `poppedOutOrigins:{}`. Replace with validated survivors filtered against `cleanedPlacements` (computed `:579`) + `PANEL_REGISTRY` (drop `omni`/`blank`/unknown/unplaced). KEEP `panelMRU:{left:[],right:[]}` reset (genuinely session-only). `floatPositions` already persists so rects survive.
8. `export function loadPrefs` (was unexported `:334`).
9. New setters near `:1081-1146`: `toggleParTitles`, `toggleLatexComments`, `setBibFilter(v)`, generic `setViewPref<K>(key,value)` + `toggleViewPref(key)` (registry-guarded). Keep existing named setters.
10. Hook return (`:1408-1464`): add the 5 new setters.

## 4. JSON + promotion
- `useViewPrefs.defaults.json`: add `"showParTitles": true, "showLatexComments": true` (near `:91-94`). Do NOT add `bibFilter`.
- `dev-prefs-registry.json`: append `"showParTitles","showLatexComments"` to `promotable[0].whitelist`.

## 5. MenuBar.tsx ViewMenu (registry-driven rows, prop API preserved)
- Import registry; delete local `DIVIDER_LEVEL_LABELS`/`DIVIDER_WIDTH_LABELS` (`:40-54`) in favor of registry `memberLabels`/`valueLabels`.
- Display group (`:684-688`): map registry entries `menu==="display"` → `ViewToggleRow` with `checked`/`onToggle` from small lookup maps built from existing props (`showParTitles`→`onToggleParTitles`, etc.). Preserves labels + close-on-toggle.
- Marginalia/Highlights (`:690-726`): keep `ViewGroupRow` + expand state; sub-rows' members/labels from registry; `checked = !hiddenX.has(type)`.
- Dividers (`:727-756`): sub-rows from registry members filtered by `availableDividerLevels`; width from registry values+labels.
- Action rows (Margins…/Fonts…/Close all `:757-778`): unchanged.
- Keep `ViewMenuProps` and the prop-controlled contract (keyboard test stays green). The expand/collapse `useState` in ViewMenu is allowed (UI disclosure, not a pref toggle).

## 6. EditorLayout.tsx
- Delete `:896-897` useState; add `const showParTitles = prefs.showParTitles; const showLatexComments = prefs.showLatexComments;`.
- Destructure `toggleParTitles`, `toggleLatexComments` from `useViewPrefs()`.
- `editorPaneMenuBar` bundle (`:2484-2544`): rename bundle fields `setShowParTitles`/`setShowLatexComments` → `onToggleParTitles`/`onToggleLatexComments` (option b), point at the new toggles; fix deps array.

## 7. EditorPane.tsx
- `EditorPaneMenuBarBundle` (`:477-516`): `setShowParTitles`/`setShowLatexComments` → `onToggleParTitles`/`onToggleLatexComments`. Read fields stay.
- Menu wiring (`:4687-4690`): `onToggleParTitles={menuBar.onToggleParTitles}` etc.
- Bibliography plumbing (Bug 3): add `bibFilter`+`setBibFilter` to `EditorPaneViewPrefs` (near `setCardArchiveView` `:401`) + `editorPaneViewPrefs` memo (`:2736-2806`, +deps); thread through `BibliographyHost` props → `BibliographyPanel`. Mirrors the `cardArchiveView` per-window precedent.

## 8. BibliographyPanel.tsx (Bug 3)
- Add `bibFilter`+`setBibFilter` props; delete `:109` useState; alias `const filter = bibFilter; const setFilter = setBibFilter;` to minimize diff. Menu rows (`:600-617`) stay plain buttons but now read/write persisted `bibFilter`.

## 9. Tests
- 9a `src/hooks/__tests__/view-prefs-registry-roundtrip.test.ts` (jsdom, mock window-id): for EVERY registry entry, write a non-default to the correct blob, call exported `loadPrefs()`, assert round-trip into the right slice AND absent from the other. Cases: global-written-to-window gets promoted; window pref stays out of global; par-titles/%comments → global; bibFilter → window. Bug-5 case: `poppedOutPanels:["notes","quotations"]` + placements w/ notes → loads `["notes"]`.
- 9b `src/components/__tests__/view-menu-registry-source.test.ts`: assert no `ViewToggleRow checked={…}` in MenuBar is fed by a hand-rolled `useState` binding (TS-compiler AST walk or allowlist regex); assert `REGISTRY_GLOBAL_KEYS ⊆ dev-prefs-registry whitelist` and every `menu`-bearing entry's label appears in MenuBar source.
- 9c verify `menubar-dropdowns-keyboard.test.tsx`, `view-toggle-classes.test.ts`, `dropUnknownPanelIds.test.ts` still green.

## 10. Risks (mitigations baked in above)
Promotion pipeline (JSON-as-SSOT option A); cross-window sync (GLOBAL set superset); defaults JSON shape (+2 keys, widen Omit); keystroke-sanctity (same update→persist path); ViewMenu test coupling (prop API preserved); Bug-5 over-eager re-float (validate vs cleanedPlacements+PANEL_REGISTRY); element-type drift (`default: [] as MarginaliaType[]`); circular import (type-only); bibFilter default matches today.

## 11. Order
1 registry → {2 useViewPrefs, 3 json, 4 roundtrip-test} → {5 EditorLayout+EditorPane par-titles, 6 MenuBar, 7 Bibliography} independent → 8 static guard last.
