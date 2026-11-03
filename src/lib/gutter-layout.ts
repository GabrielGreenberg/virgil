/**
 * Is the cards-right / tools-left layout on? (task 1440)
 *
 * The ONE reader of `virgil:gutter-layout`. Default ON; `localStorage
 * ["virgil:gutter-layout"] = "off"` + reload restores the two icon strips and
 * docked panel bands. Read per CALL (cheap: one `localStorage` read), never on
 * a keystroke path.
 *
 * What it changes, and where:
 *  - `resolvePanelSide` (`@/lib/panel-side`) answers "right" for every panel,
 *    so every card, margin marker and omni column lands in the RIGHT gutter.
 *  - `useViewPrefs` routes panel-open requests to the tool gutter
 *    (`@/lib/tool-gutter-store`) instead of the dock.
 *  - `EditorPane`'s rails drop the icon strips for a bare collapse button,
 *    dock no bands, and the left rail renders the `ToolGutter`.
 */
import { readFlag } from "./feature-flags";

export function gutterLayoutOn(): boolean {
  return readFlag("virgil:gutter-layout");
}
