// @vitest-environment jsdom
//
// Task 421 — the omni bins are an affordance for a NON-positional fact (a
// card with no live anchor has no Y), and they carried the pre-410 posture:
// `position: absolute; top: 4` inside a DOCUMENT-TALL cascade pod — 4px from
// the top of the whole paper, gone on any scrolled document, and painted
// under a docked band (frame z 30 vs bins z 20 in a z-auto subtree).
//
// The posture is now decided by the column: `PanelColumn` publishes a BIN
// SLOT as the LAST flex child of its sticky band frame (Layer C) through
// `OmniBinSlotContext`, and `OmniViewPanel` portals the bin stack into it. So
// the bins sit BELOW the docked bands by flex ORDER (no z-index race) and ride
// the frame's sticky pin. With no column (a bare mount) the stack falls back
// to an in-pod zero-flow wrapper holding a STICKY inner.
//
// Legs (each measured by neutering — restoring `absolute; top: 4` on the
// stack fails 1 and 2; dropping the portal fails 3–5; dropping the slot
// from the frame fails 3 and 4):
//   1. in-pod fallback: zero-flow wrapper (absolute, inset 0, click-through)
//      holding a sticky inner that takes the clicks;
//   2. no host anywhere pins the stack to a document-top offset;
//   3. PanelColumn renders the slot INSIDE the sticky frame, AFTER every
//      docked band anchor, with the bin z rung and pointer events ON;
//   4. with a column, the REAL OmniViewPanel portals its stack into the slot
//      — the stack is NOT a flow child of the cascade pod (A5: podRect.top is
//      untouched) and still carries no `data-omni-entry-wrapper`;
//   5. the task-127 ordering survives the move: outside-focus below
//      unanchored, in one flex column;
//   6. census: both bins are call sites of the ONE `OmniBinPill` primitive
//      (the pill class is spelled exactly once in the file), and the retired
//      `top: 4` posture is gone from the source.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { createElement, useContext } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Editor } from "@tiptap/react";

vi.mock("@/lib/storage", () => {
  const stub = () => undefined;
  const names = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readTex", "writeTex",
    "readDocBundle", "writeDocBundle", "readBib", "writeBib", "createDocFromPicker",
    "createDocInFolder", "pickProjectFolder", "registerDocInFolder",
    "openExistingDocFromPicker", "listDocs", "renameDoc", "deleteDocFromIndex",
    "flushDoc", "drainDoc", "detectBibPackage", "readPaperFolder", "getTexFilename",
    "writePdf", "readPdf", "getPdfFilename", "pdfFilenameFromTex", "readFigureSource",
    "readFigureRaster", "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: () => false };
  for (const n of names) mod[n] = stub;
  return mod;
});

vi.mock("@/hooks/useInTextPositions", () => {
  const state = { panelScrollRef: { current: null as HTMLElement | null } };
  return {
    useInTextPositions: (_e: unknown, items: Array<{ id: string; pos: number }>) => ({
      positions: new Map(items.map((i) => [i.id, i.pos])),
      naturals: new Map(items.map((i) => [i.id, { naturalTop: i.pos, height: 60 }])),
      editorContentHeight: 6000,
      panelScrollRef: state.panelScrollRef,
    }),
    __mockState: state,
  };
});

import OmniViewPanel, { OmniBinStack, OmniUnanchoredBin, OmniOutsideFocusBin } from "@/panels/Omni/OmniViewPanel";
import { PanelColumn } from "@/components/editor-layout/panel-column";
import { OmniBinSlotContext, DATA_OMNI_BIN_SLOT } from "@/components/editor-layout/omni-bin-slot";
import type { OmniItem } from "@/panels/_shared/types";
import * as hookModule from "@/hooks/useInTextPositions";

const mockState = (hookModule as unknown as {
  __mockState: { panelScrollRef: { current: HTMLElement | null } };
}).__mockState;

afterEach(() => {
  cleanup();
  mockState.panelScrollRef.current = null;
  document.body.innerHTML = "";
});

