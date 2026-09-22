/**
 * `reinstateCard` — put a card set aside by `/editor/archive-card` back in its
 * panel (task 712): the app-side twin of `apply_response.py cmd_restore`,
 * shared by every panel hook `cmd_archive` admits (notes / todos / cutter /
 * revisions / reports). Reached only through `useArchive.restoreSnippet`'s
 * origin route (see `src/lib/archive-origin.ts`).
 *
 * The verbatim `originalCard` goes through the panel's OWN load migrator, so a
 * restore is exactly a load of that record: normalized the same way, legacy
 * shapes upgraded the same way, unknown keys carried the same way. A record
 * the migrator rejects, or an id the panel already holds (a double restore, or
 * a card re-created since), refuses — the snippet then stays in the Archive.
 * The card's `links` come back with it, so its anchors re-register through the
 * panel's ordinary Mode-A reconcile.
 */
export function reinstateCard<S, C extends { id: string }>(
  current: S,
  update: (fn: (prev: S) => S) => void,
  list: (s: S) => C[],
  withList: (s: S, next: C[]) => S,
  migrate: (raw: unknown) => C | null,
  raw: unknown,
): boolean {
  const card = migrate(raw);
  if (!card || !card.id) return false;
  if (list(current).some((c) => c.id === card.id)) return false;
  update((prev) =>
    list(prev).some((c) => c.id === card.id)
      ? prev
      : withList(prev, [...list(prev), card]),
  );
  return true;
}
