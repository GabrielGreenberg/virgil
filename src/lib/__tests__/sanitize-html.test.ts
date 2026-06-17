// @vitest-environment jsdom
//
// SECURITY pin (BIB-F5-01): `sanitizeRichHtml` is the allowlist that protects
// Virgil's HTML-persisting rich-text surfaces (the bibliography annotation
// editor) from stored XSS. Untrusted annotation HTML — AI-written via
// answer-bib-review, or carried in a shared paper's annotations.json — must NOT
// survive as live, event-firing markup; only attribute-free formatting tags
// (b/i/u/lists/…) are kept.

import { describe, it, expect } from "vitest";
import { sanitizeRichHtml, sanitizeAnnotationHtml } from "../sanitize-html";

/** Re-parse the sanitized string into a tree so we can assert on live nodes. */
function parse(html: string): HTMLDivElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

describe("sanitizeRichHtml", () => {
  it("drops a <script> tag and its body", () => {
    const out = sanitizeRichHtml("a<script>window.__pwned=1</script>b");
    expect(out).not.toMatch(/<script/i);
    expect(parse(out).querySelector("script")).toBeNull();
    // Body of a script is dropped, not surfaced as text.
    expect(out).not.toContain("window.__pwned");
    expect(out).toContain("a");
    expect(out).toContain("b");
  });

  it("neutralizes an <img onerror> payload", () => {
    const out = sanitizeRichHtml('<img src=x onerror="window.__pwned=1">');
    expect(out).not.toMatch(/<img/i);
    expect(out).not.toMatch(/onerror/i);
    expect(parse(out).querySelector("img")).toBeNull();
  });

  it("neutralizes an <svg onload> payload", () => {
    const out = sanitizeRichHtml('<svg onload="window.__pwned=1"></svg>');
    expect(out).not.toMatch(/<svg/i);
    expect(out).not.toMatch(/onload/i);
    expect(parse(out).querySelector("svg")).toBeNull();
  });

  it("strips an <iframe>", () => {
    const out = sanitizeRichHtml('<iframe src="javascript:alert(1)"></iframe>');
    expect(out).not.toMatch(/<iframe/i);
    expect(parse(out).querySelector("iframe")).toBeNull();
  });

  it("removes an <a href=javascript:> but keeps its text", () => {
    const out = sanitizeRichHtml('<a href="javascript:alert(1)">click</a>');
    expect(out).not.toMatch(/<a[ >]/i);
    expect(out).not.toMatch(/javascript:/i);
    expect(out).toContain("click");
  });

  it("strips event-handler attributes from an otherwise-allowed tag", () => {
    const out = sanitizeRichHtml('<b onclick="window.__pwned=1">bold</b>');
    expect(out).not.toMatch(/onclick/i);
    expect(out).toBe("<b>bold</b>");
  });

  it("drops a payload nested inside an allowed tag", () => {
    const out = sanitizeRichHtml('<b>safe<img src=x onerror=alert(1)></b>');
    expect(out).not.toMatch(/<img/i);
    expect(parse(out).querySelector("img")).toBeNull();
    expect(out).toContain("safe");
    expect(out).toMatch(/^<b>/);
  });

  it("preserves the toolbar's formatting tags", () => {
    expect(sanitizeRichHtml("<b>x</b>")).toBe("<b>x</b>");
    expect(sanitizeRichHtml("<i>x</i>")).toBe("<i>x</i>");
    expect(sanitizeRichHtml("<u>x</u>")).toBe("<u>x</u>");
    expect(sanitizeRichHtml("<strong>x</strong>")).toBe("<strong>x</strong>");
    expect(sanitizeRichHtml("<em>x</em>")).toBe("<em>x</em>");
    const list = sanitizeRichHtml("<ul><li>one</li><li>two</li></ul>");
    expect(parse(list).querySelectorAll("li")).toHaveLength(2);
  });

  it("returns empty string for empty input", () => {
    expect(sanitizeRichHtml("")).toBe("");
    expect(sanitizeAnnotationHtml("")).toBe("");
  });

  it("escapes stray angle brackets in text as entities, not live tags", () => {
    const out = sanitizeRichHtml("a < b and 3 > 2");
    expect(parse(out).children).toHaveLength(0); // no element nodes parsed
  });
});
