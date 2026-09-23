/**
 * Task 719 — the sidecar MERGE authority's algebra, and the table's totality.
 *
 * The hook-level legs live where the harness has a real in-memory disk and the
 * real watcher (`sidecar-watcher-wiring.test.tsx` → "task 719"). This suite
 * pins the rule itself: every row of the verdict table in `sidecar-merge.ts`,
 * including the two a plain union gets wrong (a local DELETE, and an external
 * EDIT to a record the user has not touched).
 */
import { describe, it, expect } from "vitest";
import {
  SIDECAR_COLLECTIONS,
  deepEqual,
  mergeRecordList,
  mergeSidecarState,
  sidecarCollections,
} from "../sidecar-merge";
import { SIDECAR_VALUE } from "../sidecar-value";

interface Card {
  id: string;
  body: string;
}
const card = (id: string, body = id): Card => ({ id, body });
const reports = (...cards: Card[]) => ({ cards });
const merge = (base: unknown, disk: unknown, local: unknown) =>
  mergeSidecarState("reports.json", base as never, disk as never, local as never) as {
    cards: Card[];
  };
const ids = (s: { cards: Card[] }) => s.cards.map((c) => c.id);

describe("the verdict table — every row", () => {
  it("local INSERT (absent from base and disk) is kept", () => {
    const out = merge(reports(card("a")), reports(card("a")), reports(card("a"), card("new")));
    expect(ids(out)).toEqual(["a", "new"]);
  });

  it("EXTERNAL INSERT (on disk, absent from base and local) is kept — the traced bug", () => {
    const out = merge(reports(card("a")), reports(card("a"), card("agent")), reports(card("a")));
    expect(ids(out)).toEqual(["a", "agent"]);
  });

  it("local DELETE (in base, on disk, absent from local) is HONOURED — a union would resurrect it", () => {
    const out = merge(
      reports(card("a"), card("gone")),
      reports(card("a"), card("gone")),
      reports(card("a")),
    );
    expect(ids(out)).toEqual(["a"]);
  });

  it("external DELETE is honoured when local has not touched the record", () => {
    const out = merge(reports(card("a"), card("b")), reports(card("a")), reports(card("a"), card("b")));
    expect(ids(out)).toEqual(["a"]);
  });

  it("…but an unsaved local EDIT outlives an external delete", () => {
    const out = merge(
      reports(card("a"), card("b", "old")),
      reports(card("a")),
      reports(card("a"), card("b", "edited")),
    );
    expect(out.cards).toEqual([card("a"), card("b", "edited")]);
  });

  it("an EXTERNAL EDIT to a record local has not touched is adopted", () => {
    const out = merge(
      reports(card("a", "old")),
      reports(card("a", "agent rewrote it")),
      reports(card("a", "old")),
    );
    expect(out.cards).toEqual([card("a", "agent rewrote it")]);
  });

  it("a record edited on BOTH sides takes the LOCAL version (the unsaved edit is the newer intent)", () => {
    const out = merge(
      reports(card("a", "old")),
      reports(card("a", "theirs")),
      reports(card("a", "mine")),
    );
    expect(out.cards).toEqual([card("a", "mine")]);
  });

  it("order is LOCAL's, with external inserts appended", () => {
    const out = merge(
      reports(card("a"), card("b")),
      reports(card("a"), card("b"), card("agent")),
      reports(card("b"), card("a"), card("mine")),
    );
    expect(ids(out)).toEqual(["b", "a", "mine", "agent"]);
  });
});

describe("the degenerate inputs", () => {
  it("an ABSENT file writes the local snapshot verbatim — nothing external exists", () => {
    expect(merge(reports(card("a")), null, reports(card("b")))).toEqual(reports(card("b")));
  });

  it("NO BASE (a read that threw) degrades to a UNION — it cannot derive a deletion, so it deletes nothing", () => {
    const out = merge(null, reports(card("a"), card("b")), reports(card("a", "mine")));
    expect(out.cards).toEqual([card("a", "mine"), card("b")]);
  });

  it("a non-object top level (a hand-written bare array) is not merged", () => {
    expect(mergeSidecarState("reports.json", [1], [2], [3] as never)).toEqual([3]);
  });
});

