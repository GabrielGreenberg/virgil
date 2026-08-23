// Task 347 — a `%` comment is CONTENT, and Virgil now carries it.
//
// Before this task a comment was three different things in three places, and
// every one of them was a FIXED POINT — so no later save healed it, and nothing
// downstream could tell what the bytes used to be. All of it landed on OPEN:
// `readDocBundle` runs this same pipeline and then fires
// `writeReStampedTexOnLoad` unconditionally, so merely opening a paper rewrote
// it. Measured at `552eeda7`:
//
//   M1   a `%` line inside an `\ex` body            → DELETED
//   M1b  a `%` line inside a `\pex` body            → DELETED
//   M2   `prose. % a marginal note`                 → `prose. \% a marginal note`
//   M2b  `Growth of 5% was observed.`               → `5\% was observed.`
//   M2c  `continues%` (TeX's line-JOIN idiom)       → `continues\%`
//   M3   a `%` line inside a paragraph              → a blank line INSERTED
//   M4   `prose. %!v:aaaa % user note`              → uuid `aaaa` DESTROYED
//
// M2's family is the one that changes what LaTeX DOES: `% TODO cite` and
// `% fix this` — the most ordinary annotations in an academic `.tex` — started
// TYPESETTING in the compiled PDF, and afterwards a promoted comment was
// indistinguishable from a `\%` the user actually wrote.
//
// WHY THIS SUITE EXISTS IN THIS SHAPE. Every pre-347 round-trip suite spells
// its fixtures the way the code it tests happens to handle them, and each
// exercises one construct at a time — so a comment reaching the escape table
// was unrepresentable in all of them. Each leg here therefore drives the REAL
// save pipeline (`parseLatex` → `assignUuids` → `serializeToLatex` with the
// REAL extracted delimiters — exactly what `storage-fsa.writeDocBundle` does)
// over TWO cycles, because cycle 1 is where the loss happens and cycle 2 is
// what proves nothing accumulates. The CONTROLS run through the identical
// harness so no leg can pass vacuously:
//
//   * `itemize` / `quote` / `figure` — containers that always preserved theirs,
//     which is what proves M1 is the expex splitter and not a general policy;
//   * a whole-line comment at a block boundary — still a `latexComment` BLOCK;
//   * task 338's own `\url{http://ex.com/a%20b}`, which must stay byte-identical
//     (it is why the carrier is recognized INSIDE the inline scanner, at a
//     position every command / verb / math matcher has already declined);
//   * a genuinely AUTHORED `\%`, which must still round-trip as `\%` — the
//     provenance distinction the carrier exists to make structural, and the
//     reason the "just drop `%` from the escape table" fallback was refused.
import { describe, expect, it } from "vitest";
import { parseLatex, extractPreambleAndPostamble } from "@/lib/latex-parser";
import { serializeToLatex, assignUuids } from "@/lib/latex-serializer";
import { LATEX_COMMENT_TAIL_MARK } from "@/lib/latex-lexer";
import type { JSONContent } from "@tiptap/react";

/** ONE save cycle, mirroring `storage-fsa.writeDocBundle` byte for byte. */
function save(tex: string): string {
  const content = parseLatex(tex);
  assignUuids(content);
  return serializeToLatex(content, extractPreambleAndPostamble(tex) ?? undefined);
}

/** The `\begin{document}` … `\end{document}` body, with the `%!v:` anchors
 *  blanked. The anchors are freshly minted on a first save (that is what
 *  `assignUuids` is for), so a byte comparison against hand-written input can
 *  only be about the CONTENT — and the anchor's own survival is asserted
 *  separately, by `paragraphUuid`, where it is the thing under test. */
function body(tex: string): string {
  const start = tex.indexOf("\\begin{document}");
  const end = tex.indexOf("\\end{document}");
  return tex
    .slice(start + "\\begin{document}".length, end === -1 ? undefined : end)
    .replace(/[ \t]*%!v:[0-9a-f]{4}/g, "")
    .replace(/^\n+|\s+$/g, "");
}

/**
 * The uuid the first paragraph actually ANSWERS TO, read back through the real
 * parser.
 *
 * Deliberately not a grep for `%!v:` in the emitted bytes, and the difference
 * is the whole of M4: a DEAD marker stranded inside a comment still matches
 * such a grep, so a byte-level assertion passes while the block's identity has
 * been minted afresh and every card keyed on the old one has orphaned. This
 * leg's first draft made exactly that mistake and was measured passing against
 * the pre-fix `stripUuidAnchor`.
 */
function paragraphUuid(tex: string): string | null {
  const para = (parseLatex(tex).content ?? []).find((n) => n.type === "paragraph");
  return (para?.attrs?.uuid as string | undefined) ?? null;
}

