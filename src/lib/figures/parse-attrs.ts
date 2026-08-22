// Pure parsing helpers for `\begin{figure}...\end{figure}` envs and bare
// `\includegraphics` commands. Used by the LaTeX parser to extract
// structured attrs that drive figure display, and by the tex-mode popover
// to re-extract attrs when the user edits the source.

export interface FigureSource {
  /** Path argument of `\includegraphics{...}` — may lack an extension. */
  path: string;
  /** Raw options string from `\includegraphics[...]{}` — empty if none. */
  options: string;
  /** width as a CSS-percentage if expressed as a fraction of \textwidth /
   *  \linewidth / \columnwidth, otherwise null. */
  widthPercent: number | null;
}

export interface FigureAttrs {
  /** First / only `\includegraphics` body. Convenience for the common case. */
  source: string | null;
  /** Width-spec of the first `\includegraphics`, as percentage of column. */
  widthPercent: number | null;
  /** All `\includegraphics` found inside the env (for subfigures). */
  sources: FigureSource[];
  /** `\caption{...}` body verbatim (LaTeX text, not parsed). Empty string if none. */
  caption: string;
  /** Whether the env carried a `\caption` COMMAND at all — the fact `caption`
   *  alone cannot express, since `\caption{}` and no caption both read as "".
   *  In LaTeX they are not the same document: a caption-less figure is
   *  unnumbered and absent from the List of Figures, while `\caption{}`
   *  consumes a figure number and adds a blank LoF row. The emitter reads this
   *  rather than guessing from the caption child's presence (task 319). */
  hasCaption: boolean;
  /** Optional `\caption[<short>]` list-of-figures argument, raw/opaque. Null if
   *  the caption had no `[short]` bracket (task 263). */
  shortCaption: string | null;
  /** Did the source write `\caption*`? In LaTeX that is precisely an
   *  UNNUMBERED float, which is the `numbered` attr's own meaning — so the
   *  parser sets `numbered: !captionStarred` and the emitter writes the star
   *  back from it (task 376 M4). One fact, one carrier. */
  captionStarred: boolean;
  /** `\label{...}` body. Empty string if none. */
  label: string;
  /** Env body BEFORE the figure's own `\caption` (minus the figure's own
   *  `\caption`/binding `\label`), raw passthrough. Preserves `\centering`,
   *  `\includegraphics`, TikZ blocks, sub-floats and raw comments — so the
   *  serializer can rebuild the env from
   *  `extras + \caption + \label + trailingExtras` without losing unmodeled
   *  content. Empty when the env was just caption+label. */
  extras: string;
  /** Env body AFTER the figure's own `\caption` (same strip), raw passthrough
   *  — re-emitted after the caption/label block so bytes the model cannot hold
   *  keep the POSITION the author gave them (task 379).
   *
   *  The split is what makes multiplicity safe. A figure may carry a second
   *  figure-depth `\label`, or (illegally but really) a second `\caption`, and
   *  the model holds exactly one of each. Before the split those extra bytes
   *  were either DELETED (labels) or re-emitted ahead of the caption (a second
   *  caption), where they swapped places on every save — an oscillation on a
   *  document nobody edited. Carrying them on the side they were written on is
   *  the same "carry what you cannot model, in the position it was in" rule
   *  tasks 342/356 established, made position-aware.
   *
   *  A label that MOVES across the caption does not merely move: `\caption`
   *  calls `\refstepcounter{figure}`, so a `\label` written after it names the
   *  figure and the same bytes written before it name whatever counter was
   *  stepped last (usually the section). Re-emitting on the wrong side would
   *  silently change what a key names. */
  trailingExtras: string;
}

export interface GraphicsAttrs {
  /** The full verbatim command, e.g. `\includegraphics[width=0.5\textwidth]{fig}`. */
  command: string;
  /** Path argument. */
  source: string;
  /** Width-spec as percentage if expressible, else null. */
  widthPercent: number | null;
}

/** Find the body of the next `\caption{...}` (balanced braces) starting at
 *  pos in src, or null if there isn't one. */
