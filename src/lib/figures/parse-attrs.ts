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
  /** Optional `\caption[<short>]` list-of-figures argument, raw/opaque. Null if
   *  the caption had no `[short]` bracket (task 263). */
  shortCaption: string | null;
  /** `\label{...}` body. Empty string if none. */
  label: string;
  /** Env body with `\caption{...}` and `\label{...}` stripped. Preserves
   *  `\centering`, `\includegraphics`, TikZ blocks, and raw comments — so the
   *  serializer can rebuild the env from `extras + \caption + \label` without
   *  losing unmodeled content. Empty when the env was just caption+label. */
  extras: string;
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
 *  delimiter, or `pos` when this isn't a delimited form. */
function skipInlineVerbatim(src: string, pos: number): number {
  let i = pos;
  // \lstinline may carry an optional [options] before the delimiter.
  if (src[i] === "[") {
    const close = src.indexOf("]", i);
    if (close === -1) return pos;
    i = close + 1;
  }
  const delim = src[i];
  if (!delim || /[\sA-Za-z*]/.test(delim)) return pos;
  const close = src.indexOf(delim === "{" ? "}" : delim, i + 1);
  return close === -1 ? pos : close + 1;
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
      const after = skipInlineVerbatim(envContent, afterName);
      i = after > afterName ? after : afterName;
      continue;
    }
    if (name === "begin" || name === "end") {
      const env = readEnvArg(envContent, afterName);
      // Only a caption-owning env changes ownership; a box env is transparent.
      if (!ignoreDepth && CAPTION_OWNING_ENVS.has(env.name)) {
        depth += name === "begin" ? 1 : -1;
      }
      i = env.end > afterName ? env.end : afterName;
      continue;
    }
    if (depth === 0 && name === "caption" && !caption) {
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
        caption = { start: i, end: braced.end, body: braced.body, short };
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
  return { caption, labels, unbalanced: depth !== 0 };
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

/** Extract the figure's own `\label{...}` body — the first one at figure depth
 *  (a `\label` inside the caption counts: it names the figure). Returns "" if
 *  none. A `\label` inside a nested `subfigure` belongs to that subfigure and
 *  is deliberately NOT read here. */
export function extractLabel(envContent: string): string {
  return scanFigure(envContent).labels[0]?.body ?? "";
}

/** Strip the figure's own `\caption{balanced}` and its figure-depth `\label`s
 *  from an env body so the serializer can rebuild them from structured attrs
 *  without losing the surrounding `\centering` / `\includegraphics` / comments
 *  — and without touching anything inside a nested environment, which is
 *  re-emitted byte-raw.
 *
 *  Note: a second figure-DEPTH `\label` is still dropped, because the model
 *  carries exactly one `label` attr; leaving the extra in `extras` would move
 *  it ahead of the caption on re-emit and oscillate. Nested-env labels are
 *  unaffected — those are the ones this scan exists to protect. */
function stripFigureOwnCommands(envContent: string, scan: FigureBodyScan): string {
  // Ranges to cut, descending, so earlier offsets stay valid. In-caption
  // labels are inside the caption range and would double-cut.
  const cuts: Array<[number, number]> = [];
  if (scan.caption) cuts.push([scan.caption.start, scan.caption.end]);
  for (const l of scan.labels) {
    if (!l.inCaption) cuts.push([l.start, l.end]);
  }
  cuts.sort((a, b) => b[0] - a[0]);
  let out = envContent;
  for (const [start, end] of cuts) {
    out = out.slice(0, start) + out.slice(end);
  }
  // Collapse adjacent blank lines left by the stripping.
  out = out.replace(/\n[ \t]*\n[ \t]*\n+/g, "\n\n");
  return out;
}

/** Run the full structural extraction for a `\begin{figure}...\end{figure}` body. */
export function extractFigureAttrs(envContent: string): FigureAttrs {
  const sources = extractFigureSources(envContent);
  const first = sources[0] ?? null;
  // ONE scan feeds caption, label and extras — so the bytes `extras` strips
  // are exactly the bytes the serializer re-emits, which is what makes the
  // round-trip a fixed point.
  const scan = scanFigure(envContent);
  return {
    source: first?.path ?? null,
    widthPercent: first?.widthPercent ?? null,
    sources,
    caption: scan.caption?.body ?? "",
    shortCaption: scan.caption?.short ?? null,
    label: scan.labels[0]?.body ?? "",
    extras: stripFigureOwnCommands(envContent, scan),
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
