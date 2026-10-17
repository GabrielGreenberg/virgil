/**
 * Task 1157 — "which .bib does this paper use?" has ONE reader
 * (`src/lib/bib-resources.ts`), and both storage backends + the compile pass
 * planner ask it.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  bibFilenameOf,
  declaredBibFiles,
  listBibResourceDecls,
  pickDeclaredBibFile,
} from "@/lib/bib-resources";
import { detectPassPlan } from "@/lib/compile/reference-resolution";
import { commentsStripped, REPO_ROOT, walkFiles } from "./_source-scan";

describe("declaredBibFiles", () => {
  it("reads a single declaration, appending .bib when absent", () => {
    expect(declaredBibFiles("\\bibliography{refs}")).toEqual(["refs.bib"]);
    expect(declaredBibFiles("\\addbibresource{refs.bib}")).toEqual(["refs.bib"]);
    expect(bibFilenameOf("refs.bib")).toBe("refs.bib");
  });

  it("splits a \\bibliography comma list, trimmed, in order", () => {
    expect(declaredBibFiles("\\bibliography{refs, extra ,\n more}")).toEqual([
      "refs.bib",
      "extra.bib",
      "more.bib",
    ]);
  });

  it("ignores a commented-out declaration above the live one", () => {
    const tex = "%\\bibliography{old}\n  % \\addbibresource{older.bib}\n\\bibliography{refs}";
    expect(declaredBibFiles(tex)).toEqual(["refs.bib"]);
  });

  it("respects an escaped percent (the declaration after \\% is live)", () => {
    expect(declaredBibFiles("50\\% done \\bibliography{refs}")).toEqual(["refs.bib"]);
  });

  it("ignores declarations inside verbatim", () => {
    const tex =
      "\\begin{verbatim}\n\\bibliography{fake}\n\\end{verbatim}\n\\verb|\\bibliography{fake2}|\n\\bibliography{real}";
    expect(declaredBibFiles(tex)).toEqual(["real.bib"]);
  });

  it("accepts \\addbibresource[opts]{…} and spaced spellings", () => {
    expect(declaredBibFiles("\\addbibresource[label=x]{refs.bib}")).toEqual(["refs.bib"]);
    expect(declaredBibFiles("\\addbibresource [location=local] {a.bib}")).toEqual(["a.bib"]);
    expect(declaredBibFiles("\\bibliography {refs}")).toEqual(["refs.bib"]);
  });

  it("collects several \\addbibresource calls in order, de-duplicated", () => {
    const tex = "\\addbibresource{a.bib}\n\\addbibresource{b.bib}\n\\addbibresource{a.bib}";
    expect(declaredBibFiles(tex)).toEqual(["a.bib", "b.bib"]);
  });

  it("does not read \\bibliographystyle, and an empty argument declares nothing", () => {
    expect(declaredBibFiles("\\bibliographystyle{plainnat}")).toEqual([]);
    expect(declaredBibFiles("\\bibliography{}")).toEqual([]);
    expect(listBibResourceDecls("\\bibliography{ , }")).toEqual([]);
  });
});

describe("pickDeclaredBibFile — the write-target rule", () => {
  const existsIn = (files: string[]) => async (n: string) => files.includes(n);

  it("null when nothing is declared (the folder heuristic decides)", async () => {
    expect(await pickDeclaredBibFile([], existsIn(["x.bib"]))).toBeNull();
  });

  it("the first declared file that EXISTS", async () => {
    expect(await pickDeclaredBibFile(["refs.bib", "extra.bib"], existsIn(["extra.bib"]))).toBe(
      "extra.bib",
    );
    expect(
      await pickDeclaredBibFile(["refs.bib", "extra.bib"], existsIn(["refs.bib", "extra.bib"])),
    ).toBe("refs.bib");
  });

  it("the first declared name when none exists yet, never a concatenation", async () => {
    expect(await pickDeclaredBibFile(["refs.bib", "extra.bib"], existsIn([]))).toBe("refs.bib");
  });

  it("a single declaration costs no existence probe", async () => {
    let probes = 0;
    const r = await pickDeclaredBibFile(["refs.bib"], async () => {
      probes++;
      return false;
    });
    expect(r).toBe("refs.bib");
    expect(probes).toBe(0);
  });
});

describe("compile pass planner asks the same reader", () => {
  it("an \\addbibresource[opts] declaration plans the bib-backend pass", () => {
    const withDecl = detectPassPlan(
      "\\documentclass{article}\\begin{document}x\\addbibresource[label=a]{r.bib}\\end{document}",
    );
    const without = detectPassPlan("\\documentclass{article}\\begin{document}x\\end{document}");
    expect(withDecl).not.toEqual(without);
  });

  it("a commented-out \\bibliography plans nothing extra", () => {
    const commented = detectPassPlan(
      "\\documentclass{article}\\begin{document}x\n%\\bibliography{r}\n\\end{document}",
    );
    const without = detectPassPlan("\\documentclass{article}\\begin{document}x\n\\end{document}");
    expect(commented).toEqual(without);
  });
});

describe("task 1157 — bib-declaration reader CENSUS", () => {
  // A matcher for the bib-resource commands — an escaped `\\bibliography` /
  // `\\addbibresource` (optionally behind `(` or `(?:`) followed by regex syntax
  // (`\{`, `\s`, `(?!`, `|`, `)`) — lives ONLY in the reader. An emitted STRING
  // (`"\\bibliography{references}"` in a template) carries none of that syntax
  // and is not counted.
  const HOME = "src/lib/bib-resources.ts";
  const MATCHER =
    /\\\\\(?(?:\?:)?(?:bibliography|addbibresource)(?:\\\{|\\s|\(\?!|\||\))/;
  const files = walkFiles(path.join(REPO_ROOT, "src"), { skipDirs: ["__tests__"] }).filter(
    (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f),
  );

  it("walks a real population", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("no bib-declaration matcher outside bib-resources.ts", () => {
    const hits: string[] = [];
    for (const abs of files) {
      const rel = path.relative(REPO_ROOT, abs).split(path.sep).join("/");
      if (rel === HOME) continue;
      commentsStripped(fs.readFileSync(abs, "utf8"))
        .split("\n")
        .forEach((line, i) => {
          if (MATCHER.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits, "route the read through declaredBibFiles / listBibResourceDecls").toEqual([]);
  });

  it("the census pattern catches the retired spellings", () => {
    expect(MATCHER.test(String.raw`const R = /\\(?:bibliography|addbibresource)\{([^}]+)\}/;`)).toBe(
      true,
    );
    expect(MATCHER.test(String.raw`const R = /\\bibliography\{|\\addbibresource\{/;`)).toBe(true);
    expect(MATCHER.test(String.raw`"\\bibliography{references}",`)).toBe(false);
    expect(MATCHER.test(fs.readFileSync(path.join(REPO_ROOT, HOME), "utf8"))).toBe(true);
  });
});
