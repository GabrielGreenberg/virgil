/**
 * VIRGIL_MARKERS — the single source of truth for Virgil's private `\v*`
 * id-marker command vocabulary.
 *
 * These are NOT real LaTeX. They are no-op sentinels Virgil writes into the
 * user's `.tex` (and `.bib`) so an entity's id survives a parse→serialize
 * cycle: `\vfid{…}` before a `\footnote`, `\vcid{…}` before a `\cite`,
 * `\vexid{…}` before an expex `\ex`/`\pex`, `\vxid{…}` before an `\a` item,
 * `\vlid{…}…\vlidend{…}` around a linked-anchor range, `\vbid{…}` above a
 * `.bib` entry. Each is declared `\providecommand{\…}[1]{}` in the preamble
 * so the file still compiles outside Virgil.
 *
 * **Why one module.** Every one of those tokens is spelled by at least three
 * layers that must agree byte for byte — the serializer that emits it, the
 * parser that reads it back, and the preamble-requirements module that
 * declares the shim — and until task 255 each layer carried its own hardcoded
 * copy, with a FOURTH (decorative, unread) copy declared as
 * `TEXT_OBJECT_REGISTRY[kind].sourceMarker` under a registry header that
 * advertised itself as driving "source-marker round-trip". Nothing structural
 * held the copies together: renaming a command in one layer produced a
 * document Virgil emits and cannot read, with no type error and no failing
 * test. The copies happened to agree; nothing made them.
 *
 * So the rule is: **nothing spells a `\v*` marker command by hand — emitting,
 * parsing, or declaring.** Read the spelling from here. CI:
 * [latex-marker-ssot.test.ts](__tests__/latex-marker-ssot.test.ts) censuses
 * both silos for a hand-spelled marker name and pins each marker's
 * emit→parse round trip through the REAL serializer/parser.
 *
 * **Deliberately not here.** The `%!v:xxxx` comment-suffix anchor (blocks:
 * paragraph, heading, list item, …) and texBlock's `%!vtex:begin/end`
 * sentinel are a different FORM — a trailing comment, not a command call —
 * with no preamble shim and their own regexes in [uuid.ts](uuid.ts). This
 * module is the command-form vocabulary; folding two grammars into one table
 * would buy a bigger table, not a smaller fork.
 *
 * **Zero imports, deliberately.** The parser, serializer, requirements module
 * and bib round-trip are low-level and must all be able to import this. That
 * is also why the mapping "which TextObject kind carries which marker" lives
 * HERE (as this module's own key set) rather than on `TEXT_OBJECT_REGISTRY`:
 * the registry is editor-coupled (TipTap `Editor`, the doc-structure bus, the
 * drop adapters), so the round-trip layer can never read it, and a facet the
 * layer that needs it cannot reach is decorative by construction.
 */

/**
 * One marker per entity-id carrier. The key names WHAT the marker identifies,
 * so this record IS the kind→marker map.
 */
export type VirgilMarkerId =
  | "footnote"
  | "citation"
  | "bibEntry"
  | "exampleBlock"
  | "exampleItem"
  | "linkedRangeOpen"
  | "linkedRangeClose";

export interface VirgilMarker {
  readonly id: VirgilMarkerId;
  /** Command name WITHOUT the leading backslash — `"vfid"`. The form the
   *  preamble shim (`\providecommand{\vfid}[1]{}`) is built from. */
  readonly command: string;
  /** The macro as it appears in source — `"\\vfid"`. */
  readonly macro: string;
  /** The opening token a parser tests for — `"\\vfid{"`. */
  readonly open: string;
  /** Which file the marker is written into. `\vbid` is the one that never
   *  appears in the `.tex`; it still needs a shim, because a `.bib` may be
   *  `\input` and is read by the same LaTeX. */
  readonly file: "tex" | "bib";
  /**
   * Where the marker sits in the stream. `"inline"` markers are emitted
   * INSIDE a paragraph's inline content; `"block"` markers are emitted in
   * block context, on the line of the construct they precede — which the
   * parser reads as a paragraph boundary ({@link BLOCK_TEX_MARKERS}). (Task
   * 1426 retired the inline-only reparse refusal this facet once also fed:
   * a suggestion's replacement is now held to marker CONSERVATION over every
   * marker, {@link markerConservationViolation}.)
   */
  readonly position: "inline" | "block";
}

function marker(
  id: VirgilMarkerId,
  command: string,
  file: "tex" | "bib",
  position: "inline" | "block",
): VirgilMarker {
  return {
    id,
    command,
    macro: `\\${command}`,
    open: `\\${command}{`,
    file,
    position,
  };
}

/**
 * THE table. Declaration order is the preamble injection order — it is what
 * `SHIM_COMMAND_NAMES` (and therefore the emitted `\providecommand` block)
 * reads, so reordering these lines reorders bytes in every user's preamble.
 */
export const VIRGIL_MARKERS: Readonly<Record<VirgilMarkerId, VirgilMarker>> = {
  footnote: marker("footnote", "vfid", "tex", "inline"),
  citation: marker("citation", "vcid", "tex", "inline"),
  bibEntry: marker("bibEntry", "vbid", "bib", "block"),
  exampleBlock: marker("exampleBlock", "vexid", "tex", "block"),
  exampleItem: marker("exampleItem", "vxid", "tex", "block"),
  linkedRangeOpen: marker("linkedRangeOpen", "vlid", "tex", "inline"),
  linkedRangeClose: marker("linkedRangeClose", "vlidend", "tex", "inline"),
};

