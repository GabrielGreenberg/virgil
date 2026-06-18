/**
 * T1 Stage 4 / D3 — export-via-serializer (BIB-F7-01, DATA-LOSS).
 *
 * The "Export cited.bib" action used to do `entries.map(e => e.raw)
 * .filter(Boolean)`, which SILENTLY DROPS any entry whose `raw` is empty — the
 * exact case for an entry assembled in memory ("Save under new citekey", a
 * library add, `/editor/find-citation`) that never round-tripped through a
 * parse. `serializeBibForExport` reconstructs EVERY entry through the
 * serializer so no cited reference can vanish on the way out.
 */

import { describe, it, expect } from "vitest";
import { serializeBibForExport } from "../bib-parser";
import type { BibEntry } from "../types";

const withRaw: BibEntry = {
  uid: "aaaa",
  key: "smith2020",
  type: "article",
  fields: { author: "Smith, J.", title: "A Study", year: "2020" },
  raw: "@article{smith2020,\n  author = {Smith, J.},\n  title = {A Study},\n  year = {2020}\n}",
};

// The DATA-LOSS case: an entry assembled in memory has an EMPTY raw. The old
// `.filter(Boolean)` dropped it entirely.
const emptyRaw: BibEntry = {
  uid: "bbbb",
  key: "jones2021-2",
  type: "book",
  fields: { author: "Jones, K.", title: "On Things", year: "2021" },
  raw: "",
};

describe("serializeBibForExport", () => {
  it("includes an entry with empty raw (BIB-F7-01 — does not drop it)", () => {
    const out = serializeBibForExport([withRaw, emptyRaw]);
    // The empty-raw entry must appear, reconstructed from its fields.
    expect(out).toContain("@book{jones2021-2,");
    expect(out).toContain("author = {Jones, K.}");
    expect(out).toContain("title = {On Things}");
    // The raw-bearing entry keeps its byte-exact source block.
    expect(out).toContain("@article{smith2020,");
  });

  it("reconstructs the new citekey for an empty-raw 'save under new citekey' entry", () => {
    // The conflict strip mints `key: <orig>-2` + `raw: ""` so the serializer
    // rebuilds the block under the NEW key. The export must carry that key,
    // never the library's original key (which `raw` would have re-emitted).
    const out = serializeBibForExport([emptyRaw]);
    expect(out).toContain("@book{jones2021-2,");
    expect(out).not.toContain("@book{jones2021,"); // not the un-suffixed orig
  });

  it("OMITS the \\vbid durable-id marker (an external manager has no use for it)", () => {
    const out = serializeBibForExport([withRaw, emptyRaw]);
    expect(out).not.toContain("\\vbid");
  });

  it("emits a parseable block for every entry (no silent drop on a 3-entry set)", () => {
    const out = serializeBibForExport([withRaw, emptyRaw, { ...emptyRaw, uid: "cccc", key: "third2022" }]);
    const atCount = (out.match(/@\w+\{/g) || []).length;
    expect(atCount).toBe(3);
  });
});
