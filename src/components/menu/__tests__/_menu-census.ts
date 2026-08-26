// The floating-command-surface CENSUS — the shared population + classification
// the two menu guardrails both read (task 459).
//
// Why this module exists. `anchored-menu-guardrail` (task 143/181) asks *who
// POSITIONS a floating menu by hand?*; `menu-surface-guardrail` (task 295) asks
// *who PAINTS one by hand?*. They are two questions about ONE population, and
// each of them used to discover that population from a different MECHANISM —
// the first from a rect read or a CSS edge offset, the second from a
// `<MenuProvider>` / `<AnchoredMenu>` mount. A floating command surface can be
// one without using either mechanism, and four were:
//
//   - `SlashCommandPopup` is anchored to a CARET RECT (`view.coordsAtPos`),
//     which is neither of the anchored census's two dialects, and mounts no
//     provider — so it shipped `rounded` (4px) + `shadow-md` + `--edge-subtle`,
//     a seventh vocabulary, on the surface a user opens most often;
//   - `NodeEditPopover` took the POSITIONING primitive and not the SURFACE, so
//     the anchored census read it compliant while `.math-popover` /
//     `.figure-popover` painted `--panel-bg` + a literal `0 4px 16px` shadow;
//   - `.label-ref-popover-dropdown` and the (dead) `.footnote-editor-popup`
//     author their chrome entirely in `globals.css`, where there is nothing in
//     the TSX for either census to grep.
//
// Task-404's rule, one subsystem over: *discover a census's population by the
// QUESTION, not by the MECHANISM.* So the population and its per-entry
// CLASSIFICATION live here, once, and both guardrails read them — which is what
// lets the surface census ask about a hand-rolled menu it never mounts, and
// what keeps the two from drifting into two ideas of what a floating menu is.
//
// This file is inside `__tests__/`, which every walker here skips, so it cannot
// indict itself. Same placement rule as `_source-scan.ts`.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SRC = path.resolve(HERE, "../../.."); // src/
export const LIBRARY = path.resolve(HERE, "../../../../library"); // the Library silo

/**
 * Declarations that position an anchored surface themselves and are NOT on the
 * primitive. Keyed `<repo-relative file>::<declaration>`; every entry says why
 * it is not simply a missed migration.
 *
 * `src/` is NOT drained of menus, and saying so plainly is the point: four
 * entries here are real hand-rolled menus whose PLACEMENT migration is
 * outstanding (the Fonts-dialog combobox, the slash popup, the library pod's
 * add menu, the Help menu's hover sub-menu), beside the two Library-silo
 * holdouts and the declarations that trip the shape without being menus at all.
 * Since task 459 every one of them is answered on the SURFACE axis by
 * `menu-surface-guardrail`, which reads this list rather than a population of
 * its own — a holdout on placement is not an exemption from chrome.
 */
