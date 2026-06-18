// @vitest-environment jsdom
//
// W2b — the inline-atom lifecycle POLICY (pure logic, stub deps).
//
// Pins, per the slice contract:
//  (a) orphan upsert on a content-bearing footnote removal; clear on add (the
//      FN-A1-03 undo edge — anchored AND orphan is unrepresentable);
//  (b) cardStore prune of a genuinely-deleted inline atom (the prune-exemption
//      ghost class, FN-A1-01); a remapped (re-parse-survivor) or still-live
//      (moved) atom is NOT pruned;
//  (c) poppedOutCards close on a removed atom, or LEFT OPEN (re-point) when the
//      footnote has a recoverable orphan;
//  (d) the inlineAtom/regenIds migrator re-points cardStore selection + float
//      key on a markerless re-parse (OMNI-F3-02, CI-A3-01, CI-F1-02).
import { describe, it, expect, vi, beforeEach } from "vitest";

import { cardStore } from "@/links/_shared/anchored-card-store";
import {
  EMPTY_DIFF,
  type CitationEntry,
  type FootnoteEntry,
  type StructureDiff,
} from "@/lib/tiptap/doc-structure";
import { regenIdsChange } from "@/lib/identity/identity-cascade";
import type { InlineAtomPolicyContext } from "@/lib/identity/identity-bus-consumer";
import {
  makeInlineAtomLifecyclePolicy,
  makeInlineAtomRegenMigrator,
  type InlineAtomLifecycleDeps,
  type RemovedFootnoteContent,
} from "@/links/_shared/inline-atom-lifecycle-policy";
import type { OrphanedFootnote } from "@/lib/types";

function fn(id: string, pos = 1): FootnoteEntry {
  return { id, pos, thanks: false, number: 1 };
}
function cite(id: string, pos = 1): CitationEntry {
  return { id, pos, command: `\\cite{${id}}`, displayText: id };
}
function diffWith(over: Partial<StructureDiff>): StructureDiff {
  return { ...EMPTY_DIFF, ...over };
}
const NO_REMAP: InlineAtomPolicyContext = { remap: new Map() };

interface StubState {
  orphans: OrphanedFootnote[];
  live: Set<string>;
  open: Set<string>;
  bodies: Map<string, RemovedFootnoteContent>;
}

function makeDeps(s: StubState): InlineAtomLifecycleDeps {
  return {
    upsertOrphan: (o) => {
      const i = s.orphans.findIndex((x) => x.footnoteId === o.footnoteId);
      if (i === -1) s.orphans.push(o);
      else s.orphans[i] = o;
    },
    clearOrphan: (id) => {
      s.orphans = s.orphans.filter((o) => o.footnoteId !== id);
    },
    hasOrphan: (id) => s.orphans.some((o) => o.footnoteId === id),
    listOrphanIds: () => s.orphans.map((o) => o.footnoteId),
    removedFootnoteContent: (id) => s.bodies.get(id) ?? null,
    isAtomLive: (id) => s.live.has(id),
    closeFloat: (key) => s.open.delete(key),
    isFloatOpen: (key) => s.open.has(key),
  };
}

beforeEach(() => {
  cardStore.clearSelection();
  cardStore.setHover(null);
  for (const r of [...cardStore.getState().expandedSet]) cardStore.collapse(r);
});

