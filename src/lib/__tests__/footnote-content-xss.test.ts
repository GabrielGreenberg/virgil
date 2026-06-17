// @vitest-environment jsdom
//
// SECURITY pin (BIB-F5-01 sibling): footnote / note / card rich-text content
// that was persisted as a LEGACY HTML STRING is parsed by footnote-content.ts
// (`normalizeRichContent` → `htmlToJson`, and `richJsonToPlainText` →
// `htmlToPlain`). That string can arrive from an AI skill or a shared paper, so
// it is UNTRUSTED. The parse MUST use an INERT `DOMParser` document, never
// `div.innerHTML`: a detached div still carries a browsing context, so
// `<img src=x onerror=…>` fires its handler on the `innerHTML` assignment
// (verified in real Chromium — the same defect class as BIB-F5-01).
//
// jsdom does not simulate that transient resource-load, so these tests cannot
// observe the sink firing directly. Instead they pin the OUTPUT INVARIANT the
// public surfaces must always uphold — no `<img>` / `<script>` element and no
// event-handler markup survives into the JSON / plain-text projection — and
// guard the benign legacy formatting (bold, lists, citations) from regressing
// under the inert-parse swap. If anyone re-introduces an `innerHTML` sink or a
// passthrough that leaks raw tags into the output, these break.

import { describe, it, expect } from "vitest";
import type { JSONContent } from "@tiptap/react";
import {
  htmlToJson,
  normalizeRichContent,
  richJsonToPlainText,
} from "@/lib/footnote-content";

/** Recursively collect every text run in a JSONContent tree. */
function allText(node: JSONContent): string[] {
  const out: string[] = [];
  if (node.type === "text" && node.text) out.push(node.text);
  for (const child of node.content ?? []) out.push(...allText(child));
  return out;
}

/** Recursively collect every node `type` present in a JSONContent tree. */
function allTypes(node: JSONContent): string[] {
  const out: string[] = node.type ? [node.type] : [];
  for (const child of node.content ?? []) out.push(...allTypes(child));
  return out;
}

/** DFS for the first node of a given type. */
function findFirst(node: JSONContent, type: string): JSONContent | undefined {
  if (node.type === type) return node;
  for (const child of node.content ?? []) {
    const hit = findFirst(child, type);
    if (hit) return hit;
  }
  return undefined;
}

/** The whole-tree serialization carries no raw HTML tag for a dangerous element. */
function expectNoDangerousMarkup(json: JSONContent): void {
  const serialized = JSON.stringify(json);
  expect(serialized).not.toMatch(/<img/i);
  expect(serialized).not.toMatch(/<script/i);
  expect(serialized).not.toMatch(/<svg/i);
  expect(serialized).not.toMatch(/<iframe/i);
  expect(serialized).not.toMatch(/onerror/i);
  expect(serialized).not.toMatch(/onload/i);
  // No node type maps to a raw embedded element — only the lightweight grammar.
  expect(allTypes(json)).not.toContain("img");
}

describe("footnote-content — legacy HTML parse is XSS-safe (BIB-F5-01 sibling)", () => {
  it("htmlToJson drops a bare <img onerror> payload entirely", () => {
    const out = htmlToJson('<img src=x onerror="window.__pwned=1">');
    expectNoDangerousMarkup(out);
    // Nothing extractable → the empty-doc fallback (a single empty paragraph).
    expect(out).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });

  it("htmlToJson keeps surrounding prose but neutralizes a nested <img onerror>", () => {
    const out = htmlToJson('<p>safe<img src=x onerror="alert(1)">prose</p>');
    expectNoDangerousMarkup(out);
    expect(allText(out).join("")).toBe("safeprose");
  });

  it("htmlToJson surfaces no <script> element (and runs nothing)", () => {
    const out = htmlToJson("<p>before</p><script>window.__pwned=1</script>");
    expectNoDangerousMarkup(out);
    // Only the lightweight grammar's node types appear — never a raw element.
    expect(new Set(allTypes(out))).toEqual(new Set(["doc", "paragraph", "text"]));
    expect(allText(out)).toContain("before");
  });

  it("normalizeRichContent routes a legacy HTML string through the inert parse", () => {
    const out = normalizeRichContent('<p>note<img src=x onerror="document.title=1">body</p>');
    expectNoDangerousMarkup(out);
    expect(allText(out).join("")).toBe("notebody");
  });

  it("richJsonToPlainText (htmlToPlain path) yields text only, no markup", () => {
    const plain = richJsonToPlainText('safe<img src=x onerror="window.__pwned=1">text');
    expect(plain).toBe("safetext");
    expect(plain).not.toMatch(/<img/i);
    expect(plain).not.toMatch(/onerror/i);
  });
});

describe("footnote-content — benign legacy formatting survives the parse swap", () => {
  it("preserves paragraphs, marks, and lists", () => {
    const out = htmlToJson(
      "<p>Hello <strong>world</strong> and <em>more</em></p><ul><li>one</li><li>two</li></ul>",
    );

    expect(out.content?.[0].type).toBe("paragraph");
    const para = out.content![0];
    expect(allText(para)).toEqual(["Hello ", "world", " and ", "more"]);
    const bold = findFirst(para, "text");
    // "world" run carries the bold mark; "more" carries italic.
    const world = (para.content ?? []).find((n) => n.text === "world");
    const more = (para.content ?? []).find((n) => n.text === "more");
    expect(world?.marks?.map((m) => m.type)).toContain("bold");
    expect(more?.marks?.map((m) => m.type)).toContain("italic");
    expect(bold).toBeDefined();

    const list = out.content?.[1];
    expect(list?.type).toBe("bulletList");
    expect(list?.content).toHaveLength(2);
    expect(allText(list!)).toEqual(["one", "two"]);
  });

  it("preserves citation spans with their data-* attributes", () => {
    const out = htmlToJson(
      '<p>see <span data-type="citation" data-citation-id="c1" ' +
        'data-command="\\citep{foo}" data-display-text="(Foo)">(Foo)</span></p>',
    );
    const cite = findFirst(out, "citation");
    expect(cite).toBeDefined();
    expect(cite?.attrs?.citationId).toBe("c1");
    expect(cite?.attrs?.command).toBe("\\citep{foo}");
    expect(cite?.attrs?.displayText).toBe("(Foo)");
  });

  it("preserves inline-math spans", () => {
    const out = htmlToJson('<p>x <span data-type="inline-math" data-latex="a^2+b^2"></span></p>');
    const math = findFirst(out, "inlineMath");
    expect(math).toBeDefined();
    expect(math?.attrs?.latex).toBe("a^2+b^2");
  });
});
