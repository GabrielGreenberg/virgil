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
 *   `italic` → `\emph{…}`, `smallCaps` → `\textsc{…}`, … — one row each in
 *   {@link WRAPPER_MARK_ROWS}.
 *
 * Both serializers used to decide the first question with an EARLY RETURN that
 * sat above the wrapper loop, so a run wearing both kinds of mark emitted only
 * its carrier and the wrapper was DELETED from the `.tex`. The parser appends a
 * formatting mark onto whatever its recursion returned, so that combination is
 * ordinary — `\textbf{\textsf{Smith}}` (sans-serif is unmodeled, hence a
 * carrier) came back as `\textsf{Smith}`, a fixed point from cycle 1, on OPEN.
 *
 * ── Why the composition is a RUN and not a node ──────────────────────────────
 *
 * Wrapping each node separately is correct for its own bytes and wrong for the
 * run: it splits one `\texttt{…}` into three, and a split that lands between an
 * argument-taking control symbol and its argument CHANGES WHAT THE COMMAND
 * TAKES. Measured pre-377: `\texttt{caf\'e}` → `\texttt{caf}\'\texttt{e}`,
 * where `\'` now takes `\texttt` as its argument. So the unit of wrapping is
 * the maximal adjacent run sharing one wrapper signature — which also restores
 * byte-identity for the common `\emph{a \textsf{b} c}` shape, and is the same
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
 * The WRAPPER-MARK VOCABULARY — one row per mark that encloses a run in a
 * LaTeX command, and the ONE place its parse and emit spellings live (task
 * 808).
 *
 * Before this table the EMIT side had an SSOT (the switch in
 * {@link applyWrapperMarks}) while the PARSE side was hand-coded three times —
 * five copy-pasted blocks in `latex-parser.ts`, a regex + ternary in
 * `footnote-content.ts`'s LaTeX reader, a tag chain in its HTML reader. Parse
 * and emit could therefore disagree, and did, three ways:
 *
 *  - `strike` existed in the editor (StarterKit mark, a toolbar button, a
 *    chord) with NO emit arm — struck text was written to the `.tex` unstruck;
 *  - `\textit{x}` parsed to `italic`, and `italic` emits `\emph` — the round
 *    trip rewrote the user's source;
 *  - `\textsc` (small caps) was on no list at all, so it fell to the raw-LaTeX
 *    carrier and never rendered.
 *
 * A row states everything a mark's LaTeX needs:
 *
 *  - `commands` — every command name the parsers claim for it, the EMIT
 *    spelling first. A row with more than one spelling records which one a run
 *    was parsed from in a `spelling` mark attr ({@link SPELLING_ATTR}), and the
 *    emit writes that spelling back — so `\textit{x}` and `\emph{x}` both
 *    round-trip byte-identically, and a newly TYPED italic (no attr) is `\emph`.
 *  - `opensCode` — the command OPENS a code span: typography is suppressed
 *    inside (`--` stays two hyphens, accent commands stay raw).
 *  - `package` — the requirement id its bytes need (the requirements SSOT in
 *    `latex-requirements.ts`), declared adjacent to the emit.
 *  - `colorArg` — the `[HTML]{RRGGBB}` argument grammar of `\textcolor`; the
 *    one row whose command takes a leading argument (and whose attr is part of
 *    the wrap signature).
 *  - `cardBody: false` — the mark is NOT in the card-body schema (textColor is
 *    excerpt-scope only), so the card/footnote reader must not produce it: a
 *    mark the card schema lacks makes TipTap mount an EMPTY doc
 *    (capture/schema-symmetry law). Pinned against the live schema by
 *    `mark-vocabulary.test.ts`.
 *  - `html` — the legacy/pasted HTML tags the footnote HTML reader maps to it.
 *
 * Adding a mark is one row here + its TipTap `Mark` + its schema
 * registrations (which the coverage suites enforce).
 *
 * `{\scshape …}` is deliberately NOT claimed by `smallCaps`: a declaration is
 * not a command, and claiming it would rewrite the source to `\textsc{…}` on
 * save — the very `\textit` defect this table retires. It stays raw LaTeX.
 */
export interface WrapperMarkRow {
  readonly mark: string;
  readonly commands: readonly [string, ...string[]];
  readonly opensCode?: boolean;
  readonly package?: string;
  readonly colorArg?: boolean;
  readonly cardBody?: false;
  readonly html?: readonly string[];
}

export const WRAPPER_MARK_ROWS = [
  { mark: "bold", commands: ["textbf"], html: ["strong", "b"] },
  { mark: "italic", commands: ["emph", "textit"], html: ["em", "i"] },
  { mark: "underline", commands: ["underline"], html: ["u"] },
  // `ulem`'s `\sout`. The package is loaded `[normalem]` (see its requirement
  // row) so it does not turn every `\emph` in the paper into an underline.
  {
    mark: "strike",
    commands: ["sout"],
    package: "ulem",
    html: ["s", "del", "strike"],
  },
  { mark: "smallCaps", commands: ["textsc"] },
  { mark: "code", commands: ["texttt"], opensCode: true, html: ["code"] },
  {
    mark: "textColor",
    commands: ["textcolor"],
    package: "xcolor",
    colorArg: true,
    cardBody: false,
  },
] as const satisfies readonly WrapperMarkRow[];

