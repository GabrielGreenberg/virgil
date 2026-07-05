/**
 * SSOT registry of what Virgil-emitted LaTeX needs from the preamble.
 *
 * Virgil serializes constructs (expex examples, `\includegraphics`,
 * natbib/biblatex cite commands, `\textcolor`, tikz passthrough) whose
 * packages the doc's preamble may not declare — historically only xcolor
 * and the `\v*id` shims were auto-injected. This module owns:
 *
 *  - the requirement entries themselves (`LATEX_REQUIREMENTS`),
 *  - save-time body-scan detection (`detectBodyRequirements`),
 *  - idempotent preamble injection (`ensurePreambleRequirements`),
 *  - the baseline package block new preambles are built from
 *    (`VIRGIL_BASELINE_PACKAGES` / `buildPreamble`),
 *  - normalization for drift comparison (`stripAutoInjectedLines`).
 *
 * Consumed by latex-serializer.ts (every serialize), document-styles.ts /
 * document-templates.ts (seed preambles), and the style UI (drift gate +
 * custom-macro filter). Dependency direction is one-way: this module must
 * not import document-styles/document-templates.
 *
 * Keystroke sanctity: everything here runs at save/serialize time only —
 * a single regex pass over the serialized body, never per keystroke.
 */

import {
  BIBLATEX_ONLY_CITE_COMMANDS,
  KERNEL_NEUTRAL_CITE_COMMANDS,
  NATBIB_ONLY_CITE_COMMANDS,
  SHARED_CITE_COMMANDS,
} from "@/lib/cite-commands";

export type LatexRequirementKind = "package" | "shim";

export interface LatexRequirement {
  /** Package name (`expex`) or shim command name (`vfid`). */
  id: string;
  kind: LatexRequirementKind;
  /** Exact line injected into the preamble when missing. */
  injectLine: string;
  /** Matches a preamble that already satisfies the requirement. */
  satisfiedRe: RegExp;
}

function packageReq(name: string): LatexRequirement {
  return {
    id: name,
    kind: "package",
    injectLine: `\\usepackage{${name}}`,
    // Word-boundary match INSIDE the brace group, so one regex recognizes
    // the package in every load shape:
    //   \usepackage{name}                  — the plain form (our injectLine)
    //   \usepackage[opts]{a, name ,b}      — comma-separated package lists
    //   \RequirePackage{name}              — class/package-style loads
    //   \usepackage[authordate]{name-chicago} — wrapper packages (`-` is a
    //     word boundary; wrappers like biblatex-chicago load their core, so
    //     they satisfy — and must gate — the core requirement).
    satisfiedRe: new RegExp(
      `\\\\(?:usepackage|RequirePackage)(?:\\[[^\\]]*\\])?\\{[^}]*\\b${name}\\b[^}]*\\}`,
    ),
  };
}

function shimReq(name: string): LatexRequirement {
  return {
    id: name,
    kind: "shim",
    injectLine: `\\providecommand{\\${name}}[1]{}`,
    satisfiedRe: new RegExp(`\\\\(?:provide|new|renew)command\\{\\\\${name}\\}`),
  };
}

/**
 * The Virgil entity-id marker shims, in canonical declaration order.
 * `\vbid` marks a bibliography entry's durable surrogate id (in the `.bib`,
 * round-tripped by serializeBibFile). It never appears in the `.tex`, but
 * we declare the no-op so a `.bib` `\input` or a paper opened in raw LaTeX
 * never breaks — mirrors the inline-atom `\vcid`/`\vfid` guards.
 */
export const SHIM_COMMAND_NAMES = [
  "vfid",
  "vcid",
  "vbid",
  "vexid",
  "vxid",
  "vlid",
  "vlidend",
] as const;

/**
 * Full registry. Packages before shims — this order IS the injection order
 * (xcolor leads the packages to preserve the legacy `ensureVirgilCommands`
 * byte output when nothing body-driven is required).
 */
