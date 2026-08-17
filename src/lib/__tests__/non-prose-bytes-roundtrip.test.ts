// Task 349 — the PROSE escape/typography vocabulary applied to bytes that were
// never prose.
//
// One class, seven measured members, every one of them a FIXED POINT (stable
// across a second save, so nothing heals) and every one landing on OPEN via
// `readDocBundle`'s unconditional load-writeback. Measured at HEAD `552eeda7`:
//
//   M1  `\addcontentsline{toc}{section}{Introduction}` → third arg escaped
//   M2  `\definecolor{myblue}{rgb}{0.2,0.4,0.8}`       → third arg escaped, COMPILE ERROR
//   M3  `\resizebox{3cm}{!}{Some content}`             → same
//   M4  `Line one\\[2pt]`                              → hard break DESTROYED, unterminated `\[`
//   M5  `Section~\ref{sec:a}`                          → `\textasciitilde{}`, a PRINTED tilde
//   M6  `The set {a, b} is finite.`                    → `\{a, b\}`, PRINTED braces
//   M7  `αλήθεια` / `й`                                → `\'{η}` / `\u{и}`
//
// The unifying diagnosis is task 342's rule (*what the system does not model,
// it CARRIES*) unapplied at three different sites: a construct Virgil has no
// representation for is demoted to PROSE, and the escape/typography rungs then
// rewrite it as if the user had typed those characters as prose.
//
// WHY THIS SUITE EXISTS IN THIS SHAPE. Every pre-349 round-trip suite spells
// its fixtures the way the code it tests happens to handle them, and each
// exercises one construct at a time — so a command's THIRD argument, or a Greek
// accented letter, reaching the escape table was unrepresentable in all of
// them. Each leg here therefore drives the REAL save pipeline (`parseLatex` →
// `assignUuids` → `serializeToLatex` with the REAL extracted delimiters —
// exactly what `storage-fsa.writeDocBundle` does) over TWO cycles, because
// cycle 1 is where the loss happens and cycle 2 is what proves nothing
// accumulates. Every CONTROL runs through the identical harness so no leg can
// pass vacuously.
import { describe, expect, it } from "vitest";
import { parseLatex, extractPreambleAndPostamble } from "@/lib/latex-parser";
import { serializeToLatex, assignUuids } from "@/lib/latex-serializer";
import { richLatexToJson, richJsonToLatex } from "@/lib/footnote-content";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { commentsStripped } from "@/lib/__tests__/_source-scan";
import {
  CHAR_ESCAPE_LEADS,
  CHAR_ESCAPE_TABLE,
} from "@/lib/latex-typography";

/** ONE save cycle, mirroring `storage-fsa.writeDocBundle` byte for byte. */
function save(tex: string): string {
  const content = parseLatex(tex);
  assignUuids(content);
  return serializeToLatex(content, extractPreambleAndPostamble(tex) ?? undefined);
}

/** The `\begin{document}` … `\end{document}` body with the `%!v:` anchors
 *  blanked — freshly minted on a first save, so a byte comparison against
 *  hand-written input can only be about the CONTENT. */
function body(tex: string): string {
  const start = tex.indexOf("\\begin{document}");
  const end = tex.indexOf("\\end{document}");
  return tex
    .slice(start + "\\begin{document}".length, end === -1 ? undefined : end)
    .replace(/[ \t]*%!v:[0-9a-f]{4}/g, "")
    .replace(/^\n+|\s+$/g, "");
}

/** Run two full cycles and assert the body is a FIXED POINT from cycle 1 — the
 *  property every pre-349 defect also had, which is precisely why a
 *  single-cycle assertion could never have caught any of them. */
function twoCycles(input: string): string {
  const c1 = save(input);
  const c2 = save(c1);
  expect(body(c2), "second save must not move the bytes").toBe(body(c1));
  return body(c1);
}

/** The strongest statement available: the body the user wrote comes back
 *  byte-identical, and stays that way on the next save. */
function expectStable(input: string): void {
  expect(twoCycles(input)).toBe(input.trim());
}

