import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  appliedSpliceSettleMessage,
  runCardLifecycleEvent,
  type CardLifecycleDeps,
} from "../lifecycle/run-event";
import type {
  AppliedSpliceOps,
  AppliedSpliceSummary,
} from "../lifecycle/applied-splice";
import type { CardKind } from "../types";
import "../morphs";

/**
 * Task 2026-10-16-1154 — per-card ARCHIVE is a lifecycle event.
 *
 * Before this, the Archive button on an APPLIED suggestion was a bare flag
 * toggle: it closed the proposal's Task "rejected" through the leave rule and
 * hid the card, while the AI's edit stayed live in the paper under a blue mark
 * no visible card managed. Delete, morph, the range Delete/Archive and the
 * script archive door all settle first; archive now rides the same executor.
 */

const SPLICE: AppliedSpliceSummary = { anchorId: "anchor-1", mode: "replace" };

function harness(opts: {
  splice?: AppliedSpliceSummary | null;
  answer?: "keep" | "revert" | null;
  settleOk?: boolean;
}) {
  const order: string[] = [];
  const ask = vi.fn(async () => {
    order.push("ask");
    return opts.answer === undefined ? ("keep" as const) : opts.answer;
  });
  const settle = vi.fn(() => {
    order.push("settle");
    return opts.settleOk ?? true;
  });
  const appliedSplice = {
    get: vi.fn(() => (opts.splice === undefined ? SPLICE : opts.splice)),
    ask,
    settle,
  } as unknown as AppliedSpliceOps;
  const d: CardLifecycleDeps = {
    confirm: vi.fn(async () => true),
    unbridgeAiRequest: vi.fn(async (_k: CardKind, _id: string, mode: string) => {
      order.push(`unbridge:${mode}`);
    }),
    mutate: vi.fn(() => {
      order.push("mutate");
    }),
    signal: vi.fn(),
    appliedSplice,
    finalizeLeavingProposal: vi.fn(() => {
      order.push("finalize");
    }),
  };
  return { d, order, ask, settle };
}

const CARD = { id: "s1", kind: "suggestion", aiOriginRequestId: "r1" };

describe("archive of an APPLIED suggestion settles first (task 1154)", () => {
  for (const kind of ["revision-suggestion", "cutter-suggestion"] as const) {
    it(`${kind}: Keep → settle, then archive; leave-finalize skipped`, async () => {
      const h = harness({ answer: "keep" });
      const ok = await runCardLifecycleEvent(
        { type: "archive", kind, id: "s1", card: CARD },
        h.d,
      );
      expect(ok).toBe(true);
      expect(h.ask).toHaveBeenCalledTimes(1);
      expect(h.settle).toHaveBeenCalledWith(kind, "s1", "keep");
      // SETTLE before the flag flips; the settled finalize (accepted) owns the
      // Task, so the provisional leave rule must not run over it.
      expect(h.order).toEqual(["ask", "settle", "mutate"]);
      expect(h.d.finalizeLeavingProposal).not.toHaveBeenCalled();
      // The record survives an archive: nothing to prune.
      expect(h.d.signal).not.toHaveBeenCalled();
      expect(h.d.confirm).not.toHaveBeenCalled();
    });

    it(`${kind}: Revert → settle(revert), then archive`, async () => {
      const h = harness({ answer: "revert" });
      const ok = await runCardLifecycleEvent(
        { type: "archive", kind, id: "s1", card: CARD },
        h.d,
      );
      expect(ok).toBe(true);
      expect(h.settle).toHaveBeenCalledWith(kind, "s1", "revert");
      expect(h.order).toEqual(["ask", "settle", "mutate"]);
      expect(h.d.finalizeLeavingProposal).not.toHaveBeenCalled();
    });

    it(`${kind}: Cancel → nothing changes`, async () => {
      const h = harness({ answer: null });
      const ok = await runCardLifecycleEvent(
        { type: "archive", kind, id: "s1", card: CARD },
        h.d,
      );
      expect(ok).toBe(false);
      expect(h.order).toEqual(["ask"]);
      expect(h.d.mutate).not.toHaveBeenCalled();
      expect(h.d.finalizeLeavingProposal).not.toHaveBeenCalled();
    });
  }

  it("a refused settle (no editor) aborts the archive", async () => {
    const h = harness({ settleOk: false });
    const ok = await runCardLifecycleEvent(
      { type: "archive", kind: "revision-suggestion", id: "s1", card: CARD },
      h.d,
    );
    expect(ok).toBe(false);
    expect(h.d.mutate).not.toHaveBeenCalled();
    expect(h.d.finalizeLeavingProposal).not.toHaveBeenCalled();
  });

  it("a PENDING (never-applied) proposal: no prompt, archive + leave rule", async () => {
    const h = harness({ splice: null });
    const ok = await runCardLifecycleEvent(
      { type: "archive", kind: "revision-suggestion", id: "s1", card: CARD },
      h.d,
    );
    expect(ok).toBe(true);
    expect(h.ask).not.toHaveBeenCalled();
    expect(h.order).toEqual(["mutate", "finalize"]);
    expect(h.d.finalizeLeavingProposal).toHaveBeenCalledWith(CARD);
  });

  it("an aiRequest-bearing kind unbridges in terminate before the flip", async () => {
    const h = harness({});
    const ok = await runCardLifecycleEvent(
      { type: "archive", kind: "revision-comment", id: "c1" },
      h.d,
    );
    expect(ok).toBe(true);
    // revision-comment owns no splice → no prompt.
    expect(h.order).toEqual(["unbridge:terminate", "mutate"]);
  });

  it("the archive prompt names the archive, and keep names a pending deletion", () => {
    const p = appliedSpliceSettleMessage("archive", "cutter-suggestion", {
      anchorId: "a",
      mode: "delete",
    });
    expect(p.title).toMatch(/^Archive this /);
    expect(p.message).toMatch(/still live in your document/);
    expect(p.keepLabel).toBe("Keep the deletion");
    expect(p.revertLabel).toBe("Revert to original");
    expect(p.cancelLabel).toBe("Cancel");
  });
});

describe("the per-card Archive button rides the executor (source pin)", () => {
  it("EditorPane's archiveCard dispatches a `type: \"archive\"` lifecycle event", () => {
    const src = readFileSync("src/components/EditorPane.tsx", "utf8");
    const start = src.indexOf("const archiveCard = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("const cardArchiveActions", start));
    expect(body).toContain("runCardLifecycleEvent(");
    expect(body).toMatch(/type:\s*"archive"/);
    // The bespoke pre-1154 leave call must not come back beside the executor.
    expect(body).not.toMatch(/onProposalLeave\(/);
  });
});
