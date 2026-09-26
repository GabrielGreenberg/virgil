/**
 * How a run of inline nodes composes its MARKS into `.tex` bytes — the one
 * answer, read by both inline serializers (task 377).
 *
 * ── The distinction this module exists to make ───────────────────────────────
 *
 * A text run's marks answer two DIFFERENT questions, and conflating them is
 * what deleted the user's commands:
 *
 *   CARRIER marks answer *how are this run's own bytes produced?* —
 *   byte-literal (`latexVerbatim`), raw-LaTeX-with-smart-quotes
 *   (`latexCommand`), not-typeset-at-all (`latexCommentTail`). They say
 *   nothing about what wraps the run.
 *
 *   WRAPPER marks answer *what encloses it?* — `bold` → `\textbf{…}`,
 *   `italic` → `\emph{…}`, `underline`, `code` → `\texttt{…}`,
 *   `textColor` → `\textcolor[HTML]{…}{…}`.
 *
 * Both serializers used to decide the first question with an EARLY RETURN that
 * sat above the wrapper loop, so a run wearing both kinds of mark emitted only
 * its carrier and the wrapper was DELETED from the `.tex`. The parser appends a
 * formatting mark onto whatever its recursion returned, so that combination is
 * ordinary — `\textbf{\textsc{Smith}}` (small caps is unmodeled, hence a
 * carrier) came back as `\textsc{Smith}`, a fixed point from cycle 1, on OPEN.
 *
 * ── Why the composition is a RUN and not a node ──────────────────────────────
 *
 * Wrapping each node separately is correct for its own bytes and wrong for the
 * run: it splits one `\texttt{…}` into three, and a split that lands between an
 * argument-taking control symbol and its argument CHANGES WHAT THE COMMAND
 * TAKES. Measured pre-377: `\texttt{caf\'e}` → `\texttt{caf}\'\texttt{e}`,
 * where `\'` now takes `\texttt` as its argument. So the unit of wrapping is
 * the maximal adjacent run sharing one wrapper signature — which also restores
 * byte-identity for the common `\emph{a \textsc{b} c}` shape, and is the same
 * "produce the inner bytes, then wrap once" law stated for both files.
 *
 * Consequence worth stating: two adjacent runs the model happens to keep as
 * separate nodes with identical wrapper marks (`\textbf{a}\textbf{b}`) merge to
 * `\textbf{ab}`. That is a one-time, idempotent normalization of the kind the
 * serializer already performs elsewhere, and it typesets identically.
 *
 * ── Placement ────────────────────────────────────────────────────────────────
 *
 * An import-free leaf, for the reason `latex-markers.ts` and `node-attr-sets.ts`
 * each earned: a facet the layer that needs it cannot import will be re-copied.
 * `footnote-content.ts` is a SECOND inline serializer (task 341's twin rule) and
 * had its own byte-for-byte copy of the switch, the early returns and the
 * per-node wrapping.
 */

export type MarkLike = { type: string; attrs?: Record<string, unknown> };

/**
 * The marks that WRAP a run. Everything else on a text node either describes
 * how its own bytes are produced (the three carriers) or is structural
 * bookkeeping the sequence walker reads directly (`linkedAnchor`).
 *
 * CI derives the census from this list: these five commands may be spelled in
 * exactly one place, {@link applyWrapperMarks}.
 */
export const WRAPPER_MARK_TYPES = [
  "bold",
  "italic",
  "underline",
  "code",
  "textColor",
] as const;

export type WrapperMarkType = (typeof WRAPPER_MARK_TYPES)[number];

const WRAPPER_MARK_SET: ReadonlySet<string> = new Set(WRAPPER_MARK_TYPES);

/** The wrapper subset of a node's marks, in the node's own order — which is
 *  the nesting order the emit applies (innermost first). */
export function wrapperMarksOf(marks?: MarkLike[] | null): MarkLike[] {
  if (!marks || marks.length === 0) return [];
  return marks.filter((m) => WRAPPER_MARK_SET.has(m.type));
}

