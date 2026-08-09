// @vitest-environment jsdom
//
// Wave-3 — card presence tiers: the collapsed borrowed body's switch.
//
// The teeth, in the order the perf program cares about them:
//  1. FLAG ON, ramp settled → a collapsed footnote body is T1 STATIC:
//     the real StaticBorrowedText HTML renders (content visible) and ZERO
//     .ProseMirror instances exist — no live editor mounted per collapsed
//     card. This is the diagnosis's 881-editors class, closed.
//  2. FLAG ON, ramp stage 0 (the doc-open commit) → the body is the T0
//     summary string: no static HTML container, no editor — the first
//     commit after the curtain lifts renders text only.
//  3. FLAG OFF (default) → byte-identical legacy behavior: the live
//     BorrowedMainText editor mounts (a .ProseMirror appears).
//
// BorrowedMainText is deliberately NOT stubbed — the zero-.ProseMirror
// assertion is only honest against the real live component, which would
// mount one if the switch chose wrong.

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  const names = [
    "isDevStorage", "readSidecar", "readSidecarIfExists", "writeSidecar",
    "readTex", "writeTex", "readDocBundle", "writeDocBundle", "readBib",
    "writeBib", "createDocFromPicker", "createDocInFolder", "pickProjectFolder",
    "registerDocInFolder", "openExistingDocFromPicker", "listDocs", "renameDoc",
    "deleteDocFromIndex", "flushDoc", "drainDoc", "detectBibPackage",
    "readPaperFolder", "getTexFilename", "writePdf", "readPdf", "getPdfFilename",
    "pdfFilenameFromTex", "readFigureSource", "readFigureRaster",
    "writeFigureRaster", "deleteFigureRaster", "readFigureIndex",
    "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  return Object.fromEntries(names.map((n) => [n, noop]));
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, cleanup, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { EditableCard, CARD_THEMES } from "@/components/panel-primitives";
import { CardPresenceProvider } from "@/cards/presence";

const theme = CARD_THEMES.note;
const BODY = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "the borrowed body prose" }] },
  ],
};

type Props = ComponentProps<typeof EditableCard>;
function cardProps(): Props {
  return {
    id: "f1",
    selected: false,
    theme,
    kind: "footnote",
    cardKind: "footnote",
    value: BODY,
    onChange: vi.fn(),
    compressed: true,
    compressedContent: BODY,
  };
}

beforeEach(() => {
  localStorage.removeItem("virgil:card-tiers");
});
afterEach(() => {
  cleanup();
  localStorage.removeItem("virgil:card-tiers");
});

describe("card presence tiers — the collapsed borrowed switch", () => {
  it("flag ON + ramp settled: T1 static HTML, ZERO live editors", async () => {
    localStorage.setItem("virgil:card-tiers", "on");
    const { container } = render(
      <CardPresenceProvider ready={true}>
        <EditableCard {...cardProps()} />
      </CardPresenceProvider>,
    );
    // The ramp steps T0→T1→full on low-priority callbacks; wait for the
    // static container to land.
    await waitFor(() => {
      expect(
        container.querySelector('[data-static-borrowed="html"]'),
      ).not.toBeNull();
    });
    expect(container.textContent).toContain("the borrowed body prose");
    // The tooth: no live editor anywhere in the card. (The real
    // BorrowedMainText would mount one asynchronously — give it the same
    // settle window the static wait used.)
    await new Promise((r) => setTimeout(r, 30));
    expect(container.querySelector(".ProseMirror")).toBeNull();
  });

  it("flag ON, ramp stage 0: the T0 summary string — no static container, no editor", () => {
    localStorage.setItem("virgil:card-tiers", "on");
    const { container } = render(
      <CardPresenceProvider ready={false}>
        <EditableCard {...cardProps()} />
      </CardPresenceProvider>,
    );
    // ready=false: the ramp never starts, ceiling stays T0.
    expect(container.textContent).toContain("the borrowed body prose");
    expect(container.querySelector('[data-static-borrowed="html"]')).toBeNull();
    expect(container.querySelector(".ProseMirror")).toBeNull();
  });

  it("flag OFF (default): the legacy live BorrowedMainText mounts", async () => {
    const { container } = render(
      <CardPresenceProvider ready={true}>
        <EditableCard {...cardProps()} />
      </CardPresenceProvider>,
    );
    expect(container.querySelector("[data-static-borrowed]")).toBeNull();
    await waitFor(() => {
      expect(container.querySelector(".ProseMirror")).not.toBeNull();
    });
  });
});