function findBracedBody(src: string, openPos: number): { body: string; end: number } | null {
  if (src[openPos] !== "{") return null;
  let depth = 1;
  let i = openPos + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\" && i + 1 < src.length) {
      i += 2;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { body: src.slice(openPos + 1, i), end: i + 1 };
    }
    i++;
  }
  return null;
}

/** Parse a width=… directive into a CSS percentage. Returns null if the
 *  width is absolute (cm, in, pt) or absent. */
export function parseWidthSpec(options: string): number | null {
  if (!options) return null;
  // Match width=<number>\textwidth / \linewidth / \columnwidth
  const m = options.match(/width\s*=\s*([0-9.]+)\s*\\(textwidth|linewidth|columnwidth)/);
  if (m) {
    const frac = parseFloat(m[1]);
    if (!isNaN(frac) && frac > 0) return Math.min(100, frac * 100);
  }
  return null;
}

/** Extract a `\includegraphics[opts]{path}` match starting at `pos` in `src`.
 *  Returns the match and its end index, or null if no graphics command is
 *  present at this position. */
export function matchIncludegraphics(
  src: string,
  pos: number,
): { command: string; options: string; path: string; end: number } | null {
  // Tolerate \includegraphics with optional [opts] and required {path}.
  if (!src.startsWith("\\includegraphics", pos)) return null;
  let i = pos + "\\includegraphics".length;
  let options = "";
  // Optional star (e.g. \includegraphics*)? Rare but harmless to swallow.
  if (src[i] === "*") i++;
  // Optional [options], possibly multiple
  while (src[i] === "[") {
    const close = src.indexOf("]", i);
    if (close === -1) return null;
    options += src.slice(i, close + 1);
    i = close + 1;
  }
  if (src[i] !== "{") return null;
  const braced = findBracedBody(src, i);
  if (!braced) return null;
  return {
    command: src.slice(pos, braced.end),
    options: options.replace(/^\[|\]$/g, ""),
    path: braced.body,
    end: braced.end,
  };
}

/**
 * **Where the READER stops** consuming the `\includegraphics` a carried
 * `graphicsBlock.command` opens — the index just past its `{path}` group, or
 * `null` when the bytes open no graphics command at all.
 *
 * The {@link CarriedConstructEnd} the `graphicsBlock` emitter supplies to
 * `anchorCarriedBody` (task 405): the parser's own question — it builds the
 * node from this very matcher — asked at the emit site, so the place the
 * `%!v:` anchor is APPENDED and the place it is DETACHED coincide by
 * construction. `null` there is the honest answer rather than a gap: bytes
 * that open no `\includegraphics` come back as prose, not as a
 * `graphicsBlock`, so the node's identity is not going to survive the reload
 * whatever we do, and appending the anchor only decides WHO steals it.
 */
export function graphicsCommandEnd(bytes: string): number | null {
  const start = bytes.search(/\S/);
  if (start === -1) return null;
  return matchIncludegraphics(bytes, start)?.end ?? null;
}

/** Walk an env body string and pull out all `\includegraphics` commands. */
export function extractFigureSources(envContent: string): FigureSource[] {
  const sources: FigureSource[] = [];
  let i = 0;
  while (i < envContent.length) {
    const idx = envContent.indexOf("\\includegraphics", i);
    if (idx === -1) break;
    const m = matchIncludegraphics(envContent, idx);
    if (!m) {
      i = idx + 1;
      continue;
    }
    sources.push({
      path: m.path,
      options: m.options,
      widthPercent: parseWidthSpec(m.options),
    });
    i = m.end;
  }
  return sources;
}

