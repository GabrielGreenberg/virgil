// Pure-logic unit tests for the sidecar watcher core — the headless detection
// service behind LIVE reactivity to out-of-band `virgil/*.json` writes. Node
// env: ALL deps are injected as fakes, so no storage backend, no DOM, no React,
// no real timers.
//
// The watcher reads/writes the module-level disk ledger (the own-write guard's
// baseline), so each test resets it via __resetDiskLedgerForTests and pre-seeds
// baselines with stampDiskFingerprint to model "what Virgil last wrote".

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createSidecarWatcher,
  type SidecarWatcherDeps,
  type SidecarChangedDetail,
} from "@/lib/sidecar-watcher";
import {
  stampDiskFingerprint,
  fingerprintOf,
  getDiskFingerprint,
  __resetDiskLedgerForTests,
} from "@/lib/disk-ledger";

beforeEach(() => {
  __resetDiskLedgerForTests();
});

type FileStat = { mtimeMs: number; size: number } | null;

interface FakeFile {
  mtimeMs: number;
  size: number;
  content: string;
}

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}

const DOC = "doc1";
const REVISIONS = "revisions.json";
const CUTTER = "cutter.json";
const REV_PATH = `virgil/${REVISIONS}`;
const CUT_PATH = `virgil/${CUTTER}`;

interface Harness {
  watcher: ReturnType<typeof createSidecarWatcher>;
  disk: Map<string, FakeFile>;
  statFiles: ReturnType<typeof vi.fn>;
  readTextFile: ReturnType<typeof vi.fn>;
  invalidateSidecarBundle: ReturnType<typeof vi.fn>;
  emitted: SidecarChangedDetail[];
  /** Prime (baseline present files, never emit), then clear mock histories. */
  prime: () => Promise<void>;
}

function makeHarness(opts?: {
  revisions?: string;
  cutter?: string | null;
  statThrows?: () => boolean;
}): Harness {
  const revContent = opts?.revisions ?? JSON.stringify({ revisions: [] });
  const cutContent = opts?.cutter === null ? null : opts?.cutter ?? JSON.stringify({ cuts: [] });

  const disk = new Map<string, FakeFile>();
  disk.set(REV_PATH, { mtimeMs: 1000, size: byteLen(revContent), content: revContent });
  if (cutContent !== null) {
    disk.set(CUT_PATH, { mtimeMs: 1000, size: byteLen(cutContent), content: cutContent });
  }

  const statThrows = opts?.statThrows ?? (() => false);

  const statFiles = vi.fn(
    async (_docId: string, paths: string[]): Promise<Record<string, FileStat>> => {
      if (statThrows()) {
        throw new DOMException("permission lost", "NotAllowedError");
      }
      const out: Record<string, FileStat> = {};
      for (const p of paths) {
        const f = disk.get(p);
        out[p] = f ? { mtimeMs: f.mtimeMs, size: f.size } : null;
      }
      return out;
    },
  );

  const readTextFile = vi.fn(
    async (_docId: string, relPath: string): Promise<string | null> => {
      const f = disk.get(relPath);
      return f ? f.content : null;
    },
  );

  const invalidateSidecarBundle = vi.fn();
  const emitted: SidecarChangedDetail[] = [];

  const deps: SidecarWatcherDeps = {
    docId: DOC,
    filenames: [REVISIONS, CUTTER],
    statFiles: statFiles as unknown as SidecarWatcherDeps["statFiles"],
    readTextFile,
    invalidateSidecarBundle,
    emitChange: (detail) => emitted.push(detail),
    pollMs: 3000,
    isHidden: () => false,
  };

  const watcher = createSidecarWatcher(deps);
  return {
    watcher,
    disk,
    statFiles,
    readTextFile,
    invalidateSidecarBundle,
    emitted,
    prime: async () => {
      await watcher.pollNow();
      statFiles.mockClear();
      readTextFile.mockClear();
      invalidateSidecarBundle.mockClear();
    },
  };
}

