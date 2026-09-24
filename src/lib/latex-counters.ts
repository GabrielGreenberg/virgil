/**
 * LATEX COUNTERS IN RAW SOURCE — which `\label`s a stretch of raw LaTeX
 * declares, and which counter (if any) each one takes its number from
 * (task 742).
 *
 * Virgil models headings, examples and `figureBlock`s as nodes that carry
 * their own labels and numbers (`ref-display.ts`). Everything else that
 * declares a label does so in RAW SOURCE: the `latex` of a `displayMath`
 * atom (`\[…\]`), and the byte-literal carrier paragraph an unmodelled
 * environment rides (`\begin{equation}…\end{equation}`, `align`, a `table`
 * float). The ref picker has always LISTED those labels, but nothing
 * numbered them, so every `\ref` to one rendered the "broken reference" `??`.
 *
 * This leaf states LaTeX's own rules, once, over a string:
 *
 *   • `equation` / `multline` — ONE number for the environment;
 *     `align` / `gather` / `flalign` / `alignat` / `eqnarray` — one number per
 *     ROW (a top-level `\\`), a trailing empty row taking none. A starred form
 *     numbers nothing; `\nonumber` / `\notag` suppress one row; `\tag{x}`
 *     shows `x` without stepping the counter.
 *   • `\[…\]` (a `displayMath`) is unnumbered — only a `\tag` names it.
 *   • `figure` / `table` (starred too) step their counter at each `\caption`
 *     (never `\caption*`); a label after a caption takes that caption's number.
 *   • Any other `\label` takes `\@currentlabel` — which, because every
 *     environment is a TeX group, is the enclosing unit's number inside one
 *     and otherwise the last numbered heading. The scanner reports such a
 *     label as `inherit`, with the in-environment number when it has one; the
 *     index supplies the heading.
 *
 * Pure and TipTap-free: the parser (JSON) and the live numberer (ProseMirror)
 * both reach it through `buildRefTargetIndex`, the ONE table a `\ref` reads.
 *
 * Residuals (stated, not silently wrong): `subequations` (3a, 3b) and
 * `\numberwithin` / per-section equation numbering are not modelled — an
 * equation inside `subequations` takes a plain sequential number; `subfigure`
 * / `\subcaption` sub-numbers likewise.
 */

/** Node types whose text is source that declares NOTHING to LaTeX: verbatim
 *  (`codeBlock`) and commented-out lines (`latexComment`). The index walk and
 *  the numberer's gate both read this one set. */
export const RAW_SOURCE_INERT_NODE_TYPES: ReadonlySet<string> = new Set(["codeBlock", "latexComment"]);

export type RawCounter = "equation" | "figure" | "table";

export type RawCounterEvent =
  /** A numbered unit: one equation row, one float caption. `tag` set → the
   *  unit shows `tag` and steps NO counter. */
  | { type: "unit"; counter: RawCounter; tag: string | null; labels: string[] }
  /** A label no unit numbers. `local` is the number of the preceding unit in
   *  the same environment (its TeX group), or null → the last heading's. */
  | { type: "inherit"; key: string; local: RawLocal | null };

/** Refers back to an earlier `unit` event of THIS scan by index. */
export interface RawLocal {
  unitIndex: number;
}

const MULTI_ROW_ENVS = new Set(["align", "gather", "flalign", "alignat", "eqnarray", "xalignat"]);
const SINGLE_ENVS = new Set(["equation", "multline"]);
const FLOAT_ENVS: Record<string, RawCounter> = { figure: "figure", table: "table" };

/** Whether `text` could declare or number anything — the O(1)-ish pre-check
 *  every caller (and the numberer's per-keystroke gate) asks first. */
export function mayDeclareRawCounters(text: string): boolean {
  return text.includes("\\label") || text.includes("\\begin") || text.includes("\\tag");
}

/** Remove `%` comments (an escaped `\%` is text). Keeps line structure. */
function stripComments(src: string): string {
  if (!src.includes("%")) return src;
  return src.replace(/(^|[^\\])%[^\n]*/g, "$1");
}

/** The `{…}` argument opening at `open` (which must be `{`), brace-balanced. */
function bracedArg(src: string, open: number): { value: string; end: number } | null {
  if (src[open] !== "{") return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return { value: src.slice(open + 1, i), end: i + 1 };
    }
  }
  return null;
}

const LABEL_RE = /\\label\{([^}]*)\}/g;

function labelsIn(src: string): string[] {
  const out: string[] = [];
  LABEL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LABEL_RE.exec(src)) !== null) if (m[1]) out.push(m[1]);
  return out;
}

