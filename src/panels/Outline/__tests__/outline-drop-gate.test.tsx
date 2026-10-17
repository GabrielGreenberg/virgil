// @vitest-environment jsdom
//
// Task 1166 — the Outline's edit-mode drop line lights only for drags it can
// land. A foreign drag (card, file, text selection) is not a drop target here:
// dragover does not preventDefault (no move cursor, no line) and the drop
// falls through rather than being swallowed. A pod with no durable uuid —
// which the commit cannot address — is not draggable at all.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, createEvent, fireEvent } from "@testing-library/react";

vi.mock("@/lib/storage", () => ({}));

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver;

import OutlinePanel from "../OutlinePanel";

afterEach(cleanup);

const CONTENT = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2, uuid: "aaaa" }, content: [{ type: "text", text: "One" }] },
    { type: "paragraph", attrs: { uuid: "bbbb" }, content: [{ type: "text", text: "Body." }] },
    { type: "heading", attrs: { level: 2, uuid: "cccc" }, content: [{ type: "text", text: "Two" }] },
    { type: "heading", attrs: { level: 2, uuid: null }, content: [{ type: "text", text: "Bare" }] },
  ],
};

function dataTransfer(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial };
  return {
    effectAllowed: "all",
    dropEffect: "none",
    get types() { return Object.keys(store); },
    setData(type: string, value: string) { store[type] = value; },
    getData(type: string) { return store[type] ?? ""; },
    setDragImage() {},
  };
}

function mountEditMode(onReorderBlocks = vi.fn()) {
  const utils = render(
    <OutlinePanel
      content={CONTENT}
      onScrollTo={() => {}}
      onReorderBlocks={onReorderBlocks}
      onRenameHeading={() => {}}
      onRenameParTitle={() => {}}
    />,
  );
  fireEvent.click(utils.container.querySelector('[data-hint="Edit mode"]') as HTMLElement);
  const rows = Array.from(utils.container.querySelectorAll<HTMLElement>(".cursor-grab[draggable]"));
  // Non-empty, or Edit mode never mounted and every assertion is vacuous.
  expect(rows.length).toBe(3);
  return { ...utils, rows, onReorderBlocks };
}

/** The drop-zone wrapper is the draggable row's parent. */
const zoneOf = (row: HTMLElement) => row.parentElement as HTMLElement;
const litLines = (c: HTMLElement) => c.querySelectorAll(".bg-\\[var\\(--accent\\)\\].h-\\[2px\\]").length;

describe("Outline drop gate (task 1166)", () => {
  it("a foreign drag is not a drop target: no preventDefault, no line, drop not swallowed", () => {
    const { container, rows, onReorderBlocks } = mountEditMode();
    const dt = dataTransfer({ "text/plain": "a selection" });
    const over = createEvent.dragOver(zoneOf(rows[1]), { dataTransfer: dt });
    fireEvent(zoneOf(rows[1]), over);
    expect(over.defaultPrevented).toBe(false);
    expect(litLines(container)).toBe(0);
    const drop = createEvent.drop(zoneOf(rows[1]), { dataTransfer: dt });
    fireEvent(zoneOf(rows[1]), drop);
    expect(drop.defaultPrevented).toBe(false);
    expect(onReorderBlocks).not.toHaveBeenCalled();
  });

  it("the panel's own pod drag is still a drop target and lands", () => {
    const { container, rows, onReorderBlocks } = mountEditMode();
    const dt = dataTransfer();
    fireEvent.dragStart(rows[1], { dataTransfer: dt });
    const over = createEvent.dragOver(zoneOf(rows[0]), { dataTransfer: dt, clientY: -1 });
    fireEvent(zoneOf(rows[0]), over);
    expect(over.defaultPrevented).toBe(true);
    expect(litLines(container)).toBe(1);
    const drop = createEvent.drop(zoneOf(rows[0]), { dataTransfer: dt });
    fireEvent(zoneOf(rows[0]), drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(onReorderBlocks).toHaveBeenCalledTimes(1);
  });

  it("a uuid-less pod is not draggable, and dropping onto it lights nothing", () => {
    const { container, rows, onReorderBlocks } = mountEditMode();
    expect(rows.map((r) => r.getAttribute("draggable"))).toEqual(["true", "true", "false"]);
    const dt = dataTransfer();
    fireEvent.dragStart(rows[0], { dataTransfer: dt });
    fireEvent.dragOver(zoneOf(rows[2]), { dataTransfer: dt, clientY: -1 });
    expect(litLines(container)).toBe(0);
    fireEvent.drop(zoneOf(rows[2]), { dataTransfer: dt });
    expect(onReorderBlocks).not.toHaveBeenCalled();
  });
});
