/**
 * THE `%`-comment body boundary (task 990) — where a whole-line comment's
 * BODY starts, owned once.
 *
 * A `latexComment` node's content is THE BYTES AFTER `%`, verbatim: the parser
 * reads `src.slice(pos + 1, eol)` with no trim, the serializer writes `%` +
 * those bytes with no injected space, and the NodeView paints `%` alone as
 * chrome — so `% normal` still LOOKS like `% normal` (the space is the body's
 * own first byte), while `%%%% Banner`, `%TODO` and `%   indented` leave a
 * save exactly as they arrived.
 *
 * Before this module three places each decided the boundary and disagreed:
 * the parser trimmed ALL whitespace after `%`, the serializer re-added exactly
 * one space, and `stripCommentPrefix` stripped `% ?`. The first save of a real
 * paper rewrote every banner, `%TODO` and commented-out indented line, and the
 * typed rule (which converts on `%` alone) stored a doubled space that a
 * reload then trimmed away.
 *
 * Pure string functions, no imports — the parser, the serializer, the
 * footnote-body emitter and the editor creators all read it.
 */

/** The single source-level marker every whole-line comment opens with. */
export const COMMENT_MARKER = "%";

/**
 * The body of a comment LINE that already carries its `%` (pasted / typed
 * text such as `% note` or `%%%% Banner`): the bytes after the first `%`,
 * verbatim. A string without a leading `%` is returned unchanged.
 */
export function commentBodyFromLine(line: string): string {
  return line.startsWith(COMMENT_MARKER) ? line.slice(1) : line;
}

/**
 * The body a comment gets when PROSE is commented out (the registry door,
 * `latexCommentRun`): a line already `%`-prefixed keeps its own bytes (so the
 * conversion is idempotent rather than doubling the marker); otherwise the
 * conventional one-space lead is supplied, so `a note to self` is written
 * `% a note to self`.
 */
export function commentBodyFromProse(text: string): string {
  if (text.startsWith(COMMENT_MARKER)) return commentBodyFromLine(text);
  return ` ${text}`;
}

/**
 * The bytes the serializer writes after `%` for `body`. Verbatim, with ONE
 * exception: a body opening `!v` would be re-read as one of Virgil's own `%!v…`
 * line markers (`%!v:<uuid>` anchors, `%!vtex:` block fences) rather than as a
 * comment — so it is defused with a space (`% !vtex:begin …`), the same answer
 * the pre-990 serializer gave every comment. The `%!v` namespace is reserved;
 * no other body is touched.
 */
export function commentBodyForEmit(body: string): string {
  return body.startsWith("!v") ? ` ${body}` : body;
}
