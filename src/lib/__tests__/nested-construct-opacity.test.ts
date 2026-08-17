import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseLatex } from "@/lib/latex-parser";
import { serializeBodyOnly } from "@/lib/latex-serializer";
import {
  findMatchingEnv,
  findMatchingGloss,
  findMatchingXe,
  matchBeginEnvAt,
  skipOpaqueConstructAt,
  VERBATIM_ENVS_FULL,
} from "@/lib/latex-lexer";
import { strip } from "@/lib/__tests__/_source-scan";

/**
 * Task 338 — **one nesting vocabulary.** Every body scan that walks past
 * nested constructs asks the SAME question ("does an opaque construct start
 * here?") and reads the SAME answer, `skipOpaqueConstructAt`, whose membership
 * is derived from the LaTeX grammar (anything with a `\begin`) rather than
 * hand-listed per call site.
 *
 * Before this, four scanners carried four private, incomplete answers at three
 * different awareness levels. `splitListItems` was opaque to exactly TWO
 * environments — literal `\begin{itemize}` and `\begin{enumerate}` — so an
 * `\item` at the head of a line inside ANY other nested environment split the
 * OUTER list: the nested env's body was hoisted out as sibling items, its
 * `\end{…}` was stranded in the prose as an unmatched token, and the resulting
 * `.tex` did not compile. On the first save, with no edit by the user, and
 * stable under a second round trip so nothing ever healed it. `splitPexBody`
 * knew three expex constructs and no `\begin{env}` at all, so a `verbatim`
 * body containing a literal `\a` split the example and its `\begin{verbatim}`
 * line was deleted outright.
 *
 * The round-trip legs are byte-identity legs on purpose: the produced BYTES
 * are the thing that must not move, and every one of them fails on the pre-fix
 * tree (measured by reverting the splitters, not assumed).
 */

const ROOT = path.resolve(__dirname, "../../..");

function roundTrip(body: string): string {
  const doc = parseLatex(
    `\\documentclass{article}\\begin{document}\n${body}\n\\end{document}`,
  );
  return serializeBodyOnly(doc as never).trim();
}

/** A round trip that must be BYTE-identical, and must stay so on a second
 *  pass — a corruption that is idempotent on its corrupted form is exactly
 *  what this class produces, so stability alone proves nothing. */
function expectStableIdentity(body: string) {
  const once = roundTrip(body);
  expect(once).toBe(body);
  expect(roundTrip(once)).toBe(body);
}

// The outer list's items carry the serializer's own two-space indent, so the
// fixtures are written in serializer-canonical form and byte-identity is a
// real assertion rather than an approximation.
const listWith = (nested: string) =>
  ["\\begin{itemize}", "  \\item outer", nested, "  \\item after", "\\end{itemize}"].join("\n");

