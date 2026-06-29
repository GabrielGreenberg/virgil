// @vitest-environment jsdom
//
// Popped-state seam pins (bugs #34 / #36).
//
// #36 — grabbing a CARD inside a float must lift the card, not drag the
// window. FloatingPanel.onHeaderMouseDown wraps the whole float body in a
// grab surface; a press whose target is inside a `[data-card]` element must
// bail the window drag (so PanelCard's own 5px-threshold lift can win), while
// a press on inter-card gaps / background still arms the window drag.
//
// The blocklist is a deduped SSOT (src/lib/drag-blocklist.ts) consumed at
// three sites that used to carry a character-identical copy. We pin:
//   1. the shared base + the window-drag superset selector (string contract);
//   2. all three sites import the constant (no resurrected literal copy);
//   3. a real FloatingPanel mousedown on a `[data-card]` child does NOT arm
//      the window drag, while a background child DOES.
//
// (#34 is CSS-only — `[data-floating-panel]:has(...)` window ring. jsdom's
// `:has()` support is unreliable, so that visual is left to the preview/
// review gate; here we only assert the reconciler stamping is unchanged in
// the companion reconciler suite, and the accentTint thread typechecks.)

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  INTERACTIVE_CONTROL_SELECTOR,
  WINDOW_DRAG_BLOCK_SELECTOR,
} from "@/lib/drag-blocklist";

// Rendering the real <Panel> (bug sweep #5 cases) transitively imports
// `@/lib/storage`, whose `require("@/lib/storage-fsa")` vitest can't alias (the
// known barrel-storage gotcha). Stub the storage surface so the module loads —
// these tests touch no storage call.
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
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, "../.."); // src/

afterEach(() => {
  vi.restoreAllMocks();
});

describe("drag-blocklist SSOT (bug #36 dedup)", () => {
  it("the base selector lists the interactive controls but NOT [data-card]", () => {
    expect(INTERACTIVE_CONTROL_SELECTOR).toContain("button");
    expect(INTERACTIVE_CONTROL_SELECTOR).toContain("input");
    expect(INTERACTIVE_CONTROL_SELECTOR).toContain("textarea");
    expect(INTERACTIVE_CONTROL_SELECTOR).toContain("select");
    expect(INTERACTIVE_CONTROL_SELECTOR).toContain("[contenteditable='true']");
    expect(INTERACTIVE_CONTROL_SELECTOR).toContain("[draggable='true']");
    expect(INTERACTIVE_CONTROL_SELECTOR).toContain("[data-no-window-drag]");
    // The base list (card-lift, omni-pin) legitimately fires on card surfaces.
    expect(INTERACTIVE_CONTROL_SELECTOR).not.toContain("[data-card]");
  });

  it("the window-drag selector is the base PLUS [data-card] (bug #36)", () => {
    expect(WINDOW_DRAG_BLOCK_SELECTOR.startsWith(INTERACTIVE_CONTROL_SELECTOR)).toBe(
      true,
    );
    expect(WINDOW_DRAG_BLOCK_SELECTOR).toContain("[data-card]");
  });

  it("all three former-copy sites import the shared constant (no literal copy resurrected)", () => {
    const sites = [
      "components/FloatingPanel.tsx",
      "components/panel-primitives.tsx",
      "panels/Omni/OmniViewPanel.tsx",
    ];
    const LITERAL = "button, input, textarea, select, a, [contenteditable=";
    for (const rel of sites) {
      const src = readFileSync(path.join(SRC, rel), "utf8");
      expect(src, `${rel} should import from drag-blocklist`).toContain(
        "@/lib/drag-blocklist",
      );
      expect(src, `${rel} must not carry a hand-copied blocklist literal`).not.toContain(
        LITERAL,
      );
    }
  });
});