// ---------------------------------------------------------------------------
// Where a command LIVES decides whether it is the figure's own (task 245)
//
// `caption` / `label` used to be found by `indexOf("\\caption")` and a
// `/\\label\{…\}/` regex — first match anywhere in the body. That is blind to
// three kinds of containment, and each one produced a NON-IDEMPOTENT
// round-trip, because the extractor and the serializer disagreed about which
// bytes had been consumed:
//
//   1. A SUB-FLOAT ENVIRONMENT. `\begin{subfigure}…\caption{Sub A}…\end{subfigure}`
//      handed its subcaption up to the figure, leaving the real
//      `\caption{Main}` behind in `extras` — so the serializer emitted BOTH,
//      at figure level, and the two swapped places on every save. The
//      subcaption was permanently detached from its subfigure, and the global
//      `\label` strip deleted the figure's own `\label` outright.
//   2. A COMMENT. `% \caption{TODO write me}` above a real caption won, with
//      the identical two-caption oscillation.
//   3. INLINE VERBATIM. A `%` inside `\verb|%|` read as a comment start and
//      blinded the rest of that line.
//
// So one lexical scan answers "where does this live?" for both commands at
// once, and every hit is reported with the byte range it occupies so `extras`
// can strip EXACTLY what the serializer re-emits. Anything inside a sub-float
// is never touched: it rides along in `extras` byte-raw, which is what keeps a
// subfigure intact without Virgil having to model subfigures.
//
// TWO RULES KEEP THE SCAN FROM OVER-REACHING, both learned from the adversarial
// review of the first cut, where a *blind* `\begin`/`\end` depth counter was
// strictly worse than the `indexOf` it replaced:
//
//   • DEPTH COUNTS ONLY CAPTION-OWNING ENVIRONMENTS. `center`, `minipage`,
//     `adjustbox` are boxes, not floats: LaTeX binds a `\caption` inside them
//     to the enclosing `figure`, and `\begin{center}…\caption{Foo}…\end{center}`
//     is a *very* common idiom. Counting them hid the figure's own caption in
//     `extras` while the always-present caption child still emitted an empty
//     `\caption{}` at figure level — two captions and two consumed figure
//     numbers, silently, on the first save. Only the environments that really
//     redefine caption ownership are opaque; every other env stays transparent,
//     which is exactly the old first-match behavior, so no un-listed env can
//     regress.
//   • AN UNBALANCED BODY FORFEITS DEPTH-AWARENESS. A stray `\begin{…}` with no
//     `\end` (LaTeX shown as sample code, or a body caught mid-edit) left depth
//     permanently above zero, so the caption was never found and a fresh empty
//     `\caption{}` was appended on EVERY save — unbounded accumulation. When the
//     scan ends unbalanced, the nesting can't be trusted, so it re-runs
//     depth-blind: back to first-match, never worse than before this change.
// ---------------------------------------------------------------------------

/** Environments whose `\caption` belongs to THEM, not to the enclosing figure.
 *  Everything not listed here is transparent (a box, not a float). Starred
 *  forms are matched by the un-starred name. */
const CAPTION_OWNING_ENVS = new Set([
  // subcaption / subfig / subfloat families
  "subfigure",
  "subtable",
  "subfloat",
  "subcaptionblock",
  // wrapfig — its own float
  "wrapfigure",
  "wraptable",
  // a nested float (illegal in LaTeX, but if present its caption is its own)
  "figure",
  "table",
]);

/** A command hit: the byte range it occupies in the env body, plus its parts. */
interface CommandHit {
  start: number;
  end: number;
  body: string;
}

interface CaptionHit extends CommandHit {
  short: string | null;
  /** `\caption*` — an UNNUMBERED caption. `CONTROL_WORD_RE` swallows the star
   *  into `m[0]` while `m[1]` is the bare name, so the star was claimed as part
   *  of the figure's own caption, cut from `extras` with it, and then never
   *  re-emitted (task 376 M4). */
  starred: boolean;
}

interface LabelHit extends CommandHit {
  /** True when this `\label` sits INSIDE the figure's own `\caption{…}` body.
   *  It still names the figure (so `\ref` resolves), and `extras` must NOT cut
   *  it separately — the caption range it lives in is cut whole. */
  inCaption: boolean;
}

interface FigureBodyScan {
  caption: CaptionHit | null;
  /** Figure-own-depth `\label`s in source order. Sub-float labels are absent by
   *  construction — they belong to the sub-float and stay in `extras`. */
  labels: LabelHit[];
  /** True when `\begin`/`\end` of caption-owning envs didn't balance. */
  unbalanced: boolean;
}

