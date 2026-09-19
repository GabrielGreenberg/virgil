/**
 * Non-destructive citekey → uid migrations for the bib sidecars (T1 Stage 1).
 *
 * The DATA-LOSS bug (BIB-A2-01): `annotations.json` and `bib-review-requests
 * .json` key directly on the renameable citekey, so renaming a citekey stranded
 * the annotation/review (it pointed at a key the entry no longer carries). The
 * fix re-keys both onto the durable {@link BibEntry.uid}.
 *
 * The migration bar for a DATA-LOSS-class sidecar is **never a silent delete**
 * (PLAN D4). When a legacy citekey can't be routed to a FREE uid — because the
 * entry was renamed/removed *before* the upgrade, the `.bib` isn't loaded yet,
 * or the uid it resolves to is already occupied — the annotation is bucketed
 * under `orphanByKey` (or the review row keeps its bare `bibKey` with no
 * `entryUid`), recoverable later, not lost. The occupied-uid case is the one
 * the first cut got wrong: it resolved, so it took the write branch, and the
 * write branch declined to overwrite and then dropped what it declined to
 * write. `placeAnnotation` is now the single statement of that policy. The migration is additive + idempotent: re-running it over an
 * already-migrated state is a no-op.
 *
 * Pure functions, no React / storage — unit-tested directly. A `keyToUid`
 * resolver (citekey → uid, built from the freshly-parsed `BibEntry[]`) is
 * passed in so this module never imports the parser.
 */

import type {
  AnnotationsState,
  AnnotationsStateV2,
  BibEntry,
  BibReviewState,
} from "@/lib/types";

/** Build a citekey → uid resolver from the live entries. When two entries share
 *  a citekey (now possible — they carry distinct uids), the FIRST in source
 *  order wins; the second's annotation is reachable only by uid, which is the
 *  correct behavior (the dup-citekey collapse no longer fuses them). */
export function buildKeyToUid(entries: readonly BibEntry[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of entries) {
    if (e.key && e.uid && !m.has(e.key)) m.set(e.key, e.uid);
  }
  return m;
}

/** Type guard: is this an already-migrated v2 annotations state? */
export function isAnnotationsV2(raw: unknown): raw is AnnotationsStateV2 {
  return (
    !!raw &&
    typeof raw === "object" &&
    (raw as AnnotationsStateV2).v === 2 &&
    typeof (raw as AnnotationsStateV2).byUid === "object"
  );
}

const EMPTY_V2: AnnotationsStateV2 = { v: 2, byUid: {}, orphanByKey: {} };

/**
 * Place ONE annotation body into the v2 shape — the single statement of what
 * happens when a resolved uid is ALREADY occupied.
 *
 * Insert-if-absent, and the loser is KEPT in `orphanByKey` rather than dropped.
 * That second half is what makes the module header's "NEVER dropped" literally
 * true (task 647): the re-home loop used to write `if (!(uid in byUid))
 * byUid[uid] = html;` with no `else`, so an orphan whose citekey resolved onto
 * an occupied uid had its HTML discarded — and because the loop set its
 * `rehomed` flag regardless, the caller persisted the object the annotation had
 * just vanished from. A shadowed bucket is recoverable (it re-homes the moment
 * the occupant is cleared, and a human can still read it out of the sidecar); a
 * discarded one is not. This is the DATA-LOSS-class bar from PLAN D4: never a
 * silent delete, even on a path only a machine can reach.
 *
 * Returns whether anything actually MOVED into `byUid` — which is the v2
 * branch's `rehomed` signal, and is deliberately false for a shadowed orphan:
 * nothing changed, so the caller hands the input straight back and the
 * same-reference no-op contract below holds exactly as before.
 *
 * Both call sites route through here: the legacy-record branch faces the same
 * collision the moment two citekeys resolve to one uid, and re-deriving the
 * policy per branch is how the two halves drift apart.
 */