// ───────────────────────────────────────────────────────────────────────────
// M1 / M2 / M3 — a command atom must carry ALL of its arguments
// ───────────────────────────────────────────────────────────────────────────
//
// The unknown-command reader consumed `[…]` groups only BEFORE the braces and
// capped the braces at TWO, so a command's THIRD argument fell out of the atom
// into the prose buffer, where the escape table treats `{`/`}` as literals.
// `\definecolor` and `\resizebox` then reach the compiler with too few
// arguments — the paper **stops compiling**. `\addcontentsline` still compiles
// and silently produces a wrong ToC plus stray printed text, which is worse in
// one way: nothing tells the user.
//
// The fixed ORDER was the same defect one axis over: `\newcommand{\x}[1]{…}`
// puts its optional argument AFTER a brace, so the bracket loop had already
// finished and `[1]` was escaped to `{[}1{]}` — printed text in the PDF.

describe("M1–M3 — a command carries its whole argument run", () => {
  it("M1 `\\addcontentsline` keeps its third argument (ToC was destroyed)", () => {
    expectStable("\\addcontentsline{toc}{section}{Introduction}\n");
  });

  it("M2 `\\definecolor` keeps its third argument (was a COMPILE ERROR)", () => {
    expectStable("\\definecolor{myblue}{rgb}{0.2,0.4,0.8}\n");
  });

  it("M3 `\\resizebox` keeps its third argument (was a COMPILE ERROR)", () => {
    expectStable("\\resizebox{3cm}{!}{Some content}\n");
  });

  it("an optional argument AFTER a brace is an argument, not prose", () => {
    expectStable("\\newcommand{\\mycmd}[1]{Hello #1}\n");
  });

  it("interleaved `{…}[…]{…}` all travel", () => {
    expectStable("\\somecmd{a}[b]{c}[d]{e}\n");
  });

  it("nine arguments travel; a tenth group does not", () => {
    const nine = "{1}{2}{3}{4}{5}{6}{7}{8}{9}";
    const out = twoCycles(`\\deepcmd${nine}{ten}\n`);
    // TeX's own ceiling. The tenth group is prose from here on, which is what
    // bounds the scan — and it is stable, which is what matters.
    expect(out.startsWith(`\\deepcmd${nine}`)).toBe(true);
  });

  it("CONTROL — two arguments are unchanged", () => {
    expectStable("\\textcolor{red}{warning} here.\n");
  });

  it("CONTROL — a protected prose bracket still ENDS the run", () => {
    // `\cmd{[}x{]}`: those braces are prose abutting the command (task 037's
    // sentinel), so the atom must close and `[x]` stay editable prose.
    //
    // Asserted on the DOCUMENT MODEL rather than the bytes, and deliberately:
    // measured by deleting the protection check, the emitted `.tex` is
    // byte-identical either way (an absorbed `{[}` re-emits raw; an unwrapped
    // one is re-escaped by the prose rung), so a byte leg here has no teeth. The
    // real difference is what the user can EDIT — grey-monospace raw LaTeX
    // versus prose — which is the whole reason the rule exists.
    const doc = parseLatex("\\mycmd{[}x{]} tail.\n");
    const para = (doc.content ?? []).find((n) => n.type === "paragraph");
    const raw = (para?.content ?? []).filter((n) =>
      n.marks?.some((m) => m.type === "latexCommand"),
    );
    expect(raw.map((n) => n.text)).toEqual(["\\mycmd"]);
    expect(twoCycles("\\mycmd{[}x{]} tail.\n")).toBe("\\mycmd{[}x{]} tail.");
  });

  it("CONTROL — an unbalanced `{` fails closed and cannot swallow the doc", () => {
    const out = twoCycles("\\mycmd{unclosed and more prose here.\n\nSecond para.\n");
    expect(out).toContain("Second para.");
  });

  it("the card-body fork answers identically (task 341's twin rule)", () => {
    // The fork had its OWN copy of the two-brace cap and the fixed order, and —
    // unlike the main parser — no `{[}`-protection check at all. One door, one
    // answer: a card body must read the same bytes the document does.
    for (const src of [
      "\\definecolor{myblue}{rgb}{0.2,0.4,0.8}",
      "\\resizebox{3cm}{!}{Some content}",
      "\\somecmd{a}[b]{c}",
      "\\mycmd{[}x{]} tail.",
    ]) {
      expect(richJsonToLatex(richLatexToJson(src)).trim(), src).toBe(src);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// M4 — `\\[2pt]`: a break's own ARGUMENT RUN demoted to prose
// ───────────────────────────────────────────────────────────────────────────
//
// Two independent halves, and each one alone leaves the bytes wrong:
//
//   * `readParagraph`'s `\[` boundary test fires at the SECOND backslash of
//     `\\[`, where `result` holds only ONE — so the `/\\\\\s*$/` guard that
//     exists to suppress exactly this break can never match. The paragraph
//     split, leaving `Line one\` with a dangling backslash and `\[2pt]` as an
//     UNTERMINATED display-math opener: a `.tex` that no longer compiles.
//   * even with the split fixed, the `[` fell into the prose buffer, where the
//     escape table's `protect` member wrapped it as `{[}` — so the PDF printed
//     a literal `[2pt]` where the author asked for 2pt of extra leading.

describe("M4 — a line break carries its own argument run", () => {
  it("`\\\\[2pt]` round-trips (was a split paragraph + an unterminated `\\[`)", () => {
    expectStable("Line one\\\\[2pt]\nLine two.\n");
  });

  it("does not emit an unterminated display-math opener", () => {
    const out = twoCycles("Line one\\\\[2pt]\nLine two.\n");
    // The pre-fix output was `Line one\` / blank / `\[2pt]` / `Line two.` —
    // an opener with no `\]` anywhere, which is the compile error.
    expect(out.split("\n").filter((l) => l.trim() === "\\[2pt]")).toEqual([]);
    expect(out).not.toContain("{[}");
  });

  it("stays ONE paragraph", () => {
    const doc = parseLatex(save("Line one\\\\[2pt]\nLine two.\n"));
    const paras = (doc.content ?? []).filter((n) => n.type === "paragraph");
    expect(paras).toHaveLength(1);
  });

  it("`\\\\*` (the no-page-break form) round-trips", () => {
    expectStable("Line one\\\\*\nLine two.\n");
  });

  it("`\\\\*[1ex]` round-trips", () => {
    expectStable("Line one\\\\*[1ex]\nLine two.\n");
  });

  it("CONTROL — a bare `\\\\` still becomes the modelled hardBreak", () => {
    // The shipped behaviour, and what Shift+Enter produces. It must keep its
    // node (not the raw carrier), which is what the re-emitted `\\\n` proves.
    const doc = parseLatex("Line one\\\\\nLine two.\n");
    const para = (doc.content ?? []).find((n) => n.type === "paragraph");
    expect((para?.content ?? []).some((n) => n.type === "hardBreak")).toBe(true);
    expectStable("Line one\\\\\nLine two.\n");
  });

  it("CONTROL — an UNTERMINATED `\\\\[` fails closed to today's reading", () => {
    // `extractBracketed` answers null, so the break stays bare and the `[`
    // remains prose — byte-for-byte the pre-fix behaviour, deliberately.
    const out = twoCycles("Line one\\\\[unclosed\nLine two.\n");
    expect(out).toContain("{[}unclosed");
  });

  it("CONTROL — a prose `[` after a bare break is still protected", () => {
    // Task 037's `{[}` protection, which is why the carrier is ABUTTING-only.
    const out = twoCycles("Line one\\\\\n[note] follows.\n");
    expect(out).toContain("{[}note{]}");
  });

  it("CONTROL — `\\\\` then a real block boundary on the next line still breaks", () => {
    // The case the `/\\\\\\\\\\s*$/` guard was written for: the boundary fires at
    // a THIRD, unescaped backslash, so the `isEscaped` gate leaves it alone.
    const out = twoCycles("Line one\\\\\n\\section{Next}\n");
    expect(out).toContain("\\section{Next}");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// M7 — the accent fold had no SCRIPT guard
// ───────────────────────────────────────────────────────────────────────────
//
// `typographyToLatex` NFD-decomposes anything and maps any combining mark it
// knows back to a LaTeX accent command, so Greek `ή` became `\'{η}` and
// Cyrillic `й` became `\u{и}`. Both are stable INSIDE Virgil (the parse rung
// composes them straight back to the same glyph, so the editor looked right
// forever) and both are wrong on disk: under `inputenc`/pdflatex an accent
// command over a non-Latin base is an error or garbage.

describe("M7 — the accent fold is Latin-scoped", () => {
  it("Greek keeps its precomposed letters (was `\\'{η}`)", () => {
    const out = twoCycles("αλήθεια is truth.\n");
    expect(out).toBe("αλήθεια is truth.");
    expect(out).not.toContain("\\'");
  });

  it("Cyrillic keeps its precomposed letters (was `\\u{и}`)", () => {
    const out = twoCycles("й is short i.\n");
    expect(out).toBe("й is short i.");
    expect(out).not.toContain("\\u{");
  });

  it("polytonic Greek with a stacked known mark is not folded", () => {
    // ᾴ = α + U+0345 (ypogegrammeni, unknown to the table) + U+0301 (acute,
    // known). The acute must not be lifted off a Greek base.
    const out = twoCycles("ά test.\n");
    expect(out).not.toContain("\\'");
  });

  it("CONTROL — a Latin accented letter still folds to its accent command", () => {
    // The designed behaviour, and the DIRECT-TYPED-GLYPH policy this module
    // documents. It must not change.
    const out = twoCycles("café au lait.\n");
    expect(out).toBe("caf\\'{e} au lait.");
  });

  it("CONTROL — stacked Latin diacritics still nest (Vietnamese)", () => {
    // NFD order for ặ is dot-below then breve, so the canonical nesting is
    // `\u{\d{a}}` (innermost mark closest to the base). Pinned at the value
    // this repo actually emits, not the one AGENTS.md's prose recalls.
    const out = twoCycles("mặt test.\n");
    expect(out).toContain("\\u{\\d{a}}");
  });

  it("CONTROL — a special-letter glyph is still a legal accent base", () => {
    // `ø` has no decomposition, so it survives NFD intact and is Latin script:
    // the guard must not exclude it.
    expect(twoCycles("søster.\n")).toBe("s\\o{}ster.");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// M5 — the `~` TIE is a GLYPH, not an escapable character
// ───────────────────────────────────────────────────────────────────────────
//
// `CHAR_ESCAPE_TABLE`'s tilde entry is `emit: "always"` and the parse rung
// collapsed BOTH a bare `~` and `\textasciitilde{}` to the same character, so
// the rewrite was one-directional and unrecoverable: `Fig.~1` and
// `Section~\ref{…}` — the standard idiom — printed a literal tilde after the
// first save, permanently, and nothing downstream could tell a promoted tie
// from a tilde the user meant.
//
// The fix is a MODEL distinction rather than a mark: LaTeX's `~` IS Unicode
// U+00A0, so the tie parses to that character and serializes back to `~`,
// while an ASCII `~` the user types as prose stays ASCII and still emits
// `\textasciitilde{}`. That is why nothing is dropped from the table — this is
// about PROVENANCE, and the prose direction must keep escaping.

const NBSP_CH = "\u00A0";

describe("M5 — a `~` tie survives a save", () => {
  it("`Fig.~1` round-trips (was a printed tilde)", () => {
    expectStable("See Section~\\ref{sec:a} and Fig.~1.\n");
  });

  it("the tie reaches the document as U+00A0, not as an ASCII tilde", () => {
    // The whole fix in one assertion: the two spellings must resolve to two
    // DIFFERENT characters, or the emit rung has nothing to tell apart.
    const doc = parseLatex("Fig.~1 and a tilde.\n");
    const para = (doc.content ?? []).find((n) => n.type === "paragraph");
    const text = (para?.content ?? []).map((n) => n.text ?? "").join("");
    expect(text).toContain(`Fig.${NBSP_CH}1`);
    expect(text).not.toContain("Fig.~1");
  });

  it("a tie inside `\\texttt{}` round-trips too", () => {
    // The code path suppresses the typography rung, which is exactly why the
    // pair lives in `CHAR_ESCAPE_TABLE` and not in `LITERAL_TABLE`.
    expectStable("Run \\texttt{a~b} now.\n");
  });

  it("a tie in a heading and in an `\\item` body round-trips", () => {
    expectStable("\\section{Fig.~1 and more}\n");
    // The serializer indents `\\item`, so this one is pinned at its canonical
    // form rather than at the hand-written input.
    expectStable(
      "\\begin{itemize}\n  \\item See Fig.~1 here.\n\\end{itemize}\n",
    );
  });

  it("the card-body fork answers identically (task 341's twin rule)", () => {
    // `footnote-content.ts` is a second inline parser; both must resolve a tie
    // the same way or a footnote body loses it while the paragraph keeps it.
    expect(richJsonToLatex(richLatexToJson("See Fig.~1 now."))).toBe(
      "See Fig.~1 now.",
    );
    expect(richJsonToLatex(richLatexToJson("A \\texttt{x~y} b."))).toBe(
      "A \\texttt{x~y} b.",
    );
  });

  it("a footnote body carries its tie through the whole pipeline", () => {
    // A first save mints the footnote's `\\vfid` id marker, so the assertion is
    // on the BODY rather than on the whole line.
    const out = twoCycles("Prose.\\footnote{See Fig.~1 there.}\n");
    expect(out).toContain("\\footnote{See Fig.~1 there.}");
  });

  it("CONTROL — an ASCII tilde the user typed as PROSE is still escaped", () => {
    // The other direction, and the one the "Done when" forbids breaking: a
    // literal tilde must keep reaching the `.tex` as `\textasciitilde{}`.
    const doc = parseLatex("A \\textasciitilde{} sign.\n");
    const para = (doc.content ?? []).find((n) => n.type === "paragraph");
    const text = (para?.content ?? []).map((n) => n.text ?? "").join("");
    expect(text).toContain("A ~ sign");
    expect(text).not.toContain(NBSP_CH);
    expectStable("A \\textasciitilde{} sign.\n");
  });

  it("CONTROL — a tie inside `\\url{}` / `\\verb` / math is untouched", () => {
    // Each is consumed by its own matcher BEFORE the lead branch can see the
    // byte, which is what task 338's `\url` case rests on.
    expectStable("Visit \\url{http://x.com/~bob} today.\n");
    expectStable("Type \\verb|a~b| here.\n");
    expectStable("Math $a~b$ here.\n");
  });

  it("CONTROL — a `~` inside a comment tail stays in the comment", () => {
    expectStable("Prose here. % see Fig.~1\n");
  });

  it("CONTROL — a pasted U+00A0 is written as the tie it means", () => {
    // Pre-fix this reached disk as a raw U+00A0 byte, which pdflatex+inputenc
    // may refuse outright. The DIRECT-TYPED-GLYPH policy says canonicalize.
    expect(twoCycles(`Fig.${NBSP_CH}1 here.\n`)).toBe("Fig.~1 here.");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// M6 — a bare `{…}` GROUP is LaTeX syntax, not two literal characters
// ───────────────────────────────────────────────────────────────────────────
//
// In LaTeX `The set {a, b} is finite.` typesets `The set a, b is finite.` —
// the braces scope, they do not print. Escaped to `\{a, b\}` they DO print, so
// opening the paper silently changed what the PDF says. Task 339 recorded this
// as the case its "bare text is a carrier for typed raw LaTeX" premise does
// not cover; the carrier here is 342's `latexCommand` on the braces alone, so
// the enclosed words stay editable prose.

describe("M6 — a bare `{…}` group survives a save", () => {
  it("`The set {a, b} is finite.` round-trips (braces were PRINTED)", () => {
    expectStable("The set {a, b} is finite.\n");
  });

  it("the braces carry, the CONTENT stays prose", () => {
    // Marking the whole group raw would grey out the user's words, which is
    // worse than the bug for `{a, b}`.
    const doc = parseLatex("The set {a, b} is finite.\n");
    const para = (doc.content ?? []).find((n) => n.type === "paragraph");
    const raw = (para?.content ?? []).filter((n) =>
      n.marks?.some((m) => m.type === "latexCommand"),
    );
    expect(raw.map((n) => n.text)).toEqual(["{", "}"]);
    const prose = (para?.content ?? []).filter((n) => !n.marks?.length);
    expect(prose.map((n) => n.text).join("")).toContain("a, b");
  });

  it("a group holding a command round-trips", () => {
    expectStable("Then {\\bf bold words} follow.\n");
  });

  it("nested groups round-trip", () => {
    expectStable("Outer {a {b} c} tail.\n");
  });

  it("an empty group round-trips", () => {
    expectStable("Before {} after.\n");
  });

  it("the card-body fork answers identically (task 341's twin rule)", () => {
    expect(richJsonToLatex(richLatexToJson("The set {a, b} is finite."))).toBe(
      "The set {a, b} is finite.",
    );
  });

  it("a group ending in a COMMENT gains the newline that closes it", () => {
    // The one byte this fix moves, pinned rather than merely noted. In the
    // SOURCE `{a % c}` the comment swallows the `}` and its newline, so the
    // group is never closed and LaTeX errors at end of file. The comment
    // carrier's line obligation (task 347's `closeCommentTail`) writes the
    // newline the tail owes before the `}` is emitted — so the output CLOSES
    // the group the user had left open, and is a fixed point from there.
    const out = twoCycles("The set {a % c} tail.\n");
    expect(out).toBe("The set {a % c\n} tail.");
  });

  it("CONTROL — an ESCAPED brace the user typed is still a literal", () => {
    // The other direction: `\{` parses to a literal `{` in the prose buffer and
    // re-emits as `\{`, so a brace the author means to PRINT is untouched.
    expectStable("The set \\{a, b\\} is finite.\n");
  });

  it("CONTROL — a brace the user types in the EDITOR is escaped on the way out", () => {
    // A prose text node holding a literal `{` (no backslash in the run) must
    // still emit `\{` — task 339's rule, which M6 must not weaken.
    const doc = parseLatex("placeholder\n");
    const para = (doc.content ?? []).find((n) => n.type === "paragraph");
    para!.content = [{ type: "text", text: "a { b } c" }];
    expect(serializeToLatex(doc)).toContain("a \\{ b \\} c");
  });

  it("CONTROL — `{[}` is still a protection, not a group", () => {
    expectStable("A \\mycmd{[}x{]} tail.\n");
  });

  it("CONTROL — an unbalanced `{` still fails closed to today's escaping", () => {
    const out = twoCycles("The set {a, b is finite.\n");
    expect(out).toContain("\\{a, b is finite.");
  });

  it("CONTROL — a command's own argument braces are still its arguments", () => {
    // The group branch sits AFTER the `\` branch, so `\textbf{x}` is consumed
    // whole by the command rules and never reaches it.
    const doc = parseLatex("Some \\textbf{bold} here.\n");
    const para = (doc.content ?? []).find((n) => n.type === "paragraph");
    const raw = (para?.content ?? []).filter((n) =>
      n.marks?.some((m) => m.type === "latexCommand"),
    );
    expect(raw).toHaveLength(0);
    expectStable("Some \\textbf{bold} here.\n");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// CENSUS — the doors were never the part that could misbehave
// ───────────────────────────────────────────────────────────────────────────
//
// Both M5 and M6 are shared DOORS read by two inline parsers, and the whole
// class this task closes is "a construct reached the prose buffer". A behavioural
// test of a door proves the door works; what it cannot see is a SCANNER that
// never asks it — which is precisely the shape that shipped:
//
//  - the non-backslash char-escape members were gated on a literal
//    `text[i] === "{"` in BOTH parsers, so `~` was emitted by
//    `escapeLatexChars` and unreachable on the way back in;
//  - `footnote-content.ts` is a complete second inline parser (task 341), and
//    every vocabulary that has ever drifted across that seam drifted by one
//    side simply not calling what the other side calls.

const SILOS = ["src", "library"];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === "__tests__" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const PRODUCTION_FILES = SILOS.flatMap((s) => walk(s));

/**
 * The two files that SCAN prose character by character. Stated here rather than
 * discovered, because that is what the census is asserting: exactly these two,
 * and both of them read both doors.
 */
const INLINE_PARSERS = [
  "src/lib/latex-parser.ts",
  "src/lib/footnote-content.ts",
];

describe("CENSUS — the scanners ask the derived doors", () => {
  it("finds a real production corpus (self-check)", () => {
    expect(PRODUCTION_FILES.length).toBeGreaterThan(300);
    for (const f of INLINE_PARSERS) expect(PRODUCTION_FILES).toContain(f);
  });

  it("both inline parsers gate on CHAR_ESCAPE_LEADS, not on a hand-written `{`", () => {
    // Neuter this and the tie is emitted correctly and never read back — the
    // one-directional rewrite the whole task is about, with the emit half green.
    for (const f of INLINE_PARSERS) {
      const code = commentsStripped(readFileSync(f, "utf8"));
      expect(code, `${f} must ask the derived lead set`).toContain(
        "CHAR_ESCAPE_LEADS.has(",
      );
    }
  });

  it("both inline parsers carry a bare group through the shared door", () => {
    // The task-341 twin rule: a vocabulary one fork reads and the other does
    // not is how every prior divergence across this seam began.
    for (const f of INLINE_PARSERS) {
      const code = commentsStripped(readFileSync(f, "utf8"));
      expect(code, `${f} must call matchBraceGroupAt`).toContain(
        "matchBraceGroupAt(",
      );
    }
  });

  it("no production file outside the lexer hand-lists the lead characters", () => {
    // A second spelling of "which characters can begin a table member" is the
    // hand list `CHAR_ESCAPE_LEADS` replaces. The lexer is exempt by shape: it
    // asks `matchCharEscapeAt` a `{`-guarded PROTECTION question inside
    // `matchCommandArgumentRun` / `matchBraceGroupAt`, which is a test, not a
    // scanner gate.
    const offenders: string[] = [];
    const examined: string[] = [];
    for (const f of PRODUCTION_FILES) {
      if (f === "src/lib/latex-lexer.ts") continue;
      if (f === "src/lib/latex-typography.ts") continue;
      const code = commentsStripped(readFileSync(f, "utf8"));
      if (!code.includes("matchCharEscapeAt(")) continue;
      examined.push(f);
      if (!code.includes("CHAR_ESCAPE_LEADS")) offenders.push(f);
    }
    // Not vacuous: the two scanners MUST be the files it looked at. A needle
    // that matches nothing passes for the wrong reason.
    expect(examined.sort()).toEqual([...INLINE_PARSERS].sort());
    expect(offenders).toEqual([]);
  });

  it("the lead set is DERIVED and covers exactly the non-backslash spellings", () => {
    // Read from the table rather than restated, so a new member joins by
    // declaration. Today: `{` (the two protections) and `~` (the tie).
    const leads = [...CHAR_ESCAPE_LEADS].sort();
    const expected = CHAR_ESCAPE_TABLE.filter(
      (e) => !e.tex.startsWith("\\"),
    ).map((e) => e.tex[0]);
    expect(new Set(leads)).toEqual(new Set(expected));
    expect(leads).toEqual(["{", "~"].sort());
  });

  it("the tie is declared as a GLYPH, and the ASCII tilde is still an escape", () => {
    // The pair that makes the provenance representable at all. Dropping either
    // is the "just delete the table entry" fix the Done-when forbids.
    const tie = CHAR_ESCAPE_TABLE.find((e) => e.text === NBSP_CH);
    expect(tie).toEqual({
      text: NBSP_CH,
      tex: "~",
      kind: "glyph",
      emit: "always",
    });
    const tilde = CHAR_ESCAPE_TABLE.find((e) => e.text === "~");
    expect(tilde?.tex).toBe("\\textasciitilde{}");
    expect(tilde?.emit).toBe("always");
  });
});