/** Matches a LaTeX control WORD (`\caption`, `\begin`, `\includegraphics*`).
 *  Deliberately fails on an escaped character (`\\`, `\%`, `\{`) so those are
 *  consumed two bytes at a time and can't be misread as commands. */
const CONTROL_WORD_RE = /^\\([a-zA-Z@]+)\*?/;

/** Read a `{envname}` argument at or after `pos`. */
function readEnvArg(src: string, pos: number): { name: string; end: number } {
  let i = pos;
  while (i < src.length && /\s/.test(src[i])) i++;
  const braced = findBracedBody(src, i);
  if (!braced) return { name: "", end: pos };
  return { name: braced.body.trim().replace(/\*$/, ""), end: braced.end };
}

/** Skip past inline verbatim (`\verb<d>…<d>`, `\lstinline[opts]<d>…<d>`), whose
 *  body is literal text: a `%` in there is a percent sign, not a comment, and a
 *  `\label{…}` in there declares nothing. Returns the index after the closing
 *  delimiter, or `pos` when the shape isn't recognized.
 *
 *  Two rules keep the skip from OVER-reaching, since anything it swallows is
 *  invisible to the rest of the scan:
 *   • only `\lstinline` gets the `[options]` pre-scan, and it is brace-… sorry,
 *     BRACKET-nesting aware (`[keywordstyle=[2]\color{red}]` is a listings
 *     idiom). `\verb` has NO optional argument — a `[` after it IS the
 *     delimiter (`\verb[x[`), so scanning for a `]` there would run into the
 *     next line and eat the figure's caption.
 *   • both the option list and the closing delimiter must be found ON THE SAME
 *     LINE. A `\verb` argument cannot contain a newline in LaTeX, so a
 *     delimiter that "matches" further down the file is not a match — it is a
 *     shape we don't understand, and the safe answer is to skip nothing. */
function skipInlineVerbatim(src: string, pos: number, allowOptions: boolean): number {
  const nl = src.indexOf("\n", pos);
  const lineEnd = nl === -1 ? src.length : nl;
  let i = pos;
  if (allowOptions && src[i] === "[") {
    let bracket = 0;
    let j = i;
    for (; j < lineEnd; j++) {
      if (src[j] === "[") bracket++;
      else if (src[j] === "]") {
        bracket--;
        if (bracket === 0) {
          j++;
          break;
        }
      }
    }
    if (bracket !== 0) return pos;
    i = j;
  }
  const delim = src[i];
  // A letter/space/star isn't a delimiter, and a brace one is degenerate
  // (`\verb{x{` closes on `{`, not `}`) — refuse rather than guess.
  if (!delim || /[\sA-Za-z*{}]/.test(delim)) return pos;
  const close = src.indexOf(delim, i + 1);
  return close === -1 || close >= lineEnd ? pos : close + 1;
}

/** One lexical pass over a figure env body: find the figure's OWN `\caption`
 *  and `\label`s — skipping comments and inline verbatim, and treating a
 *  caption-owning environment as opaque. See the block comment above for why
 *  this is a scan and not an `indexOf`, and for the two rules that keep it from
 *  over-reaching. `ignoreDepth` is the unbalanced-body fallback. */
