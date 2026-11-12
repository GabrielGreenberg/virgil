// Pure parsing helpers for `\begin{figure}...\end{figure}` envs and bare
// `\includegraphics` commands. Used by the LaTeX parser to extract
// structured attrs that drive figure display, and by the tex-mode popover
// to re-extract attrs when the user edits the source.

import { isTexSafeGraphicsPath } from "@/lib/figures/asset-import";
import {
  extractBraced,
  extractBracketed,
  matchInlineVerbAt,
  projectLiveLatex,
} from "@/lib/latex-lexer";

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
  /** Does the figure's `\label` live BEFORE its `\caption`, inside `extras`
   *  (task 1262)?
   *
   *  Which SIDE of the caption a label sits on decides what `\ref` to it
   *  prints: `\caption` calls `\refstepcounter{figure}`, so a label after it
   *  names the figure and the same bytes before it name whatever counter was
   *  stepped last — usually the section. When no label sits at or after the
   *  caption, `bindingLabel` falls back to the pre-caption one (the model still
   *  needs a key for the lozenge, the rename door and `\ref` display). Until
   *  1262 the strip then CUT it and the emitter re-wrote it after the caption,
   *  so a save silently re-pointed every `\ref` in the paper from the
   *  section's number to the figure's — zero word tokens, invisible to the
   *  write gate.
   *
   *  So such a label is not cut at all: its bytes stay in `extras`, exactly
   *  where the author put them, and this flag says the FIRST figure-depth
   *  `\label` in `extras` is the model's `label`. The emitter renders that one
   *  declaration's key from the attr (`withPreCaptionLabel`), so a rename or a
   *  clear through the lozenge still reaches the file, and no second copy is
   *  ever written after the caption. */
  labelBeforeCaption: boolean;
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

/** The `{...}` group at `openPos` — body + index past the close — or null.
 *  Read by THE group scanner (`extractBraced`, task 777 / 1021), so a `}` inside
 *  a `%` comment is not a delimiter: `\caption{A % old}\n B.}` keeps `B.`
 *  inside the caption, exactly as TeX reads it. */
function findBracedBody(src: string, openPos: number): { body: string; end: number } | null {
  const braced = extractBraced(src, openPos);
  return braced ? { body: braced.content, end: braced.end } : null;
}

/** One `key=value` entry of a graphicx option list. `valueStart`/`valueEnd`
 *  index the RAW options string, so a mutator can splice exactly that value. */
export interface GraphicsOptionEntry {
  key: string;
  value: string;
  valueStart: number;
  valueEnd: number;
}

/**
 * The ONE reading of a `\includegraphics[…]` option list (task 1084), shared by
 * the renderer's width (`parseWidthSpec`), the chrome's enablement
 * (`canEditWidthInOptions`) and its mutation (`setWidthInOptions`) — so the
 * three can never disagree about which `width=` is live.
 *
 * It reads keyval the way graphicx does: split at top-level commas (a `{…}`
 * group may hold commas), each entry `key=value`, both trimmed. It reads the
 * lexer's offset-preserving LIVE projection, so a `% width=…` the author
 * commented out is not an entry at all — the regexes it replaces matched raw
 * text and could read (and rewrite) the commented one.
 */
export function parseGraphicsOptions(options: string): GraphicsOptionEntry[] {
  const live = liveGraphicsView(options);
  const entries: GraphicsOptionEntry[] = [];
  let segStart = 0;
  for (const segEnd of [...topLevelIndicesOf(live, ","), live.length]) {
    const seg = live.slice(segStart, segEnd);
    const eq = topLevelIndicesOf(seg, "=")[0];
    if (eq !== undefined) {
      const key = seg.slice(0, eq).trim();
      const rawValue = seg.slice(eq + 1);
      const lead = rawValue.length - rawValue.trimStart().length;
      const value = rawValue.trim();
      const valueStart = segStart + eq + 1 + lead;
      if (key) entries.push({ key, value, valueStart, valueEnd: valueStart + value.length });
    }
    segStart = segEnd + 1;
  }
  return entries;
}