describe("a nested construct inside a LIST ITEM survives the split (task 338)", () => {
  it("keeps a nested `description` whole — its `\\item`s stay inside it", () => {
    // Member 3, and the one that needs no unusual content at all: a
    // `description` list nested in an `itemize` is ordinary LaTeX. Pre-fix the
    // env collapsed to an empty `\begin{description}\end{description}` pair,
    // its two items became items of the OUTER list, and a bare
    // `\end{description}` was left behind in the prose.
    expectStableIdentity(
      listWith(
        [
          "\\begin{description}",
          "\\item[A] alpha",
          "\\item[B] beta",
          "\\end{description}",
        ].join("\n"),
      ),
    );
  });

  it("keeps a STARRED / third-party list env whole (`enumerate*`)", () => {
    // Member 4. `enumerate*` (enumitem/paralist) is not the literal string
    // `\begin{enumerate}`, so the two-entry hand list never matched it.
    expectStableIdentity(
      listWith(
        ["\\begin{enumerate*}", "\\item one", "\\item two", "\\end{enumerate*}"].join("\n"),
      ),
    );
    expectStableIdentity(
      listWith(["\\begin{itemize*}", "\\item one", "\\end{itemize*}"].join("\n")),
    );
  });

  it("keeps an env that takes an ARGUMENT whole (`minipage`)", () => {
    // Member 5 — the argument was preserved pre-fix while the body was emptied.
    expectStableIdentity(
      listWith(
        ["\\begin{minipage}{0.5\\textwidth}", "\\item weird", "\\end{minipage}"].join("\n"),
      ),
    );
  });

  it.each(VERBATIM_ENVS_FULL)(
    "keeps a `%s` code listing whose body contains a literal \\item",
    (env) => {
      // Members 1 and 2, swept over the vocab SSOT so a fifth family member is
      // covered by declaration. The stakes are higher here than for a prose
      // env: hoisting those lines moves the user's code OUT of a byte-literal
      // context into ordinary prose, where the next save runs the typographic
      // reverse-map over it (task 264's corruption, one layer down).
      expectStableIdentity(
        listWith(
          [`\\begin{${env}}`, "\\item literal", `\\end{${env}}`].join("\n"),
        ),
      );
    },
  );

  it("is opaque to an env nested TWO deep", () => {
    expectStableIdentity(
      listWith(
        [
          "\\begin{description}",
          "\\item[A] alpha",
          "\\begin{verbatim}",
          "\\item deep",
          "\\end{verbatim}",
          "\\end{description}",
        ].join("\n"),
      ),
    );
  });
});

describe("a nested construct inside an EXAMPLE ITEM survives the split (task 338)", () => {
  // `splitPexBody` splits on `\a`, so these fixtures put a literal `\a` inside
  // the nested construct. The serializer stamps the block/item id markers, so
  // these legs assert CONTENT preservation + stability rather than identity
  // with an unstamped input.
  function pexRoundTrip(nested: string): string {
    return roundTrip(["\\pex", "\\a first", nested, "\\xe"].join("\n"));
  }

  it("keeps a nested `\\begin{env}` whole, `\\a` line and all", () => {
    // Member 6. Pre-fix the example split on the inner `\a`, the
    // `\begin{description}` line was DELETED outright, and a bare
    // `\end{description}` was left in the item's prose.
    const out = pexRoundTrip(
      ["\\begin{description}", "\\a literal", "\\end{description}"].join("\n"),
    );
    expect(out).toContain(
      ["\\begin{description}", "\\a literal", "\\end{description}"].join("\n"),
    );
    expect(roundTrip(out)).toBe(out);
    // Exactly one item — the inner `\a` did not become a second one. (The
    // serializer emits `\a` only for real items; the one inside the verbatim
    // body is data.)
    expect(out.match(/\\vxid\{[0-9a-f]+\}/g) ?? []).toHaveLength(1);
  });

  it("keeps a nested `verbatim` — which the item's own filter used to DROP", () => {
    // The example-item schema has no `codeBlock` slot, so this block was
    // silently dropped by `parseExampleBodyAsBlocks` (pre-dating 338, and
    // reachable with or without an inner `\a`). It is preserved as the same
    // byte-literal CARRIER paragraph the other family members already got.
    for (const inner of ["\\a literal", "plain code"]) {
      const out = pexRoundTrip(
        ["\\begin{verbatim}", inner, "\\end{verbatim}"].join("\n"),
      );
      expect(out).toContain(
        ["\\begin{verbatim}", inner, "\\end{verbatim}"].join("\n"),
      );
      expect(roundTrip(out)).toBe(out);
    }
  });

  it("still slices a nested `\\begin{xlist}` into a child item list", () => {
    // Control: the xlist terminator moved from the deleted
    // `findMatchingXlistEnd` onto `findMatchingEnv`, so the nested tier must
    // still become real sub-items rather than prose.
    const out = pexRoundTrip(
      ["\\begin{xlist}", "\\a sub one", "\\a sub two", "\\end{xlist}"].join("\n"),
    );
    expect(out).toContain("\\begin{xlist}");
    expect(out).toContain("sub one");
    expect(out).toContain("sub two");
    expect(roundTrip(out)).toBe(out);
  });
});

