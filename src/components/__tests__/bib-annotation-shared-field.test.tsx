// @vitest-environment jsdom
//
// Task 952 — the bibliography annotation is edited in the SHARED RichTextField,
// not a hand-rolled contentEditable + `document.execCommand` fork whose toolbar
// had drifted (no focus ring on 4 of 5 buttons, no small caps, no disabled
// state). Pins: (1) the fork is gone; (2) the toolbar the annotation shows is
// the shared one — every button carries `focus-ring`, small caps included;
// (3) the HTML⇄JSON storage bridge round-trips the toolbar's vocabulary and
// still reads legacy execCommand HTML and the skill's plain text.

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import type { JSONContent } from "@tiptap/react";
import BibEntryCard from "@/components/BibEntryCard";
import type { BibEntry } from "@/lib/types";
import { annotationHtmlToRich, richToAnnotationHtml } from "@/lib/annotation-html";
import { sanitizeAnnotationHtml } from "@/lib/sanitize-html";

afterEach(cleanup);

const entry = {
  uid: "u-952",
  key: "shared2024",
  type: "article",
  fields: { author: "A. Author", year: "2024", title: "T" },
  raw: "",
} as BibEntry;

function renderCard(annotation = "") {
  return render(
    <BibEntryCard
      entry={entry}
      isSelected
      onClick={() => {}}
      getAnnotation={() => annotation}
      setAnnotation={() => {}}
      onRequestReview={() => {}}
      onCancelReview={() => {}}
      getReviewStatus={() => "none"}
      onSaveBibEntry={() => {}}
    />,
  );
}

describe("annotation field is the shared RichTextField (task 952)", () => {
  it("BibEntryCard holds no contentEditable / execCommand fork", () => {
    const src = readFileSync(join(__dirname, "..", "BibEntryCard.tsx"), "utf8");
    // Code, not prose: the explanatory comment may name what was retired.
    expect(src).not.toMatch(/document\.execCommand\s*\(/);
    expect(src).not.toMatch(/^\s*contentEditable\b/m);
  });

  it("shows the shared toolbar on focus — every button has a focus ring, small caps included", () => {
    const { container } = renderCard("<p>hello</p>");
    fireEvent.click(screen.getByText("Annotations"));
    const dom = container.querySelector<HTMLElement>(".rtf-content");
    expect(dom).not.toBeNull();
    // Toolbar is hidden until the field takes focus.
    expect(container.querySelector('[data-hint="Bold"]')).toBeNull();
    fireEvent.focus(dom!);
    const bold = container.querySelector<HTMLElement>('[data-hint="Bold"]');
    expect(bold).not.toBeNull();
    const toolbar = bold!.parentElement!;
    const buttons = Array.from(toolbar.querySelectorAll("button"));
    expect(buttons.length).toBeGreaterThanOrEqual(6);
    for (const b of buttons) expect(b.className).toMatch(/\bfocus-ring\b/);
    expect(toolbar.querySelector('[data-hint="Small caps"]')).not.toBeNull();
  });
});

describe("annotation HTML bridge", () => {
  const doc: JSONContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "bold", marks: [{ type: "bold" }] },
          { type: "text", text: " " },
          { type: "text", text: "it", marks: [{ type: "italic" }] },
          { type: "text", text: " " },
          { type: "text", text: "un", marks: [{ type: "underline" }] },
          { type: "text", text: " " },
          { type: "text", text: "sc", marks: [{ type: "smallCaps" }] },
          { type: "hardBreak" },
          { type: "text", text: "a < b & c" },
        ],
      },
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "two" }] }] },
        ],
      },
    ],
  };

  it("round-trips the toolbar's vocabulary through the sanitized write seam", () => {
    const html = sanitizeAnnotationHtml(richToAnnotationHtml(doc));
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<span data-small-caps=\"\">sc</span>");
    expect(html).toContain("a &lt; b &amp; c");
    expect(annotationHtmlToRich(html)).toEqual(doc);
  });

  it("reads legacy execCommand HTML and the skill's plain text", () => {
    const legacy = annotationHtmlToRich("<b>x</b><div>y</div>");
    expect(JSON.stringify(legacy)).toContain('"bold"');
    expect(legacy.content).toHaveLength(2);
    expect(annotationHtmlToRich("A plain note.")).toEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "A plain note." }] }],
    });
  });

  it("an empty field serializes to '' (clears the annotation)", () => {
    expect(richToAnnotationHtml({ type: "doc", content: [{ type: "paragraph" }] })).toBe("");
  });

  it("writes an inline atom as its plain text", () => {
    const html = richToAnnotationHtml({
      type: "doc",
      content: [{
        type: "paragraph",
        content: [
          { type: "text", text: "see " },
          { type: "citation", attrs: { citationId: "c1", command: "\\cite{k}", displayText: "Kay 2001" } },
        ],
      }],
    });
    expect(html).toBe("<p>see Kay 2001</p>");
  });

  it("the sanitizer keeps only the valueless small-caps flag", () => {
    const out = sanitizeAnnotationHtml('<span data-small-caps="x" onclick="evil()" style="color:red">s</span>');
    expect(out).toBe('<span data-small-caps="">s</span>');
  });
});
