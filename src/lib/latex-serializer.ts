import type { JSONContent } from "@tiptap/react";
import type { VirgilSidecar } from "@/lib/types";
import {
  appendUuidAnchor,
  generateShortId,
  uuidAnchorSuffix,
  uuidAnchorToken,
} from "@/lib/uuid";
import {
  UUID_BEARING_NODE_TYPES,
  TITLED_NODE_TYPES,
  COLLAPSIBLE_NODE_TYPES,
  deferringParent,
} from "@/lib/node-attr-sets";
import {
  emitMarker,
  INLINE_TEX_MARKERS,
  VIRGIL_MARKERS,
} from "@/lib/latex-markers";
import { buildFigureEnvBody } from "@/lib/figures/env-body";
import { richJsonToLatex, richJsonToPlainText, normalizeRichContent } from "@/lib/footnote-content";
import { CLASSIC_PREAMBLE } from "@/lib/document-styles";
import {
  detectBodyRequirements,
  ensurePreambleRequirements,
} from "@/lib/latex-requirements";
import {
  typographyToLatex,
  smartenStraightQuotes,
  escapeLatexChars,
} from "@/lib/latex-typography";
import {
  extractBraced,
  hasVerbatimMark,
  hasCommentTailMark,
  isEscaped,
  projectDetectableLatex,
  startsBlockBoundary,
  wrapVerbatimEnvBody,
} from "@/lib/latex-lexer";
import type { BibFamily, BibFamilyConflict } from "@/lib/bib-family";
import { classifyCiteFamily } from "@/lib/bib-family";
import {
  createRequirementCollector,
  PACKAGE_DETECTORS,
  type RequirementCollector,
} from "@/lib/latex-requirement-collector";

/**
 * **The serializer's refusal** — task 357, the last of the write-side holes.
 *
 * `serializeNode` had a `default:` arm that emitted a node's CHILDREN and
 * dropped its WRAPPER (and, for a childless node, emitted nothing at all), and
 * `serializeInline` had a trailing `return ""` of the same shape. Both are
 * silent: the output is well-formed LaTeX, the save succeeds, and the document
 * on disk is simply shorter than the one the user has.
 *
 * > **A serializer that cannot represent its input REFUSES. It never emits
 * > LESS** — "less" is byte-indistinguishable from a correct shorter document,
 * > and the words measure that would have caught it steps aside the moment the
 * > user genuinely edits (which is the moment the model becomes the only copy).
 *
 * The refusal is a THROW rather than a sentinel return, for the reason the drop
 * specs' `refuseOnThrow` gives: every one of `serializeToLatex`'s ~ten callers
 * would otherwise have to remember to test a sentinel, and the one that forgot
 * would write the sentinel to disk. A throw is refused by default and has to be
 * caught on purpose — and the two doors that must NOT crash on it (the bundle
 * writers) catch it and publish to the preservation-notice channel, exactly as
 * a lossy write does, while every read-only projection of the `.tex` fails OPEN
 * and keeps its last good text.
 *
 * Reachability, stated rather than implied: `serializer-node-coverage.test.ts`
 * asserts that EVERY node type the real main-editor schema declares has an arm,
 * so this cannot fire for a document today's editor can hold. It is the net for
 * the two cases where the schema and this file genuinely diverge — a node
 * extension registered without a serializer arm (which CI turns into a build
 * failure rather than a silent drop), and a model reaching the serializer from
 * outside the schema (a `virgil.json` written by a newer Virgil). The same two
 * cases the schema-mount probe exists for, from the other end.
 */
export class UnserializableNodeError extends Error {
  readonly nodeType: string;
  constructor(nodeType: string | undefined) {
    super(
      `Cannot serialize node type "${nodeType ?? "(untyped)"}" — refusing to ` +
        `emit a document with this node's content dropped.`,
    );
    this.name = "UnserializableNodeError";
    this.nodeType = nodeType ?? "(untyped)";
  }
}

// -----------------------------------------------------------------------------
// Requirement collection — side channel (P4, requirements by emission).
//
// The requirement declared at each emit-site is pushed into a module-scoped
// ACTIVE collector rather than threaded through every serializeNode signature.
// Serialization is fully synchronous and single-threaded, so a module-level
// "current collector" is safe: `serializeToLatex` sets it before its walk and
// clears it after, and the body-only / single-paragraph projections leave it
// null (a `need()` on a null collector is a no-op). This keeps collection
// STRICTLY side-channel — no byte of emitted output changes.
// -----------------------------------------------------------------------------
let activeCollector: RequirementCollector | null = null;

/** Declare a package/shim requirement adjacent to the bytes an emit-site
 *  writes. No-op when no collector is active (body-only projections). */
function need(id: string): void {
  activeCollector?.need(id);
}

/** Declare the bib family a cite command pins, adjacent to its emit. */
function needBibFamily(fam: BibFamily | null): void {
  activeCollector?.needBibFamily(fam);
}

/**
 * Run the shared package vocabulary over a raw-passthrough block's OWN bytes
 * (texBlock code, figure extras) and declare accordingly — co-locating even
 * raw-passthrough detection with its emitter.
 *
 * This is the ONE emit-site declaration that SCANS user-authored bytes rather
 * than reading Virgil's own emit, so it is a DETECTOR, and a detector believes
 * only LIVE bytes (task 345). It therefore projects through the same named door
 * its sibling `detectBodyRequirements` uses — `projectDetectableLatex`, the
 * NARROW verbatim family — so declaration and detection cannot disagree about
 * what "inert" means. Before this, the two were asked the same question about
 * the same vocabulary from opposite premises, and since `assembleLatex` UNIONs
 * them ("the two never subtract") the unprojected declaration always won: a
 * commented-out `\includegraphics` in a figure's `extras` injected
 * `\usepackage{graphicx}`, and a paragraph EXPLAINING expex inside a
 * `\begin{verbatim}` wrote a `\newenvironment{xlist}` macro into the user's
 * preamble. Injecting packages a document never runs can break a previously
 * compiling paper, which is the reason the requirements side has projected
 * since P4.
 *
 * The projection lives INSIDE this function rather than at its two call sites,
 * so a third caller cannot forget it, and there is no second spelling of
 * "inert" for the two to drift apart on.
 *
 * Three residuals, stated rather than implied:
 *
 *  - The projection is INHERITED WHOLE, including the door's own over-strip (a
 *    raw `%` inside a `\verb|100%|` or a `\url{…a%20b}` truncates the rest of
 *    that line). Every reader now shares it, so the pre-345 unprojected scan is
 *    no longer a rescue net: a live `\includegraphics` sharing such a line goes
 *    undeclared. The failure direction flips from over-injection (which
 *    silently breaks a compiling paper) to under-injection (a loud
 *    `Undefined control sequence`), which is the better trade, not a free one.
 *  - The projection is stateful over the string it is GIVEN, and this one is a
 *    single block's attr while `detectBodyRequirements` gets the whole joined
 *    body. So a `code` beginning mid-verbatim (an earlier block left a
 *    `\begin{verbatim}` open) reads LIVE here and INERT there, and the union
 *    keeps this answer. Per-block isolation is the conservative direction and
 *    the more accurate one — a mid-edit unterminated verbatim would otherwise
 *    swallow every later block.
 *  - It is not the ONLY raw passthrough the serializer emits, only the only one
 *    that reaches a declaration: figure `label`/`shortCaption`, a list's
 *    `listPreamble`, and task 342's byte-literal carriers all land in the body
 *    unscanned, where the projected fallback detector covers them.
 */
function declareFromRawLatex(raw: string): void {
  if (!raw) return;
  const live = projectDetectableLatex(raw);
  for (const d of PACKAGE_DETECTORS) {
    if (d.re.test(live)) need(d.id);
  }
}

// -----------------------------------------------------------------------------
// Child-part memo — the CONTAINER half of the incremental pipeline (task 337).
//
// `serializeTopLevelBlock` is cached per top-level PM node, which makes the
// unit of re-derivation the top-level BLOCK. For a container that unit is a
// lie: a keystroke inside one bullet re-serializes the WHOLE list, because PM
// re-creates every ancestor of an edited node. On a 100-item enumeration that
// is 100× the work the edit deserves, landing in the 300 ms interactive tier
// exactly as the user resumes typing after a think-pause.
//
// So a container's children are memoized too, on a memo the CALLER supplies
// (block-caches.ts), keyed on the child's JSON object — which the DocProducts
// pipeline guarantees is a faithful proxy for PM node identity, because its
// `getNodeJson` composes container JSON from per-child cached JSON and never
// mutates a cached entry. No memo ⇒ every call is a plain `serializeNode`, so
// the cold path (`serializeToLatex`, the code pane, every test) is unchanged.
//
// TWO properties make this byte-safe, and both are load-bearing:
//
//  1. The memo is consulted ONLY where a parent maps its children through
//     `serializeNode(child, S, D)` with S and D constant across the map — so a
//     child's bytes are a pure function of (child, S, D), independent of its
//     index and its siblings. The parent's own framing (indent, `\begin`,
//     separators, any post-processing of the JOINED string) stays in the
//     parent, so a non-concatenative assembly like `listItem`'s tail strip is
//     applied exactly as before. `serializeNode` is not the only walker in
//     this file — the example-body and gloss walkers serialize several of the
//     same node types to DIFFERENT bytes — so the context key names the walker
//     MODE as well, and only `serializeNode` populates the memo today.
//  2. The collector side channel is fully captured by a part's
//     `{requirementIds, bibFamily}`: `need` is a Set add (idempotent,
//     commutative) and `needBibFamily` folds first-concrete-wins with
//     distinct ⇒ natbib (idempotent, commutative). Replaying a child's pair
//     into the enclosing collector is therefore byte-equivalent to running the
//     child inside it — the same argument `foldBibFamilies` already rests on.
// -----------------------------------------------------------------------------

/** One serialized subtree + the requirements its emit-sites declared. */
export interface SerializedPart {
  latex: string;
  requirementIds: readonly string[];
  bibFamily: BibFamily | null;
}

/**
 * The child-part memo a cached serialize runs against. Keyed by the CALLER on
 * JSON-object identity + a context key; see the header above for why that is
 * a faithful proxy for PM node identity on the pipeline's path.
 */
export interface SerializeMemo {
  get(node: JSONContent, ctx: number): SerializedPart | undefined;
  set(node: JSONContent, ctx: number, part: SerializedPart): void;
}

/** The only walker that populates the memo today. Encoded in the context key
 *  so a future example-body/gloss memo cannot collide with these entries —
 *  five node types serialize to different bytes under those walkers. */
const MODE_SERIALIZE_NODE = 0;

/** Context key layout: `mode * 4096 + listDepth * 2 + suppressChildUuids`.
 *  4096 is far above any reachable list nesting depth. */
function childContextKey(
  mode: number,
  suppressChildUuids: boolean,
  listDepth: number,
): number {
  return mode * 4096 + listDepth * 2 + (suppressChildUuids ? 1 : 0);
}

let activeMemo: SerializeMemo | null = null;

/** Serialize one subtree with its OWN collector, capturing the declared
 *  requirements as data instead of leaving them in the enclosing collector. */
function serializePartScoped(
  node: JSONContent,
  suppressChildUuids: boolean,
  listDepth: number,
): SerializedPart {
  const collector = createRequirementCollector();
  const prevCollector = activeCollector;
  activeCollector = collector;
  let latex: string;
  try {
    latex = serializeNode(node, suppressChildUuids, listDepth);
  } finally {
    activeCollector = prevCollector;
  }
  return {
    latex,
    requirementIds: [...collector.ids],
    bibFamily: collector.bibFamily,
  };
}