describe("controls — the trigger is precise, not general list breakage", () => {
  it("still turns a nested itemize/enumerate into REAL nested list nodes", () => {
    const doc = parseLatex(
      [
        "\\documentclass{article}\\begin{document}",
        "\\begin{itemize}",
        "\\item outer",
        "\\begin{enumerate}",
        "\\item inner",
        "\\end{enumerate}",
        "\\end{itemize}",
        "\\end{document}",
      ].join("\n"),
    ) as never as { content: Array<Record<string, unknown>> };
    const list = doc.content.find((n) => n.type === "bulletList");
    expect(list).toBeTruthy();
    expect(JSON.stringify(list)).toContain('"orderedList"');
  });

  it("a `verbatim` in a list item with NO \\item inside is unchanged", () => {
    expectStableIdentity(
      listWith(["\\begin{verbatim}", "plain code", "\\end{verbatim}"].join("\n")),
    );
  });

  it("a `description` at TOP level is unchanged", () => {
    expectStableIdentity(
      ["\\begin{description}", "\\item[A] alpha", "\\end{description}"].join("\n"),
    );
  });
});

describe("one AWARENESS policy: a commented terminator is inert (member 7)", () => {
  it("a `% \\end{itemize}` does not close the list", () => {
    // Pre-fix `findMatchingEnd` was comment-BLIND while `findMatchingGloss`
    // was not, so the same `%`-commented token terminated one scanner and not
    // the other. Here the blind scan ended the list early, leaving `\item
    // after` and the REAL `\end{itemize}` outside it as loose prose.
    expectStableIdentity(
      [
        "\\begin{itemize}",
        "  \\item outer",
        "% \\end{itemize}",
        "  \\item after",
        "\\end{itemize}",
      ].join("\n"),
    );
  });

  it("an `\\end{itemize}` inside a nested verbatim listing does not close the list", () => {
    expectStableIdentity(
      listWith(
        ["\\begin{verbatim}", "\\end{itemize}", "\\end{verbatim}"].join("\n"),
      ),
    );
  });

  it("a MID-line `%` does not make a live `\\end{env}` inert", () => {
    // The narrowing this awareness policy needed, and the direction that is
    // NOT symmetric. Virgil's parser recognizes a comment only at the head of
    // a line — `See a%b` is one text node and `\url{…%20…}` one `latexCommand`
    // run, both preserved byte-for-byte — so reading TeX's any-unescaped-`%`
    // rule in the terminator scan is a layer disagreement whose only failure
    // direction is catastrophic: the live `\end{quote}` is called inert,
    // `findMatchingEnv` answers -1, and the parser's unterminated branch
    // swallows the rest of the document into the environment.
    //
    // The serializer emits `\end{env}` on the last content line, so the `%`
    // and the terminator SHARE a line after one save — which is what makes
    // this reachable from ordinary input rather than hand-written source.
    expectStableIdentity(
      ["\\begin{quote}", "See \\url{http://ex.com/a%20b}\\end{quote}"].join("\n"),
    );
    expect(
      findMatchingEnv("x \\url{a%b} \\end{quote} tail", 0, "quote"),
    ).toBe("x \\url{a%b} ".length);
  });

  it("never reaches a fixed point when a mid-line `%` is read as a comment", () => {
    // The defect leg for the case above, in the shape that makes it a DATA
    // LOSS rather than a formatting wobble: successive round trips ALTERNATE
    // between two texts, one of which has absorbed every following paragraph
    // into the quote. A single-generation assertion is not enough — the
    // swallowed generation is itself stable under one more pass.
    const body = [
      "\\begin{quote}",
      "See \\url{http://ex.com/a%20b}",
      "\\end{quote}",
      "",
      "SECOND PARAGRAPH.",
    ].join("\n");
    const gens: string[] = [];
    let cur = body;
    for (let i = 0; i < 4; i++) {
      cur = roundTrip(cur);
      gens.push(cur);
    }
    // Converged by the first generation, and every later one identical.
    expect(new Set(gens).size).toBe(1);
    // The paragraph after the quote is still OUTSIDE it.
    expect(gens[0]).toMatch(/\\end\{quote\}[\s\S]*SECOND PARAGRAPH\./);
    expect(gens[0]).not.toMatch(
      /begin\{quote\}[\s\S]*SECOND PARAGRAPH[\s\S]*end\{quote\}/,
    );
  });
});