describe("the structural rules below the collections", () => {
  it("an unknown TOP-LEVEL key an agent wrote survives a concurrent local save (task 715's file)", () => {
    const out = mergeSidecarState(
      "document-settings.json",
      { styleId: "plain" },
      { styleId: "plain", skillNote: "written by apply_response" },
      { styleId: "article" },
    );
    expect(out).toEqual({ styleId: "article", skillNote: "written by apply_response" });
  });

  it("a uid→html map merges per key, and a key local removed stays removed", () => {
    const out = mergeSidecarState(
      "annotations.json",
      { v: 2, byUid: { u1: "one", u2: "two" }, orphanByKey: {} },
      { v: 2, byUid: { u1: "one", u2: "two", u3: "agent" }, orphanByKey: {} },
      { v: 2, byUid: { u1: "edited" }, orphanByKey: {} },
    );
    expect(out).toEqual({
      v: 2,
      byUid: { u1: "edited", u3: "agent" },
      orphanByKey: {},
    });
  });

  it("a scalar local has not touched adopts disk; one it HAS touched wins", () => {
    const untouched = mergeSidecarState(
      "citations.json",
      { citations: [], bibPath: "refs.bib" },
      { citations: [], bibPath: "moved.bib" },
      { citations: [], bibPath: "refs.bib" },
    );
    expect(untouched).toEqual({ citations: [], bibPath: "moved.bib" });
    const touched = mergeSidecarState(
      "citations.json",
      { citations: [], bibPath: "refs.bib" },
      { citations: [], bibPath: "moved.bib" },
      { citations: [], bibPath: "mine.bib" },
    );
    expect(touched).toEqual({ citations: [], bibPath: "mine.bib" });
  });

  it("a VALUE-identified list (dictionary.json's words) unions by the term itself", () => {
    expect(
      mergeSidecarState(
        "dictionary.json",
        { words: ["alpha"] },
        { words: ["alpha", "agent-term"] },
        { words: ["alpha", "my-term"] },
      ),
    ).toEqual({ words: ["alpha", "my-term", "agent-term"] });
  });

  it("a COMPOSITE identity (bib-review-requests.json: bibKey + type) matches on the pair", () => {
    const base = { requests: [{ bibKey: "smith90", type: "fields", status: "pending" }] };
    const disk = {
      requests: [
        { bibKey: "smith90", type: "fields", status: "complete" },
        { bibKey: "smith90", type: "notes", status: "pending" },
      ],
    };
    const out = mergeSidecarState("bib-review-requests.json", base, disk, base) as {
      requests: { bibKey: string; type: string; status: string }[];
    };
    expect(out.requests).toHaveLength(2);
    expect(out.requests[0].status).toBe("complete");
  });
});

describe("records that cannot be identified are carried, never dropped", () => {
  it("keeps both sides' id-less records, de-duplicated by value", () => {
    const out = mergeRecordList(
      null,
      [{ body: "shared" }, { body: "theirs" }],
      [{ body: "shared" }, { body: "mine" }],
      ["id"],
    );
    expect(out).toEqual([{ body: "shared" }, { body: "mine" }, { body: "theirs" }]);
  });
});

describe("deepEqual is structural, not textual", () => {
  it("key ORDER is not identity (a re-keyed but identical record is not an edit)", () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(deepEqual([1, [2]], [1, [2]])).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
  });
});

describe("census — the table is TOTAL over the content tier", () => {
  // The one deliberate absence: `ai-requests.json` has owned its serialized
  // authority since task 220, and that task's census forbids any other
  // production file from even spelling the filename.
  const EXEMPT = new Set(["ai-requests.json"]);

  it("every content-tier sidecar declares its record collections (an empty array is an answer)", () => {
    const missing = Object.entries(SIDECAR_VALUE)
      .filter(([, v]) => v.tier === "content")
      .map(([f]) => f)
      .filter((f) => !EXEMPT.has(f) && !(f in SIDECAR_COLLECTIONS));
    expect(missing, "declare these in SIDECAR_COLLECTIONS").toEqual([]);
  });

  it("declares nothing the value table has never heard of", () => {
    const unknown = Object.keys(SIDECAR_COLLECTIONS).filter((f) => !(f in SIDECAR_VALUE));
    expect(unknown).toEqual([]);
  });

  it("no view-tier file claims a record collection — the merge is a CONTENT rule", () => {
    const view = Object.keys(SIDECAR_COLLECTIONS).filter(
      (f) => SIDECAR_VALUE[f]?.tier === "view",
    );
    expect(view).toEqual([]);
  });

  it("an undeclared file still answers — no collection, and the structural rules still run", () => {
    expect(sidecarCollections("not-a-sidecar.json")).toEqual([]);
  });
});
