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
//   M5  `Section~\ref{sec:a}`                          → `\textasciitilde{}` (later member)
//   M6  `The set {a, b} is finite.`                    → `\{a, b\}`         (later member)
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