/** Seed the ledger baseline for a file as if Virgil had just written it. */
function baseline(relPath: string, f: FakeFile): void {
  stampDiskFingerprint(DOC, relPath, fingerprintOf({ mtimeMs: f.mtimeMs, size: f.size }, f.content));
}

/** Simulate an EXTERNAL write: change content + bump mtime/size (NO ledger stamp). */
function externalWrite(disk: Map<string, FakeFile>, relPath: string, content: string): void {
  disk.set(relPath, { mtimeMs: 9999, size: byteLen(content), content });
}

/** Simulate Virgil's OWN write: change content AND stamp the ledger (own-write guard). */
function ownWrite(disk: Map<string, FakeFile>, relPath: string, content: string): void {
  const f = { mtimeMs: 9999, size: byteLen(content), content };
  disk.set(relPath, f);
  baseline(relPath, f); // <- storage-fsa/dev writeSidecar stamps the ledger post-write
}

describe("sidecar-watcher: prime pass", () => {
  it("baselines every present sidecar and NEVER emits on the first poll", async () => {
    const h = makeHarness();
    await h.watcher.pollNow(); // prime

    expect(h.emitted).toEqual([]);
    expect(h.invalidateSidecarBundle).not.toHaveBeenCalled();
    // Both present files are now ledgered.
    expect(getDiskFingerprint(DOC, REV_PATH)).toBeDefined();
    expect(getDiskFingerprint(DOC, CUT_PATH)).toBeDefined();
  });
});

describe("sidecar-watcher: own-write guard (no loop)", () => {
  it("does NOT emit or invalidate when the change is Virgil's own ledger-stamped write", async () => {
    const h = makeHarness();
    await h.prime();

    // Virgil autosaves revisions.json — content changes AND the ledger is
    // stamped (what writeSidecar now does). This must NOT look external.
    ownWrite(h.disk, REV_PATH, JSON.stringify({ revisions: [{ id: "x" }] }));

    await h.watcher.pollNow();

    expect(h.emitted).toEqual([]);
    expect(h.invalidateSidecarBundle).not.toHaveBeenCalled();
  });

  it("takes the cheap mtime==&&size== path (no read) when nothing changed", async () => {
    const h = makeHarness();
    await h.prime();

    await h.watcher.pollNow();

    expect(h.emitted).toEqual([]);
    expect(h.readTextFile).not.toHaveBeenCalled(); // no confirm-read on the clean path
  });

  it("re-baselines a false positive (touch: mtime bumped, bytes identical) without emitting", async () => {
    const h = makeHarness();
    await h.prime();

    // Touch: mtime changes but bytes are identical → hash matches → false positive.
    const cur = h.disk.get(REV_PATH)!;
    h.disk.set(REV_PATH, { ...cur, mtimeMs: cur.mtimeMs + 500 });

    await h.watcher.pollNow();

    expect(h.emitted).toEqual([]);
    expect(h.invalidateSidecarBundle).not.toHaveBeenCalled();
    // Re-baselined so we don't re-read every poll.
    expect(getDiskFingerprint(DOC, REV_PATH)!.mtimeMs).toBe(cur.mtimeMs + 500);
  });
});

