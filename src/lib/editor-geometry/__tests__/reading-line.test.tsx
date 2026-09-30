// @vitest-environment jsdom
//
// Task 857 — paragraph Back/Forward is a FIXED POINT of its own recorder.
//
// The recorder (`computeActiveBlockId` / the legacy walk) used to read the
// RAW scroll-container top — under ~78px of sticky chrome — while the landing
// (`scrollToParagraphId`) parked its target 100px below it. A short block
// above the target (its section heading, a one-line paragraph) sat between
// the two lines, so ~3s after Back the recorder read THAT block, pushed it,
// and truncated every Forward entry. Both halves now stand on ONE reading
// line (`reading-line.ts`, inset = `chromeTopInset`, the same expression
// ProseMirror's scroll margin reads).
//
// Geometry model (jsdom lays nothing out): every block has a CONTENT-space
// top; its client top is `contentTop - scrollEl.scrollTop` (scroll viewport
// at client 0). The chrome vars are unset, so the inset is the SSOT's
// fallback (38 + 40 = 78) — the shipped default.

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, renderHook } from "@testing-library/react";
import type { RefObject } from "react";

vi.mock("@/lib/storage", () => ({ isDevStorage: false }));

import { Editor } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { getBus } from "@/lib/tiptap/doc-structure";
import {
  computeActiveBlockId,
  computeActiveParagraphId,
  legacyActiveBlockWalk,
} from "../active-block";
import { readingLineY, scrollBlockToReadingLine } from "../reading-line";
import { chromeTopInset } from "@/lib/tiptap/chrome-scroll-margin";
import { useParaNavHistory } from "@/components/editor-layout/reader-view-prefs";
import type { EditorHandle } from "@/components/Editor";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    anchoredUuidsRef: { current: new Set() },
    host: null,
  };
}

// Content-space layout: F filler, X, H (a SHORT heading-like block), T (the
// target right under it), Y, Z.
const LAYOUT: Array<[string, number, number]> = [
  ["F", 0, 500],
  ["X", 600, 900],
  ["H", 1000, 1030],
  ["T", 1050, 1400],
  ["Y", 1500, 1900],
  ["Z", 2000, 2400],
];
const VIEWPORT_H = 600;

interface Rig {
  editor: Editor;
  scrollEl: HTMLElement;
  clientTopOf(uuid: string): number;
}

