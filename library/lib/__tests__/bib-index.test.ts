// @vitest-environment node
//
// Slim browse-index reader + on-demand full-entry extraction. The browse path
// must read slim records (no citation-js); the edit/format path must still get
// the FULL entry for a citekey even when a malformed entry precedes it.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { readTextFile } = vi.hoisted(() => ({ readTextFile: vi.fn() }));
vi.mock("@library/lib/library-storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@library/lib/library-storage")>()),
  readTextFile,
}));

import { readBibIndex, readBibIndexStamp } from "../bib-index";
import { getFullLibraryBibEntry } from "../bib-entry-full";

const handle = {} as unknown as FileSystemDirectoryHandle;
beforeEach(() => readTextFile.mockReset());

describe("readBibIndex — slim → BibEntry mapping", () => {
  it("widens compact records to BibEntry shape with raw=''", async () => {
    readTextFile.mockImplementation(async (_h: unknown, path?: string) =>
      path?.endsWith("bib-index.json")
        ? JSON.stringify({
            v: 1,
            stamp: "s1",
            entries: [
              { k: "smith2020", t: "A Title", a: "Smith, Jane", y: "2020", d: "10.x/y", j: "J Phil", b: "Coll" },
              { k: "barekey" },
            ],
          })
        : undefined,
    );
    const res = await readBibIndex(handle);
    expect(res).not.toBeNull();
    expect(res!.stamp).toBe("s1");
    expect(res!.entries).toHaveLength(2);
    const e = res!.entries[0];
    expect(e.key).toBe("smith2020");
    expect(e.type).toBe("misc");
    expect(e.raw).toBe("");
    expect(e.fields).toEqual({
      title: "A Title", author: "Smith, Jane", year: "2020",
      doi: "10.x/y", journal: "J Phil", booktitle: "Coll",
    });
    // A record with only a citekey yields empty fields (not undefined values).
    expect(res!.entries[1].fields).toEqual({});
  });

  it("widens the full browse-field set (editor + pub details)", async () => {
    readTextFile.mockImplementation(async (_h: unknown, path?: string) =>
      path?.endsWith("bib-index.json")
        ? JSON.stringify({
            v: 1, stamp: "s",
            entries: [{ k: "vol", e: "Ed, Eve", v: "3", n: "2", p: "10-20", q: "Pub", s: "Ser" }],
          })
        : undefined,
    );
    const res = await readBibIndex(handle);
    expect(res!.entries[0].fields).toEqual({
      editor: "Ed, Eve", volume: "3", number: "2", pages: "10-20", publisher: "Pub", series: "Ser",
    });
  });

  it("projects the bib.state (bs) field into stateByKey, ignoring stray values (F#4)", async () => {
    readTextFile.mockImplementation(async (_h: unknown, path?: string) =>
      path?.endsWith("bib-index.json")
        ? JSON.stringify({
            v: 1, stamp: "s",
            entries: [
              { k: "auth", t: "A", bs: "authenticated" },
              { k: "ms", bs: "manuscript" },
              { k: "nostate", t: "B" }, // no bs → absent from the map
              { k: "bogus", bs: "wat" }, // invalid state → ignored
            ],
          })
        : undefined,
    );
    const res = await readBibIndex(handle);
    expect(res).not.toBeNull();
    expect(res!.stateByKey.get("auth")).toBe("authenticated");
    expect(res!.stateByKey.get("ms")).toBe("manuscript");
    expect(res!.stateByKey.has("nostate")).toBe(false);
    expect(res!.stateByKey.has("bogus")).toBe(false);
    expect(res!.stateByKey.size).toBe(2);
  });

  it("recognizes the canonical needs-reauth state (F#4 reconciliation round-trip)", async () => {
    // apply_metadata_mismatch_policy.py writes `needs-reauth`; before the
    // reconciliation the reader dropped it to "none". Now it round-trips —
    // writer and reader share one canonical set
    // (library/scripts/_tools.py CANONICAL_BIB_STATES ↔ VALID_BIB_STATES).
    readTextFile.mockImplementation(async (_h: unknown, path?: string) =>
      path?.endsWith("bib-index.json")
        ? JSON.stringify({
            v: 1, stamp: "s",
            entries: [{ k: "mismatch", t: "A Book", bs: "needs-reauth" }],
          })
        : undefined,
    );
    const res = await readBibIndex(handle);
    expect(res).not.toBeNull();
    expect(res!.stateByKey.get("mismatch")).toBe("needs-reauth");
  });

  it("returns null on a CORRUPT index (truncated JSON) → caller falls back", async () => {
    readTextFile.mockImplementation(async (_h: unknown, path?: string) =>
      path?.endsWith("bib-index.json") ? '{"v":1,"entries":[{"k":"a"' : undefined,
    );
    expect(await readBibIndex(handle)).toBeNull();
  });

  it("returns null when the index is absent (the fallback signal)", async () => {
    readTextFile.mockResolvedValue(undefined);
    expect(await readBibIndex(handle)).toBeNull();
    expect(await readBibIndexStamp(handle)).toBeNull();
  });

  it("reads and trims the tiny stamp file", async () => {
    readTextFile.mockImplementation(async (_h: unknown, path?: string) =>
      path?.endsWith("bib-index.stamp") ? "12345:678\n" : undefined,
    );
    expect(await readBibIndexStamp(handle)).toBe("12345:678");
  });
});

describe("getFullLibraryBibEntry — single full entry on demand", () => {
  const MASTER = `@article{good1,
  title = {Good One},
  author = {Real, Ann},
  year = {1999},
  journal = {J},
}

@article{malformed,
  title = {Bad {unbalanced},
  author = {Broken, Bob},
}

@book{good2,
  title = {Good Two},
  author = {Author, Cee},
  year = {2001},
  publisher = {A Press},
}
`;

  it("extracts a full entry that FOLLOWS a brace-malformed entry", async () => {
    readTextFile.mockResolvedValue(MASTER);
    const e = await getFullLibraryBibEntry(handle, "good2");
    expect(e).not.toBeNull();
    expect(e!.key).toBe("good2");
    expect(e!.fields.title).toBe("Good Two");
    // FULL fields (publisher is NOT in the slim browse projection)…
    expect(e!.fields.publisher).toBe("A Press");
    // …and the raw block is preserved for serialize/format fidelity.
    expect(e!.raw).toContain("@book{good2");
  });

  it("extracts the first entry too", async () => {
    readTextFile.mockResolvedValue(MASTER);
    const e = await getFullLibraryBibEntry(handle, "good1");
    expect(e!.key).toBe("good1");
    expect(e!.fields.journal).toBe("J");
  });

  it("returns null for an absent citekey or missing master.bib", async () => {
    readTextFile.mockResolvedValue(MASTER);
    expect(await getFullLibraryBibEntry(handle, "nope")).toBeNull();
    readTextFile.mockResolvedValue(undefined);
    expect(await getFullLibraryBibEntry(handle, "good1")).toBeNull();
  });
});
