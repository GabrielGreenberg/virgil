/** Payload: `{ uuid }` — identifies a whole-paragraph drag originating
 *  from a popped-out float's body grip (ParagraphFloat / HeadingFloat /
 *  ListFloat). The only consumer is the Stack-icon drop target. */
export const MIME_PAR_CAPTURE = "application/x-virgil-par-capture";
/** Payload: `{ from, to, paragraphId }` — identifies a text-selection
 *  drag from a popped-out SelectionFloat's body grip. The only consumer
 *  is the Stack-icon drop target. */
export const MIME_TEXT_CAPTURE = "application/x-virgil-text-capture";