/** `\tag{x}` / `\tag*{x}` → `x`, else null. */
function tagIn(src: string): string | null {
  const m = /\\tag\*?\s*(?=\{)/.exec(src);
  if (!m) return null;
  const arg = bracedArg(src, m.index + m[0].length);
  return arg ? arg.value.trim() : null;
}

const SUPPRESS_RE = /\\(?:nonumber|notag)(?![a-zA-Z])/;

/** Split an alignment body at its TOP-LEVEL `\\` — not inside braces, not
 *  inside a nested `\begin…\end` (an `aligned` / `cases` / matrix row). */
function splitRows(body: string): string[] {
  const rows: string[] = [];
  let depth = 0;
  let envDepth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "{") depth++;
    else if (c === "}") depth = Math.max(0, depth - 1);
    else if (c === "\\") {
      if (body.startsWith("\\begin{", i)) {
        envDepth++;
        i += 6;
        continue;
      }
      if (body.startsWith("\\end{", i)) {
        envDepth = Math.max(0, envDepth - 1);
        i += 4;
        continue;
      }
      if (body[i + 1] === "\\") {
        if (depth === 0 && envDepth === 0) {
          rows.push(body.slice(start, i));
          start = i + 2;
        }
        i++;
        continue;
      }
      i++; // skip the escaped character (`\{`, `\}`, `\%`, …)
    }
  }
  rows.push(body.slice(start));
  // amsmath: a final `\\` opens no numbered row of its own.
  if (rows.length > 1 && rows[rows.length - 1].replace(/^\*?(\[[^\]]*\])?/, "").trim() === "") {
    rows.pop();
  }
  return rows;
}

/** One equation-like row (or a whole single-number env) → its events. */
function pushMathUnit(
  out: RawCounterEvent[],
  src: string,
  numbered: boolean,
  lastUnit: number | null,
): number | null {
  const labels = labelsIn(src);
  const tag = tagIn(src);
  if (tag !== null || (numbered && !SUPPRESS_RE.test(src))) {
    out.push({ type: "unit", counter: "equation", tag, labels });
    return out.length - 1;
  }
  for (const key of labels) {
    out.push({ type: "inherit", key, local: lastUnit == null ? null : { unitIndex: lastUnit } });
  }
  return lastUnit;
}

function scanFloat(out: RawCounterEvent[], body: string, counter: RawCounter): void {
  const re = /\\caption(\*?)|\\label\{([^}]*)\}/g;
  let current: number | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (m[2] !== undefined) {
      const key = m[2];
      if (!key) continue;
      const u = current == null ? null : out[current];
      if (u && u.type === "unit") u.labels.push(key);
      else out.push({ type: "inherit", key, local: null });
    } else if (m[1] !== "*") {
      out.push({ type: "unit", counter, tag: null, labels: [] });
      current = out.length - 1;
    }
  }
}

/**
 * The counter events of a `displayMath` atom's `latex` (`\[…\]`, unnumbered).
 */
export function scanDisplayMathCounters(latex: string): RawCounterEvent[] {
  if (!mayDeclareRawCounters(latex)) return [];
  const out: RawCounterEvent[] = [];
  pushMathUnit(out, stripComments(latex), false, null);
  return out;
}

/**
 * The counter events of raw LaTeX TEXT (a verbatim carrier, a raw-tex
 * paragraph, a stray `\label` in prose), in source order.
 */
export function scanRawTextCounters(text: string): RawCounterEvent[] {
  if (!mayDeclareRawCounters(text)) return [];
  const src = stripComments(text);
  const out: RawCounterEvent[] = [];
  const re = /\\begin\{([a-zA-Z]+)(\*?)\}|\\label\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m[3] !== undefined) {
      if (m[3]) out.push({ type: "inherit", key: m[3], local: null });
      continue;
    }
    const name = m[1];
    const starred = m[2] === "*";
    const isMulti = MULTI_ROW_ENVS.has(name);
    const isSingle = SINGLE_ENVS.has(name);
    const float = FLOAT_ENVS[name];
    if (!isMulti && !isSingle && !float) continue; // scan on INSIDE it
    const closer = `\\end{${name}${starred ? "*" : ""}}`;
    const bodyStart = re.lastIndex;
    const close = src.indexOf(closer, bodyStart);
    const bodyEnd = close === -1 ? src.length : close;
    let body = src.slice(bodyStart, bodyEnd);
    // `alignat{n}` / `xalignat{n}` take a column-count argument first.
    if (name === "alignat" || name === "xalignat") {
      const arg = bracedArg(body, body.search(/\S/));
      if (arg) body = body.slice(arg.end);
    }
    if (float) {
      scanFloat(out, body, float);
    } else if (isSingle) {
      pushMathUnit(out, body, !starred, null);
    } else {
      let last: number | null = null;
      for (const row of splitRows(body)) last = pushMathUnit(out, row, !starred, last);
    }
    re.lastIndex = close === -1 ? src.length : close + closer.length;
  }
  return out;
}

/**
 * A compact signature of what `text` / `latex` declares and numbers — equal
 * signatures mean the block's contribution to every counter and label is
 * unchanged. The numberer compares one block's signature per keystroke
 * (O(block)) to decide whether the O(doc) renumber is owed at all.
 */
export function rawCounterSignature(events: readonly RawCounterEvent[]): string {
  if (events.length === 0) return "";
  return events
    .map((e) =>
      e.type === "unit"
        ? `${e.counter[0]}${e.tag === null ? "" : `[${e.tag}]`}:${e.labels.join(",")}`
        : `i${e.local ? e.local.unitIndex : ""}:${e.key}`,
    )
    .join("|");
}