/** True when the run sits inside a `\texttt{}` code span — the one wrapper that
 *  changes how the INNER bytes are produced (typography is suppressed: `--` is
 *  two literal hyphens, accent commands stay raw). */
export function isCodeWrapped(marks?: MarkLike[] | null): boolean {
  return !!marks && marks.some((m) => m.type === "code");
}

/**
 * The signature two adjacent nodes must share to be wrapped together. Includes
 * ORDER (it is the nesting order) and `textColor`'s attrs (two different
 * colours are two different wrappers).
 */
export function markWrapSignature(marks?: MarkLike[] | null): string {
  const wrappers = wrapperMarksOf(marks);
  if (wrappers.length === 0) return "";
  return wrappers
    .map((m) =>
      m.type === "textColor"
        ? `textColor:${String(m.attrs?.color ?? "")}`
        : m.type,
    )
    .join("|");
}

/**
 * Wrap already-produced inner bytes in this run's wrapper commands.
 *
 * ORDER, stated because it is load-bearing: the inner bytes arrive ALREADY
 * escaped (or deliberately unescaped, for a carrier) — this function must
 * never re-escape them, and never runs typography.
 *
 * `declareXcolor` is the main serializer's package declaration, kept adjacent
 * to the byte emit (the requirements-by-emission rule). The card/footnote fork
 * passes nothing: it emits into a `\footnote{}` argument inside a document
 * whose preamble the main serializer already declares.
 */