/** Run two full cycles and assert the body is a FIXED POINT from cycle 1 —
 *  the property every pre-347 defect also had, which is precisely why a
 *  single-cycle assertion could never have caught any of them. */
function twoCycles(input: string): { c1: string; c2: string; bodyText: string } {
  const c1 = save(input);
  const c2 = save(c1);
  expect(body(c2), "second save must not move the bytes").toBe(body(c1));
  return { c1, c2, bodyText: body(c1) };
}

function allText(node: JSONContent, out: JSONContent[] = []): JSONContent[] {
  if (node.type === "text") out.push(node);
  for (const c of node.content ?? []) allText(c, out);
  return out;
}

function commentTailRuns(doc: JSONContent): string[] {
  return allText(doc)
    .filter((n) => n.marks?.some((m) => m.type === LATEX_COMMENT_TAIL_MARK))
    .map((n) => n.text ?? "");
}

// ───────────────────────────────────────────────────────────────────────────
// M1 / M1b — DATA LOSS: a comment inside an expex body was deleted outright
// ───────────────────────────────────────────────────────────────────────────

describe("M1 — a comment inside an expex example survives (was DELETED)", () => {
  it("`\\ex` keeps its comment line", () => {
    const { bodyText } = twoCycles("\\ex Body text.\n% a note to self\n\\xe\n");
    expect(bodyText).toContain("% a note to self");
    expect(bodyText).toContain("Body text.");
  });

  it("`\\ex` keeps a comment that PRECEDES its prose", () => {
    // The shape that genuinely reaches the expex splitter's carrier. With the
    // comment AFTER prose (the leg above) the paragraph swallows it inline, so
    // that leg is satisfied by M3's fix and would stay green with the splitter
    // still dropping blocks — measured. A comment with no prose before it
    // reaches `parseBody` at a block boundary, becomes a `latexComment` node,
    // and is dropped unless the splitter carries it.
    const { bodyText } = twoCycles("\\ex\n% a note first\nBody text.\n\\xe\n");
    expect(bodyText).toContain("% a note first");
    expect(bodyText).toContain("Body text.");
  });

  it("`\\pex` keeps a comment in its preamble", () => {
    const { bodyText } = twoCycles("\\pex\n% note\n\\a one\n\\xe\n");
    expect(bodyText).toContain("% note");
    expect(bodyText).toContain("one");
  });

  it("the comment is never re-emitted as typeset text", () => {
    // The failure this replaces was a DELETION, so a leg that only asserted
    // "the bytes are there" could be satisfied by the escape path promoting
    // the comment into the document — which is M2's defect wearing M1's fix.
    const { bodyText } = twoCycles("\\ex Body text.\n% a note to self\n\\xe\n");
    expect(bodyText).not.toContain("\\%");
  });

  // The CONTROLS. Every other container preserved its comment before this
  // task, which is what localizes M1 to the expex body splitter rather than to
  // a general policy — so these must pass on BOTH sides of the fix.
  it.each([
    ["itemize", "\\begin{itemize}\n% a note\n\\item one\n\\end{itemize}\n"],
    ["quote", "\\begin{quote}\n% a note\nQuoted prose.\n\\end{quote}\n"],
  ])("CONTROL: %s already preserved its comment", (_name, src) => {
    expect(twoCycles(src).bodyText).toContain("% a note");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// M2 — a mid-line `%` no longer changes what LaTeX DOES
// ───────────────────────────────────────────────────────────────────────────

describe("M2 — a mid-line comment is carried, not promoted to body text", () => {
  it.each([
    ["a trailing marginal note", "Some prose here. % a marginal note\n"],
    ["a bare % in prose", "Growth of 5% was observed.\n"],
    [
      "the line-suppression idiom",
      "A long line that continues%\nonto the next line.\n",
    ],
    ["the commonest annotation there is", "Draft para. % TODO cite\n"],
  ])("%s round-trips byte-for-byte", (_name, src) => {
    const { bodyText } = twoCycles(src);
    expect(bodyText).toBe(src.trim());
    // The whole defect in one assertion: an escaped `\%` here means the
    // comment has started typesetting in the compiled PDF.
    expect(bodyText).not.toContain("\\%");
  });

  it("makes task 338's premise TRUE — `See a%b and more.` is byte-for-byte", () => {
    // 338 recorded "mid-line a `%` is ordinary prose it preserves byte-for-byte
    // — verified against the real parser". It had checked the PARSE side; the
    // emit side was never asked, and answered `See a\%b and more.`
    const { bodyText } = twoCycles("See a%b and more.\n");
    expect(bodyText).toBe("See a%b and more.");
  });

  it("carries the comment on the carrier mark, not in the prose buffer", () => {
    // The representation, not just the bytes: a text run reaching the prose
    // buffer is a run the char-escape table will rewrite on some future path.
    const doc = parseLatex("Some prose here. % a marginal note\n");
    expect(commentTailRuns(doc)).toEqual(["% a marginal note"]);
  });

  // The CONTROLS for this leg, and the reason the "drop `%` from the escape
  // table" fallback was refused: both of these must keep behaving.
  it("CONTROL: an AUTHORED `\\%` still round-trips as `\\%`", () => {
    const { bodyText } = twoCycles("Growth of 5\\% was observed.\n");
    expect(bodyText).toBe("Growth of 5\\% was observed.");
  });

  it("CONTROL: 338's `\\url{…a%20b}` stays byte-identical", () => {
    // The `%` inside a command run has already been consumed by the command
    // matcher when the carrier branch is reached, so this needs no special
    // case — which is exactly the property that would break if the split were
    // done ahead of the inline scan instead of inside it.
    const src = "\\url{http://ex.com/a%20b}\n";
    expect(twoCycles(src).bodyText).toBe(src.trim());
    expect(commentTailRuns(parseLatex(src))).toEqual([]);
  });

  it("CONTROL: a `%` inside `\\verb` and inside math is not a comment", () => {
    for (const src of ["Try \\verb|a%b| here.\n", "Then $50%$ done.\n"]) {
      expect(commentTailRuns(parseLatex(src))).toEqual([]);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// M3 — a comment inside a paragraph does not split the paragraph
// ───────────────────────────────────────────────────────────────────────────

describe("M3 — a comment line inside a paragraph inserts no paragraph break", () => {
  const SRC =
    "First line of a paragraph\n% a note\nsecond line of the same paragraph.\n";

  it("round-trips with no blank line inserted", () => {
    const { bodyText } = twoCycles(SRC);
    expect(bodyText).toBe(SRC.trim());
  });

  it("stays ONE paragraph in the parsed document", () => {
    // The user-visible cost of the old break was in the PDF: one paragraph
    // became two. Asserting the byte shape alone would not have said so.
    const doc = parseLatex(SRC);
    const blocks = (doc.content ?? []).filter((n) => n.type !== "text");
    expect(blocks.map((b) => b.type)).toEqual(["paragraph"]);
  });

  it("CONTROL: a blank line still separates — the comment becomes a BLOCK", () => {
    // The distinction the pre-347 parser could not draw, and the reason the
    // fix is "don't break" rather than "never make a comment block": LaTeX
    // reads `A\n\n% c\nB` as two paragraphs, and Virgil still does.
    const doc = parseLatex("First para.\n\n% a note\nSecond para.\n");
    expect((doc.content ?? []).map((b) => b.type)).toEqual([
      "paragraph",
      "latexComment",
      "paragraph",
    ]);
  });

  it("CONTROL: a whole-line comment at the top is still a BLOCK", () => {
    const doc = parseLatex("% whole-line note\nProse.\n");
    expect((doc.content ?? []).map((b) => b.type)).toEqual([
      "latexComment",
      "paragraph",
    ]);
    expect(twoCycles("% whole-line note\nProse.\n").bodyText).toContain(
      "% whole-line note",
    );
  });

  it("a commented-out terminator still does not end the paragraph early", () => {
    // The gate that keeps M3's fix from re-opening task 338's hazard: a
    // block-level command LaTeX never reads is not a block boundary. Without
    // it, dropping the paragraph break split `% \end{itemize}` into an empty
    // `%` and a live-looking terminator.
    const src =
      "\\begin{itemize}\n  \\item outer\n% \\end{itemize}\n  \\item after\n\\end{itemize}\n";
    expect(twoCycles(src).bodyText).toContain("% \\end{itemize}");
    expect(twoCycles(src).bodyText).toContain("\\item after");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// M4 — IDENTITY LOSS: a comment after the anchor destroyed the block's uuid
// ───────────────────────────────────────────────────────────────────────────

describe("M4 — a trailing comment after a `%!v:` anchor keeps the uuid", () => {
  const SRC = "Some prose. %!v:aaaa % user note\n";

  it("preserves the uuid the block already had", () => {
    // The pre-347 end-anchored match simply failed here, so the whole tail
    // fell through as prose, was `\%`-escaped, and a FRESH uuid was minted —
    // orphaning every card, marginalia marker and sidecar title keyed on
    // `aaaa`, with no edit by the user.
    const { c1, c2 } = twoCycles(SRC);
    expect(paragraphUuid(c1)).toBe("aaaa");
    expect(paragraphUuid(c2)).toBe("aaaa");
    // And exactly ONE anchor is emitted — a second would mean the old marker
    // survived as inert comment text beside a freshly minted identity, which
    // is the defect in the shape that most resembles the fix.
    expect([...c1.matchAll(/%!v:[0-9a-f]{4}/g)]).toHaveLength(1);
  });

  it("keeps the user's note, unescaped, and re-canonicalizes it once", () => {
    const { bodyText } = twoCycles(SRC);
    expect(bodyText).toContain("% user note");
    expect(bodyText).not.toContain("\\%");
    // The anchor moves to the end of the comment on the FIRST save (it is
    // comment bytes either way, so LaTeX cannot tell) and is stable from then
    // on — which `twoCycles` has already asserted.
    expect(body(save(SRC))).toBe("Some prose. % user note");
  });

  it("CONTROL: an anchor with nothing after it is unchanged", () => {
    const c1 = save("Some prose. %!v:bbbb\n");
    expect(paragraphUuid(c1)).toBe("bbbb");
    expect(body(c1)).toBe("Some prose.");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The carrier's own two obligations
// ───────────────────────────────────────────────────────────────────────────

describe("the carrier's line obligation", () => {
  it("nothing the serializer writes after a tail shares its line", () => {
    // Reachable by EDITING rather than by parsing: type a word at the trailing
    // edge of a comment chip and, without this, the word is emitted after the
    // `%` on the same line — where LaTeX discards it. That is this task's own
    // defect arriving through the keyboard. (`inclusive: false` on the mark is
    // the type-time half; this is the save-time half.)
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { uuid: "1111" },
          content: [
            { type: "text", text: "Prose. " },
            {
              type: "text",
              text: "% a note",
              marks: [{ type: LATEX_COMMENT_TAIL_MARK }],
            },
            { type: "text", text: "typed after" },
          ],
        },
      ],
    };
    const out = body(serializeToLatex(doc));
    const commentLine = out.split("\n").find((l) => l.includes("% a note"))!;
    expect(commentLine).not.toContain("typed after");
    expect(out).toContain("typed after");
  });

  it("the CONTINUATION is the user's bytes — the carrier must not skip it", () => {
    // The NEGATIVE half of task 406's lexer pair, pinned here because it is the
    // half a future "consistency" cleanup would break.
    //
    // `matchCommentTailAt` answers a REPRESENTATION question ("which bytes are
    // the comment") and its sibling `skipCommentContinuationAt` answers a
    // READING one ("where does TeX resume" — past the newline AND past the
    // continuation line's leading indent). Every scanner assembling TEXT wants
    // the second; this branch, the byte CARRIER, must have only the first. The
    // newline and the indent are the USER's bytes: routed through the sibling
    // door they would be swallowed on every save, silently, as a fixed point —
    // exactly the rewrite the carrier exists to prevent (task 347).
    //
    // The INDENT is what makes this leg measurable. `closeCommentTail` re-emits
    // a newline after a comment run whether or not one was carried, so a bare
    // `%\nfoo` round-trips byte-identically either way and the leg above passes
    // on the broken carrier — measured. Leading whitespace has no such repair.
    const src = "A line that continues%\n    onto an indented line.\n";
    expect(twoCycles(src).bodyText).toBe(src.trim());
    // …and the run the carrier claimed stops AT the newline, never past it.
    expect(commentTailRuns(parseLatex(src))).toEqual(["%"]);
  });

  it("a tail already followed by a newline gains no second one", () => {
    // Byte-neutrality for everything the parser produces: it always reads a
    // tail up to (never across) a newline and leaves that newline at the head
    // of the next prose run.
    const src = "A long line that continues%\nonto the next line.\n";
    expect(twoCycles(src).bodyText).toBe(src.trim());
  });
});

describe("the carrier is refused where a line does not end", () => {
  it.each([
    ["a `\\texttt{}` argument", "Set \\texttt{a%b} here.\n"],
    ["a `\\textbf{}` argument", "Set \\textbf{a%b} here.\n"],
    ["a footnote body", "Prose.\\footnote{a%b}\n"],
    ["a heading", "\\section{a%b}\n"],
  ])("%s gets no comment tail", (_name, src) => {
    // The fail-closed default, and the load-bearing half of the design: a
    // comment tail owns everything to the end of its LINE, and inside a braced
    // argument the very next byte the serializer writes is the closing `}`. A
    // carrier there would comment out the brace and break the document, so the
    // escape stays correct in exactly those positions.
    expect(commentTailRuns(parseLatex(src))).toEqual([]);
    // …and, being escaped rather than carried, it is still a fixed point.
    const { bodyText } = twoCycles(src);
    expect(bodyText).toContain("\\%");
  });
});