function placeAnnotation(
  byUid: Record<string, string>,
  orphanByKey: Record<string, string>,
  key: string,
  uid: string | undefined,
  html: string,
): boolean {
  if (!uid) {
    orphanByKey[key] = html; // unresolvable — recoverable, never dropped
    return false;
  }
  if (uid in byUid) {
    orphanByKey[key] = html; // SHADOWED — kept, not discarded
    return false;
  }
  byUid[uid] = html;
  return true;
}

/**
 * Migrate a legacy citekey-keyed annotations record to the uid-keyed v2 shape.
 * Each citekey that resolves to a FREE uid moves to `byUid[uid]`; everything
 * else — unresolvable, or resolving onto an already-occupied uid — lands in
 * `orphanByKey` (NEVER dropped; see {@link placeAnnotation}). Idempotent: a v2
 * input that still has
 * `orphanByKey` entries gets another pass at re-homing them against the current
 * resolver, so an orphan recovers the moment its entry re-appears.
 *
 * Returns the **same reference** when a v2 input re-homes nothing (no orphan
 * resolved this pass), so a React caller can run this in an effect gated on the
 * citekey→uid map: `update(prev => migrate(prev, keyToUid))` is then a no-op
 * `setState` (React bails on `Object.is`) on every keystroke-adjacent bib
 * change, and only the rare actual re-home produces a fresh object + a write.
 * This mirrors {@link migrateBibReviewToUid}'s same-ref-on-no-op contract and
 * is what makes the load/parse-race re-home effect safe from a render loop.
 *
 * @param raw      the on-disk value (legacy record OR v2).
 * @param keyToUid citekey → uid, from the freshly-parsed entries.
 */
export function migrateAnnotationsToV2(
  raw: unknown,
  keyToUid: Map<string, string>,
): AnnotationsStateV2 {
  if (raw == null || typeof raw !== "object") return { ...EMPTY_V2, byUid: {}, orphanByKey: {} };

  if (isAnnotationsV2(raw)) {
    // Re-home any orphans whose entry now exists; leave the rest orphaned.
    const byUid: Record<string, string> = { ...raw.byUid };
    const orphanByKey: Record<string, string> = {};
    let rehomed = false;
    for (const [key, html] of Object.entries(raw.orphanByKey ?? {})) {
      if (placeAnnotation(byUid, orphanByKey, key, keyToUid.get(key), html)) {
        rehomed = true;
      }
    }
    // Nothing re-homed → hand the input straight back so an effect-driven
    // re-home pass is a no-op setState (no re-render, no spurious persist).
    return rehomed ? { v: 2, byUid, orphanByKey } : raw;
  }

  // Legacy flat record: { [citekey]: html }.
  const legacy = raw as AnnotationsState;
  const byUid: Record<string, string> = {};
  const orphanByKey: Record<string, string> = {};
  for (const [key, html] of Object.entries(legacy)) {
    if (typeof html !== "string" || !html) continue;
    placeAnnotation(byUid, orphanByKey, key, keyToUid.get(key), html);
  }
  return { v: 2, byUid, orphanByKey };
}

/**
 * Migrate a bib-review state's rows to carry `entryUid`. A row whose `bibKey`
 * resolves to a uid gets `entryUid` stamped (kept alongside the human-readable
 * `bibKey` mirror); an unresolvable row keeps its bare `bibKey` (no uid) so the
 * pending review survives a rename-before-upgrade. Idempotent: a row that
 * already has `entryUid` is left untouched. Returns the same reference when
 * nothing changed so a caller can skip a persist.
 */
export function migrateBibReviewToUid(
  state: BibReviewState,
  keyToUid: Map<string, string>,
): BibReviewState {
  let changed = false;
  const requests = state.requests.map((r) => {
    if (r.entryUid) return r;
    const uid = keyToUid.get(r.bibKey);
    if (!uid) return r;
    changed = true;
    return { ...r, entryUid: uid };
  });
  return changed ? { requests } : state;
}