/** Replay a memoized part's declarations into the ACTIVE collector. */
function replayPart(part: SerializedPart): void {
  for (const id of part.requirementIds) need(id);
  if (part.bibFamily) needBibFamily(part.bibFamily);
}

/**
 * Serialize ONE child of a container through the active memo. Identical to
 * `serializeNode(node, suppressChildUuids, listDepth)` in every byte — the
 * memo only skips recomputation, and the collector effects are replayed.
 */
function serializeContainerChild(
  node: JSONContent,
  suppressChildUuids: boolean,
  listDepth: number,
): string {
  const memo = activeMemo;
  if (!memo) return serializeNode(node, suppressChildUuids, listDepth);
  const key = childContextKey(
    MODE_SERIALIZE_NODE,
    suppressChildUuids,
    listDepth,
  );
  let part = memo.get(node, key);
  if (!part) {
    part = serializePartScoped(node, suppressChildUuids, listDepth);
    memo.set(node, key, part);
  }
  replayPart(part);
  return part.latex;
}

// The classic preset is the historical default — used as the fallback
// when a doc has no preserved preamble and the caller didn't pass one.
const DEFAULT_PREAMBLE = CLASSIC_PREAMBLE;

// Which node types carry `uuid` / `parTitle` / `collapsed` is one declaration,
// read by the parser too — see the header of `node-attr-sets.ts` for why it
// lives in an import-free leaf and what a second hand list cost (task 343).
const DEFAULT_POSTAMBLE = `
\\end{document}
`;

