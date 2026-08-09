// The five paper AI requests are declared once, and the declaration has to
// carry EVERYTHING a kind needs — the queue kind it reads back (task 132's
// root cause was a read path made of hand-picked filenames that no writer
// referenced), the enqueue/cancel pair, and the precondition that greys it.
// The `Record<PaperRequestKind, …>` makes an unwired kind a compile error;
// these assertions cover what types can't say.

import { describe, expect, it } from "vitest";
import {
  PAPER_REQUESTS,
  PAPER_REQUESTS_BY_KIND,
  PAPER_REQUEST_ORDER,
  type PaperRequestKind,
} from "../paper-ai-requests";
import { queueFilename, type QueueEntry } from "../queue";

const KINDS = Object.keys(PAPER_REQUESTS_BY_KIND) as PaperRequestKind[];

describe("paper AI requests — one declaration per kind", () => {
  it("renders every declared kind, exactly once", () => {
    expect([...PAPER_REQUEST_ORDER].sort()).toEqual([...KINDS].sort());
    expect(new Set(PAPER_REQUEST_ORDER).size).toBe(PAPER_REQUEST_ORDER.length);
    expect(PAPER_REQUESTS.map((r) => r.kind)).toEqual([...PAPER_REQUEST_ORDER]);
  });

  it("every kind states its queue kind, both verbs, and a self-consistent key", () => {
    for (const kind of KINDS) {
      const req = PAPER_REQUESTS_BY_KIND[kind];
      expect(req.kind).toBe(kind);
      expect(req.label.length).toBeGreaterThan(0);
      expect(typeof req.queueKind).toBe("string");
      expect(typeof req.enqueue).toBe("function");
      expect(typeof req.cancel).toBe("function");
    }
  });

  it("the queue kinds are distinct — two requests must never read as one checkbox", () => {
    const queueKinds = KINDS.map((k) => PAPER_REQUESTS_BY_KIND[k].queueKind);
    expect(new Set(queueKinds).size).toBe(queueKinds.length);
  });

  it("index and bib SHARE one queue file — which is why the kind, not the filename, is the read key", () => {
    const filenameFor = (queueKind: QueueEntry["kind"]) =>
      queueFilename({
        kind: queueKind,
        status: "requested",
        citekey: "alpha",
        requestedAt: "2026-01-01T00:00:00Z",
        attempts: 0,
      });
    expect(filenameFor(PAPER_REQUESTS_BY_KIND.index.queueKind)).toBe(
      filenameFor(PAPER_REQUESTS_BY_KIND.bib.queueKind),
    );
    // …and every other pair is separable by filename alone.
    const others = KINDS.filter((k) => k !== "index" && k !== "bib");
    const names = others.map((k) =>
      filenameFor(PAPER_REQUESTS_BY_KIND[k].queueKind),
    );
    expect(new Set(names).size).toBe(names.length);
  });

  it("only the requests that need an indexed paper declare a precondition", () => {
    const gated = KINDS.filter(
      (k) => PAPER_REQUESTS_BY_KIND[k].requiresIndexed,
    ).sort();
    expect(gated).toEqual(["doc", "importbib"]);
    for (const k of gated) {
      expect(PAPER_REQUESTS_BY_KIND[k].requiresIndexed).toMatch(/Index the paper first/);
    }
  });
});
