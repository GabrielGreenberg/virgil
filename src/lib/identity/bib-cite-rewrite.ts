/**
 * The editor `\cite{}` citekey-rewrite — the deep half of the rename cascade.
 *
 * Why this exists (T1 §3.2(c), checklist step 9): when the user renames a
 * citekey in the Bibliography panel, patching the citation SIDECAR alone is not
 * enough — the editor doc still holds `\cite{oldKey}` atoms, and the next
 * `syncFromEditor` re-derives the sidecar from those atoms and REVERTS the
 * rename (the bug the audit calls out under BIB-F5-03). The rename must rewrite
 * the live ProseMirror doc, not just the sidecar.
 *
 * The rewrite is whole-token-safe and footnote-deep:
 *  - **Boundary matcher** (W0a `wholeWordPattern`): rename `foo` must not also
 *    rewrite `foobar`, and a punctuation citekey (`+foo`, `foo:bar`) must match
 *    as a whole token — a bare `\b` mis-fires on a non-word edge. This consumes
 *    the C26 builder.
 *  - **Footnote descent** (W0d `inline-content`): a citekey cited ONLY inside a
 *    footnote body lives in the footnote's `attrs.content` JSONContent literal,
 *    which `doc.descendants()` does NOT enter (footnote is `inline+atom`). We
 *    descend into it via the same atom-aware reader, exactly mirroring
 *    `stripFootnoteNestedCitation`.
 *
 * Position-stability: every edit is an attr-only `setNodeMarkup` on the host
 * node (a top-level citation, or a footnote whose body literal we rewrite) — it
 * never shifts positions, so we can walk the ORIGINAL doc while accumulating
 * into one transaction (the `writeFootnoteNumbers`/`stripFootnoteNestedCitation`
 * pattern). One dispatch, atomic.
 *
 * No `ignoreReadOnly` meta — like `stripFootnoteNestedCitation`, this real doc
 * tx is filtered by the readOnlyEnforcer in collaborator read-only mode, so a
 * partner-claimed doc is left untouched (correct).
 *
 * Keystroke sanctity: runs only on an explicit rename (a panel action), never
 * per keystroke. The single `doc.descendants` walk is the cost of a rename, not
 * of typing.
 */

import type { Editor } from "@tiptap/react";
import { rewriteInlineAtomsDeep } from "@/lib/inline-content";
import { wholeWordPatternFor } from "@/lib/whole-word";

/**
 * Rewrite every whole-token occurrence of `oldKey` → `newKey` inside a single
 * `\cite{...}` command string. Pure; returns the same reference when nothing
 * matched so callers can skip a no-op.
 *
 * The token is matched as a whole citekey via the boundary-class matcher, so
 * `\cite{foo,foobar}` renames only `foo`, and `\cite{+foo}` / `\cite{a:b}`
 * (punctuation citekeys) match. The match runs against the whole command (which
 * may carry optional args like `\citep[see][p.2]{foo}` and multiple keys
 * `\cite{foo,bar}`) — the boundary guards keep it from touching a key fragment
 * or an unrelated word in the optional text.
 */
export function rewriteCiteCommandString(
  command: string,
  oldKey: string,
  newKey: string,
): string {
  if (!command || !oldKey || oldKey === newKey) return command;
  const re = new RegExp(wholeWordPatternFor(oldKey), "g");
  return command.replace(re, newKey);
}

/**
 * Rewrite every `\cite{oldKey}` → `\cite{newKey}` in the live editor doc —
 * top-level citation atoms AND footnote-nested ones — in ONE atomic
 * transaction. Returns the number of cite ATOMS rewritten (0 → no dispatch).
 *
 * A top-level citation is rewritten by editing its own `command` attr; a
 * footnote-nested citation is rewritten by rewriting the host footnote's
 * `attrs.content` literal (the only place the nested cite lives).
 */
export function rewriteCiteKeyInDoc(
  editor: Editor,
  oldKey: string,
  newKey: string,
): number {
  if (!oldKey || oldKey === newKey) return 0;
  const tr = editor.state.tr;
  // The deep door (task 606) — the same walk the label rename uses, so the two
  // key renames reach exactly the same hiding places.
  const touched = rewriteInlineAtomsDeep({ doc: tr.doc, tr }, "citation", (attrs) => {
    const cmd = (attrs.command as string) || "";
    const rewritten = rewriteCiteCommandString(cmd, oldKey, newKey);
    return rewritten !== cmd ? { ...attrs, command: rewritten } : null;
  });
  if (touched > 0) editor.view.dispatch(tr);
  return touched;
}
