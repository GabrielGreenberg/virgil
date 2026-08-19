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
 *  - `standalone(node)` — a node that may never join a run (the comment-tail
 *    carrier owns the rest of its LINE, so anything merged after it inside a
 *    wrapper's braces would be commented out, closing brace included). Returning
 *    a string flushes the current group and emits it whole.
 *  - `outerPrefix(node)` — bytes that must sit OUTSIDE any wrapper immediately
 *    before this node (the main serializer's `\vlid` / `\vlidend` anchor
 *    transitions). A non-empty result breaks the group, which is exactly the
 *    pre-377 marker placement: an anchor transition has always separated two
 *    wrapped runs rather than landing inside one.
 */
export function composeInlineRun<N extends { marks?: MarkLike[] | null }>(
  nodes: readonly N[],
  spec: {
    inner: (node: N, index: number) => string;
    standalone?: (node: N, index: number) => string | null;
    outerPrefix?: (node: N, index: number) => string;
    declareXcolor?: () => void;
  },
): string {
  let out = "";
  let groupSig: string | null = null;
  let groupMarks: MarkLike[] | null = null;
  let groupInner = "";

  const flush = () => {
    if (groupSig === null) return;
    out += applyWrapperMarks(groupInner, groupMarks, {
      declareXcolor: spec.declareXcolor,
    });
    groupSig = null;
    groupMarks = null;
    groupInner = "";
  };

  for (const [index, node] of nodes.entries()) {
    const whole = spec.standalone?.(node, index) ?? null;
    if (whole !== null) {
      flush();
      out += whole;
      continue;
    }
    const prefix = spec.outerPrefix?.(node, index) ?? "";
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
    groupInner += spec.inner(node, index);
  }
  flush();
  return out;
}
