/**
 * THE ONE TRANSFER-PAYLOAD FILE DOOR (task 419).
 *
 * A `DataTransfer` — the object a PASTE and a DROP both hand you — exposes
 * its files through TWO views: `items` (each `DataTransferItem.getAsFile()`
 * MINTS a File) and `files` (its own `FileList`). For one pasted screenshot
 * both describe the SAME image. Whether the two hand you the SAME OBJECT is
 * a browser implementation detail nothing promises, and on Chrome 151 it is
 * false. So the only stable answer is the payload's own CONTENT, never its
 * identity.
 *
 * > **Two independently-materialized views of one payload are reconciled by
 * > CONTENT, within the SINGLE event, and both views are always read.**
 *
 * The two ways to get that wrong are mirror images, and the app shipped one
 * of each:
 *
 *  - **Read both, dedupe by IDENTITY** — `BugReportWindow.handlePaste` did
 *    `!files.includes(file)`, an `Array#includes` REFERENCE test across the
 *    two lists. That is the reported bug: one Cmd-V of one screenshot added
 *    TWO thumbnails. The comment above its second loop asserted the views can
 *    be DISJOINT (the Finder-"Copy" case); the code then treated them as if
 *    they could also be IDENTICAL, and hedged the contradiction with a test
 *    that cannot decide it.
 *  - **Read only ONE view** — `LibraryView`'s file drop read `files` alone,
 *    so on any payload shaped the way that same comment believes possible it
 *    would ingest NOTHING, silently. Latent rather than reported, and the
 *    same fork one carrier over.
 *
 * Three properties are the whole point:
 *
 *  1. CONTENT, NOT IDENTITY — correct whichever way the browser materializes
 *     the two views.
 *  2. BOTH VIEWS ARE ALWAYS READ — a payload that fills only one is still
 *     served, which is the reason the second loop was written in the first
 *     place. The fix keeps its intent and drops its broken guard.
 *  3. PER-EVENT SCOPE — the reconciliation tally is created INSIDE the call
 *     and never escapes. Deduping across the session would silently swallow a
 *     user deliberately pasting the same screenshot twice — a paste that
 *     visibly does nothing, which is a WORSE bug than the one being fixed.
 *
 * Reconciliation is ACROSS views, never WITHIN one (task 1321). Each `items`
 * file "uses up" one `files` entry with the same content key; a `files` entry
 * left unmatched is kept. So two genuinely identical files inside ONE view (a
 * drop carrying two same-name, same-size files from different folders) both
 * survive — only the second view's echo of the first is dropped.
 *
 * The key is `name|size|type` and deliberately NOT `lastModified`. In Blink,
 * `lastModified` is stamped per MINT, not per payload: `DataObjectItem::
 * GetAsFile()` builds a fresh File on every call (re-reading the system
 * clipboard, stamped `base::Time::Now()`), while `DataTransfer::files()`
 * returns a FileList cached when the event was BUILT. So one pasted
 * screenshot reaches the handler with two different `lastModified`s, and a
 * key that carries the field splits one image into two thumbnails — task
 * 419's bug, one field too strict. Within one event there is one payload, so
 * a field that varies by view is noise, not identity. (`size` still keeps two
 * different `"image.png"`s apart, should a payload ever carry two.)
 *
 * Import-free leaf, deliberately (the placement rule `latex-markers.ts` /
 * `node-attr-sets.ts` earned): a facet the layer that needs it cannot import
 * will be re-copied. That is also why the door is stated over the PAYLOAD and
 * not over the clipboard — the law is about two views of one transfer, and a
 * drop is the same object. The natural next feature (dropping a PNG onto the
 * bug-report window) consumes this door rather than arriving as a third
 * extraction with the same choice to get wrong.
 *
 * CI: [transfer-files.test.ts](__tests__/transfer-files.test.ts) — the door's
 * own contract plus the CENSUS that keeps it the only extraction site
 * (allowlist EMPTY; a hit is ROUTE-it).
 */

/** A `DataTransfer`-shaped payload. Both views are optional because a test
 *  fixture — and, per the belief the second loop encoded, possibly a real
 *  paste path — may present only one, and a door whose job is to read both
 *  must not throw on the half that is absent. */
export interface TransferFileSource {
  readonly items?: ArrayLike<{ kind: string; type: string; getAsFile(): File | null }> | null;
  readonly files?: ArrayLike<File> | null;
}

/** `name|size|type` — everything about the payload the platform hands us
 *  that does not depend on WHICH view minted the File. `lastModified` is
 *  per-mint in Blink (see the header), so it is excluded. */
function contentKey(file: File): string {
  return `${file.name}|${file.size}|${file.type}`;
}

/**
 * Every file this transfer payload carries, each exactly once, in the order
 * the payload presents them (`items` first, then any `files` entry the first
 * view did not already describe — matched one-for-one, so same-view
 * duplicates survive).
 *
 * `accept` filters by the file's own type; omit it to take everything (a
 * library ingest takes PDF / DOCX / .tex / .bib alike). It is consulted on the
 * `items` view BEFORE `getAsFile()` as well as on the File itself, so a
 * payload's non-file items are never materialized.
 */
export function filesFromTransfer(
  dt: TransferFileSource | null | undefined,
  accept?: (type: string) => boolean,
): File[] {
  if (!dt) return [];
  const ok = (type: string | undefined): boolean => (accept ? accept(type ?? "") : true);
  const out: File[] = [];
  // Per-event scope — see property 3 above. Never hoist this. A MULTISET:
  // how many `items` files of each content key the `files` view may still
  // echo without adding anything.
  const unmatched = new Map<string, number>();

  for (const item of Array.from(dt.items ?? [])) {
    if (!item || item.kind !== "file" || !ok(item.type)) continue;
    const file = item.getAsFile();
    if (!file || !ok(file.type)) continue;
    const key = contentKey(file);
    unmatched.set(key, (unmatched.get(key) ?? 0) + 1);
    out.push(file);
  }
  for (const file of Array.from(dt.files ?? [])) {
    if (!file || !ok(file.type)) continue;
    const key = contentKey(file);
    const left = unmatched.get(key) ?? 0;
    if (left > 0) {
      unmatched.set(key, left - 1);
      continue;
    }
    out.push(file);
  }

  return out;
}

const isImage = (type: string): boolean => type.startsWith("image/");

/** The image-typed reader — the bug-report window's paste. */
export function imagesFromClipboard(dt: TransferFileSource | null | undefined): File[] {
  return filesFromTransfer(dt, isImage);
}
