// @vitest-environment jsdom
//
// `updateBibKeyAndType` routes a citekey rename through the IdentityCascade —
// on EVERY build, not only where an opt-in flag is set (task 689).
//
// The defect this suite now pins used to be pinned the other way round. The
// cascade fan-out — the editor `\cite{}` doc-rewrite, the float-key remap, the
// panel selection re-point, the sidecar re-keys — lived entirely inside the
// flag-ON branch of this one function, and `virgil:identity-cascade` is
// `default: false`. So on every shipping build a rename rewrote
// `references.bib` and stopped: the paper's `\cite{oldKey}` atoms dangled, and
// the next `syncFromEditor` re-derived `citations.json` from those unrewritten
// atoms and UNDID the sidecar half. The old leg here asserted that
// ("the cascade was NOT invoked (flag OFF)") — a suite pinning the bug green.
//
// Pins now:
//  - the rename fans out to registered cascade migrators with the flag
//    explicitly OFF (this FAILS on the pre-fix tree);
//  - PARITY: flag ON and flag OFF produce the same user-visible result;
//  - the refs rewrite uses the boundary matcher on BOTH paths, so a
//    PUNCTUATION citekey (`smith:2020`) renames as a whole token — the bare
//    `\b` the legacy branch carried mis-fires on it;
//  - a rename of a key no entry holds still fans out to nothing.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async () => ({})),
  readSidecarIfExists: vi.fn(async () => ({})),
  writeSidecar: vi.fn(async () => undefined),
  readBib: vi.fn(async () => ({
    // `foo` and `foobar` so we can prove the boundary matcher; `smith:2020`
    // so we can prove the punctuation citekey.
    bibText:
      "@article{foo,\n  title = {A}\n}\n@article{foobar,\n  title = {B}\n}\n" +
      "@article{smith:2020,\n  title = {C}\n}\n",
    detectedPackage: undefined,
  })),
  mutateBib: vi.fn(async () => null),
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

/** Mount the hook on a fresh doc and wait for the `.bib` parse. */
async function mountLoaded(docId: string) {
  beginDocPipeline(docId);
  const { result } = renderHook(() => useCitations(docId));
  await waitFor(() => {
    expect(result.current.bibEntries.some((e) => e.key === "foo")).toBe(true);
  });
  return result;
}

/**
 * Rename `foo` → `newfoo` on a doc citing `\cite{foo,foobar}`, recording the
 * cascade fan-out. Returns what a user could SEE afterwards, so the two flag
 * settings can be compared field for field.
 */
async function renameUnderFlag(flag: boolean, docId: string) {
  setIdentityCascadeFlag(flag);
  const result = await mountLoaded(docId);

  const fanned: string[] = [];
  let id = "";
  act(() => {
    result.current.identityCascade.registerMigrator("bibEntry", (c) => {
      if (isRenameCitekey(c)) {
        fanned.push(`${c.renameCitekey.oldKey}->${c.renameCitekey.newKey}`);
      }
    });
    id = result.current.addCitation("\\cite{foo,foobar}").id;
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

  const cit = result.current.citations.find((c) => c.id === id)!;
  return { fanned, command: cit.command, keys: cit.keys, result };
}

describe("updateBibKeyAndType: the rename fans out on EVERY build", () => {
  it("fans out with the cascade flag explicitly OFF (the shipping default)", async () => {
    // THE leg. Pre-fix this is `[]`: the fan-out sat inside `if (flagOn)`, so
    // the editor `\cite{}` rewrite registered in EditorPane never ran and the
    // paper's citations dangled.
    const { fanned } = await renameUnderFlag(false, "doc-ren-off");
    expect(fanned).toEqual(["foo->newfoo"]);
  });

  it("fans out with the flag ON", async () => {
    const { fanned } = await renameUnderFlag(true, "doc-ren-on");
    expect(fanned).toEqual(["foo->newfoo"]);
  });

  it("PARITY: flag ON and flag OFF produce the same user-visible rename", async () => {
    const off = await renameUnderFlag(false, "doc-parity-off");
    const on = await renameUnderFlag(true, "doc-parity-on");
    expect(off.fanned).toEqual(on.fanned);
    expect(off.command).toEqual(on.command);
    expect(off.keys).toEqual(on.keys);
    // And the shared answer is the RIGHT one: `foobar` is not clobbered.
    expect(off.command).toBe("\\cite{newfoo,foobar}");
    expect(off.keys).toEqual(["newfoo", "foobar"]);
  });

  it("rewrites the `.bib` key on both paths", async () => {
    for (const [flag, docId] of [
      [false, "doc-bibkey-off"],
      [true, "doc-bibkey-on"],
    ] as const) {
      const { result } = await renameUnderFlag(flag, docId);
      expect(result.current.bibEntries.some((e) => e.key === "newfoo")).toBe(true);
      expect(result.current.bibEntries.some((e) => e.key === "foo")).toBe(false);
    }
  });

  it("does not fan out when no entry matches the old key", async () => {
    setIdentityCascadeFlag(false);
    const result = await mountLoaded("doc-ren-absent");
    let fired = false;
    act(() => {
      result.current.identityCascade.registerMigrator("bibEntry", () => {
        fired = true;
      });
      result.current.updateBibKeyAndType("absent", "x", "article");
    });
    await waitFor(() => {});
    expect(fired).toBe(false);
  });
});

describe("updateBibKeyAndType: the boundary matcher, on both paths", () => {
  // The legacy branch rewrote refs with a bare `\b`, which has no boundary at a
  // `:` — so `smith:2020` → `newsmith:2020` (the `smith` half rewritten, the
  // key mangled). It survived only because the branch was pinned as-is.
  it.each([
    ["flag OFF", false, "doc-punct-off"],
    ["flag ON", true, "doc-punct-on"],
  ])("renames a PUNCTUATION citekey as a whole token (%s)", async (_label, flag, docId) => {
    setIdentityCascadeFlag(flag);
    const result = await mountLoaded(docId);
    let id = "";
    act(() => {
      id = result.current.addCitation("\\cite{smith:2020}").id;
    });
    await waitFor(() => {
      expect(result.current.citations.some((c) => c.id === id)).toBe(true);
    });
    act(() => {
      result.current.updateBibKeyAndType("smith:2020", "smith:2021", "article");
    });
    await waitFor(() => {
      expect(result.current.bibEntries.some((e) => e.key === "smith:2021")).toBe(true);
    });
    const cit = result.current.citations.find((c) => c.id === id)!;
    expect(cit.command).toBe("\\cite{smith:2021}");
    expect(cit.keys).toEqual(["smith:2021"]);
  });
});
