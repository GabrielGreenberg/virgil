// Pure-logic unit tests for the disk watcher core (Phase 1 — the headless
// detection service). Node env: ALL deps are injected as fakes plus a manual
// clock, so no storage backend, no DOM, no React, no real timers.
//
// The watcher reads/writes the module-level disk ledger, so each test resets
// it via __resetDiskLedgerForTests and pre-seeds baselines with
// stampDiskFingerprint to model "what Virgil last wrote/read".

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createDiskWatcher,
  type DiskWatcherDeps,
  type FileChange,
} from "@/lib/disk-watcher";
import {
  stampDiskFingerprint,
  fingerprintOf,
  hashContent,
  getDiskFingerprint,
  __resetDiskLedgerForTests,
} from "@/lib/disk-ledger";

beforeEach(() => {
  __resetDiskLedgerForTests();
});

type FileStat = { mtimeMs: number; size: number } | null;

// A small fake disk: relPath → { stat, content }. Mutate between polls to
// simulate external writes / touches / deletes.
interface FakeFile {
  mtimeMs: number;
  size: number;
  content: string;
}

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length;
}

interface Harness {
  watcher: ReturnType<typeof createDiskWatcher>;
  disk: Map<string, FakeFile>;
  clock: { t: number };
  statFiles: ReturnType<typeof vi.fn>;
  /** Single relPath-keyed content reader (replaces readTex/readBib). */
  readTextFile: ReturnType<typeof vi.fn>;
  getBibFilename: ReturnType<typeof vi.fn>;
  setUnsaved: (v: boolean) => void;
  /**
   * Consume the PRIME (baseline) pass — the first poll after (re)start NEVER
   * flags; it just baselines present files to current disk bytes. Tests that
   * want to classify a drift must prime FIRST (with the disk in its pre-edit
   * state), then mutate the disk, then pollNow().
   */
  prime: () => Promise<void>;
}

function makeHarness(opts?: {
  texName?: string;
  bibName?: string;
  texContent?: string;
  bibContent?: string;
  hasUnsavedEdits?: boolean;
  statThrows?: () => boolean;
  isHidden?: () => boolean;
}): Harness {
  const texName = opts?.texName ?? "main.tex";
  const bibName = opts?.bibName ?? "references.bib";
  const texContent = opts?.texContent ?? "\\documentclass{article}\nhello";
  const bibContent = opts?.bibContent ?? "@book{a, title={A}}";

  const disk = new Map<string, FakeFile>();
  disk.set(texName, { mtimeMs: 1000, size: byteLen(texContent), content: texContent });
  disk.set(bibName, { mtimeMs: 1000, size: byteLen(bibContent), content: bibContent });

  const clock = { t: 5000 };
  let unsaved = opts?.hasUnsavedEdits ?? false;
  const statThrows = opts?.statThrows ?? (() => false);

  const statFiles = vi.fn(
    async (
      _docId: string,
      paths: string[],
    ): Promise<Record<string, FileStat>> => {
      if (statThrows()) {
        const err = new DOMException("permission lost", "NotAllowedError");
        throw err;
      }
      const out: Record<string, FileStat> = {};
      for (const p of paths) {
        const f = disk.get(p);
        out[p] = f ? { mtimeMs: f.mtimeMs, size: f.size } : null;
      }
      return out;
    },
  );

  // readTextFile is the SINGLE generic content reader, keyed by the EXACT
  // relPath the watcher stat'd. Like production it is NON-stamping and does no
  // name re-resolution — so it always returns the bytes of the file that was
  // stat'd. Returns null for an absent path (mirrors the facade contract). The
  // watcher must NEVER use this for name resolution (that's getBibFilename).
  const readTextFile = vi.fn(
    async (_docId: string, relPath: string): Promise<string | null> => {
      const f = disk.get(relPath);
      return f ? f.content : null;
    },
  );

  // getBibFilename resolves the .bib NAME without reading .bib content (matches
  // production: it reads the .tex to find \bibliography{}, falling back to the
  // folder name). Here we model the static bibName.
  const getBibFilename = vi.fn(async (): Promise<string> => bibName);

  const deps: DiskWatcherDeps = {
    docId: "doc1",
    statFiles: statFiles as unknown as DiskWatcherDeps["statFiles"],
    readTextFile,
    getBibFilename,
    getTexFilename: () => texName,
    hasUnsavedEdits: () => unsaved,
    now: () => clock.t,
    pollMs: 3000,
    isHidden: opts?.isHidden ?? (() => false),
  };

  const watcher = createDiskWatcher(deps);
  return {
    watcher,
    disk,
    clock,
    statFiles,
    readTextFile,
    getBibFilename,
    setUnsaved: (v: boolean) => {
      unsaved = v;
    },
    prime: async () => {
      await watcher.pollNow();
      // Clear the mock call history so a test's post-prime assertions
      // (readTextFile/statFiles call counts) start from zero.
      statFiles.mockClear();
      readTextFile.mockClear();
      getBibFilename.mockClear();
    },
  };
}

