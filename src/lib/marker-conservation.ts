/**
 * **Marker conservation across a proposal splice** (task 1426) — may a
 * suggestion's replacement stand in for the bytes it replaces, given the
 * identity markers (`\vcid`, `\vfid`, `\vlid`, …) those bytes hold?
 *
 * Split out of `latex-markers.ts` (task 1560): that module is the marker
 * VOCABULARY and imports nothing, but "which bytes does a `\vcid` bind?" is
 * a question about the CITATION grammar, and a third spelling of where a cite
 * ends is how `\cites[p. 1]{a}[p. 2]{b}` lost its second key here. So this
 * module reads the parser's own doors — `matchCiteCommandAt` and the lexer's
 * argument-gap and group scanners. Python twin: `editor/scripts/_common.py`,
 * pinned by `__tests__/fixtures/marker-conservation-corpus.json`.
 */
import { ALL_VIRGIL_MARKERS, VIRGIL_MARKERS } from "@/lib/latex-markers";
import { MULTI_CITE_NAMES, matchCiteCommandAt } from "@/lib/cite-commands";
import { extractBraced, extractBracketed, skipArgumentSpaceAt } from "@/lib/latex-lexer";

/**
 * The markers a WHOLE CUT may remove — a deletion-family suggestion (Cutter)
 * whose replacement is empty. Everything else a cut may not drop:
 *
 *  - `\vcid` — yes: the citation goes with the passage it sat in; the cut card
 *    captures the bytes. (Only if the atom itself is inside the cut — see
 *    `"atom-left"` below.)
 *  - `\vlid` / `\vlidend` — yes, but only as a PAIR: another card's range that
 *    lies wholly inside the cut simply goes with it; a range that only STARTS
 *    or only ENDS inside it would be left with one unpaired token.
 *  - `\vfid` — NO. A footnote marker is followed by the footnote's whole prose;
 *    cutting it deletes the user's footnote text from the `.tex` and orphans
 *    its card in `footnotes.json`. Move or delete the footnote first.
 *  - the block markers (`\vexid`, `\vxid`) and `\vbid` never sit in a
 *    paragraph span; one that does is not a span a cut should guess about.
 *
 * Mirrored by `CUT_MAY_DROP_MARKERS` in `editor/scripts/_common.py`, pinned by
 * the shared corpus `__tests__/fixtures/marker-conservation-corpus.json`.
 */
export const CUT_MAY_DROP_MARKERS: readonly string[] = [
  VIRGIL_MARKERS.citation.command,
  VIRGIL_MARKERS.linkedRangeOpen.command,
  VIRGIL_MARKERS.linkedRangeClose.command,
];

/**
 * Why a proposal's replacement fails marker conservation.
 *  - `introduced` — the replacement holds a marker (or one more copy of a
 *    marker) the replaced span did not: a phantom atom/range no card owns.
 *  - `dropped`    — the replaced span held a marker the replacement does not
 *    carry through: its card loses the atom/range it is anchored to.
 *  - `atom-detached` — the replacement carries an {@link ATOM_ID_MARKERS}
 *    marker through but not, right after it, the atom it bound in the
 *    replaced span, verbatim: the footnote/citation was deleted, moved away
 *    from its marker, or rewritten (task 1484).
 *  - `unpaired`   — a whole cut removes one half of a `\vlid`/`\vlidend` pair.
 *  - `atom-left`  — a whole cut removes an atom's id marker but not the WHOLE
 *    atom after it (the span ends at the marker or inside the atom).
 */
export interface MarkerConservationViolation {
  readonly rule: "introduced" | "dropped" | "atom-detached" | "unpaired" | "atom-left";
  /** Command name without the backslash — `"vcid"`. */
  readonly command: string;
  readonly id: string;
}

/** Every marker call in source order, longest command first in the
 *  alternation so `\vlidend{` never reads as `\vlid`. */
const MARKER_CALL_RE = new RegExp(
  `\\\\(${ALL_VIRGIL_MARKERS.map((m) => m.command)
    .sort((a, b) => b.length - a.length)
    .join("|")})\\{([^}]*)\\}`,
  "g",
);

interface MarkerCall {
  command: string;
  id: string;
  end: number;
}

function markerCalls(text: string): MarkerCall[] {
  const out: MarkerCall[] = [];
  for (const m of text.matchAll(MARKER_CALL_RE)) {
    out.push({ command: m[1], id: m[2], end: (m.index ?? 0) + m[0].length });
  }
  return out;
}

