import { describe, it, expect } from "vitest";
import { CARD_REGISTRY, assertContentCoverage } from "../card-registry";
import { CARD_KINDS } from "../predicates";
import { cardHasContent } from "../has-content";
import type { CardKind } from "../types";

/**
 * T4 §3.1 content-facet coverage pin. The single registry-driven content model
 * is the SSOT for the destructive-delete confirm + the orphan-worthiness test;
 * NO kind may carry user content the confirm can't see. These tests pin:
 *
 *   • every kind declares a `content` descriptor (or an explicit null for the
 *     no-user-content kinds) — `assertContentCoverage` logs nothing;
 *   • a `null` descriptor is ONLY the tint/system kinds (highlight/bib/ai/error);
 *   • `cardHasContent` classifies every kind correctly, including the cases the
 *     old per-kind switch missed: report-with-title (REP-F7-01),
 *     citation-with-keys (CI-F7-01 / OMNI-F7-01), footnote-with-title (FN-A1-02),
 *     suggestion-with-only-AI-prefilled-fields (must NOT count).
 */

const NO_USER_CONTENT: ReadonlySet<CardKind> = new Set<CardKind>([
  "highlight",
  "bib",
  "ai",
  "error",
]);

describe("content-facet coverage (T4 §3.1)", () => {
  it("assertContentCoverage logs nothing at boot (every kind declared)", () => {
    const spy = console.error;
    const calls: unknown[][] = [];
    console.error = (...args: unknown[]) => calls.push(args);
    try {
      assertContentCoverage();
    } finally {
      console.error = spy;
    }
    expect(calls, calls.map((c) => String(c[0])).join("\n")).toHaveLength(0);
  });

  it("every kind declares a content descriptor (or an explicit null)", () => {
    for (const k of CARD_KINDS) {
      // `null` is a valid declaration; `undefined` (missing) is not.
      expect(CARD_REGISTRY[k].content !== undefined, `${k}: content undeclared`).toBe(true);
    }
  });

  it("only the tint/system kinds declare content=null", () => {
    for (const k of CARD_KINDS) {
      if (CARD_REGISTRY[k].content === null) {
        expect(NO_USER_CONTENT.has(k), `${k}: content=null but is a user-content kind`).toBe(true);
      }
    }
  });

  it("a non-null descriptor names at least one counted field", () => {
    for (const k of CARD_KINDS) {
      const c = CARD_REGISTRY[k].content;
      if (c === null) continue;
      const named = (c.bodyField ? 1 : 0) + c.textFields.length;
      expect(named, `${k}: empty content descriptor → always-no-confirm`).toBeGreaterThan(0);
    }
  });

  it("no field is BOTH counted and aiPrefilled (don't-count)", () => {
    for (const k of CARD_KINDS) {
      const c = CARD_REGISTRY[k].content;
      if (c === null) continue;
      const counted = new Set<string>([...(c.bodyField ? [c.bodyField] : []), ...c.textFields]);
      for (const f of c.aiPrefilledFields) {
        expect(counted.has(f), `${k}: "${f}" is both counted and aiPrefilled`).toBe(false);
      }
    }
  });
});

describe("cardHasContent — registry-driven walker classifies every kind", () => {
  const richBody = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
  };
  const emptyBody = { type: "doc", content: [{ type: "paragraph" }] };

  it("no-user-content kinds ALWAYS report false (delete without confirm)", () => {
    for (const k of NO_USER_CONTENT) {
      expect(cardHasContent(k, { anything: "x", title: "t", text: "y" })).toBe(false);
    }
  });

  it("REP-F7-01: a titled-but-empty-body report HAS content (must confirm)", () => {
    expect(cardHasContent("report", { title: "Methodology", text: "", content: emptyBody })).toBe(true);
    // and a fully-empty report does not
    expect(cardHasContent("report", { title: "", text: "", content: emptyBody })).toBe(false);
    // and an untitled report with a body does
    expect(cardHasContent("report", { title: "", text: "", content: richBody })).toBe(true);
  });

  it("CI-F7-01 / OMNI-F7-01: a citation WITH keys HAS content", () => {
    expect(cardHasContent("citation", { keys: ["smith2001"], command: "\\cite{smith2001}" })).toBe(true);
    // a keyless draft citation has no content
    expect(cardHasContent("citation", { keys: [], command: "" })).toBe(false);
  });

  it("FN-A1-02: a title-only footnote (empty body) HAS content", () => {
    expect(cardHasContent("footnote", { content: emptyBody, title: "Acknowledgement" })).toBe(true);
    // a footnote with a body and no title does too
    expect(cardHasContent("footnote", { content: richBody, title: "" })).toBe(true);
    // a truly empty footnote does not
    expect(cardHasContent("footnote", { content: emptyBody, title: "" })).toBe(false);
  });

  it("a suggestion with ONLY AI-prefilled fields does NOT count; user fields do", () => {
    // original_text/suggested_text are AI-prefilled → not user content
    expect(
      cardHasContent("revision-suggestion", {
        original_text: "old",
        suggested_text: "new",
        explanation: "",
        user_text: "",
      }),
    ).toBe(false);
    // the user-typed explanation/user_text DO count
    expect(
      cardHasContent("revision-suggestion", {
        original_text: "old",
        suggested_text: "new",
        explanation: "because",
        user_text: "",
      }),
    ).toBe(true);
    expect(
      cardHasContent("cutter-suggestion", {
        original_text: "old",
        suggested_text: "new",
        explanation: "",
        user_text: "keep this",
      }),
    ).toBe(true);
  });

  it("a note / archive counts body OR title; a todo counts its text line", () => {
    expect(cardHasContent("note", { content: emptyBody, title: "Idea" })).toBe(true);
    expect(cardHasContent("note", { content: emptyBody, title: "" })).toBe(false);
    expect(cardHasContent("archive", { content: richBody, title: "" })).toBe(true);
    expect(cardHasContent("todo", { text: "buy milk" })).toBe(true);
    expect(cardHasContent("todo", { text: "  " })).toBe(false);
  });
});
