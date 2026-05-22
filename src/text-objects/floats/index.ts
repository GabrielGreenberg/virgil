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

registerFloatBody("paragraph", ParagraphBody);
registerFloatBody("heading", HeadingBody);
registerFloatBody("bulletList", ListBody);
registerFloatBody("orderedList", ListBody);
registerFloatBody("texBlock", TexBlockBody);
registerFloatBody("exampleBlock", ExampleBlockBody);
