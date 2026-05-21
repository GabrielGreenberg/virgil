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

/** Extract `\caption{...}` body. Returns "" if none. */
export function extractCaption(envContent: string): string {
  const idx = envContent.indexOf("\\caption");
  if (idx === -1) return "";
  // skip past \caption (and any whitespace) to the opening {
  let i = idx + "\\caption".length;
  // optional [short] argument
  if (envContent[i] === "[") {
    const close = envContent.indexOf("]", i);
    if (close === -1) return "";
    i = close + 1;
  }
  while (i < envContent.length && /\s/.test(envContent[i])) i++;
  const braced = findBracedBody(envContent, i);
  return braced ? braced.body : "";
}

/** Extract `\label{...}` body. Returns "" if none. */
export function extractLabel(envContent: string): string {
  const m = envContent.match(/\\label\{([^}]*)\}/);
  return m ? m[1] : "";
}

/** Strip the first `\caption{balanced}` and every `\label{...}` from an env
 *  body so the serializer can rebuild them from structured attrs without
 *  losing the surrounding `\centering` / `\includegraphics` / comments. */
function extractExtras(envContent: string): string {
  let out = envContent;
  // Remove the first \caption{...} with balanced-brace handling.
  const capIdx = out.indexOf("\\caption");
  if (capIdx !== -1) {
    let i = capIdx + "\\caption".length;
    // optional [short] argument
    if (out[i] === "[") {
      const close = out.indexOf("]", i);
      if (close !== -1) i = close + 1;
    }
    while (i < out.length && /\s/.test(out[i])) i++;
    if (out[i] === "{") {
      const braced = findBracedBody(out, i);
      if (braced) {
        out = out.slice(0, capIdx) + out.slice(braced.end);
      }
    }
  }
  // Remove every \label{...} (figures rarely have more than one, but cheap
  // to be defensive).
  out = out.replace(/\\label\{[^}]*\}/g, "");
  // Collapse adjacent blank lines left by the stripping.
  out = out.replace(/\n[ \t]*\n[ \t]*\n+/g, "\n\n");
  return out;
}

/** Run the full structural extraction for a `\begin{figure}...\end{figure}` body. */
export function extractFigureAttrs(envContent: string): FigureAttrs {
  const sources = extractFigureSources(envContent);
  const first = sources[0] ?? null;
  return {
    source: first?.path ?? null,
    widthPercent: first?.widthPercent ?? null,
    sources,
    caption: extractCaption(envContent),
    label: extractLabel(envContent),
    extras: extractExtras(envContent),
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
