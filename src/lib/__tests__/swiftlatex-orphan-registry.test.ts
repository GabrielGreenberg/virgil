// @vitest-environment jsdom
/**
 * TASK 576 — the module-level registry behind `resetPdfTeXEngine(mode)`.
 *
 * A `keep-draining` reset discards the engine SINGLETON while its worker keeps
 * running, so the only thing that can later terminate that orphan is a record
 * kept here. These legs drive the REAL `@/lib/swiftlatex` over a fake engine
 * class installed on `window` (the same global the real script defines).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tex-assets", () => ({ provisionEngine: async () => {} }));

const instances: FakeEngine[] = [];
class FakeEngine {
  closes: string[] = [];
  drainTerminations = 0;
  constructor() {
    instances.push(this);
  }
  async loadEngine() {}
  setTexliveEndpoint() {}
  closeWorker(mode: string) {
    this.closes.push(mode);
  }
  terminateDrainingWorkers() {
    this.drainTerminations += 1;
  }
}

beforeEach(() => {
  instances.length = 0;
  (window as unknown as { PdfTeXEngine: unknown }).PdfTeXEngine = FakeEngine;
  vi.resetModules();
});
afterEach(() => {
  delete (window as unknown as { PdfTeXEngine?: unknown }).PdfTeXEngine;
});

describe("resetPdfTeXEngine(mode) + terminateDrainingWorkers", () => {
  it("a keep-draining reset is remembered and ended by terminateDrainingWorkers", async () => {
    const mod = await import("@/lib/swiftlatex");
    await mod.getPdfTeXEngine();
    await mod.resetPdfTeXEngine("keep-draining");
    expect(instances[0].closes).toEqual(["keep-draining"]);
    expect(instances[0].drainTerminations).toBe(0);
    mod.terminateDrainingWorkers();
    expect(instances[0].drainTerminations).toBe(1);
    // The registry is drained — a second call ends nothing new.
    mod.terminateDrainingWorkers();
    expect(instances[0].drainTerminations).toBe(1);
  });

  it("a terminate reset is not kept as a draining orphan", async () => {
    const mod = await import("@/lib/swiftlatex");
    await mod.getPdfTeXEngine();
    await mod.resetPdfTeXEngine("terminate");
    expect(instances[0].closes).toEqual(["terminate"]);
    mod.terminateDrainingWorkers();
    expect(instances[0].drainTerminations).toBe(0);
  });

  it("the next getPdfTeXEngine boots a fresh engine after either reset", async () => {
    const mod = await import("@/lib/swiftlatex");
    const a = await mod.getPdfTeXEngine();
    await mod.resetPdfTeXEngine("keep-draining");
    const b = await mod.getPdfTeXEngine();
    expect(b).not.toBe(a);
  });
});
