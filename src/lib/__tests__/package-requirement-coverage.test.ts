// @vitest-environment jsdom
// Task 543 — package injection COVERAGE, made structural.
//
// The requirements-by-emission system (P4) injects `\usepackage` on every save
// from two sources: each emit-site DECLARES the package its bytes need
// (`need("expex")` beside the `\ex` it writes), and `PACKAGE_DETECTORS` is the
// FALLBACK scan for hand-typed raw LaTeX that never flowed through a modeled
// emit-site. Gabriel's report ("can you auto-detect and auto-add any necessary
// packages — forest, expex, linguex, or anything else") is a coverage question,
// and coverage had never been ASKED of the construct vocabulary as a whole:
// each `need()` site was added with the node it declares for, and the one
// dialect whose arm said "Requirements: NONE, deliberately" was the gap.
//
// Measured on the pre-543 tree through the real save pipeline:
//   - a linguex `\ex.` pasted into a document with no example package got
//     NOTHING injected (carried raw, undefined `\ex.` at compile);
//   - a gb4e paper's carried `\begin{exe}\ex …` tripped the EXPEX detector and
//     `\usepackage{expex}` landed AFTER `\usepackage{gb4e}` — the task-355
//     hazard one package over, on five of Gabriel's real papers' preambles;
//   - an expex example under a linguex-only preamble injected expex after
//     linguex, redefining `\ex` under every example the author wrote.
//
// Three things close them, and each has a leg here that fails when neutered:
// the linguex arm DECLARES (node model + fallback row); the EXAMPLE PACKAGE
// FAMILY (expex / linguex / gb4e — exactly one may be loaded) is reconciled
// the way the bib family already was; and this suite makes the coverage
// question STRUCTURAL — every node and mark the real schema declares has a
// fixture whose emitted bytes are asserted to be DECLARED by their own emit-
// site (the fallback detector may never be the thing rescuing a modeled
// construct), and every detector row has an inject line (a row with none
// detects nothing). A future modeled construct fails the population pin
// before it can ship without its package.
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import type { JSONContent } from "@tiptap/react";
import { getSchema } from "@tiptap/core";
import {
  buildEditorExtensions,
  type EditorExtensionsCtx,
} from "@/lib/editor-extensions";
import { parseLatex, extractPreambleAndPostamble } from "@/lib/latex-parser";
import {
  assignUuids,
  serializeToLatex,
  serializeTopLevelBlock,
} from "@/lib/latex-serializer";
import {
  detectBodyRequirements,
  ensurePreambleRequirements,
  LATEX_REQUIREMENTS,
  type RequirementConflict,
} from "@/lib/latex-requirements";
import { PACKAGE_DETECTORS } from "@/lib/latex-requirement-collector";
import { matchLinguexOpenerAt } from "@/lib/latex-lexer";
import {
  EXAMPLE_PACKAGE_FAMILY,
  asExampleDialect,
  exampleDialectOf,
} from "@/lib/example-dialect";
import { codeOnly } from "@/lib/__tests__/_source-scan";

const ROOT = path.resolve(__dirname, "../../..");

function mainCtx(): EditorExtensionsCtx {
  return {
    surface: "main",
    editableRef: { current: true },
    cardContext: false,
    callbacks: {},
    docIdRef: { current: null },
    texBlockIsPoppedRef: { current: undefined },
    anchoredUuidsRef: { current: new Set<string>() },
    host: null,
  } as unknown as EditorExtensionsCtx;
}

// ── the real save pipeline, byte for byte (`storage-fsa.writeDocBundle`) ────

function tex(body: string, packages: string, preambleExtra = ""): string {
  return `\\documentclass{article}\n${packages}\n${preambleExtra}\n\\begin{document}\n\n${body}\n\n\\end{document}\n`;
}

function save(
  src: string,
  onRequirementConflict?: (c: RequirementConflict) => void,
): string {
  const content = parseLatex(src);
  assignUuids(content);
  return serializeToLatex(content, {
    ...(extractPreambleAndPostamble(src) ?? {}),
    onRequirementConflict,
  });
}

function preambleOf(latex: string): string {
  return latex.split("\\begin{document}")[0] ?? "";
}

