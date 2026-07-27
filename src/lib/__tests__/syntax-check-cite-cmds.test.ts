import { describe, it, expect } from "vitest";
import { runSyntaxChecks } from "../syntax-check";
import { KNOWN_CITE_COMMANDS, MULTI_CITE_NAMES } from "../cite-commands";

/**
 * The undefined-citation diagnostic gates key extraction on `CITE_CMDS`, which
 * must stay derived from the shared `KNOWN_CITE_COMMANDS` registry (task 246).
 * Before the fix, `CITE_CMDS` was a hand-maintained list that had drifted from
 * the registry — biblatex single-key commands like `\autocite`/`\smartcite`/
 * `\citetitle`/`\citeurl` were omitted, so bad citekeys inside them were
 * silently unflagged.
 */
describe("runSyntaxChecks — undefined-citation over biblatex cite commands", () => {
  const knownBibKeys = new Set(["goodkey"]);

  const citeUndefinedFor = (text: string) =>
    runSyntaxChecks(text, { knownBibKeys }).filter((e) =>
      e.ruleId?.endsWith("-undefined"),
    );

  it("flags `\\autocite{missingkey}` (regressed on main: autocite was omitted)", () => {
    const errs = citeUndefinedFor("\\autocite{missingkey}");
    expect(errs).toHaveLength(1);
    expect(errs[0].ruleId).toBe("autocite-undefined");
    expect(errs[0].message).toContain("not in bibliography");
  });

  it("still flags `\\cite{missingkey}` (regression guard)", () => {
    const errs = citeUndefinedFor("\\cite{missingkey}");
    expect(errs).toHaveLength(1);
    expect(errs[0].ruleId).toBe("cite-undefined");
  });

  it("does NOT flag `\\autocite{goodkey}` (key is in the .bib)", () => {
    expect(citeUndefinedFor("\\autocite{goodkey}")).toHaveLength(0);
  });

  it("flags the other newly-recognized biblatex single-key forms + caps variants", () => {
    for (const cmd of [
      "smartcite",
      "Smartcite",
      "citeyearpar",
      "citetitle",
      "citedate",
      "citeurl",
      "Autocite",
    ]) {
      const errs = citeUndefinedFor(`\\${cmd}{missingkey}`);
      expect(errs, cmd).toHaveLength(1);
      expect(errs[0].ruleId, cmd).toBe(`${cmd}-undefined`);
    }
  });

  it("recognizes every single-key command in the registry (SSOT parity)", () => {
    for (const base of KNOWN_CITE_COMMANDS) {
      // nocite is informational (not validated); multi-cite forms have a
      // different arg shape and are intentionally excluded.
      if (base === "nocite" || MULTI_CITE_NAMES.has(base)) continue;
      const errs = citeUndefinedFor(`\\${base}{missingkey}`);
      expect(errs, base).toHaveLength(1);
      expect(errs[0].ruleId, base).toBe(`${base}-undefined`);
    }
  });

  it("does NOT record `\\nocite{missingkey}` (informational only)", () => {
    expect(citeUndefinedFor("\\nocite{missingkey}")).toHaveLength(0);
    // `\nocite{*}` must never flag either.
    expect(citeUndefinedFor("\\nocite{*}")).toHaveLength(0);
  });
});