export const LATEX_REQUIREMENTS: LatexRequirement[] = [
  packageReq("xcolor"),
  packageReq("graphicx"),
  packageReq("expex"),
  packageReq("natbib"),
  packageReq("biblatex"),
  packageReq("tikz"),
  ...SHIM_COMMAND_NAMES.map(shimReq),
];

const REQUIREMENT_BY_ID = new Map(LATEX_REQUIREMENTS.map((r) => [r.id, r]));

/**
 * Ensured on EVERY serialize regardless of body content: the shims (a stray
 * marker must never break compilation) and xcolor (`\textcolor[HTML]{…}`
 * from the textColor mark) — today's behavior, preserved.
 */
const ALWAYS_REQUIRED_IDS: string[] = [
  "xcolor",
  ...SHIM_COMMAND_NAMES,
];

// ---------------------------------------------------------------------------
// Body-scan detection
// ---------------------------------------------------------------------------

// NOTE: escapeLatex deliberately does NOT escape backslashes (raw LaTeX in
// prose is preserved by design — latex-serializer.ts `escapeLatex`), so a
// `\includegraphics` in the body is not guaranteed to be Virgil-emitted.
// That's fine for detection — a hand-typed live command needs its package
// just as much — but it means INERT occurrences (inside `%` comments and
// verbatim environments) must be projected away first; see
// `projectDetectableBody` below. The `(?![a-zA-Z])` guard stops `\ex`
// matching `\example` etc. (LaTeX command names are letters only).
const BODY_DETECTORS: Array<{ id: string; re: RegExp }> = [
  {
    id: "expex",
    re: /\\(?:begingl|getfullref|getref|pex|ex)(?![a-zA-Z])|\\begin\{xlist\}/,
  },
  { id: "graphicx", re: /\\includegraphics(?![a-zA-Z])/ },
  { id: "tikz", re: /\\begin\{tikzpicture\}/ },
  { id: "xcolor", re: /\\textcolor(?![a-zA-Z])/ },
];

/** Alternation over the family's commands + capitalized sentence-start
 *  variants, longest-first (same convention as cite-commands.ts). */
function familyRe(names: Iterable<string>): RegExp {
  const all: string[] = [];
  for (const n of names) {
    all.push(n);
    all.push(n[0].toUpperCase() + n.slice(1));
  }
  all.sort((a, b) => b.length - a.length);
  return new RegExp(`\\\\(?:${all.join("|")})(?![a-zA-Z])`);
}

// Cite-command buckets from the shared registry (cite-commands.ts):
// natbib-only pins natbib; biblatex-only pins biblatex; SHARED commands
// (\cite/\nocite/\citeauthor/\citeyear — defined by both packages) pin
// neither on their own. Of the shared set, bare \cite/\nocite are
// additionally LaTeX-kernel commands — a body using ONLY those needs no
// bib package at all — while \citeauthor/\citeyear DO need one of the two.
const NATBIB_ONLY_RE = familyRe(NATBIB_ONLY_CITE_COMMANDS);
const BIBLATEX_ONLY_RE = familyRe(BIBLATEX_ONLY_CITE_COMMANDS);
const SHARED_NON_KERNEL_RE = familyRe(
  [...SHARED_CITE_COMMANDS].filter(
    (c) => !KERNEL_NEUTRAL_CITE_COMMANDS.has(c),
  ),
);

const VERBATIM_BEGIN_RE = /\\begin\{verbatim\*?\}/;
const VERBATIM_END_RE = /\\end\{verbatim\*?\}/;

/** Strip a line's `%`-comment tail. A `%` starts a comment unless escaped
 *  (`\%`); an even run of backslashes before it (`\\%` = linebreak + comment)
 *  does not escape it. */
function stripCommentTail(line: string): string {
  return line.replace(/((?:^|[^\\])(?:\\\\)*)%.*$/, "$1");
}

/**
 * Project the serialized body down to its DETECTABLE LaTeX: drop
 * `%`-comment tails (respecting `\%`) and the contents of
 * `\begin{verbatim}…\end{verbatim}` / `verbatim*` environments — both are
 * inert to the compiler, so a `\autocite` in a TODO comment or an `\ex`
 * inside a verbatim listing must not drive package injection (injecting
 * biblatex/expex into a doc that never runs them can BREAK a previously
 * compiling paper). Line-based single pass; an unterminated
 * `\begin{verbatim}` (mid-edit) swallows to the end of the body, matching
 * how TeX would lex it.
 */
