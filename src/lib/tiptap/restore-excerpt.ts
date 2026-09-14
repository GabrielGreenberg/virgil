import type { Editor } from "@tiptap/react";
import { canMountInSchema } from "@/lib/tiptap/schema-mount";
import { anchoredUuidsOf } from "@/lib/tiptap/linked-anchor";

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
 *   1. ASK THE DESTINATION — `canMountInSchema` on the LIVE editor's own
 *      schema, so the question cannot drift from what the insertion will
 *      actually do (the same reason `canMountInCardBody` asks a real schema
 *      rather than a description of one). Since task 563 that primitive asks
 *      about CONTENT as well as vocabulary, so a body the document can name
 *      but not hold is refused here rather than by the throw leg 2 catches.
 *      A string body is legacy plain text and has no JSON shape to check.
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
 *   4. ASK WHAT THE CARET'S PARAGRAPH IS WORTH (task 564) — leg 3 answers
 *      "may the paragraph split?" and an EMPTY paragraph never splits: TipTap's
 *      `insertContentAt` widens a collapsed caret in an empty textblock by one
 *      position on each side and REPLACES the node with a block payload. For a
 *      blank line nobody refers to that is the nicer result (no stray blank
 *      line). For a blank line a card is ANCHORED to it is a third silent
 *      shape leg 2 cannot see: the paragraph's uuid leaves the document, the
 *      anchor guard stands down by task 367's rule (the removed node IS the
 *      remedy), every card anchored there goes to the unanchored bin — and the
 *      document DID change, so "did it land?" says yes. That uuid is durable
 *      (the serializer emits an empty uuid-bearing paragraph as its own
 *      `%!v:<uuid>` line and the parser reads it straight back), so the loss
 *      survives the save. So the landing is resolved as a POSITION rather than
 *      a yes/no: an anchored empty paragraph is left standing and the excerpt
 *      lands just AFTER it. "Anchored" is read off the guard's own set
 *      (`anchoredUuidsOf`), never re-derived from the sidecars, so the door
 *      and the guard cannot disagree about which blank line matters.
 *
 *      A `parTitle` is deliberately NOT a rung here. `EmptyParagraphTitleCleaner`
 *      holds the invariant "no empty titled paragraph survives an edit" and
 *      clears the title AND the uuid on any touched block or its siblings; an
 *      excerpt landing beside the paragraph is exactly such an edit, so a
 *      title rung would buy a stray, now-untitled blank line and nothing else.
 *      A blank line's title is not a shape the app keeps.
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
    if (!canMountInSchema(editor.state.schema, content).ok) return false;
  }
  // AT the caret, never OVER a selection. `insertContent` inserts at the
  // current selection and REPLACES it when it isn't empty — so restoring with
  // prose selected in the document would delete that prose, which is the very
  // thing this path exists to prevent, committed against a different victim.
  // Anchoring at `selection.to` keeps a SELECTION out of the insert: with a
  // collapsed caret it is the caret, with a selection it lands just after it
  // and the selected text survives untouched. It is NOT "purely additive" —
  // an empty paragraph under the caret is replaced (leg 4), which is why the
  // landing is resolved rather than taken as `to`.
  const at = resolveRestoreLanding(editor, editor.state.selection.to);
  if (at === null) return false;

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
    // Leg 1 asks about content too (task 563), so a content-invalid body — a
    // hand- or agent-edited archive.json, or a schema tightened after the
    // capture — is refused above. This catch stays as the net under it:
    // `insertContentAt` calls `node.check()` OUTSIDE its own try/catch, and an
    // exception escaping into a click handler is a refusal the user never
    // sees. Report it as one instead.
    return false;
  }
  return !editor.state.doc.eq(before);
}

/**
 * WHERE does a block insert at this caret land — or `null` for "nowhere,
 * refuse"? Two questions folded into one answer, because the second only
 * exists once the first has been asked.
 *
 * MAY IT? Only where the split it causes is ordinary editing — i.e. the caret
 * sits in a plain top-level `paragraph`. The two things it refuses are
 * different failures with the same symptom:
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
 *
 * WHERE? At the caret, with ONE exception (task 564): an EMPTY paragraph is not
 * split by the insert but REPLACED by it (TipTap widens the range around an
 * empty textblock), and where that paragraph carries an identity a card is
 * anchored to, replacing it is the loss leg 4 describes. So the excerpt lands
 * just AFTER such a paragraph (`$at.after(1)`, a top-level gap — nothing there
 * to split or replace) and the paragraph stays. An empty paragraph nobody
 * anchors keeps the replace: the nicer result, and byte-identical to what
 * shipped before.
 */
function resolveRestoreLanding(editor: Editor, at: number): number | null {
  const doc = editor.state.doc;
  if (at < 0 || at > doc.content.size) return null;
  const $at = doc.resolve(at);
  // A top-level gap (a GapCursor between blocks) encloses nothing and splits
  // nothing — the insert simply lands there.
  if ($at.depth === 0) return at;
  if ($at.depth !== 1 || $at.parent.type.name !== "paragraph") return null;
  const para = $at.parent;
  if (para.childCount > 0) return at;
  const uuid = (para.attrs as { uuid?: string | null }).uuid;
  if (uuid && anchoredUuidsOf(editor).has(uuid)) return $at.after(1);
  return at;
}
