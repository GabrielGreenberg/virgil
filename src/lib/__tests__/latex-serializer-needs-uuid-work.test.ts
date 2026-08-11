// @vitest-environment node
/**
 * needsUuidWork ⇔ assignUuids-would-mutate (perf Wave 1 / S3).
 *
 * The save path skips the four assignUuids mutation walks — and safely
 * receives the DocProducts pipeline's SHARED docJson — exactly when this
 * read-only twin says no work exists. Drift between predicate and mutator
 * silently re-opens either wasted walks (false positive) or a mutated
 * shared cache (false negative), so the equivalence is pinned as a
 * property: for every fixture, needsUuidWork(doc) === (assignUuids changes
 * the serialized JSON).
 */
import { describe, it, expect } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { assignUuids, needsUuidWork } from "@/lib/latex-serializer";
import { parseLatex } from "@/lib/latex-parser";

function mutatesUnderAssign(doc: JSONContent): boolean {
  const copy = JSON.parse(JSON.stringify(doc)) as JSONContent;
  const before = JSON.stringify(copy);
  assignUuids(copy);
  return JSON.stringify(copy) !== before;
}

function check(name: string, doc: JSONContent) {
  const predicted = needsUuidWork(doc);
  const actual = mutatesUnderAssign(doc);
  expect(predicted, `${name}: predicate=${predicted} but mutation=${actual}`).toBe(
    actual,
  );
}

const p = (text: string, uuid?: string): JSONContent => ({
  type: "paragraph",
  ...(uuid ? { attrs: { uuid } } : {}),
  content: [{ type: "text", text }],
});

describe("needsUuidWork ⇔ assignUuids mutation", () => {
  it("fully-backfilled docs need no work (the steady state)", () => {
    // Parse a real doc then run assignUuids once — the result must be a
    // fixed point the predicate recognizes.
    const doc = parseLatex(
      "\\documentclass{article}\n\\begin{document}\n\nHello there.\n\n\\section{One}\n\n\\begin{itemize}\n  \\item a\n  \\item b\n\\end{itemize}\n\n\\end{document}\n",
    );
    assignUuids(doc);
    check("backfilled parse", doc);
    expect(needsUuidWork(doc)).toBe(false);
  });

  it("each mutation trigger is detected", () => {
    // Missing paragraph uuid.
    check("missing uuid", { type: "doc", content: [p("hello")] });
    // Duplicate uuids.
    check("dup uuids", {
      type: "doc",
      content: [p("a", "1111"), p("b", "1111")],
    });
    // Empty paragraph needs none.
    check("empty para", {
      type: "doc",
      content: [{ type: "paragraph", attrs: {} }],
    });
    // Container without uuid.
    check("list no uuid", {
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            { type: "listItem", attrs: { uuid: "aaaa" }, content: [p("x")] },
          ],
        },
      ],
    });
    // Inner-container paragraph WITH a uuid (assignUuids clears it).
    check("inner para uuid", {
      type: "doc",
      content: [
        {
          type: "bulletList",
          attrs: { uuid: "bbbb" },
          content: [
            {
              type: "listItem",
              attrs: { uuid: "cccc" },
              content: [p("x", "dddd")],
            },
          ],
        },
      ],
    });
    // maketitleMarker without uuid (the Wave-0 addition).
    check("maketitle", {
      type: "doc",
      content: [{ type: "maketitleMarker", attrs: {} }, p("t", "eeee")],
    });
    // Citation with missing / duplicate citationId.
    check("cite missing id", {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "ffff" },
          content: [
            { type: "text", text: "see " },
            { type: "citation", attrs: { command: "\\cite{k}", citationId: "" } },
          ],
        },
      ],
    });
    check("footnote dup id", {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "abab" },
          content: [
            { type: "footnote", attrs: { footnoteId: "f001", content: "x" } },
            { type: "footnote", attrs: { footnoteId: "f001", content: "y" } },
          ],
        },
      ],
    });
  });

  it("clean synthetic doc round-trips as a no-work fixed point", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [p("alpha", "1a1a"), p("beta", "2b2b")],
    };
    expect(needsUuidWork(doc)).toBe(false);
    check("clean synthetic", doc);
  });
});
