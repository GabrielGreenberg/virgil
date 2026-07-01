/**
 * Sidecar watcher — the headless detection core of LIVE sidecar reactivity.
 *
 * A per-doc, wall-clock-polled service that detects when an OUT-OF-BAND writer
 * (an AI agent drafting a card straight onto disk into `virgil/*.json` while the
 * paper is open) changes a panel-card sidecar, and — on a GENUINE external
 * change — invalidates the cached sidecar snapshot and dispatches a
 * `virgil-sidecar-changed` DOM event so the owning `usePersistentState` instance
 * re-reads. This is the sidecar analogue of the external-change `DiskWatcher`,
 * and it deliberately REUSES the same infrastructure:
 *
 *   - the same poll cadence (~3 s) + pause-while-`document.hidden` +
 *     immediate-on-focus behavior,
 *   - the same disk-ledger fingerprint baseline as the false-positive killer
 *     (Virgil's OWN debounced sidecar autosaves stamp the ledger via
 *     `writeSidecar`, so they never look external), and
 *   - the same cheap mtime/size drift → confirm-by-hash algorithm.
 *
 * WHY A SIBLING, NOT AN EXTENSION OF DiskWatcher: the `DiskWatcher`'s entire
 * output is an `ExternalChangeState` — a USER-FACING conflict-badge contract
 * (`changes[].relPath`, `severity`, a "Reload from disk" gesture that refetches
 * the WHOLE doc bundle). Sidecar reactivity is the opposite shape: SILENT and
 * self-healing — no badge, no severity, no user acknowledge, a per-FILE re-read
 * rather than a whole-doc reload. Folding `virgil/*.json` into the DiskWatcher's
 * `changes` array would leak "revisions.json changed on disk" into the badge and
 * its full-doc Reload. So this watcher shares the poll MECHANISM but emits a
 * plain event instead of a store snapshot.
 *
 * KEYSTROKE SANCTITY (hard invariant): this service MUST NOT subscribe to the
 * editor. It adds no `editor.on('update' | 'transaction')` handler and does
 * ZERO per-keystroke work. The poll is pure wall-clock (setInterval +
 * visibility/focus). It is therefore NOT an `editor.on(...)` subscriber and
 * needs no entry in AGENTS.md's permitted-subscribers list — it is, like
 * `DiskWatcher`, a permitted wall-clock service. Typing N plain characters runs
 * zero watcher code and leaves `__virgilBusStats().emitCount` flat.
 *
 * This module imports NO React.
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
// The DOM event: the single signal `usePersistentState` subscribes to.
// ---------------------------------------------------------------------------

/** Name of the CustomEvent dispatched on a genuine external sidecar change. */
export const SIDECAR_CHANGED_EVENT = "virgil-sidecar-changed";

/** Payload of {@link SIDECAR_CHANGED_EVENT}: which doc + which sidecar file. */
export interface SidecarChangedDetail {
  docId: string;
  /** The bare sidecar filename, e.g. `"revisions.json"` (NOT the `virgil/…` relPath). */
  filename: string;
}

/**
 * Dispatch the change signal. Split out so both this watcher AND tests can
 * emit it, and so the (rare) no-`window` path (SSR) is a safe no-op. Callers in
 * `usePersistentState` listen via `addEventListener(SIDECAR_CHANGED_EVENT, …)`.
 */
export function dispatchSidecarChanged(detail: SidecarChangedDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<SidecarChangedDetail>(SIDECAR_CHANGED_EVENT, { detail }),
  );
}

// ---------------------------------------------------------------------------
// Watcher factory — dependency-injected for testability (mirrors DiskWatcher)
// ---------------------------------------------------------------------------

