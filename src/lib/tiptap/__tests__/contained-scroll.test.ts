// @vitest-environment jsdom
/**
 * Task 1424 — `scrollWithinOwnBox`: a nested editor's paste / typing scroll
 * moves ONLY its own box (the capped card body), never the document row.
 *
 * jsdom has no layout, so rects are stubbed and the scroll boxes declare
 * `overflow-y` inline; the assertions are on the scrollTops the handler
 * writes and on its `true` return (which is what stops ProseMirror's own
 * ancestor walk — `scrollRectIntoView` — from running at all).
 */
import { afterEach, describe, expect, it } from "vitest";
import type { EditorView } from "@tiptap/pm/view";
import { ownScrollBox, scrollWithinOwnBox } from "../contained-scroll";

function rect(top: number, bottom: number): DOMRect {
  return { top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top, toJSON() {} } as DOMRect;
}

/** row scroller > card body (scroll box, 0..200 on screen) > editor dom. */
function mount(opts: { bodyScrolls: boolean }) {
  const row = document.createElement("div");
  row.setAttribute("data-virgil-row-scroll", "");
  row.style.overflowY = "auto";
  const body = document.createElement("div");
  if (opts.bodyScrolls) body.style.overflowY = "auto";
  body.getBoundingClientRect = () => rect(0, 200);
  const dom = document.createElement("div");
  body.appendChild(dom);
  row.appendChild(body);
  document.body.appendChild(row);
  row.scrollTop = 500;
  return { row, body, dom };
}

function fakeView(dom: HTMLElement, caretTop: number): EditorView {
  return {
    dom,
    state: { selection: { head: 1 } },
    coordsAtPos: () => ({ top: caretTop, bottom: caretTop + 16, left: 0, right: 0 }),
  } as unknown as EditorView;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("scrollWithinOwnBox (task 1424)", () => {
  it("paste at the end of a long body scrolls the body, not the document row", () => {
    const { row, body, dom } = mount({ bodyScrolls: true });
    body.scrollTop = 0;
    // caret 400px down — below the body's 200px visible box
    expect(scrollWithinOwnBox(fakeView(dom, 400))).toBe(true);
    expect(body.scrollTop).toBe(400 + 16 - (200 - 8));
    expect(row.scrollTop).toBe(500);
  });

  it("typing above the box scrolls the body up", () => {
    const { row, body, dom } = mount({ bodyScrolls: true });
    body.scrollTop = 300;
    expect(scrollWithinOwnBox(fakeView(dom, -50))).toBe(true);
    expect(body.scrollTop).toBe(300 - (8 + 50));
    expect(row.scrollTop).toBe(500);
  });

  it("a caret already visible scrolls nothing", () => {
    const { row, body, dom } = mount({ bodyScrolls: true });
    body.scrollTop = 40;
    expect(scrollWithinOwnBox(fakeView(dom, 100))).toBe(true);
    expect(body.scrollTop).toBe(40);
    expect(row.scrollTop).toBe(500);
  });

  it("with no scroll box of its own below the row, nothing scrolls — and PM is still stopped", () => {
    const { row, dom } = mount({ bodyScrolls: false });
    expect(ownScrollBox(dom)).toBeNull();
    expect(scrollWithinOwnBox(fakeView(dom, 4000))).toBe(true);
    expect(row.scrollTop).toBe(500);
  });
});