/** Indices of `ch` in `text` outside every `{…}` group (a group is skipped
 *  whole through the lexer's `extractBraced`) and not escaped. */
function topLevelIndicesOf(text: string, ch: string): number[] {
  const hits: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      i++;
    } else if (c === "{") {
      const group = extractBraced(text, i);
      if (group) i = group.end - 1;
    } else if (c === ch) {
      hits.push(i);
    }
  }
  return hits;
}

/** What an option list says about the image's width. `relative` is a
 *  (possibly factor-less) multiple of a text-width register — the only kind
 *  the visual chrome owns; `fixed` is anything else (`3cm`, `\dimexpr…`,
 *  `0.5\paperwidth`), which the chrome never overwrites. */
export type GraphicsWidth =
  | { kind: "none" }
  | { kind: "relative"; factor: number; unit: string; valueStart: number; valueEnd: number }
  | { kind: "fixed" };

const RELATIVE_WIDTH_VALUE_RE =
  /^([0-9]*\.?[0-9]*)\s*(\\(?:textwidth|linewidth|columnwidth))$/;

/** Read the LIVE width of an option list. graphicx applies keys in order, so
 *  the LAST `width=` is the one the PDF uses. A factor-less `\linewidth` is
 *  factor 1 — not "no width", which is how the old regex (number required)
 *  read it, so the stepper PREPENDED a second `width=` the later one overrode. */
export function readGraphicsWidth(options: string): GraphicsWidth {
  if (!options) return { kind: "none" };
  const widths = parseGraphicsOptions(options).filter((e) => e.key === "width");
  const last = widths[widths.length - 1];
  if (!last) return { kind: "none" };
  const m = last.value.match(RELATIVE_WIDTH_VALUE_RE);
  if (!m) return { kind: "fixed" };
  const factor = m[1] === "" ? 1 : parseFloat(m[1]);
  if (isNaN(factor)) return { kind: "fixed" };
  return {
    kind: "relative",
    factor,
    unit: m[2],
    valueStart: last.valueStart,
    valueEnd: last.valueEnd,
  };
}

/** The width range the figure chrome edits and `formatWidthFraction` writes,
 *  as a percentage of `\linewidth`/`\textwidth` (task 1592: stated once, here,
 *  beside the `widthPercent` round-trip — the NodeView imports it). */
export const MIN_WIDTH_PERCENT = 10;
export const MAX_WIDTH_PERCENT = 100;
/** The width the chrome's STEPPERS seed from when the source carries no width
 *  at all (a bare `\includegraphics{a.png}` renders at its natural size). This
 *  is a fact about the chrome's first press — `−` gives 40, `+` gives 60 — and
 *  NEVER a value the width box displays: a figure with no width shows an empty
 *  box, because printing a number the document does not contain is how the box
 *  came to display the one value it could not commit (task 537). */
export const DEFAULT_SCALE_PERCENT = 50;

/** Round and clamp a percentage into [MIN_WIDTH_PERCENT, MAX_WIDTH_PERCENT];
 *  a non-finite input yields `DEFAULT_SCALE_PERCENT`. */
export function clampWidthPercent(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SCALE_PERCENT;
  const i = Math.round(n);
  if (i < MIN_WIDTH_PERCENT) return MIN_WIDTH_PERCENT;
  if (i > MAX_WIDTH_PERCENT) return MAX_WIDTH_PERCENT;
  return i;
}

/** Parse a width=… directive into a CSS percentage. Returns null if the
 *  width is absolute (cm, in, pt), unmodeled, or absent. */
export function parseWidthSpec(options: string): number | null {
  const w = readGraphicsWidth(options);
  if (w.kind !== "relative" || !(w.factor > 0)) return null;
  return Math.min(MAX_WIDTH_PERCENT, w.factor * 100);
}

