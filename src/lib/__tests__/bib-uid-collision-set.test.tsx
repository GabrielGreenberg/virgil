// @vitest-environment jsdom
//
// Task 693 — a bib uid is minted against the uids already in scope, or not
// minted at all.
//
// `BibEntry.uid` is the durable identity this paper's sidecars key on:
// annotations (`useAnnotations`) and bib-review rows (`useBibReview`) address
// an entry by uid. It is a 4-char hex id — a 65,536-value space — and two mint
// sites drew from it with NO collision set:
//
//   * `useLibraryMasterBib` minted one per entry as master.bib crossed the
//     library→paper seam, so a library of a few hundred entries was more
//     likely than not to hold an internal duplicate by the birthday bound;
//   * the panel's "Save under new citekey" minted bare.
//
// And `addBibEntry`'s re-mint guard read `used.has(uid) && !entry.uid`, so a
// caller-supplied colliding uid — which is exactly what both sites supply —
// was accepted verbatim. Two of this paper's entries could then share one uid,
// after which an annotation written on either was read on, and overwrote, the
// other (the leak leg below measures that mechanism directly).
//
// The fix is a door, not a patch: `mintBibUid` REQUIRES the set, so no call
// site has a setless spelling to reach for; `bibUidsOf` is the one way to name
// "the uids already in scope"; the library seam mints NOTHING (its entries are
// previews of another file — `NO_BIB_UID` — and could not be fixed by passing
// a set anyway, since a real master.bib runs to 34k–100k entries against a
// 65,536 space); and the guard drops its provenance clause.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async () => ({})),
  readSidecarIfExists: vi.fn(async () => ({})),
  writeSidecar: vi.fn(async () => undefined),
  readBib: vi.fn(async () => ({
    bibText: "@article{foo,\n  title = {Orig}\n}\n",
    detectedPackage: undefined,
  })),
  mutateBib: vi.fn(async () => null),
}));

import { renderHook, act, waitFor } from "@testing-library/react";
import { bibUidsOf, mintBibUid, NO_BIB_UID } from "@/lib/bib-uid";
import { generateShortId } from "@/lib/uuid";
import type { BibEntry } from "@/lib/types";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const HEX4 = /^[0-9a-f]{4}$/;

/** `generateShortId` reads `Math.random().toString(16).slice(2, 6)`. */
const randomYielding = (...ids: string[]) => {
  const queue = ids.map((id) => parseInt(id, 16) / 0x10000);
  return vi.spyOn(Math, "random").mockImplementation(() => queue.shift() ?? 0.5);
};

/** Every draw comes back as the SAME id — the worst case a collision set exists
 *  to survive, and the shape a setless minter cannot tell from a good draw. */
const randomAlways = (id: string) =>
  vi.spyOn(Math, "random").mockReturnValue(parseInt(id, 16) / 0x10000);

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// The door
// ---------------------------------------------------------------------------

