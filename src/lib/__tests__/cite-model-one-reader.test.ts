// Task 1141 — the citation MODEL reads `\cite` arguments through THE reader the
// scanner reads them with (`readCiteUnitsAt` / `splitCiteKeys` in
// `cite-commands.ts`), so a source the scanner builds an atom from is a source
// the model can read. Before 1141 the model's private `\[([^\]]*)\]` /
// `\{([^}]+)\}` regexes disagreed with the comment- and brace-aware scanner.
import { describe, expect, it } from "vitest";
import {
  parseCiteCommand,
  resolveCiteNoteRows,
  serializeCiteCommand,
  type CiteSerializeInput,
} from "@/lib/cite-command-model";
import { matchCiteCommandAt, splitCiteKeys } from "@/lib/cite-commands";

const roundTrip = (s: string, pkg: string) => {
  const p = parseCiteCommand(s);
  expect(p).not.toBeNull();
  return serializeCiteCommand(p as CiteSerializeInput, pkg);
};

describe("task 1141 — one reader of cite-argument syntax", () => {
  it.each([
    ["\\citep[p.~3 {[}n.~2{]}]{k}", "natbib", "p.~3 {[}n.~2{]}"],
    ["\\parencite[{[}sic{]}]{k}", "biblatex", "{[}sic{]}"],
    ["\\cite[see {a]b}]{k}", "natbib", "see {a]b}"],
  ])("member 1: a braced `]` in a note — %s parses and round-trips", (src, pkg, note) => {
    const p = parseCiteCommand(src)!;
    expect(p).not.toBeNull();
    expect(p.keys).toEqual(["k"]);
    expect(p.noteScope === "whole" && p.postnote).toBe(note);
    expect(roundTrip(src, pkg)).toBe(src);
  });

  it("member 2: a `%` comment in a key list is not part of a key", () => {
    expect(parseCiteCommand("\\citep{a,% x\n b}")!.keys).toEqual(["a", "b"]);
    expect(parseCiteCommand("\\citep{a,%\n   b}")!.keys).toEqual(["a", "b"]);
    // A `}` inside the comment does not close the group.
    expect(parseCiteCommand("\\citep{a,% old}\n b}")!.keys).toEqual(["a", "b"]);
    // Documented normalization: the comment is not re-emitted; no key is lost.
    expect(roundTrip("\\citep{a,% x\n b}", "natbib")).toBe("\\citep{a,b}");
  });

  it("member 3: a plural group's comma list is split, and re-joined on serialize", () => {
    const src = "\\cites[p. 1]{a,b}[p. 2]{c}";
    const p = parseCiteCommand(src)!;
    expect(p.keys).toEqual(["a", "b", "c"]);
    // The group's postnote renders after its LAST key — never mirrored onto `a`.
    expect(resolveCiteNoteRows(p).map((r) => [r.key, r.postnote])).toEqual([
      ["a", undefined],
      ["b", "p. 1"],
      ["c", "p. 2"],
    ]);
    expect(roundTrip(src, "biblatex")).toBe(src);
    expect(roundTrip("\\cites[see][p. 1]{a,b,c}{d}", "biblatex")).toBe(
      "\\cites[see][p. 1]{a,b,c}{d}",
    );
  });

  it("member 3: rows built without a group serialize one unit per key", () => {
    expect(
      serializeCiteCommand(
        {
          type: "cites",
          starred: false,
          capitalized: false,
          noteScope: "per-key",
          entries: [{ key: "a" }, { key: "b", postnote: "p. 1" }],
        },
        "biblatex",
      ),
    ).toBe("\\cites{a}[p. 1]{b}");
  });

  it("member 4: `\\citetext` text is one opaque entry, kept byte-for-byte", () => {
    expect(parseCiteCommand("\\citetext{see also, e.g.}")!.keys).toEqual(["see also, e.g."]);
    expect(roundTrip("\\citetext{see also, e.g.}", "natbib")).toBe("\\citetext{see also, e.g.}");
    const nested = "\\citetext{\\citealp{a}, p. 3}";
    expect(parseCiteCommand(nested)).not.toBeNull();
    expect(roundTrip(nested, "natbib")).toBe(nested);
  });

  it("whatever the scanner accepts as a keyed command, the model can read", () => {
    for (const src of [
      "\\citep[p.~3 {[}n.~2{]}]{k}",
      "\\citep{a,% x}\n b}",
      "\\cites[p. 1]{a,b}[p. 2]{c}",
      "\\citetext{\\citealp{a}, p. 3}",
      "\\footcites[p1][q1]{alpha}[p2][q2]{jones_21}",
    ]) {
      const m = matchCiteCommandAt(src, 0)!;
      expect(m.keyed).toBe(true);
      expect(m.end).toBe(src.length);
      expect(parseCiteCommand(m.command)).not.toBeNull();
    }
  });

  it("unchanged edges: key-less and bare commands", () => {
    expect(parseCiteCommand("\\cite{}")!.keys).toEqual([]);
    expect(parseCiteCommand("\\cite{ }")!.keys).toEqual([]);
    expect(parseCiteCommand("\\cite")).toBeNull();
    expect(parseCiteCommand("\\citep{a}x")).toBeNull();
    expect(parseCiteCommand("\\citep{a,,b}")!.keys).toEqual(["a", "b"]);
  });

  it("splitCiteKeys keeps an escaped `\\%` and joins a continuation", () => {
    expect(splitCiteKeys("a\\%b, c")).toEqual(["a\\%b", "c"]);
    expect(splitCiteKeys("ab%\n  cd")).toEqual(["abcd"]);
  });
});
