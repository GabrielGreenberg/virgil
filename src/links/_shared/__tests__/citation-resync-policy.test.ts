// @vitest-environment node
//
// W2c — the citation add/resync POLICY (pure logic, stub deps).
//
// Pins, per the slice contract (PLAN W2c / T5 Pillar C-1):
//  - resync fires on a genuine citation ADD (CI-F8-03 — code-view `\cite`);
//  - resync fires on a genuine citation REMOVE (CI-A1-01 sidecar half — dead
//    card prunes without remount, in concert with W2b's cardStore/float prune);
//  - resync does NOT fire when no citation entered/left;
//  - resync does NOT fire on a PURE markerless regen (every add is a remap
//    value, every remove a remap key — T1 already re-pointed the survivors);
//  - resync DOES fire on a regen that ALSO adds a genuinely-new `\cite` (a code
//    view that both re-parses and adds — the CI-F8-03 path via re-parse).
import { describe, it, expect } from "vitest";

import {
  EMPTY_DIFF,
  type CitationEntry,
  type FootnoteEntry,
  type StructureDiff,
} from "@/lib/tiptap/doc-structure";
import type { InlineAtomPolicyContext } from "@/lib/identity/identity-bus-consumer";
import { makeCitationResyncPolicy } from "@/links/_shared/citation-resync-policy";

function cite(id: string, pos = 1): CitationEntry {
  return { id, pos, command: `\\cite{${id}}`, displayText: id };
}
function fn(id: string, pos = 1): FootnoteEntry {
  return { id, pos, thanks: false, number: 1 };
}
function diffWith(over: Partial<StructureDiff>): StructureDiff {
  return { ...EMPTY_DIFF, ...over };
}
const NO_REMAP: InlineAtomPolicyContext = { remap: new Map() };
function ctxWith(remap: Map<string, string>): InlineAtomPolicyContext {
  return { remap };
}

/** A counting stub for the resync callback. */
function makeDeps() {
  let calls = 0;
  return {
    deps: { resyncCitations: () => { calls++; } },
    get calls() {
      return calls;
    },
  };
}

describe("makeCitationResyncPolicy", () => {
  it("resyncs on a genuine citation add (CI-F8-03)", () => {
    const d = makeDeps();
    const policy = makeCitationResyncPolicy(d.deps);
    policy(diffWith({ addedCitations: [cite("c1")] }), NO_REMAP);
    expect(d.calls).toBe(1);
  });

  it("resyncs on a genuine citation remove (CI-A1-01 sidecar half)", () => {
    const d = makeDeps();
    const policy = makeCitationResyncPolicy(d.deps);
    policy(diffWith({ removedCitations: [cite("c1")] }), NO_REMAP);
    expect(d.calls).toBe(1);
  });

  it("resyncs on a mixed add+remove (no remap)", () => {
    const d = makeDeps();
    const policy = makeCitationResyncPolicy(d.deps);
    policy(
      diffWith({ addedCitations: [cite("c2")], removedCitations: [cite("c1")] }),
      NO_REMAP,
    );
    expect(d.calls).toBe(1);
  });

  it("does NOT resync when no citation entered or left", () => {
    const d = makeDeps();
    const policy = makeCitationResyncPolicy(d.deps);
    // A footnote-only diff carries no citation delta → no resync.
    policy(diffWith({ addedFootnotes: [fn("f1")] }), NO_REMAP);
    expect(d.calls).toBe(0);
  });

  it("does NOT resync on the EMPTY diff", () => {
    const d = makeDeps();
    const policy = makeCitationResyncPolicy(d.deps);
    policy(EMPTY_DIFF, NO_REMAP);
    expect(d.calls).toBe(0);
  });

  it("does NOT resync on a PURE markerless regen (survivors re-pointed by T1)", () => {
    const d = makeDeps();
    const policy = makeCitationResyncPolicy(d.deps);
    // old c1 dropped + new c1n added in one tx; remap c1 -> c1n. T1 already
    // re-pointed selection/float; the sidecar tracks the live set under the new
    // id, so a resync would only thrash the write.
    const remap = new Map([["c1", "c1n"]]);
    policy(
      diffWith({ removedCitations: [cite("c1")], addedCitations: [cite("c1n")] }),
      ctxWith(remap),
    );
    expect(d.calls).toBe(0);
  });

  it("DOES resync on a regen that ALSO adds a genuinely-new cite", () => {
    const d = makeDeps();
    const policy = makeCitationResyncPolicy(d.deps);
    // Re-parse re-points c1 -> c1n, AND a brand-new c2 was added with no remap
    // counterpart (the code-view-typed `\cite` — CI-F8-03 via re-parse).
    const remap = new Map([["c1", "c1n"]]);
    policy(
      diffWith({
        removedCitations: [cite("c1")],
        addedCitations: [cite("c1n"), cite("c2")],
      }),
      ctxWith(remap),
    );
    expect(d.calls).toBe(1);
  });

  it("DOES resync on a regen that ALSO genuinely deletes a cite", () => {
    const d = makeDeps();
    const policy = makeCitationResyncPolicy(d.deps);
    // Re-parse re-points c1 -> c1n, AND c2 was genuinely removed (no remap key).
    const remap = new Map([["c1", "c1n"]]);
    policy(
      diffWith({
        removedCitations: [cite("c1"), cite("c2")],
        addedCitations: [cite("c1n")],
      }),
      ctxWith(remap),
    );
    expect(d.calls).toBe(1);
  });
});