/** Seed the ledger baseline for a file as if Virgil had just written/read it. */
function baseline(relPath: string, f: FakeFile): void {
  stampDiskFingerprint(
    "doc1",
    relPath,
    fingerprintOf({ mtimeMs: f.mtimeMs, size: f.size }, f.content),
  );
}

describe("disk-watcher: clean state (no drift)", () => {
  it("stays clean and does NO content read on the cheap mtime==&&size== path", async () => {
    const h = makeHarness();
    baseline("main.tex", h.disk.get("main.tex")!);
    baseline("references.bib", h.disk.get("references.bib")!);

    // Prime first (its baseline reads are cleared); the classifying poll below
    // takes the cheap mtime==&&size== path on an unchanged disk.
    await h.prime();
    await h.watcher.pollNow();

    const snap = h.watcher.store.getSnapshot();
    expect(snap.changes).toEqual([]);
    expect(snap.severity).toBeNull();
    expect(snap.detectedAt).toBeNull();
    expect(snap.paused).toBe(false);
    // Cheap path: no confirm-read at all (name resolution is cached after
    // prime, so getBibFilename isn't re-called either; readTextFile silent).
    expect(h.readTextFile).not.toHaveBeenCalled();
  });
});

describe("disk-watcher: genuine external edit", () => {
  it("flags {tex, modified} with severity 'change' after a confirm-read", async () => {
    const h = makeHarness();
    baseline("main.tex", h.disk.get("main.tex")!);
    baseline("references.bib", h.disk.get("references.bib")!);
    await h.prime();

    // External edit: new content, new mtime + size.
    const newContent = "\\documentclass{article}\nEXTERNALLY EDITED";
    h.disk.set("main.tex", {
      mtimeMs: 2000,
      size: byteLen(newContent),
      content: newContent,
    });

    await h.watcher.pollNow();

    const snap = h.watcher.store.getSnapshot();
    expect(snap.changes).toEqual<FileChange[]>([
      { relPath: "main.tex", role: "tex", kind: "modified" },
    ]);
    expect(snap.severity).toBe("change");
    expect(snap.detectedAt).toBe(5000);
    // Confirm-read happened, against the EXACT relPath that was stat'd.
    expect(h.readTextFile).toHaveBeenCalledTimes(1);
    expect(h.readTextFile).toHaveBeenCalledWith("doc1", "main.tex");
  });
});

describe("disk-watcher: touch false-positive", () => {
  it("does NOT flag when mtime differs but content is identical, and re-baselines", async () => {
    const h = makeHarness();
    baseline("main.tex", h.disk.get("main.tex")!);
    baseline("references.bib", h.disk.get("references.bib")!);
    await h.prime();

    // `touch`: bump mtime, SAME content + size.
    const f = h.disk.get("main.tex")!;
    h.disk.set("main.tex", { ...f, mtimeMs: 9999 });

    await h.watcher.pollNow();

    expect(h.watcher.store.getSnapshot().changes).toEqual([]);
    // Confirm-read happened once (the suspicion path).
    expect(h.readTextFile).toHaveBeenCalledTimes(1);
    // Ledger re-baselined to the new mtime.
    expect(getDiskFingerprint("doc1", "main.tex")!.mtimeMs).toBe(9999);

    // Second poll: cheap path now matches → NO further read.
    await h.watcher.pollNow();
    expect(h.readTextFile).toHaveBeenCalledTimes(1);
    expect(h.watcher.store.getSnapshot().changes).toEqual([]);
  });
});