describe("skipOpaqueConstructAt — the vocabulary itself", () => {
  it("answers -1 where no opaque construct opens", () => {
    expect(skipOpaqueConstructAt("plain \\item text", 0)).toBe(-1);
    expect(skipOpaqueConstructAt("plain \\item text", 6)).toBe(-1);
    expect(skipOpaqueConstructAt("\\end{itemize}", 0)).toBe(-1);
  });

  it("skips ANY `\\begin{env}` — membership is grammar-derived", () => {
    for (const env of ["description", "enumerate*", "minipage", "tabular", "align", "wibble"]) {
      const src = `\\begin{${env}}body\\end{${env}}TAIL`;
      expect(skipOpaqueConstructAt(src, 0)).toBe(src.indexOf("TAIL"));
    }
  });

  it("skips the two expex pairs and an inline \\verb run", () => {
    // Both expex pairs are control WORDS, so the tail must not begin with a
    // letter or `\endglx` / `\xetc` would falsely terminate — the boundary
    // rule the shared scan preserved from the two private matchers.
    const gl = "\\begingl\\gla x //\\endgl TAIL";
    expect(skipOpaqueConstructAt(gl, 0)).toBe(gl.indexOf(" TAIL"));
    const ex = "\\pex\\a one\\xe TAIL";
    expect(skipOpaqueConstructAt(ex, 0)).toBe(ex.indexOf(" TAIL"));
    const vb = "\\verb|\\end{itemize}|TAIL";
    expect(skipOpaqueConstructAt(vb, 0)).toBe(vb.indexOf("TAIL"));
  });

  it("an UNTERMINATED construct is TRANSPARENT — past the opening token only", () => {
    // The fail-soft direction, stated ONCE here so no caller re-decides it:
    // answering "to end of source" would collapse the rest of the document
    // into one node on mid-edit input — the failure mode task 243 exists to
    // prevent, arriving from the other side.
    const src = "\\begin{description}\\item a";
    expect(skipOpaqueConstructAt(src, 0)).toBe("\\begin{description}".length);
    expect(skipOpaqueConstructAt("\\begingl x", 0)).toBe("\\begingl".length);
    expect(skipOpaqueConstructAt("\\pex\\a x", 0)).toBe("\\pex".length);
  });

  it("answers an UNTERMINATED construct without recursing (300 of them)", () => {
    // The shared scan RECURSES through this vocabulary, so a fail-soft answer
    // leaves the enclosing scan to walk into the construct and meet the SAME
    // nested constructs again: for k unterminated `\begin{…}`s in one body that
    // is EXPONENTIAL. Measured on the fix's own first cut, before the
    // `hasTerminator` gate: 20 cost 245 ms and 100 did not finish.
    //
    // Deliberately NOT a wall-clock assertion (this file's own doctrine calls
    // one a flaky test in a guard's clothes) — the regression is orders of
    // magnitude, so an exponential scan simply cannot complete this leg. What
    // IS asserted is the CONTENT: mid-edit source with an unterminated
    // environment is ordinary input, and it must still parse fail-soft.
    const opens = Array.from({ length: 300 }, (_, i) => `\\begin{env${i}}`);
    const body = ["\\begin{itemize}", "\\item alpha", ...opens, "\\end{itemize}"].join("\n");
    const out = roundTrip(body);
    expect(out).toContain("alpha");
    expect(out).toContain("\\begin{env299}");
  });

  it("does not mis-lex a longer command as `\\ex`/`\\pex`/`\\begingl`", () => {
    expect(skipOpaqueConstructAt("\\extra{x}", 0)).toBe(-1);
    expect(skipOpaqueConstructAt("\\pexes x", 0)).toBe(-1);
    expect(skipOpaqueConstructAt("\\beginglx", 0)).toBe(-1);
  });
});

