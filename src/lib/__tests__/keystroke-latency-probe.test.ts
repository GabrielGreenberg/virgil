// @vitest-environment jsdom
//
// Keystroke-latency probe unit test — drives the probe's internal state
// machine through its test hooks (the same code paths the real keydown
// listener + PerformanceObserver wiring drive), pinning:
//
//   1. the sub-threshold fill-in percentile math — Event Timing only delivers
//      entries ≥16 ms, so (keystrokes − samples) unmeasured keystrokes must
//      count as "≤16 ms" values at the LOW end of the distribution (otherwise
//      p50/p95 would be survivorship-biased toward the slow tail);
//   2. the work-attribution window (a fire ≤100 ms after an editor keydown is
//      attributed; later fires are lifetime-only);
//   3. reset semantics;
//   4. production no-op (recordKeystrokeWork records nothing).

import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  readKeystrokeStats,
  recordKeystrokeWork,
  __resetKeystrokeProbeForTest,
  __recordKeydownForTest,
  __recordEntryForTest,
  __ageLastKeydownForTest,
  KEYSTROKE_WORK_SCROLLBAR_RO,
  KEYSTROKE_WORK_INTEXT_RO,
} from "../keystroke-latency-probe";

beforeEach(() => {
  __resetKeystrokeProbeForTest();
});

describe("keystroke-latency probe — percentile math", () => {
  it("counts unmeasured keystrokes as ≤16 ms at the low end (no survivorship bias)", () => {
    // 10 keystrokes, only 2 slow enough for Event Timing to deliver.
    for (let i = 0; i < 10; i++) __recordKeydownForTest();
    __recordEntryForTest(40);
    __recordEntryForTest(20);

    const stats = readKeystrokeStats();
    expect(stats.keystrokes).toBe(10);
    expect(stats.samples).toBe(2);
    // Sorted union: [16×8, 20, 40]. p50 lands in the fill-in bucket.
    expect(stats.p50).toBe(16);
    // p95 → index 9 → the 40 ms outlier.
    expect(stats.p95).toBe(40);
    expect(stats.max).toBe(40);
    expect(stats.over16).toBe(2);
    expect(stats.over32).toBe(1);
  });

  it("is a plain percentile when every keystroke is measured (raf-fallback shape)", () => {
    for (let i = 0; i < 4; i++) __recordKeydownForTest();
    for (const d of [5, 10, 20, 30]) __recordEntryForTest(d);

    const stats = readKeystrokeStats();
    expect(stats.p50).toBe(10);
    expect(stats.p95).toBe(30);
    expect(stats.max).toBe(30);
    expect(stats.over16).toBe(2);
    expect(stats.over32).toBe(0);
  });

  it("returns zeros with no keystrokes", () => {
    const stats = readKeystrokeStats();
    expect(stats.keystrokes).toBe(0);
    expect(stats.samples).toBe(0);
    expect(stats.p50).toBe(0);
    expect(stats.p95).toBe(0);
    expect(stats.max).toBe(0);
  });
});

describe("keystroke-latency probe — work attribution", () => {
  it("attributes fires within the window to the current keystroke", () => {
    __recordKeydownForTest();
    recordKeystrokeWork(KEYSTROKE_WORK_SCROLLBAR_RO);
    recordKeystrokeWork(KEYSTROKE_WORK_SCROLLBAR_RO);

    const w = readKeystrokeStats().work[KEYSTROKE_WORK_SCROLLBAR_RO];
    expect(w.total).toBe(2);
    expect(w.lastKeystroke).toBe(2);
    expect(w.maxPerKeystroke).toBe(2);
  });

  it("does not attribute fires outside the 100 ms window (lifetime-only)", () => {
    __recordKeydownForTest();
    __ageLastKeydownForTest(150); // pretend the keydown was 150 ms ago
    recordKeystrokeWork(KEYSTROKE_WORK_INTEXT_RO);

    const w = readKeystrokeStats().work[KEYSTROKE_WORK_INTEXT_RO];
    expect(w.total).toBe(1);
    expect(w.lastKeystroke).toBe(0);
    expect(w.maxPerKeystroke).toBe(0);
  });

  it("starts a fresh per-keystroke count on the next keydown, keeping the max", () => {
    __recordKeydownForTest();
    recordKeystrokeWork(KEYSTROKE_WORK_SCROLLBAR_RO);
    recordKeystrokeWork(KEYSTROKE_WORK_SCROLLBAR_RO); // keystroke A: 2 fires

    __recordKeydownForTest();
    recordKeystrokeWork(KEYSTROKE_WORK_SCROLLBAR_RO); // keystroke B: 1 fire

    const w = readKeystrokeStats().work[KEYSTROKE_WORK_SCROLLBAR_RO];
    expect(w.total).toBe(3);
    expect(w.lastKeystroke).toBe(1);
    expect(w.maxPerKeystroke).toBe(2);
  });
});

describe("keystroke-latency probe — reset + production no-op", () => {
  it("reset clears counters, samples, and work stats", () => {
    __recordKeydownForTest();
    __recordEntryForTest(25);
    recordKeystrokeWork(KEYSTROKE_WORK_SCROLLBAR_RO);

    __resetKeystrokeProbeForTest();

    const stats = readKeystrokeStats();
    expect(stats.keystrokes).toBe(0);
    expect(stats.samples).toBe(0);
    expect(Object.keys(stats.work)).toHaveLength(0);
  });

  it("recordKeystrokeWork is a no-op in production", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    try {
      const prod = await import("../keystroke-latency-probe");
      prod.recordKeystrokeWork(KEYSTROKE_WORK_SCROLLBAR_RO);
      expect(
        Object.keys(prod.readKeystrokeStats().work),
      ).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
