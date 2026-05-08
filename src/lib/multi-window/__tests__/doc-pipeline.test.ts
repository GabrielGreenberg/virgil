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

describe("doc-pipeline", () => {
  describe("beginDocPipeline / endDocPipeline / assertActive", () => {
    it("active immediately after begin, inactive after end", () => {
      const h = beginDocPipeline("doc-A");
      expect(isActive(h)).toBe(true);
      assertActive(h); // does not throw
      endDocPipeline(h);
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

    it("explicit end then begin creates a fresh pipeline that supersedes the old handle", () => {
      const h1 = beginDocPipeline("doc-A");
      endDocPipeline(h1);
      const h2 = beginDocPipeline("doc-A");
      expect(h2.pipelineId).not.toBe(h1.pipelineId);
      assertActive(h2);
      expect(isActive(h1)).toBe(false);
      expect(() => assertActive(h1)).toThrow(StalePipelineError);
    });

    it("endDocPipeline only clears the registration when the handle matches", () => {
      const h1 = beginDocPipeline("doc-A");
      endDocPipeline(h1);
      const h2 = beginDocPipeline("doc-A"); // fresh pipeline after explicit end
      // Ending h1 again (already stale) must NOT clear h2's registration.
      endDocPipeline(h1);
      assertActive(h2);
      // Ending h2 actually removes the registration.
      endDocPipeline(h2);
      expect(isActive(h2)).toBe(false);
      // Idempotent.
      endDocPipeline(h2);
    });

    it("different docIds run independent pipelines", () => {
      const a = beginDocPipeline("doc-A");
      const b = beginDocPipeline("doc-B");
      assertActive(a);
      assertActive(b);
      endDocPipeline(a);
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

    it("returns null after endDocPipeline", () => {
      const h = beginDocPipeline("doc-A");
      endDocPipeline(h);
      expect(getActiveHandle("doc-A")).toBeNull();
    });
  });

  describe("isStalePipelineError", () => {
    it("recognizes thrown StalePipelineError instances", () => {
      const h = beginDocPipeline("doc-A");
      endDocPipeline(h);
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
    it("simulates the autosave race: write authored under pipeline P1, P1 ends mid-flight, write is rejected", async () => {
      // P1 is opened for doc A; user types something — simulated by an
      // async task that captures h1 in its closure.
      const h1 = beginDocPipeline("doc-A");

      // Simulate a debounced save that's already in flight when the user
      // switches docs. The save callback closes over h1.
      const inFlight = (async () => {
        // Inside the save body we'd normally call writeDocBundle which
        // calls assertActive(h). Mimic that here.
        // ... pretend some async I/O happened ...
        await Promise.resolve();
        assertActive(h1); // throws if pipeline ended
      })();

      // Meanwhile, the user closes doc A.
      endDocPipeline(h1);

      // The in-flight save now lands and detects the stale handle.
      await expect(inFlight).rejects.toBeInstanceOf(StalePipelineError);
    });

    it("supersede mid-flight: rapid close/reopen of the same docId rejects writes from the older pipeline", async () => {
      const h1 = beginDocPipeline("doc-A");
      const inFlight = (async () => {
        await Promise.resolve();
        assertActive(h1);
      })();
      // P1 explicitly ended, then P2 opened — e.g. doc closed and
      // immediately reopened. The closure capturing h1 is now stale.
      endDocPipeline(h1);
      const h2 = beginDocPipeline("doc-A");
      await expect(inFlight).rejects.toBeInstanceOf(StalePipelineError);
      // P2 is still active.
      assertActive(h2);
    });
  });
});
