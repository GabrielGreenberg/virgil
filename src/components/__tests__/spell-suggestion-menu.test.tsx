// @vitest-environment jsdom
//
// Task 2026-08-31-518 — the correction gesture, end to end.
//
// The squiggle is only half a feature: what makes it usable is the menu, and
// what makes the menu honest is that every row does what it says. Three claims:
// right-clicking a FLAGGED word opens it (and right-clicking anything else does
// not, so the browser's own menu survives everywhere it should); a suggestion
// is an ORDINARY UNDOABLE EDIT that keeps the marks it lands in; and each of
// the two "add" rows writes the dictionary it names.
//
// Driven against the REAL plugin over the REAL main stack, and the REAL menu
// component — the parts that could misbehave are the CLICK reaching the right
// word and the ROW reaching the right dictionary, neither of which a test of
// the store alone can see.
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act, screen } from "@testing-library/react";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib",
    "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
    "mutateSidecar", "enqueueDocWrite",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { parseLatex } from "@/lib/latex-parser";
import {
  SPELL_DEBOUNCE_MS,
  SPELL_ERROR_CLASS,
} from "@/lib/tiptap/spellcheck-decorator";
import {
  closeSpellMenu,
  spellMenuRequest,
} from "@/lib/spell/spell-menu-store";
import { SpellSuggestionMenu } from "@/components/SpellSuggestionMenu";
import type { SpellcheckPort, SpellcheckPortRef } from "@/lib/spell/spell-port";

const KNOWN = new Set(["The", "the", "quick", "brown", "fox", "very", "is"]);

interface Recorder {
  paper: string[];
  global: string[];
}

function makePort(): { ref: SpellcheckPortRef; rec: Recorder } {
  const rec: Recorder = { paper: [], global: [] };
  const verdicts = new Map<string, boolean>();
  const port: SpellcheckPort = {
    enabled: () => true,
    version: () => 0,
    isAccepted: () => false,
    knownSync: (w) => verdicts.get(w),
    ensure: async (words) => {
      for (const w of words) verdicts.set(w, KNOWN.has(w));
    },
    suggest: async (w) => (w === "teh" ? ["the", "tech"] : []),
    acceptInPaper: (w) => rec.paper.push(w),
    acceptGlobally: (w) => rec.global.push(w),
  };
  return { ref: { current: port }, rec };
}

/**
 * jsdom implements no layout, so ProseMirror's scroll math throws on `undo`
 * (`Range.getClientRects` does not exist there). Zero rects keep the dispatch
 * alive; nothing here asserts geometry.
 */
const ZERO_RECT = {
  top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0,
  toJSON: () => ({}),
} as DOMRect;
function installLayoutShims(): void {
  const emptyList = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => emptyList;
  if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ZERO_RECT;
  if (!Element.prototype.getClientRects) Element.prototype.getClientRects = () => emptyList;
}

let editor: Editor | null = null;
beforeEach(() => {
  installLayoutShims();
  vi.useFakeTimers();
});
afterEach(() => {
  closeSpellMenu();
  cleanup();
  editor?.destroy();
  editor = null;
  vi.useRealTimers();
});

function mount(body: string, ref: SpellcheckPortRef): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const ctx = {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
    spellcheckPortRef: ref,
  } as unknown as EditorExtensionsCtx;
  editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(ctx),
    content: parseLatex(
      `\\documentclass{article}\n\\begin{document}\n${body}\n\\end{document}\n`,
    ) as never,
  });
  return editor;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await vi.advanceTimersByTimeAsync(SPELL_DEBOUNCE_MS + 10);
  }
}

function squiggle(): HTMLElement | null {
  return document.querySelector(`.${SPELL_ERROR_CLASS}`);
}

function rightClick(el: Element): boolean {
  const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev.defaultPrevented;
}

// ── the gesture ──────────────────────────────────────────────────────────────

describe("right-clicking a flagged word", () => {
  it("opens the menu for THAT word, with its range", async () => {
    const { ref } = makePort();
    const ed = mount("The quick teh fox.", ref);
    await settle();
    const span = squiggle();
    expect(span?.textContent).toBe("teh");

    expect(rightClick(span!)).toBe(true);
    const req = spellMenuRequest();
    expect(req?.word).toBe("teh");
    expect(ed.state.doc.textBetween(req!.from, req!.to)).toBe("teh");
  });

  it("…and right-clicking ordinary prose does NOT — the browser's menu survives", async () => {
    // The control that keeps the gesture honest: suppressing the native
    // context menu is defensible only over a word this checker has flagged.
    const { ref } = makePort();
    mount("The quick teh fox.", ref);
    await settle();
    const prose = document.querySelector(".ProseMirror p");
    expect(prose).toBeTruthy();
    expect(rightClick(prose!)).toBe(false);
    expect(spellMenuRequest()).toBeNull();
  });
});

// ── the rows ─────────────────────────────────────────────────────────────────

describe("what each row does", () => {
  async function openMenu() {
    const { ref, rec } = makePort();
    const ed = mount("The quick teh fox.", ref);
    await settle();
    rightClick(squiggle()!);
    await act(async () => {
      render(<SpellSuggestionMenu />);
      await vi.advanceTimersByTimeAsync(0);
    });
    return { ed, rec };
  }

  it("a suggestion replaces the word as an ORDINARY UNDOABLE edit", async () => {
    const { ed } = await openMenu();
    const before = ed.getText();
    await act(async () => {
      screen.getByText("the").click();
    });
    expect(ed.getText()).toContain("The quick the fox.");
    // Undoable — the misspelling comes back, which is what makes a wrong
    // correction recoverable. (A decoration-driven edit that skipped history
    // would leave the user with no way back to what they typed.)
    await act(async () => {
      ed.commands.undo();
    });
    expect(ed.getText()).toBe(before);
  });

  it("the replacement keeps the marks it lands in", async () => {
    const { ref } = makePort();
    const ed = mount("The quick \\textbf{teh} fox.", ref);
    await settle();
    const span = squiggle();
    expect(span?.textContent).toBe("teh");
    rightClick(span!);
    await act(async () => {
      render(<SpellSuggestionMenu />);
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      screen.getByText("the").click();
    });
    // Still bold: `insertText` carries the marks at the position, so a
    // corrected word inside a bold run stays bold.
    expect(ed.getHTML()).toMatch(/<strong>the<\/strong>/);
  });

  it("each ADD row writes the dictionary it names", async () => {
    const first = await openMenu();
    await act(async () => {
      screen.getByText("Add to this paper’s dictionary").click();
    });
    expect(first.rec.paper).toEqual(["teh"]);
    expect(first.rec.global).toEqual([]);

    cleanup();
    first.ed.destroy();
    closeSpellMenu();

    const second = await openMenu();
    await act(async () => {
      screen.getByText("Add to my dictionary").click();
    });
    expect(second.rec.global).toEqual(["teh"]);
    expect(second.rec.paper).toEqual([]);
  });

  it("suggestions are fetched on OPEN, never while typing", async () => {
    // The asymmetry the design rests on: checking is a table lookup and runs
    // per touched block; SUGGESTING walks the dictionary and runs only here.
    const { ref } = makePort();
    const spy = vi.spyOn(ref.current!, "suggest");
    mount("The quick teh fox.", ref);
    await settle();
    expect(spy).not.toHaveBeenCalled();
    rightClick(squiggle()!);
    await act(async () => {
      render(<SpellSuggestionMenu />);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(spy).toHaveBeenCalledWith("teh");
  });
});
