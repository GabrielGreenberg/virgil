/**
 * Task 342 — the UNMODELED-ENVIRONMENT branch, both halves of what it used to
 * drop: the block's IDENTITY and its BYTE-LITERALNESS.
 *
 * Every environment Virgil does not model (`align`, `equation`, `table`,
 * `tabular`, `center`, `abstract`, `theorem`, fancyvrb's `Verbatim`, `alltt`,
 * `comment`, …) falls to ONE `default:` branch in the parser. Pre-342 that
 * branch neither harvested the trailing `%!v:` anchor the serializer emits for
 * its own carrier node nor declared the body literal, so an `align` block grew
 * one stray `%!v:` line PER SAVE (unbounded), re-minted its uuid every save —
 * orphaning every card anchored to it, with no edit by the user — and a
 * `Verbatim` body reading `print("hi")` came back `print(``hi'')`, stable and
 * visibly wrong in the PDF.
 *
 * The shape of this suite is the point, and it is why the pre-fix tree was
 * green: **the accumulation is invisible to a single round trip** (cycle 1 looks
 * perfect), and every existing round-trip suite spells its fixtures with the
 * envs the code happens to model. So each leg here runs the REAL
 * `parseLatex` → `assignUuids` → `serializeBodyOnly` loop over ≥4 cycles, with
 * `itemize` (a modeled env) and `lstlisting` (a verbatim-family member) kept as
 * passing CONTROLS so no leg can pass vacuously.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly, assignUuids } from "@/lib/latex-serializer";
import { runSyntaxChecks } from "@/lib/syntax-check";
import { VERBATIM_ENVS_FULL, isVerbatimFamilyEnv } from "@/lib/latex-lexer";
import { commentsStripped } from "@/lib/__tests__/_source-scan";
import type { JSONContent } from "@tiptap/core";

const REPO = path.resolve(__dirname, "../../..");

/** One save/load cycle: parse the body, mint uuids, serialize it back. */
function cycle(body: string): { body: string; doc: JSONContent } {
  const doc = parseLatex(`\\begin{document}\n\n${body}\n\n\\end{document}\n`);
  assignUuids(doc);
  return { body: serializeBodyOnly(doc), doc };
}

/** Every `%!v:xxxx` anchor in a serialized body, in order. */
function anchors(tex: string): string[] {
  return [...tex.matchAll(/%!v:([0-9a-f]{4})/g)].map((m) => m[1]);
}

/** Top-level block count — the "did a phantom blank paragraph appear?" probe. */
function topLevelCount(doc: JSONContent): number {
  return doc.content?.length ?? 0;
}

