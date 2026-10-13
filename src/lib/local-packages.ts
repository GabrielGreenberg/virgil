/**
 * The paper folder's OWN package and class files as a source for the ONE
 * question "is package X in force in this preamble?" (task 1090).
 *
 * To TeX, `\usepackage{mystyle}` with `mystyle.sty` beside the `.tex` INLINES
 * that file: a `\RequirePackage[style=apa]{biblatex}` inside it is a biblatex
 * load exactly as if the preamble said it. The same holds for
 * `\documentclass{mythesis}` with `mythesis.cls` in the folder. Before 1090
 * every "in force" reader saw only the preamble (plus the CTAN class table,
 * task 1019), so a personal or journal style file — the ordinary academic
 * setup — was invisible: save injected `\usepackage{natbib}` over the style
 * file's biblatex (fatal "Incompatible package"), and bib-family detection
 * seeded natbib.
 *
 * Shape of the fix: a per-paper MANIFEST (local package/class name → the
 * packages that file loads, read through the lexer's ONE load reader on live
 * bytes), and ONE resolver, {@link withLocalLoads}, that does what TeX does —
 * expands the preamble's local loads, transitively, into the text the "in
 * force" readers scan. It is applied at the doors that PROJECT a preamble for
 * those readers (`ensurePreambleRequirements`, `detectBibFamily`), so
 * requirement satisfaction, bib-family detection and reconciliation, the
 * example family and the foreign-cite check all see it at once — no per-reader
 * patch. The expansion is SCAN-only: nothing is ever written from it.
 */

import {
  CLASS_PROVIDED_PACKAGES,
  extractDocumentClass,
} from "@/lib/document-class";
import { listPackageLoads, projectDetectableLatex } from "@/lib/latex-lexer";

/** Per-paper: what each LOCAL `.sty` / `.cls` loads (direct loads only; the
 *  resolver walks local-to-local loads itself). Keys are the names a preamble
 *  would use — the file's folder-relative path without its extension. */
export interface LocalPackageManifest {
  readonly packages: ReadonlyMap<string, readonly string[]>;
  readonly classes: ReadonlyMap<string, readonly string[]>;
}

/** The file extensions whose bytes the manifest reads. */
export const LOCAL_PACKAGE_EXTS: readonly string[] = ["sty", "cls"];

/** Is this folder-relative path a file the manifest reads? */
export function isLocalPackagePath(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return path.includes(".") && LOCAL_PACKAGE_EXTS.includes(ext);
}

const LOAD_CLASS_RE = /\\LoadClass(?:WithOptions)?\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;

/** The load entries a local file's LIVE bytes name (comments/verbatim inert).
 *  A local class built on a CTAN class (`\LoadClass{elsarticle}`) inherits
 *  that class's own loads from the task-1019 table. */
function directLoads(text: string): string[] {
  const live = projectDetectableLatex(text);
  const out: string[] = [];
  for (const load of listPackageLoads(live)) {
    for (const e of load.entries) out.push(e);
  }
  for (const m of live.matchAll(LOAD_CLASS_RE)) {
    const base = m[1].trim();
    if (Object.prototype.hasOwnProperty.call(CLASS_PROVIDED_PACKAGES, base)) {
      out.push(...CLASS_PROVIDED_PACKAGES[base]);
    }
  }
  return out;
}

/**
 * Build the manifest from the paper folder's files. Accepts any file list —
 * entries that are not `.sty` / `.cls` are ignored, so a caller can hand the
 * whole folder. Returns `null` when the folder carries no local package file
 * (the common case), so a caller can skip threading it.
 */
export function buildLocalPackageManifest(
  files: Iterable<{ readonly path: string; readonly text: string }>,
): LocalPackageManifest | null {
  const packages = new Map<string, readonly string[]>();
  const classes = new Map<string, readonly string[]>();
  for (const f of files) {
    if (!isLocalPackagePath(f.path)) continue;
    const dot = f.path.lastIndexOf(".");
    const name = f.path.slice(0, dot).replace(/^\.\//, "");
    const ext = f.path.slice(dot + 1).toLowerCase();
    (ext === "cls" ? classes : packages).set(name, directLoads(f.text));
  }
  if (packages.size === 0 && classes.size === 0) return null;
  return { packages, classes };
}

/**
 * The live preamble with every package its LOCAL files load appended as a
 * synthetic `\RequirePackage{…}` — what TeX sees after inlining them. Walks
 * local-to-local loads transitively (a visited set stops cycles). Returns the
 * input unchanged when there is no manifest or the preamble names no local
 * file, so a folder without style files costs nothing.
 *
 * SCAN-only: the result is handed to "in force" readers and is never written.
 * The input must already be live (projected) bytes.
 */
export function withLocalLoads(
  livePreamble: string,
  local: LocalPackageManifest | null | undefined,
): string {
  if (!local) return livePreamble;
  const seen = new Set<string>();
  const extra: string[] = [];
  const visit = (loads: readonly string[] | undefined) => {
    if (!loads) return;
    for (const name of loads) {
      extra.push(name);
      if (seen.has(name)) continue;
      seen.add(name);
      visit(local.packages.get(name));
    }
  };
  const cls = extractDocumentClass(livePreamble)?.className;
  if (cls && local.classes.has(cls)) visit(local.classes.get(cls));
  for (const load of listPackageLoads(livePreamble)) {
    for (const e of load.entries) {
      if (seen.has(e) || !local.packages.has(e)) continue;
      seen.add(e);
      visit(local.packages.get(e));
    }
  }
  if (extra.length === 0) return livePreamble;
  return `${livePreamble}\n\\RequirePackage{${[...new Set(extra)].join(",")}}\n`;
}

// ---------------------------------------------------------------------------
// The per-doc registry (editor-side serializers)
// ---------------------------------------------------------------------------

/**
 * The last manifest the storage layer read for each doc. The storage write
 * doors read the folder themselves on every save; the EDITOR-side serializers
 * (code pane, live source, DocProducts) are synchronous and folder-blind, so
 * they ask here by their own `docId`. Keyed by owner — never a single "current
 * doc" slot (the per-doc-services law): N panes are mounted at once.
 */
const manifestByDoc = new Map<string, LocalPackageManifest | null>();

/** Record the manifest storage just read for `docId` (`null` = no local files). */
export function publishLocalPackages(
  docId: string,
  manifest: LocalPackageManifest | null,
): void {
  manifestByDoc.set(docId, manifest);
}

/** The manifest last read for `docId`, or `null` before the first read. */
export function localPackagesFor(docId: string): LocalPackageManifest | null {
  return manifestByDoc.get(docId) ?? null;
}
