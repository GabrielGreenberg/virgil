// @vitest-environment jsdom
/**
 * Task 741 — never offer a title the load path erases.
 *
 * The paragraph NodeView decides whether a paragraph gets its own chrome (the
 * `.par-title-wrapper`, its `+T` / title annotation). The load path decides
 * whether a paragraph KEEPS a title: `assignUuids` strips `uuid` AND
 * `parTitle` from every paragraph whose immediate parent is in
 * `DEFERRING_PARENTS`. The NodeView used to answer from a hand list
 * (listItem / exampleBlock / exampleItem) that omitted `blockquote` — so a
 * quoted paragraph offered `+T`, took the title, and the next load erased it.
 *
 * Pinned three ways: behaviour (a blockquote's paragraph renders no title
 * chrome; a top-level one still does), the load-path half (the same paragraph
 * through `assignUuids` loses its title — which is exactly why the editor must
 * not offer one), and a source census (the NodeView's skip reads
 * `DEFERRING_PARENTS`, and no hand-listed parent name survives beside it).
 *
 * `codeBlock` is in the set but hosts only text, never a paragraph, so it has
 * no behavioural leg — the census covers it by construction.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { REPO_ROOT, codeOnly } from "@/lib/__tests__/_source-scan";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { createParagraphWithTitle } from "@/lib/editor-extensions";
import { assignUuids } from "@/lib/latex-serializer";
import { DEFERRING_PARENTS } from "@/lib/node-attr-sets";

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.innerHTML = "";
});

const doc = (): JSONContent => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      attrs: { uuid: "p-top", parTitle: "Top title" },
      content: [{ type: "text", text: "Top" }],
    },
    {
      type: "blockquote",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "p-quoted", parTitle: "Quoted title" },
          content: [{ type: "text", text: "Quoted" }],
        },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Item" }] }],
        },
      ],
    },
  ],
});

function mount(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  editor = new Editor({
    element: el,
    extensions: [StarterKit.configure({ paragraph: false }), createParagraphWithTitle()],
    content: doc(),
  });
  return el;
}

describe("paragraph chrome defers exactly where the load path erases (task 741)", () => {
  it("a blockquote's paragraph renders no title chrome; a top-level one does", () => {
    const el = mount();
    const quote = el.querySelector("blockquote")!;
    expect(quote).toBeTruthy();
    expect(quote.querySelector(".par-title-wrapper")).toBeNull();
    expect(quote.querySelector(".par-title-annotation")).toBeNull();
    expect(quote.querySelector(":scope > p")?.textContent).toBe("Quoted");

    const li = el.querySelector("li")!;
    expect(li.querySelector(".par-title-annotation")).toBeNull();

    // The control: a top-level paragraph keeps its wrapper + annotation.
    const top = el.querySelector(".tiptap > .par-title-wrapper");
    expect(top).toBeTruthy();
    expect(top!.querySelector(".par-title-annotation")).toBeTruthy();
  });

  it("the load path erases a quoted paragraph's title — so the editor must not offer one", () => {
    const json = doc();
    assignUuids(json);
    const quoted = json.content![1].content![0];
    expect(quoted.attrs?.parTitle ?? null).toBeNull();
    const top = json.content![0];
    expect(top.attrs?.parTitle).toBe("Top title");
  });

  it("census: the NodeView's skip reads DEFERRING_PARENTS, no hand-listed parent survives", () => {
    const src = codeOnly(
      fs.readFileSync(path.join(REPO_ROOT, "src/lib/editor-extensions.ts"), "utf8"),
    );
    const start = src.indexOf("let skipChrome = false");
    expect(start).toBeGreaterThan(-1);
    const region = src.slice(start, src.indexOf("if (skipChrome)", start));
    expect(region).toContain("DEFERRING_PARENTS.has(name)");
    for (const parent of DEFERRING_PARENTS) {
      expect(region).not.toContain(`"${parent}"`);
    }
  });
});