describe("sidecar-watcher: genuine external change", () => {
  it("invalidates the bundle ONCE and emits per changed file", async () => {
    const h = makeHarness();
    await h.prime();

    externalWrite(h.disk, REV_PATH, JSON.stringify({ revisions: [{ id: "ai-drafted" }] }));

    await h.watcher.pollNow();

    expect(h.emitted).toEqual([{ docId: DOC, filename: REVISIONS }]);
    expect(h.invalidateSidecarBundle).toHaveBeenCalledTimes(1);
  });

  it("re-baselines after emitting so it does NOT re-emit on the next poll", async () => {
    const h = makeHarness();
    await h.prime();

    externalWrite(h.disk, REV_PATH, JSON.stringify({ revisions: [{ id: "z" }] }));
    await h.watcher.pollNow();
    expect(h.emitted).toHaveLength(1);

    // Second poll with the disk unchanged → no re-emit.
    await h.watcher.pollNow();
    expect(h.emitted).toHaveLength(1);
  });

  it("emits for BOTH files but invalidates the bundle only ONCE when two change together", async () => {
    const h = makeHarness();
    await h.prime();

    externalWrite(h.disk, REV_PATH, JSON.stringify({ revisions: [{ id: "a" }] }));
    externalWrite(h.disk, CUT_PATH, JSON.stringify({ cuts: [{ id: "b" }] }));

    await h.watcher.pollNow();

    expect(h.emitted).toEqual([
      { docId: DOC, filename: REVISIONS },
      { docId: DOC, filename: CUTTER },
    ]);
    expect(h.invalidateSidecarBundle).toHaveBeenCalledTimes(1);
  });
});

describe("sidecar-watcher: external create / remove", () => {
  it("treats a NEWLY-created sidecar (absent at prime) as a change", async () => {
    const h = makeHarness({ cutter: null }); // cutter.json absent at prime
    await h.prime();
    expect(getDiskFingerprint(DOC, CUT_PATH)).toBeUndefined();

    // An agent creates cutter.json mid-session.
    externalWrite(h.disk, CUT_PATH, JSON.stringify({ cuts: [{ id: "new" }] }));
    await h.watcher.pollNow();

    expect(h.emitted).toEqual([{ docId: DOC, filename: CUTTER }]);
    expect(h.invalidateSidecarBundle).toHaveBeenCalledTimes(1);
    expect(getDiskFingerprint(DOC, CUT_PATH)).toBeDefined(); // baselined now
  });

  it("treats an external REMOVAL (had a baseline, now absent) as a change and drops the baseline", async () => {
    const h = makeHarness();
    await h.prime();
    expect(getDiskFingerprint(DOC, CUT_PATH)).toBeDefined();

    h.disk.delete(CUT_PATH); // agent/user deletes it out of band
    await h.watcher.pollNow();

    expect(h.emitted).toEqual([{ docId: DOC, filename: CUTTER }]);
    expect(h.invalidateSidecarBundle).toHaveBeenCalledTimes(1);
    // Baseline dropped so a persistently-absent file doesn't re-emit forever.
    expect(getDiskFingerprint(DOC, CUT_PATH)).toBeUndefined();

    await h.watcher.pollNow();
    expect(h.emitted).toHaveLength(1); // no re-emit
  });
});

describe("sidecar-watcher: robustness", () => {
  it("skips the poll (no emit) on a permission-loss stat throw", async () => {
    let throwing = false;
    const h = makeHarness({ statThrows: () => throwing });
    await h.prime();

    throwing = true;
    await h.watcher.pollNow();

    expect(h.emitted).toEqual([]);
    expect(h.invalidateSidecarBundle).not.toHaveBeenCalled();
  });

  it("does nothing while the tab is hidden", async () => {
    const disk = new Map<string, FakeFile>();
    const revContent = JSON.stringify({ revisions: [] });
    disk.set(REV_PATH, { mtimeMs: 1000, size: byteLen(revContent), content: revContent });
    const statFiles = vi.fn(async (_d: string, paths: string[]) => {
      const out: Record<string, FileStat> = {};
      for (const p of paths) {
        const f = disk.get(p);
        out[p] = f ? { mtimeMs: f.mtimeMs, size: f.size } : null;
      }
      return out;
    });
    const emitted: SidecarChangedDetail[] = [];
    const watcher = createSidecarWatcher({
      docId: DOC,
      filenames: [REVISIONS],
      statFiles: statFiles as unknown as SidecarWatcherDeps["statFiles"],
      readTextFile: async () => revContent,
      invalidateSidecarBundle: () => {},
      emitChange: (d) => emitted.push(d),
      isHidden: () => true,
    });

    await watcher.pollNow();
    expect(statFiles).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });
});
