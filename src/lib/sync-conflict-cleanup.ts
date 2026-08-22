/**
 * **The cleanup half** — what Virgil is entitled to DELETE out of a paper's
 * `virgil/` folder (task 411), and the reason it is entitled to.
 *
 * [sidecar-value.ts](sidecar-value.ts) declares what each sidecar is WORTH and
 * [sync-conflict.ts](sync-conflict.ts) notices what a sync daemon did to the
 * folder. Task 363 stopped there on purpose: *Virgil does not merge or delete a
 * fork; it REPORTS.* That boundary was right for the question 363 could answer,
 * and it left a folder that keeps filling with nothing the user can do about it
 * from inside the app.
 *
 * > **An inert verdict is POSITIVE evidence, and a shape the tool does not
 * > understand is not evidence.** So the deletable set is not "the forks we
 * > guess are safe" — it is the two shapes the app's own declarations already
 * > PROVE carry nothing:
 * >
 * > - a fork of a **VIEW-tier** sidecar, which `sidecar-value.ts` declares
 * >   recomputable by definition (a scroll offset, a fold set, a focus band,
 * >   presence heartbeats). Its live twin is not writing, so neither is its
 * >   fork.
 * > - a **`.crswap`** temp file, which `sync-conflict.ts` declares browser
 * >   debris: either a partial copy of a write that never landed or a complete
 * >   copy of one that did.
 *
 * Everything else is REPORTED and KEPT — a content fork, whatever a comparison
 * of its bytes might say, and any decoration this module's grammar does not
 * recognize. **A content fork is never deletable from inside Virgil**, which is
 * the whole of Gabriel's decision on this (2026-08-21): the two sides are
 * whole-file snapshots taken at unknown times, and picking a winner is precisely
 * the destructive act the sync service itself declined to make. The offline
 * `tools/triage-sync-conflicts.mjs` remains the place where a human compares
 * them.
 *
 * ## Why there is no byte comparison here
 *
 * The offline tool prunes a CONTENT fork whose parsed JSON is structurally
 * identical to the live file, and it is right to: it runs with the app closed,
 * against a folder the daemon is not touching, on a decision the operator made.
 * In-app that same comparison would buy nothing the rule above does not already
 * give, and would cost the one thing this surface cannot afford — a delete
 * decided by a computation the user cannot see. The tier and the `.crswap`
 * suffix are DECLARATIONS; a `deepEqual` is a verdict.
 *
 * ## Why there is no net
 *
 * Every other destructive door in this cluster archives into `virgil/.history/`
 * first (task 364's conflict net, task 357's forensic snapshot). This one does
 * not, deliberately: a `.history/` slot is itself sync traffic in a folder whose
 * whole problem is sync traffic (task 415's rule), and archiving bytes that
 * provably carry nothing keeps the file count while pretending to reduce it.
 * **The proof IS the net** — nothing in the plan is content by the app's own
 * declaration. The affordance names every file before it deletes, which is the
 * part a user can actually check.
 *
 * This module imports only the two SSOTs and is otherwise a leaf: the storage
 * backends (which must not import React) and the badge both read it.
 */

import { classifySidecarSibling } from "@/lib/sync-conflict";
import { sidecarTier } from "@/lib/sidecar-value";

/** Why one file is deletable — the DECLARATION that proves it, never a verdict
 *  computed from its bytes. */
export type SidecarCleanupReason =
  /** A fork of a file `sidecar-value.ts` declares VIEW state. */
  | "view-tier"
  /** Chrome File System Access write debris (`*.crswap`). */
  | "swap";

export interface SidecarCleanupEntry {
  /** The file as it sits on disk. */
  name: string;
  /** The declared sidecar it is a sibling OF. */
  base: string;
  reason: SidecarCleanupReason;
}

/**
 * The PLAN: which entries of a `virgil/` directory listing Virgil may delete.
 *
 * Pure and total over a listing — a name it cannot prove inert is simply absent
 * from the result, which is the fail-CLOSED direction. Feed it a raw listing (or
 * any subset of one); re-running it over its own input is idempotent.
 *
 * **This is the ONE place the deletable set is decided.** The storage door
 * re-derives from a FRESH listing at delete time rather than trusting a caller's
 * names, so a bug in a call site cannot name a content fork into the set — see
 * `deleteSidecarSiblings` in either backend.
 */
export function planSidecarCleanup(
  names: readonly string[],
): SidecarCleanupEntry[] {
  const out: SidecarCleanupEntry[] = [];
  for (const name of names) {
    const s = classifySidecarSibling(name);
    if (!s) continue; // a declared sidecar, a user's own file, an unknown grammar
    if (s.kind === "swap") {
      out.push({ name, base: s.base, reason: "swap" });
      continue;
    }
    // A CONFLICT fork. Deletable only where the base's declared tier says the
    // file is recomputable — `sidecarTier` fails closed to "content", so an
    // undeclared base can never reach this branch as view.
    if (sidecarTier(s.base) === "view") {
      out.push({ name, base: s.base, reason: "view-tier" });
    }
  }
  return out;
}

/**
 * What a cleanup actually did. Three buckets, because "it resolved without
 * throwing" is not a report (the rule tasks 357/364/392 each earned one door
 * over): the affordance reads this and says what happened rather than assuming
 * success.
 *
 * A requested name that is absent from the fresh listing is in NO bucket —
 * there was nothing to delete and nothing was kept.
 */
export interface SidecarCleanupReceipt {
  /** Removed by this run. */
  deleted: string[];
  /** Present on disk and NOT sanctioned by the plan — kept. The bucket that
   *  must stay empty for every content fork, whatever the caller asked for. */
  refused: string[];
  /** Sanctioned, attempted, and the delete failed (IO, permission). */
  failed: string[];
}

/** True when a cleanup had nothing at all to do. */
export function isEmptyCleanupReceipt(r: SidecarCleanupReceipt): boolean {
  return (
    r.deleted.length === 0 && r.refused.length === 0 && r.failed.length === 0
  );
}
