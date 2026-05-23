/**
 * Drop-spec matrix tests — exercise the source-kind × target-context
 * combinations through the registry's `dropAdapter` field. Companion to
 * `drop-adapters.test.ts` (which tests the adapter functions directly);
 * this file tests via the registry as a sanity check that adapters are
 * wired correctly for each kind.
 *
 * Deferred from D6 — registered here as part of G's verification work.
 */

import { describe, expect, it } from "vitest";
import { TEXT_OBJECT_REGISTRY } from "../text-object-registry";
import type {
  DropAction,
  DropTarget,
  TextObjectKind,
  TextObjectSourceContext,
} from "../types";

function adapt(
  kind: TextObjectKind,
  sourceContext: TextObjectSourceContext,
  target: DropTarget,
): DropAction {
  return TEXT_OBJECT_REGISTRY[kind].dropAdapter(
    { kind, id: "test", sourceContext },
    target,
  );
}

describe("drop-spec matrix (via TEXT_OBJECT_REGISTRY.dropAdapter)", () => {
  describe("listItem", () => {
    it("at top-level wraps in bulletList per sourceContext.parentKind", () => {
      const r = adapt(
        "listItem",
        { parentKind: "bulletList" },
        { kind: "top-level" },
      );
      expect(r).toEqual({ kind: "wrap", parentKind: "bulletList" });
    });

    it("at top-level wraps in orderedList per sourceContext.parentKind", () => {
      const r = adapt(
        "listItem",
        { parentKind: "orderedList" },
        { kind: "top-level" },
      );
      expect(r).toEqual({ kind: "wrap", parentKind: "orderedList" });
    });

    it("at top-level falls back to bulletList when no parentKind context", () => {
      const r = adapt("listItem", {}, { kind: "top-level" });
      expect(r).toEqual({ kind: "wrap", parentKind: "bulletList" });
    });

    it("inside a compatible parent drops directly", () => {
      const r = adapt(
        "listItem",
        { parentKind: "bulletList" },
        { kind: "inside-compatible-parent", parentKind: "bulletList" },
      );
      expect(r).toEqual({ kind: "drop-direct" });
    });

    it("inside an incompatible parent wraps in the source's parent kind", () => {
      const r = adapt(
        "listItem",
        { parentKind: "orderedList" },
        { kind: "inside-incompatible-parent", parentKind: "blockquote" },
      );
      expect(r).toEqual({ kind: "wrap", parentKind: "orderedList" });
    });
  });

  describe("exampleItem", () => {
    it("at top-level wraps in exampleBlock", () => {
      const r = adapt("exampleItem", { parentKind: "exampleBlock" }, { kind: "top-level" });
      expect(r).toEqual({ kind: "wrap", parentKind: "exampleBlock" });
    });

    it("inside exampleBlock drops directly", () => {
      const r = adapt(
        "exampleItem",
        { parentKind: "exampleBlock" },
        { kind: "inside-compatible-parent", parentKind: "exampleBlock" },
      );
      expect(r).toEqual({ kind: "drop-direct" });
    });

    it("inside an incompatible parent wraps in exampleBlock", () => {
      const r = adapt(
        "exampleItem",
        { parentKind: "exampleBlock" },
        { kind: "inside-incompatible-parent", parentKind: "blockquote" },
      );
      expect(r).toEqual({ kind: "wrap", parentKind: "exampleBlock" });
    });
  });

  describe("top-level kinds (drop-direct everywhere)", () => {
    const topLevel: TextObjectKind[] = [
      "paragraph",
      "heading",
      "bulletList",
      "orderedList",
      "blockquote",
      "codeBlock",
      "displayMath",
      "titleField",
      "latexComment",
      "texBlock",
      "figureBlock",
      "graphicsBlock",
      "exampleBlock",
      "linkedRange",
    ];

    for (const kind of topLevel) {
      it(`${kind} at top-level drops directly`, () => {
        expect(adapt(kind, {}, { kind: "top-level" })).toEqual({
          kind: "drop-direct",
        });
      });
    }
  });

  describe("collectMoveSource hook", () => {
    it("only heading declares one (the section-range collector)", () => {
      // The only kind that overrides collectMoveSource today is heading,
      // because moving a section moves the heading + everything beneath
      // it down to the next equal-or-higher heading. Every other kind
      // moves as a single node and uses the default.
      const withCollector = Object.entries(TEXT_OBJECT_REGISTRY)
        .filter(([, meta]) => meta.collectMoveSource != null)
        .map(([k]) => k);
      expect(withCollector).toEqual(["heading"]);
    });
  });
});
