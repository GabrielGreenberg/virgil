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

/** The ONE place the family vocabulary may be spelled (task 358). */
const LEXER = "src/lib/latex-lexer.ts";

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

  // -------------------------------------------------------------------------
  // Task 358 — the census is DERIVED from the vocabulary, not hand-picked.
  //
  // 342's census watched ONE member (`lstlisting`), which is a hand list
  // wearing a regex's clothes: adding a member to the SSOT did not extend the
  // guard, so the five names 358 was filed about (fancyvrb's `Verbatim`
  // family, `comment`) joined the list with the census still blind to a fork
  // that spelled any of them. Every needle below is built FROM
  // `VERBATIM_ENVS_FULL`, so a future member is censused by declaration alone.
  //
  // Three shapes, because a fork can be any of them and each drains to EMPTY
  // on the current tree (measured — no allowlist for the first two):
  //   A. a second COPY of the list — ≥2 distinct members near each other;
  //   B. a hand-spelled family ENV — `\begin{<member>}` / `\end{<member>}`;
  //   C. a per-member special CASE — the member as a bare quoted literal.
  // -------------------------------------------------------------------------

  /** Source of a censused file, comments stripped and literals KEPT: the drift
   *  lives in quoted arrays, Set literals and regexes, while a member NAMED in
   *  prose (this file's neighbours are full of it) is not a decision. */
  const codeCache = new Map<string, string>();
  const codeOf = (rel: string) => {
    let hit = codeCache.get(rel);
    if (hit === undefined) {
      hit = commentsStripped(fs.readFileSync(path.join(REPO, rel), "utf8"));
      codeCache.set(rel, hit);
    }
    return hit;
  };

  /** Every leg wants the same file as LINES. Split once, not once per leg. */
  const linesCache = new Map<string, string[]>();
  const linesOf = (rel: string) => {
    let hit = linesCache.get(rel);
    if (hit === undefined) {
      hit = codeOf(rel).split("\n");
      linesCache.set(rel, hit);
    }
    return hit;
  };

  const CENSUSED = () => censusFiles().filter((rel) => rel !== LEXER);

  /** The member as a WORD. `verbatim*` must not be matched by the `verbatim`
   *  needle (or every starred member would double-count as two), so the
   *  trailing guard excludes `*` as well as letters. */
  const needleCache = new Map<string, RegExp>();
  const wordNeedle = (member: string) => {
    let hit = needleCache.get(member);
    if (hit === undefined) {
      // No `g` flag, so `.test()` keeps no `lastIndex` state and one shared
      // instance behaves exactly as a fresh one per call did.
      hit = new RegExp(`(?<![A-Za-z])${member.replace("*", "\\*")}(?![A-Za-z*])`);
      needleCache.set(member, hit);
    }
    return hit;
  };

  /** Members named on ONE line. The window below slides by one, so testing per
   *  WINDOW position re-tested every line against every member `WINDOW` times;
   *  answering per LINE once and unioning is the same answer for a quarter of
   *  the regex work. */
  const membersOnLine = (line: string) => {
    const found: string[] = [];
    for (const m of VERBATIM_ENVS_FULL) if (wordNeedle(m).test(line)) found.push(m);
    return found;
  };

  /** Members named within a window of consecutive lines. */
  function membersInWindow(perLine: string[][], from: number, size: number) {
    const seen = new Set<string>();
    for (let i = from; i < Math.min(perLine.length, from + size); i++) {
      for (const m of perLine[i]) seen.add(m);
    }
    return seen;
  }

  const WINDOW = 4;

  it("census A: no layer re-enumerates the family (≥2 members in a window)", () => {
    // The shape the original defect had: `syntax-check.ts` carried its own
    // six-name list beside the SSOT's four. A single member's name can be an
    // ordinary word (`comment` is a revision/cutter record kind, `minted` is a
    // local in the drop controller), so ONE occurrence proves nothing — two
    // distinct members within four lines is what a copy of the list looks
    // like, whatever its brackets. Measured on this tree: zero hits outside
    // the lexer, so there is no allowlist to drift.
    const hits: string[] = [];
    for (const rel of CENSUSED()) {
      const lines = linesOf(rel);
      const perLine = lines.map(membersOnLine);
      for (let i = 0; i < lines.length; i++) {
        const found = membersInWindow(perLine, i, WINDOW);
        if (found.size >= 2) {
          hits.push(`${rel}:${i + 1} {${[...found].join(", ")}}`);
          i += WINDOW - 1;
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("census B: no layer hand-spells a family environment", () => {
    // The single-member fork: a private `\begin{lstlisting}` skip, a
    // `/\\end\{Verbatim\}/` terminator. Membership decides first-close-wins
    // end-finding and inertness to every projecting scanner, so a layer that
    // writes the delimiter itself has decided both privately. The lexer's own
    // `verbatim` body↔tex pair (`escapeVerbatimBody`) is the SSOT half and is
    // excluded with every other lexer line.
    const hits: string[] = [];
    for (const rel of CENSUSED()) {
      const lines = linesOf(rel);
      lines.forEach((line, i) => {
        for (const m of VERBATIM_ENVS_FULL) {
          // Source spells the backslash escaped (`"\\begin{…}"`) or
          // double-escaped inside a regex literal; the name may carry a
          // regex-escaped `*`.
          const re = new RegExp(
            `\\\\+(?:begin|end)\\\\*\\{${m.replace("*", "\\\\*")}[\\\\]*\\}`,
          );
          if (re.test(line)) hits.push(`${rel}:${i + 1} [${m}]`);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  /** Census C's two exemptions, each scoped to the shape it justifies rather
   *  than to a file (a file-scoped entry would excuse the next decision added
   *  beside it). Keyed by a source FRAGMENT, since line numbers rot. */
  const PERMITTED_MEMBER_LITERALS: ReadonlyArray<{
    file: string;
    fragment: string;
    why: string;
  }> = [
    {
      file: "src/lib/latex-parser.ts",
      fragment: 'case "verbatim": {',
      why: "bare `verbatim` is the ONE member with a modeled node (codeBlock); the branch reads the SSOT for family membership and spells the name only to pick that node",
    },
  ];

  /** `comment` is exempt as a NAME, and the premise is checked below rather
   *  than asserted: it collides with an unrelated declared vocabulary — the
   *  revision/cutter record kind `{ kind: "comment" }` — which spells the bare
   *  literal ~77 times and decides a CARD kind, never an environment. Census A
   *  still covers it (a copy of the family list naming `comment` also names a
   *  second member) and census B covers `\begin{comment}`. */
  const LITERAL_CENSUS_EXEMPT_NAME = "comment";

  it("census C: no layer special-cases one member by name", () => {
    // Stated limit, since C is the leg that replaced 342's bare-word needle:
    // it sees QUOTED spellings, so a bare `lstlisting` identifier — a variable
    // name, not a family decision — is no longer flagged. A and B cover the two
    // shapes that decide anything.
    const hits: string[] = [];
    for (const rel of CENSUSED()) {
      const lines = linesOf(rel);
      lines.forEach((line, i) => {
        for (const m of VERBATIM_ENVS_FULL) {
          if (m === LITERAL_CENSUS_EXEMPT_NAME) continue;
          if (!new RegExp(`["'\`]${m.replace("*", "\\*")}["'\`]`).test(line)) continue;
          const permitted = PERMITTED_MEMBER_LITERALS.some(
            (e) => e.file === rel && line.includes(e.fragment),
          );
          if (!permitted) hits.push(`${rel}:${i + 1} ["${m}"] ${line.trim()}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  it("census C's name exemption stands on a CHECKED premise", () => {
    // The card vocabulary really does own the bare word — so the exemption is
    // a fact about a collision, not a way around the guard. If the record kind
    // is ever renamed, the exemption must go with it.
    const cardTypes = codeOf("src/lib/types.ts");
    expect(cardTypes).toMatch(/kind:\s*"comment";/);
    expect(VERBATIM_ENVS_FULL).toContain(LITERAL_CENSUS_EXEMPT_NAME);
  });

  it("census self-check: each needle CAN see a real spelling, and prose CANNOT", () => {
    // A canary must not stand on the defect, so all three run on fixtures
    // rather than on the production lines the censuses exist to drain — and
    // each is driven FROM the vocabulary, so a needle that stops matching its
    // own member fails here before it can silently exonerate the tree.
    for (const m of VERBATIM_ENVS_FULL) {
      const other = VERBATIM_ENVS_FULL.find((x) => x !== m)!;
      const copy = commentsStripped(
        `const ENVS = new Set(["${m}", "${other}"]); // x`,
      );
      expect(
        membersInWindow(copy.split("\n").map(membersOnLine), 0, WINDOW).size,
        m,
      ).toBeGreaterThanOrEqual(2);
      expect(wordNeedle(m).test(commentsStripped(`const x = "${m}";`)), m).toBe(true);
      expect(
        wordNeedle(m).test(commentsStripped(`// ${m} bodies are literal\nconst x = 1;`)),
        `${m} in prose`,
      ).toBe(false);
    }
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
      // The list envs need a real `\item`: since task 356 a list body with
      // CONTENT but no item is refused by `parseList` and carried whole, because
      // Virgil's list model IS its items. The pre-356 fixture spelled a bare
      // `body` here and passed only because that body was DESTROYED (parsed to
      // one empty `listItem`) — i.e. it pinned the very defect 356 closed. What
      // this leg asserts is unchanged: `itemize`/`enumerate` are GENERATED env
      // names, not carried ones.
      const body =
        env === "itemize" || env === "enumerate" ? "\\item body" : "body";
      const doc = parseLatex(
        `\\begin{document}\n\n\\begin{${env}}\n${body}\n\\end{${env}}\n\n\\end{document}\n`,
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

/** Memoized: the walk is a full recursive `readdirSync` over both silos, and
 *  the three census legs below each asked for it. One walk per run, not three
 *  — the answer cannot change mid-suite. */
let censusFilesCache: string[] | null = null;

function censusFiles(): string[] {
  if (censusFilesCache) return censusFilesCache;
  const files: string[] = [];
  for (const silo of ["src", "library"]) {
    const root = path.join(REPO, silo);
    if (fs.existsSync(root)) walk(root, files);
  }
  return (censusFilesCache = files.map((f) => path.relative(REPO, f)).sort());
}