function usepackageCount(latex: string, pkg: string): number {
  return (
    preambleOf(latex).match(new RegExp(`^\\\\usepackage\\{${pkg}\\}$`, "gm")) ??
    []
  ).length;
}

function walk(n: JSONContent, out: JSONContent[] = []): JSONContent[] {
  out.push(n);
  n.content?.forEach((c) => walk(c, out));
  return out;
}

function typesIn(doc: JSONContent): Set<string> {
  return new Set(walk(doc).map((n) => n.type ?? ""));
}

function markTypesIn(doc: JSONContent): Set<string> {
  const out = new Set<string>();
  for (const n of walk(doc)) for (const m of n.marks ?? []) out.add(m.type);
  return out;
}

const BARE = "\\usepackage{amsmath}";
const EXPEX = "\\usepackage{expex}";
const LINGUEX = "\\usepackage{linguex}";
const GB4E = "\\usepackage{gb4e}";

// ── 1 · the coverage sweep: every schema type has a fixture, every fixture's
//        emitted bytes are DECLARED by their own emit-site ───────────────────

/** One `.tex` fixture per NODE type the real main schema declares. Keyed so
 *  that a node the schema gains fails the population leg below rather than
 *  silently skipping the sweep — which is how the linguex arm shipped with no
 *  declaration for five weeks. */
const NODE_FIXTURES: Record<
  string,
  { body: string; packages?: string; preambleExtra?: string }
> = {
  paragraph: { body: "Plain prose." },
  heading: { body: "\\section{Intro}" },
  bulletList: { body: "\\begin{itemize}\n\\item one\n\\end{itemize}" },
  orderedList: { body: "\\begin{enumerate}\n\\item one\n\\end{enumerate}" },
  blockquote: { body: "\\begin{quote}\nquoted\n\\end{quote}" },
  codeBlock: { body: "\\begin{verbatim}\ncode\n\\end{verbatim}" },
  texBlock: {
    body:
      "%!vtex:begin ab12\n\\begin{tikzpicture}\\draw (0,0);\\end{tikzpicture}\n%!vtex:end ab12",
  },
  forestBlock: { body: "\\begin{forest}[S [NP] [VP]]\\end{forest}" },
  figureBlock: {
    body: "\\begin{figure}\n\\includegraphics{a.png}\n\\caption{c}\n\\end{figure}",
  },
  graphicsBlock: { body: "\\includegraphics{a.png}" },
  displayMath: { body: "\\[x^2\\]" },
  horizontalRule: { body: "\\hrulefill" },
  latexComment: { body: "% a comment line" },
  // The expex dialect, with a nested tier (`xlist`) and its items.
  exampleBlock: {
    body: "\\pex\n\\a One.\n\\a Two, with a sublist:\n\\begin{xlist}\n\\a inner.\n\\end{xlist}\n\\xe",
    packages: EXPEX,
  },
  exampleGloss: {
    body: "\\ex\n\\begingl\n\\gla wo kan shu //\n\\glb I read book //\n\\glft `I read books' //\n\\endgl\n\\xe",
    packages: EXPEX,
  },
  titleField: { body: "Prose.", preambleExtra: "\\title{T}" },
  maketitleMarker: { body: "\\maketitle" },
  // Inline atoms.
  hardBreak: { body: "a\\\\\nb" },
  inlineMath: { body: "$x$" },
  footnote: { body: "a\\footnote{f}" },
  citation: { body: "\\citep{k}", packages: "\\usepackage{natbib}" },
  labelRef: { body: "\\getref{s}", packages: EXPEX },
};

/** Node types that never sit at the TOP level and are covered INSIDE a
 *  fixture above — each is asserted to actually appear in the named
 *  fixture's parse, so the exemption is a checked claim, not a licence. */
const NESTED_IN: Record<string, string> = {
  listItem: "bulletList",
  figureCaption: "figureBlock",
  exampleItemList: "exampleBlock",
  exampleItem: "exampleBlock",
  alignedGlossRow: "exampleGloss",
  glossCell: "exampleGloss",
  proseGlossRow: "exampleGloss",
};

/** One `.tex` fixture per MARK type the schema declares, or a stated reason
 *  the mark emits no LaTeX of its own. */
