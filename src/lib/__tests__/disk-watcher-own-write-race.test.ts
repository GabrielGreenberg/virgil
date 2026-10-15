// Task 1130 — a watcher poll racing Virgil's OWN save must never report an
// external "modified" (the false "Keep mine / Use disk" conflict).
//
// The write door does `beginOwnWrite → write bytes → re-stat → stamp →
// release` (storage-fsa `writeTrackedText`, storage-dev `putTrackedText`). The
// re-stat is slow on a cloud-synced folder, so a poll can stat the drifted file
// and confirm-read Virgil's bytes before the stamp lands. These legs drive the
// REAL `runPoll` (via `pollNow`) against a fake write that follows the same
// protocol, with the stamp landing DURING the confirm read's await.

import { describe, it, expect, beforeEach } from "vitest";
import { createDiskWatcher, type DiskWatcherDeps } from "@/lib/disk-watcher";
import {
  beginOwnWrite,
  isOwnContent,
  stampDiskFingerprint,
  fingerprintOf,
  hashContent,
  __resetDiskLedgerForTests,
} from "@/lib/disk-ledger";

beforeEach(() => {
  __resetDiskLedgerForTests();
});

interface FakeFile {
  mtimeMs: number;
  size: number;
  content: string;
}

const byteLen = (s: string) => new TextEncoder().encode(s).length;

/** What `File.text()` hands back for bytes a UTF-8 write of `s` produced. */
const readBack = (s: string) =>
  new TextDecoder().decode(new TextEncoder().encode(s));

function makeHarness(opts: { unsaved: boolean }) {
  const disk = new Map<string, FakeFile>();
  const initial = "\\documentclass{article}\nhello";
  disk.set("main.tex", { mtimeMs: 1000, size: byteLen(initial), content: initial });
  stampDiskFingerprint(
    "doc1",
    "main.tex",
    fingerprintOf({ mtimeMs: 1000, size: byteLen(initial) }, initial),
  );
  /** Runs inside the confirm read's await, after the bytes are read. */
  let duringRead: (() => void) | null = null;

  const deps: DiskWatcherDeps = {
    docId: "doc1",
    statFiles: (async (_d: string, paths: string[]) => {
      const out: Record<string, { mtimeMs: number; size: number } | null> = {};
      for (const p of paths) {
        const f = disk.get(p);
        out[p] = f ? { mtimeMs: f.mtimeMs, size: f.size } : null;
      }
      return out;
    }) as unknown as DiskWatcherDeps["statFiles"],
    readTextFile: async (_d: string, relPath: string) => {
      const f = disk.get(relPath);
      const text = f ? readBack(f.content) : null;
      const hook = duringRead;
      duringRead = null;
      hook?.();
      return text;
    },
    getBibFilename: async () => "",
    getTexFilename: () => "main.tex",
    hasUnsavedEdits: () => opts.unsaved,
    now: () => 0,
    pollMs: 3000,
    isHidden: () => false,
  };
  const watcher = createDiskWatcher(deps);

  /**
   * Virgil's own write, split at the await the race lives in: the bytes land
   * now (registered as in flight), `finish()` stamps + releases later.
   */
  function ownWrite(content: string, mtimeMs: number) {
    const release = beginOwnWrite("doc1", "main.tex", content);
    disk.set("main.tex", { mtimeMs, size: byteLen(content), content });
    return {
      finish() {
        stampDiskFingerprint(
          "doc1",
          "main.tex",
          fingerprintOf({ mtimeMs, size: byteLen(content) }, content),
        );
        release();
      },
    };
  }

  return {
    watcher,
    disk,
    ownWrite,
    setDuringRead: (fn: () => void) => {
      duringRead = fn;
    },
  };
}

