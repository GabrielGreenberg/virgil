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