describe("FloatingPanel window drag bails on a [data-card] child (bug #36)", () => {
  // Render lazily so any heavy transitive import surfaces inside the test,
  // not at module load (keeps the string-contract tests above runnable even
  // if the component import ever regresses).
  async function renderFloat(children: React.ReactNode) {
    const { render } = await import("@testing-library/react");
    const { default: FloatingPanel } = await import("@/components/FloatingPanel");
    const onChange = vi.fn();
    const utils = render(
      <FloatingPanel
        cardKey="note:n1"
        mode="floating"
        surface="card"
        initialX={100}
        initialY={100}
        initialWidth={300}
        initialHeight={200}
        zIndex={1200}
        onChange={onChange}
      >
        {children}
      </FloatingPanel>,
    );
    return { onChange, ...utils };
  }

  it("a press on a [data-card] surface does NOT arm the window drag", async () => {
    const { getByTestId } = await renderFloat(
      <div data-card="1" data-card-key="note:n1">
        <div data-testid="card-body">card body</div>
      </div>,
    );
    const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    getByTestId("card-body").dispatchEvent(ev);
    // Bailed before preventDefault / grabbing-cursor / drag-state arm.
    expect(ev.defaultPrevented).toBe(false);
    expect(document.body.style.cursor).not.toBe("grabbing");
  });

  it("a press on inter-card background DOES arm the window drag", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const { getByTestId } = await renderFloat(
      <div data-testid="bg" style={{ padding: 20 }}>
        background gap (no card)
      </div>,
    );
    const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    getByTestId("bg").dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.body.style.cursor).toBe("grabbing");
    // Release so the global mouseup listener resets body styles for the next test.
    fireEvent(window, new MouseEvent("mouseup", { bubbles: true }));
  });
});

describe("Panel variant='raw' body is inert to the window drag (bug sweep #5)", () => {
  // Outline is the only content-bodied (variant="raw") docked panel; its section
  // rows are plain <div onClick> (not buttons, not [data-card]), so a press used
  // to arm the panel-move drag (blue halo + jitter-undock) and swallow the jump.
  // Panel marks the raw body region with [data-no-window-drag] (display:contents,
  // so the child's own scroll/flex layout is untouched), making the FloatingPanel
  // mousedown bail before arming. Search is unaffected — it's variant="list" with
  // <button> rows, already in INTERACTIVE_CONTROL_SELECTOR.
  afterEach(async () => {
    // Unmount RTL renders so the two cases below don't both leave an
    // "outline-row" in document.body (getByTestId would then find multiples).
    const { cleanup } = await import("@testing-library/react");
    cleanup();
  });

  async function renderRawPanelInFloat() {
    const { render } = await import("@testing-library/react");
    const { default: FloatingPanel } = await import("@/components/FloatingPanel");
    const { Panel } = await import("@/panels/_shared/Panel");
    return render(
      <FloatingPanel
        cardKey="note:n1"
        mode="floating"
        surface="card"
        initialX={100}
        initialY={100}
        initialWidth={300}
        initialHeight={400}
        zIndex={1200}
        onChange={vi.fn()}
      >
        <Panel kind="outline" variant="raw">
          <div data-testid="outline-scroll">
            <div data-testid="outline-row" onClick={() => {}}>
              § Introduction
            </div>
          </div>
        </Panel>
      </FloatingPanel>,
    );
  }

  it("wraps the raw body in a [data-no-window-drag] display:contents marker (no extra box)", async () => {
    const { getByTestId } = await renderRawPanelInFloat();
    const marker = getByTestId("outline-row").closest(
      "[data-no-window-drag]",
    ) as HTMLElement | null;
    expect(marker).not.toBeNull();
    expect(marker!.style.display).toBe("contents");
  });

  it("a press on a raw-panel content row does NOT arm the window drag", async () => {
    const { getByTestId } = await renderRawPanelInFloat();
    const ev = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    getByTestId("outline-row").dispatchEvent(ev);
    // Bailed at the closest([data-no-window-drag]) check — no preventDefault, no
    // grabbing cursor, so the row's own onClick jump fires instead.
    expect(ev.defaultPrevented).toBe(false);
    expect(document.body.style.cursor).not.toBe("grabbing");
  });
});

describe("popped-state selection/hover rings are scoped to FLOATING shell mode (bug #34 regression guard)", () => {
  // The FloatingPanel shell stamps data-floating-panel on BOTH docked and
  // floating panels; only the floating mode should get the window ring +
  // inner-outline suppression. A rule missing the shell-mode qualifier rings
  // docked panels and kills their per-card outline (the gate-caught BLOCK).
  const css = readFileSync(path.join(SRC, "app/globals.css"), "utf8");

  it("every [data-floating-panel] :has(...card-selected...) ring also carries [data-panel-shell-mode=floating]", () => {
    // Find each rule selector that targets a card-selected/hovered :has() ring
    // and assert the floating qualifier sits on the same [data-floating-panel].
    const ringLines = css
      .split("\n")
      .filter((l) => l.includes("[data-floating-panel]") && (l.includes(":has(") || l.includes("[data-card-key]")));
    expect(ringLines.length).toBeGreaterThan(0);
    for (const line of ringLines) {
      expect(line).toContain('[data-panel-shell-mode="floating"]');
    }
  });
});
