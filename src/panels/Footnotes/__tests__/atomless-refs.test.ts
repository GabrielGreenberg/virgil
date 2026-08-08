/**
 * Task 233 — "a live marker wins unconditionally," applied to the Footnotes
 * panel's atomless-ref list.
 *
 * The Footnotes panel is the one panel whose anchored and atomless cards come
 * from different sources: anchored from the live editor (`getFootnotes()`),
 * atomless from `footnotes.json`. So a sidecar flag that outlives its atom
 * doesn't mislabel a card — it renders the SAME footnote twice, live in the
 * prose and again as a parked duplicate. `resolveAnchorState` already states the
 * rule for every other surface; this selector is where the footnote panel obeys
 * it.
 */

import { describe, expect, it } from "vitest";
import type { FootnoteRef } from "@/lib/types";
import { selectAtomlessFootnoteRefs } from "../atomless-refs";

const ref = (id: string, extra: Partial<FootnoteRef> = {}): FootnoteRef => ({
  id,
  content: { type: "doc", content: [{ type: "paragraph" }] },
  createdAt: "2026-01-01T00:00:00.000Z",
  ...extra,
});

describe("selectAtomlessFootnoteRefs", () => {
  it("keeps a parked ref that has no live atom", () => {
    const refs = [ref("fn-parked", { unanchored: true }), ref("fn-live")];
    expect(selectAtomlessFootnoteRefs(refs, []).map((f) => f.id)).toEqual([
      "fn-parked",
    ]);
  });

  it("DROPS a ref whose atom is live, even while the sidecar still says unanchored", () => {
    // The task-233 shape: the drop anchored the footnote, so the panel already
    // renders it from `footnoteInfos`. Listing it again is the stale duplicate.
    const refs = [ref("fn-1", { unanchored: true })];
    expect(selectAtomlessFootnoteRefs(refs, [{ footnoteId: "fn-1" }])).toEqual([]);
  });

  it("DROPS a ref whose atom is live even while it still says archived", () => {
    // Undo of an archive restores the atom without rewriting the sidecar. The
    // footnote is in the prose; it is not set aside, whatever the flag claims.
    const refs = [ref("fn-1", { archived: true, unanchored: true })];
    expect(selectAtomlessFootnoteRefs(refs, [{ footnoteId: "fn-1" }])).toEqual([]);
  });

  it("ignores refs carrying no parked intent at all (a plain anchored ref)", () => {
    expect(selectAtomlessFootnoteRefs([ref("fn-1")], [])).toEqual([]);
  });

  it("preserves order and passes non-matching live atoms through", () => {
    const refs = [
      ref("a", { archived: true }),
      ref("b", { unanchored: true }),
      ref("c", { unanchored: true }),
    ];
    const out = selectAtomlessFootnoteRefs(refs, [
      { footnoteId: "b" },
      { footnoteId: "zzz" },
    ]);
    expect(out.map((f) => f.id)).toEqual(["a", "c"]);
  });
});