const MARK_FIXTURES: Record<string, { body: string } | { exempt: string }> = {
  bold: { body: "\\textbf{x}" },
  italic: { body: "\\emph{x}" },
  underline: { body: "\\underline{x}" },
  code: { body: "\\texttt{x}" },
  textColor: { body: "\\textcolor[HTML]{FF0000}{x}" },
  latexCommand: { body: "\\foobar{x}" },
  latexVerbatim: { body: "\\verb|x|" },
  latexCommentTail: { body: "text % tail" },
  linkedAnchor: { body: "a \\vlid{ab12}ranged\\vlidend{ab12} b" },
  strike: {
    exempt:
      "StarterKit mark with no serializer arm — `applyWrapperMarks` drops it, so it emits no bytes and needs no package",
  },
  link: {
    exempt:
      "StarterKit mark with no serializer arm — dropped by `applyWrapperMarks`, emits nothing",
  },
  highlight: {
    exempt:
      "view-only carrier for transient bands (task 120); its writers are censused dead, it never reaches the .tex",
  },
};

/** The ids ONE fixture's emit-sites declared, bib family included. */
function declaredFor(doc: JSONContent): Set<string> {
  const out = new Set<string>();
  for (const n of doc.content ?? []) {
    const part = serializeTopLevelBlock(n);
    for (const id of part.requirementIds) out.add(id);
    if (part.bibFamily) out.add(part.bibFamily);
  }
  return out;
}

function bodyFor(doc: JSONContent): string {
  return (doc.content ?? []).map((n) => serializeTopLevelBlock(n).latex).join("");
}

describe("1 · coverage — every schema construct's emitted bytes are DECLARED", () => {
  const schema = getSchema(buildEditorExtensions(mainCtx()));
  const schemaNodes = Object.keys(schema.nodes)
    .filter((n) => n !== "doc" && n !== "text")
    .sort();
  const schemaMarks = Object.keys(schema.marks).sort();

  it("the node population is an EXACT set — a new node type needs a fixture", () => {
    const covered = [
      ...Object.keys(NODE_FIXTURES),
      ...Object.keys(NESTED_IN),
    ].sort();
    expect(covered).toEqual(schemaNodes);
  });

  it("the mark population is an EXACT set — a new mark needs a fixture or a stated reason", () => {
    expect(Object.keys(MARK_FIXTURES).sort()).toEqual(schemaMarks);
  });

  for (const [type, fx] of Object.entries(NODE_FIXTURES)) {
    it(`node ${type}: the fixture produces it, and the fallback rescues nothing the emit did not declare`, () => {
      const src = tex(fx.body, fx.packages ?? BARE, fx.preambleExtra ?? "");
      const doc = parseLatex(src);
      assignUuids(doc);
      // Fixture honesty: a fixture that stopped producing its node would make
      // this leg a statement about some other construct.
      expect(typesIn(doc).has(type), `fixture no longer parses to ${type}`).toBe(true);
      const declared = declaredFor(doc);
      const detected = detectBodyRequirements(bodyFor(doc));
      const rescued = [...detected].filter((id) => !declared.has(id));
      expect(
        rescued,
        `${type} emits package-bound bytes its emit-site never declared: ${rescued.join(", ")}`,
      ).toEqual([]);
    });
  }

  for (const [type, host] of Object.entries(NESTED_IN)) {
    it(`nested ${type} really appears inside the ${host} fixture`, () => {
      const fx = NODE_FIXTURES[host];
      const doc = parseLatex(tex(fx.body, fx.packages ?? BARE, fx.preambleExtra ?? ""));
      expect(typesIn(doc).has(type)).toBe(true);
    });
  }

  for (const [type, fx] of Object.entries(MARK_FIXTURES)) {
    if ("exempt" in fx) continue;
    it(`mark ${type}: the fixture produces it, and its wrapper bytes are declared`, () => {
      const doc = parseLatex(tex(fx.body, BARE));
      assignUuids(doc);
      expect(markTypesIn(doc).has(type), `fixture no longer parses to mark ${type}`).toBe(true);
      const declared = declaredFor(doc);
      const detected = detectBodyRequirements(bodyFor(doc));
      expect([...detected].filter((id) => !declared.has(id))).toEqual([]);
    });
  }

  it("the linguex fixture is DECLARED from the node model, not rescued by the detector", () => {
    // The pre-543 shape: the arm emitted `\ex.` and declared nothing, so the
    // only way `linguex` could ever reach `required` was the fallback — which
    // is exactly what this suite's rule forbids for a MODELED construct.
    const doc = parseLatex(tex("\\ex. Susan left.\n\\a. One.\n\\b. Two.", LINGUEX));
    assignUuids(doc);
    const blocks = walk(doc).filter((n) => n.type === "exampleBlock");
    expect(blocks).toHaveLength(1);
    expect(exampleDialectOf(blocks[0].attrs)).toBe("linguex");
    const declared = declaredFor(doc);
    expect(declared.has("linguex")).toBe(true);
    expect(declared.has("expex")).toBe(false);
  });

  it("per block: a linguex exampleBlock declares linguex and not expex; an expex one the reverse", () => {
    const block = (dialect: string): JSONContent => ({
      type: "exampleBlock",
      attrs: { uuid: "ab12", kind: "single", dialect },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Susan left." }] },
      ],
    });
    expect([...serializeTopLevelBlock(block("linguex")).requirementIds]).toEqual(["linguex"]);
    expect([...serializeTopLevelBlock(block("expex")).requirementIds]).toEqual(["expex"]);
  });
});