describe("the three terminators share the scan (task 338)", () => {
  it("findMatchingEnv still pairs same-name nesting and the verbatim family", () => {
    const nested = "\\begin{itemize}A\\begin{itemize}B\\end{itemize}C\\end{itemize}";
    expect(findMatchingEnv(nested, "\\begin{itemize}".length, "itemize")).toBe(
      nested.lastIndexOf("\\end{itemize}"),
    );
    const vb = "\\begin{verbatim}\\begin{verbatim}\\end{verbatim}";
    expect(findMatchingEnv(vb, "\\begin{verbatim}".length, "verbatim")).toBe(
      vb.indexOf("\\end{verbatim}"),
    );
    expect(findMatchingEnv("\\begin{itemize}A", "\\begin{itemize}".length, "itemize")).toBe(-1);
  });

  it("findMatchingGloss / findMatchingXe ignore a terminator inside a nested env", () => {
    const gl = "\\begingl\\begin{verbatim}\\endgl\\end{verbatim}\\gla x //\\endgl";
    expect(findMatchingGloss(gl, "\\begingl".length)).toBe(gl.lastIndexOf("\\endgl"));
    const ex = "\\pex\\begin{verbatim}\\xe\\end{verbatim}\\a one\\xe";
    expect(findMatchingXe(ex, "\\pex".length)).toBe(ex.lastIndexOf("\\xe"));
  });

  it("matchBeginEnvAt is THE env-name spelling (starred names included)", () => {
    expect(matchBeginEnvAt("\\begin{figure*}", 0)).toEqual({
      name: "figure*",
      end: "\\begin{figure*}".length,
    });
    expect(matchBeginEnvAt("\\begingl", 0)).toBeNull();
    expect(matchBeginEnvAt("x\\begin{a}", 0)).toBeNull();
  });
});

/**
 * The leg with teeth. The primitive was never the part that could misbehave —
 * a splitter that carries its own answer is, and no behavioural test of the
 * primitive can see one. A hit here is MIGRATE-it, never a new allowlist
 * entry.
 */