/** Run N cycles, returning each cycle's serialized body. */
function cycles(body: string, n: number): { body: string; doc: JSONContent }[] {
  const out: { body: string; doc: JSONContent }[] = [];
  let cur = body;
  for (let i = 0; i < n; i++) {
    const r = cycle(cur);
    out.push(r);
    cur = r.body;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Leg 1 — IDENTITY: an unmodeled env is a FIXED POINT
// ---------------------------------------------------------------------------

/** Unmodeled envs, chosen to cover the argument spellings the parser sees:
 *  none, `[opt]`, `{arg}`, and a starred name. */
const UNMODELED: { name: string; body: string }[] = [
  { name: "align", body: "\\begin{align}\nx &= 1\n\\end{align}" },
  { name: "equation", body: "\\begin{equation}\nE = mc^2\n\\end{equation}" },
  { name: "table", body: "\\begin{table}[t]\n\\centering\nrows\n\\end{table}" },
  { name: "tabular", body: "\\begin{tabular}{ll}\na & b \\\\\n\\end{tabular}" },
  { name: "center", body: "\\begin{center}\ncentred\n\\end{center}" },
  { name: "abstract", body: "\\begin{abstract}\nA summary.\n\\end{abstract}" },
  { name: "theorem", body: "\\begin{theorem}\nIt holds.\n\\end{theorem}" },
  { name: "table*", body: "\\begin{table*}\nwide\n\\end{table*}" },
];

/** Controls: envs the pre-fix hand list already covered. Their behaviour must
 *  not move — these are the legs that would catch a fix that "works" by
 *  breaking the cases that were already right. */
const CONTROLS: { name: string; body: string }[] = [
  { name: "itemize", body: "\\begin{itemize}\n  \\item a\n\\end{itemize}" },
  { name: "enumerate", body: "\\begin{enumerate}\n  \\item a\n\\end{enumerate}" },
  { name: "quote", body: "\\begin{quote}\nquoted\n\\end{quote}" },
  {
    name: "lstlisting",
    body: "\\begin{lstlisting}[language=Python]\nx = 1\n\\end{lstlisting}",
  },
  { name: "verbatim", body: "\\begin{verbatim}\nraw\n\\end{verbatim}" },
];

describe("342 · identity — an unmodeled env reaches a fixed point", () => {
  for (const { name, body } of [...UNMODELED, ...CONTROLS]) {
    it(`${name}: 4 cycles are byte-identical from cycle 1, with a stable uuid`, () => {
      const runs = cycles(body, 4);

      // The defining leg. Pre-fix, `align` produced:
      //   1: \end{align} %!v:7a3c
      //   2: \end{align} %!v:3f63  +  %!v:7a3c
      //   3: \end{align} %!v:e770  +  %!v:3f63 + %!v:7a3c   … unbounded
      for (let i = 1; i < runs.length; i++) {
        expect(runs[i].body, `cycle ${i + 1} vs cycle 1`).toBe(runs[0].body);
      }

      // Identity: the block keeps the SAME uuid save to save. This is the half
      // that orphans cards — it is silent, and it needs no user edit.
      const first = anchors(runs[0].body);
      expect(first.length).toBeGreaterThan(0);
      for (let i = 1; i < runs.length; i++) {
        expect(anchors(runs[i].body), `uuids at cycle ${i + 1}`).toEqual(first);
      }

      // …and no phantom blank paragraph accretes from an orphaned anchor line.
      const blocks = topLevelCount(runs[0].doc);
      for (let i = 1; i < runs.length; i++) {
        expect(topLevelCount(runs[i].doc), `block count at cycle ${i + 1}`).toBe(
          blocks,
        );
      }
    });
  }

  it("an unmodeled env keeps its uuid even beside modeled neighbours", () => {
    // Interleaved, because the harvest is positional: an anchor left in the
    // stream is re-read as a standalone paragraph, which would shift every
    // block after it.
    const body = [
      "Before. %!v:1111",
      "",
      "\\begin{align}\ny &= 2\n\\end{align} %!v:2222",
      "",
      "\\begin{itemize}\n  \\item a %!v:3333\n\\end{itemize} %!v:4444",
      "",
      "After. %!v:5555",
    ].join("\n");

    const runs = cycles(body, 4);
    expect(anchors(runs[0].body)).toEqual([
      "1111",
      "2222",
      "3333",
      "4444",
      "5555",
    ]);
    for (const r of runs) expect(r.body).toBe(runs[0].body);
    for (const r of runs) expect(topLevelCount(r.doc)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Leg 2 — BYTE-LITERALNESS: an unmodeled body is carried, never rewritten
// ---------------------------------------------------------------------------

/** The typographic reverse-map's two triggers: a straight `"` (→ ``/'') and a
 *  `--` (→ en dash). Inside carried source both must survive untouched. */
const HOSTILE_BODY = 'print("hi") -- ok; 3 < 4 & x^2';

describe("342 · byte-literalness — a carried env body survives verbatim", () => {
  const carried = [
    "Verbatim", // fancyvrb; the commonest after bare `verbatim`
    "alltt",
    "comment",
    "align", // not verbatim at all — carried because unmodeled
    "tabular",
    "lstlisting", // CONTROL: was already clean pre-fix
  ];

  for (const env of carried) {
    it(`${env}: quotes and dashes are untouched, and stay so across 4 cycles`, () => {
      const body = `\\begin{${env}}\n${HOSTILE_BODY}\n\\end{${env}}`;
      const runs = cycles(body, 4);

      for (const [i, r] of runs.entries()) {
        expect(r.body, `cycle ${i + 1}`).toContain(HOSTILE_BODY);
        // The specific pre-fix corruption, named so a regression reads clearly.
        expect(r.body, `cycle ${i + 1}`).not.toContain("``hi''");
      }
      for (const r of runs) expect(r.body).toBe(runs[0].body);
    });
  }

  it("the carrier declares the verbatim mark and carries the uuid", () => {
    // The mark is what makes the bytes safe, and the uuid is what makes the
    // identity survive — asserted on the NODE, since a text-level assertion
    // cannot distinguish "marked literal" from "happened not to be rewritten".
    const doc = parseLatex(
      "\\begin{document}\n\n\\begin{align}\nx\n\\end{align} %!v:abcd\n\n\\end{document}\n",
    );
    const block = doc.content?.[0];
    expect(block?.type).toBe("paragraph");
    expect(block?.attrs?.uuid).toBe("abcd");
    expect(block?.content?.[0]?.marks?.map((m) => m.type)).toEqual([
      "latexVerbatim",
    ]);
  });

  it("blank runs inside a carried env are preserved; a generated env is untouched", () => {
    // The third symptom of the same class, found by measurement: the
    // whole-document `\n{3,}` collapse stashed only the verbatim FAMILY, so
    // every env nobody had named lost its interior blank runs on the first save
    // — `align` measured with a 3-blank-line gap came back with one.
    for (const env of ["align", "tabular", "Verbatim", "lstlisting"]) {
      const body = `\\begin{${env}}\na\n\n\n\nb\n\\end{${env}}`;
      const runs = cycles(body, 4);
      expect(runs[0].body, env).toContain("a\n\n\n\nb");
      for (const r of runs) expect(r.body, env).toBe(runs[0].body);
    }

    // …and the collapse still does its job on generated output: a modeled env's
    // bytes come from the serializer, so it is entitled to tidy them.
    const generated = cycle("\\begin{itemize}\n  \\item a\n\\end{itemize}").body;
    expect(generated).not.toMatch(/\n{3,}/);
  });
});

// ---------------------------------------------------------------------------
// Leg 3 — the SSOT fork: syntax-check reads the lexer's family
// ---------------------------------------------------------------------------

describe("342 · the verbatim family is ONE list", () => {
  it("the SSOT carries the members the linter already knew", () => {
    // Pre-fix, `syntax-check.ts` had six members and the module calling itself
    // the lexical SSOT had four — and the SSOT was the SHORTER list, and the one
    // the round trip read.
    for (const env of ["verbatim", "verbatim*", "lstlisting", "minted"]) {
      expect(isVerbatimFamilyEnv(env), env).toBe(true);
    }
    for (const env of ["Verbatim", "comment"]) {
      expect(isVerbatimFamilyEnv(env), `${env} (was linter-only)`).toBe(true);
    }
    // `alltt` looks verbatim and isn't — `\`, `{` and `}` keep their meanings,
    // so its refs are real refs and its braces are real braces. Its BYTES are
    // still safe (leg 2), which is the whole point of the default being literal.
    expect(isVerbatimFamilyEnv("alltt")).toBe(false);
    expect(isVerbatimFamilyEnv("align")).toBe(false);
  });

  it("the linter skips every family member's body", () => {
    for (const env of VERBATIM_ENVS_FULL) {
      // A body that is a minefield for every check the linter runs.
      const src = [
        "\\documentclass{article}",
        "\\begin{document}",
        `\\begin{${env}}`,
        "unbalanced { brace, a lone $ and \\ref{nowhere}",
        `\\end{${env}}`,
        "\\end{document}",
      ].join("\n");
      expect(runSyntaxChecks(src), env).toEqual([]);
    }
  });

  it("census: only the lexer spells a verbatim-family member in code", () => {
    // The leg with teeth. The family list was never the part that could
    // misbehave — a second copy of it beside the SSOT is, and that is exactly
    // what shipped. Literals are KEPT and only comments stripped: the drift
    // lives in quoted arrays and Set literals.
    const hits = censusFiles()
      .filter((rel) => rel !== "src/lib/latex-lexer.ts")
      .filter((rel) =>
        /(?<![A-Za-z])lstlisting(?![A-Za-z])/.test(
          commentsStripped(fs.readFileSync(path.join(REPO, rel), "utf8")),
        ),
      );
    expect(hits).toEqual([]);
  });

  it("census self-check: the needle CAN see a real spelling", () => {
    // A canary must not stand on the defect, so it runs on a fixture rather
    // than on a production line the census exists to drain.
    const fixture = 'const ENVS = new Set(["verbatim", "lstlisting"]); // x';
    expect(/(?<![A-Za-z])lstlisting(?![A-Za-z])/.test(commentsStripped(fixture))).toBe(
      true,
    );
    // …and cannot see one that is only prose.
    const prose = "// lstlisting bodies are literal\nconst x = 1;";
    expect(/(?<![A-Za-z])lstlisting(?![A-Za-z])/.test(commentsStripped(prose))).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Leg 4 — the collapse's stash set is DERIVED, not hand-listed
// ---------------------------------------------------------------------------

const SERIALIZER = "src/lib/latex-serializer.ts";

/** The serializer's own `SERIALIZER_GENERATED_ENVS`, read from its source.
 *  DISCOVERED rather than re-listed here: a hand list inside the guard that
 *  outlaws hand lists would sit green while the real one drifted. */
function generatedEnvsFromSource(): string[] {
  // Comments stripped, literals kept: the declaration's per-member trailing
  // comments name the switch CASES (`// case "blockquote"`), which are quoted
  // strings and would otherwise be read as members.
  const src = commentsStripped(
    fs.readFileSync(path.join(REPO, SERIALIZER), "utf8"),
  );
  const m = src.match(/const SERIALIZER_GENERATED_ENVS = \[([\s\S]*?)\] as const;/);
  expect(m, "SERIALIZER_GENERATED_ENVS declaration").toBeTruthy();
  return [...m![1].matchAll(/"([^"]+)"/g)].map((h) => h[1]);
}

describe("342 · the blank-run collapse touches only GENERATED envs", () => {
  it("census: every literal `\\begin{env}` the serializer emits is declared", () => {
    // A new `\begin{X}` emit that nobody declares would have its region stashed
    // — preserving blank runs the collapse exists to clean. `document` is the
    // preamble marker, not a body env.
    const declared = new Set([...generatedEnvsFromSource(), "document"]);
    const src = commentsStripped(fs.readFileSync(path.join(REPO, SERIALIZER), "utf8"));
    // The emit form is a template literal, so the source spells TWO backslashes
    // (`\\begin{quote}`). A `${…}` name is not a literal and is not censused —
    // the figure emit is covered by the behavioural leg below instead.
    const emitted = [...src.matchAll(/\\\\begin\{([A-Za-z]+\*?)\}/g)].map(
      (m) => m[1],
    );
    // Vacuity floor: the needle must actually see the emit sites it governs.
    expect(new Set(emitted)).toContain("quote");
    expect(new Set(emitted)).toContain("itemize");
    const undeclared = [...new Set(emitted)].filter((e) => !declared.has(e));
    expect(undeclared).toEqual([]);
  });

  it("every declared member really is a GENERATED env, not a carried one", () => {
    // The direction with the teeth: a STALE member (an env the parser no longer
    // models, or never did) would have its user-written bytes collapsed — the
    // corruption this task closed. `xlist` is generated inside an expex example
    // and never reaches the top-level env dispatcher, so it is probed there.
    for (const env of generatedEnvsFromSource()) {
      if (env === "xlist") {
        // The opener is `\ex`, NOT `\ex.` — this fixture spelled the latter
        // until task 350, where `\ex.` became linguex's opener and is carried
        // as raw content rather than claimed as an expex example. The period
        // was incidental scaffolding (it was never part of what this leg
        // asserts, which is that `xlist` is a GENERATED env), so removing it
        // preserves the assertion exactly. That it was written by accident at
        // all is a small piece of evidence FOR the strict rule: the linguex
        // form is easy to type when you mean expex.
        const doc = parseLatex(
          "\\begin{document}\n\n\\ex\nleaf\n\\begin{xlist}\n\\a inner\n\\end{xlist}\n\\xe\n\n\\end{document}\n",
        );
        expect(doc.content?.[0]?.type, env).toBe("exampleBlock");
        continue;
      }
      const doc = parseLatex(
        `\\begin{document}\n\n\\begin{${env}}\nbody\n\\end{${env}}\n\n\\end{document}\n`,
      );
      const block = doc.content?.[0];
      // A carried env is a paragraph whose single text child wears the verbatim
      // mark; a generated one is anything else.
      const isCarrier =
        block?.type === "paragraph" &&
        !!block.content?.[0]?.marks?.some((m) => m.type === "latexVerbatim");
      expect(isCarrier, `${env} must not be a byte-literal carrier`).toBe(false);
    }
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "__tests__") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

function censusFiles(): string[] {
  const files: string[] = [];
  for (const silo of ["src", "library"]) {
    const root = path.join(REPO, silo);
    if (fs.existsSync(root)) walk(root, files);
  }
  return files.map((f) => path.relative(REPO, f)).sort();
}
