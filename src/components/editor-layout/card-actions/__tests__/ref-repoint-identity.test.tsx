// @vitest-environment jsdom
/**
 * TASK 550 — the `\ref` popover addresses THE CLICKED CHIP, by identity.
 *
 * A paper cites the same section several times. Every step of the edit path
 * used to resolve the chip by its LABEL STRING: the NodeView's click carried
 * `{ label, refCommand }` and nothing else; the bridge re-found the chip with
 * a document-wide `querySelector('[data-label=…]')` (the FIRST in DOM order —
 * off-screen for a later duplicate, and possibly a HIDDEN pane's chip under
 * multi-doc keep-alive); and `handleRefChangeLabel` / `handleRefChangeCommand`
 * walked the doc and rewrote the FIRST `labelRef` naming the old key. So
 * re-pointing the second `\ref{sec:a}` silently changed the first, and the
 * popover opened beside a chip the user had not clicked.
 *
 * Every leg drives the REAL `buildEditorExtensions("main")` stack, the REAL
 * `useRefActions` hook and — for the click — the REAL NodeView and the REAL
 * bridge. The defect legs assert the chip that must NOT move. No pre-550
 * suite could see any of this: none drives a document with two refs to one
 * label, so "the wrong chip changed" was unrepresentable in all of them.
 */
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "mutateBib",
    "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

import fs from "node:fs";
import path from "node:path";
import { renderHook, cleanup } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { useRefActions } from "@/components/editor-layout/card-actions/ref";
import { useMarkerClickBridges } from "@/components/editor-layout/event-bridges/marker-clicks";
import type { EditorHandle } from "@/components/Editor";
import { REF_CLICK_EVENT, type ActiveRef } from "@/lib/tiptap/label";
import { REPO_ROOT, codeOnly, commentsStripped } from "@/lib/__tests__/_source-scan";

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  };
}

const ref = (label: string, refCommand = "ref") => ({
  type: "labelRef",
  attrs: { label, displayText: "", refCommand, targetKind: null },
});

/** Two headings, a captioned figure, and TWO chips pointing at `sec:a`. */
function content(): JSONContent {
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1, uuid: "h-a", label: "sec:a", sectionNumber: "1" }, content: [{ type: "text", text: "A" }] },
      { type: "heading", attrs: { level: 1, uuid: "h-b", label: "sec:b", sectionNumber: "2" }, content: [{ type: "text", text: "B" }] },
      {
        type: "figureBlock",
        attrs: { uuid: "fig", label: "fig:x", numbered: true },
        content: [{ type: "figureCaption", content: [{ type: "text", text: "A figure" }] }],
      },
      { type: "paragraph", attrs: { uuid: "p1" }, content: [{ type: "text", text: "first mention " }, ref("sec:a")] },
      { type: "paragraph", attrs: { uuid: "p2" }, content: [{ type: "text", text: "second mention " }, ref("sec:a")] },
    ],
  };
}

const editors: Editor[] = [];
function mount(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const ed = new Editor({ element, editable: true, extensions: buildEditorExtensions(mainCtx()), content: content() });
  editors.push(ed);
  return ed;
}
afterEach(() => {
  cleanup();
  for (const ed of editors.splice(0)) ed.destroy();
  document.body.innerHTML = "";
});

/** Every `labelRef` in doc order with its position. */
function chips(ed: Editor): { pos: number; label: string; refCommand: string; displayText: string }[] {
  const out: { pos: number; label: string; refCommand: string; displayText: string }[] = [];
  ed.state.doc.descendants((nd, pos) => {
    if (nd.type.name === "labelRef") {
      out.push({ pos, label: nd.attrs.label, refCommand: nd.attrs.refCommand, displayText: nd.attrs.displayText });
    }
  });
  return out;
}

function actions(ed: Editor) {
  const handle = { getEditor: () => ed } as unknown as EditorHandle;
  const setActiveRef = vi.fn();
  const { result } = renderHook(() => useRefActions({ editorRef: { current: handle }, setActiveRef }));
  return { result, setActiveRef };
}