const freeNote: OmniItem = {
  id: "float:card:note:free-1",
  pos: null,
  anchorState: "free",
  content: createElement("div", { "data-test-card": "free-1" }, "free"),
};
const outsideNote: OmniItem = {
  id: "float:card:note:outside-1",
  pos: 20,
  anchorState: "anchored",
  outsideFocus: true,
  content: createElement("div", { "data-test-card": "outside-1" }, "outside"),
};
const anchoredNote: OmniItem = {
  id: "float:card:note:anchored-1",
  pos: 10,
  anchorState: "anchored",
  content: createElement("div", { "data-test-card": "anchored-1" }, "anchored"),
};
const CATS = new Set(["notes"]) as never;
const liveEditor = {} as Editor;

function renderColumn(omni: React.ReactNode, stack: Array<{ id: never }> = []) {
  return render(
    <PanelColumn
      side="right"
      panelPref={300}
      onPanelPrefChange={() => {}}
      omni={omni}
      stack={stack as never}
      onTradeHeight={() => {}}
      onResizeBottomEdge={() => {}}
      onFocusBand={() => {}}
    />,
  );
}

describe("OmniBinStack — in-pod fallback is sticky, zero-flow and click-through", () => {
  it("leg 1: absolute inset-0 wrapper with pointer events OFF; sticky inner with pointer events ON", () => {
    const { container } = render(
      <OmniBinStack host="pod">
        <OmniUnanchoredBin free={[freeNote]} orphaned={[]} />
      </OmniBinStack>,
    );
    const stack = container.querySelector("[data-omni-bin-stack]") as HTMLElement;
    expect(stack.style.position).toBe("absolute");
    expect(stack.style.inset).toBe("0px");
    expect(stack.style.pointerEvents).toBe("none");
    const inner = container.querySelector("[data-omni-bin-sticky]") as HTMLElement;
    expect(inner.style.position).toBe("sticky");
    expect(inner.style.pointerEvents).toBe("auto");
    expect(stack.contains(container.querySelector("[data-omni-unanchored-bin]")!)).toBe(true);
    // Still nothing the cascade RO would measure, collapsed or expanded.
    expect(container.querySelectorAll("[data-omni-entry-wrapper]").length).toBe(0);
    fireEvent.click(container.querySelector("button")!);
    expect(container.querySelectorAll("[data-omni-entry-wrapper]").length).toBe(0);
  });

  it("leg 2: neither host pins the stack to a document-top offset", () => {
    for (const host of ["pod", "frame"] as const) {
      const { container, unmount } = render(
        <OmniBinStack host={host}>
          <OmniUnanchoredBin free={[freeNote]} orphaned={[]} />
        </OmniBinStack>,
      );
      const stack = container.querySelector("[data-omni-bin-stack]") as HTMLElement;
      // The pre-421 posture was `top: 4px` on an absolute wrapper inside the
      // document-tall pod. A `top` on the wrapper is a document coordinate.
      expect(stack.style.top).toBe("");
      expect(stack.getAttribute("data-omni-bin-host")).toBe(host);
      unmount();
    }
  });
});