function scanFigureBody(envContent: string, ignoreDepth = false): FigureBodyScan {
  const labels: LabelHit[] = [];
  let caption: CaptionHit | null = null;
  let depth = 0;
  let wentNegative = false;
  let i = 0;
  while (i < envContent.length) {
    const ch = envContent[i];
    // `%` starts a LaTeX comment — everything to the newline is inert text,
    // not a command. (An escaped `\%` never reaches here: the control-sequence
    // branch below consumes it.)
    if (ch === "%") {
      const nl = envContent.indexOf("\n", i);
      i = nl === -1 ? envContent.length : nl + 1;
      continue;
    }
    if (ch !== "\\") {
      i++;
      continue;
    }
    const m = CONTROL_WORD_RE.exec(envContent.slice(i));
    if (!m) {
      // Escaped character (`\\`, `\%`, `\{`, …) — consume both bytes.
      i += 2;
      continue;
    }
    const name = m[1];
    const afterName = i + m[0].length;
    if (name === "verb" || name === "lstinline") {
      const after = skipInlineVerbatim(envContent, afterName, name === "lstinline");
      i = after > afterName ? after : afterName;
      continue;
    }
    if (name === "begin" || name === "end") {
      const env = readEnvArg(envContent, afterName);
      // Only a caption-owning env changes ownership; a box env is transparent.
      if (!ignoreDepth && CAPTION_OWNING_ENVS.has(env.name)) {
        depth += name === "begin" ? 1 : -1;
        // An `\end` with no matching `\begin` puts the scan BELOW figure level,
        // where the `depth === 0` guards silently skip the figure's own caption.
        // Clamping alone would hide that: a later stray `\begin` brings the
        // count back to 0 and the body reports balanced while the caption has
        // already been walked past. So the excursion is remembered.
        if (depth < 0) {
          depth = 0;
          wentNegative = true;
        }
      }
      i = env.end > afterName ? env.end : afterName;
      continue;
    }
    if (depth === 0 && name === "caption" && !caption) {
      // `CONTROL_WORD_RE` consumes a trailing `*` into `m[0]`; that byte is the
      // whole numbered/unnumbered fact and it has to reach the model.
      const starred = m[0].endsWith("*");
      let j = afterName;
      // Optional `[short]` list-of-figures argument (task 263) — opaque.
      let short: string | null = null;
      if (envContent[j] === "[") {
        const close = envContent.indexOf("]", j);
        if (close !== -1) {
          short = envContent.slice(j + 1, close);
          j = close + 1;
        }
      }
      while (j < envContent.length && /\s/.test(envContent[j])) j++;
      const braced = findBracedBody(envContent, j);
      if (braced) {
        caption = { start: i, end: braced.end, body: braced.body, short, starred };
        // Keep scanning INSIDE the caption body: a `\label` in there still
        // names the figure (`\caption{Foo \label{fig:x}}` is idiomatic), so it
        // must reach the `label` attr for `\ref` to resolve.
        i = j + 1;
        continue;
      }
      // Malformed `\caption` with no braced body — treat as ordinary text.
      i = afterName;
      continue;
    }
    if (depth === 0 && name === "label") {
      const braced = findBracedBody(envContent, afterName);
      if (braced) {
        labels.push({
          start: i,
          end: braced.end,
          body: braced.body,
          inCaption:
            caption !== null && i >= caption.start && braced.end <= caption.end,
        });
        i = braced.end;
        continue;
      }
    }
    i = afterName;
  }
  return { caption, labels, unbalanced: depth !== 0 || wentNegative };
}

/** `scanFigureBody` + the unbalanced-body fallback. A body whose caption-owning
 *  `\begin`/`\end` don't pair (sample LaTeX shown inside a listing, or a body
 *  caught mid-edit) can't be reasoned about by depth, and pretending otherwise
 *  buries the figure's real caption — so it re-scans depth-blind, which is the
 *  pre-245 first-match behavior and therefore never worse. */
function scanFigure(envContent: string): FigureBodyScan {
  const scan = scanFigureBody(envContent);
  return scan.unbalanced ? scanFigureBody(envContent, true) : scan;
}

/** Extract the figure-own `\caption` — its long braced body plus the optional
 *  `[short]` list-of-figures argument. `short` is the raw opaque bracket
 *  contents (null when the source had no bracket), tied to the SAME `\caption`
 *  the long body comes from so it re-emits on the right caption. Both are ""/null
 *  when there is no caption. (task 263 — mirrors the item-level `exnoOverride`
 *  opaque round-trip; the short caption and long body travel together, and
 *  since task 245 both come from the depth-aware scan, so a nested
 *  `subfigure`'s own caption is never mistaken for the figure's.) */
export function extractCaption(envContent: string): {
  body: string;
  short: string | null;
} {
  const hit = scanFigure(envContent).caption;
  return { body: hit ? hit.body : "", short: hit ? hit.short : null };
}