/**
 * The marks that WRAP a run — the table's `mark` column. Everything else on a
 * text node either describes how its own bytes are produced (the three
 * carriers) or is structural bookkeeping the sequence walker reads directly
 * (`linkedAnchor`).
 *
 * CI derives the census from the table: these commands may be spelled in
 * exactly one place, {@link applyWrapperMarks}.
 */
export const WRAPPER_MARK_TYPES = WRAPPER_MARK_ROWS.map((r) => r.mark);

export type WrapperMarkType = (typeof WRAPPER_MARK_ROWS)[number]["mark"];

const ROW_BY_MARK: ReadonlyMap<string, WrapperMarkRow> = new Map(
  WRAPPER_MARK_ROWS.map((r) => [r.mark, r as WrapperMarkRow]),
);

const ROW_BY_COMMAND: ReadonlyMap<string, WrapperMarkRow> = new Map(
  WRAPPER_MARK_ROWS.flatMap((r) =>
    (r.commands as readonly string[]).map((c) => [c, r as WrapperMarkRow] as const),
  ),
);

/** The wrapper row for a mark type, or `undefined` for a non-wrapper. */
export function wrapperRowFor(markType: string): WrapperMarkRow | undefined {
  return ROW_BY_MARK.get(markType);
}

/**
 * The mark attr recording WHICH of a row's spellings a run was parsed from.
 * Absent / null = the row's emit spelling (`commands[0]`), which is also what
 * a newly typed mark gets.
 */
export const SPELLING_ATTR = "spelling";

/** The marks that carry a {@link SPELLING_ATTR} (rows with more than one
 *  spelling) — the list the schema's global-attribute extension registers. */
export const SPELLING_MARK_TYPES: readonly string[] = WRAPPER_MARK_ROWS.filter(
  (r) => r.commands.length > 1,
).map((r) => r.mark);

/** The command a wrapper mark EMITS: its recorded spelling when that is one of
 *  the row's own, else the row's canonical spelling. */
function emitCommandFor(row: WrapperMarkRow, mark: MarkLike): string {
  const spelled = mark.attrs?.[SPELLING_ATTR];
  if (typeof spelled === "string" && row.commands.includes(spelled)) return spelled;
  return row.commands[0];
}

/** The `spelling` attrs a parse of `command` must stamp on its mark — empty for
 *  the canonical spelling, so a model built from `\emph` is attr-identical to
 *  one where the user pressed Mod-I. */
function spellingAttrsFor(row: WrapperMarkRow, command: string): Record<string, unknown> | undefined {
  return command === row.commands[0] ? undefined : { [SPELLING_ATTR]: command };
}

/** A wrapper command recognized at a position, with the mark it applies. */
export interface WrapperCommandMatch {
  readonly row: WrapperMarkRow;
  readonly mark: MarkLike;
  /** Index of the `{` that opens the wrapped body. */
  readonly bodyOpen: number;
}

