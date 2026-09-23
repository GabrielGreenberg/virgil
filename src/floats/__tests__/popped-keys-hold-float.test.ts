/**
 * TASK 730 — "is THIS block's float open?" is asked of the float store, once,
 * for every kind.
 *
 * Before this task the only asker was `texBlock`, through a predicate ref
 * threaded `EditorPane → Editor → buildEditorExtensions → the texBlock
 * extension options`. Every hop named one kind, so `forestBlock` — which wears
 * the same source pod, and whose `.is-popped` CSS rule was already generalized
 * to dim it — never got an answer: its docked pod stayed fully live beside its
 * float, two editors over one `source` attr.
 *
 * `poppedKeysHoldFloat` is the kind-agnostic replacement. These legs are all
 * planted in the falsifying direction — a same-kind/other-id and an
 * other-kind/same-id twin beside every positive — so a predicate that answered
 * "yes" broadly would fail rather than look correct.
 */
import { describe, it, expect } from "vitest";
import { buildFloatKey, poppedKeysHoldFloat } from "@/floats/float-key";

const UUID = "abc123";

describe("poppedKeysHoldFloat", () => {
  it("answers for texBlock AND forestBlock from the same key grammar", () => {
    for (const kind of ["texBlock", "forestBlock"]) {
      const keys = [buildFloatKey({ domain: "textobject", kind, id: UUID })];
      expect(poppedKeysHoldFloat(keys, kind, UUID)).toBe(true);
      // Falsifying twins: the key must match on BOTH halves.
      expect(poppedKeysHoldFloat(keys, kind, "other-uuid")).toBe(false);
      expect(poppedKeysHoldFloat(keys, "paragraph", UUID)).toBe(false);
    }
  });

  it("is dual-read: the canonical, pre-flip and pre-D10 spellings all answer alike", () => {
    const spellings = [
      `float:textobject:forestBlock:${UUID}`, // canonical
      `textobject:forestBlock:${UUID}`, // pre-flip
      `forestBlock:${UUID}`, // pre-D10 bare
    ];
    for (const key of spellings) {
      expect(poppedKeysHoldFloat([key], "forestBlock", UUID)).toBe(true);
    }
  });

  it("is false for an empty store, and for a missing kind or id", () => {
    const keys = [`float:textobject:texBlock:${UUID}`];
    expect(poppedKeysHoldFloat([], "texBlock", UUID)).toBe(false);
    expect(poppedKeysHoldFloat(keys, null, UUID)).toBe(false);
    expect(poppedKeysHoldFloat(keys, "texBlock", null)).toBe(false);
    expect(poppedKeysHoldFloat(keys, "texBlock", "")).toBe(false);
  });

  it("ignores unrelated floats sharing the store", () => {
    const keys = [
      "float:card:note:n1",
      `float:textobject:paragraph:${UUID}`,
      "float:textobject:texBlock:someone-else",
    ];
    expect(poppedKeysHoldFloat(keys, "texBlock", UUID)).toBe(false);
    expect(poppedKeysHoldFloat(keys, "paragraph", UUID)).toBe(true);
  });

  it("tolerates junk keys without throwing", () => {
    expect(
      poppedKeysHoldFloat(["", ":", "nocolon", `float:textobject:forestBlock:${UUID}`], "forestBlock", UUID),
    ).toBe(true);
  });
});
