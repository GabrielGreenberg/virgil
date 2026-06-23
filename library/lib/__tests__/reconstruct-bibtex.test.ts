import { describe, expect, it } from "vitest";

import {
  reconstructBibtex,
  withSynthesizedRaw,
} from "../reconstruct-bibtex";
import type { BibEntry } from "../types";

const slim: BibEntry = {
  key: "genette1997",
  type: "book",
  fields: { author: "Gérard Genette", title: "Paratexts", year: "1997" },
  raw: "", // slim browse projection — the bug condition
};

describe("reconstructBibtex", () => {
  it("emits a parseable block from type + key + fields", () => {
    const out = reconstructBibtex(slim);
    expect(out).toContain("@book{genette1997,");
    expect(out).toContain("author = {Gérard Genette}");
    expect(out).toContain("title = {Paratexts}");
    expect(out).toContain("year = {1997}");
  });

  it("drops empty / whitespace-only field values", () => {
    const out = reconstructBibtex({
      key: "k",
      type: "misc",
      fields: { title: "T", note: "", doi: "   " },
      raw: "",
    });
    expect(out).toContain("title = {T}");
    expect(out).not.toContain("note =");
    expect(out).not.toContain("doi =");
  });
});

describe("withSynthesizedRaw — never let an empty raw block edit (FIX #6)", () => {
  it("synthesizes raw for a slim entry whose raw is empty", () => {
    const out = withSynthesizedRaw(slim);
    expect(out).not.toBeNull();
    expect(out!.raw.trim().length).toBeGreaterThan(0);
    expect(out!.raw).toContain("@book{genette1997,");
    // The rest of the entry is preserved.
    expect(out!.fields.title).toBe("Paratexts");
  });

  it("passes a real full entry through UNTOUCHED (full fetch is the preferred source)", () => {
    const full: BibEntry = { ...slim, raw: "@book{genette1997, title={Real}}" };
    const out = withSynthesizedRaw(full);
    expect(out).toBe(full); // same reference — no clone, no re-synthesis
  });

  it("returns null/undefined inputs unchanged", () => {
    expect(withSynthesizedRaw(null)).toBeNull();
    expect(withSynthesizedRaw(undefined)).toBeUndefined();
  });

  it("leaves an entry with no key/type alone (nothing to synthesize from)", () => {
    const broken = { key: "", type: "", fields: { title: "T" }, raw: "" } as BibEntry;
    const out = withSynthesizedRaw(broken);
    expect(out.raw).toBe(""); // can't build a block → unchanged
  });
});
