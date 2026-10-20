/**
 * The parse-time id allocator — DECLARED ids are authoritative (task 1205).
 *
 * A `.tex` declares an entity's id with a marker — `\vcid{ab12}\cite{…}`,
 * `\vfid{…}\footnote{…}`, `\vexid{…}`, `\vxid{…}`, `\vlid{…}`, a `%!v:ab12`
 * block anchor, a `%!vtex:begin ab12` sentinel. An atom the source does NOT
 * mark (a hand-typed `\cite`, a coauthor's Overleaf edit, an agent's raw
 * LaTeX) is minted a fresh id at parse time. Until this module, that mint was
 * a bare `generateShortId()` with no notion of what the file had already
 * declared, so an unmarked `\cite` parsed EARLIER in the file could draw the
 * same id a LATER `\vcid{…}` declares — and the serializer's dedup keeps the
 * FIRST occurrence in document order. The declared id moved to the wrong
 * atom; every card and sidecar keyed by it silently re-attached there.
 *
 * Fresh-vs-fresh collisions were always harmless (dedup re-mints one of
 * them); the defect is fresh-vs-DECLARED, and its cure is that a fresh mint
 * can never land on a declared id. So every parse runs inside ONE scope that
 * pre-scans the source for every declared id and reserves it, and every
 * parse-time mint goes through {@link mintParseId}, which draws against that
 * reservation (and reserves what it draws).
 *
 * **One door.** `parseLatex`, `parseInlineContent` and `richLatexToJson` each
 * open the scope; a nested call (the main parser handing a footnote body to
 * the card-body parser) joins the outer one rather than opening its own, so a
 * body's mints avoid the WHOLE file's declarations. CI:
 * [parse-id-scope.test.ts](__tests__/parse-id-scope.test.ts) pins the
 * behaviour and censuses the parser modules for a bare `generateShortId()`.
 *
 * Synchronous by construction (the parsers are), so a module-level slot with
 * try/finally restore is exact — the `withQuoteShorthand` precedent.
 */

import { ALL_VIRGIL_MARKERS } from "@/lib/latex-markers";
import { generateShortId } from "@/lib/uuid";

/** `\vfid{…}` / `\vcid{…}` / … — every `.tex` command-form marker, longest
 *  command first so `\vlidend` is not read as `\vlid` + `end`. The argument
 *  is taken verbatim (the parsers accept any brace content as the id). */
const MARKER_ARG_RE = new RegExp(
  `\\\\(?:${ALL_VIRGIL_MARKERS.filter((m) => m.file === "tex")
    .map((m) => m.command)
    .sort((a, b) => b.length - a.length)
    .join("|")})\\{([^{}]*)\\}`,
  "g",
);

/** The comment-form declarations: `%!v:ab12` and `%!vtex:begin ab12`. */
const COMMENT_ANCHOR_RE = /%!v(?::|tex:begin[ \t]+)([0-9a-f]{4})/g;

/** Every id the source DECLARES, in any marker form. Over-reservation (a
 *  marker inside a comment or verbatim run) only narrows the fresh-id space,
 *  which is harmless; under-reservation is the defect. */
export function declaredIdsIn(source: string): Set<string> {
  const ids = new Set<string>();
  for (const m of source.matchAll(MARKER_ARG_RE)) if (m[1]) ids.add(m[1]);
  for (const m of source.matchAll(COMMENT_ANCHOR_RE)) ids.add(m[1]);
  return ids;
}

let reserved: Set<string> | null = null;

/**
 * Run `fn` with every id `source` declares reserved against parse-time mints.
 * Re-entrant: inside an open scope this only adds `source`'s declarations to
 * it (they are normally a subset already).
 */
export function withDeclaredIds<T>(source: string, fn: () => T): T {
  if (reserved) {
    for (const id of declaredIdsIn(source)) reserved.add(id);
    return fn();
  }
  reserved = declaredIdsIn(source);
  try {
    return fn();
  } finally {
    reserved = null;
  }
}

/**
 * THE parse-time mint: a fresh short id that no declaration in the current
 * parse (nor any earlier mint in it) holds. Outside a scope it degrades to a
 * plain `generateShortId()` — no parser entry point calls it there.
 */
export function mintParseId(): string {
  const id = generateShortId(reserved ?? undefined);
  reserved?.add(id);
  return id;
}
