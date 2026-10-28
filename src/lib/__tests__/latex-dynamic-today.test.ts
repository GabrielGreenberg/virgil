// @vitest-environment jsdom
/**
 * Task 1335 — `\today` is a DYNAMIC-COMMAND inline atom (`latexDynamic`).
 *
 * Before: `\today` was special only as the WHOLE argument of `\date{…}` (a
 * write-only `isToday` flag), and grey `latexCommand` passthrough everywhere
 * else — a letter's date line never read as a date, and `\today` + Enter did
 * nothing. Now both inline parsers read it into one atom that holds the NAME,
 * paints the computed date, and serializes back byte-identically.
 *
 * Every leg runs TWO save cycles over the body, a card/footnote body (the
 * second parser) and a heading argument.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Editor, type JSONContent } from "@tiptap/react";

import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly, assignUuids, serializeToLatex } from "@/lib/latex-serializer";
import { richLatexToJson, richJsonToLatex, richJsonToPlainText } from "@/lib/footnote-content";
import {
  emitDynamicCommand,
  formatLatexToday,
  matchDynamicCommandAt,
} from "@/lib/latex-dynamic-commands";
import { buildEditorExtensions, type EditorExtensionsCtx } from "@/lib/editor-extensions";
import { COMMAND_MAP, VIRGIL_COMMAND_NAMES } from "@/lib/tiptap/commands";

const REPO_ROOT = join(__dirname, "..", "..", "..");

function bodyCycle(src: string): string {
  const doc = parseLatex(`\\documentclass{article}\n\\begin{document}\n${src}\n\\end{document}\n`);
  assignUuids(doc);
  return serializeBodyOnly(doc)
    .replace(/ *%!v:[0-9a-f]{4}/g, "")
    .trim();
}

function cardCycle(src: string): string {
  return richJsonToLatex(richLatexToJson(src));
}

const SURFACES: ReadonlyArray<{ name: string; cycle: (s: string) => string }> = [
  { name: "body", cycle: bodyCycle },
  { name: "card", cycle: cardCycle },
  {
    name: "heading",
    cycle: (s) => {
      const out = bodyCycle(`\\section{${s}}`);
      const m = /^\\section\{([\s\S]*)\}$/.exec(out);
      return m ? m[1] : out;
    },
  },
];

function expectStable(src: string) {
  for (const { name, cycle } of SURFACES) {
    const c1 = cycle(src);
    expect(c1, `${name}: cycle 1 must not move the bytes`).toBe(src);
    expect(cycle(c1), `${name}: cycle 2`).toBe(src);
  }
}

function findAll(json: JSONContent, type: string): JSONContent[] {
  const out: JSONContent[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === type) out.push(n);
    n.content?.forEach(walk);
  };
  walk(json);
  return out;
}

describe("the formatter — LaTeX's default `\\today` spelling", () => {
  it("formats as 'Month D, YYYY'", () => {
    expect(formatLatexToday(new Date(2026, 9, 27))).toBe("October 27, 2026");
    expect(formatLatexToday(new Date(2027, 0, 3))).toBe("January 3, 2027");
  });

  it("is the ONE formatter — no hand-rolled `toLocaleDateString` long-date copy survives", () => {
    for (const rel of ["src/lib/latex-parser.ts", "src/lib/actions/action-registry.ts"]) {
      const code = readFileSync(join(REPO_ROOT, rel), "utf8");
      expect(code, rel).not.toMatch(/toLocaleDateString\(\s*["']en-US["']/);
    }
  });
});

describe("parse — `\\today` is the chip on every inline surface", () => {
  it("body paragraph", () => {
    const doc = parseLatex("\\documentclass{letter}\n\\begin{document}\nLos Angeles, \\today.\n\\end{document}\n");
    const chips = findAll(doc, "latexDynamic");
    expect(chips).toHaveLength(1);
    expect(chips[0].attrs).toMatchObject({ command: "today", term: "" });
    // No grey carrier left behind.
    expect(JSON.stringify(doc)).not.toContain('"text":"\\\\today"');
  });

  it("heading, footnote and card body", () => {
    const doc = parseLatex(
      "\\documentclass{article}\n\\begin{document}\n\\section{As of \\today}\nText.\\footnote{Revised \\today.}\n\\end{document}\n",
    );
    expect(findAll(doc, "latexDynamic").length).toBeGreaterThanOrEqual(1);
    const card = richLatexToJson("Checked \\today{} again.");
    const chips = findAll(card, "latexDynamic");
    expect(chips).toHaveLength(1);
    expect(chips[0].attrs).toMatchObject({ command: "today", term: "{}" });
  });

  it("`\\date{\\today}` is a title field CONTAINING the chip (no isToday flag)", () => {
    const doc = parseLatex("\\documentclass{article}\n\\date{\\today}\n\\begin{document}\n\\maketitle\n\\end{document}\n");
    const [date] = findAll(doc, "titleField");
    expect(date.attrs?.isToday).toBeUndefined();
    expect(date.content?.map((c) => c.type)).toEqual(["latexDynamic"]);
  });

  it("the name is compared for EQUALITY — `\\todays` is not ours", () => {
    expect(matchDynamicCommandAt("\\todays", 0)).toBeNull();
    expect(matchDynamicCommandAt("\\today{}{}", 0)).toEqual({ command: "today", term: "{}", end: 8 });
  });
});

describe("round trip — byte-identical over two cycles", () => {
  it.each([
    "Dated \\today.",
    "Dated \\today, in Los Angeles.",
    "Dated \\today{} in Los Angeles.",
    "Dated \\today\\ in Los Angeles.",
    "Dated \\today{}x",
    "Dated \\today x",
    "\\today",
  ])("%s", (src) => {
    expectStable(src);
  });

  it("inside a code span it stays literal source (the text-macro rung's exclusion)", () => {
    for (const src of ["\\texttt{a \\today b}"]) {
      expect(bodyCycle(src)).toBe(src);
      const doc = parseLatex(`\\documentclass{article}\n\\begin{document}\n${src}\n\\end{document}\n`);
      expect(findAll(doc, "latexDynamic")).toHaveLength(0);
    }
  });
});

describe("emit — the token break comes back when a letter now follows", () => {
  const chip = (term: "" | "{}", marks?: JSONContent["marks"]) =>
    ({ type: "latexDynamic", attrs: { command: "today", term }, marks }) as JSONContent;

  it("a bare chip before a letter re-emits `{}` (else `\\todayx`)", () => {
    expect(emitDynamicCommand(chip(""), { type: "text", text: "x" })).toBe("\\today{}");
    expect(emitDynamicCommand(chip(""), { type: "text", text: " x" })).toBe("\\today");
    expect(emitDynamicCommand(chip(""), null)).toBe("\\today");
    expect(emitDynamicCommand(chip("{}"), { type: "text", text: "x" })).toBe("\\today{}");
  });

  it("a differing wrapper means a brace sits between — no extra `{}`", () => {
    expect(
      emitDynamicCommand(chip("", [{ type: "italic" }]), { type: "text", text: "x" }),
    ).toBe("\\today");
  });

  it("through the real body serializer: a letter typed after a parsed `\\today` keeps the command", () => {
    const doc = parseLatex("\\documentclass{article}\n\\begin{document}\nDated \\today.\n\\end{document}\n");
    // Simulate the edit: the "." after the chip becomes "x".
    const para = findAll(doc, "paragraph")[0];
    const idx = para.content!.findIndex((n) => n.type === "latexDynamic");
    para.content![idx + 1] = { type: "text", text: "x" };
    assignUuids(doc);
    expect(serializeBodyOnly(doc)).toContain("Dated \\today{}x");
  });
});

describe("projections", () => {
  it("plain text shows the date, not the command", () => {
    expect(richJsonToPlainText(richLatexToJson("Dated \\today."))).toBe(`Dated ${formatLatexToday()}.`);
  });
});

describe("the slash command — `\\today` + Enter inserts the chip", () => {
  let editor: Editor | null = null;
  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  function mount(): Editor {
    const element = document.createElement("div");
    document.body.appendChild(element);
    const ctx: EditorExtensionsCtx = {
      surface: "main",
      editableRef: { current: true },
      cardContext: false,
      callbacks: {},
      docIdRef: { current: null },
      anchoredUuidsRef: { current: new Set<string>() },
      host: null,
    };
    editor = new Editor({
      element,
      extensions: buildEditorExtensions(ctx),
      content: {
        type: "doc",
        content: [{ type: "paragraph", attrs: { uuid: "p1" }, content: [{ type: "text", text: "Dated " }] }],
      },
    });
    return editor;
  }

  it("is in the slash vocabulary", () => {
    expect(VIRGIL_COMMAND_NAMES).toContain("today");
  });

  it("inserts a chip that serializes to `\\today{}`", () => {
    const ed = mount();
    const end = ed.state.doc.firstChild!.nodeSize - 1;
    ed.commands.setTextSelection(end);
    COMMAND_MAP.get("today")!.action(ed.view, "\\today");
    const chips: string[] = [];
    ed.state.doc.descendants((n) => {
      if (n.type.name === "latexDynamic") chips.push(n.attrs.command as string);
    });
    expect(chips).toEqual(["today"]);
    expect(serializeToLatex(ed.getJSON())).toContain("Dated \\today{}");
    // The NodeView paints the date.
    const dom = ed.view.dom.querySelector('[data-type="latex-dynamic"]');
    expect(dom?.textContent).toBe(formatLatexToday());
  });
});
