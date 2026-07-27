import { describe, it, expect } from "vitest";
import {
  projectLiveLatex,
  VERBATIM_ENVS_NARROW,
  VERBATIM_ENVS_FULL,
  findMatchingBrace,
  extractBraced,
  findMatchingEnv,
  findMatchingGloss,
  matchCommandToken,
} from "@/lib/latex-lexer";

describe("projectLiveLatex — comment stripping", () => {
  it("drops a %-comment tail after live text", () => {
    expect(projectLiveLatex("live % dead \\autocite{x}\n")).toBe("live \n");
  });

  it("keeps an escaped \\% and everything after it", () => {
    expect(projectLiveLatex("40\\% \\autocite{x}")).toBe("40\\% \\autocite{x}");
  });

  it("a double-backslash before % is a linebreak, not an escape", () => {
    // `\\%` = linebreak (`\\`) followed by a real comment start.
    expect(projectLiveLatex("row\\\\% comment")).toBe("row\\\\");
  });

  it("takes the fast path when nothing is inert", () => {
    const src = "\\section{A}\n\\parencite{k}";
    expect(projectLiveLatex(src)).toBe(src);
  });
});

describe("projectLiveLatex — verbatim (NARROW family)", () => {
  it("drops verbatim contents", () => {
    expect(
      projectLiveLatex("\\begin{verbatim}\n\\ex\n\\end{verbatim}\nafter"),
    ).toBe("\n\n\nafter");
  });

  it("drops verbatim* contents and resumes after", () => {
    // 4 lines → 3 newlines: begin-line empties, `x` drops, end-line empties,
    // `y` survives.
    expect(
      projectLiveLatex("\\begin{verbatim*}\nx\n\\end{verbatim*}\ny"),
    ).toBe("\n\n\ny");
  });

  it("an unterminated verbatim swallows to EOF", () => {
    expect(projectLiveLatex("a\n\\begin{verbatim}\nb\nc")).toBe("a\n\n\n");
  });

  it("a commented \\begin{verbatim} does NOT hide the live code after it", () => {
    expect(
      projectLiveLatex("% \\begin{verbatim}\n\\includegraphics{x}\n"),
    ).toBe("\n\\includegraphics{x}\n");
  });

  it("handles a same-line verbatim pair", () => {
    expect(
      projectLiveLatex("before \\begin{verbatim}code\\end{verbatim} after"),
    ).toBe("before  after");
  });

  // task 208: the `%` inside a same-line verbatim is LITERAL — it must not be
  // stripped before the walk sees the `\end{verbatim}` (the pre-strip bug that
  // deleted the close token and left `inVerbatim` stuck to EOF).
  it("a same-line verbatim carrying a % does NOT swallow following source", () => {
    expect(
      projectLiveLatex("\\begin{verbatim}x % y\\end{verbatim}\nAFTER"),
    ).toBe("\nAFTER");
  });

  it("a same-line verbatim-with-% keeps a live command on the NEXT line", () => {
    expect(
      projectLiveLatex("\\begin{verbatim}a%b\\end{verbatim}\n\\includegraphics{p}\n"),
    ).toBe("\n\\includegraphics{p}\n");
  });

  it("still strips a genuine trailing comment AFTER a same-line close", () => {
    // The `%` here is outside verbatim (past `\end{verbatim}`), so it is a real
    // comment and its tail drops — the working path must not regress.
    expect(
      projectLiveLatex("\\begin{verbatim}code\\end{verbatim} % tail\nlive"),
    ).toBe(" \nlive");
  });

  it("still strips a trailing comment after a MULTI-line verbatim close", () => {
    expect(
      projectLiveLatex("\\begin{verbatim}\ncode\n\\end{verbatim} % tail\nlive"),
    ).toBe("\n\n \nlive");
  });

  it("NARROW family leaves lstlisting/minted contents alone", () => {
    const src = "\\begin{lstlisting}\n\\section{live-here}\n\\end{lstlisting}";
    // NARROW does not drop lstlisting, so the inner text survives.
    expect(projectLiveLatex(src, { envs: VERBATIM_ENVS_NARROW })).toBe(src);
  });
});

