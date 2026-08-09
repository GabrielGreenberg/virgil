import type { Editor } from "@tiptap/react";

/**
 * Put a captured document EXCERPT back into the document at the caret, and
 * report whether it actually landed.
 *
 * This is the RETURN leg of the capture law (`canMountInCardBody`, task 308).
 * There, a card body had to prove it could hold a document slice before the
 * document was allowed to give it up; here the DOCUMENT has to prove it can
 * hold the excerpt before the card is allowed to give it up — because an
 * archive card body is the ONLY copy of prose the user deleted from the
 * document. Same silent failure mode read from the other end.
 *
 * Silent is the operative word, and it's why this returns a boolean rather
 * than trusting the call: TipTap's `insertContent` does not throw on content
 * its schema can't build. With `enableContentCheck` off it emits a content
 * error and inserts nothing (or a subset), so a caller that drops the archive
 * entry on the strength of "the call returned" destroys the text.
 *
 * Three legs, in order:
 *
 *   1. ASK THE DESTINATION — `schema.nodeFromJSON` on the LIVE editor's own
 *      schema, so the question cannot drift from what the insertion will
 *      actually do (the same reason `canMountInCardBody` asks a real schema
 *      rather than a description of one). A string body is legacy plain text
 *      and has no JSON shape to check.
 *   2. ASK THE FITTER — a schema-valid payload can still fail to land: a
 *      read-only host swallows the transaction, and a caret can sit where the
 *      content does not fit. So compare the document before and after rather
 *      than predicting the outcome (`bareInsertTearsContainer`'s discipline in
 *      the drop-mode container fit).
 *
 *   3. ASK WHERE THE CARET IS — a caret insert splits the block it sits in, and
 *      splitting is ordinary editing for a top-level `paragraph` and silent
 *      corruption for everything else. A caret inside a `glossCell` tears the
 *      `alignedGlossRow` in two and destroys the interlinear alignment; inside
 *      an `exampleItem` it splits the example into two numbered examples;
 *      inside a `heading` it mints a phantom section; inside a `latexComment`
 *      it halves the comment. Every one of those still changes the document, so
 *      leg 2 reports SUCCESS and the caller then drops the only copy — the
 *      task-257/320 corruption class, arriving through a door that CI does not
 *      watch (`container-fit-guardrail` censuses `src/components/drop-mode/`).
 *
 * Leg 3 is deliberately CONSERVATIVE rather than clever: the caret must sit in a
 * plain `paragraph` at the top level, where there is no enclosing container to
 * tear and the only structure affected is the paragraph the user is standing in.
 * Anywhere else refuses and the host tells the user to move the caret. The
 * general answer is `bareInsertTearsContainer`'s empirical probe (build the
 * trial transaction, refuse if any ANCESTOR type's count moved) parameterised by
 * the depth that may legitimately split — worth folding these two onto one
 * primitive if a second caret-shaped splice ever appears. Until then a rule that
 * can be verified by construction beats a probe that has to be trusted.
 *
 * On block IDENTITY: the excerpt still carries the `uuid`s the capture sliced
 * out of the document, so a restore RE-ESTABLISHES them — every card anchored
 * to the archived paragraph finds its anchor again. Where the id is still taken
 * (the user archived a copy, or restored twice) `BlockUuidBackfill` re-mints the
 * newcomer, keeping the pre-existing block's identity, which is the right
 * tie-break here: this is a paste-as-new, not a relocation, so the net's
 * document-order rule and the intent agree (contrast task 320, where they did
 * not and the mechanism had to state identity itself).
 */
export function restoreExcerptAtCaret(editor: Editor | null, content: unknown): boolean {
  if (!editor) return false;
  if (content == null) return false;
  if (typeof content !== "string") {
    try {
      editor.state.schema.nodeFromJSON(content as never);
    } catch {
      return false;
    }
  }
  // AT the caret, never OVER a selection. `insertContent` inserts at the
  // current selection and REPLACES it when it isn't empty — so restoring with
  // prose selected in the document would delete that prose, which is the very
  // thing this path exists to prevent, committed against a different victim.
  // Anchoring at `selection.to` makes the restore purely additive: with a
  // collapsed caret it is the caret, with a selection it lands just after it
  // and the selected text survives untouched.
  const at = editor.state.selection.to;
  if (!caretMaySplit(editor, at)) return false;

  const before = editor.state.doc;
  try {
    if (typeof content === "string") {
      // Legacy plain-text snippet. A leading "% " marks a LaTeX comment, which
      // round-trips through the `latexComment` node rather than as prose.
      if (content.startsWith("% ")) {
        const body = content.slice(2);
        editor.chain().focus().insertContentAt(at, {
          type: "latexComment",
          content: body ? [{ type: "text", text: body }] : [],
        }).run();
      } else {
        editor.chain().focus().insertContentAt(at, content).run();
      }
    } else {
      const doc = content as { type?: string; content?: unknown[] };
      const nodes = doc?.content ?? [];
      editor.chain().focus().insertContentAt(at, nodes).run();
    }
  } catch {
    // Leg 1 accepts more than the insert does: `schema.nodeFromJSON` builds
    // nodes through `NodeType.create`, which does NOT check content
    // expressions, while `insertContentAt` calls `node.check()` OUTSIDE its own
    // try/catch. A content-invalid body (a hand- or agent-edited archive.json,
    // or a schema tightened after the capture) therefore THROWS here rather
    // than failing quietly — and an exception escaping into a click handler is
    // a refusal the user never sees. Report it as one instead.
    return false;
  }
  return !editor.state.doc.eq(before);
}

/**
 * May a block insert at this caret proceed? Only where the split it causes is
 * ordinary editing — i.e. the caret sits in a plain top-level `paragraph`.
 *
 * The two things it refuses are different failures with the same symptom:
 *
 *   • a caret inside ANY container (`exampleItem`, `listItem`, `blockquote`,
 *     `alignedGlossRow`) — the fitter can only make room by CLOSING the
 *     container, splitting one node into two that both keep the source `uuid`
 *     with the payload stranded between the halves (task 257/320);
 *   • a caret in a textblock whose EXISTENCE carries meaning its text does not
 *     — `heading` (a section, its outline entry and its fold), `glossCell` (a
 *     column of an interlinear alignment), `proseGlossRow`, `titleField`. Task
 *     320 settled that no schema-derived predicate separates those from prose,
 *     and answered the narrow question it could answer honestly. So does this:
 *     is the block the plain `paragraph`?
 *
 * Both are silent — the document changes either way, so a "did it land?" test
 * cannot tell success from corruption. This is the check that can.
 */
function caretMaySplit(editor: Editor, at: number): boolean {
  const doc = editor.state.doc;
  if (at < 0 || at > doc.content.size) return false;
  const $at = doc.resolve(at);
  // A top-level gap (a GapCursor between blocks) encloses nothing and splits
  // nothing — the insert simply lands there.
  if ($at.depth === 0) return true;
  return $at.depth === 1 && $at.parent.type.name === "paragraph";
}