function serializeMarks(
  text: string,
  marks?: { type: string; attrs?: Record<string, unknown> }[]
): string {
  if (!marks || marks.length === 0) return escapeLatex(text);

  // latexCommentTail mark: a `%` COMMENT TAIL — bytes LaTeX discards entirely
  // (task 347). Emitted EXACTLY as parsed, and checked FIRST because it is the
  // strictest carrier of the three: not merely literal, but not typeset at all.
  // Sending it down the prose path is what made `% TODO cite` start typesetting
  // (the char-escape rung rewrites `%` → `\%`), turned `5%` into a printed
  // percent followed by the text LaTeX had been discarding, and broke `…%` at
  // end of line, which is TeX's line-JOIN idiom. All three were fixed points,
  // so nothing downstream could tell a promoted comment from a `\%` the user
  // actually wrote.
  //
  // The line obligation this carrier owns is discharged by its caller — see
  // `serializeInlineSequence`.
  if (hasCommentTailMark(marks)) return text;

  // latexVerbatim mark: BYTE-LITERAL LaTeX (an inline `\verb<delim>…<delim>`
  // run, or a `VERBATIM_ENVS_FULL` env with no modeled node). Emit it exactly
  // as parsed — no escaping, and above all no `smartenStraightQuotes`: inside
  // verbatim a `"` IS a straight ASCII quote, and rewriting it to ``/'' both
  // corrupts the user's source bytes and renders as literal backticks in the
  // compiled PDF. Checked BEFORE the `latexCommand` branch so the stricter
  // carrier wins if a node ever ends up carrying both (task 264).
  if (hasVerbatimMark(marks)) return text;

  // latexCommand mark: text is already raw LaTeX — return as-is, except
  // that uncompilable ASCII / smart quotes get smart-LaTeX-ified so they
  // round-trip to a valid `.tex` even when the mark has been inherited
  // onto stray text by Tiptap's default mark-extension behavior.
  if (marks.some((m) => m.type === "latexCommand")) {
    return smartenStraightQuotes(text);
  }

  // Code spans are verbatim — `--` is literal and accent commands stay raw,
  // so the typographic reverse-map is suppressed for `code`-marked text
  // (memo §A exclusion). Smart-quote + char escaping still applies.
  const inCode = marks.some((m) => m.type === "code");
  let result = escapeLatex(text, { typography: !inCode });
  for (const mark of marks) {
    switch (mark.type) {
      case "bold":
        result = `\\textbf{${result}}`;
        break;
      case "italic":
        result = `\\emph{${result}}`;
        break;
      case "underline":
        result = `\\underline{${result}}`;
        break;
      case "code":
        result = `\\texttt{${result}}`;
        break;
      case "textColor": {
        const c = (mark.attrs?.color as string | undefined) ?? "";
        // \textcolor[HTML] expects 6 uppercase hex digits, no leading "#".
        const hex = c.replace(/^#/, "").toUpperCase();
        if (/^[0-9A-F]{6}$/.test(hex)) {
          result = `\\textcolor[HTML]{${hex}}{${result}}`;
          need("xcolor"); // declared adjacent to the \textcolor byte emit
        }
        break;
      }
    }
  }
  return result;
}

/**
 * Byte-raw body of a MARKLESS text-node container (`content: "text*"`,
 * `marks: ""`) — currently exactly `codeBlock` and `latexComment`.
 *
 * These two are the schema's verbatim pair: their parser reads byte-preserve
 * the source into a single bare text node (`latex-parser.ts` `case "verbatim"`
 * / the `latexComment` branch), running no `unescapeLatex` and no typography.
 * So the serializer must be that read's exact byte-inverse — flatten the text
 * children and emit them raw. Routing them through `serializeInlineSequence`
 * instead (as `codeBlock` did until task 207) sends them down the PROSE escape
 * path, which char-escapes `& % # $ _ ^ ~`, rewrites `[`→`{[}`, and runs the
 * typographic reverse-map. That is not merely wrong once — it is NON-IDEMPOTENT:
 * the parser re-ingests `{[}` literally and the next save re-wraps it, so a
 * body containing `arr[0]` grows a brace layer on EVERY save, unbounded.
 * `latex-typography.ts` states outright that callers must never run it inside a
 * verbatim/code span; this is the helper that keeps that contract structural.
 *
 * The schema guarantees the escaping can never be *needed* here: `marks: ""`
 * makes marked children impossible and `content: "text*"` makes non-text
 * children impossible, so a flatten loses nothing (see
 * `text-object-registry.ts` — it names these two as the markless pair).
 */
function serializeMarklessTextBody(content: JSONContent[] | undefined): string {
  return (content ?? []).map((c) => c.text ?? "").join("");
}

function escapeLatex(
  text: string,
  opts?: { typography?: boolean },
): string {
  // Char-escaping is `escapeLatexChars`, driven by `CHAR_ESCAPE_TABLE` — THE
  // vocabulary, shared with the parser's un-escape rung and with the
  // card/footnote fork, so the two directions cannot drift (task 339; the
  // rationale for each member, and for why prose is the only input this ever
  // sees, lives on the table).
  //
  // What changed with the table: `{` and `}` are now escaped in a text run
  // that PROVABLY holds no LaTeX (no backslash in it), which is what closes the
  // `\{` → bare `{` destruction — an unmatched brace that swallowed the rest of
  // the document into a group. They stay raw in a run that does hold a
  // backslash, because a BARE unmarked text node is a real carrier for raw
  // LaTeX the user is typing (the grey-monospace decoration in
  // `tiptap/latex-command.ts`), and escaping there turns a typed `\emph{hi}`
  // into literal prose. The measurement, the rule and its residual are stated
  // once, on the table.
  //
  // Straight/curly `"` → smart LaTeX pairs via the shared serialize-side
  // helper (also used by serializeMarks' latexCommand path) so the
  // opener/closer character class has exactly ONE definition.
  const escaped = smartenStraightQuotes(escapeLatexChars(text));
  // Typographic reverse-map (accents/special-letters/dashes/ellipsis →
  // canonical LaTeX) runs AFTER char-escaping so its emitted `\^{e}` / `\~{n}`
  // commands aren't re-escaped by the `^`/`~` members above. Suppressed for
  // code spans by the caller (memo §A). The dash-glyph used as a `"`-opening
  // lookbehind (— –) is untouched by the escape pass before being mapped here.
  return opts?.typography === false ? escaped : typographyToLatex(escaped);
}

function serializeTitleField(node: JSONContent): string {
  const field = node.attrs?.field as string;
  const rawPrefix = (node.attrs?.rawPrefix as string) || "";
  const uuid = node.attrs?.uuid as string | null;
  const anchor = uuidAnchorSuffix(uuid);
  if (node.attrs?.isToday) {
    // Interpolate rawPrefix exactly as the non-today branch below does — the
    // parser strips a sizing/weight prefix (`\small`, `\Large`, …) into
    // rawPrefix even on the \today path (latex-parser.ts), so dropping it here
    // silently rewrites `\date{\small\today}` → `\date{\today}` on round-trip.
    return `\\${field}{${rawPrefix}\\today}${anchor}\n`;
  }
  const inner = serializeInlineSequence(node.content || []);
  return `\\${field}{${rawPrefix}${inner}}${anchor}\n`;
}

export function collectPreambleTitleFields(doc: JSONContent): JSONContent[] {
  // Walk the whole doc tree and collect every titleField. Title/author/
  // date are ALWAYS preamble residents — that's their LaTeX semantics —
  // so we don't gate on a per-node flag. Dedup by `field` (first
  // occurrence wins) and emit in canonical title → author → date order,
  // mirroring `hoistTitleFieldsToTop` in the parser.
  const order: Record<string, number> = { title: 0, author: 1, date: 2 };
  const out: JSONContent[] = [];
  const seen = new Set<string>();
  function walk(n: JSONContent) {
    if (n.type === "titleField") {
      const field = n.attrs?.field as string | undefined;
      if (field && !seen.has(field)) {
        seen.add(field);
        out.push(n);
      }
    }
    n.content?.forEach(walk);
  }
  walk(doc);
  out.sort(
    (a, b) =>
      (order[a.attrs?.field as string] ?? 99) -
      (order[b.attrs?.field as string] ?? 99),
  );
  return out;
}

function injectTitleFieldsIntoPreamble(preamble: string, titleFields: JSONContent[]): string {
  if (titleFields.length === 0) return preamble;
  const block = titleFields.map(serializeTitleField).join("") + "\n";
  const beginMarker = "\\begin{document}";
  const idx = preamble.indexOf(beginMarker);
  if (idx === -1) return preamble + block;
  const before = preamble.slice(0, idx).replace(/\s*$/, "");
  const after = preamble.slice(idx);
  return before + "\n\n" + block + after;
}

function serializeNode(node: JSONContent, suppressChildUuids = false, listDepth = 0): string {
  switch (node.type) {
    case "doc":
      return (node.content || []).map((n) => serializeNode(n)).join("");

    case "paragraph": {
      if (!node.content || node.content.length === 0) {
        if (suppressChildUuids) return "";
        // Preserve the paragraph's UUID even when empty — archive snippets
        // anchor on UUIDs, and load-bearing empty paragraphs (left behind
        // by archive) need to round-trip without losing their identity.
        const uuid = node.attrs?.uuid as string | null;
        return `${uuidAnchorToken(uuid ?? "blank")}\n`;
      }
      // `lineFinal` only when this paragraph emits its OWN line ending below.
      // Under `suppressChildUuids` the bare `inner` is joined into an
      // enclosing construct (an `\ex … \xe` body), so a trailing comment must
      // still close its line or it would swallow the `\xe`.
      const inner = serializeInlineSequence(node.content || [], {
        lineFinal: !suppressChildUuids,
      });
      if (suppressChildUuids) return inner;
      const uuid = node.attrs?.uuid as string | null;
      const anchor = uuidAnchorSuffix(uuid);
      return inner + anchor + "\n\n";
    }

    case "heading": {
      const rawLevel = node.attrs?.level;
      const level = typeof rawLevel === "number" ? rawLevel : 1;
      const label = node.attrs?.label as string | null;
      const uuid = node.attrs?.uuid as string | null;
      const numbered = node.attrs?.numbered;
      const inner = serializeInlineSequence(node.content || []);
      // Indexed by level 0..6 directly.
      const commands = ["\\part", "\\chapter", "\\section", "\\subsection", "\\subsubsection", "\\paragraph", "\\subparagraph"];
      const clampedLevel = Math.max(0, Math.min(level, 6));
      const cmd = commands[clampedLevel];
      const star = numbered === false ? "*" : "";
      const labelStr = label ? `\n\\label{${label}}` : "";
      const anchor = uuidAnchorSuffix(uuid);
      return `${cmd}${star}{${inner}}${labelStr}${anchor}\n\n`;
    }

    case "titleField": {
      // Title/author/date always round-trip via the preamble. The body
      // walk produces nothing; `serializeToLatex` collects every
      // titleField in the tree and injects them into the preamble via
      // `collectPreambleTitleFields` + `injectTitleFieldsIntoPreamble`.
      return "";
    }

    case "maketitleMarker": {
      const uuid = node.attrs?.uuid as string | null;
      const anchor = uuidAnchorSuffix(uuid);
      return `\\maketitle${anchor}\n\n`;
    }

    case "codeBlock": {
      // Verbatim is byte-preserving in BOTH directions — flatten the markless
      // text children raw (the parser's `case "verbatim"` inverse). See
      // `serializeMarklessTextBody`.
      const inner = serializeMarklessTextBody(node.content);
      const uuid = node.attrs?.uuid as string | null;
      const anchor = uuidAnchorSuffix(uuid);
      // A body line reading `\end{verbatim}` would otherwise close the
      // environment early (the lexer's `findMatchingEnv` matches the
      // literal string), so `wrapVerbatimEnvBody` escapes it to a private form
      // that breaks the delimiter substring; the parser un-escapes it on the
      // way back in through that helper's inverse. Mirrors the `texBlock`
      // `%!vtex:end` → `%!v tex:end` sentinel guard. The `%` is injected into
      // an already-RAW body, so it stays raw (not `\%`) and reverses cleanly.
      // Verbatim bodies containing a literal `\end{verbatim}` are uncompilable
      // in raw LaTeX anyway, so preserving Virgil's representation losslessly
      // is strictly better.
      return `${wrapVerbatimEnvBody(inner)}${anchor}\n\n`;
    }

    case "texBlock": {
      // Raw LaTeX passthrough. Contents emit verbatim between comment
      // sentinels so the compiler runs them as LaTeX; the parser
      // recovers them by matching uuid. We escape any literal
      // `%!vtex:end` in the body so a pasted snippet can't terminate
      // the block early.
      const uuid = (node.attrs?.uuid as string) || "";
      const rawCode = (node.attrs?.code as string) || "";
      // Raw passthrough is unmodeled: run the shared vocabulary over its OWN
      // bytes so tikz/graphicx/xcolor/expex used inside a texBlock declare
      // their package at the emit-site (co-located with the fallback detector's
      // vocabulary AND its inertness projection, so declared and detected can't
      // diverge — the projection is inside `declareFromRawLatex`, never here).
      declareFromRawLatex(rawCode);
      const escaped = rawCode.replace(/%!vtex:end/g, "%!v tex:end");
      return `%!vtex:begin ${uuid}\n${escaped}\n%!vtex:end ${uuid}\n\n`;
    }

    case "figureBlock": {
      // Rebuild the env body from structured attrs + the caption sub-node.
      // `extras` carries the env's unmodeled content (\centering, raw
      // \includegraphics, TikZ blocks, comments) captured at parse time;
      // \caption{...} and \label{...} are stripped before storing extras
      // so we don't double-emit them here.
      const placement = (node.attrs?.placement as string) ?? "";
      const starred = node.attrs?.starred === true;
      const uuid = node.attrs?.uuid as string | null;
      const label = (node.attrs?.label as string) ?? "";
      const extras = ((node.attrs?.extras as string) ?? "").replace(/\s+$/, "");
      // `extras` is raw passthrough (\includegraphics, TikZ, pgfplots) — run the
      // shared vocabulary over it so its packages declare at the emit-site. Its
      // COMMENTED-OUT lines declare nothing: commenting an old figure path out
      // while trying a new one is ordinary editing, and the projection inside
      // `declareFromRawLatex` is what makes that true.
      declareFromRawLatex(extras);
      const captionChild = (node.content || []).find(
        (c) => c.type === "figureCaption",
      );
      const captionTex = captionChild
        ? serializeInlineSequence(captionChild.content || [])
        : "";
      const anchor = uuidAnchorSuffix(uuid);
      const envName = starred ? "figure*" : "figure";
      // Tasks 318 + 319: the env body is built by the ONE builder shared with
      // the popover surface, off DECLARED facts — `hasCaption` (did the source
      // carry a `\caption` command at all; the always-present caption child
      // cannot answer that, and emitting on its presence gave every
      // caption-less figure a number-consuming `\caption{}`) and the caption's
      // own scanned bytes (which is what tells a `\label` DECLARATION inside
      // the caption from one merely quoted in `\verb`, the distinction the
      // reverted substring test of task 245 could not make).
      const body = buildFigureEnvBody({
        extras,
        captionTex,
        hasCaption: node.attrs?.hasCaption !== false,
        shortCaption: (node.attrs?.shortCaption as string | null) ?? null,
        label,
      });
      return `\\begin{${envName}}${placement}${body}\\end{${envName}}${anchor}\n\n`;
    }

    case "graphicsBlock": {
      // Standalone `\includegraphics` — emit the verbatim command from
      // `command`, with the trailing UUID anchor if present.
      const command = (node.attrs?.command as string) ?? "";
      const uuid = node.attrs?.uuid as string | null;
      const anchor = uuidAnchorSuffix(uuid);
      need("graphicx"); // \includegraphics is graphicx-bound
      return `${command}${anchor}\n\n`;
    }

    case "blockquote": {
      // Join child paragraphs with a `\n\n` block separator: under
      // `suppressChildUuids` the paragraph branch returns bare `inner` with no
      // trailing break, so joining with "" fuses consecutive paragraphs into
      // one on re-parse (the parser only splits the quote body on `\n\n`). The
      // separator preserves the hard paragraph break inside a multi-paragraph
      // quote; a single-paragraph quote is byte-unchanged (single-element join).
      const inner = (node.content || [])
        .map((n) => serializeContainerChild(n, true, 0))
        .join("\n\n");
      const uuid = node.attrs?.uuid as string | null;
      const anchor = uuidAnchorSuffix(uuid);
      return `\\begin{quote}\n${inner}\\end{quote}${anchor}\n\n`;
    }

    case "bulletList": {
      const items = (node.content || [])
        .map((n) => serializeContainerChild(n, false, listDepth))
        .join("");
      const uuid = node.attrs?.uuid as string | null;
      const preamble = node.attrs?.listPreamble as string | null;
      const anchor = uuidAnchorSuffix(uuid);
      const indent = "  ".repeat(listDepth);
      const innerIndent = indent + "  ";
      const preambleStr = preamble
        ? preamble.split("\n").map((l) => `${innerIndent}${l}`).join("\n") + "\n"
        : "";
      // Top-level list gets surrounding blank lines; nested lists do not.
      const trailing = listDepth === 0 ? "\n\n" : "\n";
      return `${indent}\\begin{itemize}\n${preambleStr}${items}${indent}\\end{itemize}${anchor}${trailing}`;
    }

    case "orderedList": {
      const items = (node.content || [])
        .map((n) => serializeContainerChild(n, false, listDepth))
        .join("");
      const uuid = node.attrs?.uuid as string | null;
      const preamble = node.attrs?.listPreamble as string | null;
      const anchor = uuidAnchorSuffix(uuid);
      const indent = "  ".repeat(listDepth);
      const innerIndent = indent + "  ";
      const preambleStr = preamble
        ? preamble.split("\n").map((l) => `${innerIndent}${l}`).join("\n") + "\n"
        : "";
      const trailing = listDepth === 0 ? "\n\n" : "\n";
      return `${indent}\\begin{enumerate}\n${preambleStr}${items}${indent}\\end{enumerate}${anchor}${trailing}`;
    }

    case "listItem": {
      // The schema is "paragraph block*" — first child is the inline body,
      // any further children are block-level (typically nested lists).
      const indent = "  ".repeat(listDepth + 1);
      const children = node.content || [];
      // The head is child 0 only when it IS a paragraph. The schema is
      // `paragraph block*` and the parser normalizes to it, so a non-paragraph
      // first child means the node was built some other way (a drop, a paste,
      // a future schema) — and the pre-356 shape both emitted an empty head AND
      // took `children.slice(1)`, so that child was DROPPED outright. Nothing
      // upstream can see that: the word gate reads the whole document, and one
      // list item's worth of prose is under its slack. Keep every child instead
      // — the head is simply empty and all of them serialize as the tail.
      const headIsParagraph = children[0]?.type === "paragraph";
      const head = headIsParagraph ? children[0] : undefined;
      const tail = headIsParagraph ? children.slice(1) : children;
      const headText =
        head && head.type === "paragraph"
          ? // The item head is line-final in exactly the paragraph case's
            // sense: what follows is either a newline (a tail child begins on
            // its own line) or `${anchor}\n`, and the anchor is `%!v:` comment
            // bytes `detachItemAnchor` strips back off on the way in. So a
            // trailing comment tail may end the line itself.
            serializeInlineSequence(head.content || [], { lineFinal: true })
          : "";
      const uuid = node.attrs?.uuid as string | null;
      // The optional `[label]` (task 340) — raw, opaque LaTeX the parser
      // captured verbatim. It goes immediately after `\item`, BEFORE the body,
      // because that is where LaTeX reads it.
      // `null` means the item had no optional argument at all and must emit a
      // bare `\item`; `""` is a real `\item[]` (a marker-suppressed item).
      const itemLabel = (node.attrs?.itemLabel as string | null) ?? null;
      const label = itemLabel === null ? "" : `[${itemLabel}]`;
      // Serialize trailing block children (nested lists, etc.) with bumped depth
      // Per-child memo, join-level strip: the `.replace` runs on the
      // CONCATENATION exactly as before (it can eat into the second-to-last
      // child's trailing newlines when the last one is all newlines), so
      // memoizing the children individually is byte-neutral.
      const tailText = tail
        .map((n) => serializeContainerChild(n, false, listDepth + 1))
        .join("")
        .replace(/\n+$/, ""); // strip trailing blank lines from nested blocks
      // Task 348. TWO rules, both of which the pre-348 shape broke:
      //
      // (a) The head is separated from the tail by whatever the PARSER needs to
      //     read them back as two blocks, asked of the parser's own rule
      //     (`startsBlockBoundary`, the lexer SSOT `readParagraph` reads). A
      //     nested `\begin{itemize}` is self-delimiting, so a single newline is
      //     right and the bytes are unchanged; a second PARAGRAPH — or a
      //     comment line, which since task 347 continues a paragraph rather
      //     than ending it — is not, and the single newline merged it into the
      //     head on the next open, destroying the user's paragraph break with
      //     no edit. Answering from the parser's vocabulary rather than a list
      //     of self-delimiting child kinds is what keeps the two halves from
      //     drifting the way the anchor's two halves did.
      //
      // (b) The anchor is appended to the item's whole BODY — head plus tail —
      //     which is where `detachItemAnchor` takes it off. When the last tail
      //     child is itself uuid-bearing this stacks two anchors on one line
      //     (`\end{itemize} %!v:child %!v:me`); that is unambiguous by
      //     construction, because the detach is greedy-prefixed and takes
      //     exactly ONE, innermost-first.
      const tailSep = startsBlockBoundary(tailText.replace(/^[ \t]*/, ""))
        ? "\n"
        : "\n\n";
      const body = tailText ? `${headText}${tailSep}${tailText}` : headText;
      return `${indent}\\item${label} ${appendUuidAnchor(body, uuid)}\n`;
    }

    case "horizontalRule":
      return "\\hrulefill\n\n";

    case "inlineMath":
      return `$${node.attrs?.latex || ""}$`;

    case "displayMath": {
      const uuid = node.attrs?.uuid as string | null;
      const anchor = uuidAnchorSuffix(uuid);
      return `\\[\n${node.attrs?.latex || ""}\n\\]${anchor}\n\n`;
    }

    case "footnote": {
      const fid = node.attrs?.footnoteId as string | undefined;
      const idMarker = fid ? emitMarker(VIRGIL_MARKERS.footnote, fid) : "";
      const cmd = node.attrs?.thanks ? "thanks" : "footnote";
      return `${idMarker}\\${cmd}{${richJsonToLatex(normalizeRichContent(node.attrs?.content))}}`;
    }

    case "latexComment": {
      const uuid = node.attrs?.uuid as string | null;
      const anchor = uuidAnchorSuffix(uuid);
      // Comment text is native inline content now (`content: text*`), not an
      // `attrs.text` — flatten the text nodes raw, via the shared markless
      // byte-passthrough helper it shares with `codeBlock`.
      const text = serializeMarklessTextBody(node.content);
      return `% ${text}${anchor}\n`;
    }

    case "citation": {
      const cid = node.attrs?.citationId as string | undefined;
      const idMarker = cid ? emitMarker(VIRGIL_MARKERS.citation, cid) : "";
      const command = (node.attrs?.command as string) || "";
      // Declare the bib family this cite command pins, adjacent to its emit.
      needBibFamily(classifyCiteFamily(command));
      return `${idMarker}${command}`;
    }

    case "labelRef":
      return serializeLabelRef(node);

    case "exampleBlock":
      return serializeExampleBlock(node);

    case "exampleItemList":
    case "exampleItem":
      // These are consumed by serializeExampleBlock / serializeExampleItem
      // contextually — the wrapper at top level has no LaTeX expansion of
      // its own, and items are emitted by their parent walk.
      return "";

    case "exampleGloss":
      return serializeExampleGloss(node);

    case "alignedGlossRow":
    case "proseGlossRow":
    case "glossCell":
      // These only appear inside exampleGloss and are consumed there.
      return "";

    case "hardBreak":
      return "\\\\\n";

    case "text":
      // A text node reaching the BLOCK walk is a malformed model — text lives
      // inside a textblock, and `serializeInlineSequence` answers it there with
      // the linked-anchor bookkeeping this arm cannot do. Emit the user's bytes
      // anyway rather than refuse: the marks round-trip, and losing a run of
      // prose to a structural anomaly is precisely the failure this class is
      // about. Before task 357 this fell to the `default:` arm below, where a
      // text node has no `content` and therefore vanished without trace.
      return serializeMarks(node.text || "", node.marks);

    case "figureCaption":
      // Consumed CONTEXTUALLY by `case "figureBlock"`, which reads the caption
      // child directly (it must, to route those bytes through
      // `buildFigureEnvBody` with the `hasCaption` provenance). Declared here
      // rather than left to the default arm, so the schema census can see this
      // type has an ANSWER — the same shape the expex family above has.
      return "";

    default:
      // THE SERIALIZER REFUSES (task 357). This arm used to emit a node's
      // CHILDREN and drop its WRAPPER — and, for a childless node, emit
      // nothing at all. Both are silent losses, and no gate downstream can see
      // them once the user has typed: the write gate's step-aside rests on
      // "after a real user edit the model IS the document", which is exactly
      // the moment a wrapper-dropping serialize stops being measured against
      // anything.
      //
      // A serializer that cannot represent its input must not emit LESS —
      // "less" is byte-indistinguishable from a correct shorter document. The
      // refusal reaches the same channel a lossy write does (both bundle
      // writers publish it); every read-only projection of the `.tex` fails
      // OPEN and keeps its last good text.
      throw new UnserializableNodeError(node.type);
  }
}

function serializeLabelRef(node: JSONContent): string {
  const label = node.attrs?.label || "";
  const cmd = (node.attrs?.refCommand as string) || "ref";
  // \getref / \getfullref are expex reference commands (matched by the expex
  // fallback detector too); declare adjacent to the emit. Plain \ref is kernel.
  if (cmd === "getref") {
    need("expex");
    return `\\getref{${label}}`;
  }
  if (cmd === "getfullref") {
    need("expex");
    return `\\getfullref{${label}}`;
  }
  return `\\ref{${label}}`;
}

function serializeExampleInlineChildren(nodes: JSONContent[] | undefined): string {
  if (!nodes) return "";
  return serializeInlineSequence(nodes);
}

function serializeExampleBlockBodyParagraphs(
  nodes: JSONContent[] | undefined,
): string {
  if (!nodes) return "";
  // Collapse paragraph children to inline (no blank-line separators — the
  // \ex…\xe envelope owns its own spacing). Multiple paragraphs are joined
  // by blank lines so the source stays readable.
  const pieces: string[] = [];
  for (const child of nodes) {
    if (child.type === "paragraph") {
      pieces.push(serializeExampleInlineChildren(child.content));
    } else if (child.type === "exampleGloss") {
      pieces.push(serializeExampleGloss(child).trimEnd());
    }
  }
  return pieces.join("\n\n");
}

function serializeExampleBlock(node: JSONContent): string {
  // An example block emits `\ex`/`\pex … \xe` — an expex construct.
  need("expex");
  const kind = node.attrs?.kind === "multi" ? "pex" : "ex";
  const uuid = node.attrs?.uuid as string | null;
  const idMarker = uuid ? emitMarker(VIRGIL_MARKERS.exampleBlock, uuid) : "";
  const tag = (node.attrs?.tag as string) || "";
  const tagStr = tag ? `<${tag}>` : "";
  // `[opts]` — the RAW bracket run when the parse captured one, else the
  // interpreted `exno` alone (task 356 site 4).
  //
  // expex's option keys are open-ended (`everypar={…}`, `aboveexskip`,
  // `labelwidth`, `interpartskip`, …) and the parse interpreted exactly ONE of
  // them, so every other key the user wrote was consumed and DISCARDED — a
  // typographic instruction destroyed on OPEN, with no edit, and no gate can
  // see it (it costs zero words). Carrying the raw run is the shape
  // `\begingl[opts]` already had one construct over.
  //
  // `exnoOverride` stays PARSED beside it because the renumberer reads it;
  // nothing writes it, so the two cannot drift. A node built programmatically
  // (no source bytes) has no raw run and falls back to the interpreted form.
  const override = (node.attrs?.exnoOverride as string | null) || null;
  const raw = (node.attrs?.rawOptions as string | null) || null;
  const optStr = raw ?? (override ? `[exno=${override}]` : "");
  const suppress = (node.attrs?.suppressSpace as boolean) ? "~" : "";
  const label = (node.attrs?.label as string) || "";
  const labelStr = label ? `\\label{${label}}` : "";

  // Walk children in document order — paragraphs, gloss blocks,
  // exampleItemLists, regular itemize/enumerate lists, and (Feature A2)
  // pictures (graphicsBlock) + equations (displayMath) dropped into a single
  // example's body can interleave freely. Schema:
  // `(paragraph | exampleGloss | exampleItemList | bulletList | orderedList |
  //   graphicsBlock | displayMath)*`.
  const children = node.content || [];
  const pieces: Array<{ type: string; text: string }> = [];
  for (const child of children) {
    if (child.type === "paragraph") {
      pieces.push({
        type: "paragraph",
        text: serializeExampleInlineChildren(child.content),
      });
    } else if (child.type === "graphicsBlock") {
      // Feature A2 — a picture dropped into a single example's body. Emit the
      // verbatim command (mirrors serializeExampleItem's graphicsBlock branch;
      // the generic graphicsBlock serializer adds a trailing blank line we
      // don't want inside the example).
      need("graphicx"); // \includegraphics is graphicx-bound
      pieces.push({
        type: "graphicsBlock",
        text: (child.attrs?.command as string) ?? "",
      });
    } else if (child.type === "displayMath") {
      // Feature A2 — an equation dropped into a single example's body. Same
      // `\[…\]` envelope as serializeExampleItem (with the trailing %!v: anchor
      // when the equation carries a uuid); `readParagraph` breaks at `\[` so a
      // preceding paragraph stays its own block on re-parse.
      const mUuid = child.attrs?.uuid as string | null;
      const mAnchor = uuidAnchorSuffix(mUuid);
      const latex = (child.attrs?.latex as string) || "";
      pieces.push({ type: "displayMath", text: `\\[\n${latex}\n\\]${mAnchor}` });
    } else if (child.type === "exampleGloss") {
      pieces.push({
        type: "exampleGloss",
        text: serializeExampleGloss(child).trimEnd(),
      });
    } else if (child.type === "exampleItemList") {
      const items = (child.content || []).filter(
        (c) => c.type === "exampleItem",
      );
      const itemsStr = items.map((it) => serializeExampleItem(it)).join("");
      if (itemsStr)
        pieces.push({ type: "exampleItemList", text: itemsStr.trimEnd() });
    } else if (child.type === "bulletList" || child.type === "orderedList") {
      pieces.push({ type: child.type, text: serializeNode(child).trimEnd() });
    } else {
      // TERMINAL ELSE (task 356's triage). The chain above matches the schema
      // TODAY, which is exactly why it needs one: a child kind added to
      // `exampleBlock`'s content expression and forgotten here would be DROPPED
      // silently, and a single example body is well under the write gate's
      // word slack. The generic serializer is the honest fallback — it emits
      // whatever the node knows how to emit rather than nothing.
      const text = serializeNode(child).trimEnd();
      if (text) pieces.push({ type: child.type ?? "unknown", text });
    }
  }
  // Join with a soft "\n", EXCEPT two consecutive paragraphs need a blank line
  // so they re-parse as separate paragraphs (a lone "\n" is a soft break the
  // parser merges). `\[…\]` / `\includegraphics` are self-delimiting (the parser
  // breaks at them), so every other adjacency keeps the single "\n" — which
  // preserves the byte output of every pre-A2 block (≤ 1 body paragraph, so no
  // consecutive-paragraph adjacency ever arose).
  let body = "";
  for (let i = 0; i < pieces.length; i++) {
    if (i > 0) {
      body +=
        pieces[i - 1].type === "paragraph" && pieces[i].type === "paragraph"
          ? "\n\n"
          : "\n";
    }
    body += pieces[i].text;
  }

  return (
    `${idMarker}\\${kind}${suppress}${optStr}${tagStr}${labelStr}\n` +
    (body ? body + "\n" : "") +
    `\\xe\n\n`
  );
}

function serializeExampleItem(node: JSONContent): string {
  // An `\a` item is an expex construct.
  need("expex");
  const uuid = node.attrs?.uuid as string | null;
  const idMarker = uuid ? emitMarker(VIRGIL_MARKERS.exampleItem, uuid) : "";
  const tag = (node.attrs?.tag as string) || "";
  const tagStr = tag ? `<${tag}>` : "";
  // Item-level `\a[exno=N]` override — mirror the block leg
  // (`serializeExampleBlock`: `optStr` before `tagStr`). Emitted only when
  // present, so an override-free item serializes byte-identically.
  const override = (node.attrs?.exnoOverride as string | null) || null;
  const raw = (node.attrs?.rawOptions as string | null) || null;
  const optStr = raw ?? (override ? `[exno=${override}]` : "");
  const label = (node.attrs?.label as string) || "";
  const labelStr = label ? `\\label{${label}}` : "";
  const pieces: string[] = [];
  for (const child of node.content || []) {
    if (child.type === "paragraph") {
      pieces.push(serializeExampleInlineChildren(child.content));
    } else if (child.type === "graphicsBlock") {
      // Standalone `\includegraphics` inside the item body — emit the
      // verbatim command (the generic graphicsBlock serializer adds a
      // trailing blank-line we don't want inside an item, so just emit
      // the command).
      const command = (child.attrs?.command as string) ?? "";
      need("graphicx"); // \includegraphics is graphicx-bound
      pieces.push(command);
    } else if (child.type === "displayMath") {
      // Display math `\[…\]` inside the item body (Feature A1). Emit the
      // same `\[…\]` envelope as the top-level serializer (with the trailing
      // %!v: anchor when the equation carries a uuid), but without the
      // top-level's blank-line tail — pieces are `\n`-joined inside the item.
      // `readParagraph` breaks at `\[` so a preceding paragraph stays its own
      // block on re-parse (round-trip verified in displaymath-in-item-roundtrip).
      const mUuid = child.attrs?.uuid as string | null;
      const mAnchor = uuidAnchorSuffix(mUuid);
      const latex = (child.attrs?.latex as string) || "";
      pieces.push(`\\[\n${latex}\n\\]${mAnchor}`);
    } else if (child.type === "exampleGloss") {
      pieces.push(serializeExampleGloss(child).trimEnd());
    } else if (child.type === "exampleItemList") {
      // Nested tier of \a items — wrap in the `xlist` environment. This is the
      // key P4 decoupling site: emitting `\begin{xlist}` REQUIRES both expex
      // (the `\pex`/`\xe` the env expands to) and the `xlistenv` definition
      // (expex ships no `xlist`), declared adjacent to the bytes — so a nested
      // tier can never emit without both requirements, independent of the
      // fallback regex.
      need("expex");
      need("xlistenv");
      const nestedItems = (child.content || []).filter(
        (c) => c.type === "exampleItem",
      );
      const nestedStr = nestedItems
        .map((n) => serializeExampleItem(n))
        .join("");
      pieces.push(
        `\\begin{xlist}\n${nestedStr.trimEnd()}\n\\end{xlist}`,
      );
    } else {
      // TERMINAL ELSE — the `serializeExampleBlock` twin, same reason.
      const text = serializeNode(child).trimEnd();
      if (text) pieces.push(text);
    }
  }
  const body = pieces.join("\n");
  return `${idMarker}\\a${optStr}${tagStr}${labelStr} ${body}\n`;
}

/** True if `s` has a whitespace char at brace depth 0 — i.e. a space that
 *  expex would treat as a column separator. Whitespace *inside* a `{...}`
 *  group (e.g. a command's braced argument) is already protected, so it
 *  doesn't count. `\{`/`\}` are literal, not group delimiters. */
function hasTopLevelWhitespace(s: string): boolean {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "{" && !isEscaped(s, i)) depth++;
    else if (c === "}" && !isEscaped(s, i)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && /\s/.test(c)) return true;
  }
  return false;
}

