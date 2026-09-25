// @vitest-environment jsdom
//
// Task 762: the custom-library manifest store has ONE mutation door.
// Back-to-back mutations compose, a reload never drops an in-flight write,
// a flush rebases onto the manifest another window wrote (never clobbers it,
// never re-creates a filename renamed elsewhere), and every write announces
// itself so a second instance re-reads.

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

const disk = vi.hoisted(() => ({
  files: new Map<string, string>(),
  gate: null as Promise<void> | null,
  stampWrites: 0,
}));

vi.mock("@library/lib/catalog", () => ({
  readCatalogVersion: async () => "1",
}));

vi.mock("@library/lib/library-folder", () => ({
  getLibraryHandle: async () => ({ name: "root" }),
  queryReadWritePermission: async () => "granted",
}));

vi.mock("@library/lib/library-storage", () => {
  const DIR = ".virgil/libraries";
  return {
    SUBDIRS: { libraries: DIR, unsorted: "unsorted" },
    ensureLibrariesDir: async () => ({}),
    fileExists: async (_r: unknown, p: string) => disk.files.has(p),
    writeTextFile: async (_r: unknown, p: string, t: string) => {
      disk.files.set(p, t);
    },
    listLibraryManifests: async () => {
      const out = [];
      for (const [p, t] of disk.files) {
        if (!p.startsWith(`${DIR}/`)) continue;
        const name = p.slice(DIR.length + 1);
        if (name.startsWith(".") || !name.endsWith(".json")) continue;
        out.push({ filename: name, manifest: JSON.parse(t) });
      }
      return out;
    },
    writeLibraryManifest: async (_r: unknown, f: string, m: unknown) => {
      if (disk.gate) await disk.gate;
      disk.files.set(`${DIR}/${f}`, JSON.stringify(m));
    },
    deleteLibraryManifest: async (_r: unknown, f: string) => {
      disk.files.delete(`${DIR}/${f}`);
    },
    readLibrariesStamp: async () => disk.files.get(`${DIR}/.version`) ?? "",
    writeLibrariesStamp: async (_r: unknown, token: string) => {
      disk.stampWrites += 1;
      disk.files.set(`${DIR}/.version`, token);
    },
  };
});

import { useDiskLibraries } from "@library/hooks/useDiskLibraries";
import { addEntryToLibraryGlobal } from "@library/lib/library-store";
import { enqueueManifestIo } from "@library/lib/manifest-io";

const ROOT = { name: "root" } as unknown as FileSystemDirectoryHandle;
const LIB_ID = "lib-1";

function putManifest(filename: string, citekeys: string[], label = "Foo") {
  disk.files.set(
    `.virgil/libraries/${filename}`,
    JSON.stringify({
      schemaVersion: 1,
      id: LIB_ID,
      label,
      createdAt: 1,
      updatedAt: 1,
      citekeys,
    }),
  );
}

function diskCitekeys(filename = "foo.json"): string[] | undefined {
  const t = disk.files.get(`.virgil/libraries/${filename}`);
  return t ? (JSON.parse(t).citekeys as string[]) : undefined;
}

/** Let the io chain drain (a flush may enqueue follow-ups). */
async function settle() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await enqueueManifestIo(async () => {});
    });
  }
}

async function mount() {
  const hook = renderHook(() => useDiskLibraries(ROOT));
  await waitFor(() => expect(hook.result.current.hydrated).toBe(true));
  await settle();
  return hook;
}

function memCitekeys(hook: Awaited<ReturnType<typeof mount>>) {
  return hook.result.current.libraries.find((l) => l.id === LIB_ID)?.entryKeys;
}

beforeEach(() => {
  disk.files.clear();
  disk.gate = null;
  disk.stampWrites = 0;
  // Skip the one-shot localStorage migration.
  disk.files.set(".virgil/libraries/.migrated", "{}");
  putManifest("foo.json", []);
});

afterEach(() => {
  cleanup();
});