export function applyWrapperMarks(
  inner: string,
  marks?: MarkLike[] | null,
  opts?: { declareXcolor?: () => void },
): string {
  let result = inner;
  for (const mark of wrapperMarksOf(marks)) {
    switch (mark.type as WrapperMarkType) {
      case "bold":
        result = `\\textbf{${result}}`;
        break;
      case "italic":
        result = `\\emph{${result}}`;
        break;
      case "underline":
        result = `\\underline{${result}}`;
        break;
      case "code":
        result = `\\texttt{${result}}`;
        break;
      case "textColor": {
        const c = (mark.attrs?.color as string | undefined) ?? "";
        // \textcolor[HTML] expects 6 uppercase hex digits, no leading "#".
        const hex = c.replace(/^#/, "").toUpperCase();
        if (/^[0-9A-F]{6}$/.test(hex)) {
          result = `\\textcolor[HTML]{${hex}}{${result}}`;
          opts?.declareXcolor?.();
        }
        break;
      }
    }
  }
  return result;
}

/**
 * Walk an inline sequence, emitting each maximal adjacent run of nodes that
 * share a wrapper signature as ONE wrapped group.
 *
 * The two callers differ in what a node's inner bytes ARE and in what
 * bookkeeping rides alongside, so those are the spec's business; the grouping
 * rule is this module's and is not re-derived per file.
 *
 *  - `inner(node)` — the node's bytes WITHOUT its wrapper marks.
 *  - `outerPrefix(node)` — bytes that must sit OUTSIDE any wrapper immediately
 *    before this node (the main serializer's `\vlid` / `\vlidend` anchor
 *    transitions). A non-empty result breaks the group, which is exactly the
 *    pre-377 marker placement: an anchor transition has always separated two
 *    wrapped runs rather than landing inside one. Never asked of a comment
 *    tail — a tail carries no anchor bookkeeping (closing a range across a
 *    comment is not representable), so it leaves the open set as it found it.
 *  - `trailer()` — bytes the CALLER appends after the whole sequence (the
 *    main serializer's still-open `\vlidend`s). Routed through here only so
 *    the comment rule below sees them.
 *  - `lineFinal` — the caller's promise that what it writes after this
 *    sequence (and after `trailer`) is comment bytes and then a newline, so a
 *    tail that ENDS the sequence outside every wrapper may end the line itself.
 *
 * ## The comment rule is this walker's, not a caller's (task 777)
 *
 * A `latexCommentTail` node owns the rest of its LINE, at every depth — inside
 * `\emph{…}` exactly as in a paragraph, because that is TeX's own rule. So the
 * one invariant that makes a raw `%` safe to emit is: **the byte written right
 * after a tail is a newline.** The walker discharges it at the ONLY place that
 * knows what comes next:
 *
 *  - the next node's inner bytes begin with `\n` → that newline is the user's
 *    own, and it is placed immediately after the tail (before any prefix or
 *    brace), so a tail joins a wrapped run like any node:
 *    `\emph{a% note\n b}` stays one `\emph`;
 *  - anything else follows (text, an atom, a prefix, a wrapper's closing
 *    brace, the trailer) → a newline is INSERTED, the fail-safe that keeps
 *    the brace live (`\emph{a% note}` comes back `\emph{a% note\n}`);
 *  - nothing follows and `lineFinal` holds → nothing is added.
 *
 * Before 777 the tail was a `standalone` node that broke every run, which
 * split `\emph{a% note\n b}` into `\emph{a}% note\emph{\n b}` — commenting
 * out the second `\emph{` — and the parser therefore had to refuse tails
 * inside arguments altogether, which escaped the user's comment into printed
 * text. A tail's own internal newlines (a model edit) are re-commented.
 */
export function composeInlineRun<N extends { marks?: MarkLike[] | null }>(
  nodes: readonly N[],
  spec: {
    inner: (node: N, index: number) => string;
    outerPrefix?: (node: N, index: number) => string;
    trailer?: () => string;
    lineFinal?: boolean;
    declareXcolor?: () => void;
  },
): string {
  let out = "";
  let groupSig: string | null = null;
  let groupMarks: MarkLike[] | null = null;
  let groupInner = "";
  // A tail was the last thing written and its line is still open.
  let tailOpen = false;

  const flush = () => {
    if (groupSig === null) return;
    out += applyWrapperMarks(groupInner, groupMarks, {
      declareXcolor: spec.declareXcolor,
    });
    groupSig = null;
    groupMarks = null;
    groupInner = "";
  };

  /** Close an open tail's line where the tail sits (the current group, whose
   *  wrapper — if any — has not closed yet). */
  const closeTailLine = () => {
    if (!tailOpen) return;
    if (groupSig !== null) groupInner += "\n";
    else out += "\n";
    tailOpen = false;
  };

  for (const [index, node] of nodes.entries()) {
    const isTail = hasCommentTailMark(node.marks);
    let inner = spec.inner(node, index);
    if (isTail) inner = inner.split("\n").join("\n%");
    if (tailOpen) {
      // The user's own newline moves up to sit right after the tail — before
      // any prefix or closing brace this node's position would put there.
      if (inner.startsWith("\n")) inner = inner.slice(1);
      closeTailLine();
    }
    const prefix = isTail ? "" : (spec.outerPrefix?.(node, index) ?? "");
    if (prefix) {
      flush();
      out += prefix;
    }
    const sig = markWrapSignature(node.marks);
    if (groupSig !== null && groupSig !== sig) flush();
    if (groupSig === null) {
      groupSig = sig;
      groupMarks = node.marks ?? null;
    }
    groupInner += inner;
    tailOpen = isTail;
  }
  const trailer = spec.trailer?.() ?? "";
  if (tailOpen && !(spec.lineFinal && trailer === "" && groupSig === "")) {
    closeTailLine();
  }
  flush();
  return out + trailer;
}

/**
 * The `%`-comment carrier's mark NAME — spelled HERE, in the import-free leaf,
 * because the run walker above must recognize a tail and cannot import the
 * lexer (task 777). `latex-lexer.ts`'s `LATEX_COMMENT_TAIL_MARK` is defined as
 * this constant, so there is still exactly one spelling.
 */
export const COMMENT_TAIL_MARK_NAME = "latexCommentTail";

function hasCommentTailMark(marks?: MarkLike[] | null): boolean {
  return !!marks?.some((m) => m.type === COMMENT_TAIL_MARK_NAME);
}
