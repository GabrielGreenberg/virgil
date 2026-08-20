/**
 * The forest SUBSET grammar — a pure, DOM-free reader over a `forestBlock`'s
 * `source` bytes that either yields a render tree or REFUSES, naming the first
 * construct it did not understand.
 *
 * **Why a subset with a loud refusal, rather than best effort.** The document
 * layer's model for this node is the bytes themselves (task 383), so nothing
 * here can lose anything: the render is a pure derivation and a refusal costs
 * the user a picture, never a byte. That asymmetry is what makes "render
 * exactly what we understand, badge everything else" the right posture — the
 * same 342/355/356 vocabulary law (*model a subset, refuse WHOLE outside it,
 * never guess*) applied to a VIEW instead of to a parse. A tree drawn while
 * silently ignoring `for tree={l sep=2cm}` is a MISRENDER wearing a feature's
 * clothes, and the user has no way to detect it; a badge that names
 * `for tree` is a limitation they can see, work around, and file.
 *
 * Growing the whitelist later is additive and needs no migration, precisely
 * because nothing derived here is persisted: each new key moves inputs from
 * the badge to the render.
 *
 * ## The v1 subset
 *
 * - `\begin{forest}` with NO opener arguments, one bracket tree, `\end{forest}`.
 * - Bracket trees `[label [child] …]` at arbitrary depth.
 * - Labels: text runs, `{…}` groups (one level stripped, as forest does),
 *   inline math `$…$`, and the char escapes (`\$`, `\%`, `\&`, `\_`, `\#`,
 *   `\{`, `\}`). Whitespace runs collapse to one space, as they do in TeX.
 * - Exactly ONE node option, `roof` — the linguistics triangle-over-a-phrase.
 * - Line comments are inert wherever they may start (`skipLineCommentAt`, the
 *   narrow rule every byte-walking scan on this surface reads — task 378).
 *
 * Everything else refuses: a preamble before the tree (`for tree={…}`), any
 * other node option, any LaTeX command in a label, `\node` / `\forestset` /
 * embedded TikZ, a second root, trailing content, unbalanced brackets.
 */

import { matchCommentTailAt, matchCommandToken, isEscaped } from "@/lib/latex-lexer";
import { FOREST_ENV_NAME } from "@/lib/latex-lexer";
import { noteForestWork } from "./stats";

// ── The render tree ─────────────────────────────────────────────────────────

/** One run of a node label. `math` carries the LaTeX BETWEEN the `$`s. */
export type ForestLabelSegment =
  | { kind: "text"; value: string }
  | { kind: "math"; value: string };

/**
 * A node of the RENDER tree — the shape the layout engine and the view read.
 *
 * `roofed` is resolved (see {@link flattenRoofs}): it marks the ONE box a
 * triangle is drawn over, never the node that carried the `roof` option. A
 * roofed internal node collapses its subtree into a single synthesized child
 * holding its descendants' leaf text, which is what forest's own `roof` does;
 * a roofed LEAF wears the triangle itself, the `[{the dog},roof]` idiom.
 */
export interface ForestRenderNode {
  label: ForestLabelSegment[];
  /** The label as flat text — the measurement fallback and the a11y string. */
  labelText: string;
  /** Draw a triangle over THIS box (and terminate its incoming edge at the apex). */
  roofed: boolean;
  children: ForestRenderNode[];
}

// ── Refusals ────────────────────────────────────────────────────────────────

/**
 * The refusal vocabulary. A closed union so the badge, the tests and any future
 * whitelist growth all speak the same names — a refusal that fires for the
 * wrong reason is a wrong message, which is why every kind here is asserted
 * separately in the suite.
 */
export type ForestRefusalKind =
  | "delimiters"
  | "empty"
  | "preamble"
  | "option"
  | "command"
  | "unterminated-math"
  | "unbalanced"
  | "multiple-roots"
  | "trailing"
  | "text-after-child"
  | "too-deep"
  | "too-large"
  | "nested-roof";