function mountRig(): Rig {
  const scrollEl = document.createElement("div");
  scrollEl.setAttribute("data-virgil-mirror-scroll", "");
  scrollEl.getBoundingClientRect = () =>
    ({ top: 0, bottom: VIEWPORT_H, left: 0, right: 800, width: 800, height: VIEWPORT_H, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  Object.defineProperty(scrollEl, "clientHeight", { value: VIEWPORT_H });
  document.body.appendChild(scrollEl);
  const element = document.createElement("div");
  scrollEl.appendChild(element);
  const editor = new Editor({
    element,
    editable: true,
    extensions: buildEditorExtensions(mainCtx()),
    content: {
      type: "doc",
      content: LAYOUT.map(([uuid]) => ({
        type: "paragraph",
        attrs: { uuid },
        content: [{ type: "text", text: `Block ${uuid}.` }],
      })),
    },
  });
  const structure = getBus(editor)!.structure;
  const byPos = LAYOUT.map(([uuid, top, bottom]) => ({
    uuid,
    top,
    bottom,
    pos: structure.blocks.get(uuid)!.pos,
  }));
  const dom = editor.view.dom as HTMLElement;
  Object.defineProperty(dom, "offsetHeight", { value: 2400, configurable: true });
  dom.getBoundingClientRect = () => {
    const t = -scrollEl.scrollTop;
    return { top: t, bottom: t + 2400, left: 100, right: 700, width: 600, height: 2400, x: 100, y: t, toJSON: () => ({}) } as DOMRect;
  };
  vi.spyOn(editor.view, "coordsAtPos").mockImplementation((pos: number) => {
    // The block that STARTS at pos (or the last block starting before it).
    let hit = byPos[0];
    for (const b of byPos) if (b.pos <= pos) hit = b;
    const top = (hit.pos === pos ? hit.top : hit.top + 10) - scrollEl.scrollTop;
    return { top, bottom: top + 20, left: 0, right: 0 };
  });
  vi.spyOn(editor.view, "posAtCoords").mockImplementation(({ top }) => {
    // Last block whose top is at/above the content Y → a pos inside it.
    const y = top + scrollEl.scrollTop;
    let hit = byPos[0];
    for (const b of byPos) if (b.top <= y) hit = b;
    return { pos: hit.pos + 1, inside: hit.pos };
  });
  const clientTopOf = (uuid: string) =>
    byPos.find((b) => b.uuid === uuid)!.top - scrollEl.scrollTop;
  return { editor, scrollEl, clientTopOf };
}

function land(rig: Rig, uuid: string) {
  scrollBlockToReadingLine(rig.editor.view, rig.clientTopOf(uuid));
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the reading line (task 857)", () => {
  it("stands on the chrome inset SSOT — the same number ProseMirror's scroll margin reads", () => {
    const rig = mountRig();
    expect(chromeTopInset(rig.editor.view.dom)).toBe(78);
    expect(readingLineY(rig.editor.view.dom, 0)).toBe(78);
    rig.editor.destroy();
  });

  it("a landing puts the target's top ON the line", () => {
    const rig = mountRig();
    land(rig, "T");
    expect(rig.clientTopOf("T")).toBe(78);
    // The short block above sits under the sticky chrome — never "at".
    expect(rig.clientTopOf("H")).toBeLessThan(78);
    rig.editor.destroy();
  });

  it("the fast-path recorder reads back the block it landed on, not the heading above it", () => {
    const rig = mountRig();
    land(rig, "T");
    // At HEAD (raw scroll top as the line) this returned "H".
    expect(computeActiveBlockId(rig.editor, rig.scrollEl)).toBe("T");
    expect(computeActiveParagraphId(rig.editor)).toBe("T");
    rig.editor.destroy();
  });

  it("the legacy walk (kill-switch fallback) reads the same line", () => {
    const rig = mountRig();
    land(rig, "T");
    expect(legacyActiveBlockWalk(rig.editor, rig.scrollEl)).toBe("T");
    rig.editor.destroy();
  });

  it("the top-edge probe lands below the sticky chrome (off the hover band)", () => {
    const rig = mountRig();
    land(rig, "T");
    const spy = vi.mocked(rig.editor.view.posAtCoords);
    spy.mockClear();
    computeActiveBlockId(rig.editor, rig.scrollEl);
    const ys = spy.mock.calls.map(([c]) => c.top);
    expect(ys.length).toBeGreaterThan(0);
    for (const y of ys) expect(y).toBeGreaterThanOrEqual(24 + 1);
    rig.editor.destroy();
  });
});

describe("Back then Forward survives a pause (Reader recorder, real read/land pair)", () => {
  it("push [X, T, Y], Back to T, wait → Forward history intact", () => {
    vi.useFakeTimers();
    const rig = mountRig();
    const handle = {
      getActiveParagraphId: () => computeActiveParagraphId(rig.editor),
      scrollToParagraphId: (uuid: string) => land(rig, uuid),
      scrollToHeading: () => {},
    } as unknown as EditorHandle;
    const ref: RefObject<EditorHandle | null> = { current: handle };
    const { result } = renderHook(() => useParaNavHistory(ref, rig.scrollEl));

    for (const uuid of ["X", "T", "Y"]) {
      land(rig, uuid);
      act(() => {
        vi.advanceTimersByTime(3100);
      });
    }
    expect(result.current.paraNavBackDisabled).toBe(false);
    expect(result.current.paraNavForwardDisabled).toBe(true);

    act(() => result.current.paraNavBack());
    expect(rig.clientTopOf("T")).toBe(78);
    expect(result.current.paraNavForwardDisabled).toBe(false);
    // The pause that used to wipe Forward (navigating guard 1.5s + 2s poll +
    // 1s debounce).
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(result.current.paraNavForwardDisabled).toBe(false);

    act(() => result.current.paraNavForward());
    expect(rig.clientTopOf("Y")).toBe(78);
    rig.editor.destroy();
  });
});

describe("source pin: one reading line, no hand constant", () => {
  const read = (p: string) => readFileSync(resolve(__dirname, "../../../", p), "utf8");
  it("scrollToParagraphId lands through the reading-line door (no literal 100)", () => {
    const editorSrc = read("components/Editor.tsx");
    const start = editorSrc.indexOf("scrollToParagraphId(uuid: string): void {");
    const body = editorSrc.slice(start, editorSrc.indexOf("jumpToCard(", start));
    expect(body).toContain("scrollBlockToReadingLine(");
    expect(body).not.toMatch(/-\s*100\b/);
  });
  it("the recorder and ProseMirror's scroll margin read the one inset helper", () => {
    expect(read("lib/editor-geometry/active-block.ts")).toContain("readingThresholdY(");
    expect(read("lib/editor-geometry/reading-line.ts")).toContain("chromeTopInset(");
    expect(read("lib/tiptap/chrome-scroll-margin.ts")).toContain(
      "const topInset = (): number => chromeTopInset(",
    );
  });
});
