import { describe, it, expect, beforeEach } from "vitest";
import {
  beginDocPipeline,
  endDocPipeline,
  assertActive,
  isActive,
  getActiveHandle,
  isStalePipelineError,
  StalePipelineError,
  __resetForTests,
} from "../doc-pipeline";

beforeEach(() => {
  __resetForTests();
});

/** Run all queued microtasks so deferred-end side-effects land. */
const flushMicrotasks = () => new Promise<void>((r) => queueMicrotask(r));

describe("doc-pipeline", () => {
  describe("beginDocPipeline / endDocPipeline / assertActive", () => {
    it("active immediately after begin; end is deferred to a microtask", async () => {
      const h = beginDocPipeline("doc-A");
      expect(isActive(h)).toBe(true);
      assertActive(h); // does not throw
      endDocPipeline(h);
      // Deferred-delete: the pipeline survives synchronously until the
      // next microtask. This is the StrictMode/HMR-safe behavior — a
      // remount within the same tick can revive the pipeline, and an
      // unmount-flush save with the OLD handle can land before the
      // entry is cleared.
      expect(isActive(h)).toBe(true);
      await flushMicrotasks();
      expect(isActive(h)).toBe(false);
      expect(() => assertActive(h)).toThrow(StalePipelineError);
    });

    it("begin is idempotent: a second begin for the same docId returns the same handle", () => {
      const h1 = beginDocPipeline("doc-A");
      assertActive(h1);
      const h2 = beginDocPipeline("doc-A");
      // h2 is the SAME pipeline as h1 — both still valid. Idempotency
      // matters because multiple sites (useMemo during render, useEffect
      // after commit) can both call begin for the same doc; without it,
      // every effect would silently invalidate every previously-captured
      // closure and cause silent data loss.
      expect(h2.pipelineId).toBe(h1.pipelineId);
      assertActive(h1);
      assertActive(h2);
    });

    it("end-then-immediate-begin (StrictMode/HMR remount) revives the same pipeline", () => {
      // The architectural wall: a component that unmounts and remounts
      // synchronously (StrictMode dev double-invoke, Fast Refresh) must
      // observe the SAME pipeline across the cycle, otherwise every
      // closure captured in the first mount becomes stale on remount
      // and silently loses the user's pending edits.
      const h1 = beginDocPipeline("doc-A");
      endDocPipeline(h1);
      const h2 = beginDocPipeline("doc-A");
      expect(h2.pipelineId).toBe(h1.pipelineId);
      assertActive(h1);
      assertActive(h2);
    });

    it("end then microtask-flush then begin creates a fresh pipeline", async () => {
      const h1 = beginDocPipeline("doc-A");
      endDocPipeline(h1);
      // After the deferred delete actually fires (real close, no remount
      // within the same tick), a subsequent begin opens a fresh pipeline.
      await flushMicrotasks();
      const h2 = beginDocPipeline("doc-A");
      expect(h2.pipelineId).not.toBe(h1.pipelineId);
      assertActive(h2);
      expect(isActive(h1)).toBe(false);
      expect(() => assertActive(h1)).toThrow(StalePipelineError);
    });

    it("endDocPipeline only clears the registration when the handle matches", async () => {
      const h1 = beginDocPipeline("doc-A");
      endDocPipeline(h1);
      await flushMicrotasks(); // P1 actually ends
      const h2 = beginDocPipeline("doc-A"); // fresh pipeline after explicit end
      // Ending h1 again (already stale) must NOT clear h2's registration.
      endDocPipeline(h1);
      await flushMicrotasks();
      assertActive(h2);
      // Ending h2 actually removes the registration after the microtask.
      endDocPipeline(h2);
      await flushMicrotasks();
      expect(isActive(h2)).toBe(false);
      // Idempotent.
      endDocPipeline(h2);
    });

    it("different docIds run independent pipelines", async () => {
      const a = beginDocPipeline("doc-A");
      const b = beginDocPipeline("doc-B");
      assertActive(a);
      assertActive(b);
      endDocPipeline(a);
      await flushMicrotasks();
      expect(() => assertActive(a)).toThrow(StalePipelineError);
      // B is unaffected.
      assertActive(b);
    });
  });

  describe("getActiveHandle", () => {
    it("returns null when no pipeline is open", () => {
      expect(getActiveHandle("doc-A")).toBeNull();
    });

    it("returns a handle that matches the current pipeline", () => {
      const h = beginDocPipeline("doc-A");
      const fetched = getActiveHandle("doc-A");
      expect(fetched).not.toBeNull();
      expect(fetched!.docId).toBe("doc-A");
      expect(fetched!.pipelineId).toBe(h.pipelineId);
      assertActive(fetched!);
    });

    it("returns null after endDocPipeline + microtask flush", async () => {
      const h = beginDocPipeline("doc-A");
      endDocPipeline(h);
      // Deferred delete: synchronously after end, the handle still
      // resolves (StrictMode/HMR safety). Only after the microtask
      // fires does the entry actually clear.
      expect(getActiveHandle("doc-A")).not.toBeNull();
      await flushMicrotasks();
      expect(getActiveHandle("doc-A")).toBeNull();
    });
  });

  describe("isStalePipelineError", () => {
    it("recognizes thrown StalePipelineError instances", async () => {
      const h = beginDocPipeline("doc-A");
      endDocPipeline(h);
      await flushMicrotasks(); // ensure pipeline actually ended
      try {
        assertActive(h);
        expect.fail("assertActive should have thrown");
      } catch (err) {
        expect(isStalePipelineError(err)).toBe(true);
        expect((err as StalePipelineError).docId).toBe("doc-A");
      }
    });

    it("returns false for unrelated errors", () => {
      expect(isStalePipelineError(new Error("nope"))).toBe(false);
      expect(isStalePipelineError("string")).toBe(false);
      expect(isStalePipelineError(null)).toBe(false);
    });
  });

  describe("integration with storage queue (the bug we're fixing)", () => {
    it("an in-flight write with handle h1 lands successfully when end+begin merely end the pipeline (no supersession)", async () => {
      // The architectural rule: if a closure captured a handle, and by
      // the time it tries to write the pipeline has ENDED but no NEWER
      // pipeline took over, the write is allowed. (assertNotSuperseded
      // captures this; a stricter assertActive would reject.)
      const h1 = beginDocPipeline("doc-A");
      const inFlight = (async () => {
        await Promise.resolve();
        // Lenient check — passes when pipeline ended cleanly.
        const { assertNotSuperseded } = await import("../doc-pipeline");
        assertNotSuperseded(h1);
        return "wrote";
      })();
      endDocPipeline(h1);
      await expect(inFlight).resolves.toBe("wrote");
    });

    it("supersede: a NEWER pipeline for the same docId invalidates an old handle's write", async () => {
      const { assertNotSuperseded } = await import("../doc-pipeline");
      const h1 = beginDocPipeline("doc-A");
      // Real reopen: end + flush + begin ⇒ a fresh pipeline that
      // supersedes the old one. The deferred delete must have actually
      // landed for begin to mint a new pipeline; otherwise begin would
      // revive h1 (the StrictMode-safe path).
      endDocPipeline(h1);
      await flushMicrotasks();
      const h2 = beginDocPipeline("doc-A");
      expect(h2.pipelineId).not.toBe(h1.pipelineId);
      // Any in-flight write under h1 — even the lenient
      // `assertNotSuperseded` check — is rejected, because a strictly
      // newer pipeline is now in charge. This is the wall against
      // cross-pipeline writes after a supersede.
      expect(() => assertNotSuperseded(h1)).toThrow(StalePipelineError);
      // P2 is still active.
      assertActive(h2);
    });
  });
});
