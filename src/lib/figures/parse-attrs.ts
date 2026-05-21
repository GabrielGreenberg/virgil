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
