// T6-C16 (the CI-F5 family): `derivePlural` is the TWO-WAY singular↔plural
// biblatex command toggle. The predecessor logic only PROMOTED singular→plural
// on distinct postnotes and never DEMOTED, so a card stranded as `\cites` with
// one key (CI-F5-01 / CI-F7-02), and a package switch never re-derived the
// command at all (CI-F5-02). `derivePlural` makes the command a pure function
// of the current rows + package, so promote and demote are symmetric.

import { describe, it, expect } from "vitest";
import {
  derivePlural,
  singularBaseOf,
  hasPluralForm,
  serializeCiteCommand,
} from "../bib-parser";

const r = (key: string, postnote?: string) => ({ key, postnote });

describe("derivePlural — promote (singular → plural)", () => {
  it("promotes `cite` → `cites` when ≥2 keys have DISTINCT postnotes (biblatex)", () => {
    expect(
      derivePlural("cite", [r("a", "p. 1"), r("b", "p. 2")], "biblatex"),
    ).toBe("cites");
  });

  it("promotes the base even if the user passed the singular for any plural-bearing command", () => {
    for (const base of ["cite", "textcite", "parencite", "autocite", "footcite", "smartcite"]) {
      expect(
        derivePlural(base, [r("a", "x"), r("b", "y")], "biblatex"),
      ).toBe(`${base}s`);
    }
  });

  it("does NOT promote when ≥2 keys share the SAME (or empty) postnote", () => {
    // Same non-empty postnote on both → plural buys nothing.
    expect(derivePlural("cite", [r("a", "p. 1"), r("b", "p. 1")], "biblatex")).toBe("cite");
    // Both empty → the common multi-key case, stays singular (comma-separated).
    expect(derivePlural("cite", [r("a"), r("b")], "biblatex")).toBe("cite");
  });
});

describe("derivePlural — demote (plural → singular)", () => {
  it("demotes `cites` → `cite` when the rows drop back to ONE key (CI-F5-01)", () => {
    expect(derivePlural("cites", [r("a", "p. 1")], "biblatex")).toBe("cite");
  });

  it("demotes `cites` → `cite` when ≥2 keys lose their distinct postnotes (CI-F7-02)", () => {
    // Two keys but postnotes equalized → no longer needs the plural form.
    expect(derivePlural("cites", [r("a", "p. 1"), r("b", "p. 1")], "biblatex")).toBe("cite");
    expect(derivePlural("cites", [r("a"), r("b")], "biblatex")).toBe("cite");
  });

  it("ignores empty draft rows when counting keys (a stray blank row can't keep it plural)", () => {
    // One real key + a blank draft row → one keyed row → singular.
    expect(derivePlural("cites", [r("a", "p. 1"), r("", "")], "biblatex")).toBe("cite");
  });

  it("demotes every plural-bearing command symmetrically", () => {
    for (const plural of ["cites", "textcites", "parencites", "autocites", "footcites", "smartcites"]) {
      expect(derivePlural(plural, [r("a", "p")], "biblatex")).toBe(singularBaseOf(plural));
    }
  });
});

describe("derivePlural — package toggle (CI-F5-02)", () => {
  it("a switch to natbib demotes a stranded `\\cites` to a package-valid `\\cite`", () => {
    expect(derivePlural("cites", [r("a", "p. 1"), r("b", "p. 2")], "natbib")).toBe("cite");
  });

  it("a switch to biblatex re-promotes a multi-key/distinct-postnote command", () => {
    // Under natbib the command was singular `cite`; switching to biblatex with
    // distinct postnotes promotes.
    expect(derivePlural("cite", [r("a", "p. 1"), r("b", "p. 2")], "biblatex")).toBe("cites");
  });

  it("natbib never promotes (no biblatex `\\cites` form)", () => {
    expect(derivePlural("cite", [r("a", "p. 1"), r("b", "p. 2")], "natbib")).toBe("cite");
  });
});

describe("derivePlural — commands with no plural sibling are untouched", () => {
  it("leaves `\\citeauthor` / `\\nocite` / natbib `\\citep` alone (no `\\xxxs` form)", () => {
    expect(derivePlural("citeauthor", [r("a", "p. 1"), r("b", "p. 2")], "biblatex")).toBe("citeauthor");
    expect(derivePlural("nocite", [r("a", "p. 1"), r("b", "p. 2")], "biblatex")).toBe("nocite");
    expect(derivePlural("citep", [r("a", "p. 1"), r("b", "p. 2")], "biblatex")).toBe("citep");
  });

  it("hasPluralForm reflects the sibling map", () => {
    expect(hasPluralForm("cite")).toBe(true);
    expect(hasPluralForm("cites")).toBe(true); // recovered via singular base
    expect(hasPluralForm("citeauthor")).toBe(false);
    expect(hasPluralForm("citep")).toBe(false);
  });
});

describe("derivePlural — idempotent + symmetric (fixpoint)", () => {
  it("feeding the result back in is a fixpoint", () => {
    const rows = [r("a", "p. 1"), r("b", "p. 2")];
    const once = derivePlural("cite", rows, "biblatex"); // → cites
    expect(once).toBe("cites");
    expect(derivePlural(once, rows, "biblatex")).toBe("cites");

    const single = [r("a", "p. 1")];
    const demoted = derivePlural("cites", single, "biblatex"); // → cite
    expect(demoted).toBe("cite");
    expect(derivePlural(demoted, single, "biblatex")).toBe("cite");
  });

  it("the derived type makes the serializer emit the matching command word", () => {
    // The stranded-`\cites`-with-one-key bug, end to end: demote then serialize.
    const single = [r("a", "p. 1")];
    const t = derivePlural("cites", single, "biblatex");
    const cmd = serializeCiteCommand(
      { type: t, starred: false, capitalized: false, noteScope: "per-key", entries: single },
      "biblatex",
    );
    expect(cmd).toBe("\\cite[p. 1]{a}");

    // Promote then serialize: the plural form carries per-key postnotes.
    const multi = [r("a", "p. 1"), r("b", "p. 2")];
    const tp = derivePlural("cite", multi, "biblatex");
    const cmdp = serializeCiteCommand(
      { type: tp, starred: false, capitalized: false, noteScope: "per-key", entries: multi },
      "biblatex",
    );
    expect(cmdp).toBe("\\cites[p. 1]{a}[p. 2]{b}");
  });
});