describe("projectLiveLatex — FULL family + inline verb (document-class scanning)", () => {
  const opts = { envs: VERBATIM_ENVS_FULL, inlineVerb: true } as const;

  it("drops lstlisting contents", () => {
    expect(
      projectLiveLatex("\\begin{lstlisting}\n\\section{X}\n\\end{lstlisting}\nY", opts),
    ).toBe("\n\n\nY");
  });

  it("drops minted contents", () => {
    expect(
      projectLiveLatex("\\begin{minted}\n\\chapter{X}\n\\end{minted}\nY", opts),
    ).toBe("\n\n\nY");
  });

  it("drops an inline \\verb|...| run", () => {
    expect(projectLiveLatex("code \\verb|\\section{x}| tail", opts)).toBe(
      "code  tail",
    );
  });

  it("drops \\verb*!...! with a bang delimiter", () => {
    expect(projectLiveLatex("a \\verb*!\\chapter{y}! b", opts)).toBe("a  b");
  });

  it("does NOT mis-lex \\verbatim as \\verb + delimiter", () => {
    // The old regex /\\verb\*?(.)[\s\S]*?\1/ read `\verbatim` as `\verb` +
    // delimiter `a`, swallowing to the next `a`. A real \verb needs a
    // NON-letter delimiter, so \verbatim must pass through untouched.
    const src = "\\verbatim\n\\section{keep}";
    expect(projectLiveLatex(src, opts)).toBe(src);
  });

  it("does NOT mis-lex \\verbdef as \\verb + delimiter", () => {
    const src = "\\verbdef\\foo{bar}\n\\section{keep}";
    expect(projectLiveLatex(src, opts)).toBe(src);
  });

  it("an unterminated inline \\verb drops to end of line only", () => {
    expect(projectLiveLatex("a \\verb|unterminated\nlive here", opts)).toBe(
      "a \nlive here",
    );
  });
});

describe("findMatchingBrace / extractBraced", () => {
  it("finds a simple matching brace", () => {
    expect(findMatchingBrace("{abc}", 0)).toBe(4);
  });

  it("handles nesting", () => {
    expect(findMatchingBrace("{a{b}c}", 0)).toBe(6);
  });

  it("treats \\{ and \\} as literal (not depth-changing)", () => {
    // The `}` closing the group is the last one; the escaped `\}` inside
    // must not close early, and the escaped `\{` must not open depth.
    expect(findMatchingBrace("{a\\}b\\{c}", 0)).toBe(8);
  });

  it("returns -1 for unbalanced", () => {
    expect(findMatchingBrace("{abc", 0)).toBe(-1);
  });

  it("returns -1 when not at a brace", () => {
    expect(findMatchingBrace("xabc}", 0)).toBe(-1);
  });

  it("extractBraced returns content + end", () => {
    expect(extractBraced("{hello}rest", 0)).toEqual({
      content: "hello",
      end: 7,
    });
  });

  it("extractBraced treats escaped braces as literal", () => {
    expect(extractBraced("{a\\{b\\}c}", 0)).toEqual({
      content: "a\\{b\\}c",
      end: 9,
    });
  });

  it("extractBraced returns null on imbalance", () => {
    expect(extractBraced("{oops", 0)).toBeNull();
  });
});

describe("findMatchingEnv — depth-counted \\begin/\\end", () => {
  it("matches a simple environment (startPos past the begin)", () => {
    const src = "\\begin{itemize}body\\end{itemize}";
    const start = "\\begin{itemize}".length;
    expect(findMatchingEnv(src, start, "itemize")).toBe(src.indexOf("\\end{itemize}"));
  });

  it("pairs nested same-name environments", () => {
    const src = "\\begin{itemize}\\begin{itemize}x\\end{itemize}\\end{itemize}";
    const start = "\\begin{itemize}".length;
    // The correct close is the LAST \end{itemize}.
    expect(findMatchingEnv(src, start, "itemize")).toBe(src.lastIndexOf("\\end{itemize}"));
  });

  it("returns -1 when no close", () => {
    const src = "\\begin{itemize}body";
    expect(findMatchingEnv(src, "\\begin{itemize}".length, "itemize")).toBe(-1);
  });

  it("verbatim is non-nestable: first \\end wins (does not depth-count)", () => {
    // A literal \begin{verbatim} in the body would bump a depth counter and
    // swallow the real close — the first \end{verbatim} is the true end.
    const src = "\\begin{verbatim}\\begin{verbatim}\\end{verbatim}tail";
    const start = "\\begin{verbatim}".length;
    expect(findMatchingEnv(src, start, "verbatim")).toBe(src.indexOf("\\end{verbatim}"));
  });
});