export interface ForestRefusal {
  kind: ForestRefusalKind;
  /** The offending construct, verbatim (clipped — see {@link clip}). */
  token: string;
  /** Byte offset into the WHOLE `source` string. */
  offset: number;
  /** 1-based line and column of `offset`, for the badge. */
  line: number;
  column: number;
  /** The specific, human sentence. Composed ONCE, here. */
  message: string;
}

export type ForestParse =
  | { ok: true; tree: ForestRenderNode }
  | { ok: false; refusal: ForestRefusal };

/**
 * Bounds on what this renderer will attempt, stated rather than discovered.
 *
 * The pod parses whatever the user types or pastes, and every stage of the
 * pipeline below — the scanner, the roof flattening, the layout's three walks —
 * is RECURSIVE, so a pasted `[`×10 000 would not refuse, it would throw a
 * `RangeError` out of a React render and take the editor down with it. A
 * refusal is the honest answer for input past a bound, and it is the ONLY
 * answer that keeps the "a view may refuse freely" promise true: the bytes are
 * untouched either way, so the cost of the bound is a picture.
 *
 * The numbers are chosen to be far past anything a syntax tree reaches (a
 * deeply embedded clause is ~15 levels; a full-sentence tree is ~40 nodes) and
 * far short of anything that hurts — 512 absolutely-positioned labels is a
 * heavy but survivable render, 513 is a badge.
 */
export const MAX_FOREST_DEPTH = 64;
export const MAX_FOREST_NODES = 512;

/** Longest token echoed back to the user — enough to recognise, short enough
 *  that a badge stays one line whatever was pasted. */
const TOKEN_CLIP = 40;

function clip(token: string): string {
  const flat = token.replace(/\s+/g, " ").trim();
  return flat.length > TOKEN_CLIP ? `${flat.slice(0, TOKEN_CLIP - 1)}…` : flat;
}

/**
 * The refusal SENTENCE, per kind — the one place the wording lives, so the
 * badge and its test cannot drift and every kind is forced to say something
 * specific rather than falling back to "unsupported syntax".
 */
export function describeForestRefusal(kind: ForestRefusalKind, token: string): string {
  const t = clip(token);
  switch (kind) {
    case "delimiters":
      return `not a \\begin{${FOREST_ENV_NAME}}…\\end{${FOREST_ENV_NAME}} environment`;
    case "empty":
      return "no bracket tree in the environment";
    case "preamble":
      return `forest options before the tree (\`${t}\`)`;
    case "option":
      return `node option \`${t}\` (only \`roof\` is supported)`;
    case "command":
      return `LaTeX command \`${t}\` in a node label`;
    case "unterminated-math":
      return "unterminated `$` in a node label";
    case "unbalanced":
      return `unbalanced \`${t}\``;
    case "multiple-roots":
      return "a second tree after the first (one tree per environment)";
    case "trailing":
      return `content after the tree (\`${t}\`)`;
    case "text-after-child":
      return `text after a child node (\`${t}\`)`;
    case "too-deep":
      return `a tree nested deeper than ${MAX_FOREST_DEPTH} levels`;
    case "too-large":
      return `a tree of more than ${MAX_FOREST_NODES} nodes`;
    case "nested-roof":
      return "`roof` inside another `roof`";
    default: {
      const unhandled: never = kind;
      void unhandled;
      return "unsupported syntax";
    }
  }
}

/** Internal control flow: a refusal unwinds the recursive descent. */
class ForestRefusalError extends Error {
  constructor(
    readonly kind: ForestRefusalKind,
    readonly token: string,
    readonly offset: number,
  ) {
    super(kind);
  }
}

function refuse(kind: ForestRefusalKind, token: string, offset: number): never {
  throw new ForestRefusalError(kind, token, offset);
}

