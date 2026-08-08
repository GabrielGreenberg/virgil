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
 *   • a `null` descriptor is ONLY the tint/system kinds (highlight/bib/error);
 *   • `cardHasContent` classifies every kind correctly, including the cases the
 *     old per-kind switch missed: report-with-title (REP-F7-01),
 *     citation-with-keys (CI-F7-01 / OMNI-F7-01), footnote-with-title (FN-A1-02),
 *     an untouched AI suggestion (must NOT count) vs. a human suggestion typed
 *     only into `suggested_text` (must count — task 241).
 */

const NO_USER_CONTENT: ReadonlySet<CardKind> = new Set<CardKind>([
  "highlight",
  "bib",
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

  it("no field carries two verdicts (counted / aiPrefilled / authorConditional)", () => {
    // Checked pairwise across ALL the lists, not just counted-vs-aiPrefilled:
    // the author-conditional axis (task 241) is a third mutually-exclusive
    // verdict, and a field on two lists is a contradiction the walker resolves
    // by accident of ordering.
    for (const k of CARD_KINDS) {
      const c = CARD_REGISTRY[k].content;
      if (c === null) continue;
      const lists: ReadonlyArray<readonly [string, readonly string[]]> = [
        ["counted", [...(c.bodyField ? [c.bodyField] : []), ...c.textFields]],
        ["aiPrefilled", c.aiPrefilledFields],
        ["authorConditional", c.authorConditionalFields],
      ];
      const seen = new Map<string, string>();
      for (const [name, fields] of lists) {
        for (const f of fields) {
          expect(
            seen.get(f),
            `${k}: "${f}" is both ${seen.get(f)} and ${name}`,
          ).toBeUndefined();
          seen.set(f, name);
        }
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

  it("task 241: an UNTOUCHED AI suggestion does NOT count; user fields do", () => {
    // Re-ratified with the author made EXPLICIT. The original case asserted
    // "original_text + suggested_text = no content" with no `author` on the
    // fixture, which silently encoded the AI reading of a record shape both
    // authors share — the premise behind the 241 bug. On an AI card that's
    // still right (nothing here is user-typed; the card renders no editable
    // grid), so dismissing it stays nag-free.
    expect(
      cardHasContent("revision-suggestion", {
        author: "ai",
        original_text: "old",
        suggested_text: "new",
        explanation: "",
        user_text: "",
      }),
    ).toBe(false);
    // the user-typed explanation/user_text DO count, on either authorship
    expect(
      cardHasContent("revision-suggestion", {
        author: "ai",
        original_text: "old",
        suggested_text: "new",
        explanation: "because",
        user_text: "",
      }),
    ).toBe(true);
    expect(
      cardHasContent("cutter-suggestion", {
        author: "human",
        original_text: "old",
        suggested_text: "new",
        explanation: "",
        user_text: "keep this",
      }),
    ).toBe(true);
  });

  it("task 241: a HUMAN suggestion typed only into `suggested_text` HAS content", () => {
    // The 067-class hole, one field over: `suggested_text` is a live textarea on
    // the human composition grid AND the apply path's replacement
    // (`user_text || suggested_text`), so a human draft carrying only that field
    // must confirm before delete. The derived guard lives in
    // `suggestion-content-model.test.ts`; this is the behavioral pin.
    for (const k of ["revision-suggestion", "cutter-suggestion"] as const) {
      expect(
        cardHasContent(k, {
          author: "human",
          original_text: "old",
          suggested_text: "cut this",
          explanation: "",
          user_text: "",
        }),
      ).toBe(true);
      // …and the same record read as AI-authored does not (prefill, not typing).
      expect(
        cardHasContent(k, {
          author: "ai",
          original_text: "old",
          suggested_text: "cut this",
          explanation: "",
          user_text: "",
        }),
      ).toBe(false);
    }
  });

  it("a note / archive counts body OR title; a todo counts its text line", () => {
    expect(cardHasContent("note", { content: emptyBody, title: "Idea" })).toBe(true);
    expect(cardHasContent("note", { content: emptyBody, title: "" })).toBe(false);
    expect(cardHasContent("archive", { content: richBody, title: "" })).toBe(true);
    expect(cardHasContent("todo", { text: "buy milk" })).toBe(true);
    expect(cardHasContent("todo", { text: "  " })).toBe(false);
  });

  it("task 067: a todo counts its `notes` field too (notes-only todo HAS content)", () => {
    // Facet 1 — the descriptor omitted `notes`, so a title-cleared, notes-only
    // todo (reachable: `text` is clearable, `notes` independently editable)
    // read as empty and deleted with NO confirm → silent data loss.
    expect(cardHasContent("todo", { text: "", notes: "kept" })).toBe(true);
    // a title AND notes still counts
    expect(cardHasContent("todo", { text: "task", notes: "detail" })).toBe(true);
    // a genuinely pristine todo (blank text + notes) stays no-content → the
    // pristine-skip contract (useTodos.ts) is preserved: it deletes silently.
    expect(cardHasContent("todo", { text: "", notes: "" })).toBe(false);
    expect(cardHasContent("todo", { text: "  ", notes: "  " })).toBe(false);
  });

  it("task 067: the `todo` descriptor names BOTH user-typed fields", () => {
    // Regression pin — the confirm SSOT must see every user field on the record
    // (§T4 3.1). Guards against a future edit dropping `notes` back out.
    const c = CARD_REGISTRY.todo.content;
    expect(c).not.toBeNull();
    expect(new Set(c!.textFields)).toEqual(new Set(["text", "notes"]));
  });
});
