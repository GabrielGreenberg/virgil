// Task 363 — the DiskWatcher / disk-ledger interaction with a CLOUD-SYNC
// race-back, which is what the "does it ping-pong?" half of the task asks.
//
// A sync daemon is a third writer nothing in Virgil can serialize with, and it
// produces two shapes the ledger has to tell apart:
//
//   (a) a RE-WRITE of bytes Virgil itself just wrote (the daemon re-materializes
//       a file after uploading it — same content, new mtime/inode). This is the
//       ping-pong seed: if it read as an external change, the app would re-read,
//       the re-read would look like a local edit to the next writer, and the two
//       would take turns forever;
//   (b) a genuine LAND of a remote version whose bytes differ. That IS an
//       external change and must reach the panel once — and exactly once.
//
// The watcher already had the mechanism (a mtime/size drift confirmed by a
// content HASH against the ledger baseline). What it did not have was a leg
// naming this sequence, and the sequence is the thing the task asks to verify.
// A leg per shape, driven through the REAL watcher core with injected fakes.
//
// The other half of "no ping-pong" is that the app's reaction to an emit is a
// READ: `usePersistentState`'s handler calls `setState`, never `persist`, and
// defers entirely while a local write is pending. That half is pinned in
// usePersistentState.test.tsx ("live external-sidecar re-read").
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createSidecarWatcher,
  type SidecarWatcherDeps,
  type SidecarChangedDetail,
} from "@/lib/sidecar-watcher";
import {
  stampDiskFingerprint,
  fingerprintOf,
  __resetDiskLedgerForTests,
} from "@/lib/disk-ledger";

beforeEach(() => __resetDiskLedgerForTests());

const DOC = "doc-synced";
const FILE = "notes.json";
const REL = `virgil/${FILE}`;

interface FakeFile {
  mtimeMs: number;
  size: number;
  content: string;
}
const len = (s: string) => new TextEncoder().encode(s).length;

function harness(initial: string) {
  const disk = new Map<string, FakeFile>([
    [REL, { mtimeMs: 1000, size: len(initial), content: initial }],
  ]);
  const emitted: SidecarChangedDetail[] = [];
  const invalidate = vi.fn();
  const deps: SidecarWatcherDeps = {
    docId: DOC,
    filenames: [FILE],
    statFiles: (async (_d: string, paths: string[]) => {
      const out: Record<string, { mtimeMs: number; size: number } | null> = {};
      for (const p of paths) {
        const f = disk.get(p);
        out[p] = f ? { mtimeMs: f.mtimeMs, size: f.size } : null;
      }
      return out;
    }) as unknown as SidecarWatcherDeps["statFiles"],
    readTextFile: async (_d: string, p: string) => disk.get(p)?.content ?? null,
    invalidateSidecarBundle: invalidate,
    emitChange: (d) => emitted.push(d),
    pollMs: 3000,
    isHidden: () => false,
  };
  const watcher = createSidecarWatcher(deps);

  /** Virgil's own `writeSidecar`: new bytes AND a ledger stamp. */
  const virgilWrites = (content: string, mtimeMs: number) => {
    const f = { mtimeMs, size: len(content), content };
    disk.set(REL, f);
    stampDiskFingerprint(
      DOC,
      REL,
      fingerprintOf({ mtimeMs: f.mtimeMs, size: f.size }, f.content),
    );
  };
  /** The sync daemon: it touches the file and stamps NOTHING. */
  const daemonWrites = (content: string, mtimeMs: number) => {
    disk.set(REL, { mtimeMs, size: len(content), content });
  };

  return { watcher, emitted, invalidate, virgilWrites, daemonWrites };
}

const V1 = JSON.stringify({ cards: [{ id: "a" }] });
const V2 = JSON.stringify({ cards: [{ id: "a" }, { id: "b" }] });

describe("cloud-sync race-back (task 363)", () => {
  it("(a) a daemon RE-WRITE of Virgil's own bytes does not ping-pong", async () => {
    const h = harness(V1);
    await h.watcher.pollNow(); // prime

    // Virgil autosaves; the daemon uploads and then re-materializes the file
    // with a fresh mtime and a new inode. Same bytes.
    h.virgilWrites(V2, 2000);
    h.daemonWrites(V2, 5000);
    await h.watcher.pollNow();
    expect(h.emitted).toEqual([]);
    expect(h.invalidate).not.toHaveBeenCalled();

    // …and it re-baselines, so a second daemon touch is equally quiet rather
    // than costing a confirm-read on every 3 s poll for the rest of the session.
    h.daemonWrites(V2, 9000);
    await h.watcher.pollNow();
    expect(h.emitted).toEqual([]);
  });

  it("(b) a genuine remote LAND reaches the panel exactly once", async () => {
    const h = harness(V1);
    await h.watcher.pollNow();

    // The daemon lands a version written on another machine.
    h.daemonWrites(V2, 5000);
    await h.watcher.pollNow();
    expect(h.emitted).toEqual([{ docId: DOC, filename: FILE }]);
    expect(h.invalidate).toHaveBeenCalledTimes(1);

    // The app's reaction is a READ, so nothing further changes on disk — and
    // the watcher must not re-announce the same bytes for the rest of the
    // session, which is the loop half of the ping-pong.
    await h.watcher.pollNow();
    await h.watcher.pollNow();
    expect(h.emitted).toHaveLength(1);
    expect(h.invalidate).toHaveBeenCalledTimes(1);
  });

  it("Virgil writing AFTER a landed remote change does not re-announce its own write", async () => {
    const h = harness(V1);
    await h.watcher.pollNow();

    h.daemonWrites(V2, 5000);
    await h.watcher.pollNow();
    expect(h.emitted).toHaveLength(1);

    // The user edits a card; Virgil writes and stamps. That is not external.
    h.virgilWrites(JSON.stringify({ cards: [{ id: "c" }] }), 6000);
    await h.watcher.pollNow();
    expect(h.emitted).toHaveLength(1);
  });
});