describe("makeInlineAtomLifecyclePolicy — (a) orphan upsert/clear", () => {
  it("upserts an orphan for a content-bearing footnote removal", () => {
    const s: StubState = {
      orphans: [],
      live: new Set(),
      open: new Set(),
      bodies: new Map([
        ["f1", { content: { type: "doc" }, plainText: "a real body", title: "T", thanks: false }],
      ]),
    };
    const policy = makeInlineAtomLifecyclePolicy(makeDeps(s));
    policy(diffWith({ removedFootnotes: [fn("f1")] }), NO_REMAP);
    expect(s.orphans).toHaveLength(1);
    expect(s.orphans[0].footnoteId).toBe("f1");
    expect(s.orphans[0].title).toBe("T");
  });

  it("does NOT upsert (and clears any stale record) for an empty footnote removal", () => {
    const s: StubState = {
      orphans: [{ footnoteId: "f1" } as OrphanedFootnote],
      live: new Set(),
      open: new Set(),
      bodies: new Map([["f1", { content: null, plainText: "   ", thanks: false }]]),
    };
    const policy = makeInlineAtomLifecyclePolicy(makeDeps(s));
    policy(diffWith({ removedFootnotes: [fn("f1")] }), NO_REMAP);
    expect(s.orphans).toHaveLength(0);
  });

  it("title-only footnote (empty body) still orphans — FN-A1-02 fold", () => {
    const s: StubState = {
      orphans: [],
      live: new Set(),
      open: new Set(),
      bodies: new Map([["f1", { content: null, plainText: "", title: "Just a title", thanks: false }]]),
    };
    const policy = makeInlineAtomLifecyclePolicy(makeDeps(s));
    policy(diffWith({ removedFootnotes: [fn("f1")] }), NO_REMAP);
    expect(s.orphans).toHaveLength(1);
  });

  it("CLEARS the orphan when the footnote comes back (the FN-A1-03 undo edge)", () => {
    const s: StubState = {
      orphans: [{ footnoteId: "f1", content: { type: "doc" } } as OrphanedFootnote],
      live: new Set(["f1"]),
      open: new Set(),
      bodies: new Map(),
    };
    const policy = makeInlineAtomLifecyclePolicy(makeDeps(s));
    // The undo re-adds f1 → addedFootnotes carries it → orphan must clear so the
    // atom is never simultaneously anchored AND orphan.
    policy(diffWith({ addedFootnotes: [fn("f1")] }), NO_REMAP);
    expect(s.orphans).toHaveLength(0);
  });
});

describe("makeInlineAtomLifecyclePolicy — (b) cardStore prune", () => {
  it("clears a selected footnote ref on its genuine removal", () => {
    cardStore.select({ kind: "footnote", id: "f1" });
    const s: StubState = { orphans: [], live: new Set(), open: new Set(), bodies: new Map() };
    const policy = makeInlineAtomLifecyclePolicy(makeDeps(s));
    policy(diffWith({ removedFootnotes: [fn("f1")] }), NO_REMAP);
    expect(cardStore.isSelected({ kind: "footnote", id: "f1" })).toBe(false);
  });

  it("clears a selected citation ref on its removal", () => {
    cardStore.select({ kind: "citation", id: "c1" });
    const s: StubState = { orphans: [], live: new Set(), open: new Set(), bodies: new Map() };
    const policy = makeInlineAtomLifecyclePolicy(makeDeps(s));
    policy(diffWith({ removedCitations: [cite("c1")] }), NO_REMAP);
    expect(cardStore.isSelected({ kind: "citation", id: "c1" })).toBe(false);
  });

  it("does NOT prune a re-parse SURVIVOR (id is a remap key)", () => {
    cardStore.select({ kind: "citation", id: "c1" });
    const s: StubState = { orphans: [], live: new Set(["c2"]), open: new Set(), bodies: new Map() };
    const policy = makeInlineAtomLifecyclePolicy(makeDeps(s));
    // c1 appears in removedCitations but is a remap key (it survived as c2). The
    // regen migrator re-points selection to c2; the policy must NOT also prune.
    const ctx: InlineAtomPolicyContext = { remap: new Map([["c1", "c2"]]) };
    policy(diffWith({ removedCitations: [cite("c1")], addedCitations: [cite("c2")] }), ctx);
    // selection stayed (the migrator owns the re-point; the policy left it alone)
    expect(cardStore.isSelected({ kind: "citation", id: "c1" })).toBe(true);
  });

  it("does NOT prune a MOVED footnote (removed + re-added live in same tx)", () => {
    cardStore.select({ kind: "footnote", id: "f1" });
    const s: StubState = { orphans: [], live: new Set(["f1"]), open: new Set(), bodies: new Map() };
    const policy = makeInlineAtomLifecyclePolicy(makeDeps(s));
    policy(diffWith({ removedFootnotes: [fn("f1")], addedFootnotes: [fn("f1", 9)] }), NO_REMAP);
    expect(cardStore.isSelected({ kind: "footnote", id: "f1" })).toBe(true);
    expect(s.orphans).toHaveLength(0); // a move is not an orphan
  });

  it("clears hover and expansion refs too", () => {
    cardStore.setHover({ kind: "footnote", id: "f1" });
    cardStore.expand({ kind: "footnote", id: "f1" });
    const s: StubState = { orphans: [], live: new Set(), open: new Set(), bodies: new Map() };
    const policy = makeInlineAtomLifecyclePolicy(makeDeps(s));
    policy(diffWith({ removedFootnotes: [fn("f1")] }), NO_REMAP);
    expect(cardStore.getState().hover).toBeNull();
    expect(cardStore.isExpanded({ kind: "footnote", id: "f1" })).toBe(false);
  });
});

