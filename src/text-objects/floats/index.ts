/**
 * Float-body registry entry point.
 *
 * Importing this module registers every per-kind float body component
 * with the `TEXT_OBJECT_REGISTRY` via `registerFloatBody`. The chrome
 * (`TextObjectFloat`) then looks each up at render time.
 *
 * Imported once from `src/components/Editor.tsx` (the main editor entry
 * point) so the registrations run at app boot, before any popout tries
 * to render.
 *
 * To add a float for a new kind:
 *   1. Implement the body component in this directory.
 *   2. Add one `registerFloatBody(kind, Component)` line below.
 *   3. Make sure `TextObjectGrabHandle.popoutKeyForLift` returns a key
 *      for the kind (so lifts actually open the float).
 */

import { registerFloatBody } from "../text-object-registry";
import { ParagraphBody } from "./paragraph-body";
import { HeadingBody } from "./heading-body";
import { ListBody } from "./list-body";
import { TexBlockBody } from "./tex-block-body";
import { ExampleBlockBody } from "./example-block-body";
import { LinkedRangeBody } from "./linked-range-body";
import { SingleBlockBody } from "./single-block-body";
import { ListItemBody } from "./list-item-body";
import { ExampleItemBody } from "./example-item-body";
import { FigureBody } from "./figure-body";

registerFloatBody("paragraph", ParagraphBody);
registerFloatBody("heading", HeadingBody);
registerFloatBody("bulletList", ListBody);
registerFloatBody("orderedList", ListBody);
registerFloatBody("texBlock", TexBlockBody);
registerFloatBody("exampleBlock", ExampleBlockBody);
registerFloatBody("linkedRange", LinkedRangeBody);
// One generic body serves every single-top-level-block bodyless kind (the
// ListBody precedent — one component, many kinds; kind resolved from the
// cardKey). blockquote/codeBlock are editable prose; displayMath (L3h, Chip 2)
// is the first READ-ONLY / first ATOM kind — same seed/sync scaffold, no
// write-back (the equation is edited on the page via the KaTeX popover);
// latexComment (L3i, Chip 3) is the first EDITABLE ATOM kind (decision A) —
// pops out editable, edits round-trip via the float's own setNodeMarkup.
// titleField (L3j, Chip 4) is the LAST prose-shaped kind — editable +
// content-bearing like blockquote; its node was promoted into the float schema
// (editor-extensions.ts) since it was the only bodyless kind that was main-only.
registerFloatBody("blockquote", SingleBlockBody);
registerFloatBody("codeBlock", SingleBlockBody);
registerFloatBody("displayMath", SingleBlockBody);
registerFloatBody("latexComment", SingleBlockBody);
registerFloatBody("titleField", SingleBlockBody);
// listItem (L3k, Chip 5) is the FIRST SUB-OBJECT — not a SingleBlockBody kind.
// A bare item is group:"textObject" (not block), so its bespoke body seeds the
// item WRAPPED in its real parent list (via buildWrap) and writes back ONLY the
// inner item's range. exampleItem (next chip) gets a mirror body with one more
// wrap level.
registerFloatBody("listItem", ListItemBody);
// exampleItem (L3l, Chip 6) is the LAST SUB-OBJECT — a mirror of ListItemBody
// one wrap level deeper: it seeds the item in the full expex envelope
// (exampleBlock > exampleItemList > exampleItem, via buildWrap) and writes back
// ONLY the inner item's range, unwrapping TWO levels (siblings + the parent
// exampleBlock intact).
registerFloatBody("exampleItem", ExampleItemBody);
// figureBlock + graphicsBlock (L3n, the FINAL kind migration) — ONE shared
// FigureBody serves both (kind resolved from the cardKey, the ListBody
// precedent). The figure NodeView's `figureFloat` mode renders the shared
// FigureVisual with an EDITABLE caption (decision B) but a read-only image /
// no chrome / no click-to-edit, so the virgil-figure-click→MAIN popover can't
// misfire from the float (the L3h.1 class). graphicsBlock (atom, no caption) =
// read-only image (≈ displayMath). With these, ALL 16 graspable kinds lift.
registerFloatBody("figureBlock", FigureBody);
registerFloatBody("graphicsBlock", FigureBody);