// ── 2 · the two vocabularies agree ────────────────────────────────────────────

describe("2 · every detector row has an inject line, every declared id is a registry id", () => {
  const registryIds = new Set(LATEX_REQUIREMENTS.map((r) => r.id));

  it("every PACKAGE_DETECTORS id is a LATEX_REQUIREMENTS id", () => {
    // A detector row with no inject line detects and then injects NOTHING —
    // the row is dead and reads as coverage.
    const orphans = PACKAGE_DETECTORS.map((d) => d.id).filter((id) => !registryIds.has(id));
    expect(orphans).toEqual([]);
  });

  it("every `need(\"…\")` the serializer spells is a LATEX_REQUIREMENTS id", () => {
    const code = codeOnly(
      fs.readFileSync(path.join(ROOT, "src/lib/latex-serializer.ts"), "utf8"),
    );
    // `codeOnly` blanks string literals, so read the raw file for the names
    // and the stripped one only to confirm the call sites are code.
    const raw = fs.readFileSync(path.join(ROOT, "src/lib/latex-serializer.ts"), "utf8");
    const needed = [...raw.matchAll(/\bneed\("([a-z]+)"\)/g)].map((m) => m[1]);
    expect(needed.length).toBeGreaterThan(5);
    expect(code).toContain("need(");
    const unregistered = [...new Set(needed)].filter((id) => !registryIds.has(id));
    expect(unregistered).toEqual([]);
    // …and the two dialects are both among them (the linguex arm's declaration
    // is what task 543 added; the expex one is the P4 baseline).
    expect(needed).toContain("linguex");
    expect(needed).toContain("expex");
  });

  it("the linguex DETECTOR agrees with the opener SSOT about `\\ex.`", () => {
    // The twin of the expex leg in linguex-dialect-roundtrip.test.ts: the
    // detector is a hand-spelled regex in a leaf that cannot import the lexer.
    const row = PACKAGE_DETECTORS.find((d) => d.id === "linguex");
    expect(row).toBeDefined();
    for (const probe of ["\\ex. x", "\\ex.\\a. x", "\\ex.\n\\a. One."]) {
      expect(row!.re.test(probe), probe).toBe(true);
      expect(matchLinguexOpenerAt(probe, 0), probe).not.toBeNull();
    }
    for (const probe of ["\\ex x", "\\pex x", "\\example. x", "\\exam. x", "\\exs. x"]) {
      expect(row!.re.test(probe), probe).toBe(false);
      expect(matchLinguexOpenerAt(probe, 0), probe).toBeNull();
    }
    // The unmodelled linguex variants are NOT openers this build models, but
    // they are linguex bytes that need the package to compile — the detector
    // claims them and the opener (correctly) declines them.
    for (const probe of ["\\exg. x", "\\exi. x", "\\exr. x"]) {
      expect(row!.re.test(probe), probe).toBe(true);
      expect(matchLinguexOpenerAt(probe, 0), probe).toBeNull();
    }
  });

  it("the example family: both DIALECTS are members with inject lines; gb4e is loaded-only", () => {
    const dialects = EXAMPLE_PACKAGE_FAMILY.map(asExampleDialect).filter((d) => d !== null);
    expect(dialects.sort()).toEqual(["expex", "linguex"]);
    for (const d of dialects) expect(registryIds.has(d!), d!).toBe(true);
    // gb4e owns `\ex` in the papers that load it, and Virgil never emits its
    // syntax — a member the exclusion rule reads and the injector never writes.
    expect(EXAMPLE_PACKAGE_FAMILY).toContain("gb4e");
    expect(registryIds.has("gb4e")).toBe(false);
  });

  it("census: the widened callback is the ONE conflict channel — no production file spells the retired name", () => {
    // A renamed callback left half-wired is a warning that fires nowhere. Both
    // silos, comments stripped.
    const offenders: string[] = [];
    const sweep = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === "node_modules" || e.name === "__tests__") continue;
          sweep(p);
        } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          if (/onBibFamilyConflict/.test(codeOnly(fs.readFileSync(p, "utf8")))) {
            offenders.push(path.relative(ROOT, p));
          }
        }
      }
    };
    for (const r of ["src", "library"]) sweep(path.join(ROOT, r));
    expect(offenders).toEqual([]);
    // …and the shell's handler answers BOTH families (a `family` switch), so
    // the example half cannot ship as a bib-shaped notice.
    const shell = codeOnly(
      fs.readFileSync(path.join(ROOT, "src/components/EditorLayout.tsx"), "utf8"),
    );
    expect(shell).toContain("handleRequirementConflict");
    expect(shell).toMatch(/conflict\.family\s*===/);
  });
});

