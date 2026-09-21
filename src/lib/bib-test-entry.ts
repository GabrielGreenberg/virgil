/**
 * Test helper: name a bib entry the way production does (task 690).
 *
 * The bib mutators take the ENTRY rather than its citekey, because a citekey
 * names as many `.bib` blocks as carry it. A test that used to say
 * `updateBibEntry("foo", …)` says `updateBibEntry(named(entries, "foo"), …)`.
 *
 * When no entry carries the key, this returns a STAND-IN carrying just that
 * key — so a test that deliberately addresses an absent entry still exercises
 * the production "address resolves to nothing → no write" path rather than
 * failing at the call.
 */

import type { BibEntry } from "@/lib/types";

export function namedBibEntry(entries: BibEntry[], key: string): BibEntry {
  return (
    entries.find((e) => e.key === key) ?? { uid: "", key, type: "article", fields: {}, raw: "" }
  );
}