describe("task 693 — the mint door", () => {
  it("the id source is what the legs think it is (canary)", () => {
    randomYielding("aaaa");
    expect(Math.random().toString(16).slice(2, 6)).toBe("aaaa");
  });

  it("never returns an id the set already holds, however long the run of collisions", () => {
    randomYielding("abcd", "abcd", "abcd", "beef");
    expect(mintBibUid(new Set(["abcd"]))).toBe("beef");
  });

  it("a swept mint over a growing set never repeats", () => {
    const used = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const id = mintBibUid(used);
      expect(id).toMatch(HEX4);
      expect(used.has(id)).toBe(false);
      used.add(id);
    }
    expect(used.size).toBe(300);
  });

  it("the pre-693 spelling, for contrast: a setless draw takes a taken id", () => {
    randomYielding("abcd", "beef");
    expect(generateShortId()).toBe("abcd");
  });

  it("bibUidsOf names only the uids that actually exist", () => {
    const set = bibUidsOf([
      { uid: "aaaa" },
      { uid: NO_BIB_UID },
      { uid: undefined },
      { uid: "bbbb" },
      { uid: "aaaa" },
    ]);
    expect([...set].sort()).toEqual(["aaaa", "bbbb"]);
    expect(set.has(NO_BIB_UID)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The library seam — a preview carries no identity
// ---------------------------------------------------------------------------

describe("task 693 — the library→paper seam mints nothing", () => {
  it("a master.bib of many entries produces no durable uid, and so no duplicate", async () => {
    // 400 entries under a Math.random that ALWAYS answers the same draw: the
    // pre-fix `entries.map((e) => ({ ...e, uid: mintBibUid() }))` gives every
    // one of them the id "abcd", which is the collision this task is about.
    const LIB = Array.from({ length: 400 }, (_, i) => ({
      key: `lib${i}`,
      type: "article",
      fields: { title: `Entry ${i}` },
      raw: "",
    }));
    randomAlways("abcd");

    vi.doMock("@library/hooks/useMasterBib", () => ({
      useMasterBib: () => ({ entries: LIB, error: null }),
    }));
    vi.doMock("@library/lib/catalog-store", () => ({
      useCatalogItems: () => ({ entries: [], revision: 0, hasFolder: false }),
    }));
    vi.doMock("@library/lib/library-storage", () => ({
      getLibraryHandle: async () => null,
      ROOT_FILES: {},
    }));
    const { useLibraryMasterBib } = await import("@/hooks/useLibrary");

    const { result } = renderHook(() => useLibraryMasterBib());
    await waitFor(() => expect(result.current.entries.length).toBe(400));

    const entries = result.current.entries;
    // The contract, stated the way it fails pre-fix: the number of DURABLE
    // uids in the list equals the number of DISTINCT durable uids. Pre-fix
    // that reads 400 vs 1.
    const carried = entries.filter((e) => e.uid).length;
    expect(carried).toBe(bibUidsOf(entries).size);
    // And the stronger fact this fix rests on: a preview carries none at all.
    expect(carried).toBe(0);
    expect(entries.every((e) => e.uid === NO_BIB_UID)).toBe(true);

    vi.doUnmock("@library/hooks/useMasterBib");
    vi.doUnmock("@library/lib/catalog-store");
    vi.doUnmock("@library/lib/library-storage");
  });
});

// ---------------------------------------------------------------------------
// The add door — a colliding uid is re-minted whoever proposed it
// ---------------------------------------------------------------------------

describe("task 693 — addBibEntry re-mints a colliding uid regardless of provenance", () => {
  beforeEach(async () => {
    const { __resetForTests } = await import("@/lib/multi-window/doc-pipeline");
    __resetForTests();
  });

  async function mount(docId: string) {
    const { beginDocPipeline } = await import("@/lib/multi-window/doc-pipeline");
    const { useCitations } = await import("@/hooks/useCitations");
    beginDocPipeline(docId);
    const { result } = renderHook(() => useCitations(docId));
    await waitFor(() => {
      expect(result.current.bibEntries.some((e) => e.key === "foo")).toBe(true);
    });
    return result;
  }

  it("a CALLER-SUPPLIED uid that collides with a live entry is re-minted", async () => {
    const result = await mount("doc-693-supplied");
    const taken = result.current.bibEntries.find((e) => e.key === "foo")!.uid;
    expect(taken).toBeTruthy();

    // The shape the panel/library used to produce: an entry arriving with a
    // uid that is already this paper's. Pre-fix the `&& !entry.uid` clause
    // exempted it and the two entries ended up sharing `taken`.
    randomYielding(taken, "beef");
    act(() => {
      result.current.addBibEntry({
        uid: taken,
        key: "bar",
        type: "article",
        fields: { title: "Arriving with a taken uid" },
        raw: "",
      } as BibEntry);
    });

    await waitFor(() => {
      expect(result.current.bibEntries.some((e) => e.key === "bar")).toBe(true);
    });
    const entries = result.current.bibEntries;
    expect(bibUidsOf(entries).size).toBe(entries.length);
    expect(entries.find((e) => e.key === "bar")!.uid).not.toBe(taken);
  });

  it("a NON-colliding caller-supplied uid is still kept verbatim (a `\\vbid` round-trip)", async () => {
    const result = await mount("doc-693-kept");
    act(() => {
      result.current.addBibEntry({
        uid: "c0de",
        key: "bar",
        type: "article",
        fields: { title: "Carries its own marker" },
        raw: "",
      } as BibEntry);
    });
    await waitFor(() => {
      expect(result.current.bibEntries.some((e) => e.key === "bar")).toBe(true);
    });
    expect(result.current.bibEntries.find((e) => e.key === "bar")!.uid).toBe("c0de");
  });

  it("a preview arriving with NO_BIB_UID is minted one at the door", async () => {
    const result = await mount("doc-693-preview");
    act(() => {
      result.current.addBibEntry({
        uid: NO_BIB_UID,
        key: "bar",
        type: "article",
        fields: { title: "A library preview, added" },
        raw: "",
      } as BibEntry);
    });
    await waitFor(() => {
      expect(result.current.bibEntries.some((e) => e.key === "bar")).toBe(true);
    });
    const entries = result.current.bibEntries;
    expect(entries.find((e) => e.key === "bar")!.uid).toMatch(HEX4);
    expect(bibUidsOf(entries).size).toBe(entries.length);
  });
});

// ---------------------------------------------------------------------------
// Why it matters — the mechanism a shared uid puts the user's writing through
// ---------------------------------------------------------------------------

describe("task 693 — a shared uid cross-contaminates annotations", () => {
  const ENTRY = (uid: string, key: string): BibEntry =>
    ({ uid, key, type: "article", fields: { title: key }, raw: "" }) as BibEntry;

  async function annotations(docId: string, entries: BibEntry[]) {
    const { setIdentityCascadeFlag } = await import("@/lib/identity/identity-flag");
    setIdentityCascadeFlag(true);
    const { useAnnotations } = await import("@/hooks/useAnnotations");
    const byKey = new Map(entries.map((e) => [e.key, e]));
    const { result } = renderHook(() =>
      useAnnotations(docId, (k: string) => byKey.get(k), entries),
    );
    return result;
  }

  afterEach(async () => {
    const { setIdentityCascadeFlag } = await import("@/lib/identity/identity-flag");
    setIdentityCascadeFlag(undefined);
  });

  it("MEASURED: two entries sharing a uid read each other's annotation", async () => {
    // Not a defect of `useAnnotations` — it is the correct behaviour of a
    // uid-keyed store, and it is exactly why the uid must be unique. This leg
    // is what makes the three above load-bearing rather than decorative.
    const shared = [ENTRY("dupe", "alpha"), ENTRY("dupe", "beta")];
    const result = await annotations("doc-693-leak", shared);
    await waitFor(() => expect(result.current.getAnnotation("alpha")).toBe(""));
    act(() => result.current.setAnnotation("alpha", "<p>Alpha's note</p>"));
    await waitFor(() =>
      expect(result.current.getAnnotation("beta")).toBe("<p>Alpha's note</p>"),
    );
  });

  it("with distinct uids — what every mint site now guarantees — nothing leaks", async () => {
    const distinct = [ENTRY("aaaa", "alpha"), ENTRY("bbbb", "beta")];
    const result = await annotations("doc-693-clean", distinct);
    await waitFor(() => expect(result.current.getAnnotation("alpha")).toBe(""));
    act(() => result.current.setAnnotation("alpha", "<p>Alpha's note</p>"));
    await waitFor(() =>
      expect(result.current.getAnnotation("alpha")).toBe("<p>Alpha's note</p>"),
    );
    expect(result.current.getAnnotation("beta")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// The leg with teeth — the census
// ---------------------------------------------------------------------------

describe("task 693 — census: no bib uid is minted without a set", () => {
  const SOURCE_ROOTS = ["src", "library", "editor"];

  const sourceFiles = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => {
      let rows: fs.Dirent[];
      try {
        rows = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const r of rows) {
        const p = path.join(dir, r.name);
        if (r.isDirectory()) {
          if (r.name === "node_modules" || r.name === ".next") continue;
          walk(p);
        } else if (/\.tsx?$/.test(r.name)) {
          out.push(p);
        }
      }
    };
    for (const root of SOURCE_ROOTS) walk(path.join(REPO_ROOT, root));
    return out;
  };

  const files = sourceFiles().filter((f) => !/__tests__/.test(f));

  /**
   * A file's CODE — comments stripped.
   *
   * The census asks what the app DOES, and a retired spelling quoted in a
   * comment explaining why it is retired is the opposite of an offender. (The
   * `://` guard keeps a URL in a string from being read as a line comment.)
   */
  const codeOf = (f: string): string =>
    fs
      .readFileSync(f, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  it("the population is non-empty and holds the bib mint sites (canary)", () => {
    const rel = new Set(files.map((f) => path.relative(REPO_ROOT, f)));
    expect(rel.has("src/lib/bib-uid.ts")).toBe(true);
    expect(rel.has("src/hooks/useCitations.ts")).toBe(true);
    expect(rel.has("src/hooks/useLibrary.ts")).toBe(true);
    expect(rel.has("src/panels/Bibliography/BibliographyPanel.tsx")).toBe(true);
  });

  it("no call site spells `mintBibUid()` — the setless mint has no spelling", () => {
    const offenders = files.filter((f) => /\bmintBibUid\(\s*\)/.test(codeOf(f)));
    expect(offenders.map((f) => path.relative(REPO_ROOT, f))).toEqual([]);
  });

  it("the door's own signature keeps the set REQUIRED", () => {
    const src = codeOf(path.join(REPO_ROOT, "src/lib/bib-uid.ts"));
    expect(src).toMatch(/export function mintBibUid\(existing: Set<string>\)/);
    // The optional-parameter spelling is the defect, in one character.
    expect(src).not.toMatch(/mintBibUid\(existing\?:/);
  });

  it("the add door's re-mint guard asks only whether the uid is TAKEN", () => {
    const src = codeOf(path.join(REPO_ROOT, "src/hooks/useCitations.ts"));
    expect(src).toMatch(/used\.has\(uid\) \? mintBibUid\(used\) : uid/);
    // The provenance exemption — a colliding uid accepted because a caller
    // proposed it — stays retired.
    expect(src).not.toMatch(/&&\s*!entry\.uid/);
  });

  it("the library seam does not mint at all", () => {
    const src = codeOf(path.join(REPO_ROOT, "src/hooks/useLibrary.ts"));
    expect(src).not.toMatch(/\bmintBibUid\b/);
    expect(src).toContain("NO_BIB_UID");
  });

  it("every uid set on the bib path is derived through the one door", () => {
    // `new Set(<list>.map((e) => e.uid)…)` is the hand-rolled spelling
    // `bibUidsOf` replaced; a second spelling is how two sites drift on what
    // counts as a member.
    const offenders = files.filter((f) =>
      /new Set\([^)]*\.map\(\([^)]*\) => \w+\.uid\)/.test(codeOf(f)),
    );
    expect(offenders.map((f) => path.relative(REPO_ROOT, f))).toEqual([]);
  });
});