/** Every marker, in canonical declaration order. */
export const ALL_VIRGIL_MARKERS: readonly VirgilMarker[] =
  Object.values(VIRGIL_MARKERS);

/**
 * Every marker command name, in canonical declaration order. Every marker in
 * this vocabulary needs a preamble no-op — each one is written into a file
 * LaTeX may be asked to compile — so `SHIM_COMMAND_NAMES` is this list, not a
 * hand-picked subset of it.
 */
export const VIRGIL_MARKER_COMMANDS: readonly string[] =
  ALL_VIRGIL_MARKERS.map((m) => m.command);

/**
 * The `.tex` markers emitted in BLOCK context, longest command first (same
 * prefix-safety rule as `MARKER_CALL_RE` below). A block-position marker
 * sitting at the head of a line is a paragraph boundary for the parser: absorb
 * one into the preceding paragraph and the next save re-emits it as literal
 * text, accumulating one stray marker per round trip.
 */
export const BLOCK_TEX_MARKERS: readonly VirgilMarker[] = ALL_VIRGIL_MARKERS
  .filter((m) => m.file === "tex" && m.position === "block")
  .slice()
  .sort((a, b) => b.command.length - a.command.length);

/** Serialize `id` as this marker's call — `\vfid{ab12}`. */
export function emitMarker(m: VirgilMarker, id: string): string {
  return `${m.macro}{${id}}`;
}

/** True if this marker's `\cmd{` opening token starts at `pos` in `src`. */
export function markerOpensAt(
  src: string,
  pos: number,
  m: VirgilMarker,
): boolean {
  return src.startsWith(m.open, pos);
}

/**
 * Offset of the marker's brace argument — i.e. `pos + "\\vfid".length`, the
 * position an `extractBraced`-style reader continues from once
 * {@link markerOpensAt} has said yes.
 */
export function markerArgStart(pos: number, m: VirgilMarker): number {
  return pos + m.macro.length;
}

/**
 * An id parked by an inline `\vfid{…}` / `\vcid{…}` marker for the atom that
 * comes next.
 *
 * **The id binds to the IMMEDIATELY following atom, or to nothing** (task 341).
 * Both inline scanners used to hold a bare `pendingCitationId` that was cleared
 * only when a citation actually consumed it, so a marker whose atom the scanner
 * failed to recognize kept its id alive for the rest of the body and handed it
 * to the NEXT citation instead — two cards resolving to one identity, the later
 * one now writing its edits into the earlier one's `.bib` entry. That was
 * routinely reachable in the footnote/card fork, whose cite vocabulary was ten
 * names short of the registry's, and is reachable in any body by a hand-typed
 * stray marker.
 *
 * Parking the POSITION alongside the id makes the binding structural: a taker
 * standing anywhere but exactly where the marker left off gets nothing, and an
 * unclaimed marker is simply dropped — which is right, since it names an atom
 * that is not there.
 */
export class PendingMarkerId {
  private id: string | null = null;
  private at = -1;

  /** Park `id` for an atom starting at `pos` (the index just past the marker). */
  set(id: string | null, pos: number): void {
    this.id = id;
    this.at = pos;
  }

  /** Claim the id for an atom starting at `pos`, or get null. Always clears. */
  take(pos: number): string | null {
    const id = this.at === pos ? this.id : null;
    this.id = null;
    this.at = -1;
    return id;
  }
}

// ---------------------------------------------------------------------------
// Marker conservation across a proposal splice (task 1426)
// ---------------------------------------------------------------------------

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

/** Index just past the `open`…`close` group opening at `i`, or -1 when it
 *  does not close inside `text`. A backslash escapes the next char (`\{`,
 *  `\]`), and a `{…}` group nested in a `[…]` one is skipped whole, so its
 *  `]` does not close the bracket. */
function groupEnd(text: string, i: number, open: string, close: string): number {
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const ch = text[j];
    if (ch === "\\") {
      j++;
    } else if (ch === "{" && open !== "{") {
      const e = groupEnd(text, j, "{", "}");
      if (e < 0) return -1;
      j = e - 1;
    } else if (ch === open) {
      depth++;
    } else if (ch === close && --depth === 0) {
      return j + 1;
    }
  }
  return -1;
}

/**
 * The atom an id marker ending at `pos` binds, as source bytes — a command
 * token (`\footnote`, `\citet*`), its `[…]` optional arguments, and its one
 * required `{…}` argument, balanced (spaces between them allowed, as in
 * LaTeX). `complete: false` when the atom may run past the end of `text` (the
 * span ends at the marker or inside its atom): the bytes are then the whole
 * rest of `text`. `null` when what follows is no command at all — the marker
 * binds nothing. Mirrored by `bound_atom_after` in `editor/scripts/_common.py`.
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
  for (;;) {
    let j = end;
    while (text[j] === " ") j++;
    if (j >= text.length) return partial;
    if (text[j] === "[" || text[j] === "{") {
      const e = groupEnd(text, j, text[j], text[j] === "[" ? "]" : "}");
      if (e < 0) return partial;
      end = e;
      if (text[j] === "{") break; // the one required argument closes the atom
    } else {
      break;
    }
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
