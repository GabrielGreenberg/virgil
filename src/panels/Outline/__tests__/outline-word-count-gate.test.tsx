// @vitest-environment jsdom
//
// Task 1479 — a HIDDEN Outline word count costs nothing. The per-block tally
// walk used to run in render on every content change (every Tier A publish,
// 300 ms into a typing pause) even with counts off or in edit mode, because
// only `perSectionCounts` gated on visibility while the `perBlockCounts` memo
// it reads had already paid the walk.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

vi.mock("@/lib/storage", () => ({}));

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;

import OutlinePanel from "../OutlinePanel";
import { setOutlinePrefs } from "../outline-prefs-store";
import { getBlockTallyCacheStats } from "@/lib/word-count-core";

const content = (text: string) => ({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2, uuid: "aaaa" }, content: [{ type: "text", text: "One" }] },
    { type: "paragraph", attrs: { uuid: "bbbb" }, content: [{ type: "text", text }] },
  ],
});

const PREFS = { showLabels: true, showTitles: false, showPosition: false, showNumbers: true };

beforeEach(() => setOutlinePrefs({ ...PREFS, showWordCount: false }));
afterEach(() => cleanup());

const calls = () => {
  const s = getBlockTallyCacheStats();
  return s.hits + s.misses;
};

describe("Outline per-block counts are gated on visibility (task 1479)", () => {
  it("with showWordCount=false, mounting and content changes never count a block", () => {
    const before = calls();
    const { rerender } = render(<OutlinePanel content={content("Body text.")} onScrollTo={() => {}} />);
    rerender(<OutlinePanel content={content("Body text changed.")} onScrollTo={() => {}} />);
    expect(calls()).toBe(before);
  });

  it("with showWordCount=true, a content change recounts only the changed block", () => {
    setOutlinePrefs({ ...PREFS, showWordCount: true });
    const first = content("Body text.");
    const { rerender } = render(<OutlinePanel content={first} onScrollTo={() => {}} />);
    const s0 = getBlockTallyCacheStats();
    // Same heading object, new paragraph object — the pipeline's identity shape.
    const next = { type: "doc", content: [first.content[0], content("Changed.").content[1]] };
    rerender(<OutlinePanel content={next} onScrollTo={() => {}} />);
    const s1 = getBlockTallyCacheStats();
    expect(s1.misses - s0.misses).toBe(1);
    expect(s1.hits - s0.hits).toBe(1);
  });
});