describe("disk-watcher: unledgered but present", () => {
  it("the PRIME pass baselines present-but-unledgered files instead of flagging", async () => {
    const h = makeHarness();
    // NO baseline stamped for either file → both unledgered.
    expect(getDiskFingerprint("doc1", "main.tex")).toBeUndefined();

    // The first poll IS the prime pass: it baselines every present file and
    // never flags.
    await h.watcher.pollNow();

    const snap = h.watcher.store.getSnapshot();
    expect(snap.changes).toEqual([]);
    // Both got baselined.
    const texFp = getDiskFingerprint("doc1", "main.tex")!;
    expect(texFp.mtimeMs).toBe(1000);
    expect(texFp.hash).toBe(hashContent(h.disk.get("main.tex")!.content));
    expect(getDiskFingerprint("doc1", "references.bib")).toBeDefined();
  });
});

describe("disk-watcher: conflict severity", () => {
  it("reports 'conflict' when there are unsaved edits", async () => {
    const h = makeHarness({ hasUnsavedEdits: true });
    baseline("main.tex", h.disk.get("main.tex")!);
    baseline("references.bib", h.disk.get("references.bib")!);
    await h.prime();

    const newContent = "externally changed body";
    h.disk.set("main.tex", {
      mtimeMs: 2000,
      size: byteLen(newContent),
      content: newContent,
    });

    await h.watcher.pollNow();

    const snap = h.watcher.store.getSnapshot();
    expect(snap.changes.length).toBe(1);
    expect(snap.severity).toBe("conflict");
  });
});

describe("disk-watcher: severity flip", () => {
  it("flips 'change' → 'conflict' on a later poll when unsaved goes true (same change-set)", async () => {
    const h = makeHarness({ hasUnsavedEdits: false });
    baseline("main.tex", h.disk.get("main.tex")!);
    baseline("references.bib", h.disk.get("references.bib")!);
    await h.prime();

    const newContent = "externally changed body";
    h.disk.set("main.tex", {
      mtimeMs: 2000,
      size: byteLen(newContent),
      content: newContent,
    });

    await h.watcher.pollNow();
    let snap = h.watcher.store.getSnapshot();
    expect(snap.severity).toBe("change");
    const firstDetectedAt = snap.detectedAt;

    // Now the user has unsaved edits. Advance the clock to prove detectedAt is
    // preserved (the change-set is unchanged).
    h.setUnsaved(true);
    h.clock.t = 8000;
    await h.watcher.pollNow();

    snap = h.watcher.store.getSnapshot();
    expect(snap.severity).toBe("conflict");
    expect(snap.changes).toEqual<FileChange[]>([
      { relPath: "main.tex", role: "tex", kind: "modified" },
    ]);
    // detectedAt preserved across the severity flip.
    expect(snap.detectedAt).toBe(firstDetectedAt);
  });
});

describe("disk-watcher: external removal", () => {
  it("flags {removed} when a ledgered file disappears from disk", async () => {
    const h = makeHarness();
    baseline("main.tex", h.disk.get("main.tex")!);
    baseline("references.bib", h.disk.get("references.bib")!);
    await h.prime(); // the .bib is present at prime → it gets a baseline

    h.disk.delete("references.bib");

    await h.watcher.pollNow();

    const snap = h.watcher.store.getSnapshot();
    expect(snap.changes).toEqual<FileChange[]>([
      { relPath: "references.bib", role: "bib", kind: "removed" },
    ]);
    expect(snap.severity).toBe("change");
  });

  it("does NOT flag a never-present file (no ledger entry)", async () => {
    const h = makeHarness();
    baseline("main.tex", h.disk.get("main.tex")!);
    // Remove the bib BEFORE priming so it's absent at prime → no baseline.
    h.disk.delete("references.bib");
    await h.prime();

    await h.watcher.pollNow();
    expect(h.watcher.store.getSnapshot().changes).toEqual([]);
  });
});

describe("disk-watcher: permission pause", () => {
  it("sets paused:true on a NotAllowedError and preserves prior changes, no crash", async () => {
    let throwNow = false;
    const h = makeHarness({ statThrows: () => throwNow });
    baseline("main.tex", h.disk.get("main.tex")!);
    baseline("references.bib", h.disk.get("references.bib")!);
    await h.prime();

    // First, a genuine change so the store has changes to preserve.
    const newContent = "externally changed";
    h.disk.set("main.tex", {
      mtimeMs: 2000,
      size: byteLen(newContent),
      content: newContent,
    });
    await h.watcher.pollNow();
    expect(h.watcher.store.getSnapshot().changes.length).toBe(1);

    // Now permission is lost.
    throwNow = true;
    await expect(h.watcher.pollNow()).resolves.toBeUndefined();

    const snap = h.watcher.store.getSnapshot();
    expect(snap.paused).toBe(true);
    // Changes preserved (we don't misread permission loss as a resolution).
    expect(snap.changes.length).toBe(1);
  });
});

