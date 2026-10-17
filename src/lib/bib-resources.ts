/**
 * "Which `.bib` files does this `.tex` declare?" — ONE reader (task 1157).
 *
 * Before 1157 the question was answered by a regex spelled twice (storage-fsa
 * and storage-dev) that took the FIRST RAW match, so:
 *
 *  - `\bibliography{refs,extra}` resolved to a nonexistent `refs,extra.bib`;
 *  - a commented-out `%\bibliography{old}` above the live declaration won, and
 *    `old.bib` was read AND written;
 *  - `\addbibresource[label=x]{refs.bib}` did not match at all.
 *
 * And a third, looser spelling in the compile pass planner
 * (`reference-resolution.ts`) missed the optional-argument and spaced forms.
 *
 * The comment/verbatim rule is the lexer's (`projectLiveLatex`), not a regex's:
 * only bytes the compiler would see declare anything. The backends keep only
 * the step this module cannot take — "does this file exist in the doc folder"
 * — and hand it in as a probe to {@link pickDeclaredBibFile}.
 */

import { projectLiveLatex, VERBATIM_ENVS_FULL } from "@/lib/latex-lexer";

/** One bib-resource declaration as written in LIVE source. */
export interface BibResourceDecl {
  readonly command: "bibliography" | "addbibresource";
  /** The declared names, trimmed, in order (`\bibliography{a,b}` → two). */
  readonly names: readonly string[];
}

// `(?![a-zA-Z])` keeps `\bibliographystyle` out; whitespace (newlines too) may
// sit between the command, its `[options]` (biblatex's `\addbibresource[…]`)
// and its `{argument}`.
const BIB_RESOURCE_DECL_RE =
  /\\(bibliography|addbibresource)(?![a-zA-Z])\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/g;

/**
 * Every bib-resource declaration in ALREADY-LIVE text, in source order.
 * Comments/verbatim are the caller's projection's business — for a caller
 * that has projected for itself (the compile pass planner). Everyone else
 * calls {@link declaredBibFiles}.
 */
export function listBibResourceDecls(liveText: string): BibResourceDecl[] {
  const out: BibResourceDecl[] = [];
  BIB_RESOURCE_DECL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = BIB_RESOURCE_DECL_RE.exec(liveText)) !== null) {
    const command = m[1] as BibResourceDecl["command"];
    // BibTeX's `\bibliography` takes a comma list; biblatex's
    // `\addbibresource` takes ONE resource per call (a comma there is part of
    // the name, so it is not split).
    const raw = command === "bibliography" ? m[2].split(",") : [m[2]];
    const names = raw.map((n) => n.trim()).filter((n) => n.length > 0);
    if (names.length > 0) out.push({ command, names });
  }
  return out;
}

/** A declared name as a doc-folder filename: `refs` → `refs.bib`. */
export function bibFilenameOf(name: string): string {
  return name.endsWith(".bib") ? name : `${name}.bib`;
}

/**
 * The `.bib` filenames a `.tex` source declares, in declaration order,
 * de-duplicated — comment- and verbatim-aware. Empty when it declares none.
 */
export function declaredBibFiles(tex: string): string[] {
  const live = projectLiveLatex(tex, {
    envs: VERBATIM_ENVS_FULL,
    inlineVerb: true,
  });
  const seen = new Set<string>();
  for (const decl of listBibResourceDecls(live)) {
    for (const name of decl.names) seen.add(bibFilenameOf(name));
  }
  return [...seen];
}

/**
 * THE write-target rule for a doc that declares several bibliographies: the
 * FIRST declared file that EXISTS in the doc folder. When none exists yet
 * (a fresh paper whose `\bibliography{references}` has no file behind it),
 * the first declared name — so the first write creates exactly the file the
 * `.tex` names. `null` when nothing is declared (the caller's folder
 * heuristic decides).
 *
 * The Bibliography panel shows and edits this ONE file; the other declared
 * files are read by the compiler but not merged into the panel (a stated
 * residual of task 1157, not an oversight).
 */
export async function pickDeclaredBibFile(
  declared: readonly string[],
  exists: (filename: string) => Promise<boolean>,
): Promise<string | null> {
  if (declared.length === 0) return null;
  if (declared.length === 1) return declared[0];
  for (const name of declared) {
    if (await exists(name)) return name;
  }
  return declared[0];
}