export const PERMITTED_HAND_ROLLED_ANCHORED_SURFACES: Record<string, string> = {
  "src/components/EditorPane.tsx::EditorPane":
    "NOT AN ANCHORED MENU — the editor shell. Its three signals come from unrelated places in one very large component (positioned chrome, a shadow token, and rect reads for drop/geometry work), which is the cost of a declaration-scoped census over a 7k-line component. Every menu EditorPane hosts is a child component with its own entry or its own primitive call.",
  "src/components/FloatingPanel.tsx::FloatingPanelInner":
    "NOT AN ANCHORED MENU — a draggable/resizable float shell (the tool-window taxonomy: `SystemDialog variant=\"draggable\"` / FLOAT_Z tiers), whose position is the user's own drag state persisted per float, not a placement solved against a trigger. It measures rects to CLAMP a dragged window inside the viewport. Nothing about the menu primitive fits it; it would have to grow a drag engine to accept one.",
  "src/components/Marginalia.tsx::MarkerButton":
    "NOT AN ANCHORED MENU — an in-text marginalia marker. It is pod-relative chrome positioned by the marginalia registry's layout pass (the scroll-anchor law's branch (a)), not a popup solved against a trigger; the rect read is that measurement.",
  "src/components/editor-layout/split-editor-panes.tsx::SplitEditorPanes":
    "NOT AN ANCHORED MENU — a pane layout. Positioned dividers + a shadow token + the pane-resize engine's rect reads; it opens no popup at all.",
  "src/components/editor-layout/split-with-code.tsx::SplitWithCode":
    "NOT AN ANCHORED MENU — the editor/code split, same shape as its sibling above (gutter chrome + engine rect reads).",
  "src/components/stack/StackThumbnail.tsx::StackThumbnail":
    "NOT AN ANCHORED MENU — a stack card thumbnail: absolutely-positioned card chrome with a shadow, whose rect read feeds the stack's drag/hit-test, not a placement.",
  "library/components/LeftListRow.tsx::LeftListRow":
    "NOT AN ANCHORED MENU — a catalog list row. Surfaced only when the detectors learned to read a multi-line className (task 181): its rect read builds the DRAG GHOST, and the positioned shadowed surface is that ghost's count badge, written as an inline `style=\"position:absolute;…box-shadow:…\"` string. It opens no popup.",
  "library/components/RowMenu.tsx::RowMenu":
    "LIBRARY-SILO HOLDOUT (known follow-up, not an exemption). The catalog row kebab: portal + `position:fixed`, `role=\"menu\"`, Escape, and a deferred outside-mousedown — so it is the most complete of the hand-rolls — but it flips off an `items.length * ITEM_HEIGHT` ESTIMATE (the `HeaderAddDropdown` mistake), never flips horizontally, and never re-anchors. The silo CAN import the primitive (`PanelTabStrip` already imports `useFloatingMenuPosition`), so this is a migration nobody has done yet.",
  "library/components/PaperAiRequestsMenu.tsx::PaperAiRequestsMenu":
    "LIBRARY-SILO HOLDOUT (known follow-up, not an exemption). The per-paper AI-request checkbox menu: `top`/`left` from the trigger rect with NO flip in either axis, so it runs off the bottom of a short window. It is also the ONE menu in either silo that restores focus to its trigger on Escape — a capability the shared primitive does not have (it navigates by roving `aria-activedescendant` and never focuses items), so migrating it means teaching the primitive focus return, not just swapping the shell.",

  // ── The three surfaced by the CSS_ANCHORED signal (task 181) and NOT
  //    migrated in it. Each is a real follow-up with a stated reason it is a
  //    different job from "swap the shell", not an exemption. They are listed
  //    rather than fixed because the alternative — leaving the signal narrow
  //    enough that they don't appear — is how the previous three stayed
  //    invisible for a release cycle.
  "src/components/FontPicker.tsx::FontPicker":
    "HOLDOUT (follow-up). The font dropdown in the Fonts dialog (5 instances): `absolute z-50 left-0 right-0 mt-1` with a hand-rolled mousedown closer, no Escape, no flip, clipped by the dialog's own `overflow-y-auto` body — so the bottom-most pickers open into the clip. Not a menu swap: it is a COMBOBOX (filter input + grouped options + focus into the input), so it wants `layout=\"combobox\"` / `keyboardSource=\"input\"` / `useMenuCombobox` — the `LabelRefPopover` pattern — which `AnchoredMenu` does not model today (it owns the trigger and the open state; a combobox's input owns both). Migrating it ALSO changes Escape semantics across all five instances: today Escape with the list open dismisses the whole dialog.",
  "src/components/library/MyPapersPod.tsx::MyPapersPod":
    "HOLDOUT (follow-up). The pod's \"+ Add paper\" menu: the inline-style dialect (`position:\"absolute\", top:\"100%\", marginTop:2, zIndex:50`), `role=\"menu\"`, and it DOES have Escape — the most complete of the CSS-anchored hand-rolls — but no flip, no clamp, no re-anchor, and `zIndex:50` sits under the float layer. A straight `AnchoredMenu` migration; deferred only to keep task 181 to the panel silo it names.",
  // ── Surfaced by the CARET dialect (task 459). Its SURFACE is fixed in the
  //    same task — it paints from `.menu-surface` now — but its PLACEMENT is
  //    still its own, so it is named here rather than silently absorbed.
  "src/components/SlashCommandPopup.tsx::SlashCommandPopup":
    "HOLDOUT (follow-up). The `/` command popup, anchored to a CARET rect (`view.coordsAtPos(slashPos)`) rather than to a trigger — which is why neither of the pre-459 ANCHORED dialects could see it, and why it shipped a seventh chrome vocabulary (bare `rounded` = 4px against every other menu's 8px). It hand-rolls its own viewport clamp and vertical flip, and `useFloatingMenuPosition` is the right destination: it already models a point anchor. Not a drop-in, because this popup's placement is entangled with three laws its current effect discharges by hand — the scroll-anchor probe (`recordScrollPlacement`), the RAF coalescing with an equality bail, and the layout-gesture SUPPRESSION that hides it for a pane/window drag — so the migration has to prove the hook preserves all three rather than swap a shell.",

  "src/components/editor-layout/StatusCluster.tsx::StatusClusterImpl":
    "HOLDOUT (follow-up), and the one whose SHAPE differs. The Commands sub-menu of the Help menu: `left-full` with no horizontal escape, opened on HOVER rather than click, and its anchor rect is measured in a DIFFERENT FILE (`EditorLayout.tsx`) and prop-threaded in — which is why the rect-based ANCHORED signal never saw it and why `AnchoredMenu` (which owns its own trigger and rect) is not a drop-in. Its PARENT, the Help menu, is itself half-migrated: on `useFloatingMenuPosition` (hence census-exempt) but with a hand-rolled window-click closer, no Escape, no roving nav and no menu ARIA. Fix the parent and the child together.",
};

