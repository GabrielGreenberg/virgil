/**
 * Disk watcher — the headless detection core of the external-change badge
 * (design: docs/memos/external-change-badge/DESIGN.md §2, §4, §9, §10).
 *
 * A per-doc, wall-clock-polled service that always knows whether the on-disk
 * bytes of the files Virgil owns (main `.tex` + resolved `.bib` in v1) still
 * match what Virgil last wrote or read — using the disk ledger as the
 * "expected on-disk fingerprint" baseline (the false-positive killer). When a
 * file's live `{mtime,size}` drifts from the ledger, the watcher does ONE
 * confirming read + content-hash compare; only a genuine byte mismatch flags.
 *
 * KEYSTROKE SANCTITY (hard invariant): this service MUST NOT subscribe to the
 * editor. It adds no `editor.on('update' | 'transaction')` handler and does
 * ZERO per-keystroke work. The only editor touch is the O(1) `hasUnsavedEdits()`
 * getter, which is PULLED (called) during a poll, never pushed. The poll is
 * pure wall-clock (setInterval + visibility/focus). It is therefore NOT an
 * `editor.on(...)` subscriber and needs no entry in AGENTS.md's permitted-
 * subscribers list — it is documented as a permitted wall-clock service.
 *
 * This module imports NO React. The store is plain `useSyncExternalStore`-
 * compatible (`subscribe` / `getSnapshot`), with a STABLE snapshot identity:
 * `getSnapshot()` returns the same object reference until the state actually
 * changes, so a React consumer never loops.
 */

import {
  getDiskFingerprint,
  stampDiskFingerprint,
  clearDiskFingerprint,
  hashContent,
  fingerprintOf,
} from "@/lib/disk-ledger";
import type { FileStat } from "@/lib/storage";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type WatchedRole = "tex" | "bib";
export type FileChangeKind = "modified" | "removed";
export type ExternalChangeSeverity = "change" | "conflict";

export interface FileChange {
  relPath: string;
  role: WatchedRole;
  kind: FileChangeKind;
}

export interface ExternalChangeState {
  /** Immutable — the store freezes this array (Fix E). Consumers must not mutate. */
  changes: readonly FileChange[];
  severity: ExternalChangeSeverity | null;
  detectedAt: number | null;
  paused: boolean;
}

/** The clean (no-change) state. Frozen so the shared default is immutable. */
const CLEAN_STATE: ExternalChangeState = Object.freeze({
  changes: Object.freeze([] as FileChange[]),
  severity: null,
  detectedAt: null,
  paused: false,
});

// ---------------------------------------------------------------------------
// Store — useSyncExternalStore-compatible, stable snapshot identity
// ---------------------------------------------------------------------------

export interface ExternalChangeStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ExternalChangeState;
}

interface MutableStore extends ExternalChangeStore {
  /**
   * Replace the snapshot if `next` differs by value from the current one.
   * Returns true if the snapshot changed (and listeners were notified).
   */
  set(next: ExternalChangeState): boolean;
}

function fileChangesEqual(
  a: readonly FileChange[],
  b: readonly FileChange[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x.relPath !== y.relPath || x.role !== y.role || x.kind !== y.kind) {
      return false;
    }
  }
  return true;
}

function statesEqual(a: ExternalChangeState, b: ExternalChangeState): boolean {
  return (
    a.severity === b.severity &&
    a.detectedAt === b.detectedAt &&
    a.paused === b.paused &&
    fileChangesEqual(a.changes, b.changes)
  );
}

