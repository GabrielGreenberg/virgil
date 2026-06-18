// EX-F8-02 — position-mapped caret restore across a `setContent` re-seed.
//
// The embedded / float editors re-seed from the live main doc with
// `setContent`, then restore the caret. The OLD restore re-applied the raw
// numeric {from,to} clamped to the new doc — correct only when the foreign
// edit landed AT or AFTER the caret. `mapPosThroughReseed` instead diffs the
// old doc against the incoming doc and maps the caret through the single edited
// region, so an upstream insertion shifts the caret with its logical text.
//
// Pure node-env test — hand-rolls a minimal PM schema, no editor / extension
// barrel (the linked-anchor-range suite uses the same pattern).

import { describe, expect, it } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { mapPosThroughReseed } from "@/lib/reseed-caret";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      toDOM: () => ["p", 0],
      parseDOM: [{ tag: "p" }],
    },
    text: { group: "inline" },
  },
});

function docOf(text: string) {
  return schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(null, text ? [schema.text(text)] : []),
  ]);
}

describe("mapPosThroughReseed (EX-F8-02 position mapping)", () => {
  // Position space: doc pos 0 is inside the doc before the paragraph; the
  // paragraph opens at 0 (content coord) so its text starts at pos 1, i.e.
  // for "Alpha body." the char "A"=1 … and a caret "after Alp" sits at pos 4.

  it("shifts the caret forward when a foreign edit inserts BEFORE it (the bug)", () => {
    // "Alpha body." → "XXAlpha body." (insert 2 chars at the very start).
    const oldDoc = docOf("Alpha body.");
    const newDoc = docOf("XXAlpha body.");
    // Caret parked after "Alp" (pos 4). A RAW restore would leave it at 4,
    // now pointing into the inserted "XX…Al" region (WRONG). The mapped
    // restore moves it to 4 + 2 = 6 so it still follows "Alp".
    expect(mapPosThroughReseed(oldDoc, newDoc, 4, -1)).toBe(6);
  });

  it("leaves the caret unchanged when a foreign edit inserts AFTER it", () => {
    // "Alpha body." → "Alpha body.Q" (insert at the end — downstream of caret).
    const oldDoc = docOf("Alpha body.");
    const newDoc = docOf("Alpha body.Q");
    // Caret after "Alp" (pos 4) is upstream of the edit → unchanged. (This is
    // the one case the old raw restore already got right.)
    expect(mapPosThroughReseed(oldDoc, newDoc, 4, -1)).toBe(4);
  });

  it("keeps a collapsed caret in place for an insertion EXACTLY at the caret (foreign, bias -1)", () => {
    // "Alpbody" → "Alp NEW body" — insert " NEW " exactly at pos 4 (after Alp).
    const oldDoc = docOf("Alpbody");
    const newDoc = docOf("Alp NEW body");
    // A FOREIGN insertion at the caret should NOT drag the caret along (bias
    // -1 keeps it on the leading edge of the inserted text).
    expect(mapPosThroughReseed(oldDoc, newDoc, 4, -1)).toBe(4);
  });

  it("clamps the caret to the new doc when a foreign edit DELETES content under it", () => {
    // "Alpha body." → "Al." — delete "pha body" (positions 3..11 collapse).
    const oldDoc = docOf("Alpha body.");
    const newDoc = docOf("Al.");
    // Caret was at pos 8 (mid "body"), inside the deleted region → maps to the
    // deletion boundary (pos 3 = end of "Al"), never past the new doc size.
    const mapped = mapPosThroughReseed(oldDoc, newDoc, 8, -1);
    expect(mapped).toBeLessThanOrEqual(newDoc.content.size);
    expect(mapped).toBe(3);
  });

  it("is a no-op (clamped identity) when the docs are identical", () => {
    const oldDoc = docOf("Alpha body.");
    const newDoc = docOf("Alpha body.");
    expect(mapPosThroughReseed(oldDoc, newDoc, 4, -1)).toBe(4);
    // Out-of-range positions still clamp into the new doc.
    expect(mapPosThroughReseed(oldDoc, newDoc, 9999, -1)).toBe(newDoc.content.size);
  });

  it("never returns a position outside the new doc bounds", () => {
    const oldDoc = docOf("Alpha body.");
    const newDoc = docOf("X");
    for (let p = -5; p <= 20; p++) {
      const mapped = mapPosThroughReseed(oldDoc, newDoc, p, -1);
      expect(mapped).toBeGreaterThanOrEqual(0);
      expect(mapped).toBeLessThanOrEqual(newDoc.content.size);
    }
  });
});
