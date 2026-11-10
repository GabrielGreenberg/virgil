/**
 * Task 1559 — "which bytes does the compiler EXECUTE?" has ONE door,
 * `projectExecutedLatex` (src/lib/latex-lexer.ts). Before it, every
 * declaration reader spelled `projectLiveLatex(…, { envs: VERBATIM_ENVS_FULL,
 * inlineVerb: true })` per site, so when task 1370 taught the detector door
 * that `\iffalse … \fi` is inert, three readers missed it — and an
 * `\iffalse`'d `\bibliography{old}` made the Bibliography panel read AND
 * write `old.bib` while the compiler read the live file.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { declaredBibFiles } from "@/lib/bib-resources";
import { detectPassPlan } from "@/lib/compile/reference-resolution";
import {
  extractDocumentClass,
  findSectioningCommands,
  rewriteDocumentClass,
} from "@/lib/document-class";
import { projectExecutedLatex } from "@/lib/latex-lexer";
import { commentsStripped, REPO_ROOT, walkFiles } from "./_source-scan";

describe("declaredBibFiles — a parked declaration declares nothing", () => {
  it("an \\iffalse'd \\bibliography{old} loses to the live one", () => {
    expect(declaredBibFiles("\\iffalse\n\\bibliography{old}\n\\fi\n\\bibliography{refs}")).toEqual([
      "refs.bib",
    ]);
  });
  it("same for \\if0", () => {
    expect(declaredBibFiles("\\if0\n\\addbibresource{old.bib}\n\\fi\n\\addbibresource{refs.bib}")).toEqual([
      "refs.bib",
    ]);
  });
  it("the \\else branch is live", () => {
    expect(declaredBibFiles("\\iffalse\n\\bibliography{old}\n\\else\n\\bibliography{refs}\n\\fi")).toEqual([
      "refs.bib",
    ]);
  });
  it("an unterminated \\iffalse fails OPEN (the pre-1559 answer)", () => {
    expect(declaredBibFiles("\\iffalse\n\\bibliography{refs}")).toEqual(["refs.bib"]);
  });
});

describe("detectPassPlan — an \\iffalse'd declaration buys no passes", () => {
  it("an \\iffalse'd \\bibliography alone → 1 pass", () => {
    expect(detectPassPlan("\\iffalse\n\\bibliography{refs}\n\\fi\nHello.").passes).toBe(1);
  });
  it("an \\iffalse'd \\ref alone → 1 pass", () => {
    expect(detectPassPlan("Text.\n\\iffalse See \\ref{x}. \\fi").passes).toBe(1);
  });
});

describe("document-class — an \\iffalse'd class is not the class", () => {
  it("reads the live class past an \\iffalse'd one", () => {
    const src = "\\iffalse\n\\documentclass{book}\n\\fi\n\\documentclass{article}\n";
    const info = extractDocumentClass(src);
    expect(info?.className).toBe("article");
    // Offsets stay RAW, so the rewrite splices the live class in place.
    expect(src.slice(info!.matchStart, info!.matchEnd)).toBe("\\documentclass{article}");
    expect(rewriteDocumentClass(src, "report")).toBe(
      "\\iffalse\n\\documentclass{book}\n\\fi\n\\documentclass{report}\n",
    );
  });
  it("a dead class on the SAME line as the live one is skipped (offset-preserving)", () => {
    expect(extractDocumentClass("\\iffalse\\documentclass{a}\\fi\\documentclass{b}")?.className).toBe(
      "b",
    );
  });
  it("comment and verbatim inertness are unchanged", () => {
    expect(extractDocumentClass("%\\documentclass{book}\n\\documentclass{article}")?.className).toBe(
      "article",
    );
    expect(
      extractDocumentClass(
        "\\begin{verbatim}\n\\documentclass{book}\n\\end{verbatim}\n\\documentclass{article}",
      )?.className,
    ).toBe("article");
  });
  it("an unterminated \\iffalse fails OPEN", () => {
    expect(extractDocumentClass("\\iffalse\n\\documentclass{book}")?.className).toBe("book");
  });
  it("an \\iffalse'd \\chapter is not a sectioning use", () => {
    const found = findSectioningCommands("\\iffalse\n\\chapter{Old}\n\\fi\n\\section{New}");
    expect(found.has("chapter")).toBe(false);
    expect(found.has("section")).toBe(true);
  });
});

describe("projectExecutedLatex", () => {
  it("preserveOffsets keeps the length and newlines", () => {
    const src = "a % c\n\\iffalse x \\fi\n\\verb|q| b";
    const out = projectExecutedLatex(src, { preserveOffsets: true });
    expect(out.length).toBe(src.length);
    expect(out.split("\n").length).toBe(src.split("\n").length);
    expect(out).not.toContain("x");
    expect(out).not.toContain("q");
  });
});

describe("task 1559 — executed-bytes door CENSUS", () => {
  // Outside the lexer, `projectLiveLatex` is called only where the question is
  // NOT "what does this source declare": the figure attribute reader asks an
  // offset question about an excerpt. Every declaration reader goes through
  // `projectExecutedLatex` (or the detector/structural doors), so the rule
  // cannot again be re-spelled per site and miss a pass.
  const HOME = "src/lib/latex-lexer.ts";
  const ALLOWED = new Set(["src/lib/figures/parse-attrs.ts"]);
  const MATCHER = /\bprojectLiveLatex\s*\(/;
  const files = walkFiles(path.join(REPO_ROOT, "src"), { skipDirs: ["__tests__"] }).filter(
    (f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f),
  );

  it("walks a real population", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("no raw projectLiveLatex call outside the lexer and the stated exception", () => {
    const hits: string[] = [];
    for (const abs of files) {
      const rel = path.relative(REPO_ROOT, abs).split(path.sep).join("/");
      if (rel === HOME || ALLOWED.has(rel)) continue;
      commentsStripped(fs.readFileSync(abs, "utf8"))
        .split("\n")
        .forEach((line, i) => {
          if (MATCHER.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`);
        });
    }
    expect(hits, "ask projectExecutedLatex (or the detector/structural door)").toEqual([]);
  });

  it("the stated exception still exists (else drop it from ALLOWED)", () => {
    for (const rel of ALLOWED) {
      expect(MATCHER.test(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"))).toBe(true);
    }
  });
});