function glossCellToText(cell: JSONContent): string {
  // One cell = inline content; preserve any backslash commands verbatim.
  // Plain text tokens are whitespace-joined; wrap in braces only if the
  // serialized form has a space at brace depth 0.
  const inner = serializeExampleInlineChildren(cell.content);
  const trimmed = inner.trim();
  if (!trimmed) return "{}";
  // Brace only when a top-level (brace-depth-0) space is present, so expex
  // doesn't split the cell into multiple columns. A whitespace-bearing run
  // already wrapped by a command's braces — `\textbf{a b}` — needs no
  // redundant outer group, and the brace-aware parser re-reads it as one cell.
  if (hasTopLevelWhitespace(trimmed)) return `{${trimmed}}`;
  return trimmed;
}

function serializeExampleGloss(node: JSONContent): string {
  // A gloss emits `\begingl … \endgl` — an expex construct.
  need("expex");
  // Re-emit the opaque `[<opts>]` bracket the parser captured (task 262) so a
  // user's gloss options survive save→reload byte-for-byte; a null attr (source
  // had no bracket) emits a bare `\begingl` identical to today. A string —
  // including "" from a literal `\begingl[]` — keeps the bracket, so the
  // round-trip is a true fixed point.
  const rawOptions = node.attrs?.glossOptions;
  const glossOptions = typeof rawOptions === "string" ? rawOptions : null;
  const optStr = glossOptions !== null ? `[${glossOptions}]` : "";
  const rows = node.content || [];
  const lines: string[] = [];
  for (const row of rows) {
    if (row.type === "alignedGlossRow") {
      const tier = (row.attrs?.tier as string) || "gla";
      const cells = (row.content || [])
        .filter((c) => c.type === "glossCell")
        .map(glossCellToText);
      lines.push(`\\${tier} ${cells.join(" ")} //`);
    } else if (row.type === "proseGlossRow") {
      const tier = (row.attrs?.tier as string) || "glft";
      const inner = serializeExampleInlineChildren(row.content);
      lines.push(`\\${tier} ${inner} //`);
    }
  }
  return `\\begingl${optStr}\n${lines.join("\n")}\n\\endgl\n`;
}

