/**
 * T1 Stage 0 — durable `BibEntry.uid` plumbing.
 *
 * Pins the surrogate-id round-trip: mint-on-missing, `\vbid{}` survives a
 * parse→serialize→parse cycle, and two `.bib` blocks that share a citekey get
 * two DISTINCT uids (the dup-citekey collapse that strands the second entry).
 * uid is not yet consumed by any UI — this is pure plumbing.
 */

import { describe, it, expect } from "vitest";
import { parseBibFile, serializeBibFile } from "../bib-parser";
import {
  mintBibUid,
  serializeVbidMarker,
  parseVbidMarkers,
  orderedVbidBindings,
  VBID_RE,
} from "../bib-uid";

const HEX4 = /^[0-9a-f]{4}$/;

describe("bib-uid: marker helpers", () => {
  it("mintBibUid produces a 4-char hex short id", () => {
    expect(mintBibUid()).toMatch(HEX4);
  });

  it("mintBibUid avoids ids in the collision set", () => {
    const used = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = mintBibUid(used);
      expect(used.has(id)).toBe(false);
      used.add(id);
    }
    expect(used.size).toBe(200);
  });

  it("serializeVbidMarker emits a bare \\vbid{uid} marker that VBID_RE parses back", () => {
    const marker = serializeVbidMarker("a1b2");
    expect(marker).toBe("\\vbid{a1b2}");
    expect(marker.match(VBID_RE)?.[1]).toBe("a1b2");
  });
});

describe("bib-uid: marker → entry binding", () => {
  const text = `\\vbid{1111}
@book{foo, author={X}, title={T}, year={2000}}

\\vbid{2222}
@article{bar, author={Y}, title={U}, year={2001}}`;

  it("parseVbidMarkers maps each citekey to its preceding marker uid", () => {
    const map = parseVbidMarkers(text);
    expect(map.get("foo")).toBe("1111");
    expect(map.get("bar")).toBe("2222");
  });

  it("orderedVbidBindings binds markers positionally, in source order", () => {
    const bindings = orderedVbidBindings(text);
    expect(bindings.map((b) => [b.citekey, b.uid])).toEqual([
      ["foo", "1111"],
      ["bar", "2222"],
    ]);
    // entryStart is the `@` offset of the bound block.
    expect(text[bindings[0].entryStart]).toBe("@");
  });

  it("a dangling trailing marker (no following entry) is ignored", () => {
    const bindings = orderedVbidBindings(
      `\\vbid{1111}\n@book{foo, title={T}}\n\n\\vbid{9999}\n`,
    );
    expect(bindings).toEqual([
      expect.objectContaining({ citekey: "foo", uid: "1111" }),
    ]);
  });

  it("two markers preceding two same-citekey blocks bind to distinct entries", () => {
    const dup = `\\vbid{aaaa}
@article{dup, author={Alice}, title={First}, year={2000}}

\\vbid{bbbb}
@article{dup, author={Bob}, title={Second}, year={2001}}`;
    const bindings = orderedVbidBindings(dup);
    expect(bindings).toHaveLength(2);
    expect(bindings[0].uid).toBe("aaaa");
    expect(bindings[1].uid).toBe("bbbb");
    expect(bindings[0].entryStart).not.toBe(bindings[1].entryStart);
  });
});

describe("bib-uid: parseBibFile mints durable uids", () => {
  it("mints a uid for every entry of a markerless .bib", () => {
    const entries = parseBibFile(
      `@book{foo, author={X}, title={T}, year={2000}}\n\n@article{bar, author={Y}, title={U}, year={2001}}`,
    );
    expect(entries).toHaveLength(2);
    for (const e of entries) expect(e.uid).toMatch(HEX4);
    // Distinct uids per entry.
    expect(entries[0].uid).not.toBe(entries[1].uid);
  });

  it("recovers the uid from an existing \\vbid marker rather than minting", () => {
    const entries = parseBibFile(
      `\\vbid{c0de}\n@book{foo, author={X}, title={T}, year={2000}}`,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].uid).toBe("c0de");
    expect(entries[0].key).toBe("foo");
  });
});

describe("bib-uid: two same-citekey entries get two distinct uids", () => {
  it("parses both blocks (no Record-by-citekey collapse) with distinct uids and distinct raw", () => {
    const dup = `@article{dup, author={Alice}, title={First}, year={2000}}\n\n@article{dup, author={Bob}, title={Second}, year={2001}}`;
    const entries = parseBibFile(dup);
    expect(entries).toHaveLength(2);
    expect(entries[0].key).toBe("dup");
    expect(entries[1].key).toBe("dup");
    // The keystone: distinct durable identity per block.
    expect(entries[0].uid).not.toBe(entries[1].uid);
    // And each keeps its OWN raw block (not the last-write-wins collapse).
    expect(entries[0].raw).toContain("First");
    expect(entries[1].raw).toContain("Second");
    expect(entries[0].raw).not.toBe(entries[1].raw);
  });
});

describe("bib-uid: \\vbid round-trips through serialize→parse", () => {
  it("serializeBibFile emits a \\vbid marker per entry", () => {
    const entries = parseBibFile(
      `@book{foo, author={X}, title={T}, year={2000}}`,
    );
    const out = serializeBibFile(entries);
    expect(out).toContain(serializeVbidMarker(entries[0].uid));
    // Marker precedes the entry block.
    expect(out.indexOf("\\vbid{")).toBeLessThan(out.indexOf("@book"));
  });

  it("the uid survives a full parse → serialize → parse cycle", () => {
    const original = `@book{foo, author={X}, title={T}, year={2000}}\n\n@article{bar, author={Y}, title={U}, year={2001}}`;
    const first = parseBibFile(original);
    const reserialized = serializeBibFile(first);
    const second = parseBibFile(reserialized);
    expect(second.map((e) => e.uid)).toEqual(first.map((e) => e.uid));
    expect(second.map((e) => e.key)).toEqual(first.map((e) => e.key));
  });

  it("re-serializing does NOT double-emit the \\vbid marker (marker stays out of raw)", () => {
    const first = parseBibFile(`@book{foo, author={X}, title={T}, year={2000}}`);
    const out1 = serializeBibFile(first);
    const second = parseBibFile(out1);
    const out2 = serializeBibFile(second);
    // Exactly one marker each cycle — stable, no accumulation.
    expect((out1.match(/\\vbid\{/g) || []).length).toBe(1);
    expect((out2.match(/\\vbid\{/g) || []).length).toBe(1);
    expect(second[0].raw).not.toContain("\\vbid");
  });

  it("a same-citekey pair keeps both distinct uids across the round-trip", () => {
    const dup = `@article{dup, author={Alice}, title={First}, year={2000}}\n\n@article{dup, author={Bob}, title={Second}, year={2001}}`;
    const first = parseBibFile(dup);
    const second = parseBibFile(serializeBibFile(first));
    expect(second).toHaveLength(2);
    expect(second[0].uid).toBe(first[0].uid);
    expect(second[1].uid).toBe(first[1].uid);
    expect(second[0].uid).not.toBe(second[1].uid);
  });
});