describe("disk-watcher: bib re-resolve on tex change", () => {
  it("re-resolves the bib NAME via getBibFilename (not by reading content) after a .tex change", async () => {
    const h = makeHarness();
    baseline("main.tex", h.disk.get("main.tex")!);
    baseline("references.bib", h.disk.get("references.bib")!);

    // Prime learns the bib name once via getBibFilename. (prime() clears mock
    // history afterward, so the counts below start from zero.)
    await h.prime();
    expect(h.getBibFilename).not.toHaveBeenCalled();

    // External .tex edit → flagged + cachedBibName invalidated.
    const newContent = "changed tex with new \\bibliography";
    h.disk.set("main.tex", {
      mtimeMs: 2000,
      size: byteLen(newContent),
      content: newContent,
    });
    await h.watcher.pollNow();
    // tex changed → cachedBibName invalidated. Next poll must re-learn the
    // name — via getBibFilename, never by reading .bib content.
    await h.watcher.pollNow();

    // Name resolution went through getBibFilename after the tex change.
    expect(h.getBibFilename).toHaveBeenCalled();
    // The .bib didn't drift, so its content was never read. readTextFile was
    // used ONLY for the .tex confirm path, never against the .bib for name
    // resolution.
    expect(h.readTextFile).not.toHaveBeenCalledWith("doc1", "references.bib");
  });

  it("a .tex repoint does NOT make the .bib confirm read the wrong file", async () => {
    // The deep nit this refactor fixes: confirm reads must hit the EXACT
    // relPath that was stat'd, even when a .tex edit repoints \bibliography{}
    // to a different .bib mid-session. We model the repoint by having
    // getBibFilename return "old.bib" first, then "new.bib" after the .tex
    // change; only "new.bib" drifts, and the watcher must read "new.bib"
    // (the file it stat'd), never "old.bib".
    const oldBib = "@book{old, title={Old}}";
    const newBib = "@book{new, title={New}}";
    const h = makeHarness({ bibName: "old.bib", bibContent: oldBib });
    // Make the second resolved .bib name be "new.bib".
    h.getBibFilename
      .mockResolvedValueOnce("old.bib") // prime resolves old.bib
      .mockResolvedValue("new.bib"); // after the .tex change → new.bib
    // Seed "new.bib" on disk (the repoint target).
    h.disk.set("new.bib", {
      mtimeMs: 1000,
      size: byteLen(newBib),
      content: newBib,
    });
    baseline("main.tex", h.disk.get("main.tex")!);
    baseline("old.bib", h.disk.get("old.bib")!);
    await h.prime();

    // External .tex edit repoints \bibliography{new}; the watcher flags the
    // .tex and invalidates cachedBibName.
    const newTex = "changed tex \\bibliography{new}";
    h.disk.set("main.tex", {
      mtimeMs: 2000,
      size: byteLen(newTex),
      content: newTex,
    });
    await h.watcher.pollNow(); // flags .tex, invalidates bib name
    h.readTextFile.mockClear();

    // Next poll re-resolves to "new.bib" and confirms it. The confirm read must
    // request "new.bib" (the stat'd file), and "new.bib" is unledgered → it is
    // baselined (read once), never flagged as the wrong file.
    await h.watcher.pollNow();
    expect(h.readTextFile).toHaveBeenCalledWith("doc1", "new.bib");
    // It must NEVER read the stale "old.bib".
    expect(h.readTextFile).not.toHaveBeenCalledWith("doc1", "old.bib");
  });
});

describe("disk-watcher: hidden gate", () => {
  it("is a no-op when isHidden() is true (statFiles not called)", async () => {
    const h = makeHarness({ isHidden: () => true });
    baseline("main.tex", h.disk.get("main.tex")!);

    await h.watcher.pollNow();

    expect(h.statFiles).not.toHaveBeenCalled();
    expect(h.watcher.store.getSnapshot()).toEqual({
      changes: [],
      severity: null,
      detectedAt: null,
      paused: false,
    });
  });
});

