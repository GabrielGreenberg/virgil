/**
 * `carryUnknownKeys` — a LOADER is not a transform (task 712).
 *
 * Every card-sidecar migrator (`migrateNote`, `migrateTodo`, `migrateSnippet`,
 * `migrateReportRecord`, the cutter/revisions records, `migrateOrphans`)
 * rebuilds each record as a hand-enumerated literal. That is right for the
 * fields the migrator OWNS — it normalizes them, heals them, upgrades legacy
 * shapes — and wrong for every field it has never heard of, because a sidecar
 * is not the app's private file. Agents write it too (`apply_response.py`),
 * and they extend records the app does not model: `/editor/archive-card` puts
 * `originalPanel` / `originalCard` / `archivedAt` on an archive snippet so
 * `/editor/restore-card` can put the card back. A field-by-field rebuild
 * dropped those keys, `persistMigrationOnLoad` wrote the narrowed record back
 * on the very next open, and the origin was gone for good — "the envelope-drop
 * class" (task 076 patched ONE such field, `originalAnchor`, by name; this is
 * the rule that makes naming them unnecessary).
 *
 * So a load starts from the raw record and lays the migrator's output over it:
 * keys the migrator produced WIN (normalization still happens), keys it never
 * mentions SURVIVE. The one exception is a key the migrator CONSUMED — a
 * legacy field it read and converted (a pre-D8 `paragraphIds` becomes `links`)
 * or a present-only field it deliberately dropped because the value was
 * malformed. Carrying a consumed key back would resurrect what the migration
 * retired (an emptied `links` would re-derive from a stale `paragraphIds` on
 * the next load), so each migrator names its consumed keys, and the legacy
 * link keys every card consumes are named once, here.
 *
 * Contrast `carryCardEnvelope` (cards/envelope.ts): a MORPH or CLONE changes
 * the record's shape, so it carries a targeted allowlist and must NOT spread
 * the source. A load changes nothing about what the record IS, so the unknown
 * remainder belongs to whoever wrote it. `sidecar-migrator-unknown-keys.test.ts`
 * round-trips an unknown key through every card-sidecar migrator.
 */

/** The legacy anchor fields `migrateCardLinks` reads and converts into
 *  `links` — consumed by every card migrator that calls it. */
export const LEGACY_LINK_KEYS = ["paragraphIds", "anchorId", "anchorText"] as const;

export function carryUnknownKeys<T extends object>(
  raw: unknown,
  migrated: T,
  consumed: readonly string[] = [],
): T {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return migrated;
  const owned = migrated as Record<string, unknown>;
  let carried: Record<string, unknown> | null = null;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key in owned) continue;
    if (value === undefined) continue;
    if (consumed.includes(key)) continue;
    if ((LEGACY_LINK_KEYS as readonly string[]).includes(key)) continue;
    (carried ??= {})[key] = value;
  }
  return carried ? ({ ...carried, ...owned } as T) : migrated;
}