/** Does this caption body DECLARE `\label{<label>}`?
 *
 *  The emit side has to know whether the caption's own bytes already carry the
 *  figure's `\label` — otherwise it writes a second copy at figure level and
 *  the user's `.tex` gains a duplicate declaration on the first save (task
 *  318). The question looks like a substring test and is not: a caption that
 *  merely QUOTES a label (`\caption{Write \verb|\label{fig:x}| here}`, or one
 *  inside a `%` comment) declares nothing, so `captionTex.includes(...)` would
 *  suppress the figure's REAL declaration and delete it from the document.
 *  That attempt was made and reverted in task 245.
 *
 *  So this asks the SAME lexical scanner the extraction side asks — verbatim
 *  and comments skipped, caption-owning sub-environments opaque — which is the
 *  only thing that can tell a declaration from a quotation of one.
 *
 *  It is deliberately DERIVED at read time rather than frozen into an attr at
 *  parse time: the caption child is live, user-editable text, so "the caption
 *  carries this label" is a function of its current bytes. A stored copy could
 *  not be wrong when written and could not stay right afterwards — renaming
 *  the label, or deleting the `\label` out of the caption, would strand it.
 *
 *  Fails CLOSED: any shape the scan doesn't recognize reads as "not declared
 *  here", so the figure-level `\label` is still emitted. A spurious duplicate
 *  is a warning; a suppressed declaration is data loss. */
export function captionDeclaresLabel(captionTex: string, label: string): boolean {
  if (!label || !captionTex) return false;
  return scanFigure(captionTex).labels.some((l) => l.body === label);
}

/** Which figure-depth `\label` is the figure's OWN — the one `\ref` resolves
 *  to the figure's number?
 *
 *  LaTeX's rule, not source order: `\caption` calls `\refstepcounter{figure}`,
 *  so a `\label` written AT OR AFTER the caption names the figure, and the same
 *  bytes written BEFORE it name whatever counter was stepped last — normally
 *  the enclosing section. A `\label` inside the caption argument
 *  (`\caption{Foo \label{fig:x}}`, idiomatic) is on the naming side too, which
 *  is why the test is positional and not "outside the caption".
 *
 *  So: the FIRST label at or after the caption. Two of them after one caption
 *  both bind (no counter step in between), and the first is the canonical one.
 *
 *  Fallbacks, in order: no label after the caption → the first label, which is
 *  the pre-379 answer and the only one available; no caption at all → the first
 *  label. With no `\caption` nothing in the figure has stepped the figure
 *  counter, so no label genuinely binds — but the model needs a key for the
 *  lozenge and for `\ref` display, and picking the first is both stable and
 *  what every earlier build did.
 *
 *  Before task 379 this was `labels[0]` unconditionally, and the extras strip
 *  cut EVERY figure-depth label — so `\includegraphics{a}\label{one}` +
 *  `\caption{c}\label{two}` came back with `two` DELETED and `one` silently
 *  promoted from naming nothing to naming the figure. Every `\ref{two}` in the
 *  paper became `??`, on the zero-user-edit load-writeback path.
 *
 *  A `\label` inside a nested `subfigure` belongs to that subfigure and never
 *  reaches this list — the scan drops it by depth. */
function bindingLabel(scan: FigureBodyScan): LabelHit | null {
  const { caption, labels } = scan;
  if (labels.length === 0) return null;
  if (caption) {
    const bound = labels.find((l) => l.start >= caption.start);
    if (bound) return bound;
  }
  return labels[0];
}

/** Apply byte ranges to cut, descending so earlier offsets stay valid, then
 *  collapse the blank lines the stripping leaves behind. */
function cutRanges(src: string, cuts: Array<[number, number]>): string {
  let out = src;
  for (const [start, end] of [...cuts].sort((a, b) => b[0] - a[0])) {
    out = out.slice(0, start) + out.slice(end);
  }
  return out.replace(/\n[ \t]*\n[ \t]*\n+/g, "\n\n");
}