/**
 * The internal Virgil marker commands the serializer emits inline to round-trip
 * structure that has no LaTeX of its own: linked-anchor range boundaries
 * (`\vlid` / `\vlidend`, {@link serializeInlineSequence}), citation ids
 * (`\vcid`) and footnote ids (`\vfid`) (the atom emit sites at :360/:376 and
 * :665/:671). These are NOT real LaTeX — they are private sentinels the parser
 * (`parseInlineContent` / `applyLinkedAnchorBoundaries`) reads back to
 * re-materialize anchors + atoms.
 *
 * DERIVED, not listed: the set is every marker in the vocabulary SSOT
 * ([latex-markers.ts](latex-markers.ts)) whose `file` is the `.tex` and whose
 * `position` is `inline` — the two facets that decide the question, so a
 * future inline marker joins this guard by declaring itself rather than by
 * someone remembering this file. (`\vexid`/`\vxid` are block-position and
 * `\vbid` lives in the `.bib`, so none of them is emitted into the inline
 * stream this guard protects.) Longest-first so the regex alternation matches
 * `\vlidend` before its `\vlid` prefix.
 */
export const INTERNAL_MARKER_COMMANDS: readonly string[] =
  INLINE_TEX_MARKERS.map((m) => m.command);

const INTERNAL_MARKER_REGEX = new RegExp(
  `\\\\(?:${INTERNAL_MARKER_COMMANDS.join("|")})\\b`,
);

/**
 * True if `text` contains any internal Virgil marker command
 * (`\vlid` / `\vlidend` / `\vcid` / `\vfid`). Used to refuse REPARSING
 * untrusted text (e.g. a suggestion's `replacement`): concatenating a marker
 * into a paragraph's serialized inline LaTeX and reparsing it would mint a
 * phantom `linkedAnchor` / citation / footnote atom that no card owns — the
 * write-side mirror of the applicator's `originalText` verbatim guard.
 */
export function containsInternalMarker(text: string): boolean {
  return INTERNAL_MARKER_REGEX.test(text);
}

/**
 * Walk a sequence of inline nodes, emitting `\vlid{id}` / `\vlidend{id}`
 * marker transitions around the `linkedAnchor` marks on text. Block-
 * local: anchors still open at the end of the sequence are closed with
 * `\vlidend`. A `linkedAnchor` that spans multiple blocks therefore
 * emits a close+reopen pair at each block boundary — verbose but the
 * parser's `applyLinkedAnchorBoundaries` reassembles them correctly.
 *
 * `serializeMarks` already ignores `linkedAnchor` marks (no case in its
 * switch), so the inline wrapping (`\textbf{…}` etc.) sits inside
 * `\vlid…\vlidend`, e.g.: `\vlid{x}\textbf{bold range}\vlidend{x}`.
 */
/**
 * THE comment carrier's line obligation (task 347).
 *
 * A `%` comment runs to the end of its LINE, so a comment tail is the one
 * carrier that owns the rest of the line it is written on. Two things follow,
 * and both are byte-neutral for content the parser produced — it always reads
 * a tail up to (never across) a newline, and always leaves that newline at the
 * head of the next prose run:
 *
 *  - a tail carrying an interior newline must re-comment its continuation
 *    lines, or the bytes after the newline stop being a comment and start
 *    TYPESETTING (reachable by editing, not by parsing);
 *  - anything emitted after a tail on the same line is swallowed by it, so a
 *    tail not already followed by a newline gets one.
 *
 * Without the second rule the failure is the one this whole task is about,
 * arriving from the keyboard instead of from save: type a word after a comment
 * chip and the word stops appearing in the PDF, silently, while round-tripping
 * perfectly (the re-parse simply reads it back as more comment).
 */
function closeCommentTail(raw: string, restStartsWithNewline: boolean): string {
  const recommented = raw.split("\n").join("\n%");
  return restStartsWithNewline ? recommented : `${recommented}\n`;
}

function serializeInlineSequence(
  nodes: JSONContent[],
  opts?: { lineFinal?: boolean },
): string {
  const open = new Set<string>();
  let out = "";
  for (const [idx, node] of nodes.entries()) {
    if (node.type === "text" && hasCommentTailMark(node.marks)) {
      // Closing an open `linkedAnchor` range across a comment is not
      // representable — the close marker would land inside the comment — so a
      // tail is emitted with the ranges left open; the loop's own tail-flush
      // below still closes them at the end of the sequence.
      const next = nodes[idx + 1];
      const nextText = next?.type === "text" ? (next.text ?? "") : "";
      // `lineFinal` is the caller's promise that what it appends after this
      // sequence is comment bytes and then a newline — true at exactly ONE
      // site, the `paragraph` case, whose tail is `anchor + "\n\n"` and whose
      // anchor is a `%!v:` comment. There the tail may end the line itself and
      // let the anchor ride inside it, which is both fewer bytes and what the
      // user wrote. Every other consumer wraps the sequence in BRACES
      // (heading, titleField, figure caption, an example's `\ex …` head), and
      // a tail there would comment out the closing brace — so the default is
      // the fail-safe newline. The parser's `PARAGRAPH_INLINE` opt-in is the
      // same rule read from the other end: the sites that may PRODUCE a tail
      // are the sites that may END a line with one.
      const lineFinal = opts?.lineFinal && idx === nodes.length - 1;
      out += lineFinal
        ? serializeMarks(node.text || "", node.marks).split("\n").join("\n%")
        : closeCommentTail(
            serializeMarks(node.text || "", node.marks),
            nextText.startsWith("\n"),
          );
      continue;
    }
    if (node.type === "text") {
      const marks = node.marks || [];
      const currentIds = new Set<string>();
      for (const m of marks) {
        if (m.type === "linkedAnchor") {
          const id = m.attrs?.anchorId as string | undefined;
          if (id) currentIds.add(id);
        }
      }
      for (const id of [...open]) {
        if (!currentIds.has(id)) {
          out += emitMarker(VIRGIL_MARKERS.linkedRangeClose, id);
          open.delete(id);
        }
      }
      for (const id of currentIds) {
        if (!open.has(id)) {
          out += emitMarker(VIRGIL_MARKERS.linkedRangeOpen, id);
          open.add(id);
        }
      }
      out += serializeMarks(node.text || "", marks);
    } else {
      // ONE dispatcher (task 357). `serializeInline` was a second if-chain
      // whose five non-text arms were byte-identical duplicates of
      // `serializeNode`'s — and whose trailing `return ""` was the second of
      // this task's two silent drops: an inline node type that chain had not
      // heard of serialized to nothing, even where `serializeNode` knew it.
      // Delegating retires the fork by construction rather than by repairing
      // it, and leaves exactly ONE place where a node can be refused.
      out += serializeNode(node);
    }
  }
  for (const id of open) {
    out += emitMarker(VIRGIL_MARKERS.linkedRangeClose, id);
  }
  return out;
}

