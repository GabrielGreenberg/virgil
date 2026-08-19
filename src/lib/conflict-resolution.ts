/**
 * **Symmetric resolution of an external-change conflict** — task 364.
 *
 * The `DiskWatcher`'s detection is honest and its posture is right: when the
 * bytes on disk drift from what Virgil last wrote AND the editor holds unsaved
 * edits, the autosave PAUSES rather than clobbering the external write, and the
 * badge surfaces the conflict. What was missing is the other half of that
 * posture. A conflict has two sides — the bytes on disk and the unsaved model
 * in the editor — and only the DISK side had a door: "Reload", which discards
 * the user's edits. Their own side had none.
 *
 * > **A guard that pauses on a conflict owes BOTH sides a door, and a door that
 * > discards one side puts that side in the net FIRST. Which door was chosen
 * > may not change what the net holds — the two doors differ only in which side
 * > they APPLY.**
 *
 * That is why the archive is not a per-door step. Making it one is how the two
 * doors come to disagree about what gets kept: the shape this cluster keeps
 * re-learning (AGENTS.md, "what the hover OFFERS is what the commit ACCEPTS").
 * Here the order is stated ONCE and both doors are derived from it.
 *
 * ## Why the ports rather than the calls
 *
 * The three operations live in three different places — the archive in the
 * storage backend, the write in `useDocument` (which is the only holder of the
 * live editor model), the re-baseline on the watcher — and the thing that must
 * not drift is the ORDER, not the plumbing. Ports make that order the testable
 * artifact: the contract suite drives the real handlers and asserts the net
 * lands before either side is applied, which is the one property no per-door
 * implementation can be trusted to keep on its own.
 *
 * ## Failure direction
 *
 * A net that could not be taken does NOT cancel the resolution. The user is
 * mid-conflict with a paused autosave; refusing to resolve strands them with no
 * way forward and no explanation, which is worse than the risk being guarded.
 * So the resolution proceeds and REPORTS `archive: null`, and the surface says
 * so rather than repeating a promise it cannot keep. Whether an unnetted
 * resolution deserves a confirm is a question for the affordance, and it can
 * only be asked because the outcome carries the fact.
 */
import type { ConflictArchive } from "@/lib/storage-types";

/** Which side of the conflict the user chose to keep. */
export type ConflictChoice = "keep-mine" | "take-disk";

export interface ConflictPorts {
  /**
   * Archive BOTH sides into one `virgil/.history/` slot. `null` = no net was
   * taken (no history layer, a permission loss, an IO failure).
   */
  archive: () => Promise<ConflictArchive | null>;
  /**
   * Re-baseline the watcher's ledger to the CURRENT disk bytes and clear the
   * badge. This is what un-pauses the autosave, so it runs BEFORE the keep-mine
   * write — otherwise the write the user just asked for is the one write the
   * clobber-guard is still holding back.
   */
  acknowledge: () => Promise<void>;
  /** Apply the user's side: write the live editor model over disk, now. */
  keepMine: () => Promise<void>;
  /** Apply the disk's side: reload the document from disk. */
  takeDisk: () => Promise<void>;
}

export interface ConflictOutcome {
  choice: ConflictChoice;
  /** What the net holds, or `null` when none could be taken. */
  archive: ConflictArchive | null;
  /** False when the chosen side failed to apply (the badge stays up). */
  applied: boolean;
}

/**
 * Archive both sides, then apply the chosen one. The ONE door every conflict
 * resolution enters.
 */
export async function resolveExternalConflict(
  choice: ConflictChoice,
  ports: ConflictPorts,
): Promise<ConflictOutcome> {
  // THE NET, FIRST, AND THE SAME FOR BOTH DOORS. Not `Promise.all` with the
  // apply: an archive that lands after the write it exists to survive is not a
  // net, it is a copy of the outcome.
  const archive = await ports.archive();

  try {
    if (choice === "keep-mine") {
      // Resolve the watcher BEFORE writing: `hasUnresolvedChange()` gates every
      // save path in `useDocument` (the autosave-clobber guard), so a write
      // issued while the conflict still stands is the one write that gets held
      // back. Re-baselining also makes the write that follows "expected" rather
      // than a second external change to the watcher's own eyes.
      await ports.acknowledge();
      await ports.keepMine();
    } else {
      // Reload re-reads the bundle, which re-baselines the ledger on the load
      // path — the same resolution today's Reload already relies on, so there
      // is no acknowledge to pair with it.
      await ports.takeDisk();
    }
  } catch (e) {
    console.error(`[virgil] conflict resolution "${choice}" failed:`, e);
    return { choice, archive, applied: false };
  }

  return { choice, archive, applied: true };
}