// ── 3 · the example-package family: exactly one member may be loaded ─────────

describe("3 · the example family through the REAL save pipeline", () => {
  const LINGUEX_BODY = "\\ex. Susan left.\n\\a. One.\n\\b. Two.";
  const EXPEX_BODY = "\\ex Susan left.\\xe";
  const GB4E_BODY = "\\begin{exe}\n\\ex Susan left.\n\\ex Bill stayed.\n\\end{exe}";

  function conflictsOf(src: string): { out: string; conflicts: RequirementConflict[] } {
    const conflicts: RequirementConflict[] = [];
    const out = save(src, (c) => conflicts.push(c));
    return { out, conflicts };
  }

  it("the PASTE case — linguex bytes, no example package: linguex is injected once, idempotently, and the next open MODELS it", () => {
    const src = tex(LINGUEX_BODY, BARE);
    const { out: c1, conflicts } = conflictsOf(src);
    expect(usepackageCount(c1, "linguex")).toBe(1);
    expect(usepackageCount(c1, "expex")).toBe(0);
    expect(conflicts).toEqual([]);
    // Cycle 1 carried the example raw (the parse asked the preamble BEFORE the
    // injection landed) and the injection is the only change. Cycle 2 is the
    // first parse that finds the live package: it MODELS the example and mints
    // its `\vexid` / `\vxid` markers — the one-time canonicalization every
    // modelled construct performs — and cycle 3 is the fixed point. Measured:
    // the cycle-2 diff is exactly the markers, the bytes of every line survive.
    const blocks = walk(parseLatex(c1)).filter((n) => n.type === "exampleBlock");
    expect(blocks).toHaveLength(1);
    expect(exampleDialectOf(blocks[0].attrs)).toBe("linguex");
    const c2 = save(c1);
    expect(usepackageCount(c2, "linguex")).toBe(1);
    expect(usepackageCount(c2, "expex")).toBe(0);
    for (const line of ["\\ex. Susan left.", "\\a. One.", "\\b. Two."]) {
      expect(c2).toContain(line);
    }
    expect(c2).toContain("\\vexid{");
    expect(save(c2)).toBe(c2);
  });

  it("linguex bytes under an EXPEX preamble: never injected beside it, surfaced as a conflict", () => {
    const { out, conflicts } = conflictsOf(tex(LINGUEX_BODY, EXPEX));
    expect(usepackageCount(out, "linguex")).toBe(0);
    expect(usepackageCount(out, "expex")).toBe(1);
    expect(conflicts).toEqual([
      { family: "example", declared: "linguex", preambleHas: "expex" },
    ]);
  });

  it("linguex bytes under a GB4E preamble: never injected, surfaced", () => {
    const { out, conflicts } = conflictsOf(tex(LINGUEX_BODY, GB4E));
    expect(usepackageCount(out, "linguex")).toBe(0);
    expect(usepackageCount(out, "expex")).toBe(0);
    expect(conflicts).toEqual([
      { family: "example", declared: "linguex", preambleHas: "gb4e" },
    ]);
  });

  it("an expex example under a LINGUEX-only preamble: expex is NOT injected over it (the pre-543 defect), surfaced", () => {
    const { out, conflicts } = conflictsOf(tex(EXPEX_BODY, LINGUEX));
    expect(usepackageCount(out, "expex")).toBe(0);
    expect(usepackageCount(out, "linguex")).toBe(1);
    expect(conflicts).toEqual([
      { family: "example", declared: "expex", preambleHas: "linguex" },
    ]);
    // Bytes untouched either way: warn, never rewrite.
    expect(out).toContain("\\ex");
    expect(out).toContain("\\xe");
  });

  it("a GB4E paper's carried `\\ex` never injects expex (the pre-543 defect on five real preambles)", () => {
    // Measured on the pre-543 tree: `\usepackage{expex}` landed after
    // `\usepackage{gb4e}`, and both define `\ex`.
    const { out: c1, conflicts } = conflictsOf(tex(GB4E_BODY, GB4E));
    expect(usepackageCount(c1, "expex")).toBe(0);
    expect(usepackageCount(c1, "linguex")).toBe(0);
    expect(usepackageCount(c1, "gb4e")).toBe(1);
    expect(conflicts).toEqual([
      { family: "example", declared: "expex", preambleHas: "gb4e" },
    ]);
    expect(save(c1)).toBe(c1);
    // The body is carried whole — task 342's rule, unchanged.
    expect(c1).toContain("\\begin{exe}\n\\ex Susan left.\n\\ex Bill stayed.\n\\end{exe}");
  });

  it("BOTH loaded (Gabriel's own shape) with a mixed body: nothing injected, no conflict", () => {
    const { out, conflicts } = conflictsOf(
      tex(`${EXPEX_BODY}\n\n${LINGUEX_BODY}`, `${EXPEX}\n${LINGUEX}`),
    );
    expect(usepackageCount(out, "expex")).toBe(1);
    expect(usepackageCount(out, "linguex")).toBe(1);
    expect(conflicts).toEqual([]);
    expect(save(out)).toBe(out);
  });

  it("NEITHER loaded with a mixed body: expex (the baseline dialect) alone is injected, linguex surfaced", () => {
    const { out, conflicts } = conflictsOf(tex(`${EXPEX_BODY}\n\n${LINGUEX_BODY}`, BARE));
    expect(usepackageCount(out, "expex")).toBe(1);
    expect(usepackageCount(out, "linguex")).toBe(0);
    expect(conflicts).toEqual([
      { family: "example", declared: "linguex", preambleHas: "expex" },
    ]);
  });

  it("inert bytes inject nothing — a commented-out or verbatim-quoted `\\ex.`", () => {
    for (const body of [
      "% \\ex. Susan left.",
      "Explaining it:\n\\begin{verbatim}\n\\ex. Susan left.\n\\end{verbatim}",
    ]) {
      const { out, conflicts } = conflictsOf(tex(body, BARE));
      expect(usepackageCount(out, "linguex"), body).toBe(0);
      expect(usepackageCount(out, "expex"), body).toBe(0);
      expect(conflicts).toEqual([]);
    }
  });

  it("CONTROL — an expex example in a bare preamble still injects expex, once", () => {
    const { out, conflicts } = conflictsOf(tex(EXPEX_BODY, BARE));
    expect(usepackageCount(out, "expex")).toBe(1);
    expect(conflicts).toEqual([]);
    expect(save(out)).toBe(out);
  });

  it("the bib conflict still travels the same channel, discriminated by `family`", () => {
    let conflict: RequirementConflict | undefined;
    ensurePreambleRequirements(
      "\\documentclass{article}\n\\usepackage{natbib}\n\\begin{document}\n",
      new Set(["biblatex"]),
      { declaredBibFamily: "biblatex", onRequirementConflict: (c) => (conflict = c) },
    );
    expect(conflict).toEqual({ family: "bib", declared: "biblatex", preambleHas: "natbib" });
  });
});