/**
 * Environments whose `.tex` bytes THIS serializer GENERATES from a structural
 * node, as opposed to the ones it CARRIES byte-for-byte out of the document.
 * Read only by `collapseBlankRuns` below, which is the one pass entitled to
 * tidy generated output and must never touch carried source.
 *
 * Membership is "the serializer emits `\begin{<name>}` itself" — every entry
 * corresponds to an emit site in `serializeNode` / `serializeExampleBlock`.
 * Bare `verbatim` is deliberately NOT here although its wrapper is generated
 * (`wrapVerbatimEnvBody`): its BODY is byte-literal, which is what the
 * collapse must keep its hands off.
 *
 * CI derives the reverse direction from this list — see
 * `unmodeled-env-roundtrip.test.ts`, which fails a `\begin{<literal>}` emitted
 * anywhere in this file that names an env not listed here.
 */
const SERIALIZER_GENERATED_ENVS = [
  "quote", // case "blockquote"
  "itemize", // case "bulletList"
  "enumerate", // case "orderedList"
  "figure", // case "figureBlock"
  "figure*", // case "figureBlock", starred
  "xlist", // serializeExampleBlock, nested example list
] as const;

/**
 * Collapse runs of 3+ newlines down to a single blank-line separator — EXCEPT
 * inside any environment whose bytes we CARRIED rather than generated, whose
 * body is byte-preserving. Those blocks are pulled out behind placeholders, the
 * collapse runs on the remaining prose, then the blocks are spliced back
 * intact. A body line reading `\end{verbatim}` is escaped (`%!v-esc`) at emit
 * time, so the non-greedy match always stops at the block's real terminator
 * even when the body itself contains a literal `\begin{verbatim}`.
 *
 * The stash set is DERIVED, as the complement of `SERIALIZER_GENERATED_ENVS`
 * above, rather than enumerated (task 342). It used to be the verbatim family
 * (`VERBATIM_ENVS_FULL`, task 243) — which is a list of names, so every
 * environment nobody thought to name lost its interior blank runs on the first
 * save: measured, `\begin{align}` with a 3-blank-line gap came back with one,
 * silently and idempotently, while `lstlisting` was clean. Same shape as the
 * uuid-anchor hand list this task deleted in the parser, one file over: the
 * question is not "is this env verbatim?" but "did WE write these bytes?", and
 * only the second one has an answer that can't go stale.
 *
 * The `(?:[…]|{…})*` run after the env name is load-bearing (task 264): a
 * carried env is normally written WITH an argument —
 * `\begin{lstlisting}[language=Python]`, `\begin{minted}{python}` whose
 * language argument is MANDATORY, `\begin{tabular}{ll}` — so no real block has
 * a newline immediately after the `\begin{…}`. Requiring that newline meant
 * those blocks never stashed and the `\n{3,}` collapse ran straight over their
 * bodies: a PEP8 listing lost one of its two blank lines between top-level
 * defs. Task 243 unified the VOCABULARY here but the pattern still only fit the
 * no-argument spelling.
 *
 * Known residual, unchanged by this task: the non-greedy tail stops at the
 * FIRST `\end{<same name>}`, so a carried env nested inside another of the same
 * name leaves the outer block's tail unstashed. Correct for the whole verbatim
 * family (non-nestable by construction) and a stale-blank-line risk only for a
 * self-nested `tabular`/`align`, which the pre-342 code got wrong too — and
 * wrong for every env rather than one shape of one.
 */
const CARRIED_BLOCK_RE = new RegExp(
  // Any `\begin{name}` whose name is not one we generate. The name matcher is
  // the lexer's own env-name shape (`\w+\*?`, so starred envs match), and the
  // exclusion alternation is longest-first so `figure*` is tried before
  // `figure`.
  `\\\\begin\\{(?!(?:${[...SERIALIZER_GENERATED_ENVS]
    .sort((a, b) => b.length - a.length)
    .map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")})\\})(\\w+\\*?)` +
    `\\}(?:\\[[^\\]\\n]*\\]|\\{[^}\\n]*\\})*\\n[\\s\\S]*?\\n\\\\end\\{\\1\\}`,
  "g",
);
function collapseBlankRuns(s: string): string {
  const blocks: string[] = [];
  // Stash each carried block behind a placeholder that carries no newline
  // (so the collapse pass can't touch it) and cannot collide with real prose
  // (`@@` + a reserved tag). Restore is index-guarded — an unmatched token is
  // left verbatim rather than turning into "undefined".
  const stashed = s.replace(CARRIED_BLOCK_RE, (m) => {
    blocks.push(m);
    return `@@VBTSTASH:${blocks.length - 1}@@`;
  });
  const collapsed = stashed.replace(/\n{3,}/g, "\n\n");
  return collapsed.replace(/@@VBTSTASH:(\d+)@@/g, (whole, i) => {
    const block = blocks[Number(i)];
    return block === undefined ? whole : block;
  });
}

/** One top-level block's serialized LaTeX + the requirements its emit-sites
 *  declared — the per-block unit `serializeToLatex` assembles from, and the
 *  cacheable entry for the Wave-1 incremental pipeline (cache key = PM node
 *  identity; a block's output depends on nothing outside its own subtree). */
export type TopLevelBlockLatex = SerializedPart;

/**
 * Serialize ONE top-level block with its own requirement collector.
 * Top level ⇒ `suppressChildUuids = false`, `listDepth = 0` (always true for
 * doc children), so the emitted bytes are exactly the block's slice of a
 * whole-doc `serializeNode(doc)` walk.
 *
 * `memo` (task 337) makes the CONTAINER children of this block incremental
 * too — see the child-part memo header above. Omit it and every child is
 * serialized fresh, which is what every non-pipeline caller does.
 */
export function serializeTopLevelBlock(
  node: JSONContent,
  memo?: SerializeMemo | null,
): TopLevelBlockLatex {
  const prevMemo = activeMemo;
  activeMemo = memo ?? null;
  try {
    return serializePartScoped(node, false, 0);
  } finally {
    activeMemo = prevMemo;
  }
}

/**
 * Fold per-block declared bib families exactly the way one whole-walk
 * collector would have: first concrete family wins; a DIFFERENT later family
 * is a conflict that resolves to natbib (the absorbing baseline —
 * latex-requirement-collector.ts `needBibFamily`). Per-block folding composes
 * with this cross-block fold because "natbib" is absorbing whether it arrived
 * as a declaration or as a conflict resolution.
 */
function foldBibFamilies(parts: readonly TopLevelBlockLatex[]): BibFamily | null {
  let fam: BibFamily | null = null;
  for (const p of parts) {
    if (!p.bibFamily) continue;
    if (fam === null) fam = p.bibFamily;
    else if (fam !== p.bibFamily) fam = "natbib";
  }
  return fam;
}

export interface AssembleLatexOptions {
  preamble?: string;
  postamble?: string;
  bibFamily?: BibFamily | null;
  onRequirementConflict?: (conflict: BibFamilyConflict) => void;
}

/**
 * Assemble a full `.tex` from per-block pieces — byte-identical to what the
 * historical whole-doc `serializeToLatex` walk produced from the same doc
 * (the doc case was always `map + join` over top-level children; the tails
 * below are the joined-string passes that genuinely span block boundaries).
 */
export function assembleLatex(
  parts: readonly TopLevelBlockLatex[],
  preambleTitleFields: JSONContent[],
  options?: AssembleLatexOptions,
): string {
  const body = collapseBlankRuns(parts.map((p) => p.latex).join("")).trim();

  // Requirements pass runs on EVERY serialize — including the no-options
  // DEFAULT_PREAMBLE fallback — so a body that emits expex / graphicx /
  // tikz / cite commands always has the matching \usepackage (and every
  // `\v*id` shim) by the time the .tex hits disk. `||` (not `??`): an
  // empty-string preamble falls back to the default, as before.
  //
  // The DECLARED set (per-block requirementIds, from emit-sites) is UNIONed
  // with the FALLBACK detector (detectBodyRequirements, for hand-typed raw
  // LaTeX). The two never subtract, so the result is a superset-improvement
  // over the old detector-only set — byte-stable for existing docs (the
  // emit-sites declare exactly what the regexes were catching, plus
  // previously-missed cases).
  const required = detectBodyRequirements(body);
  for (const p of parts) for (const id of p.requirementIds) required.add(id);

  // Bib family: prefer the authoritative per-doc choice; else the family the
  // cite emit-sites declared. The declared/authoritative family is reconciled
  // against the preamble by ensurePreambleRequirements (inject the RIGHT
  // family; warn — never delete — on a hard conflict).
  const declaredFamily: BibFamily | null =
    options?.bibFamily ?? foldBibFamilies(parts);

  const rawPreamble = ensurePreambleRequirements(
    options?.preamble || DEFAULT_PREAMBLE,
    required,
    {
      declaredBibFamily: declaredFamily,
      onBibFamilyConflict: options?.onRequirementConflict,
    },
  );
  // Re-inject preamble-sourced \title/\author/\date right before
  // \begin{document}. They live in the doc tree (so the editor can show
  // them), but the user intends them to live in the preamble.
  const preamble = injectTitleFieldsIntoPreamble(
    rawPreamble,
    preambleTitleFields,
  );
  const postamble = options?.postamble ?? DEFAULT_POSTAMBLE;
  return preamble + body + postamble;
}

export function serializeToLatex(
  doc: JSONContent,
  options?: {
    preamble?: string;
    postamble?: string;
    /**
     * The AUTHORITATIVE per-doc bib family (from the virgil settings sidecar /
     * useCitations). When supplied it OVERRIDES the body-derived family guess —
     * so a doc whose user has chosen biblatex ensures biblatex even if a lone
     * shared cite would otherwise default to natbib. Optional; backward
     * compatible (unset → body-derived family, today's behavior).
     */
    bibFamily?: BibFamily | null;
    /**
     * Called once at serialize time when the family the body needs conflicts
     * with the family the preamble hard-loads (natbib baseline + `\autocite`,
     * or the symmetric case). Per the locked decision we WARN, never rewrite —
     * the save path renders this as a soft notice. Fires at most once.
     */
    onRequirementConflict?: (conflict: BibFamilyConflict) => void;
  },
): string {
  // ONE code path (perf Wave 0, plan P2-S1): the whole-doc serialize is the
  // per-block serialize + assembly. The Wave-1 incremental pipeline memoizes
  // `serializeTopLevelBlock` per PM node; this function stays the cold path
  // and the byte-identity oracle.
  const parts = (doc.content ?? []).map((n) => serializeTopLevelBlock(n));
  return assembleLatex(parts, collectPreambleTitleFields(doc), options);
}

export function serializeBodyOnly(doc: JSONContent): string {
  return collapseBlankRuns(serializeNode(doc)).trim();
}

