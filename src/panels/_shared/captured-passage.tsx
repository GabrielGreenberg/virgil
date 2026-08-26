"use client";

/**
 * **captured-passage — the ONE door for a captured document passage shown to a
 * READER.**
 *
 * A revision / cutter card quotes a span of the user's paper: a comment card's
 * "Original" excerpt (`selectedText`), a suggestion card's read-only
 * `original_text`, and the Original-text foldout on an applied / pending-AI
 * record. Four surfaces, one question — *what did this card capture?* — and
 * before task 488 they answered it THREE different ways:
 *
 *  - `useExcerptCue` and the read-only `original_text` field rendered the raw
 *    STRING in a `whitespace-pre-wrap` block, so a skill-authored original
 *    (real `.tex` bytes) showed `\emph{...}` / `$x$` / `\cite{k}` as source and
 *    a human-captured one showed a flattened line with its emphasis gone;
 *  - the two pending-change bodies each HAND-SPELLED
 *    `richLatexToJson(...)` → `BorrowedMainText`, a live read-only editor per
 *    expanded card;
 *  - the compressed cues showed `text.replace(/\s+/g, " ")` over the same bytes.
 *
 * Gabriel's report ("the original is rendered as plain text without
 * formatting — should be more like an archive card") is the first of those,
 * and the archive card he names as the model is exactly what this door does:
 * render the passage through the borrowed main-text vocabulary.
 *
 * ## The resolution ladder
 *
 * A captured passage reaches a card by one of two routes, so the door asks for
 * both and prefers the faithful one:
 *
 *  1. **`content` — the RICH capture.** Since task 488 a Mode-B anchor also
 *     captures the real document slice ({@link prepareCardBodyCapture}, the
 *     archive path), so a passage captured IN THE EDITOR keeps its marks and
 *     its inline atoms. This rung is what makes italics / math / citations
 *     actually survive: the plain-string capture (`doc.textBetween`) drops
 *     marks and drops every inline ATOM outright, so no render-time parse can
 *     recover them.
 *  2. **`latex` — the BYTES.** A skill-authored `original_text` is real `.tex`
 *     read out of the paper, and every card written before 488 has only the
 *     string. `richLatexToJson` is the card-body inline parser, so BLOCK
 *     constructs in such a passage flatten — acceptable for an excerpt, and
 *     stated here rather than discovered.
 *  3. **Refusal → plain text.** `StaticBorrowedText` already owns that contract
 *     (a body its schema cannot represent renders as
 *     `richJsonToPlainText`, never a blank).
 *
 * ## Why STATIC, not `BorrowedMainText`
 *
 * Nothing here is editable, so an editor buys nothing and costs a mount — the
 * card-presence-tier doctrine ("a collapsed card body mounts machinery
 * proportional to its usefulness"). `StaticBorrowedText` is the T1 surface and
 * is documented as visually identical to its live twin. Converting the two
 * pending-change foldouts onto this door therefore RETIRES two live editors as
 * well as unifying the answer.
 *
 * ## Display-only
 *
 * Nothing this module produces is ever written back. `original_text` /
 * `selectedText` remain the byte currency the apply path splices and the copy
 * button copies; `content` is a capture-time snapshot the door only reads.
 *
 * Scope is `"excerpt"` — a captured passage is a document SLICE, which is what
 * that scope exists for (capture/schema symmetry), and it is a superset of the
 * `"card"` vocabulary the `latex` rung produces.
 */

import { useMemo, type ReactNode } from "react";
import type { JSONContent } from "@tiptap/react";
import { StaticBorrowedText } from "@/components/StaticBorrowedText";
import { richLatexToJson, richJsonToPlainText } from "@/lib/footnote-content";

/** The two routes a captured passage arrives by. Both optional: a card may
 *  carry only the bytes (every pre-488 record, and every skill-authored
 *  original), only the rich capture, or neither. */
export interface CapturedPassageSource {
  /** The byte currency — `selectedText` / `original_text`. */
  latex: string;
  /** The rich capture taken at anchor time (task 488). Preferred when present. */
  content?: unknown;
}

/** Rung 1 → rung 2 of the ladder, as JSON the borrowed surface can mount.
 *  Exported for the one-line projection and for the contract suite; the
 *  RENDER is the component below. */
export function capturedPassageJson({
  latex,
  content,
}: CapturedPassageSource): JSONContent {
  if (content && typeof content === "object") return content as JSONContent;
  return richLatexToJson(latex);
}

/**
 * The one-line plain projection a COLLAPSED card shows in place of its body
 * summary. Same ladder, same door — so the collapsed cue and the expanded
 * excerpt can never disagree about what the passage says. Runs the rich form
 * through `richJsonToPlainText`, which is what turns `\emph{x}` into `x` and
 * gives a citation its resolved display text.
 */
export function capturedPassageOneLine(src: CapturedPassageSource): string {
  if (!src.latex && !src.content) return "";
  const text = richJsonToPlainText(capturedPassageJson(src));
  return (text || src.latex).replace(/\s+/g, " ").trim();
}

export interface CapturedPassageProps extends CapturedPassageSource {
  /** Chrome for the host block (the red "Original" dialect, a border, …).
   *  The door adds `captured-passage`, which is what neutralises the editor
   *  body metrics `.rtf-content` reserves for a caret and lets the host's own
   *  ink through (globals.css). */
  className?: string;
  /** Panel typography. `color` is deliberately DROPPED: a captured passage
   *  inherits the ink of the block that hosts it, which is what preserves the
   *  red "Original" cue the field vocabulary assigns. */
  bodyStyle?: React.CSSProperties;
  variant?: "footnote" | "note";
}

/**
 * Render a captured passage as read-only borrowed main text. A captured
 * passage IS main text, so it takes the main-text (serif) variant on every
 * surface — the same treatment the archive card body gets.
 */
export function CapturedPassage({
  latex,
  content,
  className,
  bodyStyle,
  variant = "footnote",
}: CapturedPassageProps): ReactNode {
  // The parse rung mints a fresh object per call, and `StaticBorrowedText`
  // memoizes its HTML on `value` IDENTITY — so without this the passage is
  // re-parsed AND re-serialized on every render of the host card. O(passage),
  // never O(doc), and off the keystroke path either way; memoized because a
  // card re-renders for plenty of reasons that have nothing to do with it.
  const value = useMemo(
    () => capturedPassageJson({ latex, content }),
    [latex, content],
  );
  const inkFree = useMemo(
    () =>
      bodyStyle
        ? { fontFamily: bodyStyle.fontFamily, fontSize: bodyStyle.fontSize }
        : undefined,
    [bodyStyle],
  );
  return (
    <div className={`captured-passage${className ? ` ${className}` : ""}`}>
      <StaticBorrowedText
        value={value}
        variant={variant}
        bodyStyle={inkFree}
        schemaScope="excerpt"
      />
    </div>
  );
}

export default CapturedPassage;