describe("findMatchingGloss — \\begingl … \\endgl", () => {
  it("finds the matching \\endgl", () => {
    const src = "\\begingl body \\endgl tail";
    const start = "\\begingl".length;
    expect(findMatchingGloss(src, start)).toBe(src.indexOf("\\endgl"));
  });

  it("depth-counts nested \\begingl", () => {
    const src = "\\begingl a \\begingl b \\endgl c \\endgl";
    const start = "\\begingl".length;
    expect(findMatchingGloss(src, start)).toBe(src.lastIndexOf("\\endgl"));
  });

  it("is boundary-correct: \\endglpreamble is not \\endgl", () => {
    const src = "\\begingl x \\endglpreamble y \\endgl";
    const start = "\\begingl".length;
    expect(findMatchingGloss(src, start)).toBe(src.lastIndexOf("\\endgl"));
  });

  it("is comment-aware: a commented \\endgl does not terminate", () => {
    const src = "\\begingl x\n% \\endgl in a comment\n\\endgl";
    const start = "\\begingl".length;
    expect(findMatchingGloss(src, start)).toBe(src.lastIndexOf("\\endgl"));
  });

  it("returns -1 when there is no close", () => {
    const src = "\\begingl x y z";
    expect(findMatchingGloss(src, "\\begingl".length)).toBe(-1);
  });
});

describe("matchCommandToken", () => {
  it("reads a control word", () => {
    expect(matchCommandToken("\\section{x}", 0)).toEqual({ name: "section", end: 8 });
  });

  it("returns null for a control symbol", () => {
    expect(matchCommandToken("\\%", 0)).toBeNull();
  });

  it("returns null when not at a backslash", () => {
    expect(matchCommandToken("abc", 0)).toBeNull();
  });
});

describe("findMatchingEnv — verbatim family reads the VERBATIM_ENVS_FULL SSOT (task 243)", () => {
  // For each `src`, `startPos` points just past the OUTER `\begin{env}`. The
  // body then contains an inner `\begin{env}` and TWO `\end{env}`s, so the two
  // policies pick DIFFERENT closes:
  //   • literal family member  → FIRST `\end` (first-close-wins)
  //   • depth-counted non-member → SECOND `\end` (inner begin bumps the depth)
  function twoEndSrc(env: string) {
    const open = `\\begin{${env}}`;
    const src = `${open}X${open}Y\\end{${env}}Z\\end{${env}}`;
    return { src, startPos: open.length, endTok: `\\end{${env}}` };
  }

  it("gives EVERY VERBATIM_ENVS_FULL member first-close-wins", () => {
    for (const env of VERBATIM_ENVS_FULL) {
      const { src, startPos, endTok } = twoEndSrc(env);
      expect(
        findMatchingEnv(src, startPos, env),
        `${env} should terminate at the first \\end`,
      ).toBe(src.indexOf(endTok, startPos));
    }
  });

  it("still depth-counts a non-family env (itemize → second close)", () => {
    const { src, startPos, endTok } = twoEndSrc("itemize");
    // Inner begin bumps depth to 2, so the matching close is the SECOND \end.
    expect(findMatchingEnv(src, startPos, "itemize")).toBe(
      src.lastIndexOf(endTok),
    );
    // Sanity: the two policies genuinely differ on this fixture.
    expect(src.indexOf(endTok, startPos)).not.toBe(src.lastIndexOf(endTok));
  });
});
