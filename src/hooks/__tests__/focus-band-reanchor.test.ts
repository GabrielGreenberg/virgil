import { describe, expect, it, vi } from "vitest";
import { Schema, type Node as PMNode } from "@tiptap/pm/model";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { reanchorBand } from "@/hooks/useFocusMode";
import { resolveFocusBand } from "@/lib/focus-view";

/**
 * Task 709 — a dead band anchor re-anchors onto the nearest SURVIVING MEMBER
 * of the band as it last resolved, never onto whatever block now occupies the
 * dead anchor's old index. The end-edge case was the defect: after the band's
 * last block merged upward, index `e` held the NEXT section's heading, and the
 * band silently grew one block into that section.
 */

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*", attrs: { uuid: { default: null } } },
    text: {},
  },
});

function doc(uuids: string[]): PMNode {
  return schema.node(
    "doc",
    null,
    uuids.map((u) => schema.node("paragraph", { uuid: u }, [schema.text(u)])),
  );
}

// Old doc: 0 pre · 1 h1 · 2 a · 3 b · 4 c · 5 h2 · 6 d. Band = [2..4].
const OLD = ["pre", "h1", "a", "b", "c", "h2", "d"];
const MEMBERS = ["a", "b", "c"];
const BAND = { startUuid: "a", endUuid: "c" };

function resolve(d: PMNode, b: { startUuid: string | null; endUuid: string | null }) {
  return resolveFocusBand(d, { active: true, locked: false, ...b });
}

describe("reanchorBand (task 709)", () => {
  it("sanity: the old band resolves to [2..4]", () => {
    expect(resolve(doc(OLD), BAND)).toEqual({ startIdx: 2, endIdx: 4 });
  });

  it("END edge: deleting the band's last block (merge into its predecessor) → [2..3], not the next heading", () => {
    const after = doc(["pre", "h1", "a", "b", "h2", "d"]);
    const r = reanchorBand(after, BAND, MEMBERS, true, false)!;
    expect(r).toEqual({ startUuid: "a", endUuid: "b" });
    expect(resolve(after, r)).toEqual({ startIdx: 2, endIdx: 3 });
  });

  it("START edge (mirror): deleting the band's first block → the next member, not the heading above", () => {
    const after = doc(["pre", "h1", "b", "c", "h2", "d"]);
    const r = reanchorBand(after, BAND, MEMBERS, false, true)!;
    expect(r).toEqual({ startUuid: "b", endUuid: "c" });
    expect(resolve(after, r)).toEqual({ startIdx: 2, endIdx: 3 });
  });

  it("multi-block delete at the end: walks back to the nearest surviving member", () => {
    const after = doc(["pre", "h1", "a", "h2", "d"]);
    const r = reanchorBand(after, BAND, MEMBERS, true, false)!;
    expect(resolve(after, r)).toEqual({ startIdx: 2, endIdx: 2 });
  });

  it("an INSERT elsewhere does not change which member is chosen (identity, not index)", () => {
    const after = doc(["new0", "new1", "pre", "h1", "a", "b", "h2", "d"]);
    const r = reanchorBand(after, BAND, MEMBERS, true, false)!;
    expect(resolve(after, r)).toEqual({ startIdx: 4, endIdx: 5 });
  });

  it("no surviving member → null (the caller deactivates)", () => {
    const after = doc(["pre", "h1", "h2", "d"]);
    expect(reanchorBand(after, BAND, MEMBERS, false, false)).toBeNull();
  });

  it("a survivor at the doc's last index takes the null end sentinel", () => {
    const after = doc(["pre", "h1", "a", "b"]);
    const r = reanchorBand(after, BAND, MEMBERS, true, false)!;
    expect(r.endUuid).toBeNull();
    expect(resolve(after, r)).toEqual({ startIdx: 2, endIdx: 3 });
  });

  it("with no member record, a dead edge falls back to its doc-edge sentinel", () => {
    const after = doc(["pre", "h1", "a", "b", "h2", "d"]);
    expect(reanchorBand(after, BAND, null, true, false)).toEqual({ startUuid: "a", endUuid: null });
  });
});