export interface SidecarWatcherDeps {
  docId: string;
  /** The sidecar filenames (bare, e.g. `"revisions.json"`) to poll. */
  filenames: readonly string[];
  /** {mtimeMs,size} stat for a set of relPaths. Throws only on FSA permission loss. */
  statFiles: typeof import("@/lib/storage").statFiles;
  /**
   * Generic NON-stamping reader of the EXACT relPath (`virgil/<filename>`). Used
   * for BOTH the prime baseline AND the confirm-by-hash suspicion read, so the
   * bytes hashed are always the same file that was just stat'd. Returns `null` if
   * absent; re-throws on FSA permission loss. NEVER stamps the ledger, so a
   * confirm-read can never re-baseline the external edit it is surfacing.
   */
  readTextFile: (docId: string, relPath: string) => Promise<string | null>;
  /**
   * Drop the cached sidecar snapshot for the doc so the next `readSidecarIfExists`
   * re-hits disk. In production this is `invalidateSidecarBundle`.
   */
  invalidateSidecarBundle: (docId: string) => void;
  /** Emit the per-file change signal. In production this is {@link dispatchSidecarChanged}. */
  emitChange?: (detail: SidecarChangedDetail) => void;
  /** Poll interval in ms. Default 3000 (matches DiskWatcher). */
  pollMs?: number;
  /** True while the tab is hidden — poll is a no-op. Default visibilityState check. */
  isHidden?: () => boolean;
}

export interface SidecarWatcher {
  /** Wire the interval + visibility/focus listeners and poll immediately (PRIME). */
  start(): void;
  /** Tear down timers + listeners. Does NOT clear the ledger (unload owns that). */
  stop(): void;
  /** Run one poll cycle. Tests call this directly. */
  pollNow(): Promise<void>;
}

const DEFAULT_POLL_MS = 3000;

/** Build the `virgil/<filename>` relPath the stat/read/ledger all key on. */
function relPathFor(filename: string): string {
  return `virgil/${filename}`;
}