function createStore(): MutableStore {
  // The frozen current snapshot. Identity is stable until `set` swaps it.
  let snapshot: ExternalChangeState = CLEAN_STATE;
  const listeners = new Set<() => void>();

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot(): ExternalChangeState {
      return snapshot;
    },
    set(next: ExternalChangeState): boolean {
      if (statesEqual(snapshot, next)) return false;
      // Freeze a fresh immutable snapshot — BOTH the object AND its changes
      // array (Fix E) — so consumers can't mutate it and identity comparison
      // stays meaningful. The `changes` array is freshly built each poll (or
      // the shared empty CLEAN_STATE.changes, which is never mutated), so
      // freezing it in place is safe.
      snapshot = Object.freeze({
        changes: Object.freeze([...next.changes]),
        severity: next.severity,
        detectedAt: next.detectedAt,
        paused: next.paused,
      });
      for (const l of listeners) l();
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// Watcher factory — dependency-injected for testability
// ---------------------------------------------------------------------------

export interface DiskWatcherDeps {
  docId: string;
  /** {mtimeMs,size} stat for a set of relPaths. Throws only on FSA permission loss. */
  statFiles: typeof import("@/lib/storage").statFiles;
  /**
   * Generic NON-stamping reader of the EXACT relPath. Used for BOTH the prime
   * baseline AND the confirm-by-hash suspicion read, so the bytes hashed are
   * always the same file that was just stat'd (no `readTex`/`readBib` name
   * re-resolution can repoint mid-poll). Returns `null` if absent; re-throws on
   * FSA permission loss. This reader NEVER stamps the ledger, so a confirm-read
   * can never re-baseline the external edit it is surfacing (the anti-flicker
   * invariant). Production: the storage facade's `readTextFile`.
   */
  readTextFile: (docId: string, relPath: string) => Promise<string | null>;
  /**
   * Resolve the watched .bib filename WITHOUT reading .bib content or stamping
   * the ledger. Used for NAME resolution only, so a name lookup never
   * re-baselines anything (the anti-flicker invariant). Content is read by the
   * generic `readTextFile` against the resolved name.
   */
  getBibFilename: (docId: string) => Promise<string>;
  /** The main .tex filename (e.g. "main.tex"). */
  getTexFilename: (docId: string) => Promise<string> | string;
  /** Pulled at poll time; true while there are unsaved in-editor edits. */
  hasUnsavedEdits?: () => boolean;
  /** Injectable clock. Default `Date.now`. */
  now?: () => number;
  /** Poll interval in ms. Default 3000. */
  pollMs?: number;
  /** True while the tab is hidden — poll is a no-op. Default visibilityState check. */
  isHidden?: () => boolean;
}

export interface DiskWatcher {
  store: ExternalChangeStore;
  /** Wire the interval + visibility/focus listeners and poll immediately. */
  start(): void;
  /** Tear down timers + listeners. Does NOT clear the ledger (unload owns that). */
  stop(): void;
  /** Run one poll cycle. Tests call this directly. */
  pollNow(): Promise<void>;
  /** "Keep mine / Dismiss": re-baseline the changed files, then clear the store. */
  acknowledge(): Promise<void>;
  /** Optimistic clear (e.g. right after a Reload). Next poll re-confirms. */
  clearChanges(): void;
  /** True if there's an unresolved external change (autosave-pause guard). */
  hasUnresolvedChange(): boolean;
}

const DEFAULT_POLL_MS = 3000;

export function createDiskWatcher(deps: DiskWatcherDeps): DiskWatcher {
  const {
    docId,
    statFiles,
    readTextFile,
    getBibFilename,
    getTexFilename,
    hasUnsavedEdits = () => false,
    now = () => Date.now(),
    pollMs = DEFAULT_POLL_MS,
    isHidden = () =>
      typeof document !== "undefined" &&
      document.visibilityState === "hidden",
  } = deps;

  const store = createStore();

  // Cached resolved .bib filename. `undefined` = not yet learned (or
  // invalidated by a .tex change — step 6); learning it again is a
  // getBibFilename (NON-stamping name resolve, never a readBib).
  let cachedBibName: string | undefined;

  let intervalId: ReturnType<typeof setInterval> | null = null;
  // Guards against overlapping poll cycles (a slow confirm-read shouldn't let
  // a second tick interleave).
  let polling = false;

  // PRIME pass (Fix C): the FIRST poll after (re)start is a BASELINE pass —
  // it stamps every PRESENT watched file to the current on-disk bytes and
  // NEVER flags, then flips primed=true. This deterministically prevents a
  // false "changed on disk" flash on every open: at doc-open the editor
  // reflects exactly what readDocBundle loaded, but the load-time UUID
  // writeback may still be mid-flight, so the .tex bytes on disk are about to
  // change to Virgil's own re-stamped version. Priming to current disk bytes
  // absorbs that, and also establishes the .bib baseline (readBib no longer
  // stamps it). Accepted negligible gap: an external edit landing in the
  // sub-pollMs window between load and the prime poll is baselined as current.
  let primed = false;

  // Stopped guard (Fix E): set true in stop(); after EACH await in a poll /
  // acknowledge we bail BEFORE any store.set or stamp, so a teardown that
  // races an in-flight async poll never mutates state post-stop.
  let stopped = false;

  // -------------------------------------------------------------------------
  // The poll algorithm (see DESIGN §4/§9/§10 + the chip's exact spec).
  // -------------------------------------------------------------------------

  async function pollNow(): Promise<void> {
    // 0. Hidden gate — do nothing (do not clear existing state).
    if (isHidden()) return;
    if (polling) return;
    polling = true;
    try {
      await runPoll();
    } finally {
      polling = false;
    }
  }

  async function runPoll(): Promise<void> {
    // 1. Resolve the watched set. The .bib NAME is resolved via the
    //    NON-stamping getBibFilename — never readBib — so a name lookup can't
    //    re-baseline the ledger (the anti-flicker invariant).
    const texName = await getTexFilename(docId);
    if (stopped) return;
    if (cachedBibName === undefined) {
      cachedBibName = await getBibFilename(docId);
      if (stopped) return;
    }
    const watched: Array<{ relPath: string; role: WatchedRole }> = [
      { relPath: texName, role: "tex" },
    ];
    if (cachedBibName) {
      watched.push({ relPath: cachedBibName, role: "bib" });
    }
    const paths = watched.map((w) => w.relPath);

    // 2. Stat the watched set. Permission loss → pause and return.
    let stats: Record<string, FileStat | null>;
    try {
      stats = await statFiles(docId, paths);
    } catch {
      if (stopped) return;
      // FSA NotAllowedError (permission lost). Pause the watcher; KEEP any
      // existing changes (don't misread a permission loss as a resolution).
      const prev = store.getSnapshot();
      store.set({ ...prev, paused: true });
      return;
    }
    if (stopped) return;

    // PRIME pass (Fix C): the first poll after (re)start baselines every
    // PRESENT watched file to the current on-disk bytes and NEVER flags.
    // Absent files are skipped (no flag). This absorbs the load-writeback
    // race + establishes the .bib baseline. Then flip primed=true.
    if (!primed) {
      for (const { relPath } of watched) {
        const live = stats[relPath];
        if (live === null || live === undefined) continue; // absent → skip
        // Read the EXACT relPath we just stat'd (non-stamping). Hashing the
        // same file that was stat'd closes the mid-poll repoint race.
        const content = await readContentFor(relPath);
        if (stopped) return;
        if (content !== null) {
          stampDiskFingerprint(docId, relPath, fingerprintOf(live, content));
        }
      }
      primed = true;
      // Priming establishes the baseline only; the snapshot stays clean.
      // (store.set is identity-stable, so a clean→clean set is a no-op.)
      store.set(CLEAN_STATE);
      return;
    }

    // 3. Classify each watched path.
    const changes: FileChange[] = [];
    let texChanged = false;

    for (const { relPath, role } of watched) {
      const live = stats[relPath];
      const fp = getDiskFingerprint(docId, relPath);

      if (live === null || live === undefined) {
        // Absent on disk.
        if (fp !== undefined) {
          // We had a baseline → external removal.
          changes.push({ relPath, role, kind: "removed" });
          if (role === "tex") texChanged = true;
        }
        // else: file simply doesn't exist (e.g. no .bib) → ignore.
        continue;
      }

      // Present on disk.
      if (fp === undefined) {
        // Unledgered but present: BASELINE, never flag. (After priming this is
        // a newly-appeared file, e.g. a .bib created mid-session.)
        const content = await readContentFor(relPath);
        if (stopped) return;
        if (content !== null) {
          stampDiskFingerprint(docId, relPath, fingerprintOf(live, content));
        }
        continue;
      }

      if (live.mtimeMs === fp.mtimeMs && live.size === fp.size) {
        // Cheap path: unchanged. NO read.
        continue;
      }

      // SUSPICION: mtime/size drift. Confirm by hash (one read of the EXACT
      // relPath we just stat'd — the same file, no name re-resolution).
      const content = await readContentFor(relPath);
      if (stopped) return;
      if (content === null) continue; // couldn't read — treat as no-op this poll
      const h = hashContent(content);
      if (h === fp.hash) {
        // False positive (touch / load-writeback / identical bytes).
        // RE-BASELINE so we don't re-read every poll.
        stampDiskFingerprint(docId, relPath, fingerprintOf(live, content));
        continue;
      }
      // Genuine external change.
      changes.push({ relPath, role, kind: "modified" });
      if (role === "tex") texChanged = true;
    }

    // 5. Severity (re-evaluated EVERY poll — unsaved-state flips change↔conflict).
    const severity: ExternalChangeSeverity | null =
      changes.length > 0 ? (hasUnsavedEdits() ? "conflict" : "change") : null;

    // 6. A .tex change can change `\bibliography{}` → re-resolve the .bib next poll.
    if (texChanged) {
      cachedBibName = undefined;
    }

    // 7. Compute the next state. Preserve detectedAt when the change-SET is
    //    unchanged; (re)stamp it on clean→changed or on a membership change.
    if (stopped) return;
    const prev = store.getSnapshot();
    let detectedAt: number | null;
    if (changes.length === 0) {
      detectedAt = null;
    } else if (fileChangesEqual(prev.changes, changes) && prev.detectedAt !== null) {
      detectedAt = prev.detectedAt;
    } else {
      detectedAt = now();
    }

    store.set({ changes, severity, detectedAt, paused: false });
  }

  /**
   * Read the on-disk content for an EXACT relPath, or null on failure. Always
   * the same file that was stat'd this poll (no name re-resolution), and never
   * stamps the ledger — so a confirm-read can't re-baseline the change it is
   * surfacing. A permission loss (FSA NotAllowedError) is swallowed to null
   * here; the next `statFiles` call surfaces it as the pause.
   */
  async function readContentFor(relPath: string): Promise<string | null> {
    try {
      return await readTextFile(docId, relPath);
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  const onVisibilityOrFocus = (): void => {
    // Poll immediately when the user returns (the moment they come back from
    // Overleaf). The pollNow hidden-gate handles the "still hidden" case.
    void pollNow();
  };

  function start(): void {
    if (intervalId !== null) return; // idempotent
    // (Re)start: clear the stopped guard and re-arm the PRIME pass so the
    // immediate poll below baselines to current disk bytes (Fix C).
    stopped = false;
    primed = false;
    intervalId = setInterval(() => void pollNow(), pollMs);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityOrFocus);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("focus", onVisibilityOrFocus);
    }
    // Poll immediately on start — this is the PRIME (baseline) pass.
    void pollNow();
  }

  function stop(): void {
    // Set the stopped guard FIRST so any in-flight async poll bails before its
    // next store.set/stamp (Fix E).
    stopped = true;
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("focus", onVisibilityOrFocus);
    }
    // NOTE: we do NOT clearDiskLedger here — the doc-unload owner is
    // responsible for that. Stopping a watcher only tears down timers.
  }

  // -------------------------------------------------------------------------
  // Reconcile actions
  // -------------------------------------------------------------------------

  /**
   * "Keep mine / Dismiss". Resolve every currently-changed file so the badge
   * clears and stays clear, then set the store clean.
   *
   * For 'modified': re-baseline to the on-disk fingerprint (read content +
   *   re-stat + stamp) so the next autosave's overwrite is "expected".
   * For 'removed': DROP the stale ledger entry via clearDiskFingerprint (Fix
   *   D). With no fingerprint, the next poll sees absent + no fp → ignored, so
   *   the acknowledged removal stays clean instead of re-flagging every poll.
   *   If Virgil later recreates the file via its own write, that write
   *   re-stamps the ledger authoritatively.
   */
  async function acknowledge(): Promise<void> {
    const { changes } = store.getSnapshot();
    for (const change of changes) {
      if (change.kind === "removed") {
        // No file to fingerprint — drop the baseline so it stays clean.
        clearDiskFingerprint(docId, change.relPath);
        continue;
      }
      try {
        const stats = await statFiles(docId, [change.relPath]);
        if (stopped) return;
        const live = stats[change.relPath];
        if (!live) continue; // vanished between flag and ack — nothing to baseline
        // Read the EXACT changed relPath (non-stamping, same file we stat'd).
        const content = await readContentFor(change.relPath);
        if (stopped) return;
        if (content === null) continue;
        stampDiskFingerprint(docId, change.relPath, fingerprintOf(live, content));
      } catch {
        if (stopped) return;
        // Permission loss mid-acknowledge — leave the ledger; the store clear
        // below still happens, and the next poll will re-pause if needed.
      }
    }
    if (stopped) return;
    store.set(CLEAN_STATE);
  }

  /** Optimistic clear (e.g. right after a Reload is triggered). */
  function clearChanges(): void {
    store.set(CLEAN_STATE);
  }

  function hasUnresolvedChange(): boolean {
    return store.getSnapshot().changes.length > 0;
  }

  return {
    store,
    start,
    stop,
    pollNow,
    acknowledge,
    clearChanges,
    hasUnresolvedChange,
  };
}
