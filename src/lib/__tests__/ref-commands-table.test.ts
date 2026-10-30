// @vitest-environment jsdom
//
// Task 1372 — the cross-reference command vocabulary is ONE table
// (`REF_COMMANDS` in ref-commands.ts), read by the main parser + serializer,
// the footnote-body parser + serializer, the requirement collector and the
// ref popover. Before it, the parser regex and the serializer `if`-chain were
// two hand lists, and the serializer's fallback rewrote any name it did not
// list to `\ref` — a silent byte change waiting for the first new name.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";
import { extractPreambleAndPostamble, parseLatex } from "@/lib/latex-parser";
import { detectBodyRequirements } from "@/lib/latex-requirements";
import {
  serializeBodyOnly,
  serializeToLatex,
  UnserializableNodeError,
} from "@/lib/latex-serializer";
import { richJsonToLatex, richLatexToJson } from "@/lib/footnote-content";
import {
  REF_COMMANDS,
  REF_COMMAND_NAMES,
  matchRefCommandAt,
  refCommandLatex,
  toRefCommand,
} from "@/lib/ref-commands";
import { formatRefDisplay } from "@/lib/ref-display";

function findByType(node: JSONContent, type: string, out: JSONContent[] = []): JSONContent[] {
  if (node.type === type) out.push(node);
  if (node.content) for (const c of node.content) findByType(c, type, out);
  return out;
}

const PREAMBLE = "\\documentclass{article}\n";

function wrap(body: string): string {
  return `${PREAMBLE}\\begin{document}\n${body}\n\\end{document}\n`;
}

const refPara = (refCommand: unknown): JSONContent => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "see " },
        { type: "labelRef", attrs: { label: "ex:a", displayText: "", refCommand, targetKind: null } },
      ],
    },
  ],
});

describe("REF_COMMANDS — one table, every layer", () => {
  for (const cmd of REF_COMMAND_NAMES) {
    it(`\\${cmd} round-trips byte-identically through the main parser + serializer`, () => {
      const body = `See \\${cmd}{ex:a} here.`;
      const doc = parseLatex(wrap(body));
      const refs = findByType(doc, "labelRef");
      expect(refs).toHaveLength(1);
      expect(refs[0].attrs?.refCommand).toBe(cmd);
      expect(serializeBodyOnly(doc)).toContain(body);
    });

    it(`\\${cmd} round-trips through the footnote-body parser + serializer`, () => {
      const json = richLatexToJson(`see \\${cmd}{ex:a}`);
      const refs = findByType(json, "labelRef");
      expect(refs).toHaveLength(1);
      expect(refs[0].attrs?.refCommand).toBe(cmd);
      expect(richJsonToLatex(json)).toBe(`see \\${cmd}{ex:a}`);
    });

    it(`\\${cmd} declares exactly its table requirement`, () => {
      const tex = wrap(`See \\${cmd}{ex:a}.`);
      const out = serializeToLatex(parseLatex(tex), extractPreambleAndPostamble(tex) ?? {});
      const preamble = out.slice(0, out.indexOf("\\begin{document}"));
      const loadsExpex = /\\usepackage(\[[^\]]*\])?\{expex\}/.test(preamble);
      expect(loadsExpex).toBe(REF_COMMANDS[cmd].requires === "expex");
    });

    it(`\\${cmd}: the requirement collector's body scan agrees with the table`, () => {
      // The collector spells its expex row as a literal regex (owned by
      // raw-passthrough-declaration's census), so agreement is pinned HERE.
      const pinsExpex = detectBodyRequirements(`See \\${cmd}{ex:a}.`).has("expex");
      expect(pinsExpex).toBe(REF_COMMANDS[cmd].requires === "expex");
    });
  }

  it("matches longest-first and boundary-guards on the brace", () => {
    expect(matchRefCommandAt("\\getfullref{a.b}")?.command).toBe("getfullref");
    expect(matchRefCommandAt("\\getref{a}")?.command).toBe("getref");
    expect(matchRefCommandAt("\\ref{a}")).toEqual({ command: "ref", openLength: 5 });
    expect(matchRefCommandAt("\\refx{a}")).toBeNull();
    expect(matchRefCommandAt("\\reference{a}")).toBeNull();
    expect(matchRefCommandAt("\\ref {a}")).toBeNull();
  });

  it("an unlisted command name is kept VERBATIM, never degraded to \\ref", () => {
    expect(serializeBodyOnly(refPara("eqref"))).toContain("\\eqref{ex:a}");
    expect(richJsonToLatex(refPara("eqref"))).toContain("\\eqref{ex:a}");
    expect(refCommandLatex("eqref", "x")).toEqual({ latex: "\\eqref{x}", requires: null });
  });

  it("an empty / missing command is the default \\ref", () => {
    expect(serializeBodyOnly(refPara(""))).toContain("\\ref{ex:a}");
    expect(serializeBodyOnly(refPara(undefined))).toContain("\\ref{ex:a}");
  });

  it("a value that is no command name is REFUSED by both serializers", () => {
    expect(() => serializeBodyOnly(refPara("not a name"))).toThrow(UnserializableNodeError);
    expect(() => richJsonToLatex(refPara("x}{y"))).toThrow(UnserializableNodeError);
  });

  it("display + narrowing read the table", () => {
    for (const cmd of REF_COMMAND_NAMES) {
      expect(formatRefDisplay("3", cmd)).toBe(REF_COMMANDS[cmd].display === "bare" ? "3" : "(3)");
    }
    expect(toRefCommand("getref")).toBe("getref");
    expect(toRefCommand("bogus")).toBe("ref");
    expect(toRefCommand(undefined)).toBe("ref");
  });
});

describe("CENSUS: no hand-listed ref command outside the table", () => {
  // The names that are not also substrings of the default `\ref` — the ones a
  // second hand list would have to spell out.
  const DISTINCT = REF_COMMAND_NAMES.filter((n) => n !== "ref");
  const SITES = [
    "src/lib/latex-parser.ts",
    "src/lib/latex-serializer.ts",
    "src/lib/footnote-content.ts",
    "src/components/LabelRefPopover.tsx",
    "src/components/EditorPane.tsx",
    "src/components/editor-layout/event-bridges/marker-clicks.ts",
  ];
  for (const rel of SITES) {
    it(`${rel} spells no ref command as a string literal`, () => {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      // Strip comments so prose mentioning `\getref` stays allowed.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
      for (const name of DISTINCT) {
        expect(code, `${rel} hand-lists "${name}"`).not.toMatch(
          new RegExp(`["'\`|(]${name}\\b|\\b${name}["'\`|)]`),
        );
      }
    });
  }
});
