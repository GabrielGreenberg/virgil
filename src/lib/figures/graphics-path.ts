/**
 * Where does `\includegraphics{x}` find its file? — ONE rule, backend-agnostic.
 *
 * graphicx resolves a name by trying, for each extension in its list (or the
 * name as given, when it already carries one), the bare path first and then
 * each `\graphicspath` directory prefix in order. Both storage backends
 * (`storage-fsa`, `storage-dev`) iterate `figureCandidatePaths` and carry no
 * probe list of their own — so the editor finds exactly the file the compile
 * would, and a paper that keeps its figures in `figures/` via
 * `\graphicspath{{figures/}}` no longer shows every image as "not found"
 * (task 1437).
 *
 * The extension list is pdfTeX's: `.pdf .png .jpg .jpeg`. `webp` is NOT in it
 * — pdfTeX's graphicx cannot include one, so probing it would show an image
 * the compile then fails on. An explicitly spelled `plot.webp` is still read
 * (the user named it; the compile will say what it says).
 */
import { extractBraced, matchCommentTailAt } from "@/lib/latex-lexer";

/**
 * What a figure file can be — the ONE extension census (task 1590). Every
 * other list derives from it: the probe order below, the picker's accept list
 * (`pick-file.ts`), and the rasterizer's dispatch (`rasterize.ts`). A format
 * pdfTeX cannot `\includegraphics` (`includable: false`) names the format it
 * is TRANSCODED to at import, so a pickable file always yields a paper that
 * compiles; the editor still reads one the user spelled out by hand.
 *
 * Row order is pdfTeX's probe order for the includable rows.
 */
export const FIGURE_FORMATS = [
  { ext: "pdf", mime: "application/pdf", render: "pdf", includable: true },
  { ext: "png", mime: "image/png", render: "raster", includable: true },
  { ext: "jpg", mime: "image/jpeg", render: "raster", includable: true },
  { ext: "jpeg", mime: "image/jpeg", render: "raster", includable: true },
  { ext: "webp", mime: "image/webp", render: "raster", includable: false, transcodeTo: "png" },
] as const satisfies readonly FigureFormat[];

export interface FigureFormat {
  /** Lower-cased extension, no dot. */
  ext: string;
  mime: string;
  /** Which rasterizer draws it in the editor. */
  render: "pdf" | "raster";
  /** Whether pdfTeX's graphicx can include it. */
  includable: boolean;
  /** For a non-includable format: the includable extension the import door
   *  converts it to. */
  transcodeTo?: string;
}

/** The census row for an extension (case-insensitive), or null. */
export function figureFormatFor(ext: string): FigureFormat | null {
  const norm = ext.toLowerCase().replace(/^\./, "");
  return (FIGURE_FORMATS as readonly FigureFormat[]).find((f) => f.ext === norm) ?? null;
}

/** The extensions pdfTeX's graphicx tries for an extension-less name, in its
 *  order — the census's includable rows. The ONLY probe list in the app
 *  (census: figure-probe-ext-census). */
export const FIGURE_PROBE_EXTS: readonly string[] = FIGURE_FORMATS.filter(
  (f) => f.includable,
).map((f) => f.ext);

export interface FigureCandidate {
  /** Path relative to the paper folder, as the backend should open it. */
  path: string;
  /** Lower-cased extension, which picks the rasterizer. */
  ext: string;
}

/** Blank TeX comments (an unescaped `%` to end of line), through the lexer's
 *  own escaping rule so `\%` is text and `\\%` is a comment. */
function stripComments(tex: string): string {
  let out = "";
  for (let i = 0; i < tex.length; i++) {
    const tail = tex[i] === "%" ? matchCommentTailAt(tex, i) : null;
    if (tail) {
      i = tail.end - 1;
      continue;
    }
    out += tex[i];
  }
  return out;
}

/**
 * The `\graphicspath` directories a preamble declares, in order. TeX lets a
 * later `\graphicspath` REPLACE an earlier one, so the last declaration wins.
 * Each `{dir}` group is one directory; empty groups are dropped.
 */
export function parseGraphicsPath(preamble: string | null | undefined): string[] {
  if (!preamble) return [];
  const tex = stripComments(preamble);
  const re = /\\graphicspath(?![A-Za-z@])\s*/g;
  let result: string[] | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tex))) {
    const outer = extractBraced(tex, m.index + m[0].length);
    if (!outer) continue;
    const dirs: string[] = [];
    let i = 0;
    const body = outer.content;
    while (i < body.length) {
      if (body[i] === "{") {
        const g = extractBraced(body, i);
        if (!g) break;
        const dir = g.content.trim();
        if (dir) dirs.push(dir);
        i = g.end;
      } else {
        i++;
      }
    }
    result = dirs;
    re.lastIndex = outer.end;
  }
  return result ?? [];
}

/** True for a path the `\graphicspath` prefixes must not apply to. */
function isAbsolute(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

/** Normalize a `\graphicspath` entry into a `dir/` prefix (graphicx needs the
 *  trailing slash; users routinely omit it, so supply it). `./` is dropped. */
function dirPrefix(dir: string): string {
  let d = dir.trim().replace(/\\/g, "/");
  while (d.startsWith("./")) d = d.slice(2);
  if (d === "." || d === "") return "";
  return d.endsWith("/") ? d : `${d}/`;
}

/**
 * The ordered candidates graphicx would try for `path` under `graphicspaths`.
 * Extension-major, then directory (bare path first): for an extension-less
 * name that is `plot.pdf, figures/plot.pdf, plot.png, figures/plot.png, …`.
 * An absolute path ignores the prefixes; a `../` path is left as written
 * (each backend refuses what it cannot open). Duplicates are dropped.
 */
export function figureCandidatePaths(
  path: string,
  graphicspaths: readonly string[] = [],
): FigureCandidate[] {
  const src = path.trim();
  if (!src) return [];
  const prefixes = isAbsolute(src) ? [""] : ["", ...graphicspaths.map(dirPrefix)];
  const slash = src.lastIndexOf("/");
  const base = src.slice(slash + 1);
  const dot = base.lastIndexOf(".");
  const named =
    dot > 0 ? [{ name: src, ext: base.slice(dot + 1).toLowerCase() }] : null;
  const variants = named ?? FIGURE_PROBE_EXTS.map((ext) => ({ name: `${src}.${ext}`, ext }));
  const out: FigureCandidate[] = [];
  const seen = new Set<string>();
  for (const v of variants) {
    for (const p of prefixes) {
      const full = `${p}${v.name}`;
      if (seen.has(full)) continue;
      seen.add(full);
      out.push({ path: full, ext: v.ext });
    }
  }
  return out;
}