/** Referencing any of these IS building on the primitive. This regex is
 *  LOAD-BEARING, not decorative: the census below asks it about every censused
 *  declaration, which is what lets the surface detectors be broad without the
 *  allowlist swallowing every already-migrated menu. Rename one of these
 *  symbols and the census grows, loudly. */
export const PRIMITIVE_API =
  /\b(?:MenuProvider|AnchoredMenu|useFloatingMenuPosition|useMenuItem|MenuToggleRow|MenuActionRow|MenuItemsFromRegistry)\b/;

/** Strip comments so the doctrine prose in this repo (which quotes the guarded
 *  literals heavily, including in this very file) can't read as live code. */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/**
 * The guarded shape as THREE INDEPENDENT signals, deliberately not as one
 * literal. An early version required a positioned surface and its shadow to
 * appear inside the SAME className string — which reads well and misses the
 * idiom this repo actually writes, where the class carries `fixed` and an
 * inline `containerStyle={{ boxShadow: "var(--pod-shadow)" }}` carries the
 * elevation. It also broke on any quote between the two tokens, which an
 * interpolated ternary inside a template-literal className routinely puts
 * there. Signals that must co-occur in a declaration, never in one string:
 *
 *   POSITIONED — a `fixed`/`absolute` className, or a `position` style.
 *   SHADOWED   — ANY `shadow-*` token (including `shadow-[var(--pod-shadow)]`
 *                and `shadow-ambient`) or an inline `boxShadow`. A closed list
 *                of `shadow-lg|md|xl` missed every token this repo ships.
 *   ANCHORED   — the surface is solved against SOMETHING. Two dialects, and the
 *                second was the hole (see below): a MEASURED anchor (a rect read
 *                or a pointer coordinate — a right-click menu placed at
 *                `clientX/clientY` is the same defect class minus the rect), or
 *                a CSS anchor (offset from the wrapper's own edge by layout).
 *
 * ── Why ANCHORED has a CSS dialect (task 181) ──
 * The measured-anchor signal was, on its own, a proxy for "this is a popup" —
 * and it silently excluded an entire dialect of the SAME defect. A dropdown
 * written `absolute right-0 top-full mt-1 … shadow-lg z-[9999]` reads no rect
 * at all: the browser anchors it to the `relative` wrapper by layout. Six such
 * surfaces sat in `src/` while this census reported green, including
 * `PanelThemePicker` — the sharpest site task 181 named, at `z-[9999]` (=
 * `DROP_INDICATOR_Z`), whose non-portaled 168px grid was ALSO the sole reason
 * `ItemMenu` had to disable its viewport clamp app-wide. And `CardKindDropdown`
 * lived in `panel-primitives.tsx`, the same file whose `ItemMenu` had already
 * migrated: the declaration scoping caught the file-vouches-for-itself failure
 * and the narrow ANCHORED signal let the site through anyway. **Two correct
 * halves of a guard do not make a guard.**
 *
 * The CSS dialect is "an absolutely-positioned surface offset from its anchor's
 * edge", in both idioms this repo writes: the class form (`top-full` /
 * `bottom-full` / `left-full` / `right-full`, or `absolute` + an `mt-`/`mb-`
 * gap) and the inline-style form (`top: "100%"` — the Library silo's dialect,
 * the same split the SHADOWED detector already had to learn). Deliberately NOT
 * "any conditionally-rendered positioned surface", which is the tempting
 * generalization and would sweep in every dialog, drag ghost and layout pod —
 * an allowlist of non-menus is not a guard, it is a filing cabinet. Measured
 * against both trees when it was written: it adds SIX declarations repo-wide,
 * all six genuine hand-rolled popups, and zero false positives.
 *
 * Residual this census cannot reach, stated rather than implied: a surface
 * whose position + shadow live in a CSS CLASS (`.label-ref-popover-dropdown` in
 * globals.css is exactly that) leaves nothing in the TSX to grep. Closing it
 * means censusing the stylesheet, which is a different guard. Two shapes stay
 * out of the CSS dialect on purpose — a surface positioned from PROP-threaded
 * coordinates (`Marginalia`'s `OverflowPill` reads its cell from the marginalia
 * registry's layout pass, which is the scroll-anchor law's sanctioned branch
 * (a)) and one whose rect is measured in a different FILE
 * (`StatusCluster`'s hover sub-menu, allowlisted with that noted).
 */
