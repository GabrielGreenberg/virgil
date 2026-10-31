// @vitest-environment jsdom
//
// Task 1398 — a re-seed is not a user edit, so it never enters the embedded
// editor's undo history.
//
// The float / ExampleCard / card-field editors mirror content that changed
// ELSEWHERE (main doc, a sibling float, a parent's value). Through TipTap's
// `setContent(…, { emitUpdate: false })` that mirror was an undoable step: Cmd-Z
// in the float reverted the FOREIGN edit, `onUpdate` wrote the revert back into
// main (`addToHistory: false`), and the foreign text was lost from both
// histories. The re-seed door (`reseedPreservingCaret` / `reseedEditor`) stamps
// the replace `addToHistory: false` + `preventUpdate`.

import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import type { JSONContent } from "@tiptap/core";
import { reseedEditor, reseedPreservingCaret } from "@/lib/reseed-caret";

const editors: Editor[] = [];
afterEach(() => {
  while (editors.length) editors.pop()!.destroy();
});

function para(text: string): JSONContent {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: text ? [{ type: "text", text }] : [] },
    ],
  };
}

function makeEditor(text: string): { editor: Editor; updates: () => number } {
  let n = 0;
  const editor = new Editor({
    extensions: [StarterKit],
    content: para(text),
    onUpdate: () => {
      n += 1;
    },
  });
  editors.push(editor);
  return { editor, updates: () => n };
}

/** Type `text` at the end of the doc as a real user transaction. */
function typeAtEnd(editor: Editor, text: string) {
  const end = editor.state.doc.content.size - 1;
  editor.view.dispatch(editor.state.tr.insertText(text, end));
}

const DOORS = [
  ["reseedPreservingCaret (float-sync + ExampleCard)", reseedPreservingCaret],
  ["reseedEditor (card field + borrowed body)", reseedEditor],
] as const;

describe.each(DOORS)("re-seed door %s — outside undo history", (_n, reseed) => {
  it("an undo after a re-seed keeps the foreign change", () => {
    const { editor } = makeEditor("Alpha");
    // The user's own step in the float.
    typeAtEnd(editor, " one");
    expect(editor.getText()).toBe("Alpha one");
    // A foreign edit (main gained "foo" at the start) re-seeds the float.
    reseed(editor, para("foo Alpha one"));
    expect(editor.getText()).toBe("foo Alpha one");
    // Cmd-Z undoes the USER's step only — rebased through the foreign change.
    editor.commands.undo();
    expect(editor.getText()).toBe("foo Alpha");
  });

  it("a re-seed alone leaves nothing to undo", () => {
    const { editor } = makeEditor("Alpha");
    reseed(editor, para("Alpha foreign"));
    expect(editor.can().undo()).toBe(false);
    editor.commands.undo();
    expect(editor.getText()).toBe("Alpha foreign");
  });

  it("a re-seed inside the user's typing group does not join it", () => {
    const { editor } = makeEditor("Alpha");
    typeAtEnd(editor, "!");
    // Within the 500 ms newGroupDelay — the old setContent would GROUP here.
    reseed(editor, para("X Alpha!"));
    typeAtEnd(editor, "?");
    editor.commands.undo();
    expect(editor.getText().startsWith("X ")).toBe(true);
  });

  it("emits no onUpdate (no write-back echo)", () => {
    const { editor, updates } = makeEditor("Alpha");
    const before = updates();
    reseed(editor, para("Alpha beta"));
    expect(updates()).toBe(before);
  });
});

describe("reseedPreservingCaret — caret mapped in the same transaction", () => {
  it("shifts a caret past an upstream foreign insertion", () => {
    const { editor } = makeEditor("Alpha body.");
    editor.commands.setTextSelection(4); // after "Alp"
    reseedPreservingCaret(editor, para("XXAlpha body."));
    expect(editor.state.selection.from).toBe(6);
    expect(editor.state.selection.empty).toBe(true);
  });
});

// ── CENSUS: every whole-doc `setContent` in src is a declared non-re-seed ──
// A new embedded editor that mirrors foreign content through
// `commands.setContent` would silently re-open task 1398. The only sanctioned
// caller is the code pane's re-parse into MAIN — the user's own edit, which
// must stay undoable and must emit (it drives the autosave).
describe("CENSUS: re-seeds go through the re-seed door, never setContent", () => {
  const ALLOWED: Record<string, string> = {
    "src/lib/code-pane-bridge.ts":
      "code-view re-parse into MAIN — a user edit: undoable + emits for autosave",
  };

  it("no commands.setContent( outside the allowlist", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const root = path.resolve(__dirname, "../../..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          if (ent.name === "__tests__" || ent.name === "node_modules") continue;
          walk(p);
        } else if (/\.(ts|tsx)$/.test(ent.name)) {
          const src = fs.readFileSync(p, "utf8");
          if (/\bcommands\s*\.\s*setContent\s*\(/.test(src)) {
            hits.push(path.relative(root, p).split(path.sep).join("/"));
          }
        }
      }
    };
    walk(path.join(root, "src"));
    const stray = hits.filter((h) => !(h in ALLOWED));
    expect(
      stray,
      `route these through reseedEditor / reseedPreservingCaret ` +
        `(src/lib/reseed-caret.ts) — a setContent re-seed lands in undo history`,
    ).toEqual([]);
    // The allowlist stays honest: every entry is still a real caller.
    for (const k of Object.keys(ALLOWED)) expect(hits).toContain(k);
  });
});