const RANGE_PARTNER: Readonly<Record<string, string>> = {
  [VIRGIL_MARKERS.linkedRangeOpen.command]: VIRGIL_MARKERS.linkedRangeClose.command,
  [VIRGIL_MARKERS.linkedRangeClose.command]: VIRGIL_MARKERS.linkedRangeOpen.command,
};

/**
 * The markers that identify the ATOM right after them — `\vfid` its
 * `\footnote{…}`, `\vcid` its `\cite…{…}` (the binding {@link PendingMarkerId}
 * makes structural: the immediately following atom, or nothing). Derived, not
 * listed: the inline `.tex` markers that do not delimit a range. Conservation
 * holds these as (marker, atom) PAIRS — an id kept without its atom identifies
 * nothing (task 1484). Mirrored by `ATOM_ID_MARKERS` in
 * `editor/scripts/_common.py`, pinned by the parity suite.
 */
export const ATOM_ID_MARKERS: readonly string[] = ALL_VIRGIL_MARKERS
  .filter((m) => m.file === "tex" && m.position === "inline" && !(m.command in RANGE_PARTNER))
  .map((m) => m.command);

/** TeX's gap before an argument group — the lexer's ONE rule (task 1510):
 *  blanks, one line break, and `%` comments (the atom keeps its source slice,
 *  so skipping comments is safe here, as it is for `readCiteUnitsAt`). */
function argGap(text: string, p: number): number {
  return skipArgumentSpaceAt(text, p, { comments: true });
}

/** Index just past the `[…]` / `{…}` group opening at `i`, or -1 when it does
 *  not close inside `text` — the lexer's comment- and brace-aware door. */
function groupEndAt(text: string, i: number): number {
  const g = text[i] === "[" ? extractBracketed(text, i) : extractBraced(text, i);
  return g ? g.end : -1;
}

/** Could the cite command whose grammar read stopped at `p` go on past the end
 *  of `text`? A plural (`\cites`) or still key-less command reads another
 *  `[pre][post]{key}` unit if one follows; when the text ends — or ends inside
 *  such a unit — before anything else does, the span cannot say. */
function citeMayContinue(text: string, p: number, repeat: boolean, keyed: boolean): boolean {
  if (keyed && !repeat) return false;
  let q = argGap(text, p);
  for (let n = 0; n < 2 && text[q] === "["; n++) {
    const e = groupEndAt(text, q);
    if (e < 0) return true;
    q = argGap(text, e);
  }
  if (q >= text.length) return true;
  return text[q] === "{" && groupEndAt(text, q) < 0;
}

/**
 * The atom an id marker ending at `pos` binds, as source bytes. A CITATION
 * ends where the parser's citation ends — `matchCiteCommandAt`, so a plural
 * `\cites[p. 1]{a}[p. 2]{b}` binds every unit, and the gap TeX skips between
 * groups (`\citep⏎[p.~3]{k}`) is inside the atom (task 1560). Anything else —
 * `\footnote[7]{…}` — is the command token, its `[…]` optional arguments and
 * its one required `{…}` argument, with the same argument gap between them.
 * `complete: false` when the atom may run past the end of `text` (the span
 * ends at the marker or inside its atom, or right after a plural citation that
 * could take another unit): the bytes are then the whole rest of `text`.
 * `null` when what follows is no command at all — the marker binds nothing.
 * Mirrored by `bound_atom_after` in `editor/scripts/_common.py`.
 */
export function boundAtomAfter(
  text: string,
  pos: number,
): { text: string; complete: boolean } | null {
  const partial = { text: text.slice(pos), complete: false };
  if (pos >= text.length) return partial;
  if (text[pos] !== "\\") return null;
  const name = /^[A-Za-z@]+\*?/.exec(text.slice(pos + 1));
  if (!name) return pos + 1 >= text.length ? partial : null;
  let end = pos + 1 + name[0].length;

  const cite = matchCiteCommandAt(text, pos);
  if (cite && cite.name === name[0].replace(/\*$/, "").toLowerCase()) {
    if (citeMayContinue(text, cite.end, MULTI_CITE_NAMES.has(cite.name), cite.keyed))
      return partial;
    if (cite.keyed) return { text: cite.command, complete: true };
    // Key-less and finished: the parser keeps it as prose; bound it as any command.
  }

  for (;;) {
    const j = argGap(text, end);
    if (j >= text.length) return partial;
    if (text[j] !== "[" && text[j] !== "{") break;
    const e = groupEndAt(text, j);
    if (e < 0) return partial;
    end = e;
    if (text[j] === "{") break; // the one required argument closes the atom
  }
  return { text: text.slice(pos, end), complete: true };
}

