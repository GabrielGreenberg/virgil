/**
 * `makeUnbridgingFootnoteDelete` — the footnote unbridging-delete door (task 252).
 *
 * The footnote twin of `makeUnbridgingDelete`: every footnote hard-delete entry
 * point (panel/margin/float splice, the pristine click-away discard, the
 * atom-range walker's ref delete, the unanchored-footnote trash) routes through
 * this one factory so the task-219 obligation — discharge the linked
 * `ai-requests.json` row FIRST, then remove — holds at every site. The
 * pristine-discard site was the one that hand-threaded neither and stranded the
 * row (the bug this task fixes).
 *
 * These pins lock the contract at the seam; the bridge's terminate semantics
 * themselves (an actual `complete`/`auto-applied` stamp, the idempotent no-op
 * when no row is linked) are pinned in
 * `src/lib/__tests__/ai-request-bridge-idempotency.test.ts` case (l).
 */
import { describe, it, expect, vi } from "vitest";
import { makeUnbridgingFootnoteDelete } from "@/cards/lifecycle/unbridging-footnote-delete";

describe("makeUnbridgingFootnoteDelete", () => {
  it("discharges the linked row (terminate) BEFORE removing — in that order", () => {
    const calls: string[] = [];
    const unbridge = vi.fn((kind: "footnote", id: string) => {
      calls.push(`unbridge:${kind}:${id}`);
    });
    const remove = vi.fn((id: string) => {
      calls.push(`remove:${id}`);
    });

    const del = makeUnbridgingFootnoteDelete({ unbridge });
    del("fn-1", remove);

    // Unbridge fires with the footnote kind + the exact id, then remove runs.
    expect(unbridge).toHaveBeenCalledWith("footnote", "fn-1");
    expect(remove).toHaveBeenCalledWith("fn-1");
    expect(calls).toEqual(["unbridge:footnote:fn-1", "remove:fn-1"]);
  });

  it("threads whatever per-site `remove` the caller supplies (splice vs ref delete)", () => {
    const unbridge = vi.fn();
    const splice = vi.fn();
    const refDelete = vi.fn();
    const del = makeUnbridgingFootnoteDelete({ unbridge });

    del("fn-splice", splice);
    del("fn-ref", refDelete);

    expect(splice).toHaveBeenCalledWith("fn-splice");
    expect(refDelete).toHaveBeenCalledWith("fn-ref");
    // Each delete unbridges its own id under the footnote kind.
    expect(unbridge).toHaveBeenNthCalledWith(1, "footnote", "fn-splice");
    expect(unbridge).toHaveBeenNthCalledWith(2, "footnote", "fn-ref");
  });

  it("does not await the (async) unbridge — fire-and-forget, remove still runs synchronously", () => {
    let resolved = false;
    const unbridge = vi.fn(
      () =>
        new Promise<void>((r) =>
          setTimeout(() => {
            resolved = true;
            r();
          }, 0),
        ),
    );
    const remove = vi.fn();
    const del = makeUnbridgingFootnoteDelete({ unbridge });

    del("fn-1", remove);

    // remove ran immediately, without waiting for the bridge write to settle.
    expect(remove).toHaveBeenCalledWith("fn-1");
    expect(resolved).toBe(false);
  });
});
