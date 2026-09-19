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
//  - a `replaceBibEntry` that changes the `type` writes the new type to the
//    `.bib` and fans NOTHING through the IdentityCascade, on EITHER flag path.
//
// That last pin is renegotiated, not dropped (task 647). It used to read "fans
// a `retype` through the cascade under the flag, and not when it is off" — a
// green pin on a fan-out that could not reach a line of production code, since
// both registered `bibEntry` migrators narrow to a rename and bail. The arm is
// retired (a retype moves no identity), so the contract to hold is the one the
// user can actually observe: the type lands on disk, and no migrator runs. The
// flag-ON and flag-OFF legs are kept BOTH ways round precisely because they now
// assert the same thing — that is what "this seam no longer branches on the
// flag" looks like as a test, and it is what would fail if a future change
// quietly re-introduced a fan-out here.

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
  mutateBib: vi.fn(async () => null),
}));

import { useCitations } from "../useCitations";
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

  it("a real type change writes the type and fans NOTHING (flag ON)", async () => {
    setIdentityCascadeFlag(true);
    const result = await mountWithFoo("doc-retype-on");
    // A migrator that records EVERY change it is handed — no narrowing, so it
    // cannot bail the way the two production migrators did. If any arm is ever
    // dispatched from this seam again, this sees it.
    const fanned: string[] = [];
    act(() => {
      result.current.identityCascade.registerMigrator("bibEntry", (c) => {
        fanned.push(JSON.stringify(c));
      });
    });
    act(() => {
      result.current.replaceBibEntry("foo", { title: "T" }, "book");
    });
    await waitFor(() => {
      expect(result.current.bibEntries.find((e) => e.key === "foo")!.type).toBe("book");
    });
    expect(fanned).toEqual([]);
  });

  it("a real type change writes the type and fans NOTHING (flag OFF — same seam)", async () => {
    setIdentityCascadeFlag(false);
    const result = await mountWithFoo("doc-retype-off");
    const fanned: string[] = [];
    act(() => {
      result.current.identityCascade.registerMigrator("bibEntry", (c) => {
        fanned.push(JSON.stringify(c));
      });
    });
    act(() => {
      result.current.replaceBibEntry("foo", { title: "T" }, "book");
    });
    await waitFor(() => {
      expect(result.current.bibEntries.find((e) => e.key === "foo")!.type).toBe("book");
    });
    expect(fanned).toEqual([]);
  });

  it('"Replace with library" drops a local-only field the library version lacks (BIB-A3-02)', async () => {
    // The local `foo` carries author+title+year. Replace with the library
    // version's COMPLETE field set, which omits `year` — a set-all replace
    // (what handleConflictReplace passes) must drop the local-only `year`,
    // not merge-retain it. This is the panel's "Replace with library" seam.
    const result = await mountWithFoo("doc-replace-library");
    const libraryFields = { author: "Lib Author", title: "Library Title" };
    act(() => {
      result.current.replaceBibEntry("foo", libraryFields, "book");
    });
    await waitFor(() => {
      const e = result.current.bibEntries.find((e) => e.key === "foo")!;
      expect(e.fields.author).toBe("Lib Author");
      expect(e.fields.title).toBe("Library Title");
      expect("year" in e.fields).toBe(false); // local-only field dropped
      expect(e.type).toBe("book"); // library's type carried through
    });
  });

  it("a same-type replace fans nothing either (no spurious fan-out)", async () => {
    setIdentityCascadeFlag(true);
    const result = await mountWithFoo("doc-same-type");
    const retypes: string[] = [];
    act(() => {
      result.current.identityCascade.registerMigrator("bibEntry", (c) => {
        retypes.push(JSON.stringify(c));
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
