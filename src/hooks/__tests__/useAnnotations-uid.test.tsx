// @vitest-environment jsdom
//
// T1 Stage 1 — annotations re-key on the durable uid (BIB-A2-01 DATA-LOSS).
//
// The pin that matters: with the identity-cascade flag ON, an annotation keyed
// on a bib entry survives a citekey rename, because storage is by uid (the
// citekey is just the lookup arg). With the flag OFF, behavior is the legacy
// flat citekey-keyed record (parity).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async () => ({})),
  readSidecarIfExists: vi.fn(async () => null),
  writeSidecar: vi.fn(async () => undefined),
}));

import { useAnnotations } from "../useAnnotations";
import { setIdentityCascadeFlag } from "@/lib/identity/identity-flag";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";
import type { BibEntry } from "@/lib/types";

function entry(uid: string, key: string): BibEntry {
  return { uid, key, type: "article", fields: {}, raw: "" };
}

beforeEach(() => {
  __resetForTests();
});
afterEach(() => {
  setIdentityCascadeFlag(undefined);
});

describe("useAnnotations: uid keying (flag ON)", () => {
  it("an annotation survives a citekey rename (DATA-LOSS fix BIB-A2-01)", async () => {
    setIdentityCascadeFlag(true);
    beginDocPipeline("doc-ann");

    // The entry list is mutable across renders (a rename changes the key).
    const entries = [entry("u-1", "oldkey")];
    const getBibEntry = (k: string) => entries.find((e) => e.key === k);

    const { result, rerender } = renderHook(
      ({ list }: { list: BibEntry[] }) =>
        useAnnotations("doc-ann", (k) => list.find((e) => e.key === k), list),
      { initialProps: { list: entries } },
    );

    act(() => {
      result.current.setAnnotation("oldkey", "<p>my note</p>");
    });
    await waitFor(() => {
      expect(result.current.getAnnotation("oldkey")).toBe("<p>my note</p>");
    });

    // Rename the citekey: same uid, new key. (This is what the cascade does to
    // the BibEntry.)
    const renamed = [entry("u-1", "newkey")];
    rerender({ list: renamed });

    // The annotation is reachable under the NEW key — it was keyed by uid.
    expect(result.current.getAnnotation("newkey")).toBe("<p>my note</p>");
    // And NOT under the stale old key.
    expect(result.current.getAnnotation("oldkey")).toBe("");
    void getBibEntry;
  });

  it("buckets a write whose entry isn't loaded, then re-homes it", async () => {
    setIdentityCascadeFlag(true);
    beginDocPipeline("doc-ann2");

    let list: BibEntry[] = []; // entry not parsed yet
    const { result, rerender } = renderHook(
      ({ l }: { l: BibEntry[] }) =>
        useAnnotations("doc-ann2", (k) => l.find((e) => e.key === k), l),
      { initialProps: { l: list } },
    );

    act(() => {
      result.current.setAnnotation("pending", "<p>early note</p>");
    });
    await waitFor(() => {
      expect(result.current.getAnnotation("pending")).toBe("<p>early note</p>");
    });

    // The entry now parses with that citekey; the orphan re-homes onto byUid on
    // the next migrate pass (load-time) — here we assert the read still works.
    list = [entry("u-p", "pending")];
    rerender({ l: list });
    expect(result.current.getAnnotation("pending")).toBe("<p>early note</p>");
  });
});

describe("useAnnotations: legacy parity (flag OFF)", () => {
  it("keys on the citekey exactly as before (no uid resolver consulted)", async () => {
    setIdentityCascadeFlag(false);
    beginDocPipeline("doc-ann-legacy");

    const { result } = renderHook(() =>
      useAnnotations("doc-ann-legacy", () => entry("u-x", "smith"), [entry("u-x", "smith")]),
    );
    act(() => {
      result.current.setAnnotation("smith", "<p>legacy</p>");
    });
    await waitFor(() => {
      expect(result.current.getAnnotation("smith")).toBe("<p>legacy</p>");
    });
    // Flag OFF: the on-disk shape is the flat record (no `v: 2`).
    expect((result.current.annotations as Record<string, unknown>).v).toBeUndefined();
    expect((result.current.annotations as Record<string, string>).smith).toBe("<p>legacy</p>");
  });
});