export const POSITIONED =
  /className=[^\n]*\b(?:fixed|absolute)\b|position:\s*["'](?:fixed|absolute)["']/;
/**
 * SHADOWED, and the third spelling is the one task 459 had to add.
 *
 * The signal is really *"this declaration paints a floating SURFACE"*, and a
 * shadow token was a proxy for it that broke precisely when the surface was
 * done RIGHT: the moment a menu adopts `.menu-surface`, its elevation lives in
 * the shared class and its TSX declares no shadow at all — so the whole
 * declaration fell out of this census and its hand-rolled POSITIONING went
 * unowned. Measured when 459 retoned them: `FontPicker` and `StatusClusterImpl`
 * both vanished from the population on adoption, taking their
 * `KNOWN_SRC_MENU_HOLDOUTS` entries with them. A census that stops watching a
 * menu as a reward for fixing its chrome is a census that rewards hiding chrome
 * in a class. `.menu-surface` IS the shadow, so it counts as one.
 */
export const SHADOWED =
  /\bshadow-[A-Za-z0-9[\]()_,./-]+|boxShadow|\bmenu-surface\b/;
/** ANCHORED, dialect 1: the surface MEASURES its anchor. */
export const MEASURED_ANCHOR =
  /getBoundingClientRect|getClientRects|\bclientX\b|\bclientY\b/;
/**
 * ANCHORED, dialect 3: the surface is solved against a CARET RECT (task 459).
 *
 * `view.coordsAtPos(pos)` is ProseMirror's rect read — the same act
 * `getBoundingClientRect` performs, through the editor's own API instead of the
 * DOM's — so a popup placed from it is anchored by measurement in every sense
 * that matters, and was invisible to dialect 1 purely because the call has a
 * different name. Eleven files in the two silos call it; it is a real dialect,
 * not a one-off.
 *
 * Measured before landing, exactly as task 181 measured its own addition: over
 * both trees this adds **one** declaration, `SlashCommandPopup` — a genuine
 * hand-rolled caret popup that had shipped a seventh chrome vocabulary. Zero
 * false positives: the other `coordsAtPos` consumers (`TextObjectGrabHandle`,
 * `PendingChangePill`, `SelectionActionsMenu`, the omni/geometry readers) are
 * kept out by the POSITIONED+SHADOWED conjunction rather than by an allowlist,
 * which is what the conjunction is for. The addition is STILL one after 459's
 * retone, and only because SHADOWED learned to count `.menu-surface` in the
 * same pass — otherwise adopting the shared surface would have deleted the
 * popup from the census that owns its PLACEMENT, which is the trap documented
 * on SHADOWED above. Its defect fixtures in the guardrail are M1's pre-459
 * className verbatim, and the adopted form beside it.
 */
export const CARET_ANCHOR = /\bcoordsAtPos(?:Cached)?\b/;
/**
 * ANCHORED, dialect 2: the surface is offset from its anchor's EDGE by CSS.
 *
 * Read against a WHITESPACE-FLATTENED declaration (`flatten` below), which is
 * not a tidiness choice. A JSX `className` in this repo routinely spans several
 * lines the moment it carries a conditional:
 *
 *     className={`absolute z-50 shadow-lg
 *       ${align === "end" ? "right-0" : "left-0"}
 *       top-full mt-1`}
 *
 * A `className=[^\n]*` detector reads that as "no `top-full` near a className"
 * and reports the file clean — so the census would have been widened to catch a
 * dialect and still missed it in the idiom the codebase actually writes. Same
 * class of near-miss as the one this leg exists to close.
 *
 * Three forms, each seen in live code:
 *   EDGE_CLASS — the `*-full` family, incl. arbitrary values (`top-[100%]`,
 *                `top-[calc(100%+4px)]`);
 *   GAP_CLASS  — `absolute` + a margin gap in any Tailwind spelling
 *                (`mt-1`, `mb-1.5`, `mt-[3px]`, `my-1`);
 *   EDGE_STYLE — the inline dialect (`top: "100%"`, `top: "calc(100% + 4px)"`).
 */
export const CSS_ANCHOR_EDGE_CLASS =
  /className=[^\n]*\b(?:top|bottom|left|right)-(?:full|\[[^\]]*100%[^\]]*\])/;