/** Strip the figure's own `\caption{balanced}` and its BINDING `\label` from an
 *  env body, splitting what is left at the caption so the serializer can rebuild
 *  the env without losing — or relocating — the surrounding
 *  `\centering` / `\includegraphics` / comments / sub-floats, which are
 *  re-emitted byte-raw.
 *
 *  **Only the two commands the model actually holds are cut.** Everything else
 *  a figure may carry more than one of — a second figure-depth `\label`, a
 *  second `\caption` — survives in the halves, on the side of the caption it
 *  was written on. That is the whole of task 379: cutting EVERY figure-depth
 *  `\label` deleted labels 2..n outright, and re-emitting a leftover `\caption`
 *  from a single un-split `extras` put it AHEAD of the caption the model kept,
 *  so the two swapped places on every save, forever, with no user edit.
 *
 *  The pivot is the caption's start (or the binding label's, or the end of the
 *  body) and no cut can straddle it: the caption cut begins exactly at the
 *  pivot, and a binding label that is not inside the caption lies wholly on one
 *  side of it. Nested-env labels are untouched on either side — those are the
 *  ones this scan exists to protect. */
function splitFigureOwnCommands(
  envContent: string,
  scan: FigureBodyScan,
  binding: LabelHit | null,
): { extras: string; trailingExtras: string } {
  const cuts: Array<[number, number]> = [];
  if (scan.caption) cuts.push([scan.caption.start, scan.caption.end]);
  // An in-caption binding label lives inside the caption range, which is cut
  // whole — cutting it separately would double-cut.
  if (binding && !binding.inCaption) cuts.push([binding.start, binding.end]);
  const pivot = scan.caption
    ? scan.caption.start
    : binding && !binding.inCaption
      ? binding.start
      : envContent.length;
  return {
    extras: cutRanges(
      envContent.slice(0, pivot),
      cuts.filter(([start]) => start < pivot),
    ),
    trailingExtras: cutRanges(
      envContent.slice(pivot),
      cuts
        .filter(([start]) => start >= pivot)
        .map(([start, end]) => [start - pivot, end - pivot] as [number, number]),
    ),
  };
}

/** Run the full structural extraction for a `\begin{figure}...\end{figure}` body. */
export function extractFigureAttrs(envContent: string): FigureAttrs {
  const sources = extractFigureSources(envContent);
  const first = sources[0] ?? null;
  // ONE scan feeds caption, label and extras — so the bytes `extras` strips
  // are exactly the bytes the serializer re-emits, which is what makes the
  // round-trip a fixed point.
  const scan = scanFigure(envContent);
  // The figure's own label is the one LaTeX would resolve `\ref` to, not the
  // first one in the file — see `bindingLabel`. The SAME hit decides what the
  // strip cuts, so the bytes removed are exactly the bytes re-emitted, which is
  // what makes the round-trip a fixed point.
  const binding = bindingLabel(scan);
  return {
    source: first?.path ?? null,
    widthPercent: first?.widthPercent ?? null,
    sources,
    caption: scan.caption?.body ?? "",
    hasCaption: scan.caption !== null,
    shortCaption: scan.caption?.short ?? null,
    captionStarred: scan.caption?.starred ?? false,
    label: binding?.body ?? "",
    ...splitFigureOwnCommands(envContent, scan, binding),
  };
}

/** Extract structured attrs from a bare `\includegraphics[opts]{path}` string. */
export function extractGraphicsAttrs(command: string): GraphicsAttrs | null {
  const m = matchIncludegraphics(command, 0);
  if (!m) return null;
  return {
    command: m.command,
    source: m.path,
    widthPercent: parseWidthSpec(m.options),
  };
}

// ---------------------------------------------------------------------------
// Mutators used by the figure block's visual chrome (scale stepper, file
// picker). They preserve the surrounding `command` / `raw` text byte-for-byte
// except at the one site that's being changed — `command` / `raw` remain the
// source of truth for LaTeX round-trip.
// ---------------------------------------------------------------------------

// Width units we won't touch from visual chrome. If `width=` uses any of
// these the scale stepper disables itself; users edit absolute widths in
// code via the popover.
const ABSOLUTE_WIDTH_RE =
  /width\s*=\s*[0-9.]+\s*(cm|mm|in|pt|pc|em|ex|bp|sp)\b/i;