describe("census: no private `\\begin`/`\\end` terminator scanner survives", () => {
  const PARSER_FILES = [
    "src/lib/latex-parser.ts",
    "src/lib/footnote-content.ts",
    "src/lib/latex-serializer.ts",
  ];

  /**
   * Per-LINE exemptions, keyed by a fragment of the line rather than by the
   * file — a file-scoped entry would excuse the next scanner added beside
   * them. Each states why it is not the question this census asks.
   */
  const PERMITTED_ENV_TOKEN_SEARCHES: Record<string, string> = {
    // The preamble/body split. `\begin{document}` / `\end{document}` is a
    // fixed, never-nested boundary marker, not an environment whose terminator
    // has to be resolved against nesting.
    "{document}": "preamble/body boundary — a fixed, unnested marker",
    // `buildExampleItemFromText` LOCATING the item's own nested xlist so it
    // can slice it out. Its TERMINATOR comes from `findMatchingEnv`; this is
    // "where does mine start", not "what is opaque to my scan".
    "{xlist}\")": "locates the item's own nested xlist; terminator via findMatchingEnv",
  };

  /** A SEARCH for an env delimiter — the terminator question. Advancing by a
   *  token's `.length` past an index the SSOT returned is not one. */
  const TOKEN_SEARCH =
    /\.(?:indexOf|lastIndexOf|startsWith)\(\s*(?:"\\\\(?:begin|end)\{|`\\\\(?:begin|end)\{)/;

  for (const rel of PARSER_FILES) {
    it(`${rel} carries no private env-terminator scan`, () => {
      const src = strip(fs.readFileSync(path.join(ROOT, rel), "utf8"), true);
      const hits = src
        .split("\n")
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => TOKEN_SEARCH.test(line))
        .filter(
          ({ line }) =>
            !Object.keys(PERMITTED_ENV_TOKEN_SEARCHES).some((frag) =>
              line.includes(frag),
            ),
        )
        .map(({ line, n }) => `${rel}:${n}  ${line.trim()}`);
      expect(hits).toEqual([]);
    });
  }

  it("the census can SEE the shape it forbids (canary)", () => {
    // Synthetic, never a live line — a canary standing on the defect
    // evaporates the moment the allowlist is drained.
    const fixture = [
      `  const inner = src.indexOf("\\\\end{itemize}", pos);`,
      "  const other = src.startsWith(`\\\\end{${env}}`, pos);",
    ];
    for (const line of fixture) expect(TOKEN_SEARCH.test(line)).toBe(true);
    // …and does not indict the legitimate forms.
    expect(TOKEN_SEARCH.test("  ctx.pos = envEnd + `\\\\end{${env}}`.length;")).toBe(false);
    expect(TOKEN_SEARCH.test("  const t = `\\\\begin{${env}}${optArg}`;")).toBe(false);
  });

  it("the retired twins do not exist anywhere in production source", () => {
    const RETIRED = ["findMatchingEnd", "findMatchingXlistEnd"];
    const hits: string[] = [];
    for (const silo of ["src", "library"]) {
      for (const file of walk(path.join(ROOT, silo))) {
        if (/__tests__|\.test\.tsx?$/.test(file)) continue;
        const src = strip(fs.readFileSync(file, "utf8"), false);
        for (const name of RETIRED) {
          if (new RegExp(`\\b${name}\\b`).test(src)) {
            hits.push(`${path.relative(ROOT, file)} → ${name}`);
          }
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("every lexer scanner has a PRODUCTION caller (a suite is not a consumer)", () => {
    // The dead-SSOT half of the finding: `findMatchingEnv`, `matchCommandToken`
    // and `skipOpaqueConstructAt` are exported from the lexer, and before this
    // task the first two had zero production callers anywhere while the parser
    // carried its own copies.
    const NAMES = [
      "findMatchingEnv",
      "findMatchingGloss",
      "findMatchingXe",
      "matchBeginEnvAt",
      "matchCommandToken",
      "skipOpaqueConstructAt",
      "wrapVerbatimEnvBody",
      "unwrapVerbatimEnvBody",
    ];
    const callers: Record<string, string[]> = Object.fromEntries(
      NAMES.map((n) => [n, [] as string[]]),
    );
    for (const silo of ["src", "library"]) {
      for (const file of walk(path.join(ROOT, silo))) {
        if (/__tests__|\.test\.tsx?$/.test(file)) continue;
        if (file.endsWith("latex-lexer.ts")) continue; // in-file use is not a consumer
        const src = strip(fs.readFileSync(file, "utf8"), false);
        for (const name of NAMES) {
          if (new RegExp(`\\b${name}\\s*\\(`).test(src)) {
            callers[name].push(path.relative(ROOT, file));
          }
        }
      }
    }
    const dead = NAMES.filter((n) => callers[n].length === 0);
    expect(dead).toEqual([]);
  });
});

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      yield* walk(full);
    } else if (/\.tsx?$/.test(entry.name)) {
      yield full;
    }
  }
}
