/**
 * Task 1115 — the library-storage read door states its outcome honestly.
 *
 * `undefined` means ONE thing: the entry is not there (`NotFoundError` /
 * `TypeMismatchError`, at any step — directory walk, handle lookup, or the
 * final `getFile()` racing a move). Every other failure (permission, IO)
 * REJECTS, uniformly, so a caller can tell "no PDF on disk" from "couldn't
 * read it". Before the fix lookups swallowed every error (a permission lapse
 * read as "missing") while `getFile()` leaked every error (a vanished file
 * left PdfView on "Loading PDF…" forever).
 */
import { describe, expect, it } from "vitest";
import {
  fileExists,
  isMissingEntryError,
  listDir,
  readFile,
  readJsonFile,
  readTextFile,
} from "../library-storage";

type Fail = { lookup?: string; getFile?: string };

/** A one-level fake: `root/<dir>/<file>`. `fail.*` names a DOMException to
 *  throw at that step instead of succeeding. */
function fakeRoot(opts: { dirFail?: string; fail?: Fail; text?: string } = {}) {
  const file = {
    kind: "file" as const,
    async getFile() {
      if (opts.fail?.getFile) throw new DOMException("x", opts.fail.getFile);
      return new File([opts.text ?? "hello"], "f.txt");
    },
  };
  const dir = {
    kind: "directory" as const,
    async getFileHandle(name: string) {
      if (opts.fail?.lookup) throw new DOMException("x", opts.fail.lookup);
      if (name !== "f.txt") throw new DOMException("nope", "NotFoundError");
      return file;
    },
    async *entries() {
      yield ["f.txt", file] as const;
    },
  };
  const root = {
    async getDirectoryHandle(name: string) {
      if (opts.dirFail) throw new DOMException("x", opts.dirFail);
      if (name !== "d") throw new DOMException("nope", "NotFoundError");
      return dir;
    },
  };
  return root as unknown as FileSystemDirectoryHandle;
}

describe("library-storage read door — missing vs failed (task 1115)", () => {
  it("classifies absence by name only", () => {
    expect(isMissingEntryError(new DOMException("", "NotFoundError"))).toBe(true);
    expect(isMissingEntryError(new DOMException("", "TypeMismatchError"))).toBe(true);
    expect(isMissingEntryError({ name: "NotFoundError" })).toBe(true);
    expect(isMissingEntryError(new DOMException("", "NotAllowedError"))).toBe(false);
    expect(isMissingEntryError(new Error("boom"))).toBe(false);
    expect(isMissingEntryError(null)).toBe(false);
  });

  it("reads a present file", async () => {
    const root = fakeRoot({ text: '{"a":1}' });
    expect(await readTextFile(root, "d/f.txt")).toBe('{"a":1}');
    expect(await readJsonFile(root, "d/f.txt")).toEqual({ a: 1 });
    expect((await readFile(root, "d/f.txt"))?.size).toBe(7);
    expect(await fileExists(root, "d/f.txt")).toBe(true);
    expect(await listDir(root, "d")).toEqual([{ name: "f.txt", kind: "file" }]);
  });

  it("absent at every step → undefined / false, never a rejection", async () => {
    const root = fakeRoot();
    expect(await readFile(root, "nodir/f.txt")).toBeUndefined();
    expect(await readFile(root, "d/other.txt")).toBeUndefined();
    expect(await readTextFile(root, "d/other.txt")).toBeUndefined();
    expect(await fileExists(root, "nodir/f.txt")).toBe(false);
    expect(await listDir(root, "nodir")).toBeUndefined();
    // Wrong kind of entry is absence too.
    expect(await readFile(fakeRoot({ dirFail: "TypeMismatchError" }), "d/f.txt")).toBeUndefined();
    // A file that vanished between lookup and read (sync client, triage move).
    const raced = fakeRoot({ fail: { getFile: "NotFoundError" } });
    expect(await readFile(raced, "d/f.txt")).toBeUndefined();
    expect(await readTextFile(raced, "d/f.txt")).toBeUndefined();
  });

  it("a real failure REJECTS at every step — lookup and getFile() alike", async () => {
    const atDir = fakeRoot({ dirFail: "NotAllowedError" });
    await expect(readFile(atDir, "d/f.txt")).rejects.toMatchObject({ name: "NotAllowedError" });
    await expect(listDir(atDir, "d")).rejects.toMatchObject({ name: "NotAllowedError" });
    await expect(fileExists(atDir, "d/f.txt")).rejects.toMatchObject({ name: "NotAllowedError" });

    const atLookup = fakeRoot({ fail: { lookup: "NotAllowedError" } });
    await expect(readTextFile(atLookup, "d/f.txt")).rejects.toMatchObject({ name: "NotAllowedError" });
    await expect(fileExists(atLookup, "d/f.txt")).rejects.toMatchObject({ name: "NotAllowedError" });

    const atRead = fakeRoot({ fail: { getFile: "NotReadableError" } });
    await expect(readFile(atRead, "d/f.txt")).rejects.toMatchObject({ name: "NotReadableError" });
    await expect(readJsonFile(atRead, "d/f.txt")).rejects.toMatchObject({ name: "NotReadableError" });
  });
});
