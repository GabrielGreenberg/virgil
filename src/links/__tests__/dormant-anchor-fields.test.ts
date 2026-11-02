// Task 1419 — the dormant writer/reviver rewrite a link's pids AND keep the
// fields that describe them coherent. The single `paragraphSnapshot`
// describes `textObjectIds[0]` (the load reconcile re-finds THAT pid by it),
// so a half whose index 0 is another paragraph must not carry it; a falsy pid
// names nothing and no half keeps it; and a Restore whose block uuid collided
// moves a Mode-B link's pids even when its mark kept its anchorId.
import { describe, it, expect } from "vitest";
import type { Link } from "@/links/_shared/types";
import {
  isDormantLink,
  markDormant,
  reviveLiveLinks,
  reviveRemapped,
  type DormantCardShape,
} from "@/links/dormant";

function modeA(id: string, pids: string[], snapshot?: string): Link {
  return {
    id,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "paragraph",
      textObjectIds: pids,
      ...(snapshot ? { paragraphSnapshot: snapshot } : {}),
    },
    target: { type: "card", ref: { kind: "note", id: "n1" } },
    createdAt: "2026-11-01T00:00:00Z",
  };
}

function modeB(id: string, pid: string, anchorId: string, archivedWith?: string): Link {
  return {
    id,
    kind: "anchor",
    anchor: {
      type: "textObject",
      targetKind: "linkedRange",
      textObjectIds: [pid],
      textRange: { anchorId, textSnapshot: "words" },
    },
    target: { type: "card", ref: { kind: "note", id: "n1" } },
    createdAt: "2026-11-01T00:00:00Z",
    ...(archivedWith ? { archivedWith } : {}),
  };
}

type Anchor = { textObjectIds: string[]; paragraphSnapshot?: string };
const anchorOf = (l: Link) => l.anchor as unknown as Anchor;
const live = (c: DormantCardShape) => c.links!.find((l) => !isDormantLink(l))!;
const dormant = (c: DormantCardShape) => c.links!.find(isDormantLink)!;

describe("a Mode-A split keeps the snapshot only on the half it describes", () => {
  it("[P,Q] archiving P: the live [Q] half carries no P snapshot; the dormant [P] keeps it", () => {
    const out = markDormant({ id: "n1", links: [modeA("l1", ["P", "Q"], "P text")] }, "S", {
      pids: new Set(["P"]),
    });
    expect(anchorOf(live(out)).textObjectIds).toEqual(["Q"]);
    expect(anchorOf(live(out))).not.toHaveProperty("paragraphSnapshot");
    expect(anchorOf(dormant(out)).textObjectIds).toEqual(["P"]);
    expect(anchorOf(dormant(out)).paragraphSnapshot).toBe("P text");
  });

  it("[Q,P] archiving P: the dormant [P] half carries no Q snapshot; the live [Q] keeps it", () => {
    const out = markDormant({ id: "n1", links: [modeA("l1", ["Q", "P"], "Q text")] }, "S", {
      pids: new Set(["P"]),
    });
    expect(anchorOf(dormant(out)).textObjectIds).toEqual(["P"]);
    expect(anchorOf(dormant(out))).not.toHaveProperty("paragraphSnapshot");
    expect(anchorOf(live(out)).paragraphSnapshot).toBe("Q text");
  });

  it("a falsy pid is kept by neither half — no `<card>@` id", () => {
    const out = markDormant({ id: "n1", links: [modeA("l1", ["P", ""])] }, "S", {
      pids: new Set(["P"]),
    });
    expect(out.links!.flatMap((l) => anchorOf(l).textObjectIds)).toEqual(["P"]);
    expect(out.links!.map((l) => l.id)).not.toContain("n1@");
  });
});

describe("reviveRemapped moves each identity space independently", () => {
  it("a Mode-B link whose block uuid collided (anchorId did not) follows the uuid map", () => {
    const card = { id: "n1", links: [modeB("h1", "u", "a", "S")] };
    const out = reviveRemapped(card, "S", { uuids: new Map([["u", "u2"]]), anchorIds: new Map() });
    expect(anchorOf(out.links![0]).textObjectIds).toEqual(["u2"]);
    // The mark kept its id, so it revives on that mark — now naming the
    // paragraph that came back, not the squatter.
    const back = reviveLiveLinks(out, { isUuidLive: () => false, isAnchorIdLive: (a) => a === "a" });
    expect(isDormantLink(back.links![0])).toBe(false);
    expect(anchorOf(back.links![0]).textObjectIds).toEqual(["u2"]);
  });

  it("a remapped first pid keeps its snapshot (it still describes that paragraph)", () => {
    const l = { ...modeA("l1", ["P", "Q"], "P text"), archivedWith: "S" };
    const out = reviveRemapped({ id: "n1", links: [l] }, "S", {
      uuids: new Map([["P", "P2"]]),
      anchorIds: new Map(),
    });
    expect(anchorOf(out.links![0])).toMatchObject({ textObjectIds: ["P2", "Q"], paragraphSnapshot: "P text" });
    expect(isDormantLink(out.links![0])).toBe(false);
  });
});
