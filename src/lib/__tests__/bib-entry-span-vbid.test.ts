/**
 * WHICH ENTRY DOES A `\vbid{uid}` MARKER NAME? — the app half of task 884.
 *
 * `orderedVbidBindings` used to find entry heads with a private regex that
 * missed a spaced key (`@article{ a ,`), so the marker above it bound to the
 * NEXT entry, and an annotation keyed by that uid was filed under the wrong
 * reference. It now reads the parser's own `scanBibSource` blocks. The skill
 * side (`editor/scripts/citekey_sidecars.vbid_uid_for`, run by
 * `editor/scripts/tests/test_bib_entry_span_parity.py`) answers the same `vbid`
 * rows of the shared corpus, so the two binders cannot drift silently.
 */
import { describe, expect, it } from "vitest";
import corpus from "./fixtures/bib-entry-span-corpus.json";
import { orderedVbidBindings, parseVbidMarkers } from "@/lib/bib-uid";
import { scanBibSource } from "@/lib/bib-source";

type VbidRow = { name: string; bib: string; expect: Record<string, string | null> };
const rows = (corpus as unknown as { vbid: VbidRow[] }).vbid;

describe("vbid binding corpus (task 884)", () => {
  it("has rows", () => {
    expect(rows.length).toBeGreaterThanOrEqual(5);
  });

  for (const row of rows) {
    it(`${row.name}: parseVbidMarkers binds as the skill side does`, () => {
      const map = parseVbidMarkers(row.bib);
      const got = Object.fromEntries(Object.keys(row.expect).map((k) => [k, map.get(k) ?? null]));
      expect(got).toEqual(row.expect);
    });

    it(`${row.name}: every binding names a parser block's start`, () => {
      const starts = new Set(scanBibSource(row.bib).map((b) => b.start));
      for (const b of orderedVbidBindings(row.bib)) expect(starts.has(b.entryStart)).toBe(true);
    });
  }
});
