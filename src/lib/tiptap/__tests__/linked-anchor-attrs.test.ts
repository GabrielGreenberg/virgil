import { describe, it, expect } from "vitest";
import { linkedAnchorRenderAttrs } from "@/lib/tiptap/linked-anchor-attrs";

describe("linkedAnchorRenderAttrs — transient (cardless) anchor", () => {
  it("a transient anchor emits NO data-link-card (the plain-grab handle)", () => {
    const attrs = linkedAnchorRenderAttrs({ anchorId: "abcd", kind: "transient" });
    expect("data-link-card" in attrs).toBe(false);
    // Still a real, resolvable anchor under the hood.
    expect(attrs["data-link-id"]).toBe("abcd");
    expect(attrs["data-link-kind"]).toBe("anchor");
    expect(attrs.class).toBe("linked-anchor");
  });

  it("a real card attached to a transient anchor wins — colour returns", () => {
    // The sentinel never sticks once a card exists: data-link-card reappears.
    const attrs = linkedAnchorRenderAttrs({
      anchorId: "abcd",
      kind: "transient",
      linkCard: "note:xyz",
    });
    expect(attrs["data-link-card"]).toBe("note:xyz");
  });
});

describe("linkedAnchorRenderAttrs — annotation kinds unchanged", () => {
  it("kind:'note' derives data-link-card 'note:' (green)", () => {
    expect(linkedAnchorRenderAttrs({ anchorId: "a", kind: "note" })["data-link-card"]).toBe("note:");
  });

  it("explicit linkCard is used verbatim", () => {
    expect(
      linkedAnchorRenderAttrs({ anchorId: "a", kind: "note", linkCard: "note:id1" })["data-link-card"],
    ).toBe("note:id1");
  });

  it("highlight / cut / revision→comment kind fallbacks are unchanged", () => {
    expect(linkedAnchorRenderAttrs({ kind: "highlight" })["data-link-card"]).toBe("highlight:");
    expect(linkedAnchorRenderAttrs({ kind: "cut" })["data-link-card"]).toBe("cut:");
    expect(linkedAnchorRenderAttrs({ kind: "revision" })["data-link-card"]).toBe("comment:");
  });

  // Regression: a mark re-stamped by the once-per-doc applyLinkedAnchors RESTORE
  // pass carries its legacy `kind` but an EMPTY `linkCard` (reanchorByText passes
  // no cardId), so the kind→token fallback is the ONLY thing that paints the
  // reload-restored span. These kinds previously fell through to an empty token
  // — their Mode-B tint silently vanished on reload. (todo: fa7b898/5257b1a;
  // cutter-*: already in the restore loop; report*: future-proofed.)
  it("todo / cutter-* / report* kinds derive their data-link-card token (reload tint)", () => {
    expect(linkedAnchorRenderAttrs({ kind: "todo" })["data-link-card"]).toBe("todo:");
    expect(linkedAnchorRenderAttrs({ kind: "cutter-comment" })["data-link-card"]).toBe("cutter-comment:");
    expect(linkedAnchorRenderAttrs({ kind: "cutter-suggestion" })["data-link-card"]).toBe("cutter-suggestion:");
    expect(linkedAnchorRenderAttrs({ kind: "report" })["data-link-card"]).toBe("report:");
    expect(linkedAnchorRenderAttrs({ kind: "report-request" })["data-link-card"]).toBe("report-request:");
  });

  it("default kind (note) and unrecognised kinds STILL emit data-link-card", () => {
    // Only the transient sentinel omits the attribute; an unrecognised kind
    // emits an empty data-link-card (amber fallback), as before.
    const note = linkedAnchorRenderAttrs({ anchorId: "a" }); // kind absent → not "note", no card
    expect("data-link-card" in note).toBe(true);
    expect(note["data-link-card"]).toBe("");
    const odd = linkedAnchorRenderAttrs({ anchorId: "a", kind: "whatever" });
    expect("data-link-card" in odd).toBe(true);
    expect(odd["data-link-card"]).toBe("");
  });

  it("data-link-id prefers linkId over the legacy anchorId", () => {
    expect(linkedAnchorRenderAttrs({ anchorId: "old", linkId: "new", kind: "note" })["data-link-id"]).toBe("new");
  });
});
