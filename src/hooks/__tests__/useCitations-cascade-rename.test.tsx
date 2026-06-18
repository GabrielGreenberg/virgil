// @vitest-environment jsdom
//
// T1 Stage 2 — `updateBibKeyAndType` routes a citekey rename through the
// IdentityCascade when the flag is ON.
//
// Pins:
//  - flag ON: the rename fans out to a registered cascade migrator (the editor
//    `\cite{}` doc-rewrite is wired this way in EditorPane) AND rewrites the
//    citation-refs with the boundary matcher (a punctuation citekey is handled,
//    `foo` doesn't clobber `foobar`).
//  - flag OFF: the legacy path runs (no cascade fan-out) — parity.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async () => ({})),
  readSidecarIfExists: vi.fn(async () => ({})),
  writeSidecar: vi.fn(async () => undefined),
  readBib: vi.fn(async () => ({
    // Two entries; `foo` and `foobar` so we can prove the boundary matcher.
    bibText: "@article{foo,\n  title = {A}\n}\n@article{foobar,\n  title = {B}\n}\n",
    detectedPackage: undefined,
  })),
  writeBib: vi.fn(async () => undefined),
}));

import { useCitations } from "../useCitations";
import { isRenameCitekey } from "@/lib/identity/identity-cascade";
import { setIdentityCascadeFlag } from "@/lib/identity/identity-flag";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";

beforeEach(() => {
  __resetForTests();
});
afterEach(() => {
  setIdentityCascadeFlag(undefined);
});

describe("useCitations.updateBibKeyAndType — cascade path (flag ON)", () => {
  it("fans the rename out to a registered migrator + boundary-rewrites refs", async () => {
    setIdentityCascadeFlag(true);
    beginDocPipeline("doc-ren");
    const { result } = renderHook(() => useCitations("doc-ren"));

    await waitFor(() => {
      expect(result.current.bibEntries.some((e) => e.key === "foo")).toBe(true);
    });

    // Register a cascade migrator (stand-in for the editor `\cite{}` rewrite).
    const fanned: string[] = [];
    act(() => {
      result.current.identityCascade.registerMigrator("bibEntry", (c) => {
        if (isRenameCitekey(c)) fanned.push(`${c.renameCitekey.oldKey}->${c.renameCitekey.newKey}`);
      });
    });

    // A citation that cites `foo` AND a sibling `foobar` — the boundary matcher
    // must rewrite only `foo`.
    let id = "";
    act(() => {
      id = result.current.addCitation("\\cite{foo,foobar}").id;
    });
    await waitFor(() => {
      expect(result.current.citations.some((c) => c.id === id)).toBe(true);
    });

    act(() => {
      result.current.updateBibKeyAndType("foo", "newfoo", "article");
    });

    // 1. The cascade fanned out.
    await waitFor(() => {
      expect(fanned).toEqual(["foo->newfoo"]);
    });
    // 2. The `.bib` entry was re-keyed (uid unchanged — same identity).
    await waitFor(() => {
      expect(result.current.bibEntries.some((e) => e.key === "newfoo")).toBe(true);
    });
    // 3. The citation refs were boundary-rewritten: `foo` → `newfoo`, `foobar`
    //    UNTOUCHED.
    const cit = result.current.citations.find((c) => c.id === id)!;
    expect(cit.command).toBe("\\cite{newfoo,foobar}");
    expect(cit.keys).toEqual(["newfoo", "foobar"]);
  });

  it("does not fan out when no entry matches the old key", async () => {
    setIdentityCascadeFlag(true);
    beginDocPipeline("doc-ren2");
    const { result } = renderHook(() => useCitations("doc-ren2"));
    await waitFor(() => {
      expect(result.current.bibEntries.length).toBeGreaterThan(0);
    });
    let fired = false;
    act(() => {
      result.current.identityCascade.registerMigrator("bibEntry", () => { fired = true; });
      result.current.updateBibKeyAndType("absent", "x", "article");
    });
    await waitFor(() => {});
    expect(fired).toBe(false);
  });
});

describe("useCitations.updateBibKeyAndType — legacy path (flag OFF)", () => {
  it("renames .bib + refs WITHOUT a cascade fan-out (parity)", async () => {
    setIdentityCascadeFlag(false);
    beginDocPipeline("doc-ren-legacy");
    const { result } = renderHook(() => useCitations("doc-ren-legacy"));
    await waitFor(() => {
      expect(result.current.bibEntries.some((e) => e.key === "foo")).toBe(true);
    });

    let fired = false;
    let id = "";
    act(() => {
      result.current.identityCascade.registerMigrator("bibEntry", () => { fired = true; });
      id = result.current.addCitation("\\cite{foo}").id;
    });
    await waitFor(() => {
      expect(result.current.citations.some((c) => c.id === id)).toBe(true);
    });

    act(() => {
      result.current.updateBibKeyAndType("foo", "newfoo", "article");
    });

    await waitFor(() => {
      expect(result.current.bibEntries.some((e) => e.key === "newfoo")).toBe(true);
    });
    // Refs still rename on the legacy path.
    expect(result.current.citations.find((c) => c.id === id)!.command).toBe("\\cite{newfoo}");
    // But the cascade was NOT invoked (flag OFF).
    expect(fired).toBe(false);
  });
});