describe("re-pointing addresses the clicked chip (task 550)", () => {
  it("DEFECT LEG: changing the SECOND chip's label rewrites only it — the first keeps `sec:a`", () => {
    const ed = mount();
    const [c1, c2] = chips(ed);
    const { result } = actions(ed);
    expect(result.current.handleRefChangeLabel({ editor: ed, pos: c2.pos, label: "sec:a" }, "sec:b")).toBe(true);
    const after = chips(ed);
    expect(after.map((c) => c.label)).toEqual(["sec:a", "sec:b"]);
    expect(after[0].pos).toBe(c1.pos);
    expect(after[1].displayText).toBe("2");
  });

  it("DEFECT LEG: flipping the SECOND chip's command flips only it", () => {
    const ed = mount();
    const [, c2] = chips(ed);
    const { result } = actions(ed);
    expect(result.current.handleRefChangeCommand({ editor: ed, pos: c2.pos, label: "sec:a" }, "getref")).toBe(true);
    const after = chips(ed);
    expect(after.map((c) => c.refCommand)).toEqual(["ref", "getref"]);
    expect(after[1].displayText).toBe("(1)");
  });

  it("CONTROL: the FIRST chip's identity still re-points the first", () => {
    const ed = mount();
    const [c1] = chips(ed);
    const { result } = actions(ed);
    result.current.handleRefChangeLabel({ editor: ed, pos: c1.pos, label: "sec:a" }, "sec:b");
    expect(chips(ed).map((c) => c.label)).toEqual(["sec:b", "sec:a"]);
  });

  it("DEFECT LEG (figure): re-pointing at a numbered figure writes its number, never `??`", () => {
    const ed = mount();
    const [, c2] = chips(ed);
    const { result } = actions(ed);
    result.current.handleRefChangeLabel({ editor: ed, pos: c2.pos, label: "sec:a" }, "fig:x");
    const after = chips(ed);
    expect(after[1].label).toBe("fig:x");
    expect(after[1].displayText).toBe("1");
    expect(ed.state.doc.nodeAt(after[1].pos)?.attrs.targetKind).toBe("figure");
  });

  it("REFUSES a stale identity (the doc moved under the popover) rather than falling back to a label search", () => {
    const ed = mount();
    const [c1, c2] = chips(ed);
    const { result } = actions(ed);
    // Insert text BEFORE both chips: every position after it shifts by 3.
    ed.commands.insertContentAt(1, "xyz");
    const moved = chips(ed);
    expect(moved[1].pos).toBe(c2.pos + 3);
    // The stale pos now holds something else (or nothing) — refuse.
    expect(result.current.handleRefChangeLabel({ editor: ed, pos: c2.pos, label: "sec:a" }, "sec:b")).toBe(false);
    expect(result.current.handleRefChangeCommand({ editor: ed, pos: c1.pos, label: "sec:a" }, "getref")).toBe(false);
    expect(chips(ed).map((c) => [c.label, c.refCommand])).toEqual([["sec:a", "ref"], ["sec:a", "ref"]]);
  });

  it("REFUSES an identity whose label no longer matches the node at that pos", () => {
    const ed = mount();
    const [, c2] = chips(ed);
    const { result } = actions(ed);
    expect(result.current.handleRefChangeLabel({ editor: ed, pos: c2.pos, label: "sec:other" }, "sec:b")).toBe(false);
    expect(chips(ed).map((c) => c.label)).toEqual(["sec:a", "sec:a"]);
  });

  it("a null identity (create-mode) writes nothing", () => {
    const ed = mount();
    const { result } = actions(ed);
    expect(result.current.handleRefChangeLabel(null, "sec:b")).toBe(false);
    expect(result.current.handleRefChangeCommand(null, "getref")).toBe(false);
    expect(chips(ed).map((c) => c.label)).toEqual(["sec:a", "sec:a"]);
  });

  it("the popover stays on THIS chip: the active ref's label / command follow the write", () => {
    const ed = mount();
    const [, c2] = chips(ed);
    const { result, setActiveRef } = actions(ed);
    result.current.handleRefChangeLabel({ editor: ed, pos: c2.pos, label: "sec:a" }, "sec:b");
    const updater = setActiveRef.mock.calls.at(-1)![0] as (p: ActiveRef | null) => ActiveRef | null;
    const rect = new DOMRect(0, 0, 10, 10);
    const active: ActiveRef = { editor: ed, pos: c2.pos, label: "sec:a", refCommand: "ref", rect };
    expect(updater(active)?.label).toBe("sec:b");
    // A different chip's active state is left alone.
    expect(updater({ ...active, pos: 1 })?.label).toBe("sec:a");
    expect(updater(null)).toBeNull();
    result.current.handleRefChangeCommand({ editor: ed, pos: c2.pos, label: "sec:b" }, "getfullref");
    const updater2 = setActiveRef.mock.calls.at(-1)![0] as (p: ActiveRef | null) => ActiveRef | null;
    expect(updater2({ ...active, label: "sec:b" })?.refCommand).toBe("getfullref");
  });
});