export const CSS_ANCHOR_GAP_CLASS =
  /className=[^\n]*\babsolute\b[^\n]*\bm[tbyx]-[\d[]|className=[^\n]*\bm[tbyx]-[\d[][^\n]*\babsolute\b/;
export const CSS_ANCHOR_EDGE_STYLE =
  /\b(?:top|bottom|left|right)\s*:\s*["'](?:100%|calc\([^"']*100%[^"']*\))["']/;

/** Collapse a declaration onto single lines per JSX attribute run, so the
 *  `className=[^\n]*` detectors above see a multi-line attribute as one string.
 *  Only whitespace is touched — no token is rewritten. */
export function flatten(block: string): string {
  return block.replace(/\s*\n\s*/g, " ");
}

export function isCssAnchored(block: string): boolean {
  const flat = flatten(block);
  return (
    CSS_ANCHOR_EDGE_CLASS.test(flat) ||
    CSS_ANCHOR_GAP_CLASS.test(flat) ||
    CSS_ANCHOR_EDGE_STYLE.test(flat)
  );
}

export function declaresAnchoredSurface(block: string): boolean {
  // Flattened for POSITIONED too — it carries the same `className=[^\n]*` shape
  // and the same multi-line-attribute blind spot.
  const flat = flatten(block);
  return (
    POSITIONED.test(flat) &&
    SHADOWED.test(flat) &&
    (MEASURED_ANCHOR.test(flat) || CARET_ANCHOR.test(flat) || isCssAnchored(flat))
  );
}

export function usesMenuPrimitive(block: string): boolean {
  return PRIMITIVE_API.test(block);
}

/** Exposed for the fixture that asserts a CSS-anchored surface carries NO
 *  measured anchor — i.e. that it really is invisible to the pre-181 detector,
 *  and the new leg is what catches it rather than the old one incidentally. */
export const MEASURED_ANCHOR_FOR_TEST = MEASURED_ANCHOR;

/**
 * TOP-LEVEL declarations (column 0), sliced by their opening line — the unit a
 * component is written in, and the unit the allowlist can name stably.
 *
 * Deliberately not finer. Splitting on indented declarations too would attach
 * each literal to whatever inner `const handleX = () => …` happened to precede
 * it — unstable names that any refactor invalidates, and a rect read separated
 * from the JSX it positions.
 *
 * Two residuals, stated rather than implied. A hand-rolled menu written as an
 * INDENTED inner component is attributed to its enclosing top-level
 * declaration — so an enclosing component that uses the primitive, or one that
 * is itself allowlisted, vouches for it. All six real instances of this defect
 * (the three fixed here, the two library holdouts, and `ItemMenu` before task
 * 180) were top-level declarations, which is the shape this catches. And a
 * surface whose position + shadow live entirely in a CSS class is invisible to
 * any TSX census; see the note on the detectors above.
 */
export const DECL = /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_$]+)/gm;