const COLOR_ARG_RE = /^\[HTML\]\{([0-9A-Fa-f]{6})\}\{/;

/**
 * Is `text[i]` the start of a wrapper command this vocabulary models? The ONE
 * recognizer both inline parsers call (the `matchCiteCommandAt` /
 * `matchTextMacroAt` precedent). A command is claimed only when its body brace
 * follows the name directly (`\textbf{`); `\textcolor` additionally needs the
 * `[HTML]{RRGGBB}` form Virgil emits — a named colour (`\textcolor{red}{…}`)
 * stays raw LaTeX, bytes preserved.
 *
 * `scope: "card"` refuses the rows whose mark the card-body schema lacks
 * (`cardBody: false`), so they stay raw there instead of producing a mark
 * that would blank the body.
 */
export function matchWrapperCommandAt(
  text: string,
  i: number,
  opts?: { scope?: "doc" | "card" },
): WrapperCommandMatch | null {
  if (text[i] !== "\\") return null;
  let j = i + 1;
  while (j < text.length && isAsciiLetter(text.charCodeAt(j))) j++;
  if (j === i + 1) return null;
  const command = text.slice(i + 1, j);
  const row = ROW_BY_COMMAND.get(command);
  if (!row) return null;
  if (opts?.scope === "card" && row.cardBody === false) return null;
  if (row.colorArg) {
    const m = COLOR_ARG_RE.exec(text.slice(j, j + 14));
    if (!m) return null;
    return {
      row,
      mark: { type: row.mark, attrs: { color: `#${m[1].toUpperCase()}` } },
      bodyOpen: j + m[0].length - 1,
    };
  }
  if (text[j] !== "{") return null;
  const attrs = spellingAttrsFor(row, command);
  return { row, mark: attrs ? { type: row.mark, attrs } : { type: row.mark }, bodyOpen: j };
}

function isAsciiLetter(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

/**
 * The wrapper mark an HTML element denotes, for the footnote card's legacy
 * HTML reader: a row's `html` tags, plus small caps written the way the web
 * writes it (`font-variant(-caps): small-caps`, or the mark's own
 * `span[data-small-caps]`). Card scope — never a `cardBody: false` row.
 */
export function wrapperMarkForHtmlElement(el: {
  tagName: string;
  getAttribute(name: string): string | null;
}): MarkLike | null {
  const tag = el.tagName.toLowerCase();
  for (const row of WRAPPER_MARK_ROWS as readonly WrapperMarkRow[]) {
    if (row.cardBody === false) continue;
    if (row.html?.includes(tag)) return { type: row.mark };
  }
  if (el.getAttribute("data-small-caps") !== null) return { type: "smallCaps" };
  if (isSmallCapsStyle(el.getAttribute("style"))) return { type: "smallCaps" };
  return null;
}

/** Does an inline `style` declare small caps? (`font-variant: small-caps` or
 *  `font-variant-caps: small-caps` / `all-small-caps`). Shared by the small-caps
 *  mark's own `parseHTML` and the footnote HTML reader. */
export function isSmallCapsStyle(style: string | null | undefined): boolean {
  return !!style && /font-variant(?:-caps)?\s*:\s*[^;]*\b(?:all-)?small-caps\b/i.test(style);
}

/** The wrapper subset of a node's marks, in the node's own order — which is
 *  the nesting order the emit applies (innermost first). */
export function wrapperMarksOf(marks?: MarkLike[] | null): MarkLike[] {
  if (!marks || marks.length === 0) return [];
  return marks.filter((m) => ROW_BY_MARK.has(m.type));
}

/** True when the run sits inside a code span — a row that OPENS one
 *  (`\texttt{}`), the one wrapper that changes how the INNER bytes are
 *  produced (typography is suppressed: `--` is two literal hyphens, accent
 *  commands stay raw). */
export function isCodeWrapped(marks?: MarkLike[] | null): boolean {
  return !!marks && marks.some((m) => ROW_BY_MARK.get(m.type)?.opensCode === true);
}

/**
 * The signature two adjacent nodes must share to be wrapped together. Includes
 * ORDER (it is the nesting order), `textColor`'s attrs (two different colours
 * are two different wrappers) and a recorded spelling (`\emph{a}\textit{b}` is
 * two wrappers, not one).
 */
export function markWrapSignature(marks?: MarkLike[] | null): string {
  const wrappers = wrapperMarksOf(marks);
  if (wrappers.length === 0) return "";
  return wrappers
    .map((m) => {
      const row = ROW_BY_MARK.get(m.type)!;
      if (row.colorArg) return `${m.type}:${String(m.attrs?.color ?? "")}`;
      const cmd = emitCommandFor(row, m);
      return cmd === row.commands[0] ? m.type : `${m.type}:${cmd}`;
    })
    .join("|");
}

/**
 * Wrap already-produced inner bytes in this run's wrapper commands.
 *
 * ORDER, stated because it is load-bearing: the inner bytes arrive ALREADY
 * escaped (or deliberately unescaped, for a carrier) — this function must
 * never re-escape them, and never runs typography.
 *
 * `declare` is the main serializer's package declaration (a row's `package`),
 * kept adjacent to the byte emit (the requirements-by-emission rule). The
 * card/footnote fork passes nothing: it emits into a `\footnote{}` argument
 * inside a document whose preamble the main serializer declares — and the main
 * serializer's footnote arm threads its own `declare` through
 * `richJsonToLatex`, so a struck footnote still declares `ulem`.
 */
export function applyWrapperMarks(
  inner: string,
  marks?: MarkLike[] | null,
  opts?: { declare?: (requirementId: string) => void },
): string {
  let result = inner;
  for (const mark of wrapperMarksOf(marks)) {
    const row = ROW_BY_MARK.get(mark.type)!;
    if (row.colorArg) {
      const c = (mark.attrs?.color as string | undefined) ?? "";
      // \textcolor[HTML] expects 6 uppercase hex digits, no leading "#".
      const hex = c.replace(/^#/, "").toUpperCase();
      if (!/^[0-9A-F]{6}$/.test(hex)) continue;
      result = `\\${row.commands[0]}[HTML]{${hex}}{${result}}`;
    } else {
      result = `\\${emitCommandFor(row, mark)}{${result}}`;
    }
    if (row.package) opts?.declare?.(row.package);
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
    declare?: (requirementId: string) => void;
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
    out += applyWrapperMarks(groupInner, groupMarks, { declare: spec.declare });
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