function projectDetectableBody(bodyLatex: string): string {
  if (!bodyLatex.includes("%") && !VERBATIM_BEGIN_RE.test(bodyLatex)) {
    return bodyLatex; // fast path: nothing inert to strip
  }
  const out: string[] = [];
  let inVerbatim = false;
  for (const rawLine of bodyLatex.split("\n")) {
    // Comments only exist outside verbatim (inside, `%` is literal — and
    // the content is dropped wholesale anyway).
    let line = inVerbatim ? rawLine : stripCommentTail(rawLine);
    let kept = "";
    // Walk the line through verbatim open/close transitions so same-line
    // `\begin{verbatim}…\end{verbatim}` pairs are handled too.
    for (;;) {
      if (inVerbatim) {
        const end = VERBATIM_END_RE.exec(line);
        if (!end) {
          line = "";
          break;
        }
        inVerbatim = false;
        line = line.slice(end.index + end[0].length);
        continue;
      }
      const begin = VERBATIM_BEGIN_RE.exec(line);
      if (!begin) {
        kept += line;
        break;
      }
      kept += line.slice(0, begin.index);
      inVerbatim = true;
      line = line.slice(begin.index + begin[0].length);
    }
    out.push(kept);
  }
  return out.join("\n");
}

/**
 * Single-pass detection over the SERIALIZED body: which registry packages
 * does this body actually use? Returns requirement ids. Runs on the
 * inert-stripped projection (see `projectDetectableBody`) so commented-out
 * or verbatim-quoted commands never inject packages.
 *
 * Cite-family resolution (three buckets, see cite-commands.ts):
 *  - any natbib-ONLY command present → natbib (even if biblatex-only
 *    commands also appear — the packages are mutually exclusive and natbib
 *    is Virgil's baseline family);
 *  - else any biblatex-ONLY command present → biblatex;
 *  - else only SHARED commands: \citeauthor/\citeyear need SOME bib package
 *    → natbib (baseline default); bare \cite/\nocite are kernel commands →
 *    no requirement.
 */
export function detectBodyRequirements(bodyLatex: string): Set<string> {
  const scannable = projectDetectableBody(bodyLatex);
  const required = new Set<string>();
  for (const d of BODY_DETECTORS) {
    if (d.re.test(scannable)) required.add(d.id);
  }
  if (NATBIB_ONLY_RE.test(scannable)) required.add("natbib");
  else if (BIBLATEX_ONLY_RE.test(scannable)) required.add("biblatex");
  else if (SHARED_NON_KERNEL_RE.test(scannable)) required.add("natbib");
  return required;
}

// ---------------------------------------------------------------------------
// Preamble injection
// ---------------------------------------------------------------------------

/**
 * Idempotently inject every missing requirement right before
 * `\begin{document}` (bail unchanged if the marker is absent — a
 * mid-edit/fragment preamble is not ours to guess at). Packages are
 * injected before shims; the shims + xcolor are ensured on every call
 * regardless of `required` (see ALWAYS_REQUIRED_IDS).
 *
 * Mutual exclusivity: if the preamble already carries one bib package
 * family, the other is never injected — the user's choice wins.
 */