// `\textwidth` / `\linewidth` / `\columnwidth` widths — the ones we own.
const RELATIVE_WIDTH_RE =
  /width\s*=\s*[0-9.]+\s*\\(textwidth|linewidth|columnwidth)/;

/** Format a percentage in [10, 100] as a LaTeX fraction string. */
function formatWidthFraction(percent: number): string {
  if (percent === 100) return "1.0";
  // Two decimals max; strip trailing zero (so 50 → "0.5", 35 → "0.35").
  const fixed = (percent / 100).toFixed(2);
  return fixed.replace(/0$/, "").replace(/\.$/, "");
}

/** Update the `width=…` directive in an options string (no surrounding `[]`)
 *  to express `percent`% of `\textwidth` (or whichever relative unit was
 *  already in use). Returns `ok: false` if the existing width is in absolute
 *  units (cm/in/pt/…) — caller should leave it alone. */
export function setWidthInOptions(
  options: string,
  percent: number,
): { options: string; ok: boolean } {
  if (ABSOLUTE_WIDTH_RE.test(options)) {
    return { options, ok: false };
  }
  const fracStr = formatWidthFraction(percent);
  const rel = options.match(RELATIVE_WIDTH_RE);
  if (rel) {
    const unitMatch = rel[0].match(/\\(textwidth|linewidth|columnwidth)/);
    const unit = unitMatch ? unitMatch[0] : "\\textwidth";
    return {
      options: options.replace(RELATIVE_WIDTH_RE, `width=${fracStr}${unit}`),
      ok: true,
    };
  }
  // No width set yet — prepend one. Empty options stays bracket-free; otherwise
  // splice in front with a comma.
  const inserted = `width=${fracStr}\\textwidth`;
  return {
    options: options.length === 0 ? inserted : `${inserted},${options}`,
    ok: true,
  };
}

/** Determine whether the visual scale stepper can adjust this options string.
 *  False when width is in absolute units (cm/in/pt/…). */
export function canEditWidthInOptions(options: string): boolean {
  return !ABSOLUTE_WIDTH_RE.test(options);
}

/** Rebuild a `\includegraphics` command from its parts, preserving the
 *  starred form if the original used it. */
function rebuildIncludegraphics(
  originalCommand: string,
  options: string,
  path: string,
): string {
  const isStarred = originalCommand.startsWith("\\includegraphics*");
  const head = isStarred ? "\\includegraphics*" : "\\includegraphics";
  return options.length > 0 ? `${head}[${options}]{${path}}` : `${head}{${path}}`;
}

/** Splice an updated `\includegraphics` command into a larger text string
 *  (a graphicsBlock `command` or a figureBlock `raw`). Locates the first
 *  `\includegraphics` and replaces it with `build(match)`. Returns null
 *  when no `\includegraphics` is found. */
function withUpdatedFirstGraphics(
  text: string,
  build: (m: {
    command: string;
    options: string;
    path: string;
  }) => string | null,
): string | null {
  const idx = text.indexOf("\\includegraphics");
  if (idx === -1) return null;
  const m = matchIncludegraphics(text, idx);
  if (!m) return null;
  const rebuilt = build({ command: m.command, options: m.options, path: m.path });
  if (rebuilt == null) return null;
  return text.slice(0, idx) + rebuilt + text.slice(idx + m.command.length);
}

/** Apply a new width percentage to the first `\includegraphics` in `text`.
 *  Returns null when the text has no `\includegraphics`, or when the existing
 *  width uses absolute units (signaling the chrome to bail). */
export function withUpdatedFigureWidth(
  text: string,
  percent: number,
): string | null {
  return withUpdatedFirstGraphics(text, (m) => {
    const result = setWidthInOptions(m.options, percent);
    if (!result.ok) return null;
    return rebuildIncludegraphics(m.command, result.options, m.path);
  });
}

/** Swap the `{path}` argument of the first `\includegraphics` in `text`,
 *  preserving all options. Returns null when no `\includegraphics` is found. */
export function withReplacedFigurePath(
  text: string,
  newPath: string,
): string | null {
  return withUpdatedFirstGraphics(text, (m) =>
    rebuildIncludegraphics(m.command, m.options, newPath),
  );
}