function lineColumn(src: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < src.length; i++) {
    if (src[i] === "\n") {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

// ── The scanner ─────────────────────────────────────────────────────────────

/** Char escapes a label may carry — the literal character each stands for.
 *  Anything else after a `\` is a COMMAND, and a command in a label refuses. */
const LABEL_CHAR_ESCAPES: Record<string, string> = {
  $: "$",
  "%": "%",
  "&": "&",
  _: "_",
  "#": "#",
  "{": "{",
  "}": "}",
};

/**
 * Skip whitespace and comments.
 *
 * This reads TeX's OWN rule (`matchCommentTailAt` — any unescaped `%` to the
 * end of its line), not the narrow line-leading `startsLineComment` that every
 * byte-walking scan in the parser reads. The narrow rule exists because a
 * construct-TERMINATOR scan that believes a mid-line `%` calls a live
 * `\end{env}` inert and swallows the rest of the document (task 338). Nothing
 * here terminates a construct: the source is already claimed, its ends are
 * fixed, and every question asked inside it is a question about what forest
 * itself would read. And reading the narrow rule here would MISRENDER — `[a %c]`
 * is a node labelled "a" in forest and would have rendered as one labelled
 * "a %c", which is the silently-wrong picture this whole grammar exists to
 * refuse. Where a mid-line comment does eat a delimiter, the refusal that
 * follows is the same one forest's own compiler would give.
 */
function skipInert(src: string, i: number): number {
  for (;;) {
    const c = matchCommentTailAt(src, i);
    if (c) {
      i = c.end;
      continue;
    }
    const ch = src[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    return i;
  }
}

/**
 * `findMatchingBrace`, with TeX's comment rule.
 *
 * The shared lexer matcher counts every unescaped `{`/`}`, comments included,
 * and every OTHER scan in this file reads `matchCommentTailAt`. That
 * disagreement is not cosmetic in either direction: a `}` inside a `% …` line
 * closes a group early, and the real `}` then falls through as ordinary ink, so
 * the pod paints a well-formed tree carrying a brace forest never prints — the
 * silently-wrong picture this grammar exists to refuse. The mirror case, a `{`
 * inside a comment, makes the shared matcher answer -1 and produces a spurious
 * `unbalanced` refusal on source TeX reads as balanced. Commenting a brace out
 * mid-restructure is exactly the state a user is in while looking at the pod.
 *
 * It reads the SAME `isEscaped` parity rule the shared matcher does, so `\{`
 * and `\\{` behave identically; only the comment branch differs.
 */
function findMatchingBraceLive(src: string, open: number, limit: number): number {
  if (src[open] !== "{") return -1;
  let depth = 1;
  let i = open + 1;
  while (i < limit) {
    const tail = matchCommentTailAt(src, i);
    if (tail) {
      i = tail.end;
      continue;
    }
    const ch = src[i];
    if (ch === "{" && !isEscaped(src, i)) depth++;
    else if (ch === "}" && !isEscaped(src, i)) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/** A parsed node, before roofs are resolved. */
interface RawNode {
  label: ForestLabelSegment[];
  labelText: string;
  roof: boolean;
  /** Offset of the `roof` option, so a nested-roof refusal can point AT it. */
  roofOffset: number;
  children: RawNode[];
}

interface LabelScan {
  segments: ForestLabelSegment[];
  text: string;
  end: number;
}

/**
 * Read a node label from `i` up to the first `[`, `]` or `,` that is not inside
 * a `{…}` group or a `$…$` run. Whitespace runs collapse to a single space and
 * the result is trimmed, so a label broken across source lines renders as one.
 *
 * `stopAtDelims` is false for the recursion INSIDE a `{…}` group, where those
 * three characters are exactly what the braces were written to protect. It is a
 * parameter rather than two scanners so a group's contents get the identical
 * treatment of math, escapes and comments — a group scanned by a second, looser
 * reader is the fork every vocabulary law in this repo exists to prevent.
 */
function scanLabel(
  src: string,
  i: number,
  limit: number,
  stopAtDelims = true,
  depth = 0,
): LabelScan {
  // A label's `{}` nesting is its OWN recursion, invisible to the node caps —
  // a single node with a deeply braced label costs depth 0 and one node, so
  // neither would fire. Measured: a balanced 10 000-level group overflows the
  // stack, and the `RangeError` is not a refusal, so it escapes into a React
  // render. Same bound, same reason (see MAX_FOREST_DEPTH).
  if (depth > MAX_FOREST_DEPTH) refuse("too-deep", "{", i);
  const segments: ForestLabelSegment[] = [];
  let buf = "";
  let flat = "";

  const pushText = (s: string) => {
    buf += s;
    flat += s;
  };
  const flush = () => {
    const collapsed = buf.replace(/\s+/g, " ");
    if (collapsed.length > 0) segments.push({ kind: "text", value: collapsed });
    buf = "";
  };

  while (i < limit) {
    const c = matchCommentTailAt(src, i);
    if (c) {
      // A comment is not ink. TeX also eats the newline that ends it; the
      // whitespace collapse below makes that difference invisible in a label.
      i = c.end;
      pushText(" ");
      continue;
    }
    const ch = src[i];
    if (stopAtDelims && (ch === "[" || ch === "]" || ch === ",")) break;

    if (ch === "$") {
      // Inline math. The close is the next unescaped `$`.
      let j = i + 1;
      let close = -1;
      while (j < limit) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === "$") {
          close = j;
          break;
        }
        j++;
      }
      if (close < 0) refuse("unterminated-math", "$", i);
      flush();
      const latex = src.slice(i + 1, close);
      segments.push({ kind: "math", value: latex });
      flat += `$${latex}$`;
      i = close + 1;
      continue;
    }

    if (ch === "{") {
      // A `{…}` group: forest's way of protecting commas and brackets inside a
      // label. One level of braces is stripped (they are grouping, not ink) and
      // the contents are scanned as label content, so `{NP, plural}` and
      // `{$\alpha$}` both work.
      const close = findMatchingBraceLive(src, i, limit);
      if (close < 0) refuse("unbalanced", "{", i);
      flush();
      // A group's contents ARE label content — same scanner, delimiter stop
      // switched off, so math / escapes / comments inside a group behave
      // exactly as they do outside one.
      const inner = scanLabel(src, i + 1, close, false, depth + 1);
      for (const seg of inner.segments) segments.push(seg);
      flat += inner.text;
      i = close + 1;
      continue;
    }

    if (ch === "\\") {
      const cmd = matchCommandToken(src, i);
      if (cmd) refuse("command", `\\${cmd.name}`, i);
      const next = src[i + 1];
      const literal = next === undefined ? undefined : LABEL_CHAR_ESCAPES[next];
      if (literal === undefined) refuse("command", `\\${next ?? ""}`, i);
      pushText(literal);
      i += 2;
      continue;
    }

    pushText(ch);
    i++;
  }

  flush();
  // Trim the edges of the assembled label (a leading/trailing space is layout
  // whitespace in the source, not ink).
  if (segments.length > 0) {
    const first = segments[0];
    if (first.kind === "text") first.value = first.value.replace(/^ +/, "");
    const last = segments[segments.length - 1];
    if (last.kind === "text") last.value = last.value.replace(/ +$/, "");
  }
  return {
    segments: segments.filter((s) => s.kind !== "text" || s.value.length > 0),
    text: flat.replace(/\s+/g, " ").trim(),
    end: i,
  };
}

/** Read the comma-separated option list that follows a label. */
function scanOptions(
  src: string,
  i: number,
  limit: number,
): { roof: boolean; roofOffset: number; end: number } {
  let roof = false;
  let roofOffset = -1;
  // `i` sits on the `,` that opened the list.
  while (i < limit && src[i] === ",") {
    i++;
    const start = skipInert(src, i);
    let j = start;
    // The token is assembled from the LIVE spans, not sliced raw from
    // `start..j` — the loop steps OVER comments, so a raw slice would carry
    // their bytes into the token and `[NP,roof % triangle]` would refuse with
    // "node option `roof % triangle`", naming an option the user never wrote
    // with the word `roof` visible inside it. A refusal that fires for the
    // wrong reason is a wrong message.
    let spanStart = start;
    let live = "";
    while (j < limit) {
      const tail = matchCommentTailAt(src, j);
      if (tail) {
        live += src.slice(spanStart, j);
        j = tail.end;
        spanStart = j;
        continue;
      }
      const ch = src[j];
      if (ch === "{") {
        const close = findMatchingBraceLive(src, j, limit);
        if (close < 0) refuse("unbalanced", "{", j);
        j = close + 1;
        continue;
      }
      if (ch === "," || ch === "[" || ch === "]") break;
      j++;
    }
    live += src.slice(spanStart, j);
    const token = live.trim();
    if (token.length > 0) {
      if (token !== "roof") refuse("option", token, start);
      roof = true;
      roofOffset = start;
    }
    i = j;
  }
  return { roof, roofOffset, end: i };
}

/** Read one `[ … ]` node. `i` must sit on the `[`. `budget` is shared across the
 *  whole tree, so the node cap bounds the WHOLE parse rather than one branch. */
function scanNode(
  src: string,
  i: number,
  limit: number,
  depth: number,
  budget: { nodes: number },
): { node: RawNode; end: number } {
  if (src[i] !== "[") refuse("unbalanced", src[i] ?? "", i);
  if (depth > MAX_FOREST_DEPTH) refuse("too-deep", "[", i);
  if (++budget.nodes > MAX_FOREST_NODES) refuse("too-large", "[", i);
  i++;
  const label = scanLabel(src, i, limit);
  i = label.end;

  let roof = false;
  let roofOffset = -1;
  if (src[i] === ",") {
    const opts = scanOptions(src, i, limit);
    roof = opts.roof;
    roofOffset = opts.roofOffset;
    i = opts.end;
  }

  const children: RawNode[] = [];
  for (;;) {
    i = skipInert(src, i);
    if (i >= limit) refuse("unbalanced", "[", i);
    if (src[i] === "[") {
      const child = scanNode(src, i, limit, depth + 1, budget);
      children.push(child.node);
      i = child.end;
      continue;
    }
    break;
  }

  if (src[i] !== "]") {
    // Neither a child nor the close. `i >= limit` is an unterminated node; a
    // real character here is text sitting AFTER a child, which forest rejects
    // too — and which deserves its own sentence, because "unbalanced `c]`" sends
    // the reader hunting for a bracket that is perfectly balanced.
    if (i >= limit) refuse("unbalanced", "[", i);
    refuse("text-after-child", src.slice(i, Math.min(limit, i + TOKEN_CLIP)), i);
  }
  return {
    node: { label: label.segments, labelText: label.text, roof, roofOffset, children },
    end: i + 1,
  };
}

// ── Roof resolution ─────────────────────────────────────────────────────────

/** Every leaf label of a subtree, in document order — the base line a roof
 *  collapses its descendants into, exactly as forest's own `roof` does. */
function collectLeafSegments(node: RawNode, out: ForestLabelSegment[], texts: string[]): void {
  if (node.children.length === 0) {
    if (out.length > 0) out.push({ kind: "text", value: " " });
    for (const seg of node.label) out.push(seg);
    if (node.labelText) texts.push(node.labelText);
    return;
  }
  for (const child of node.children) collectLeafSegments(child, out, texts);
}

/** The offset of the first `roof` option strictly below `node`, or -1. */
function roofBelow(node: RawNode): number {
  for (const child of node.children) {
    if (child.roof) return child.roofOffset;
    const deeper = roofBelow(child);
    if (deeper >= 0) return deeper;
  }
  return -1;
}

/**
 * Resolve `roof` options into the ONE box each triangle is drawn over.
 *
 * A roofed LEAF wears its own triangle (`[{the dog},roof]`). A roofed INTERNAL
 * node keeps its label and gains a single synthesized child holding its
 * descendants' leaf text under the triangle — which is what forest draws, and
 * why the internals genuinely disappear. A roof INSIDE a roofed subtree is
 * refused rather than silently swallowed: two interacting triangles are exactly
 * the kind of guess this grammar exists not to make.
 */
function flattenRoofs(node: RawNode): ForestRenderNode {
  if (node.roof) {
    const nested = roofBelow(node);
    if (nested >= 0) refuse("nested-roof", "roof", nested);
    if (node.children.length === 0) {
      return { label: node.label, labelText: node.labelText, roofed: true, children: [] };
    }
    const segs: ForestLabelSegment[] = [];
    const texts: string[] = [];
    for (const child of node.children) collectLeafSegments(child, segs, texts);
    return {
      label: node.label,
      labelText: node.labelText,
      roofed: false,
      children: [
        { label: segs, labelText: texts.join(" "), roofed: true, children: [] },
      ],
    };
  }
  return {
    label: node.label,
    labelText: node.labelText,
    roofed: false,
    children: node.children.map(flattenRoofs),
  };
}

// ── The door ────────────────────────────────────────────────────────────────

const BEGIN_RE = new RegExp(`^\\s*\\\\begin\\{${FOREST_ENV_NAME}\\}`);
const END_RE = new RegExp(`\\\\end\\{${FOREST_ENV_NAME}\\}\\s*$`);

/**
 * Read a `forestBlock`'s `source` into a render tree, or refuse naming the
 * first construct outside the v1 subset.
 *
 * PURE and DOM-free — the layout engine and the badge are both derived from
 * this and nothing else, so a refusal is reproducible from the bytes alone.
 */
export function parseForestSource(source: string): ForestParse {
  noteForestWork("parse");
  try {
    const begin = BEGIN_RE.exec(source);
    const end = END_RE.exec(source);
    if (!begin || !end) {
      refuse("delimiters", source.slice(0, 24), 0);
    }
    const bodyStart = begin[0].length;
    const bodyEnd = end.index;
    if (bodyEnd < bodyStart) refuse("delimiters", source.slice(0, 24), 0);

    let i = skipInert(source, bodyStart);
    if (i >= bodyEnd) refuse("empty", "", bodyStart);
    if (source[i] !== "[") {
      // A preamble (`for tree={…}`), a `\forestset`, a `\node`, embedded TikZ —
      // whatever it is, name its first token rather than saying "unsupported".
      const cmd = matchCommandToken(source, i);
      const token = cmd
        ? `\\${cmd.name}`
        : source.slice(i, Math.min(bodyEnd, i + TOKEN_CLIP)).split(/[=\n{]/)[0].trim() ||
          source.slice(i, i + 8);
      refuse("preamble", token, i);
    }

    const root = scanNode(source, i, bodyEnd, 0, { nodes: 0 });
    i = skipInert(source, root.end);
    if (i < bodyEnd) {
      if (source[i] === "[") refuse("multiple-roots", "[", i);
      refuse("trailing", source.slice(i, Math.min(bodyEnd, i + TOKEN_CLIP)), i);
    }
    return { ok: true, tree: flattenRoofs(root.node) };
  } catch (err) {
    if (err instanceof ForestRefusalError) {
      const { line, column } = lineColumn(source, err.offset);
      return {
        ok: false,
        refusal: {
          kind: err.kind,
          token: clip(err.token),
          offset: err.offset,
          line,
          column,
          message: describeForestRefusal(err.kind, err.token),
        },
      };
    }
    throw err;
  }
}
