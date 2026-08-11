// @vitest-environment jsdom
//
// Wave-3 T1 — renderBorrowedHtml: the static-HTML render SSOT for collapsed
// borrowed card bodies. Pins the three contracts the tier system leans on:
//
//  1. FIDELITY — the HTML comes from generateHTML over the SAME extension
//     list the live BorrowedMainText mounts (buildCardBodySchema at the
//     scope), so every borrowed atom serializes with its data-type marker,
//     citations carry the RESOLVED display text (the refreshCitationDisplay
//     walk, factored here from BorrowedMainText), and math atoms carry
//     their `latex` attribute for the one-shot KaTeX pass.
//  2. NORMALIZATION — legacy string bodies route through
//     normalizeRichContent exactly like the live path.
//  3. REFUSAL — a body the scope's schema cannot represent returns null
//     (never a blank): generateHTML throws on unknown types and the task-308
//     lesson is that a swallowed mismatch becomes silent content loss. The
//     scope fork is part of this: a heading is legal in "excerpt" and
//     refused in "card".

import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/storage", () => ({
  isDevStorage: false,
  readTex: vi.fn(() => Promise.resolve("")),
}));

import { renderBorrowedHtml, refreshCitationDisplay } from "@/lib/borrowed-render";

const doc = (...content: object[]) => ({ type: "doc", content });
const para = (...content: object[]) => ({ type: "paragraph", content });
const text = (t: string) => ({ type: "text", text: t });

describe("renderBorrowedHtml — fidelity", () => {
  it("renders prose + inline atoms with their data-type markers", () => {
    const html = renderBorrowedHtml(
      doc(
        para(
          text("See "),
          {
            type: "citation",
            attrs: { citationId: "c1", command: "\\cite{abusch2014}", displayText: "" },
          },
          text(" and "),
          { type: "inlineMath", attrs: { latex: "x^2" } },
        ),
      ),
      "card",
      (cmd) => (cmd.includes("abusch") ? "Abusch 2014" : ""),
    );
    expect(html).not.toBeNull();
    expect(html!).toContain('data-type="citation"');
    // The citation resolver rewrote the persisted empty displayText.
    expect(html!).toContain("Abusch 2014");
    expect(html!).toContain('data-type="inline-math"');
    // The latex attr rides through (the StaticBorrowedText KaTeX pass reads it).
    expect(html!).toContain('latex="x^2"');
    expect(html!).toContain("See ");
  });

  it("falls back to the raw command when the resolver answers empty", () => {
    const walked = refreshCitationDisplay(
      doc(para({ type: "citation", attrs: { command: "\\cite{x}", displayText: "" } })) as never,
      () => "",
    );
    const cite = (walked as { content: { content: { attrs: { displayText: string } }[] }[] })
      .content[0].content[0];
    expect(cite.attrs.displayText).toBe("\\cite{x}");
  });

  it("normalizes a legacy plain-string body like the live path", () => {
    const html = renderBorrowedHtml("just a string body", "card");
    expect(html).not.toBeNull();
    expect(html!).toContain("just a string body");
  });
});

describe("renderBorrowedHtml — refusal (task-308 discipline)", () => {
  it("returns null for a node the scope cannot represent, instead of a blank", () => {
    const html = renderBorrowedHtml(
      doc({ type: "definitelyNotANode", content: [] }),
      "card",
    );
    expect(html).toBeNull();
  });

  it("scope fork: a heading is legal in excerpt scope and refused in card scope", () => {
    const headed = doc({
      type: "heading",
      attrs: { level: 2 },
      content: [text("A section")],
    });
    expect(renderBorrowedHtml(headed, "excerpt")).toContain("A section");
    expect(renderBorrowedHtml(headed, "card")).toBeNull();
  });
});