/** One `\includegraphics` as TeX reads it — the verbatim command plus the
 *  spans a writer splices (all indices into the searched text), so an edit
 *  replaces exactly one argument and leaves the author's spacing, line breaks
 *  and comments between the arguments byte-identical. */
export interface IncludegraphicsMatch {
  /** The full verbatim command, `src.slice(start, end)`. */
  command: string;
  /** Inner text of the option group(s); several groups (the obsolete bbox
   *  form `[0,0][100,100]`) are joined with `][`, so a top-level `]` in it
   *  means "more than one group" (see `graphicsWidthOwned`). */
  options: string;
  path: string;
  start: number;
  end: number;
  /** Just past `\includegraphics` and its optional star — where an absent
   *  option group is inserted. */
  headEnd: number;
  /** Inner span of each `[…]` group, in order. */
  optionGroups: Array<{ start: number; end: number }>;
  /** Inner span of the `{path}` group. */
  pathStart: number;
  pathEnd: number;
}

/** Skip what TeX skips while it looks for a macro's next argument: spaces and
 *  tabs, ONE line end (a second, i.e. a blank line, is `\par` — the scan stops
 *  on it), and `%` comments, each of which eats its own line end and leaves TeX
 *  at the start of the next line. */
function skipTexArgSpace(src: string, i: number): number {
  let atLineStart = false;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\r") {
      i++;
    } else if (c === "\n") {
      if (atLineStart) return i;
      atLineStart = true;
      i++;
    } else if (c === "%") {
      const nl = src.indexOf("\n", i);
      if (nl === -1) return src.length;
      i = nl + 1;
      atLineStart = true;
    } else {
      return i;
    }
  }
  return i;
}

const GRAPHICS_CMD = "\\includegraphics";

/** Read the `\includegraphics[opts]{path}` that starts at `pos` in `src`, by
 *  TeX's argument grammar (task 1434): an optional star, any number of `[…]`
 *  groups, a required `{…}` — with the spaces / single line end / `%`-comments
 *  TeX skips allowed between each. `\includegraphics [width=.5\textwidth] {a}`
 *  compiles, so it is read; `\includegraphicsfoo` is another macro, so it is
 *  not. Null when no graphics command starts here. */
export function matchIncludegraphics(src: string, pos: number): IncludegraphicsMatch | null {
  if (!src.startsWith(GRAPHICS_CMD, pos)) return null;
  let i = pos + GRAPHICS_CMD.length;
  if (/[a-zA-Z]/.test(src[i] ?? "")) return null;
  let j = skipTexArgSpace(src, i);
  if (src[j] === "*") i = j + 1;
  const headEnd = i;
  const optionGroups: Array<{ start: number; end: number }> = [];
  j = skipTexArgSpace(src, i);
  while (src[j] === "[") {
    const opt = extractBracketed(src, j);
    if (!opt) return null;
    optionGroups.push({ start: j + 1, end: opt.end - 1 });
    j = skipTexArgSpace(src, opt.end);
  }
  if (src[j] !== "{") return null;
  const braced = findBracedBody(src, j);
  if (!braced) return null;
  return {
    command: src.slice(pos, braced.end),
    options: optionGroups.map((g) => src.slice(g.start, g.end)).join("]["),
    path: braced.body,
    start: pos,
    end: braced.end,
    headEnd,
    optionGroups,
    pathStart: j + 1,
    pathEnd: braced.end - 1,
  };
}

/**
 * THE reading of which `\includegraphics` commands a text holds (task 1434):
 * every LIVE one (not commented out, not inside `\verb`) that parses, in order,
 * with its spans. The display (`extractFigureSources` → `sources[i]`) and every
 * writer (`withUpdatedFirstGraphics`, `hasLiveIncludegraphics`) are views of
 * this one list, so "the first image" is the same command on both sides — an
 * unparseable `\includegraphics` ahead of a real one is skipped by both, where
 * the display used to skip it and the writers to give up on it.
 */
