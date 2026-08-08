// @vitest-environment jsdom
/**
 * Print-intent gate (perf Wave 0, plan P3.1) — the appendix tree mounts only
 * during an active print. Pins the store handshake (request → mount ack →
 * release, with the no-pane timeout fallback) and PrintAppendices' post-commit
 * ack. The EditorPane-side mount condition is exercised implicitly: these are
 * the primitives it gates on.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import {
  requestAppendices,
  releaseAppendices,
  notifyAppendicesReady,
  getPrintIntent,
  subscribePrintIntent,
} from "@/lib/print-intent";
import { DEFAULT_PRINT_OPTIONS } from "@/lib/print";

vi.mock("@/panels/panel-registry", () => ({
  PANEL_REGISTRY: new Proxy(
    {},
    { get: () => ({ label: "Panel" }) },
  ),
}));

import PrintAppendices from "@/components/PrintAppendices";

afterEach(() => {
  releaseAppendices();
  cleanup();
  vi.useRealTimers();
});

describe("print-intent store", () => {
  it("requestAppendices activates, notifyAppendicesReady resolves, release deactivates", async () => {
    expect(getPrintIntent().active).toBe(false);
    const events: boolean[] = [];
    const off = subscribePrintIntent(() => events.push(getPrintIntent().active));

    const p = requestAppendices(DEFAULT_PRINT_OPTIONS);
    expect(getPrintIntent().active).toBe(true);
    expect(getPrintIntent().options).toBe(DEFAULT_PRINT_OPTIONS);

    notifyAppendicesReady();
    await p; // resolves — the print can proceed

    releaseAppendices();
    expect(getPrintIntent().active).toBe(false);
    expect(getPrintIntent().options).toBeNull();
    expect(events).toEqual([true, false]);
    off();
  });

  it("resolves via timeout when no pane ever acks (doc-less window)", async () => {
    vi.useFakeTimers();
    const p = requestAppendices(DEFAULT_PRINT_OPTIONS);
    let resolved = false;
    void p.then(() => { resolved = true; });
    await vi.advanceTimersByTimeAsync(1400);
    expect(resolved).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(resolved).toBe(true);
  });
});

describe("PrintAppendices ack", () => {
  it("acks the pending request one frame after mount", async () => {
    const p = requestAppendices(DEFAULT_PRINT_OPTIONS);
    let resolved = false;
    void p.then(() => { resolved = true; });

    render(
      <PrintAppendices options={DEFAULT_PRINT_OPTIONS} renderPanel={() => null} />,
    );
    // The ack rides a post-commit RAF.
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    await Promise.resolve();
    expect(resolved).toBe(true);
  });
});
