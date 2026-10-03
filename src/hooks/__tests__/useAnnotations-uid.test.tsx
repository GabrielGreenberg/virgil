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

// Per-test on-disk fixture for annotations.json: the re-home test needs the
// sidecar read to RESOLVE a legacy/orphan record (the load arm of
// usePersistentState reads `readSidecarIfExists`), so the migrate-on-load runs
// before the bib entries are available.
let DISK_ANNOTATIONS: unknown = null;

vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async () => ({})),
  readSidecarIfExists: vi.fn(async () => DISK_ANNOTATIONS),
  writeSidecar: vi.fn(async () => undefined),
}));

import { useAnnotations } from "../useAnnotations";
import { setIdentityCascadeFlag } from "@/lib/identity/identity-flag";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";
import type { AnnotationsStateV2, BibEntry } from "@/lib/types";

function entry(uid: string, key: string): BibEntry {
  return { uid, key, type: "article", fields: {}, raw: "" };
}

beforeEach(() => {
  __resetForTests();
  DISK_ANNOTATIONS = null;
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

  it(
    "re-homes a DISK orphan onto byUid when bib entries arrive after load " +
      "(the load/parse race — re-home effect, not just a read-through)",
    async () => {
      setIdentityCascadeFlag(true);
      beginDocPipeline("doc-ann-race");

      // A legacy annotation already on disk, keyed by citekey. It loads BEFORE
      // the .bib parses (the race), so keyToUid is empty at migrate-on-load and
      // the record buckets into orphanByKey.
      DISK_ANNOTATIONS = { smithkey: "<p>disk note</p>" };

      // No bib entries yet at mount — the resolver is empty.
      let list: BibEntry[] = [];
      const { result, rerender } = renderHook(
        ({ l }: { l: BibEntry[] }) =>
          useAnnotations("doc-ann-race", (k) => l.find((e) => e.key === k), l),
        { initialProps: { l: list } },
      );

      // After load: the migrate-on-load orphaned it (no uid resolvable yet).
      await waitFor(() => {
        const s = result.current.annotations as AnnotationsStateV2;
        expect(s.v).toBe(2);
        expect(s.orphanByKey.smithkey).toBe("<p>disk note</p>");
        expect(Object.keys(s.byUid)).toHaveLength(0);
      });

      // The .bib parse completes — the entry with that citekey now exists.
      list = [entry("u-1", "smithkey")];
      rerender({ l: list });

      // The re-home effect fires: the annotation MOVES onto byUid keyed by the
      // durable uid (NOT merely read through the orphan bucket). This is the
      // fix — without the effect the orphan would persist and a later citekey
      // rename would strand it.
      await waitFor(() => {
        const s = result.current.annotations as AnnotationsStateV2;
        expect(s.byUid["u-1"]).toBe("<p>disk note</p>");
        expect(s.orphanByKey.smithkey).toBeUndefined();
      });

      // And now a later citekey rename (same uid, new key) does NOT strand it —
      // the annotation reads through the new key because it lives under byUid.
      const renamed = [entry("u-1", "newname")];
      rerender({ l: renamed });
      expect(result.current.getAnnotation("newname")).toBe("<p>disk note</p>");
    },
  );
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

describe("useAnnotations: a flag rollback over a v2 file (task 912)", () => {
  it("OFF reads a v2 file, writes it as v2, and the edit survives the flag returning", async () => {
    const entries = [entry("u-1", "smith"), entry("u-2", "jones")];
    const getBibEntry = (k: string) => entries.find((e) => e.key === k);
    // The file an ON session left behind.
    DISK_ANNOTATIONS = {
      v: 2,
      byUid: { "u-1": "<p>written ON</p>" },
      orphanByKey: { ghost: "<p>orphan</p>" },
    };

    // Flag rolled back.
    setIdentityCascadeFlag(false);
    beginDocPipeline("doc-ann-rollback");
    const off = renderHook(() => useAnnotations("doc-ann-rollback", getBibEntry, entries));
    await waitFor(() => {
      expect(off.result.current.getAnnotation("smith")).toBe("<p>written ON</p>");
    });
    expect(off.result.current.getAnnotation("ghost")).toBe("<p>orphan</p>");

    act(() => {
      off.result.current.setAnnotation("smith", "<p>edited OFF</p>");
      off.result.current.setAnnotation("jones", "<p>new OFF</p>");
    });
    const written = off.result.current.annotations as AnnotationsStateV2;
    // Still v2, no flat key mixed in.
    expect(written.v).toBe(2);
    expect(written.byUid["u-1"]).toBe("<p>edited OFF</p>");
    expect(written.byUid["u-2"]).toBe("<p>new OFF</p>");
    expect((written as unknown as Record<string, unknown>).smith).toBeUndefined();
    off.unmount();

    // Flag back ON, reading what OFF persisted.
    DISK_ANNOTATIONS = written;
    __resetForTests();
    setIdentityCascadeFlag(true);
    beginDocPipeline("doc-ann-rollback-on");
    const on = renderHook(() => useAnnotations("doc-ann-rollback-on", getBibEntry, entries));
    await waitFor(() => {
      expect(on.result.current.getAnnotation("smith")).toBe("<p>edited OFF</p>");
    });
    expect(on.result.current.getAnnotation("jones")).toBe("<p>new OFF</p>");
  });

  it("ON recovers a stray flat key a pre-912 OFF reader wrote onto the v2 file", async () => {
    const entries = [entry("u-1", "smith")];
    DISK_ANNOTATIONS = { v: 2, byUid: {}, orphanByKey: {}, smith: "<p>stray</p>" };
    setIdentityCascadeFlag(true);
    beginDocPipeline("doc-ann-stray");
    const { result } = renderHook(() =>
      useAnnotations("doc-ann-stray", (k) => entries.find((e) => e.key === k), entries),
    );
    await waitFor(() => {
      expect(result.current.getAnnotation("smith")).toBe("<p>stray</p>");
    });
  });
});
