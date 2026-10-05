/**
 * Task 949 — "Export cited.bib" exports the cited entries' DEPENDENCY CLOSURE.
 *
 * A cited entry may name a `@string` macro, a `crossref`/`xref`/`xdata` parent
 * nobody cited, or a command a `@preamble` defines. Exporting the entries alone
 * produced a file that compiled to empty journal names / booktitles. The closure
 * is computed over the raw `.bib` source by `serializeBibForExport(entries, source)`.
 */
import { describe, it, expect } from "vitest";
import { parseBibFile, serializeBibForExport } from "../bib-parser";
import { bibMacroReferences, bibStringName } from "../bib-source";
import type { BibEntry } from "../types";

const SOURCE = `% header
@preamble{"\\newcommand{\\noopsort}[1]{}"}

@string{jphil = {Journal of Philosophy}}
@string{unused = {Never Referenced}}
@string{ny = {New York}}
@string{pubaddr = ny # " (NY)"}
@string{vol = {Volume}}

@article{lewis1973,
  author = {Lewis, David},
  title = {Causation},
  journal = jphil,
  year = 1973
}

@incollection{kratzer1981,
  author = {Kratzer, Angelika},
  title = {The Notional Category of Modality},
  crossref = {eikmeyer1981},
  pages = {38--74}
}

@book{eikmeyer1981,
  editor = {Eikmeyer, H. and Rieser, H.},
  title = "Words, Worlds, and Contexts" # vol,
  crossref = {series1981},
  address = pubaddr
}

@book{series1981,
  title = {Research in Text Theory}
}

@article{xd2020,
  author = {X, Y},
  xdata = {gen-a, gen-b}
}

@xdata{gen-a, publisher = {A}}
@xdata{gen-b, publisher = {B}}
@xdata{gen-c, publisher = {C}}
`;

const entries = parseBibFile(SOURCE);
const byKey = (k: string) => entries.find((e) => e.key === k)!;
const pos = (out: string, needle: string) => out.indexOf(needle);

describe("bibMacroReferences / bibStringName", () => {
  it("reads bare macro terms, including those after a #, and skips numbers", () => {
    expect(bibMacroReferences(`@book{k, title = "A" # vol, year = 1999, address = ny}`).sort()).toEqual([
      "ny",
      "vol",
    ]);
    expect(bibMacroReferences(`@string{pubaddr = ny # " (NY)"}`)).toEqual(["ny"]);
    expect(bibStringName(`@string{JPhil = {J}}`)).toBe("jphil");
    expect(bibStringName(`@article{k, a = b}`)).toBeNull();
  });

  it("does not mistake a field NAME or a braced word for a macro", () => {
    expect(bibMacroReferences(`@article{k, journal = {jphil}, note = "ny"}`)).toEqual([]);
  });
});

describe("serializeBibForExport — the dependency closure (task 949)", () => {
  it("includes a referenced @string and excludes an unreferenced one", () => {
    const out = serializeBibForExport([byKey("lewis1973")], SOURCE);
    expect(out).toContain("@string{jphil = {Journal of Philosophy}}");
    expect(out).not.toContain("unused");
    expect(pos(out, "@string{jphil")).toBeLessThan(pos(out, "@article{lewis1973"));
  });

  it("always keeps @preamble", () => {
    const out = serializeBibForExport([byKey("lewis1973")], SOURCE);
    expect(out).toContain("@preamble{");
  });

  it("pulls in an uncited crossref parent (and its parent), placed after the child", () => {
    const out = serializeBibForExport([byKey("kratzer1981")], SOURCE);
    expect(out).toContain("@book{eikmeyer1981");
    expect(out).toContain("@book{series1981");
    expect(pos(out, "@incollection{kratzer1981")).toBeLessThan(pos(out, "@book{eikmeyer1981"));
    expect(pos(out, "@book{eikmeyer1981")).toBeLessThan(pos(out, "@book{series1981"));
    // The parent's macros come along: `#`-concatenated `vol`, chained `pubaddr` → `ny`.
    expect(out).toContain("@string{vol = {Volume}}");
    expect(out).toContain("@string{pubaddr");
    expect(out).toContain("@string{ny = {New York}}");
    expect(out).not.toContain("@string{jphil");
  });

  it("follows an xdata list", () => {
    const out = serializeBibForExport([byKey("xd2020")], SOURCE);
    expect(out).toContain("@xdata{gen-a");
    expect(out).toContain("@xdata{gen-b");
    expect(out).not.toContain("@xdata{gen-c");
  });

  it("does not duplicate a parent that is also cited, and moves it after its child", () => {
    // Caller order puts the parent FIRST (as an author-sort might).
    const out = serializeBibForExport([byKey("eikmeyer1981"), byKey("kratzer1981")], SOURCE);
    expect(out.split("@book{eikmeyer1981").length - 1).toBe(1);
    expect(pos(out, "@incollection{kratzer1981")).toBeLessThan(pos(out, "@book{eikmeyer1981"));
  });

  it("still reconstructs an empty-raw entry, and resolves its macros/parents", () => {
    const mem: BibEntry = {
      uid: "m1",
      key: "new2024",
      type: "incollection",
      fields: { title: "Fresh", crossref: "eikmeyer1981" },
      raw: "",
    };
    const out = serializeBibForExport([mem], SOURCE);
    expect(out).toContain("@incollection{new2024,");
    expect(out).toContain("@book{eikmeyer1981");
  });

  it("degrades to the entries alone without a source", () => {
    const out = serializeBibForExport([byKey("lewis1973")]);
    expect(out).toContain("@article{lewis1973");
    expect(out).not.toContain("@string");
  });
});