describe("disk-watcher: acknowledge", () => {
  it("re-baselines a flagged change so the next poll is clean", async () => {
    const h = makeHarness();
    baseline("main.tex", h.disk.get("main.tex")!);
    baseline("references.bib", h.disk.get("references.bib")!);
    await h.prime();

    const newContent = "externally changed body";
    h.disk.set("main.tex", {
      mtimeMs: 2000,
      size: byteLen(newContent),
      content: newContent,
    });
    await h.watcher.pollNow();
    expect(h.watcher.store.getSnapshot().changes.length).toBe(1);

    await h.watcher.acknowledge();
    // Store cleared immediately.
    expect(h.watcher.store.getSnapshot().changes).toEqual([]);
    // Ledger re-baselined to the external content.
    expect(getDiskFingerprint("doc1", "main.tex")!.hash).toBe(
      hashContent(newContent),
    );

    // Next poll is clean and does no further read.
    h.readTextFile.mockClear();
    await h.watcher.pollNow();
    expect(h.watcher.store.getSnapshot().changes).toEqual([]);
    expect(h.readTextFile).not.toHaveBeenCalled();
  });
});

describe("disk-watcher: store snapshot stability", () => {
  it("returns the SAME reference across two no-op polls", async () => {
    const h = makeHarness();
    baseline("main.tex", h.disk.get("main.tex")!);
    baseline("references.bib", h.disk.get("references.bib")!);
    await h.prime();

    await h.watcher.pollNow();
    const a = h.watcher.store.getSnapshot();
    await h.watcher.pollNow();
    const b = h.watcher.store.getSnapshot();
    expect(b).toBe(a); // identity stable — useSyncExternalStore won't loop
  });

  it("notifies subscribers exactly once per real state change", async () => {
    const h = makeHarness();
    baseline("main.tex", h.disk.get("main.tex")!);
    baseline("references.bib", h.disk.get("references.bib")!);

    const listener = vi.fn();
    const unsub = h.watcher.store.subscribe(listener);

    await h.watcher.pollNow(); // PRIME pass → stays clean: no emit
    expect(listener).toHaveBeenCalledTimes(0);

    const newContent = "externally changed";
    h.disk.set("main.tex", {
      mtimeMs: 2000,
      size: byteLen(newContent),
      content: newContent,
    });
    await h.watcher.pollNow(); // clean → changed: one emit
    expect(listener).toHaveBeenCalledTimes(1);

    await h.watcher.pollNow(); // changed → same change: no emit
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
  });
});

describe("disk-watcher: hasUnresolvedChange + clearChanges", () => {
  it("hasUnresolvedChange reflects the store; clearChanges resets it", async () => {
    const h = makeHarness();
    baseline("main.tex", h.disk.get("main.tex")!);
    baseline("references.bib", h.disk.get("references.bib")!);
    await h.prime();

    expect(h.watcher.hasUnresolvedChange()).toBe(false);

    const newContent = "externally changed";
    h.disk.set("main.tex", {
      mtimeMs: 2000,
      size: byteLen(newContent),
      content: newContent,
    });
    await h.watcher.pollNow();
    expect(h.watcher.hasUnresolvedChange()).toBe(true);

    h.watcher.clearChanges();
    expect(h.watcher.hasUnresolvedChange()).toBe(false);
    expect(h.watcher.store.getSnapshot()).toEqual({
      changes: [],
      severity: null,
      detectedAt: null,
      paused: false,
    });
  });
});

// ===========================================================================
// Anti-flicker invariant (the headline of the fix-up): a genuine external
// change, once flagged, must PERSIST across consecutive polls. The flicker bug
// was the watcher's own confirm/resolve read re-baselining the very change it
// surfaced. With readTextFile a PURE reader (no ledger stamp) and name
// resolution via getBibFilename, a flag stays flagged until acknowledged.
// ===========================================================================

