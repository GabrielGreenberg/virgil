// @vitest-environment jsdom
//
// Pins for the FOLDED gutter-pin re-anchor gesture (chip H PHASE 2).
//
// The marginalia gutter pin used to re-anchor a card via native HTML5 DnD
// (MIME_MARGINALIA_MOVE → a `virgil-marginalia-reanchor` CustomEvent → the
// `anchor-rebind` bridge). That parallel machinery is deleted; the pin now
// starts a unified drop-mode session via the SAME `beginCardDropGesture`
// helper the card drop button uses. These tests prove:
//
//   1. A primary-button mousedown on a re-anchorable pin starts a drop session
//      with the canonical `float:card:<kind>:<id>` key, derived from the
//      marker's REAL CardKind (`m.entityKind`) + `m.entityId` — including the
//      multi-kind marker types (cut → cutter-comment / cutter-suggestion,
//      report → report-request) where MarkerType alone is ambiguous.
//   2. A non-card "error" marker (no `entityKind`) is click-only — its
//      mousedown starts NO session.
//   3. A read-only host (`dragEnabled=false`) starts NO session.
//   4. A non-primary (right-click) press starts NO session.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Marginalia transitively pulls panel theming; stub storage defensively
// (the barrel/storage gotcha) so nothing tries to touch a sidecar.
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

// Mock the controller so the gesture is observable without a live DropCtx /
// spec registry. `beginCardDropGesture` imports `beginDropSession` +
// `commitDropSession` from here.
const beginDropSession = vi.fn((..._args: unknown[]) => true);
const commitDropSession = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/components/drop-mode/controller", () => ({
  beginDropSession: (...args: unknown[]) => beginDropSession(...args),
  commitDropSession: (...args: unknown[]) => commitDropSession(...args),
}));

import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { MarkerButton } from "@/components/Marginalia";
import { buildFloatKey } from "@/floats/float-key";
import type { MarginaliaMarker } from "@/lib/marginalia";
import type { EntityKind } from "@/links/_shared/entity-hover";

beforeEach(() => {
  beginDropSession.mockClear();
  commitDropSession.mockClear();
  beginDropSession.mockReturnValue(true);
});
afterEach(cleanup);

function marker(
  over: Partial<MarginaliaMarker> & Pick<MarginaliaMarker, "type" | "entityId">,
): MarginaliaMarker {
  return {
    id: `${over.entityId}:p1`,
    textObjectId: "p1",
    ...over,
  } as MarginaliaMarker;
}

function pressPin(button = 0, clientX = 40, clientY = 50) {
  fireEvent.mouseDown(screen.getByRole("button"), { button, clientX, clientY });
}

describe("gutter-pin → beginCardDropGesture (folded re-anchor)", () => {
  // [markerType, entityKind, entityId] — covers the single-kind markers and
  // BOTH legs of every ambiguous MarkerType (cut, report, revision).
  const cases: Array<[MarginaliaMarker["type"], EntityKind, string]> = [
    ["note", "note", "n1"],
    ["todo", "todo", "t1"],
    ["archive", "archive", "a1"],
    ["cut", "cutter-comment", "cc1"],
    ["cut", "cutter-suggestion", "cs1"],
    ["report", "report", "r1"],
    ["report", "report-request", "rr1"],
    ["revision", "revision-comment", "rv1"],
    ["revision", "revision-suggestion", "rvs1"],
  ];

  for (const [type, entityKind, entityId] of cases) {
    it(`marker type "${type}" → kind "${entityKind}" starts a session with float:card:${entityKind}:${entityId}`, () => {
      render(
        <MarkerButton
          m={marker({ type, entityKind, entityId })}
          dragEnabled
        />,
      );
      pressPin(0);
      expect(beginDropSession).toHaveBeenCalledTimes(1);
      const arg = beginDropSession.mock.calls[0][0] as {
        cardKey: string;
        inPlace?: boolean;
        externalCommit?: boolean;
        origin: { x: number; y: number };
      };
      // The cardKey is built from the REAL card kind, not the MarkerType —
      // this is the whole point of carrying `entityKind` on the marker.
      expect(arg.cardKey).toBe(
        buildFloatKey({ domain: "card", kind: entityKind, id: entityId }),
      );
      // Same in-place / external-commit contract as the card drop button.
      expect(arg.inPlace).toBe(true);
      expect(arg.externalCommit).toBe(true);
      expect(arg.origin).toEqual({ x: 40, y: 50 });
      // Terminate the gesture so its one-shot window mouseup self-removes.
      fireEvent(window, new MouseEvent("mouseup", { bubbles: true }));
    });
  }
});

describe("gutter-pin gesture guards", () => {
  it("a non-card 'error' marker (no entityKind) starts NO session", () => {
    render(
      <MarkerButton
        m={marker({ type: "error", entityId: "e1" })}
        dragEnabled
      />,
    );
    pressPin(0);
    expect(beginDropSession).not.toHaveBeenCalled();
  });

  it("a read-only host (dragEnabled=false) starts NO session", () => {
    render(
      <MarkerButton
        m={marker({ type: "note", entityKind: "note", entityId: "n1" })}
        dragEnabled={false}
      />,
    );
    pressPin(0);
    expect(beginDropSession).not.toHaveBeenCalled();
  });

  it("a non-primary (right-click) press starts NO session", () => {
    render(
      <MarkerButton
        m={marker({ type: "note", entityKind: "note", entityId: "n1" })}
        dragEnabled
      />,
    );
    pressPin(2); // right button
    expect(beginDropSession).not.toHaveBeenCalled();
    // …and a primary press on the SAME pin DOES start one (guard is
    // button-selective, not globally inert).
    pressPin(0);
    expect(beginDropSession).toHaveBeenCalledTimes(1);
    fireEvent(window, new MouseEvent("mouseup", { bubbles: true }));
  });

  it("the click that opens the panel is preserved on a plain press (no drag)", () => {
    const onClick = vi.fn();
    render(
      <MarkerButton
        m={marker({ type: "note", entityKind: "note", entityId: "n1", onClick })}
        dragEnabled
      />,
    );
    // A plain click (mousedown then click, no movement) opens the panel via
    // the marker's own onClick — the suppress-trailing-click guard only fires
    // after a real drag crosses its movement threshold.
    fireEvent.mouseDown(screen.getByRole("button"), { button: 0, clientX: 40, clientY: 50 });
    fireEvent(window, new MouseEvent("mouseup", { bubbles: true }));
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
