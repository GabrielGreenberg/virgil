// @vitest-environment jsdom
/**
 * The LaTeX language door (task 2026-11-12-1582).
 *
 * `codemirror-lang-latex`'s `latex()` defaults every option ON, including a
 * `@codemirror/lint` linter that flags any >100-char text without
 * `\begin{document}` — i.e. every preamble the style editor holds — and runs a
 * second diagnostics channel beside the Errors panel in the code view. Every
 * mount now takes its options from `virgilLatex(surface)`.
 *
 * CENSUS: the family is DERIVED — every production file importing
 * `codemirror-lang-latex` — and only the door may call `latex(`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { diagnosticCount } from "@codemirror/lint";
import { latex } from "codemirror-lang-latex";
import {
  VIRGIL_LATEX_OPTIONS,
  virgilLatex,
  type VirgilLatexSurface,
} from "../virgil-cm-language";
import { REPO_ROOT, strip, trackedFiles } from "@/lib/__tests__/_source-scan";

const DOOR = "src/lib/codemirror/virgil-cm-language.ts";
const SURFACES = Object.keys(VIRGIL_LATEX_OPTIONS) as VirgilLatexSurface[];

describe("codemirror-lang-latex CENSUS: only the door calls latex(", () => {
  const importers = trackedFiles("src", /\.tsx?$/)
    .filter((p) => !p.includes("__tests__"))
    .map((p) => path.relative(REPO_ROOT, p))
    .filter((rel) =>
      /from\s+["']codemirror-lang-latex["']/.test(
        fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"),
      ),
    );

  it("the family is the door alone (non-vacuous)", () => {
    expect(importers).toEqual([DOOR]);
  });

  it("every CodeMirror LaTeX mount goes through virgilLatex(", () => {
    for (const rel of [
      "src/components/CodeEditor.tsx",
      "src/components/StyleEditorModal.tsx",
      "src/components/source-pod-code-mirror.tsx",
    ]) {
      const code = strip(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"), true);
      expect(code, rel).toMatch(/virgilLatex\(\s*["']/);
      expect(code, rel).not.toMatch(/(?<![\w.])latex\(/);
    }
  });
});

describe("virgilLatex", () => {
  afterEach(() => vi.useRealTimers());

  it("states every option explicitly, linting OFF on every surface", () => {
    for (const s of SURFACES) {
      expect(Object.keys(VIRGIL_LATEX_OPTIONS[s]).sort()).toEqual([
        "autoCloseBrackets",
        "autoCloseTags",
        "enableAutocomplete",
        "enableLinting",
        "enableTooltips",
      ]);
      expect(VIRGIL_LATEX_OPTIONS[s].enableLinting).toBe(false);
    }
  });

  it("is memoised per surface (stable identity for the source pod, task 729)", () => {
    for (const s of SURFACES) expect(virgilLatex(s)).toBe(virgilLatex(s));
  });

  const PREAMBLE =
    "\\documentclass{article}\n\\usepackage{amsmath}\n\\usepackage{natbib}\n" +
    "\\newcommand{\\foo}{bar}\n\\setlength{\\parindent}{0pt}\n\\title{A long enough preamble}\n";

  async function lintCount(ext: Extension) {
    vi.useFakeTimers();
    const view = new EditorView({
      state: EditorState.create({ doc: PREAMBLE, extensions: ext }),
      parent: document.body,
    });
    await vi.advanceTimersByTimeAsync(2000);
    const n = diagnosticCount(view.state);
    view.destroy();
    return n;
  }

  it("the package default DOES flag a preamble (the control — keeps the next test honest)", async () => {
    expect(PREAMBLE.length).toBeGreaterThan(100);
    expect(await lintCount([latex()])).toBeGreaterThan(0);
  });

  it("the style editor's language yields no lint diagnostics over a preamble", async () => {
    expect(await lintCount([virgilLatex("style-editor")])).toBe(0);
  });
});