/**
 * **May this replacement stand in for these matched bytes?** — the ONE answer
 * to "is a proposal's identity-marker set conserved across its splice", asked
 * by every door that lands a suggestion: the browser applicator
 * (`applyPendingChange`), and — through its Python twin
 * `marker_conservation_violation` in `editor/scripts/_common.py` — the
 * script's propose guard and its accept splice.
 *
 * `matched` is the span actually being replaced (the bytes located in the
 * paragraph, markers included); `wholeCut` is true only for a deletion-family
 * suggestion with an empty replacement; `humanAuthored` is true when the
 * replacement is a person's own text (`user_text`, or a human-authored card).
 *
 * The rule: the multiset of marker calls (command + id) in the replacement
 * equals the multiset in the match. A rewrite carries every marker through
 * verbatim (`editor/skills/_latex-allowlist.md`, the doctrine source) and adds
 * none. A whole cut may instead drop markers, per {@link CUT_MAY_DROP_MARKERS}.
 *
 * A HUMAN-authored replacement is held to the `introduced` half only. A person
 * types words, not `\vcid{…}`: the markers are invisible in every surface they
 * write from, so "carry them through" is a demand they cannot meet, and a
 * replacement of theirs that leaves out a citation is the edit they made
 * (pre-1426 behaviour, kept deliberately — the carry-through doctrine is
 * addressed to the AI that reads the `.tex`). A marker they DID type still must
 * not mint a phantom.
 *
 * Returns the FIRST violation (introduced, in replacement order; then dropped,
 * in match order), or `null` when the splice conserves.
 */
export function markerConservationViolation(
  matched: string,
  replacement: string,
  opts: { wholeCut: boolean; humanAuthored?: boolean },
): MarkerConservationViolation | null {
  const { wholeCut, humanAuthored = false } = opts;
  const have = markerCalls(matched);
  const key = (c: { command: string; id: string }) => `${c.command}\u0000${c.id}`;
  const budget = new Map<string, number>();
  for (const c of have) budget.set(key(c), (budget.get(key(c)) ?? 0) + 1);

  // The replacement's carried-through calls, per marker, in order: the i-th
  // copy in the match pairs with the i-th copy in the replacement.
  const carried = new Map<string, MarkerCall[]>();
  for (const c of markerCalls(replacement)) {
    const left = budget.get(key(c)) ?? 0;
    if (left === 0) return { rule: "introduced", command: c.command, id: c.id };
    budget.set(key(c), left - 1);
    carried.set(key(c), [...(carried.get(key(c)) ?? []), c]);
  }

  if (humanAuthored) return null;
  for (const c of have) {
    const atom = ATOM_ID_MARKERS.includes(c.command) ? boundAtomAfter(matched, c.end) : null;
    const twin = carried.get(key(c))?.shift();
    if (twin) {
      // Carried through — and so must its atom be, verbatim, right after it.
      if (atom && !(atom.complete
        ? replacement.startsWith(atom.text, twin.end)
        : replacement.slice(twin.end) === atom.text))
        return { rule: "atom-detached", command: c.command, id: c.id };
      continue;
    }
    if (!wholeCut || !CUT_MAY_DROP_MARKERS.includes(c.command))
      return { rule: "dropped", command: c.command, id: c.id };
    const partner = RANGE_PARTNER[c.command];
    if (partner && !have.some((p) => p.command === partner && p.id === c.id))
      return { rule: "unpaired", command: c.command, id: c.id };
    if (!partner && !atom?.complete)
      return { rule: "atom-left", command: c.command, id: c.id };
  }
  return null;
}

/** The refusal sentence for a violation, the same words in both languages. */
export function describeMarkerViolation(v: MarkerConservationViolation): string {
  const call = `\\${v.command}{${v.id}}`;
  switch (v.rule) {
    case "introduced":
      return `the replacement adds ${call}, which the replaced text does not hold — it would mint an atom or range no card owns`;
    case "dropped":
      return `the replacement drops ${call} — the citation, footnote or range it identifies would lose its card (a rewrite carries every marker through verbatim; a cut may not remove a footnote)`;
    case "atom-detached":
      return `the replacement keeps ${call} but not, right after it, the footnote or citation it identifies, verbatim — that atom would be deleted, moved away from its card, or rewritten (a rewrite carries each marker AND its atom through together)`;
    case "unpaired":
      return `the cut removes ${call} but not its partner — the range it delimits would be left unpaired`;
    case "atom-left":
      return `the cut removes ${call} but not the atom it identifies — extend the cut over the whole citation`;
  }
}