describe("disk-watcher: ANTI-FLICKER .tex", () => {
  it("a genuine .tex edit stays flagged across >=2 consecutive polls (no flicker)", async () => {
    const h = makeHarness();
    baseline("main.tex", h.disk.get("main.tex")!);
    baseline("references.bib", h.disk.get("references.bib")!);
    await h.prime();

    // Genuine external .tex edit: different mtime, size, AND content.
    const newContent = "\\documentclass{article}\nOVERLEAF EDITED THIS";
    h.disk.set("main.tex", {
      mtimeMs: 2000,
      size: byteLen(newContent),
      content: newContent,
    });

    // Poll 1: flagged.
    await h.watcher.pollNow();
    expect(h.watcher.store.getSnapshot().changes).toEqual<FileChange[]>([
      { relPath: "main.tex", role: "tex", kind: "modified" },
    ]);

    // Poll 2 (disk UNCHANGED): STILL flagged — the confirm-read did NOT
    // re-baseline the ledger to the external bytes.
    await h.watcher.pollNow();
    expect(h.watcher.store.getSnapshot().changes).toEqual<FileChange[]>([
      { relPath: "main.tex", role: "tex", kind: "modified" },
    ]);

    // Poll 3 (still unchanged): STILL flagged.
    await h.watcher.pollNow();
    expect(h.watcher.store.getSnapshot().changes).toEqual<FileChange[]>([
      { relPath: "main.tex", role: "tex", kind: "modified" },
    ]);

    // The ledger still holds the PRE-edit baseline (proves no re-baseline).
    expect(getDiskFingerprint("doc1", "main.tex")!.hash).not.toBe(
      hashContent(newContent),
    );
  });
});

describe("disk-watcher: ANTI-FLICKER .bib", () => {
  it("a genuine .bib edit survives a .tex-triggered bib re-resolve AND >=2 polls", async () => {
    const h = makeHarness();
    baseline("main.tex", h.disk.get("main.tex")!);
    baseline("references.bib", h.disk.get("references.bib")!);
    await h.prime();

    // Genuine external .bib edit.
    const newBib = "@article{NEW, title={Externally Added}}";
    h.disk.set("references.bib", {
      mtimeMs: 2000,
      size: byteLen(newBib),
      content: newBib,
    });
    // Also edit the .tex so the next poll re-resolves the bib NAME (via
    // getBibFilename — name resolution never reads or re-baselines content).
    const newTex = "changed tex \\bibliography{references}";
    h.disk.set("main.tex", {
      mtimeMs: 2000,
      size: byteLen(newTex),
      content: newTex,
    });

    // Poll 1: BOTH flagged.
    await h.watcher.pollNow();
    let snap = h.watcher.store.getSnapshot();
    expect(snap.changes.map((c) => c.role).sort()).toEqual(["bib", "tex"]);
    expect(snap.changes.find((c) => c.role === "bib")!.kind).toBe("modified");

    // Poll 2 (disk unchanged; the .tex change forced a bib re-resolve via
    // getBibFilename): the .bib change SURVIVES — readTextFile (the confirm
    // reader) did not re-baseline it.
    await h.watcher.pollNow();
    snap = h.watcher.store.getSnapshot();
    expect(snap.changes.find((c) => c.role === "bib")?.kind).toBe("modified");

    // Poll 3: STILL flagged.
    await h.watcher.pollNow();
    snap = h.watcher.store.getSnapshot();
    expect(snap.changes.find((c) => c.role === "bib")?.kind).toBe("modified");

    // Name resolution was via getBibFilename, never a content read re-baselining.
    expect(h.getBibFilename).toHaveBeenCalled();
    // The .bib ledger still holds the PRE-edit baseline.
    expect(getDiskFingerprint("doc1", "references.bib")!.hash).not.toBe(
      hashContent(newBib),
    );
  });
});

describe("disk-watcher: PRIME / writeback-race", () => {
  it("primes to current disk bytes so the load-writeback never flashes; a later real edit still flags", async () => {
    const h = makeHarness();
    // Ledger holds the 'read bytes' (what readDocBundle loaded). Disk already
    // holds DIFFERENT 'writeback bytes' (Virgil's load-time UUID writeback,
    // possibly still settling). The hashes differ.
    const readBytes = h.disk.get("main.tex")!.content;
    baseline("main.tex", h.disk.get("main.tex")!); // ledger = read bytes
    baseline("references.bib", h.disk.get("references.bib")!);

    const writebackBytes = readBytes + "\n%!v:abcd"; // minted-UUID writeback
    h.disk.set("main.tex", {
      mtimeMs: 1500,
      size: byteLen(writebackBytes),
      content: writebackBytes,
    });
    expect(hashContent(writebackBytes)).not.toBe(
      getDiskFingerprint("doc1", "main.tex")!.hash,
    );

    // FIRST poll after start = PRIME pass → baselines to writeback bytes, NO
    // flag (despite the ledger/disk hash mismatch).
    await h.watcher.pollNow();
    expect(h.watcher.store.getSnapshot().changes).toEqual([]);
    expect(getDiskFingerprint("doc1", "main.tex")!.hash).toBe(
      hashContent(writebackBytes),
    );

    // A LATER genuine external edit still flags.
    const edited = writebackBytes + "\nEXTERNAL";
    h.disk.set("main.tex", {
      mtimeMs: 3000,
      size: byteLen(edited),
      content: edited,
    });
    await h.watcher.pollNow();
    expect(h.watcher.store.getSnapshot().changes).toEqual<FileChange[]>([
      { relPath: "main.tex", role: "tex", kind: "modified" },
    ]);
  });
});

