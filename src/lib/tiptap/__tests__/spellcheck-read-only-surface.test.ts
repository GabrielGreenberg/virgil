// @vitest-environment jsdom
//
// Task 2026-09-15-579 — the spellchecker on READ-ONLY main text.
//
// MAIN pins `view.editable = true` for its whole life and carries the
// user-facing answer in `editableRef` (Editor.tsx; task 524 recorded the fork
// for the atom grab). The spellchecker gated on `view.editable` alone, so on
// MAIN its read-only gate was always open: the Library Reader squiggled every
// paper, and the suggestion menu offered corrections the `readOnlyEnforcer`
// then silently dropped.
//
// No pre-579 suite could see any of this: every decorator and menu fixture
// mounts with `editableRef: { current: true }`, where the two spellings of the
// question agree by construction. Every leg here drives a REAL main stack with
// a ref this suite controls, and each read-only leg carries its EDITABLE
// control through the identical harness.
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import fs from "node:fs";
import path from "node:path";
import type { RefObject } from "react";
import { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { parseLatex } from "@/lib/latex-parser";
import {
  SPELL_DEBOUNCE_MS,
  SPELL_ERROR_CLASS,
  spellcheckPluginKey,
} from "@/lib/tiptap/spellcheck-decorator";
import {
  announceSurfaceEditability,
  surfaceIsEditable,
} from "@/lib/tiptap/surface-editable";
import { ATOMS_GRASPABLE_ATTR } from "@/lib/tiptap/inline-atom-grab";
import { closeSpellMenu, spellMenuRequest } from "@/lib/spell/spell-menu-store";
import type { SpellcheckPort, SpellcheckPortRef } from "@/lib/spell/spell-port";
import {
  commentsStripped,
  trackedFiles,
  REPO_ROOT,
} from "@/lib/__tests__/_source-scan";

const KNOWN = new Set(["The", "the", "quick", "brown", "fox"]);

function makePort(): SpellcheckPortRef {
  const verdicts = new Map<string, boolean>();
  const port: SpellcheckPort = {
    enabled: () => true,
    autocorrect: () => false,
    version: () => 0,
    onInvalidate: () => () => {},
    isAccepted: () => false,
    knownSync: (w) => verdicts.get(w),
    ensure: async (words) => {
      for (const w of words) verdicts.set(w, KNOWN.has(w));
    },
    suggest: async () => ["the"],
    acceptInPaper: () => {},
    acceptGlobally: () => {},
  };
  return { current: port };
}

let editor: Editor | null = null;
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  closeSpellMenu();
  editor?.destroy();
  editor = null;
  vi.useRealTimers();
});

function mount(editableRef: RefObject<boolean>): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const ctx = {
    surface: "main",
    editableRef,
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
    spellcheckPortRef: makePort(),
  } as unknown as EditorExtensionsCtx;
  // MAIN's shape: PM's own editability is ALWAYS true (Editor.tsx).
  editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(ctx),
    content: parseLatex(
      "\\documentclass{article}\n\\begin{document}\nThe quick teh fox.\n\\end{document}\n",
    ) as never,
  });
  return editor;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await vi.advanceTimersByTimeAsync(SPELL_DEBOUNCE_MS + 10);
  }
}

const flagged = (ed: Editor) =>
  spellcheckPluginKey.getState(ed.state)!.decos.find().length;
const squiggle = () => document.querySelector(`.${SPELL_ERROR_CLASS}`);

function rightClick(el: Element): boolean {
  const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev.defaultPrevented;
}

describe("the door", () => {
  it("MAIN's pinned `view.editable` is answered by the ref; a float's by the view", () => {
    const view = { editable: true } as never;
    expect(surfaceIsEditable(view, { current: false })).toBe(false);
    expect(surfaceIsEditable(view, { current: true })).toBe(true);
    expect(surfaceIsEditable(view, null)).toBe(true);
    expect(surfaceIsEditable({ editable: false } as never, null)).toBe(false);
    expect(surfaceIsEditable({ editable: false } as never, { current: true })).toBe(false);
  });
});