export function createSidecarWatcher(deps: SidecarWatcherDeps): SidecarWatcher {
  const {
    docId,
    filenames,
    statFiles,
    readTextFile,
    invalidateSidecarBundle,
    emitChange = dispatchSidecarChanged,
    pollMs = DEFAULT_POLL_MS,
    isHidden = () =>
      typeof document !== "undefined" &&
      document.visibilityState === "hidden",
  } = deps;

  let intervalId: ReturnType<typeof setInterval> | null = null;
  // Guards against overlapping poll cycles (a slow confirm-read shouldn't let a
  // second tick interleave). Mirrors DiskWatcher.
  let polling = false;

  // PRIME pass: the FIRST poll after (re)start is a BASELINE pass — it stamps
  // every PRESENT watched sidecar to current on-disk bytes and NEVER emits, then
  // flips primed=true. This absorbs the mount-time state: at doc-open the sidecar
  // bundle was just read (and possibly a load-migration write is mid-flight), so
  // priming to current disk bytes prevents a spurious first-poll "changed".
  // Accepted negligible gap: an external edit landing in the sub-pollMs window
  // between mount and the prime poll is baselined as current (same trade-off as
  // DiskWatcher's prime).
  let primed = false;

  // Stopped guard: set true in stop(); after EACH await we bail BEFORE any
  // stamp/emit, so a teardown that races an in-flight async poll never mutates
  // state post-stop. Mirrors DiskWatcher's Fix E.
  let stopped = false;

  const relPaths = filenames.map(relPathFor);

  async function pollNow(): Promise<void> {
    // Hidden gate — do nothing.
    if (isHidden()) return;
    if (polling) return;
    polling = true;
    try {
      await runPoll();
    } finally {
      polling = false;
    }
  }

  async function readContentFor(relPath: string): Promise<string | null> {
    try {
      return await readTextFile(docId, relPath);
    } catch {
      // Permission loss is swallowed to null here; the next statFiles surfaces
      // it as a throw → caught below and skipped for this poll.
      return null;
    }
  }

  async function runPoll(): Promise<void> {
    // 1. Stat the watched set. Permission loss → skip this poll (no state to
    //    pause — unlike DiskWatcher we have no badge; just try again next tick).
    let stats: Record<string, FileStat | null>;
    try {
      stats = await statFiles(docId, relPaths);
    } catch {
      return;
    }
    if (stopped) return;

    // PRIME pass: baseline every PRESENT sidecar to current on-disk bytes and
    // NEVER emit. Absent files are skipped (no ledger entry → a later create is
    // treated as a new-file baseline, not a change; see step 3 below). Then flip
    // primed=true.
    if (!primed) {
      for (let i = 0; i < filenames.length; i++) {
        const relPath = relPaths[i];
        const live = stats[relPath];
        if (live === null || live === undefined) continue; // absent → skip
        const content = await readContentFor(relPath);
        if (stopped) return;
        if (content !== null) {
          stampDiskFingerprint(docId, relPath, fingerprintOf(live, content));
        }
      }
      primed = true;
      return;
    }

    // 3. Classify each watched sidecar. A GENUINE external change (or an external
    //    CREATE / REMOVE) invalidates the bundle ONCE and emits per changed file.
    let invalidated = false;
    const emit: SidecarChangedDetail[] = [];

    for (let i = 0; i < filenames.length; i++) {
      const filename = filenames[i];
      const relPath = relPaths[i];
      const live = stats[relPath];
      const fp = getDiskFingerprint(docId, relPath);

      if (live === null || live === undefined) {
        // Absent on disk.
        if (fp !== undefined) {
          // We had a baseline → external removal. Drop the baseline (mirrors the
          // DiskWatcher acknowledge-of-removal) so we don't re-emit every poll,
          // and signal a re-read (the file now reads as absent → default state).
          clearDiskFingerprint(docId, relPath);
          if (!invalidated) {
            invalidateSidecarBundle(docId);
            invalidated = true;
          }
          emit.push({ docId, filename });
        }
        // else: file simply never existed → ignore.
        continue;
      }

      // Present on disk.
      if (fp === undefined) {
        // Unledgered but present: after priming this is a NEWLY-appeared sidecar
        // (e.g. an agent creating notes.json mid-session). Treat as a change:
        // baseline it, invalidate, and emit so the panel picks it up.
        const content = await readContentFor(relPath);
        if (stopped) return;
        if (content !== null) {
          stampDiskFingerprint(docId, relPath, fingerprintOf(live, content));
          if (!invalidated) {
            invalidateSidecarBundle(docId);
            invalidated = true;
          }
          emit.push({ docId, filename });
        }
        continue;
      }

      if (live.mtimeMs === fp.mtimeMs && live.size === fp.size) {
        // Cheap path: unchanged. NO read.
        continue;
      }

      // SUSPICION: mtime/size drift. Confirm by hash (one read of the EXACT
      // relPath we just stat'd).
      const content = await readContentFor(relPath);
      if (stopped) return;
      if (content === null) continue; // couldn't read — treat as no-op this poll
      const h = hashContent(content);
      if (h === fp.hash) {
        // False positive (touch / identical bytes). RE-BASELINE so we don't
        // re-read every poll.
        stampDiskFingerprint(docId, relPath, fingerprintOf(live, content));
        continue;
      }
      // Genuine external change. Re-baseline to the NEW on-disk bytes (so we
      // don't re-emit next poll), invalidate the bundle once, emit for this file.
      stampDiskFingerprint(docId, relPath, fingerprintOf(live, content));
      if (!invalidated) {
        invalidateSidecarBundle(docId);
        invalidated = true;
      }
      emit.push({ docId, filename });
    }

    if (stopped) return;
    for (const detail of emit) emitChange(detail);
  }

  const onVisibilityOrFocus = (): void => {
    // Poll immediately when the user returns (an agent may have written while the
    // tab was hidden). The pollNow hidden-gate handles the "still hidden" case.
    void pollNow();
  };

  function start(): void {
    if (intervalId !== null) return; // idempotent
    stopped = false;
    primed = false;
    intervalId = setInterval(() => void pollNow(), pollMs);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityOrFocus);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("focus", onVisibilityOrFocus);
    }
    // Poll immediately on start — the PRIME (baseline) pass.
    void pollNow();
  }

  function stop(): void {
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
    // NOTE: we do NOT clear the ledger here — the doc-unload owner is responsible.
  }

  return { start, stop, pollNow };
}