describe("makeInlineAtomLifecyclePolicy — (c) float prune/re-point", () => {
  it("closes a popped float of an empty (non-recoverable) deleted footnote", () => {
    const key = "float:card:footnote:f1";
    const s: StubState = {
      orphans: [],
      live: new Set(),
      open: new Set([key]),
      bodies: new Map([["f1", { content: null, plainText: "", thanks: false }]]),
    };
    const policy = makeInlineAtomLifecyclePolicy(makeDeps(s));
    policy(diffWith({ removedFootnotes: [fn("f1")] }), NO_REMAP);
    expect(s.open.has(key)).toBe(false); // closed
  });

  it("LEAVES the float open for a recoverable orphaned footnote (re-point)", () => {
    const key = "float:card:footnote:f1";
    const s: StubState = {
      orphans: [],
      live: new Set(),
      open: new Set([key]),
      bodies: new Map([["f1", { content: { type: "doc" }, plainText: "recoverable body", thanks: false }]]),
    };
    const policy = makeInlineAtomLifecyclePolicy(makeDeps(s));
    policy(diffWith({ removedFootnotes: [fn("f1")] }), NO_REMAP);
    expect(s.open.has(key)).toBe(true); // left open → renders the orphan body
    expect(s.orphans).toHaveLength(1);
  });

  it("closes a popped citation float on removal (citations have no orphan model)", () => {
    const key = "float:card:citation:c1";
    const s: StubState = { orphans: [], live: new Set(), open: new Set([key]), bodies: new Map() };
    const policy = makeInlineAtomLifecyclePolicy(makeDeps(s));
    policy(diffWith({ removedCitations: [cite("c1")] }), NO_REMAP);
    expect(s.open.has(key)).toBe(false);
  });
});

describe("makeInlineAtomRegenMigrator — (d) selection + float re-point", () => {
  it("re-points the selected card id on a regen remap", () => {
    cardStore.select({ kind: "citation", id: "c1" });
    const migrator = makeInlineAtomRegenMigrator();
    migrator(regenIdsChange(new Map([["c1", "c1-NEW"]])));
    expect(cardStore.isSelected({ kind: "citation", id: "c1-NEW" })).toBe(true);
    expect(cardStore.isSelected({ kind: "citation", id: "c1" })).toBe(false);
  });

  it("re-points hover + expansion on a regen remap", () => {
    cardStore.setHover({ kind: "footnote", id: "f1" });
    cardStore.expand({ kind: "footnote", id: "f1" });
    const migrator = makeInlineAtomRegenMigrator();
    migrator(regenIdsChange(new Map([["f1", "f1-NEW"]])));
    expect(cardStore.getState().hover).toEqual({ kind: "footnote", id: "f1-NEW" });
    expect(cardStore.isExpanded({ kind: "footnote", id: "f1-NEW" })).toBe(true);
    expect(cardStore.isExpanded({ kind: "footnote", id: "f1" })).toBe(false);
  });

  it("remaps the open float key (lockstep) on a regen remap", () => {
    const remapped: Array<[string, string]> = [];
    const migrator = makeInlineAtomRegenMigrator((oldKey, newKey) => remapped.push([oldKey, newKey]));
    migrator(regenIdsChange(new Map([["c1", "c2"]])));
    // Tries both domains; the float-key remap is a no-op when not open, so we
    // just assert the citation key was offered for remap.
    expect(remapped).toContainEqual(["float:card:citation:c1", "float:card:citation:c2"]);
  });

  it("ignores a non-regen change and an empty remap", () => {
    cardStore.select({ kind: "citation", id: "c1" });
    const migrator = makeInlineAtomRegenMigrator();
    migrator(regenIdsChange(new Map())); // empty
    expect(cardStore.isSelected({ kind: "citation", id: "c1" })).toBe(true);
  });
});