export function liveIncludegraphicsMatches(text: string): IncludegraphicsMatch[] {
  const matches: IncludegraphicsMatch[] = [];
  const live = liveGraphicsView(text);
  let i = 0;
  while (i < text.length) {
    const idx = live.indexOf(GRAPHICS_CMD, i);
    if (idx === -1) break;
    const m = matchIncludegraphics(text, idx);
    if (!m) {
      i = idx + 1;
      continue;
    }
    matches.push(m);
    i = m.end;
  }
  return matches;
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

/**
 * The view of `text` to SEARCH for `\includegraphics` in, so only the ones TeX
 * would actually read are found (task 777 M4). A raw `indexOf` also found a
 * `% \includegraphics[width=.3\textwidth]{draft.png}` the author had commented
 * out above the real one, so the preview showed the draft and the width/path
 * editors rewrote the COMMENTED line. It is the lexer's offset-preserving live
 * projection (comment tails and inline `\verb` runs blanked), so an index found
 * in it is an index into `text`, where `matchIncludegraphics` reads the raw bytes.
 * Stated residual, the projection's own: a raw `%` inside a `\url{…a%20b}`
 * blanks the rest of ITS line, so an `\includegraphics` sharing that line is
 * not seen.
 */
function liveGraphicsView(text: string): string {
  if (!text.includes("%") && !text.includes("\\verb")) return text;
  return projectLiveLatex(text, { inlineVerb: true, preserveOffsets: true });
}

/** Walk an env body string and pull out all LIVE `\includegraphics` commands. */
export function extractFigureSources(envContent: string): FigureSource[] {
  return liveIncludegraphicsMatches(envContent).map((m) => ({
    path: m.path,
    options: m.options,
    widthPercent: parseWidthSpec(m.options),
  }));
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
    // Inline verbatim (the whole `INLINE_VERBATIM_COMMANDS` family, task 1021):
    // a `%` in there is a percent sign and a `\label{…}` declares nothing. An
    // unterminated run skips nothing — the shape is not understood.
    const verbEnd = matchInlineVerbAt(envContent, i);
    if (verbEnd !== -1) {
      i = verbEnd;
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
        const opt = extractBracketed(envContent, j);
        if (opt) {
          short = opt.content;
          j = opt.end;
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

/** Render a `labelBeforeCaption` figure's `extras` with the model's key in
 *  the declaration it owns — the FIRST figure-depth `\label` there (task 1262).
 *
 *  Found by the same depth-aware scan the parser used to choose it, so a
 *  sub-float's label or one quoted in `\verb` is never the one rewritten. The
 *  key is spliced into that one `\label{…}`'s braces and nothing else moves,
 *  which is what keeps the label on the side of the caption it was written on;
 *  an unchanged key returns `extras` byte-identical. An EMPTY key (the label
 *  was cleared) removes the declaration. Null when `extras` holds no
 *  figure-depth label — the caller then emits the key itself. */
export function withPreCaptionLabel(extras: string, label: string): string | null {
  const own = scanFigure(extras).labels[0];
  if (!own) return null;
  const replacement = label ? `\\label{${label}}` : "";
  if (extras.slice(own.start, own.end) === replacement) return extras;
  return cutRanges(
    extras.slice(0, own.start) + replacement + extras.slice(own.end),
    [],
  );
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
  // ONE scan feeds caption, label and extras — so the bytes `extras` strips
  // are exactly the bytes the serializer re-emits, which is what makes the
  // round-trip a fixed point.
  const scan = scanFigure(envContent);
  // The figure's own label is the one LaTeX would resolve `\ref` to, not the
  // first one in the file — see `bindingLabel`. The SAME hit decides what the
  // strip cuts, so the bytes removed are exactly the bytes re-emitted, which is
  // what makes the round-trip a fixed point.
  const binding = bindingLabel(scan);
  // A binding label written BEFORE the caption (the fallback: none sits at or
  // after it) is the model's key but is NOT cut — its bytes stay in `extras`,
  // on the side that decides what `\ref` prints (task 1262).
  const labelBeforeCaption =
    !!binding && !!scan.caption && !binding.inCaption && binding.start < scan.caption.start;
  const parts = splitFigureOwnCommands(envContent, scan, labelBeforeCaption ? null : binding);
  // Read off the SAME halves the chrome writes (task 1434): an icon inside the
  // caption is not the figure's image, so it is neither displayed as one nor
  // left to disagree with the writer about which image is "first".
  const sources = figureSourcesOf(parts);
  const first = sources[0] ?? null;
  return {
    source: first?.path ?? null,
    widthPercent: first?.widthPercent ?? null,
    sources,
    caption: scan.caption?.body ?? "",
    hasCaption: scan.caption !== null,
    shortCaption: scan.caption?.short ?? null,
    captionStarred: scan.caption?.starred ?? false,
    label: binding?.body ?? "",
    labelBeforeCaption,
    ...parts,
  };
}

/** The `figureBlock` node attrs a figure's SOURCE determines — the ONE mapping
 *  from an `extractFigureAttrs` result to the model, shared by the parser and
 *  the tex-mode popover's writeback (`applyFigureEnvBodyEdit`), task 1080.
 *
 *  Every extracted fact is threaded BY CONSTRUCTION: the rest-spread carries
 *  each key through under its own name, so a fact added to `FigureAttrs`
 *  reaches the node on both paths without anyone remembering to name it. The
 *  two exceptions are destructured out by name, each with its carrier:
 *  `caption` becomes the `figureCaption` CHILD (callers build it), and
 *  `captionStarred` IS the `numbered` attr (task 376 M4 — one fact, one
 *  carrier). That closes the parse-then-drop class on this door (tasks 263,
 *  318, 319, 1080): the popover's copy had threaded everything but the star,
 *  so un-starring `\caption*` there was silently reverted on the next save. */
export function figureNodeAttrsFromSource(
  attrs: FigureAttrs,
): FigureSourceNodeAttrs {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { caption: _caption, captionStarred, ...threaded } = attrs;
  return { ...threaded, numbered: !captionStarred };
}

export type FigureSourceNodeAttrs = Omit<FigureAttrs, "caption" | "captionStarred"> & {
  numbered: boolean;
};

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

/** Format a percentage in [MIN_WIDTH_PERCENT, MAX_WIDTH_PERCENT] as a LaTeX
 *  fraction string. */
function formatWidthFraction(percent: number): string {
  if (percent === MAX_WIDTH_PERCENT) return "1.0";
  // Two decimals max; strip trailing zero (so 50 → "0.5", 35 → "0.35").
  const fixed = (percent / 100).toFixed(2);
  return fixed.replace(/0$/, "").replace(/\.$/, "");
}

/** Keys after which a written `width=` no longer decides the printed width:
 *  each sizes the image itself (`scale` multiplies whatever width says;
 *  `height` / `totalheight` beside a width STRETCH it, there being no
 *  `keepaspectratio`). graphicx applies keys in order, so `angle` is handled
 *  by position instead — see `graphicsWidthOwned`. */
const SIZE_KEYS = new Set(["scale", "height", "totalheight"]);

/**
 * Whether the visual width chrome OWNS this option list's width (task 1434) —
 * i.e. a `width=` it writes is the width the PDF prints. The ONE rule both the
 * stepper's enablement (`canEditWidthInOptions`) and the write
 * (`setWidthInOptions`) read, so an enabled stepper always has a faithful
 * write behind it, and every other list is "edit in code" rather than a write
 * that prints something other than what the box shows. Not owned when:
 *
 *  - the live width is one the chrome never overwrites (`fixed`: `3cm`, …);
 *  - another sizing key is live (`scale` / `height` / `totalheight`) —
 *    `[scale=0.3]` + 60 printed at 18 %; `[height=3cm]` + width stretched;
 *  - an `angle` follows the live width — graphicx rotates AFTER sizing, so the
 *    printed width is the rotated box's, not the written one. (An angle BEFORE
 *    it is fine, and with no width yet the write lands after every angle.)
 *  - there are several option groups (the obsolete bbox form
 *    `[0,0][100,100]`), which a single `width=` key cannot join.
 *
 * Rewriting `scale` / `height` into a width was the rejected alternative: it
 * silently changes what the author wrote the figure to mean.
 */
export function graphicsWidthOwned(options: string): boolean {
  if (topLevelIndicesOf(options, "]").length > 0) return false;
  const w = readGraphicsWidth(options);
  if (w.kind === "fixed") return false;
  const entries = parseGraphicsOptions(options);
  if (entries.some((e) => SIZE_KEYS.has(e.key))) return false;
  if (w.kind === "relative") {
    const lastAngle = entries.filter((e) => e.key === "angle").pop();
    if (lastAngle && lastAngle.valueStart > w.valueStart) return false;
  }
  return true;
}

/** Update the LIVE `width=…` directive in an options string (no surrounding
 *  `[]`) to express `percent`% of whichever relative unit it already uses —
 *  REPLACING that one value in place, so the list never carries two widths.
 *  With no width at all, one is added in `\textwidth`: prepended, or appended
 *  when an `angle` is live so it applies after the rotation. Returns
 *  `ok: false` when the chrome does not own this list's width
 *  (`graphicsWidthOwned`) — caller should leave it alone. */
export function setWidthInOptions(
  options: string,
  percent: number,
): { options: string; ok: boolean } {
  if (!graphicsWidthOwned(options)) return { options, ok: false };
  const w = readGraphicsWidth(options);
  const fracStr = formatWidthFraction(percent);
  if (w.kind === "relative") {
    return {
      options: options.slice(0, w.valueStart) + `${fracStr}${w.unit}` + options.slice(w.valueEnd),
      ok: true,
    };
  }
  const inserted = `width=${fracStr}\\textwidth`;
  if (options.length === 0) return { options: inserted, ok: true };
  if (parseGraphicsOptions(options).some((e) => e.key === "angle")) {
    // After the last LIVE byte — never inside a trailing `% comment`.
    const at = liveGraphicsView(options).trimEnd().length;
    const sep = options.slice(0, at).endsWith(",") ? "" : ",";
    return { options: options.slice(0, at) + sep + inserted + options.slice(at), ok: true };
  }
  return { options: `${inserted},${options}`, ok: true };
}

/** Determine whether the visual scale stepper can adjust this options string —
 *  the SAME reading `setWidthInOptions` acts on, so an enabled stepper always
 *  has a write behind it. */
export function canEditWidthInOptions(options: string): boolean {
  return graphicsWidthOwned(options);
}

/** Splice an updated `\includegraphics` into a larger text string (a
 *  graphicsBlock `command` or one half of a figureBlock body). Targets the
 *  FIRST of `liveIncludegraphicsMatches` — the command `sources[0]` displays —
 *  and replaces only the spans `build` names, so the author's spacing between
 *  the arguments survives. Null when there is no such command or `build`
 *  bails. */
function withUpdatedFirstGraphics(
  text: string,
  build: (m: IncludegraphicsMatch) => Array<{ start: number; end: number; text: string }> | null,
): string | null {
  const m = liveIncludegraphicsMatches(text)[0];
  if (!m) return null;
  const splices = build(m);
  if (splices == null) return null;
  let out = text;
  for (const sp of [...splices].sort((x, y) => y.start - x.start)) {
    out = out.slice(0, sp.start) + sp.text + out.slice(sp.end);
  }
  return out;
}

/** Apply a new width percentage to the first `\includegraphics` in `text`.
 *  Returns null when the text has no `\includegraphics`, or when the chrome
 *  does not own its width (`graphicsWidthOwned`). */
export function withUpdatedFigureWidth(
  text: string,
  percent: number,
): string | null {
  return withUpdatedFirstGraphics(text, (m) => {
    const result = setWidthInOptions(m.options, percent);
    if (!result.ok) return null;
    const group = m.optionGroups[0];
    if (!group) return [{ start: m.headEnd, end: m.headEnd, text: `[${result.options}]` }];
    return [{ start: group.start, end: group.end, text: result.options }];
  });
}

/** Swap the `{path}` argument of the first `\includegraphics` in `text`,
 *  preserving all options. Returns null when no `\includegraphics` is found,
 *  or when `newPath` holds a character TeX would read as syntax (task 1081 —
 *  the backstop under the import door's own refusal: a broken brace group is
 *  never written). */
export function withReplacedFigurePath(
  text: string,
  newPath: string,
): string | null {
  if (!isTexSafeGraphicsPath(newPath)) return null;
  return withUpdatedFirstGraphics(text, (m) => [
    { start: m.pathStart, end: m.pathEnd, text: newPath },
  ]);
}

/** Whether `text` holds a LIVE `\includegraphics` the mutators can patch. */
export function hasLiveIncludegraphics(text: string): boolean {
  return liveIncludegraphicsMatches(text).length > 0;
}

/** The two halves of a figure body the visual chrome may patch: `extras`
 *  (before the caption) and `trailingExtras` (after it — where a
 *  caption-FIRST figure keeps its image, task 379). */
export interface FigureGraphicsParts {
  extras: string;
  trailingExtras: string;
}

/** A figure's images, read off the two halves the chrome may patch, in body
 *  order — the caption is excluded on BOTH sides (task 1434), so `sources[0]`
 *  is by construction the command `figureGraphicsTarget` +
 *  `withUpdatedFirstGraphics` rewrite. The parser (`extractFigureAttrs`) and
 *  the chrome's writeback (`applyFigureExtrasEdit`) both derive `sources`
 *  here. */
export function figureSourcesOf(parts: FigureGraphicsParts): FigureSource[] {
  return [...extractFigureSources(parts.extras), ...extractFigureSources(parts.trailingExtras)];
}

/**
 * Which half holds the `\includegraphics` the chrome owns — the FIRST live one
 * in body order, which is `sources[0]`, the one the chrome displays (task 1084).
 * Reading `extras` alone was a partial model: a caption-first figure showed its
 * image and enabled its controls, and every click no-opped.
 */
export function figureGraphicsTarget(
  parts: FigureGraphicsParts,
): keyof FigureGraphicsParts | null {
  if (hasLiveIncludegraphics(parts.extras)) return "extras";
  if (hasLiveIncludegraphics(parts.trailingExtras)) return "trailingExtras";
  return null;
}

/** Apply a text mutator (`withUpdatedFigureWidth` / `withReplacedFigurePath`)
 *  to whichever half holds the owned `\includegraphics`, leaving the other
 *  byte-identical. Null when there is no target or the mutator bails. */
export function withFigureGraphicsEdit(
  parts: FigureGraphicsParts,
  edit: (text: string) => string | null,
): FigureGraphicsParts | null {
  const target = figureGraphicsTarget(parts);
  if (!target) return null;
  const next = edit(parts[target]);
  return next == null ? null : { ...parts, [target]: next };
}

/** Give a figure that has NO `\includegraphics` one, pointing at `path` — a
 *  stated place: its own line at the end of `extras`, i.e. above the caption
 *  (the emitter writes `extras` first). Null when `path` is not TeX-safe. */
export function withInsertedFigureGraphics(
  parts: FigureGraphicsParts,
  path: string,
): FigureGraphicsParts | null {
  if (!isTexSafeGraphicsPath(path)) return null;
  const head = parts.extras.replace(/\s+$/, "");
  const line = `\\includegraphics{${path}}`;
  return { ...parts, extras: head ? `${head}\n  ${line}` : `  \\centering\n  ${line}` };
}
