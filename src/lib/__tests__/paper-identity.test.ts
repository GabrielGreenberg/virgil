// @vitest-environment jsdom
//
// Task 1250 — paper identity is the folder ENTRY, never its basename.
//
// Recommendation letters each live in a folder called `letter/` holding
// `main.tex`. The registration door used to ask "have I seen this paper?"
// with `folderName === handle.name && texFilename === …`, so every letter
// after the first matched the FIRST letter's row: same id, same hand-edited
// title, same tab — and the old row's stored handle was silently re-pointed
// at the new folder, so every per-id store (sidecars, emergency mirror,
// Recents) was shared by two unrelated papers.
//
// The fake handles below carry a private PATH; `isSameEntry` compares it, as
// the File System Access API does. Neutered against the pre-1250
// registerDocInFolder: the two-letters leg yields one id and re-points A.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

const idb = vi.hoisted(() => {
  const data = new Map<string, unknown>();
  const clone = <T>(v: T): T => {
    try {
      return v === undefined ? v : (structuredClone(v) as T);
    } catch {
      return v;
    }
  };
  return {
    data,
    api: {
      createStore: () => ({}),
      get: async (key: string) => clone(data.get(key)),
      set: async (key: string, value: unknown) => {
        data.set(key, clone(value));
      },
      del: async (key: string) => {
        data.delete(key);
      },
      keys: async () => [...data.keys()],
      update: async (key: string, updater: (old: unknown) => unknown) => {
        data.set(key, clone(updater(clone(data.get(key)))));
      },
    },
  };
});

vi.mock("idb-keyval", () => idb.api);
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));
vi.mock("@/lib/storage-mode", () => ({ isDevStorage: false }));

import { readIndex } from "@/lib/doc-index";
import {
  findKnownDoc,
  registerDocInFolder,
  renameDoc,
} from "@/lib/storage-fsa";
import { walkFiles } from "./_source-scan";

type FakeHandle = FileSystemDirectoryHandle & { __path: string };

/** A folder handle whose basename is the last path segment. */
function folderAt(path: string): FakeHandle {
  const h = {
    __path: path,
    name: path.split("/").pop()!,
    kind: "directory",
    getDirectoryHandle: async () => ({}),
    isSameEntry: async (other: { __path?: string }) => other?.__path === path,
  };
  return h as unknown as FakeHandle;
}

const storedHandle = (id: string) =>
  idb.data.get(`doc-handle/${id}`) as FakeHandle | undefined;

beforeEach(() => {
  idb.data.clear();
  idb.data.set("index", { docs: [] });
});