describe("read-only main text is never squiggled", () => {
  it("mounted read-only: no squiggle, and the browser's underline is not claimed", async () => {
    const ed = mount({ current: false });
    await settle();
    expect(ed.view.editable).toBe(true); // the shape that made the view lie
    expect(flagged(ed)).toBe(0);
    expect(ed.view.dom.hasAttribute("spellcheck")).toBe(false);
  });

  it("…the EDITABLE control through the identical harness does squiggle", async () => {
    const ed = mount({ current: true });
    await settle();
    expect(flagged(ed)).toBe(1);
    expect(ed.view.dom.getAttribute("spellcheck")).toBe("false");
  });

  it("a ref flip, announced, turns the checker on and back off", async () => {
    const ref: RefObject<boolean> = { current: false };
    const ed = mount(ref);
    await settle();
    expect(flagged(ed)).toBe(0);

    ref.current = true;
    announceSurfaceEditability(ed.view);
    await settle();
    expect(flagged(ed)).toBe(1);
    expect(ed.view.dom.getAttribute("spellcheck")).toBe("false");

    ref.current = false;
    announceSurfaceEditability(ed.view);
    await settle();
    expect(flagged(ed)).toBe(0);
    expect(ed.view.dom.hasAttribute("spellcheck")).toBe(false);
  });

  it("the announcement re-stamps the atom grab too — one witness for both affordances", async () => {
    const ref: RefObject<boolean> = { current: true };
    const ed = mount(ref);
    expect(ed.view.dom.getAttribute(ATOMS_GRASPABLE_ATTR)).toBe("true");
    ref.current = false;
    announceSurfaceEditability(ed.view);
    expect(ed.view.dom.getAttribute(ATOMS_GRASPABLE_ATTR)).toBe("false");
  });

  it("the announcement is meta-only: no document change, no history entry", () => {
    const ed = mount({ current: true });
    const seen: Transaction[] = [];
    ed.on("transaction", ({ transaction }) => seen.push(transaction));
    announceSurfaceEditability(ed.view);
    expect(seen).toHaveLength(1);
    expect(seen[0].docChanged).toBe(false);
    expect(seen[0].getMeta("addToHistory")).toBe(false);
  });
});

describe("read-only main text never offers a spelling edit", () => {
  it("between the flip and the clearing pass, right-click falls through to the browser", async () => {
    const ref: RefObject<boolean> = { current: true };
    mount(ref);
    await settle();
    const span = squiggle();
    expect(span?.textContent).toBe("teh");

    // The window: the squiggle is still painted, the surface is read-only.
    ref.current = false;
    expect(rightClick(span!)).toBe(false);
    expect(spellMenuRequest()).toBeNull();
  });

  it("…the editable control opens the menu over the same span", async () => {
    mount({ current: true });
    await settle();
    expect(rightClick(squiggle()!)).toBe(true);
    expect(spellMenuRequest()?.word).toBe("teh");
  });

  it("a menu left open when the surface goes read-only is closed by the pass", async () => {
    const ref: RefObject<boolean> = { current: true };
    const ed = mount(ref);
    await settle();
    rightClick(squiggle()!);
    expect(spellMenuRequest()).not.toBeNull();
    ref.current = false;
    announceSurfaceEditability(ed.view);
    await settle();
    expect(spellMenuRequest()).toBeNull();
  });
});

describe("census — one door for the editability question", () => {
  const PRODUCTION = trackedFiles("src", /\.(ts|tsx)$/).filter(
    (p) => !p.includes("__tests__"),
  );
  const rel = (abs: string) => path.relative(REPO_ROOT, abs);
  const code = (abs: string) => commentsStripped(fs.readFileSync(abs, "utf8"));

  it("no file re-derives the view ∧ ref conjunction outside the door", () => {
    // The shape task 524 wrote privately and task 579 found missing: a
    // `view.editable` read conjoined with an `editableRef` read.
    const CONJ = /\.editable\s*&&[^;\n]*editableRef|editableRef[^;\n]*&&\s*\w*\.?view\.editable/;
    const hits = PRODUCTION.filter((f) => CONJ.test(code(f))).map(rel);
    expect(hits).toEqual(["src/lib/tiptap/surface-editable.ts"]);
  });

  it("the canary: the needle can see the pre-579 private copy", () => {
    const fixture =
      "const ok = (view, editableRef) => view.editable && (editableRef ? editableRef.current : true);";
    expect(
      /\.editable\s*&&[^;\n]*editableRef/.test(commentsStripped(fixture)),
    ).toBe(true);
  });

  it("both affordance plugins read the door, and the decorator is handed the ref", () => {
    for (const f of [
      "src/lib/tiptap/spellcheck-decorator.ts",
      "src/lib/tiptap/inline-atom-grab.ts",
    ]) {
      expect(code(path.join(REPO_ROOT, f))).toContain("surfaceIsEditable(");
    }
    const deco = code(path.join(REPO_ROOT, "src/lib/tiptap/spellcheck-decorator.ts"));
    // The retired gate: `view.editable` alone in the port predicate.
    expect(deco).not.toMatch(/port\.enabled\(\)\s*&&\s*view\.editable/);
    const ext = code(path.join(REPO_ROOT, "src/lib/editor-extensions.ts"));
    expect(ext).toMatch(/SpellcheckDecorator\.configure\(\{[^}]*editableRef/);
  });

  it("the announcement has exactly ONE production caller: Editor.tsx's editable effect", () => {
    const callers = PRODUCTION.filter((f) =>
      /\bannounceSurfaceEditability\s*\(/.test(code(f)),
    )
      .map(rel)
      .filter((f) => f !== "src/lib/tiptap/surface-editable.ts");
    expect(callers).toEqual(["src/components/Editor.tsx"]);
  });
});