describe("disk-watcher: getBibFilename used for name resolution", () => {
  it("resolves the watched .bib NAME via getBibFilename, reads content only on drift", async () => {
    const h = makeHarness();
    baseline("main.tex", h.disk.get("main.tex")!);
    baseline("references.bib", h.disk.get("references.bib")!);

    // The very first poll (prime) must resolve the bib name — via
    // getBibFilename; readTextFile is reserved for the confirm-content path.
    await h.watcher.pollNow();
    expect(h.getBibFilename).toHaveBeenCalled();
    expect(getDiskFingerprint("doc1", "references.bib")).toBeDefined();

    // Now drift ONLY the .bib (no .tex change → no name re-resolve). The
    // confirm path reads the .bib content via readTextFile against the EXACT
    // resolved relPath.
    h.readTextFile.mockClear();
    h.getBibFilename.mockClear();
    const newBib = "@misc{z, title={Z}}";
    h.disk.set("references.bib", {
      mtimeMs: 4000,
      size: byteLen(newBib),
      content: newBib,
    });
    await h.watcher.pollNow();
    // Confirm path read the .bib content via readTextFile, exact relPath...
    expect(h.readTextFile).toHaveBeenCalledWith("doc1", "references.bib");
    // ...but name resolution was NOT re-run (cachedBibName still valid).
    expect(h.getBibFilename).not.toHaveBeenCalled();
  });
});

describe("disk-watcher: acknowledge 'removed' sticks", () => {
  it("acknowledging a removed file drops its ledger entry so it stays clean", async () => {
    const h = makeHarness();
    baseline("main.tex", h.disk.get("main.tex")!);
    baseline("references.bib", h.disk.get("references.bib")!);
    await h.prime();

    // External removal of the .bib.
    h.disk.delete("references.bib");
    await h.watcher.pollNow();
    expect(h.watcher.store.getSnapshot().changes).toEqual<FileChange[]>([
      { relPath: "references.bib", role: "bib", kind: "removed" },
    ]);

    // Acknowledge → store clears AND the ledger entry is dropped.
    await h.watcher.acknowledge();
    expect(h.watcher.store.getSnapshot().changes).toEqual([]);
    expect(getDiskFingerprint("doc1", "references.bib")).toBeUndefined();

    // Next poll (file STILL absent): no fp → ignored → STAYS clean (no re-flag).
    await h.watcher.pollNow();
    expect(h.watcher.store.getSnapshot().changes).toEqual([]);
    // And once more, to prove it isn't a one-poll fluke.
    await h.watcher.pollNow();
    expect(h.watcher.store.getSnapshot().changes).toEqual([]);
  });
});

describe("disk-watcher: stopped guard", () => {
  it("stop() during an in-flight poll prevents any store.set after stop", async () => {
    const h = makeHarness();
    baseline("main.tex", h.disk.get("main.tex")!);
    baseline("references.bib", h.disk.get("references.bib")!);
    await h.prime();

    // Arrange a genuine change so a completed poll WOULD set the store.
    const newContent = "externally changed mid-poll";
    h.disk.set("main.tex", {
      mtimeMs: 2000,
      size: byteLen(newContent),
      content: newContent,
    });

    // Make the confirm-read hang until we release it, so we can stop() while
    // the poll is awaiting inside runPoll (after the stat, before store.set).
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    h.readTextFile.mockImplementationOnce(async () => {
      await gate;
      return newContent;
    });

    const pollPromise = h.watcher.pollNow();
    // Stop while the poll is parked on the confirm-read.
    h.watcher.stop();
    // Release the read; runPoll resumes, hits the stopped-guard, and bails
    // BEFORE store.set.
    release();
    await pollPromise;

    // The store was NEVER set to the change — it stayed clean.
    expect(h.watcher.store.getSnapshot().changes).toEqual([]);
  });
});
