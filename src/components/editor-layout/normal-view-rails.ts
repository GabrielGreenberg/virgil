/**
 * Normal-view page width — the ONE derivation zen mode reads (task 1178).
 * ======================================================================
 *
 * Normal view stores no page width; it DERIVES one. The editor-pane row is
 * `[left rail?] [editor column] [right rail?]`, the editor column is
 * `flex: 1000 1 0`, and each rail is rigid: an icon strip
 * (`width: var(--icon-strip-w)`) plus a panel column whose basis is the
 * side's `panelWidths` pref, floored by `--panel-min` (0 when collapsed). A
 * side with no visible panels mounts no rail at all. The pod is what is left.
 *
 * Zen is a VIEW of that page, not a second store: it unmounts the rails and
 * gives the editor column `flex: 0 1 <normalViewPodBasis>` centred by auto
 * margins, so the pod keeps normal view's width at every window width —
 * window resizes re-solve in CSS, with no listener and no React state.
 *
 * The rail is described ONCE, as a list of {@link RailTerm}s, rendered as the
 * CSS `calc()` zen ships (its unit test evaluates that very string against the
 * token values, so the px model IS the shipped CSS). Normal view's own markup reads the same
 * three inputs — `ICON_STRIP_WIDTH_VAR` on the strip, the `panelPref` basis
 * floored by `--panel-min` on `PanelColumn`, `PANE_ROW_GAP_PX` on the row —
 * so the two views cannot drift.
 */

/** The editor-pane row's flex gap (EditorPane's `editor-pane-root`). */
export const PANE_ROW_GAP_PX = 2;

/** The icon strip's fixed width token (globals.css `--icon-strip-w`). */
export const ICON_STRIP_WIDTH_VAR = "--icon-strip-w";

/** One side's normal-view rail inputs. */
export interface NormalViewSide {
  /** The side mounts a rail in normal view (≥1 visible panel, no code split). */
  present: boolean;
  /** The side's panel column is collapsed (the strip stays). */
  collapsed: boolean;
  /** The side's committed panel width pref (`getPanelWidth(side, "omni")`). */
  panelPref: number;
}

export interface NormalViewSides {
  left: NormalViewSide;
  right: NormalViewSide;
}

type RailTerm =
  | { kind: "strip" }
  | { kind: "panel"; pref: number }
  | { kind: "gap" };

/** The width terms one side's rail removes from the row — the SSOT. */
function railTerms(side: NormalViewSide): RailTerm[] {
  if (!side.present) return [];
  const terms: RailTerm[] = [{ kind: "strip" }];
  if (!side.collapsed) terms.push({ kind: "panel", pref: side.panelPref });
  // The rail sits beside the editor column, so the row's gap separates them.
  terms.push({ kind: "gap" });
  return terms;
}

function termCss(t: RailTerm): string {
  switch (t.kind) {
    case "strip":
      return `var(${ICON_STRIP_WIDTH_VAR})`;
    case "panel":
      return `max(${t.pref}px, var(--panel-min))`;
    case "gap":
      return `${PANE_ROW_GAP_PX}px`;
  }
}

/**
 * The editor column's zen flex-basis: the row width minus both normal-view
 * rails, as a CSS length. `100%` resolves against the row's content box —
 * the same box normal view's flex distributes. The editor column's own
 * `min-width` floor is untouched, so on a narrow window both views clamp
 * identically.
 */
export function normalViewPodBasis(sides: NormalViewSides): string {
  const terms = [...railTerms(sides.left), ...railTerms(sides.right)];
  if (terms.length === 0) return "100%";
  return `calc(100% - ${terms.map(termCss).join(" - ")})`;
}