describe("PanelColumn — the bin slot lives in the sticky band frame, after the bands", () => {
  it("leg 3: slot is the LAST child of [data-stack-frame], after every band anchor, z 20, clickable", () => {
    const { container } = renderColumn(<div data-testid="omni" />, [
      { id: "notes" as never },
      { id: "todos" as never },
    ]);
    const frame = container.querySelector("[data-stack-frame]") as HTMLElement;
    expect(frame.style.position).toBe("sticky");
    const slot = container.querySelector(`[${DATA_OMNI_BIN_SLOT}="right"]`) as HTMLElement;
    expect(slot).not.toBeNull();
    expect(frame.contains(slot)).toBe(true);
    expect(frame.lastElementChild).toBe(slot);
    for (const band of Array.from(container.querySelectorAll("[data-dock-slot]"))) {
      expect(band.compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(slot.style.zIndex).toBe("20");
    expect(slot.style.pointerEvents).toBe("auto");
    // The slot is in Layer B (absolute pass-through), so it takes no flow
    // space in the column either.
    expect(slot.closest(".absolute.inset-0")).not.toBeNull();
  });

  it("leg 3b: the slot element is what the context publishes", () => {
    let seen: HTMLElement | null | undefined;
    function Probe() {
      seen = useContext(OmniBinSlotContext);
      return null;
    }
    const { container } = renderColumn(<Probe />);
    const slot = container.querySelector(`[${DATA_OMNI_BIN_SLOT}]`);
    expect(seen).toBe(slot);
  });
});

describe("OmniViewPanel — portals its bins into the column slot", () => {
  it("leg 4: the stack is in the slot, NOT a child of the cascade pod; no entry-wrapper", () => {
    const { container } = renderColumn(
      <OmniViewPanel side="right" items={[anchoredNote, freeNote]} editor={liveEditor} enabledCategories={CATS} />,
    );
    const slot = container.querySelector(`[${DATA_OMNI_BIN_SLOT}]`) as HTMLElement;
    const stack = container.querySelector("[data-omni-bin-stack]") as HTMLElement;
    expect(stack).not.toBeNull();
    expect(stack.getAttribute("data-omni-bin-host")).toBe("frame");
    expect(slot.contains(stack)).toBe(true);
    const pod = mockState.panelScrollRef.current!;
    expect(pod).not.toBeNull();
    expect(pod.contains(stack)).toBe(false);
    // The pod's flow children are exactly the anchored wrappers — nothing
    // above them to displace podRect.top (A5).
    for (const child of Array.from(pod.children)) {
      expect(child.hasAttribute("data-omni-entry-wrapper")).toBe(true);
    }
    expect(stack.querySelectorAll("[data-omni-entry-wrapper]").length).toBe(0);
    // The pill still works through the portal.
    expect(stack.textContent).toContain("1 unplaced");
    fireEvent.click(stack.querySelector("button")!);
    expect(stack.querySelector('[data-test-card="free-1"]')).not.toBeNull();
  });

  it("leg 5: task-127 ordering survives — outside-focus below unanchored, one flex column", () => {
    const { container } = renderColumn(
      <OmniViewPanel side="right" items={[freeNote, outsideNote]} editor={liveEditor} enabledCategories={CATS} />,
    );
    const stack = container.querySelector("[data-omni-bin-stack]") as HTMLElement;
    const un = container.querySelector("[data-omni-unanchored-bin]") as HTMLElement;
    const out = container.querySelector("[data-omni-outside-focus-bin]") as HTMLElement;
    expect(stack.contains(un) && stack.contains(out)).toBe(true);
    expect(un.parentElement).toBe(out.parentElement);
    expect(un.compareDocumentPosition(out) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(un.style.position).not.toBe("absolute");
    expect(out.style.position).not.toBe("absolute");
  });

  it("leg 5b: without a column the panel keeps the bins in-pod, sticky (the fallback)", () => {
    const { container } = render(
      <OmniViewPanel side="right" items={[freeNote]} editor={liveEditor} enabledCategories={CATS} />,
    );
    const stack = container.querySelector("[data-omni-bin-stack]") as HTMLElement;
    expect(stack.getAttribute("data-omni-bin-host")).toBe("pod");
    expect(mockState.panelScrollRef.current!.contains(stack)).toBe(true);
    expect(container.querySelector("[data-omni-bin-sticky]")).not.toBeNull();
  });
});

describe("census — one pill primitive, no document-top posture", () => {
  const src = readFileSync(join(process.cwd(), "src/panels/Omni/OmniViewPanel.tsx"), "utf8");
  it("leg 6: the `omni-bin-pill` class is spelled exactly once (inside OmniBinPill); both bins render through it", () => {
    expect(src.match(/omni-bin-pill/g)?.length).toBe(1);
    const { container } = render(
      <OmniBinStack host="frame">
        <OmniUnanchoredBin free={[freeNote]} orphaned={[]} />
        <OmniOutsideFocusBin items={[outsideNote]} />
      </OmniBinStack>,
    );
    expect(container.querySelectorAll("button.omni-bin-pill").length).toBe(2);
  });
  it("leg 6b: the retired `absolute; top: 4` stack posture is gone", () => {
    expect(/position:\s*"absolute",\s*top:\s*4\b/.test(src)).toBe(false);
    // And the slot is CONSUMED: a context nobody reads is the dead-SSOT shape.
    expect(src).toContain("useOmniBinSlot()");
    expect(src).toContain("createPortal(");
  });
});