describe("paper identity is the folder entry, not its basename", () => {
  it("two different folders both named `letter` with main.tex are two papers", async () => {
    const a = await registerDocInFolder(folderAt("/rec/alonso/letter"), "main.tex");
    await renameDoc(a.id, "Alonso Letter");
    const b = await registerDocInFolder(folderAt("/rec/yildiz/letter"), "main.tex");

    expect(b.id).not.toBe(a.id);
    expect(b.name).toBe("letter"); // the default, not A's hand-edited title
    const idx = await readIndex();
    expect(idx.docs.map((d) => d.id).sort()).toEqual([a.id, b.id].sort());
    expect(idx.docs.find((d) => d.id === a.id)!.name).toBe("Alonso Letter");
    // A's handle is NOT re-pointed at B's folder.
    expect(storedHandle(a.id)!.__path).toBe("/rec/alonso/letter");
    expect(storedHandle(b.id)!.__path).toBe("/rec/yildiz/letter");
  });

  it("reopening the SAME folder reuses its paper and refreshes its handle", async () => {
    const first = await registerDocInFolder(folderAt("/rec/alonso/letter"), "main.tex");
    await renameDoc(first.id, "Alonso Letter");
    const fresh = folderAt("/rec/alonso/letter"); // a new handle object, same entry
    const again = await registerDocInFolder(fresh, "main.tex");

    expect(again.id).toBe(first.id);
    expect(again.name).toBe("Alonso Letter");
    expect(storedHandle(first.id)).toBe(fresh);
    expect((await readIndex()).docs).toHaveLength(1);
  });

  it("findKnownDoc answers only on isSameEntry", async () => {
    const a = await registerDocInFolder(folderAt("/x/letter"), "main.tex");
    expect((await findKnownDoc(folderAt("/x/letter"), "main.tex"))?.id).toBe(a.id);
    expect(await findKnownDoc(folderAt("/y/letter"), "main.tex")).toBeUndefined();
    expect(await findKnownDoc(folderAt("/x/letter"), "other.tex")).toBeUndefined();
  });

  it("a row whose stored handle is missing is never adopted", async () => {
    const a = await registerDocInFolder(folderAt("/x/letter"), "main.tex");
    idb.data.delete(`doc-handle/${a.id}`);
    const b = await registerDocInFolder(folderAt("/x/letter"), "main.tex");
    expect(b.id).not.toBe(a.id);
  });

  it("concurrent registrations: same folder converges, different folders split", async () => {
    const [s1, s2] = await Promise.all([
      registerDocInFolder(folderAt("/p/letter"), "main.tex"),
      registerDocInFolder(folderAt("/p/letter"), "main.tex"),
    ]);
    expect(s1.id).toBe(s2.id);
    const [d1, d2] = await Promise.all([
      registerDocInFolder(folderAt("/q/letter"), "main.tex"),
      registerDocInFolder(folderAt("/r/letter"), "main.tex"),
    ]);
    expect(d1.id).not.toBe(d2.id);
    expect(new Set([s1.id, d1.id, d2.id]).size).toBe(3);
    const handles = [...idb.data.keys()].filter((k) => k.startsWith("doc-handle/"));
    expect(handles.sort()).toEqual(
      [s1.id, d1.id, d2.id].map((id) => `doc-handle/${id}`).sort(),
    );
  });
});

// ── Census ───────────────────────────────────────────────────────────────
// Paper identity has ONE question (`findKnownDoc`). The only place a row's
// `folderName` (a display label) is COMPARED is its prefilter,
// `isIdentityCandidate` in storage-fsa.ts.
describe("census — no identity comparison on folderName outside the one function", () => {
  const ROOT = join(__dirname, "..", "..", "..");
  const files = ["src", "editor", "library"].flatMap((d) =>
    walkFiles(join(ROOT, d), { skipDirs: (n) => n.startsWith(".") }).filter(
      (p) => /\.(ts|tsx)$/.test(p) && !p.includes("__tests__"),
    ),
  );
  // Any `===`/`!==` with a `…folderName` operand. A row comparing its OWN
  // title to its own folder label (`doc.name !== doc.folderName` — "was it
  // renamed?") is a label question, not identity, and is exempt.
  const COMPARE = /([\w.?]+)\s*[!=]==?\s*([\w.?]+)/g;
  const owner = (x: string) => x.replace(/\??\.(folderName|name)$/, "");
  const isLabelSelfCheck = (l: string, r: string) => {
    const [f, n] = /folderName$/.test(l) ? [l, r] : [r, l];
    return /\.name$/.test(n) && owner(f) === owner(n);
  };

  it("folderName is compared only inside isIdentityCandidate", () => {
    const hits: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(COMPARE)) {
        const [, l, r] = m;
        if (!/folderName$/.test(l) && !/folderName$/.test(r)) continue;
        if (isLabelSelfCheck(l, r)) continue;
        const fnName = [...src.slice(0, m.index).matchAll(/function\s+(\w+)/g)].pop()?.[1];
        hits.push(`${relative(ROOT, f)}:${fnName}`);
      }
    }
    expect(hits).toEqual(["src/lib/storage-fsa.ts:isIdentityCandidate"]);
  });
});
