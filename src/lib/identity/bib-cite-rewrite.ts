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
 * The rewrite is key-list-only and footnote-deep:
 *  - **Key lists, not the command** (task 910): only the mandatory `{…}` key
 *    groups are rewritten, token by exact token — rename `foo` does not touch
 *    `foobar`, a punctuation citekey (`+foo`, `foo:bar`) matches as itself, and
 *    the command word and `[pre][post]` notes are never edited. The citations
 *    SIDECAR (`useCitations.rewriteCitationRefs`) calls the same function, so
 *    the doc and the sidecar cannot drift.
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

/**
 * Rewrite every occurrence of the citekey `oldKey` → `newKey` inside a single
 * `\cite…` command string. Pure; returns the same reference when nothing
 * matched so callers can skip a no-op.
 *
 * Only the KEY LISTS are touched — every mandatory `{…}` group after the
 * command word (one for `\citep[pre][post]{a,b}`, one per key for biblatex's
 * plural `\cites[p. 1]{a}[p. 2]{b}`). The command word and every `[…]`
 * optional argument are copied byte-for-byte, so a pre-note that names the
 * author (`\citep[cf. Kant's view]{Kant}`) survives a `Kant` rename, and a key
 * spelled like the command (`\citet{citet}`) cannot rename the command (task
 * 910 — the old whole-string regex did both).
 *
 * Inside a key list the match is EXACT per comma-separated token (whitespace
 * around a token is preserved), so `\cite{foo,foobar}` renames only `foo`, and
 * a punctuation citekey (`+foo`, `a:b`) matches as itself. This is the splice
 * form of the write-path law: what is not a key is not rewritten.
 *
 * A string that does not open with a `\command` is returned unchanged — there
 * is no key list to find.
 */
export function rewriteCiteCommandString(
  command: string,
  oldKey: string,
  newKey: string,
): string {
  if (!command || !oldKey || oldKey === newKey) return command;
  const head = command.match(/^\\[A-Za-z]+\*?/);
  if (!head) return command;
  let out = head[0];
  let i = head[0].length;
  let changed = false;
  while (i < command.length) {
    const ch = command[i];
    if (ch === "[" || ch === "{") {
      const close = matchingClose(command, i);
      if (close < 0) break; // unbalanced tail — copy it verbatim below
      if (ch === "[") {
        out += command.slice(i, close + 1);
      } else {
        const body = command.slice(i + 1, close);
        const rewritten = rewriteKeyList(body, oldKey, newKey);
        if (rewritten !== body) changed = true;
        out += "{" + rewritten + "}";
      }
      i = close + 1;
    } else {
      out += ch;
      i++;
    }
  }
  out += command.slice(i);
  return changed ? out : command;
}

/** Index of the `]`/`}` closing the group that opens at `open`, honoring
 *  nested braces (an optional argument may hold `{…}`); -1 when unbalanced. */
function matchingClose(s: string, open: number): number {
  const closer = s[open] === "[" ? "]" : "}";
  let depth = 0;
  for (let j = open + 1; j < s.length; j++) {
    const c = s[j];
    if (c === "\\") { j++; continue; }
    if (c === "{") depth++;
    else if (c === "}" && depth > 0) depth--;
    else if (c === closer && depth === 0) return j;
  }
  return -1;
}

/** Replace exact-equal tokens of a comma-separated key list, keeping every
 *  other byte (separators, surrounding whitespace) untouched. */
function rewriteKeyList(body: string, oldKey: string, newKey: string): string {
  const parts = body.split(",");
  let changed = false;
  const next = parts.map((part) => {
    if (part.trim() !== oldKey) return part;
    changed = true;
    const lead = part.length - part.trimStart().length;
    return part.slice(0, lead) + newKey + part.slice(lead + oldKey.length);
  });
  return changed ? next.join(",") : body;
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