describe("the click carries identity and the bridge stores it (no DOM re-find)", () => {
  function bridgeDeps() {
    const setActiveRef = vi.fn();
    const deps = {
      prefsRef: { current: { placements: [], activeLeft: null, activeRight: null } },
      setActiveLeft: vi.fn(),
      setActiveRight: vi.fn(),
      tryScrollOmniEntry: vi.fn(() => true),
      getOmniEnabled: vi.fn(() => new Set()),
      setSelectedFootnoteId: vi.fn(),
      setSelectedCitationId: vi.fn(),
      setSelectedErrorId: vi.fn(),
      setActiveRef,
      setAtomCreateRequest: vi.fn(),
      setActiveMath: vi.fn(),
      setActiveFigure: vi.fn(),
      alignOmniCardWithClick: vi.fn(),
      getActiveCardStore: () => ({}) as never,
    };
    renderHook(() => useMarkerClickBridges(deps as unknown as Parameters<typeof useMarkerClickBridges>[0]));
    return setActiveRef;
  }

  it("DEFECT LEG: clicking the SECOND chip's own DOM opens on the second chip — its pos, its rect", () => {
    const ed = mount();
    const setActiveRef = bridgeDeps();
    const [c1, c2] = chips(ed);
    const dom2 = ed.view.nodeDOM(c2.pos) as HTMLElement;
    expect(dom2).toBeInstanceOf(HTMLElement);
    dom2.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(setActiveRef).toHaveBeenCalledTimes(1);
    const active = setActiveRef.mock.calls[0][0] as ActiveRef;
    expect(active.pos).toBe(c2.pos);
    expect(active.pos).not.toBe(c1.pos);
    expect(active.editor).toBe(ed);
    expect(active.label).toBe("sec:a");
    expect(active.refCommand).toBe("ref");
    expect(active.rect).toBeInstanceOf(DOMRect);
  });

  it("a detail without identity (the pre-550 shape) is dropped, never resolved against the first match", () => {
    mount();
    const setActiveRef = bridgeDeps();
    window.dispatchEvent(new CustomEvent(REF_CLICK_EVENT, { detail: { label: "sec:a", refCommand: "ref", targetKind: null } }));
    expect(setActiveRef).not.toHaveBeenCalled();
  });

  it("a detail with a pos but no owning editor is dropped (the math/figure bridges' rule)", () => {
    mount();
    const setActiveRef = bridgeDeps();
    window.dispatchEvent(
      new CustomEvent(REF_CLICK_EVENT, {
        detail: { label: "sec:a", refCommand: "ref", targetKind: null, pos: 5, rect: new DOMRect() },
      }),
    );
    expect(setActiveRef).not.toHaveBeenCalled();
  });

  it("an unknown refCommand normalizes to `ref`", () => {
    const ed = mount();
    const setActiveRef = bridgeDeps();
    window.dispatchEvent(
      new CustomEvent(REF_CLICK_EVENT, {
        detail: { label: "sec:a", refCommand: "bogus", targetKind: null, pos: 5, editor: ed, rect: new DOMRect() },
      }),
    );
    expect((setActiveRef.mock.calls[0][0] as ActiveRef).refCommand).toBe("ref");
  });
});

describe("census — the identity path has no label-string re-find left", () => {
  const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

  it("the bridge spells no `data-label` query and listens on the shared event name", () => {
    // Strings KEPT (`commentsStripped`, not `codeOnly`): both the selector
    // needle and the `"number"` guard live inside quoted text.
    const code = commentsStripped(read("src/components/editor-layout/event-bridges/marker-clicks.ts"));
    expect(code).not.toMatch(/data-label/);
    expect(code).toMatch(/REF_CLICK_EVENT/);
    expect(code).toMatch(/typeof detail\.pos !== "number"/);
  });

  it("the NodeView's click carries pos + editor + rect", () => {
    const code = commentsStripped(read("src/lib/tiptap/label.ts"));
    const click = /addEventListener\("click"[\s\S]*?REF_CLICK_EVENT/.exec(code)?.[0] ?? "";
    expect(click.length).toBeGreaterThan(0);
    expect(click).toMatch(/pos,/);
    expect(click).toMatch(/editor,/);
    expect(click).toMatch(/rect: new DOMRect\(/);
  });

  it("EditorLayout highlights the clicked chip through its view, not every chip sharing the label", () => {
    const code = commentsStripped(read("src/components/EditorLayout.tsx"));
    expect(code).not.toMatch(/data-label/);
    expect(code).not.toMatch(/activeRefLabel/);
    expect(code).toMatch(/editor\.view\.nodeDOM\(pos\)/);
  });

  it("the re-point handlers walk nothing: no `descendants(` in either", () => {
    const code = codeOnly(read("src/components/editor-layout/card-actions/ref.ts"));
    for (const name of ["handleRefChangeLabel", "handleRefChangeCommand"]) {
      const body = new RegExp(`const ${name} = useCallback\\(([\\s\\S]*?)\\n  \\);`).exec(code)?.[1] ?? "";
      expect(body.length, name).toBeGreaterThan(0);
      expect(body, name).not.toMatch(/descendants\(/);
      expect(body, name).toMatch(/locateRef\(target\)/);
    }
  });
});
