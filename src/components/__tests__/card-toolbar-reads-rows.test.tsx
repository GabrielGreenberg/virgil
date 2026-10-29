// @vitest-environment jsdom
//
// Task 1352 — the card-body format toolbar is the ⚡ grid's twin, and it reads
// the SAME registry rows: each button's name + chord are its row's
// `label` / `keybinding`, its grey (with the reason) is the row's own
// `applies()`, its on-state the row's `toggle` + `makes`, and a press crosses
// the registry run door. Before, it hand-spelled all four — and a card body
// mounts `codeBlock` (task 427), where B / I / Sc stayed LIT over a click that
// did nothing while the grid's twin cell greyed and said why.
import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);
vi.mock("katex", () => ({ default: { render: () => undefined } }));

const captured: { editor: import("@tiptap/core").Editor | null } = { editor: null };
vi.mock("@tiptap/react", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...mod,
    useEditor: (...args: Parameters<typeof mod.useEditor>) => {
      const ed = mod.useEditor(...args);
      if (ed) captured.editor = ed;
      return ed;
    },
  };
});

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import RichTextField from "@/components/RichTextField";
import { VIRGIL_ACTION_REGISTRY } from "@/lib/actions/action-registry";
import { commentsStripped } from "@/lib/__tests__/_source-scan";

afterEach(() => {
  cleanup();
  captured.editor = null;
});

const VALUE = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "alpha beta" }] },
    { type: "codeBlock", content: [{ type: "text", text: "x = 1" }] },
  ],
};

function mount() {
  // An EXCERPT body mounts the full vocabulary — `codeBlock` included.
  render(<RichTextField value={VALUE} instanceKey="toolbar-1352" schemaScope="excerpt" onChange={vi.fn()} />);
  const editor = captured.editor;
  if (!editor) throw new Error("RichTextField minted no editor");
  return editor;
}

const btn = (label: string) => screen.getByLabelText(label) as HTMLButtonElement;
const MARK_ROWS = ["bold", "italic", "small-caps"] as const;

describe("task 1352 — the card toolbar reads the registry rows", () => {
  it("each row button is named by its row and advertises the row's chord", () => {
    mount();
    for (const id of MARK_ROWS) {
      const row = VIRGIL_ACTION_REGISTRY[id];
      const el = btn(row.label);
      expect(el.getAttribute("data-hint-keys"), `${id} chord`).toBeTruthy();
    }
    expect(btn(VIRGIL_ACTION_REGISTRY["bullet-list"].label)).toBeTruthy();
    expect(btn("Underline")).toBeTruthy();
  });

  it("in a codeBlock B / I / Sc are DISABLED with the row's reason; in a paragraph they toggle once", () => {
    const editor = mount();
    const codePos = editor.state.doc.child(0).nodeSize + 2;
    act(() => {
      editor.commands.setTextSelection(codePos);
    });
    for (const id of MARK_ROWS) {
      const label = VIRGIL_ACTION_REGISTRY[id].label;
      const el = btn(label);
      expect(el.disabled, `${id} in a code block`).toBe(true);
      expect(el.getAttribute("aria-description"), `${id} must say why`).toBeTruthy();
      expect(el.getAttribute("data-hint")).toContain(`${label} — `);
    }
    // …and a paragraph is the control: lit, and one press = one toggle.
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 }); // "alpha"
    });
    const bold = btn(VIRGIL_ACTION_REGISTRY.bold.label);
    expect(bold.disabled).toBe(false);
    act(() => {
      fireEvent.click(bold, { detail: 0 });
    });
    expect(editor.isActive("bold")).toBe(true);
    expect(bold.getAttribute("aria-pressed")).toBe("true");
  });

  it("census: the toolbar spells no TipTap toggle for a row it can run through the door", () => {
    const SRC = commentsStripped(
      readFileSync(join(resolve(__dirname, "../../.."), "src/components/RichTextField.tsx"), "utf8"),
    );
    for (const cmd of ["toggleBold", "toggleItalic", "toggleSmallCaps", "toggleBulletList", "toggleOrderedList"]) {
      expect(SRC, `${cmd} must go through the row's run`).not.toMatch(new RegExp(`\\b${cmd}\\(`));
    }
  });
});