/**
 * Serialize ONE paragraph node's inline content to LaTeX — the inline sequence
 * only (atoms, marks, `\vcid`/`\vfid`/`\vlid` markers), with NO trailing
 * ` %!v:<uuid>` anchor and NO surrounding blank lines.
 *
 * This is the exact string the headless AI-change applicator
 * (`src/links/apply-suggestion.ts`) splices into: it serializes the live
 * paragraph, byte-matches the suggestion's `originalText` against it (the stale
 * guard), splices `originalText → replacement`, and re-parses the whole result
 * with `parseInlineContent`. Routing through the real `serializeNode` path
 * (with `suppressChildUuids = true`, the same flag lists / blockquote bodies
 * use to drop the per-paragraph anchor) keeps the projection byte-faithful to
 * what `serializeBodyOnly` would emit for the same paragraph, so the splice the
 * applicator computes matches the headless Python accept's splice.
 *
 * `node` must be a JSONContent `paragraph` (e.g. from `pmNode.toJSON()` on the
 * live block); any other node type returns its default `serializeNode`
 * projection. No `%!v:` trailer is emitted regardless.
 */
export function serializeParagraphInline(node: JSONContent): string {
  return serializeNode(node, /* suppressChildUuids */ true);
}

/**
 * Carry `\title{…}` / `\author{…}` / `\date{…}` lines from the OLD
 * LaTeX's preamble into a NEW style preamble. Used by the Style
 * dropdown switch path ([useDocumentStyle.setStyle]), which previously
 * dropped these commands wholesale when replacing the preamble.
 *
 * `newPreamble` is expected to end with `\begin{document}\n\n` (the
 * shape of `StyleEntry.preamble`); the harvested title-field block is
 * inserted just before that marker. The OLD preamble is everything in
 * `oldLatex` up to its `\begin{document}` — title-field commands are
 * extracted by string-match (not by parsing the whole doc), so this
 * function is safe to call on raw bytes without going through the
 * editor's doc tree.
 *
 * Duplicate `\title{}` (or author/date) lines in the source are
 * collapsed — first occurrence wins, matching `parsePreambleTitleFields`
 * semantics.
 */
export function mergeTitlesIntoStylePreamble(
  oldLatex: string,
  newPreamble: string,
): string {
  const beginDoc = oldLatex.indexOf("\\begin{document}");
  const oldPreamble = beginDoc !== -1 ? oldLatex.slice(0, beginDoc) : oldLatex;
  const harvested = extractTitleFieldLines(oldPreamble);
  if (harvested.length === 0) return newPreamble;
  const block = harvested.join("") + "\n";
  const beginMarker = "\\begin{document}";
  const idx = newPreamble.indexOf(beginMarker);
  if (idx === -1) return newPreamble + block;
  const before = newPreamble.slice(0, idx).replace(/\s*$/, "");
  const after = newPreamble.slice(idx);
  return before + "\n\n" + block + after;
}

/**
 * Extract the literal `\title{…}\n`, `\author{…}\n`, `\date{…}\n`
 * lines from a preamble string (including any trailing `%!v:UUID`
 * anchor). Returns them in source order, deduplicated by field name.
 * Used by `mergeTitlesIntoStylePreamble`.
 */
function extractTitleFieldLines(preamble: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // Match `\(title|author|date){…}` with brace-balanced extraction,
  // followed by an optional `%!v:hex` UUID anchor up to the line end.
  // Brace scanning is the lexer's `extractBraced` — the SSOT. (A former
  // comment here claimed the re-rolled copy avoided a "cross-module dep";
  // that was false — the lexer imports only latex-typography, so there is
  // no cycle — and the copy carried the naive single-char escape bug, which
  // dropped a `\title{Foo\\}` field plus its `%!v:` UUID on a style switch.)
  let i = 0;
  while (i < preamble.length) {
    const rest = preamble.slice(i);
    const m = rest.match(/^\\(title|author|date)\{/);
    if (!m) {
      i++;
      continue;
    }
    const field = m[1];
    const bracedStart = i + m[0].length - 1;
    const braced = extractBraced(preamble, bracedStart);
    if (!braced) {
      // Unbalanced — bail on this match, advance past `\foo{`.
      i += m[0].length;
      continue;
    }
    let end = braced.end;
    // Optional UUID anchor: ` %!v:abcd` immediately after closing brace.
    const afterMatch = preamble.slice(end).match(/^\s*%!v:[a-f0-9]+/);
    if (afterMatch) end += afterMatch[0].length;
    // Swallow one trailing newline so re-injection doesn't accumulate blanks.
    let lineEnd = end;
    if (preamble[lineEnd] === "\n") lineEnd++;
    if (!seen.has(field)) {
      seen.add(field);
      // Preserve the raw line (with anchor + newline if present) so the
      // UUID survives the style switch.
      out.push(preamble.slice(i, lineEnd));
    }
    i = lineEnd;
  }
  return out;
}

/** Assign UUIDs to all block-level nodes that lack one. Mutates the doc in place.
 *  Container nodes (lists, blockquote) get a single UUID — inner paragraphs are suppressed.
 *  Headings, titleFields, atom blocks (displayMath, latexComment, codeBlock) always get a UUID.
 *
 *  Also dedups inline `citationId` and `footnoteId` attrs. The 4-char hex id
 *  space (65K) starts seeing collisions in modest-sized docs, and once two
 *  citations or footnotes share an id the React keys collide in Marginalia /
 *  Omni. Each kind is deduped within its own namespace (React keys are
 *  prefixed `citation:` / `footnote:`, so cross-kind collisions are not a
 *  rendering problem). */
export function assignUuids(doc: JSONContent): void {
  // Task 346: "does MY inner paragraph defer?" is asked of the paragraph's
  // IMMEDIATE PARENT, from the shared `DEFERRING_PARENTS` SSOT — never from a
  // local `CONTAINER_TYPES` literal, and never from an INHERITED
  // "am I somewhere inside a container" flag.
  //
  // Both halves of that mattered. The literal was missing `exampleItem` and
  // `exampleBlock` (the editor's set gained them; these three copies never
  // did), and the inherited flag was only an approximation of the real rule —
  // `exampleItemList` sits between an `exampleBlock` and its `exampleItem`s and
  // is not a container name, so a flag would have been reset there even with
  // the names added. The two sets stay distinct in ROLE: `CONTAINER_DESCEND`
  // below decides where the walk descends and which nodes own their own uuid;
  // `DEFERRING_PARENTS` decides only whether a paragraph yields identity to the
  // node directly above it.
  const CONTAINER_DESCEND = new Set(["bulletList", "orderedList", "blockquote"]);
  const existing = new Set<string>();

  // First pass: collect existing UUIDs and detect duplicates.
  // If the same UUID appears on multiple nodes (e.g. from a bad recovery),
  // only the first node keeps it — the rest get cleared so pass 2 assigns
  // fresh unique UUIDs.
  const seen = new Set<string>();
  function dedup(node: JSONContent) {
    if (UUID_BEARING_NODE_TYPES.has(node.type!) && node.attrs?.uuid) {
      const uuid = node.attrs.uuid as string;
      if (seen.has(uuid)) {
        // Duplicate — clear so it gets a fresh UUID in pass 2
        node.attrs.uuid = null;
      } else {
        seen.add(uuid);
        existing.add(uuid);
      }
    }
    node.content?.forEach(dedup);
  }
  dedup(doc);

  function ensureUuid(node: JSONContent) {
    if (!node.attrs) node.attrs = {};
    node.attrs.uuid = generateShortId(existing);
    existing.add(node.attrs.uuid as string);
  }

  // Second pass: assign missing UUIDs (a deferred inner paragraph gets none)
  function assign(node: JSONContent, parentType: string | null = null) {
    const deferred = node.type === "paragraph" && deferringParent(parentType);
    // Strip a stale uuid on a deferred inner paragraph — its container owns
    // the anchor identity.
    if (deferred && node.attrs?.uuid) {
      node.attrs.uuid = null;
      node.attrs.parTitle = null;
    }
    // Container nodes (bulletList / orderedList / blockquote) get a UUID.
    if (CONTAINER_DESCEND.has(node.type!)) {
      if (!node.attrs?.uuid) ensureUuid(node);
      node.content?.forEach((child) => assign(child, node.type));
      return;
    }
    // List items are per-item anchor targets (so the action button works
    // inside an item, marginalia can pin to a single line, etc.). Their
    // inner paragraph stays UUID-less — `listItem` is a DEFERRING_PARENT.
    if (node.type === "listItem") {
      if (!node.attrs?.uuid) ensureUuid(node);
      node.content?.forEach((child) => assign(child, node.type));
      return;
    }
    // Non-empty paragraphs get a UUID (unless deferred). This is the ONE
    // remaining policy: a paragraph's identity is conditional.
    if (
      node.type === "paragraph" &&
      !deferred &&
      node.content &&
      node.content.length > 0 &&
      !node.attrs?.uuid
    ) {
      ensureUuid(node);
    }
    // Everything else that DECLARES a uuid gets one, unconditionally — headings,
    // titleFields, and every atom-like block (`maketitleMarker` among them: the
    // D4 drag-cliff fix, since uuid-less it forced the drop hit-test to mint
    // mid-drag). Read from the SSOT rather than listed, so a new uuid-bearing
    // node type mints by DEFAULT instead of being silently skipped — the rule
    // task 342 earned one branch over. Two types were already being skipped
    // that way: `texBlock`, whose serializer writes `%!vtex:begin <uuid>` and
    // whose parser recovers the block by matching that id, so a uuid-less one
    // emitted an empty marker and came back as prose (its raw LaTeX shredded
    // into a latexComment + a smart-typography-mangled paragraph — `--` → `–`);
    // and `exampleItem`, whose `\vxid` marker is what makes an item's identity
    // survive a reload at all. Both are covered in practice by the parser and by
    // `BlockUuidBackfill` (whose own eligibility IS schema-derived), so this
    // changes no real document's bytes — it heals the pathological case instead
    // of destroying it.
    if (
      node.type !== "paragraph" &&
      UUID_BEARING_NODE_TYPES.has(node.type!) &&
      !node.attrs?.uuid
    ) {
      ensureUuid(node);
    }
    node.content?.forEach((child) => assign(child, node.type ?? null));
  }
  assign(doc);

  // Inline id dedup (separate id space per kind, since React keys are
  // namespaced `citation:` / `footnote:`). For each kind: walk once,
  // clear duplicates, then walk again to refill cleared slots with ids
  // that avoid every survivor. Footnotes stash their body as
  // `attrs.content` (they're inline atoms), and citations inside that
  // body must also be visited — recurse into any attrs.content array.
  function dedupInlineId(typeName: string, attrName: string) {
    const survivors = new Set<string>();
    const localSeen = new Set<string>();
    const walkChildren = (node: JSONContent, fn: (n: JSONContent) => void) => {
      node.content?.forEach(fn);
      // Inline atoms (footnote, note) stash their body on `attrs.content`,
      // shaped as either a JSONContent doc node or a raw children array
      // (see normalizeRichContent's four shapes). Descend into both.
      const attrContent = node.attrs?.content;
      if (Array.isArray(attrContent)) {
        for (const child of attrContent as JSONContent[]) fn(child);
      } else if (attrContent && typeof attrContent === "object") {
        fn(attrContent as JSONContent);
      }
    };
    const dedupWalk = (node: JSONContent) => {
      if (node.type === typeName) {
        const id = node.attrs?.[attrName] as string | undefined;
        if (id) {
          if (localSeen.has(id)) {
            // Duplicate — clear so the fill walk regenerates it.
            (node.attrs as Record<string, unknown>)[attrName] = "";
          } else {
            localSeen.add(id);
            survivors.add(id);
          }
        }
      }
      walkChildren(node, dedupWalk);
    };
    dedupWalk(doc);

    const fillWalk = (node: JSONContent) => {
      if (node.type === typeName) {
        const attrs = (node.attrs ?? {}) as Record<string, unknown>;
        if (!attrs[attrName]) {
          const fresh = generateShortId(survivors);
          survivors.add(fresh);
          attrs[attrName] = fresh;
          node.attrs = attrs;
        }
      }
      walkChildren(node, fillWalk);
    };
    fillWalk(doc);
  }

  dedupInlineId("citation", "citationId");
  dedupInlineId("footnote", "footnoteId");
}

/**
 * Read-only twin of `assignUuids`: true iff a run would MUTATE the doc.
 *
 * (Perf Wave 1 / S3.) With `BlockUuidBackfill` live in the editor, every
 * anchorable block already carries a unique uuid by the end of the inserting
 * transaction — so at save time this is almost always false, and the save
 * path can (a) skip the four mutation walks and (b) safely receive the
 * DocProducts pipeline's SHARED docJson, whose cached per-block entries must
 * never be mutated. When it returns true, the caller deep-copies and runs
 * the real `assignUuids` on the copy. Drift between the two is pinned by
 * `latex-serializer-needs-uuid-work.test.ts` (predicate ⇔ mutation).
 */
export function needsUuidWork(doc: JSONContent): boolean {
  // Mirrors `assignUuids` exactly, including its task-346 SSOT read: this
  // predicate IS the save-path gate, so a stale rule here is not a second copy
  // — it is the rule, and whatever this walk cannot see the mutator never gets
  // the chance to heal. That is precisely what kept it answering TRUE forever
  // on any paper holding one `\ex`.
  const CONTAINER_DESCEND = new Set(["bulletList", "orderedList", "blockquote"]);
  let work = false;

  // Pass 1 mirror: duplicate uuids among bearing nodes.
  const seen = new Set<string>();
  function dedup(node: JSONContent) {
    if (work) return;
    if (UUID_BEARING_NODE_TYPES.has(node.type!) && node.attrs?.uuid) {
      const uuid = node.attrs.uuid as string;
      if (seen.has(uuid)) {
        work = true;
        return;
      }
      seen.add(uuid);
    }
    node.content?.forEach(dedup);
  }
  dedup(doc);
  if (work) return true;

  // Pass 2 mirror: any node the assign ladder would touch.
  function assign(node: JSONContent, parentType: string | null = null) {
    if (work) return;
    const deferred = node.type === "paragraph" && deferringParent(parentType);
    if (deferred && node.attrs?.uuid) {
      work = true; // assignUuids would CLEAR uuid/parTitle here
      return;
    }
    if (CONTAINER_DESCEND.has(node.type!)) {
      if (!node.attrs?.uuid) {
        work = true;
        return;
      }
      node.content?.forEach((child) => assign(child, node.type));
      return;
    }
    if (node.type === "listItem") {
      if (!node.attrs?.uuid) {
        work = true;
        return;
      }
      node.content?.forEach((child) => assign(child, node.type));
      return;
    }
    if (
      node.type === "paragraph" &&
      !deferred &&
      node.content &&
      node.content.length > 0 &&
      !node.attrs?.uuid
    ) {
      work = true;
      return;
    }
    // Mirrors `assignUuids`' default branch EXACTLY, and reads the same SSOT to
    // do it. This predicate is the save path's gate — both backends run
    // `assignUuids` only when it answers true — so a hand list here is not a
    // second copy of the rule, it is the rule: whatever this branch cannot see,
    // the mutator never gets the chance to heal. Keeping the pre-343 list of
    // seven here would have left the new default mint unreachable in production
    // (task 343; the equivalence is swept per uuid-bearing type in
    // `latex-serializer-needs-uuid-work.test.ts`).
    if (
      node.type !== "paragraph" &&
      UUID_BEARING_NODE_TYPES.has(node.type!) &&
      !node.attrs?.uuid
    ) {
      work = true;
      return;
    }
    node.content?.forEach((child) => assign(child, node.type ?? null));
  }
  assign(doc);
  if (work) return true;

  // Pass 3 mirror: inline-id dedup/fill (citation:citationId,
  // footnote:footnoteId) — duplicate OR missing/empty id means the fill
  // walk would write.
  function inlineIdWork(typeName: string, attrName: string): boolean {
    const localSeen = new Set<string>();
    let found = false;
    const walkChildren = (node: JSONContent, fn: (n: JSONContent) => void) => {
      node.content?.forEach(fn);
      const attrContent = node.attrs?.content;
      if (Array.isArray(attrContent)) {
        for (const child of attrContent as JSONContent[]) fn(child);
      } else if (attrContent && typeof attrContent === "object") {
        fn(attrContent as JSONContent);
      }
    };
    const walk = (node: JSONContent) => {
      if (found) return;
      if (node.type === typeName) {
        const id = node.attrs?.[attrName] as string | undefined;
        if (!id || localSeen.has(id)) {
          found = true;
          return;
        }
        localSeen.add(id);
      }
      walkChildren(node, walk);
    };
    walk(doc);
    return found;
  }
  return inlineIdWork("citation", "citationId") || inlineIdWork("footnote", "footnoteId");
}

/** Recursively extract plain text from a JSONContent subtree. */
function extractPlainText(node: JSONContent): string {
  if (node.type === "text") return node.text || "";
  if (node.type === "inlineMath") return `$${node.attrs?.latex || ""}$`;
  if (node.type === "citation") return node.attrs?.command || "";
  if (node.type === "footnote") return richJsonToPlainText(normalizeRichContent(node.attrs?.content));
  if (node.type === "hardBreak") return " ";
  if (node.type === "displayMath") return node.attrs?.latex || "";
  // latexComment holds its text as native inline content now — fall through to
  // the generic content-flatten below (no `attrs.text` special-case).
  if (!node.content) return "";
  const sep = node.type === "bulletList" || node.type === "orderedList" ? "; " : "";
  return node.content.map(extractPlainText).join(sep);
}

/** Compute a content fingerprint: lowercased, whitespace-collapsed, first 80 chars. */
function computeFingerprint(node: JSONContent): string {
  const text = extractPlainText(node);
  return text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80);
}