export function splitDeclarations(
  source: string,
): Array<{ name: string; block: string }> {
  const matches = [...source.matchAll(DECL)];
  return matches.map((m, i) => ({
    name: m[1],
    block: source.slice(m.index ?? 0, matches[i + 1]?.index ?? source.length),
  }));
}

export function walkSource(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "__tests__" || entry === "__fixtures__") continue;
      out.push(...walkSource(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every declaration that declares an anchored surface AND does not build on the
 * primitive. The participation test is applied HERE, inside the census, rather
 * than as a second pass over a wider list — that ordering is what lets the three
 * surface signals be as broad as they are: `TabPlusMenu`, `DragHandleMenu`,
 * `HeadingTypeMenu`, `SelectionColorPopover` and the two topbar kebabs all trip
 * POSITIONED + SHADOWED + ANCHORED (they pass `containerStyle={{ boxShadow }}`
 * to the primitive), and every one of them is answered by `usesMenuPrimitive`
 * instead of by an allowlist entry that would have to be maintained by hand.
 */
export function censusBothSilos(): Array<{ key: string; block: string }> {
  const hits: Array<{ key: string; block: string }> = [];
  for (const [prefix, root] of [
    ["src", SRC],
    ["library", LIBRARY],
  ] as const) {
    for (const file of walkSource(root)) {
      const rel = `${prefix}/${path.relative(root, file).split(path.sep).join("/")}`;
      const source = stripComments(readFileSync(file, "utf8"));
      for (const { name, block } of splitDeclarations(source)) {
        if (!declaresAnchoredSurface(block)) continue;
        if (usesMenuPrimitive(block)) continue;
        hits.push({ key: `${rel}::${name}`, block });
      }
    }
  }
  return hits;
}

/**
 * The classification, published once so both censuses read the SAME idea of
 * what a floating menu is (task 459).
 *
 * An allowlist entry that opens `NOT AN ANCHORED MENU` is an author's claim
 * that the declaration trips the three surface signals for reasons unrelated to
 * popups (a pane layout, a float shell, a drag ghost). Everything else on the
 * list is a real hand-rolled MENU whose migration is outstanding — and it is
 * that half, plus every future hit nobody has listed yet, that the SURFACE
 * census inherits as its own population. Before this, the surface census could
 * only see menus that mounted the primitive, so a menu that hand-rolled BOTH
 * its placement and its chrome was answered on the first axis and unowned on
 * the second: `FontPicker`, `StatusClusterImpl` and `MyPapersPod` each sat on
 * the anchored allowlist for a release with their surfaces censused by nothing.
 */
export function isNotAnAnchoredMenu(key: string): boolean {
  return (PERMITTED_HAND_ROLLED_ANCHORED_SURFACES[key] ?? "").startsWith(
    "NOT AN ANCHORED MENU",
  );
}

/** The MENU half of the census: hand-rolled anchored surfaces their own
 *  allowlist entry does not classify away as non-menus (plus anything not on
 *  the list at all, which the anchored census fails on separately). */
export function handRolledMenus(): Array<{ key: string; block: string }> {
  return censusBothSilos().filter((h) => !isNotAnAnchoredMenu(h.key));
}

// ───────────────────────────────────────────────────────────────────────────
// The ROW population (task 477) — a THIRD question about the same subsystem.
//
// The two censuses above ask *who POSITIONS a floating menu by hand?* and *who
// PAINTS one by hand?*, and both discover their population from DECLARATIONS.
// This one asks *who puts an ACTIVATABLE ROW inside a menu the shared keyboard
// controller is driving?* — a question about the JSX a shell is handed as
// CHILDREN, which no declaration-scoped walk can see: `ItemMenu`'s rows are
// authored in eleven panel files and in three shared components, none of which
// mounts a provider itself.
//
// Why it matters, stated as the mechanism rather than as a preference: a
// window-source provider installs a window-CAPTURE keydown while it is open and
// consumes Enter / Space / every arrow, so a row the registry never saw is not
// merely un-navigable — the controller SUPPRESSES the key the focused control
// needed. An empty registry is strictly worse than no controller at all. A
// COMBOBOX provider (`keyboardSource: "input"`) installs no window listener, so
// a stray control in one degrades to Tab+Enter; it is excluded BY MECHANISM
// here rather than by allowlist.
// ───────────────────────────────────────────────────────────────────────────

/** The three shells whose children are a menu body. */
const ROW_SHELLS = ["ItemMenu", "AnchoredMenu", "MenuProvider"] as const;

/** A declaration that PARTICIPATES in the registry vouches for its own subtree:
 *  a `<button>` inside a registered row's markup is that row's chrome, not a
 *  second unregistered row. Stated as a residual rather than implied — a real
 *  second row nested inside a registered one would be invisible here, which is
 *  the compound-row case and a different question. */
const ROW_PARTICIPATES =
  /\buseMenuItem\b|\bgetItemProps\b|\bMenuActionRow\b|\bMenuToggleRow\b|\bMenuItemsFromRegistry\b/;

/** The row shapes a user can ACTIVATE. `<input>` is deliberately absent: a
 *  native form control inside a menu is a focus ISLAND (the `region: "widget"`
 *  model) — `PanelTextSizeRow`'s number stepper is reachable by Tab and is not
 *  a command the roving cursor should step onto. */
const BARE_ROW = /<(button|label)(?=[\s>])/g;

/** Tags whose recursion would leave the menu body: the primitive's own pieces
 *  and non-interactive chrome. */
const ROW_SKIP = new Set([
  "MenuSeparator",
  "MenuSectionLabel",
  "MenuActionRow",
  "MenuToggleRow",
  "MenuItemsFromRegistry",
  "MenuGrid",
  "MenuList",
  "AnchoredMenu",
  "MenuProvider",
  "ItemMenu",
  "Fragment",
]);

/** The CHILDREN region of every `<Shell …> … </Shell>` in `source`, plus the
 *  shell's own open tag (so the caller can read `keyboardSource` / `role`).
 *  Brace-aware, so a multi-line `trigger={() => (…)}` prop is skipped rather
 *  than mistaken for the body. */
export function menuBodyRegions(
  source: string,
): Array<{ shell: string; openTag: string; body: string }> {
  const out: Array<{ shell: string; openTag: string; body: string }> = [];
  for (const shell of ROW_SHELLS) {
    const openRe = new RegExp(`<${shell}(?=[\\s>])`, "g");
    let m: RegExpExecArray | null;
    while ((m = openRe.exec(source))) {
      let i = m.index + m[0].length;
      let inStr: string | null = null;
      let brace = 0;
      let selfClosing = false;
      for (; i < source.length; i++) {
        const c = source[i];
        if (inStr) {
          if (c === inStr && source[i - 1] !== "\\") inStr = null;
          continue;
        }
        if (c === '"' || c === "'" || c === "`") {
          inStr = c;
          continue;
        }
        if (c === "{") brace++;
        else if (c === "}") brace--;
        else if (brace === 0 && c === "/" && source[i + 1] === ">") {
          selfClosing = true;
          i += 2;
          break;
        } else if (brace === 0 && c === ">") {
          i += 1;
          break;
        }
      }
      if (selfClosing) continue;
      const openTag = source.slice(m.index, i);
      const bodyStart = i;
      const closeTag = `</${shell}>`;
      const nestedOpen = new RegExp(`<${shell}(?=[\\s>])`, "g");
      let depth = 1;
      let j = bodyStart;
      while (j < source.length) {
        const nextClose = source.indexOf(closeTag, j);
        if (nextClose === -1) break;
        nestedOpen.lastIndex = j;
        const nm = nestedOpen.exec(source);
        if (nm && nm.index < nextClose) {
          depth++;
          j = nm.index + 1;
          continue;
        }
        depth--;
        if (depth === 0) {
          out.push({ shell, openTag, body: source.slice(bodyStart, nextClose) });
          j = nextClose + closeTag.length;
          break;
        }
        j = nextClose + closeTag.length;
      }
    }
  }
  return out;
}

/** True for a shell whose provider installs the window-capture keyboard
 *  controller — i.e. one whose rows a missing registration leaves DEAD rather
 *  than merely un-navigable. `ItemMenu` / `AnchoredMenu` are always this. */
export function isWindowSourceShell(openTag: string): boolean {
  if (/keyboardSource=\{?["']input["']/.test(openTag)) return false;
  if (/role=\{?["']listbox["']/.test(openTag)) return false;
  return true;
}

export interface BareRowHit {
  /** `<file><Shell> > <Component> > …` — the path the recursion took. */
  where: string;
  /** The offending open tag, whitespace-flattened. */
  tag: string;
}

/**
 * Every bare `<button>` / `<label>` reachable as a ROW of a window-source menu
 * body in either silo.
 *
 * The reach is a bounded transitive closure over component tags found in the
 * body, resolved by NAME across both silos — because the rows are authored in
 * separate components (`MenuDelete`, `CardViewModeMenuItems`, `MarkerButton`)
 * and a body-only scan would see `<CardViewModeMenuItems />` and stop. Depth 2
 * covers every shipped shape (body → row component → its own child); a
 * participating declaration ends the walk, since it vouches for its subtree.
 */
export function censusBareMenuRows(): BareRowHit[] {
  const files: Array<{ rel: string; src: string }> = [];
  for (const [prefix, root] of [
    ["src", SRC],
    ["library", LIBRARY],
  ] as const) {
    for (const file of walkSource(root)) {
      files.push({
        rel: `${prefix}/${path.relative(root, file).split(path.sep).join("/")}`,
        src: stripComments(readFileSync(file, "utf8")),
      });
    }
  }

  // name → declaration blocks, so the walk can follow a row component.
  const byName = new Map<string, string[]>();
  for (const { src } of files) {
    for (const { name, block } of splitDeclarations(src)) {
      const list = byName.get(name);
      if (list) list.push(block);
      else byName.set(name, [block]);
    }
  }

  const hits: BareRowHit[] = [];
  const seen = new Set<string>();
  const visit = (where: string, block: string, depth: number): void => {
    if (ROW_PARTICIPATES.test(block)) return;
    for (const t of block.matchAll(BARE_ROW)) {
      const end = block.indexOf(">", t.index);
      hits.push({
        where,
        tag: block.slice(t.index, end + 1).replace(/\s+/g, " "),
      });
    }
    if (depth <= 0) return;
    for (const c of new Set(
      [...block.matchAll(/<([A-Z][A-Za-z0-9_]*)/g)].map((mm) => mm[1]),
    )) {
      if (ROW_SKIP.has(c)) continue;
      const decls = byName.get(c);
      if (!decls) continue;
      for (const [i, d] of decls.entries()) {
        const key = `${c}#${i}`;
        if (seen.has(key)) continue;
        seen.add(key);
        visit(`${where} > ${c}`, d, depth - 1);
      }
    }
  };

  for (const { rel, src } of files) {
    for (const r of menuBodyRegions(src)) {
      if (!isWindowSourceShell(r.openTag)) continue;
      visit(`${rel}<${r.shell}>`, r.body, 2);
    }
  }
  return hits;
}
