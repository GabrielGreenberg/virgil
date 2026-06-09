import { describe, it, expect } from "vitest";
import {
  buildFloatKey,
  parseFloatKey,
  parseAnyKey,
  migrateLegacyKeyToFloat,
  migrateFloatKeys,
} from "../float-key";

describe("buildFloatKey / parseFloatKey", () => {
  it("round-trips a card key", () => {
    const key = buildFloatKey({ domain: "card", kind: "note", id: "abc123" });
    expect(key).toBe("float:card:note:abc123");
    expect(parseFloatKey(key)).toEqual({ domain: "card", kind: "note", id: "abc123" });
  });

  it("is colon-safe: id keeps interior colons (uuids, legacy infixes)", () => {
    const key = "float:textobject:paragraph:uuid:with:colons";
    expect(parseFloatKey(key)).toEqual({
      domain: "textobject",
      kind: "paragraph",
      id: "uuid:with:colons",
    });
  });

  it("rejects non-float keys and unknown domains", () => {
    expect(parseFloatKey("note:abc")).toBeNull();
    expect(parseFloatKey("float:bogus:note:abc")).toBeNull();
    expect(parseFloatKey("float:card:note")).toBeNull(); // missing id
    expect(parseFloatKey("float:card::abc")).toBeNull(); // empty kind
  });
});

describe("parseAnyKey (dual-read)", () => {
  it("parses the new float: grammar", () => {
    expect(parseAnyKey("float:card:footnote:f1")).toEqual({
      domain: "card",
      kind: "footnote",
      id: "f1",
    });
  });

  it("parses legacy textobject keys", () => {
    expect(parseAnyKey("textobject:heading:h-uuid")).toEqual({
      domain: "textobject",
      kind: "heading",
      id: "h-uuid",
    });
  });

  it("normalizes the revision pair from legacy keys", () => {
    expect(parseAnyKey("revision:c1")).toEqual({
      domain: "card",
      kind: "revision-comment",
      id: "c1",
    });
    // revision:s:<id> — the suggestion key with the s: infix stripped
    expect(parseAnyKey("revision:s:sug1")).toEqual({
      domain: "card",
      kind: "revision-suggestion",
      id: "sug1",
    });
  });

  it("maps every other legacy card prefix straight through (prefix === kind)", () => {
    expect(parseAnyKey("cutter-suggestion:x")).toEqual({
      domain: "card",
      kind: "cutter-suggestion",
      id: "x",
    });
    expect(parseAnyKey("bib:smith2020")).toEqual({
      domain: "card",
      kind: "bib",
      id: "smith2020",
    });
  });
});

describe("migrateLegacyKeyToFloat", () => {
  it("is idempotent on already-migrated keys", () => {
    const k = "float:card:note:abc";
    expect(migrateLegacyKeyToFloat(k)).toBe(k);
  });

  it("normalizes revision:s:<id> → float:card:revision-suggestion:<id> (strips s:)", () => {
    expect(migrateLegacyKeyToFloat("revision:s:sug1")).toBe(
      "float:card:revision-suggestion:sug1",
    );
    expect(migrateLegacyKeyToFloat("revision:c1")).toBe(
      "float:card:revision-comment:c1",
    );
  });

  it("converts legacy textobject keys", () => {
    expect(migrateLegacyKeyToFloat("textobject:paragraph:p1")).toBe(
      "float:textobject:paragraph:p1",
    );
  });

  it("converts plain card prefixes", () => {
    expect(migrateLegacyKeyToFloat("note:n1")).toBe("float:card:note:n1");
    expect(migrateLegacyKeyToFloat("cutter-comment:cc1")).toBe(
      "float:card:cutter-comment:cc1",
    );
  });

  it("leaves doc-aware-ambiguous prefixes (list:/example:) untouched", () => {
    // example: may be the panel card OR a pre-D10 exampleBlock — only the
    // doc-aware leg can disambiguate, so the read-time leg defers it.
    expect(migrateLegacyKeyToFloat("example:ex1")).toBe("example:ex1");
    expect(migrateLegacyKeyToFloat("list:l1")).toBe("list:l1");
  });
});

describe("migrateFloatKeys (lockstep both maps)", () => {
  it("rewrites poppedOutCards AND cardFloatPositions with the same transform", () => {
    const keys = ["note:n1", "revision:s:sug1", "textobject:paragraph:p1"];
    const positions = {
      "note:n1": { x: 1, y: 2, width: 3, height: 4 },
      "revision:s:sug1": { x: 5, y: 6, width: 7, height: 8 },
    };
    const out = migrateFloatKeys(keys, positions, migrateLegacyKeyToFloat);
    expect(out.changed).toBe(true);
    expect(out.keys).toEqual([
      "float:card:note:n1",
      "float:card:revision-suggestion:sug1",
      "float:textobject:paragraph:p1",
    ]);
    // The rect for the suggestion follows its key into the new grammar — not
    // orphaned (the bug the existing D10 migration left).
    expect(out.positions).toEqual({
      "float:card:note:n1": { x: 1, y: 2, width: 3, height: 4 },
      "float:card:revision-suggestion:sug1": { x: 5, y: 6, width: 7, height: 8 },
    });
  });

  it("migrates a remembered rect even when its key isn't currently open", () => {
    const out = migrateFloatKeys(
      [],
      { "todo:t1": { x: 0, y: 0, width: 9, height: 9 } },
      migrateLegacyKeyToFloat,
    );
    expect(out.changed).toBe(true);
    expect(out.positions).toEqual({
      "float:card:todo:t1": { x: 0, y: 0, width: 9, height: 9 },
    });
  });

  it("is a no-op (changed=false, same refs) when everything is already float:", () => {
    const keys = ["float:card:note:n1"];
    const positions = { "float:card:note:n1": { x: 0, y: 0, width: 1, height: 1 } };
    const out = migrateFloatKeys(keys, positions, migrateLegacyKeyToFloat);
    expect(out.changed).toBe(false);
    expect(out.keys).toBe(keys);
    expect(out.positions).toBe(positions);
  });

  it("drops a key (and its rect) when mapKey returns null", () => {
    const out = migrateFloatKeys(
      ["note:n1", "dead:d1"],
      { "note:n1": { x: 0, y: 0, width: 1, height: 1 }, "dead:d1": { x: 2, y: 2, width: 2, height: 2 } },
      (k) => (k.startsWith("dead:") ? null : migrateLegacyKeyToFloat(k)),
    );
    expect(out.changed).toBe(true);
    expect(out.keys).toEqual(["float:card:note:n1"]);
    expect(out.positions).toEqual({
      "float:card:note:n1": { x: 0, y: 0, width: 1, height: 1 },
    });
  });
});
