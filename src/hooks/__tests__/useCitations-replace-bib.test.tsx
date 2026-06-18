// @vitest-environment jsdom
//
// T1 Stage 4 / D3 — the `updateBibEntry`(merge) vs `replaceBibEntry`(set-all)
// split.
//
// Pins:
//  - `updateBibEntry` MERGES: a field absent from the patch is kept.
//  - `replaceBibEntry` is SET-ALL: a field the user cleared (absent from the
//    new field map) is DELETED, not retained (BIB-A3-02 / BIB-F5-04 — "I
//    cleared the field but it came back").
//  - a `replaceBibEntry` that changes the `type` fans a `retype` through the
//    IdentityCascade under the flag (single-writer discipline); flag OFF it
//    does not.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async () => ({})),
  readSidecarIfExists: vi.fn(async () => ({})),
  writeSidecar: vi.fn(async () => undefined),
  readBib: vi.fn(async () => ({
    bibText:
      "@article{foo,\n  author = {A. Author},\n  title = {Orig Title},\n  year = {2001}\n}\n",
    detectedPackage: undefined,
  })),
  writeBib: vi.fn(async () => undefined),
}));

import { useCitations } from "../useCitations";
import { isRetype } from "@/lib/identity/identity-cascade";
import { setIdentityCascadeFlag } from "@/lib/identity/identity-flag";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";

beforeEach(() => {
  __resetForTests();
});
afterEach(() => {
  setIdentityCascadeFlag(undefined);
});

async function mountWithFoo(docId: string) {
  beginDocPipeline(docId);
  const { result } = renderHook(() => useCitations(docId));
  await waitFor(() => {
    expect(result.current.bibEntries.some((e) => e.key === "foo")).toBe(true);
  });
  return result;
}

describe("useCitations — updateBibEntry (merge)", () => {
  it("MERGES: a field absent from the patch is kept", async () => {
    const result = await mountWithFoo("doc-merge");
    // Capture the post-parse field values (citation-js normalizes author
    // formatting, so compare against the parsed value, not the raw input).
    const before = result.current.bibEntries.find((e) => e.key === "foo")!;
    const authorBefore = before.fields.author;
    const yearBefore = before.fields.year;
    expect(authorBefore).toBeTruthy();
    act(() => {
      // Patch only `title`; `author` + `year` must survive unchanged.
      result.current.updateBibEntry("foo", { title: "New Title" });
    });
    await waitFor(() => {
      const e = result.current.bibEntries.find((e) => e.key === "foo")!;
      expect(e.fields.title).toBe("New Title");
      expect(e.fields.author).toBe(authorBefore); // kept
      expect(e.fields.year).toBe(yearBefore); // kept
    });
  });
});

describe("useCitations — replaceBibEntry (set-all)", () => {
  it("SET-ALL: a field omitted from the new map is DELETED (BIB-A3-02)", async () => {
    const result = await mountWithFoo("doc-replace");
    act(() => {
      // Replace with ONLY title+author — `year` was cleared, so it must vanish.
      result.current.replaceBibEntry("foo", { title: "Reset", author: "B. Writer" });
    });
    await waitFor(() => {
      const e = result.current.bibEntries.find((e) => e.key === "foo")!;
      expect(e.fields.title).toBe("Reset");
      expect(e.fields.author).toBe("B. Writer");
      expect("year" in e.fields).toBe(false); // DELETED, not retained
    });
  });

  it("set-all rebuilds `raw` to exclude the cleared field", async () => {
    const result = await mountWithFoo("doc-replace-raw");
    act(() => {
      result.current.replaceBibEntry("foo", { title: "Only" });
    });
    await waitFor(() => {
      const e = result.current.bibEntries.find((e) => e.key === "foo")!;
      expect(e.raw).toContain("title = {Only}");
      expect(e.raw).not.toContain("year");
      expect(e.raw).not.toContain("author");
    });
  });

  it("fans a real type change through the cascade when the flag is ON", async () => {
    setIdentityCascadeFlag(true);
    const result = await mountWithFoo("doc-retype-on");
    const retypes: string[] = [];
    act(() => {
      result.current.identityCascade.registerMigrator("bibEntry", (c) => {
        if (isRetype(c)) retypes.push(c.retype.newType);
      });
    });
    act(() => {
      result.current.replaceBibEntry("foo", { title: "T" }, "book");
    });
    await waitFor(() => {
      expect(retypes).toEqual(["book"]);
      expect(result.current.bibEntries.find((e) => e.key === "foo")!.type).toBe("book");
    });
  });

  it("does NOT fan through the cascade when the flag is OFF (parity)", async () => {
    setIdentityCascadeFlag(false);
    const result = await mountWithFoo("doc-retype-off");
    const retypes: string[] = [];
    act(() => {
      result.current.identityCascade.registerMigrator("bibEntry", (c) => {
        if (isRetype(c)) retypes.push(c.retype.newType);
      });
    });
    act(() => {
      result.current.replaceBibEntry("foo", { title: "T" }, "book");
    });
    await waitFor(() => {
      // The .bib-side write still happened; only the fan-out is gated.
      expect(result.current.bibEntries.find((e) => e.key === "foo")!.type).toBe("book");
    });
    expect(retypes).toEqual([]);
  });

  it("a same-type replace does NOT emit a retype (no spurious fan-out)", async () => {
    setIdentityCascadeFlag(true);
    const result = await mountWithFoo("doc-same-type");
    const retypes: string[] = [];
    act(() => {
      result.current.identityCascade.registerMigrator("bibEntry", (c) => {
        if (isRetype(c)) retypes.push(c.retype.newType);
      });
    });
    act(() => {
      result.current.replaceBibEntry("foo", { title: "T" }, "article"); // unchanged
    });
    await waitFor(() => {
      expect(result.current.bibEntries.find((e) => e.key === "foo")!.fields.title).toBe("T");
    });
    expect(retypes).toEqual([]);
  });
});
