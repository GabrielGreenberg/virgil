/**
 * Drop spec for popped-out example blocks (`example:${uuid}`).
 *
 * Examples are single block-level nodes (expex `\ex` / `\pex`).
 * Same move shape as paragraph — `blockMoveSpec` handles it.
 */

import { blockMoveSpec } from "@/components/drop-mode/util/block-move";

export const exampleDropSpec = blockMoveSpec({ nodeName: "exampleBlock" });
