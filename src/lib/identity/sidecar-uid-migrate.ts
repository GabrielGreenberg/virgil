/**
 * Non-destructive citekey → uid migrations for the bib sidecars (T1 Stage 1).
 *
 * The DATA-LOSS bug (BIB-A2-01): `annotations.json` and `bib-review-requests
 * .json` key directly on the renameable citekey, so renaming a citekey stranded
 * the annotation/review (it pointed at a key the entry no longer carries). The
 * fix re-keys both onto the durable {@link BibEntry.uid}.
 *
 * The migration bar for a DATA-LOSS-class sidecar is **never a silent delete**
 * (PLAN D4). When a legacy citekey can't be resolved to a live entry's uid —
 * because the entry was renamed/removed *before* the upgrade, or the `.bib`
 * isn't loaded yet — the annotation is bucketed under `orphanByKey` (or the
 * review row keeps its bare `bibKey` with no `entryUid`), recoverable later,
 * not lost. The migration is additive + idempotent: re-running it over an
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
 * Migrate a legacy citekey-keyed annotations record to the uid-keyed v2 shape.
 * Each citekey that resolves to a uid moves to `byUid[uid]`; the rest land in
 * `orphanByKey` (NEVER dropped). Idempotent: a v2 input that still has
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
      const uid = keyToUid.get(key);
      if (uid) {
        if (!(uid in byUid)) byUid[uid] = html;
        rehomed = true;
      } else {
        orphanByKey[key] = html;
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
    const uid = keyToUid.get(key);
    if (uid) byUid[uid] = html;
    else orphanByKey[key] = html; // recoverable, never dropped
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