const UUID_ELIGIBLE = UUID_BEARING_NODE_TYPES;

/** Extract sidecar data (titles + fingerprints keyed by UUID) from the document. */
export function extractSidecarData(doc: JSONContent): VirgilSidecar {
  const paragraphs: VirgilSidecar["paragraphs"] = {};
  function walk(node: JSONContent) {
    if (UUID_ELIGIBLE.has(node.type!) && node.attrs?.uuid) {
      const uuid = node.attrs.uuid as string;
      const fp = computeFingerprint(node);
      // Ask the SAME sets `mergeSidecarTitles` reads back, so what is written
      // is what can be restored. A node type that does not declare the attr
      // cannot carry a meaningful value here (TipTap drops undeclared attrs),
      // so this is behaviour-neutral today — it is the SYMMETRY that matters:
      // a write set broader than the read set is exactly how an exampleBlock's
      // title was persisted faithfully and refused on reload (task 343).
      const title = TITLED_NODE_TYPES.has(node.type!)
        ? (node.attrs.parTitle as string | undefined)
        : undefined;
      const collapsed =
        COLLAPSIBLE_NODE_TYPES.has(node.type!) && node.attrs.collapsed === true;
      if (title || fp || collapsed) {
        paragraphs[uuid] = {
          ...(title ? { title } : {}),
          ...(fp ? { fingerprint: fp } : {}),
          ...(collapsed ? { collapsed: true } : {}),
        };
      }
    }
    node.content?.forEach(walk);
  }
  walk(doc);
  return { paragraphs };
}

/** Recover orphaned UUIDs by matching content fingerprints. Mutates doc in place. */
export function recoverOrphanedUuids(doc: JSONContent, sidecar: VirgilSidecar): void {
  if (!sidecar?.paragraphs) return;
  // 1. Collect current UUIDs in the document
  const currentUuids = new Set<string>();
  function collectCurrent(node: JSONContent) {
    if (UUID_ELIGIBLE.has(node.type!) && node.attrs?.uuid) {
      currentUuids.add(node.attrs.uuid as string);
    }
    node.content?.forEach(collectCurrent);
  }
  collectCurrent(doc);

  // 2. Find orphaned sidecar entries (UUIDs not in the document)
  const orphansByFingerprint = new Map<string, { uuid: string; title?: string }[]>();
  for (const [uuid, meta] of Object.entries(sidecar.paragraphs)) {
    if (currentUuids.has(uuid)) continue;
    if (!meta.fingerprint) continue;
    const list = orphansByFingerprint.get(meta.fingerprint) || [];
    list.push({ uuid, title: meta.title });
    orphansByFingerprint.set(meta.fingerprint, list);
  }

  if (orphansByFingerprint.size === 0) return;

  // Same task-346 SSOT read as its two siblings. This walk restores orphans BY
  // FINGERPRINT, so a stale rule here is worse than a churning uuid: while the
  // inner paragraph kept an identity, it and its container carried the SAME
  // fingerprint, and a fingerprint that names two nodes is a wrong-restore.
  // (This path is currently disabled, which is the only reason that was a
  // hazard rather than a defect.)
  const CONTAINER_DESCEND = new Set(["bulletList", "orderedList", "blockquote"]);

  // 3. Walk document for UUID-eligible nodes missing a UUID, try to recover
  function recover(node: JSONContent, parentType: string | null = null) {
    if (node.type === "paragraph" && deferringParent(parentType)) return;
    // Container nodes (bulletList / orderedList / blockquote): recover
    // the container UUID, then recurse so listItems can recover too.
    if (CONTAINER_DESCEND.has(node.type!)) {
      if (!node.attrs?.uuid) {
        const fp = computeFingerprint(node);
        if (fp) tryRestore(node, fp);
      }
      node.content?.forEach((child) => recover(child, node.type));
      return;
    }
    // List items are per-item anchor targets — recover via the item's
    // content fingerprint, then continue into the inner paragraph(s).
    if (node.type === "listItem") {
      if (!node.attrs?.uuid) {
        const fp = computeFingerprint(node);
        if (fp) tryRestore(node, fp);
      }
      node.content?.forEach((child) => recover(child, node.type));
      return;
    }
    // Headings and titleFields always recoverable
    if (
      node.type === "heading" ||
      node.type === "titleField" ||
      (node.type === "paragraph" && node.content && node.content.length > 0)
    ) {
      if (!node.attrs?.uuid) {
        const fp = computeFingerprint(node);
        if (fp) tryRestore(node, fp);
      }
    }
    // Atom-like block nodes
    if (
      (node.type === "displayMath" ||
        node.type === "latexComment" ||
        node.type === "codeBlock" ||
        node.type === "figureBlock" ||
        node.type === "graphicsBlock") &&
      !node.attrs?.uuid
    ) {
      const fp = computeFingerprint(node);
      if (fp) tryRestore(node, fp);
    }
    node.content?.forEach((child) => recover(child, node.type ?? null));
  }

  function tryRestore(node: JSONContent, fp: string) {
    const candidates = orphansByFingerprint.get(fp);
    if (!candidates || candidates.length !== 1) return; // skip ambiguous
    const orphan = candidates[0];
    if (!node.attrs) node.attrs = {};
    node.attrs.uuid = orphan.uuid;
    // Same symmetry rule as `extractSidecarData`: only stamp a title onto a
    // type that declares one. This walk reaches `heading` / `displayMath` /
    // `codeBlock` / the two figure kinds, none of which carry `parTitle` —
    // stamping there wrote an attr the schema then dropped. (This function has
    // no production caller — fingerprint matching caused uuid collisions and
    // both storage backends leave it disabled — so this is a consistency fix,
    // not a live one.)
    if (orphan.title && TITLED_NODE_TYPES.has(node.type!)) {
      node.attrs.parTitle = orphan.title;
    }
    currentUuids.add(orphan.uuid);
    orphansByFingerprint.delete(fp); // consumed
  }

  recover(doc);
}