describe("task 1130: poll vs Virgil's own in-flight save", () => {
  it("stamp lands DURING the confirm read → no change, no conflict", async () => {
    const h = makeHarness({ unsaved: true });
    await h.watcher.pollNow(); // prime
    const w = h.ownWrite("\\documentclass{article}\nhello world", 2000);
    // The poll stats the drifted file, then the write's stamp lands while the
    // confirm read is awaiting — the pre-await fingerprint is now stale.
    h.setDuringRead(() => w.finish());
    await h.watcher.pollNow();
    const snap = h.watcher.store.getSnapshot();
    expect(snap.changes).toEqual([]);
    expect(snap.severity).toBeNull();
  });

  it("bytes landed, stamp NOT yet landed → recognised as an own write", async () => {
    const h = makeHarness({ unsaved: true });
    await h.watcher.pollNow();
    const w = h.ownWrite("\\documentclass{article}\nhello again", 2000);
    await h.watcher.pollNow();
    expect(h.watcher.store.getSnapshot().changes).toEqual([]);
    w.finish();
    await h.watcher.pollNow();
    expect(h.watcher.store.getSnapshot().changes).toEqual([]);
  });

  it("CONTROL: foreign bytes on disk during an own write are still a conflict", async () => {
    const h = makeHarness({ unsaved: true });
    await h.watcher.pollNow();
    const w = h.ownWrite("\\documentclass{article}\nmine", 2000);
    // Someone else's bytes replace ours before the poll reads.
    const theirs = "\\documentclass{article}\ntheirs";
    h.disk.set("main.tex", { mtimeMs: 2500, size: byteLen(theirs), content: theirs });
    h.setDuringRead(() => w.finish());
    await h.watcher.pollNow();
    const snap = h.watcher.store.getSnapshot();
    expect(snap.changes).toEqual([
      { relPath: "main.tex", role: "tex", kind: "modified" },
    ]);
    expect(snap.severity).toBe("conflict");
  });

  it("CONTROL: an external edit with no write in flight still flags", async () => {
    const h = makeHarness({ unsaved: false });
    await h.watcher.pollNow();
    const theirs = "edited in Overleaf";
    h.disk.set("main.tex", { mtimeMs: 3000, size: byteLen(theirs), content: theirs });
    await h.watcher.pollNow();
    expect(h.watcher.store.getSnapshot().severity).toBe("change");
  });
});

describe("task 1130: encoding — the stamp hashes what reads back", () => {
  it("a BOM-led write does not read back as a permanent false 'modified'", async () => {
    const h = makeHarness({ unsaved: false });
    await h.watcher.pollNow();
    const withBom = "\uFEFF\\documentclass{article}\nbom";
    h.ownWrite(withBom, 2000).finish();
    // An mtime drift with no byte change (cloud-sync touch).
    h.disk.set("main.tex", { ...h.disk.get("main.tex")!, mtimeMs: 2600 });
    await h.watcher.pollNow();
    expect(h.watcher.store.getSnapshot().changes).toEqual([]);
  });

  it("a lone surrogate (written as U+FFFD) hashes equal to its read-back", () => {
    const s = "a\uD800b";
    expect(hashContent(s)).toBe(hashContent(readBack(s)));
    expect(hashContent("\uFEFFx")).toBe(hashContent("x"));
    // Well-formed text is unaffected, and an interior BOM is kept.
    expect(hashContent("x\uFEFFy")).not.toBe(hashContent("xy"));
    expect(hashContent("a\uD83D\uDE00b")).not.toBe(hashContent("a\uFFFDb"));
  });
});

describe("task 1130: the in-flight registry", () => {
  it("vouches only while in flight, refcounts duplicates, releases idempotently", () => {
    const h = hashContent("bytes");
    expect(isOwnContent("d", "f.tex", h)).toBe(false);
    const r1 = beginOwnWrite("d", "f.tex", "bytes");
    const r2 = beginOwnWrite("d", "f.tex", "bytes");
    expect(isOwnContent("d", "f.tex", h)).toBe(true);
    expect(isOwnContent("d", "other.tex", h)).toBe(false);
    r1();
    r1();
    expect(isOwnContent("d", "f.tex", h)).toBe(true);
    r2();
    expect(isOwnContent("d", "f.tex", h)).toBe(false);
  });
});