describe("useDiskLibraries — one mutation door (task 762)", () => {
  it("N mutations in one handler compose, in memory and on disk", async () => {
    const hook = await mount();
    act(() => {
      hook.result.current.addEntries(LIB_ID, ["A"]);
      hook.result.current.addEntries(LIB_ID, ["B"]);
      hook.result.current.addEntries(LIB_ID, ["C"]);
    });
    expect(memCitekeys(hook)).toEqual(["A", "B", "C"]);
    await settle();
    expect(diskCitekeys()).toEqual(["A", "B", "C"]);
    expect(memCitekeys(hook)).toEqual(["A", "B", "C"]);
  });

  it("a reload racing an in-flight write never drops it", async () => {
    const hook = await mount();
    let release!: () => void;
    disk.gate = new Promise<void>((r) => (release = r));
    act(() => hook.result.current.addEntries(LIB_ID, ["X"]));
    // Let the flush start and block on the gated write.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    act(() => hook.result.current.addEntries(LIB_ID, ["Y"]));
    let reloaded!: Promise<void>;
    act(() => {
      reloaded = hook.result.current.reload();
    });
    expect(memCitekeys(hook)).toEqual(["X", "Y"]);
    disk.gate = null;
    release();
    await act(async () => {
      await reloaded;
    });
    await settle();
    expect(memCitekeys(hook)).toEqual(["X", "Y"]);
    expect(diskCitekeys()).toEqual(["X", "Y"]);
  });

  it("a flush rebases onto another window's write instead of clobbering it", async () => {
    const hook = await mount();
    // Another window added Z; this window never heard about it.
    putManifest("foo.json", ["Z"]);
    act(() => hook.result.current.addEntries(LIB_ID, ["W"]));
    await settle();
    expect(diskCitekeys()).toEqual(["Z", "W"]);
    expect(memCitekeys(hook)).toEqual(["Z", "W"]);
  });

  it("a stale filename renamed elsewhere is never re-created", async () => {
    const hook = await mount();
    disk.files.delete(".virgil/libraries/foo.json");
    putManifest("bar.json", [], "Bar");
    act(() => hook.result.current.addEntries(LIB_ID, ["W"]));
    await settle();
    expect(diskCitekeys("foo.json")).toBeUndefined();
    expect(diskCitekeys("bar.json")).toEqual(["W"]);
  });

  it("rename + add in one handler land together under the new filename", async () => {
    const hook = await mount();
    act(() => {
      hook.result.current.rename(LIB_ID, "Renamed");
      hook.result.current.addEntries(LIB_ID, ["A"]);
    });
    await settle();
    expect(diskCitekeys("foo.json")).toBeUndefined();
    expect(diskCitekeys("renamed.json")).toEqual(["A"]);
  });

  it("every write announces itself, and a second instance re-reads", async () => {
    const one = await mount();
    const two = await mount();
    const before = disk.stampWrites;
    act(() => one.result.current.addEntries(LIB_ID, ["X"]));
    await settle();
    expect(disk.stampWrites).toBeGreaterThan(before);
    await waitFor(() => expect(memCitekeys(two)).toEqual(["X"]));
    // …and the second instance's own write keeps the first's member.
    act(() => two.result.current.addEntries(LIB_ID, ["Y"]));
    await settle();
    expect(diskCitekeys()).toEqual(["X", "Y"]);
    await waitFor(() => expect(memCitekeys(one)).toEqual(["X", "Y"]));
  });

  it("the Virgil-bar global writer rides the same chain and announces", async () => {
    const hook = await mount();
    act(() => hook.result.current.addEntries(LIB_ID, ["A"]));
    addEntryToLibraryGlobal(LIB_ID, "G");
    await waitFor(() => expect(diskCitekeys()).toEqual(["A", "G"]));
    await settle();
    await waitFor(() => expect(memCitekeys(hook)).toEqual(["A", "G"]));
  });
});