export function ensurePreambleRequirements(
  preamble: string,
  required: Set<string>,
): string {
  const effective = new Set<string>(ALWAYS_REQUIRED_IDS);
  for (const id of required) effective.add(id);

  // Test satisfaction against the inert-stripped preamble, NOT the raw text, so
  // a commented-out `% \usepackage{tikz}` never false-satisfies a live
  // requirement — the SAME comment-inertness notion the body-detection side
  // uses (`projectDetectableBody`). Without this the round-trip is asymmetric:
  // `detectBodyRequirements` strips comments and sees `\begin{tikzpicture}`,
  // but a commented `% \usepackage{tikz}` would suppress the injection, saving
  // a `.tex` that fails to compile. The raw `preamble` is still what we slice +
  // inject into below, so byte positions of the live text are untouched.
  const scannable = projectDetectableBody(preamble);

  if (
    effective.has("natbib") &&
    REQUIREMENT_BY_ID.get("biblatex")!.satisfiedRe.test(scannable)
  ) {
    effective.delete("natbib");
  }
  if (
    effective.has("biblatex") &&
    REQUIREMENT_BY_ID.get("natbib")!.satisfiedRe.test(scannable)
  ) {
    effective.delete("biblatex");
  }

  // Registry order = packages first, then shims.
  const missing = LATEX_REQUIREMENTS.filter(
    (r) => effective.has(r.id) && !r.satisfiedRe.test(scannable),
  );
  if (missing.length === 0) return preamble;

  const beginMarker = "\\begin{document}";
  const beginIdx = preamble.indexOf(beginMarker);
  if (beginIdx === -1) return preamble;

  const additions = missing.map((r) => r.injectLine);
  const before = preamble.slice(0, beginIdx).replace(/\s*$/, "");
  const after = preamble.slice(beginIdx);
  return before + "\n\n" + additions.join("\n") + "\n\n" + after;
}

// ---------------------------------------------------------------------------
// Baseline preamble construction
// ---------------------------------------------------------------------------

/**
 * The package block every Virgil-authored preamble starts from — the
 * ground-truth set from samples/annotation-history/document.tex. tikz and
 * biblatex stay needs-driven only (injected by the requirements pass when
 * the body uses them).
 */
export const VIRGIL_BASELINE_PACKAGES: string[] = [
  "\\usepackage[utf8]{inputenc}",
  "\\usepackage{graphicx}",
  "\\usepackage{xcolor}",
  "\\usepackage{amsmath}",
  "\\usepackage{amssymb}",
  "\\usepackage{natbib}",
  "\\usepackage{expex}",
];

// Byte-identical to the legacy CLASSIC_PREAMBLE comment so docs seeded from
// the old seed still strip-compare equal to the new one (drift gate).
const SHIM_COMMENT = `% Virgil entity-id markers — no-op commands that carry stable UUIDs for
% inline entities (footnotes, citations, examples) across .tex parse
% cycles. Without these, every re-parse regenerates the ids and any UI
% state keyed by them (e.g. popped-out cards) becomes stale.`;

const SHIM_BLOCK =
  SHIM_COMMENT +
  "\n" +
  SHIM_COMMAND_NAMES.map((n) => `\\providecommand{\\${n}}[1]{}`).join("\n");

/**
 * Build a complete preamble: `documentclass` line + baseline packages +
 * optional extra lines (geometry, hyperref, `\title` blocks, …) + the shim
 * block + `\begin{document}\n\n`. The documentclass stays the first line
 * (EditorPane extracts it from the resolved style preamble).
 */
export function buildPreamble(
  documentclass: string,
  extraLines?: string[],
): string {
  const blocks: string[] = [
    documentclass + "\n" + VIRGIL_BASELINE_PACKAGES.join("\n"),
  ];
  if (extraLines && extraLines.length > 0) blocks.push(extraLines.join("\n"));
  blocks.push(SHIM_BLOCK);
  return blocks.join("\n\n") + "\n\n\\begin{document}\n\n";
}

// ---------------------------------------------------------------------------
// Normalization for drift comparison
// ---------------------------------------------------------------------------

const INJECT_LINE_SET = new Set(
  LATEX_REQUIREMENTS.map((r) => r.injectLine.trim()),
);

/**
 * Remove every registry inject line (trim-exact match) and collapse the
 * blank runs the removal leaves behind. Two preambles that differ only by
 * auto-injected requirement lines normalize to the same string — the
 * ManageStylesModal drift gate compares these normalized forms.
 */
export function stripAutoInjectedLines(preamble: string): string {
  const kept = preamble
    .split("\n")
    .filter((line) => !INJECT_LINE_SET.has(line.trim()));
  return kept.join("\n").replace(/\n{3,}/g, "\n\n");
}
