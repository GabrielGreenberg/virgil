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

import { KNOWN_CITE_COMMANDS } from "@/lib/cite-commands";

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
    satisfiedRe: new RegExp(`\\\\usepackage(?:\\[[^\\]]*\\])?\\{${name}\\}`),
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

// Escaped prose is safe here: escapeLatex escapes backslashes, so an emitted
// `\includegraphics` / `\ex` in the body is genuinely a command. The
// `(?![a-zA-Z])` guard stops `\ex` matching `\example` etc. (LaTeX command
// names are letters only).
const BODY_DETECTORS: Array<{ id: string; re: RegExp }> = [
  {
    id: "expex",
    re: /\\(?:begingl|getfullref|getref|pex|ex)(?![a-zA-Z])|\\begin\{xlist\}/,
  },
  { id: "graphicx", re: /\\includegraphics(?![a-zA-Z])/ },
  { id: "tikz", re: /\\begin\{tikzpicture\}/ },
  { id: "xcolor", re: /\\textcolor(?![a-zA-Z])/ },
];

// Family split for the shared cite-command registry. Bare `\cite`/`\nocite`
// are LaTeX-kernel commands — neutral, they pin neither package. Everything
// else in KNOWN_CITE_COMMANDS not listed as natbib is biblatex (natbib's
// command set is closed; new registry additions default to biblatex).
const NATBIB_FAMILY = new Set<string>([
  "citet",
  "citep",
  "citealt",
  "citealp",
  "citeauthor",
  "citeyear",
  "citeyearpar",
  "citetext",
  "citenum",
]);
const NEUTRAL_CITE_COMMANDS = new Set<string>(["cite", "nocite"]);
const BIBLATEX_FAMILY = KNOWN_CITE_COMMANDS.filter(
  (c) => !NATBIB_FAMILY.has(c) && !NEUTRAL_CITE_COMMANDS.has(c),
);

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

const NATBIB_RE = familyRe(NATBIB_FAMILY);
const BIBLATEX_RE = familyRe(BIBLATEX_FAMILY);

/**
 * Single-pass detection over the SERIALIZED body: which registry packages
 * does this body actually use? Returns requirement ids. When BOTH cite
 * families appear in one body, natbib wins (they're mutually exclusive
 * packages; natbib is Virgil's baseline family).
 */
export function detectBodyRequirements(bodyLatex: string): Set<string> {
  const required = new Set<string>();
  for (const d of BODY_DETECTORS) {
    if (d.re.test(bodyLatex)) required.add(d.id);
  }
  if (NATBIB_RE.test(bodyLatex)) required.add("natbib");
  else if (BIBLATEX_RE.test(bodyLatex)) required.add("biblatex");
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

  if (
    effective.has("natbib") &&
    REQUIREMENT_BY_ID.get("biblatex")!.satisfiedRe.test(preamble)
  ) {
    effective.delete("natbib");
  }
  if (
    effective.has("biblatex") &&
    REQUIREMENT_BY_ID.get("natbib")!.satisfiedRe.test(preamble)
  ) {
    effective.delete("biblatex");
  }

  // Registry order = packages first, then shims.
  const missing = LATEX_REQUIREMENTS.filter(
    (r) => effective.has(r.id) && !r.satisfiedRe.test(preamble),
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
