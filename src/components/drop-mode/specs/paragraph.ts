/**
 * Drop spec for popped-out paragraphs (`paragraph:${uuid}`).
 *
 * Paragraph is a single anchorable block; the move semantics are
 * generic and shared with example blocks via `blockMoveSpec`.
 */

import { blockMoveSpec } from "../util/block-move";

export const paragraphDropSpec = blockMoveSpec({ nodeName: "paragraph" });
