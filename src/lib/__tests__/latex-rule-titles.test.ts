// Task 983: every rule id a producer emits titles from the ONE rule vocabulary
// (`latex-rules.ts`) — no error card reads as a de-hyphenated id ("Brace
// unmatched open", "Citep undefined", "No def"), and a new id that bypasses
// the vocabulary fails here.
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import {
  CITE_CMDS,
  LATEX_RULE,
  REF_CMDS,
  UNIFIED_LINT_RULE_TITLES,
  ruleTitle,
} from "@/lib/latex-rules";
import { runSyntaxChecks } from "@/lib/syntax-check";
import { runLint } from "@/lib/workers/latex-lint-core";
import { errorTitle } from "@/panels/Errors/ErrorCard";
import type { LatexError } from "@/lib/latex-errors";

// ErrorCard's import graph reaches the storage barrel, which resolves a
// build-time backend vitest cannot load.
vi.mock("@/lib/storage", () => ({}));

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

function err(ruleId: string | undefined, message = "Some message"): LatexError {
  return { id: "x", source: "lint", severity: "error", line: 1, message, ruleId };
}

describe("errorTitle — titles from the rule vocabulary (task 983)", () => {
  it.each([
    ["ref-undefined", "Missing reference"],
    ["eqref-undefined", "Missing reference"],
    ["Cref-undefined", "Missing reference"],
    ["cite-undefined", "Missing citation"],
    ["citep-undefined", "Missing citation"],
    ["Textcite-undefined", "Missing citation"],
    ["brace-unmatched-open", "Unbalanced braces"],
    ["brace-unmatched-close", "Unbalanced braces"],
    ["math-unmatched-display", "Unbalanced math"],
    ["env-unmatched-begin", "Unclosed environment"],
    ["tex-error", "TeX error"],
    ["latex-warning", "LaTeX warning"],
    ["compile-abort", "Compile stopped"],
    ["package-download-failed", "Package download failed"],
    ["no-def", "Macro defined with \\def"],
    ["no-tex-font-shaping-commands", "Old-style font command"],
  ])("%s → %s", (ruleId, title) => {
    expect(errorTitle(err(ruleId))).toBe(title);
  });

  it("an id outside the vocabulary titles from the message, never the id", () => {
    expect(errorTitle(err("some-new-rule", "First line\nsecond"))).toBe("First line");
    expect(errorTitle(err("bogus-undefined", "Bogus thing"))).toBe("Bogus thing");
  });
});

describe("rule vocabulary census (task 983)", () => {
  it("every fixed rule id has a title", () => {
    for (const id of Object.values(LATEX_RULE)) expect(ruleTitle(id), id).not.toBeNull();
  });

  it("every ref/cite command's undefined id has a title", () => {
    for (const cmd of [...REF_CMDS, ...CITE_CMDS]) {
      expect(ruleTitle(`${cmd}-undefined`), cmd).not.toBeNull();
    }
  });

  it("every rule in the installed unified-latex-lint is titled", () => {
    const dir = join(ROOT, "node_modules/@unified-latex/unified-latex-lint/rules");
    const ids = readdirSync(dir)
      .filter((d) => d.startsWith("unified-latex-lint-"))
      .map((d) => d.slice("unified-latex-lint-".length));
    expect(ids.length).toBeGreaterThan(0);
    const missing = ids.filter((id) => !(id in UNIFIED_LINT_RULE_TITLES));
    expect(missing, "title these in UNIFIED_LINT_RULE_TITLES").toEqual([]);
  });

  it("no source file spells a rule id as a literal — producers go through LATEX_RULE", () => {
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const ent of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, ent.name);
        if (ent.isDirectory()) {
          if (ent.name !== "__tests__" && ent.name !== "node_modules") walk(p);
        } else if (/\.tsx?$/.test(ent.name)) {
          readFileSync(p, "utf8")
            .split("\n")
            .forEach((line, i) => {
              if (/\bruleId:\s*["'`]/.test(line)) offenders.push(`${relative(ROOT, p)}:${i + 1}`);
            });
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });

  it("everything the syntax checker emits is titled", () => {
    const text = [
      "\\begin{itemize} \\end{enumerate}",
      "\\end{quote}",
      "\\begin{center}",
      "x } y {",
      "$ open",
      "$$ open",
      "\\eqref{nope} \\ref{nope} \\citep{nokey} \\textcite{nokey}",
    ].join("\n");
    const ids = new Set(runSyntaxChecks(text, { knownBibKeys: new Set() }).map((e) => e.ruleId!));
    expect(ids.size).toBeGreaterThanOrEqual(8);
    for (const id of ids) expect(ruleTitle(id), id).not.toBeNull();
  });

  it("a unified-latex lint message carries a titled id", async () => {
    const errors = await runLint("\\def\\foo{bar}\n\nText $$x$$ here.\n", []);
    const lintIds = errors.map((e) => e.ruleId).filter((id) => id && id in UNIFIED_LINT_RULE_TITLES);
    expect(lintIds).toContain("no-def");
  });
});
