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
   * INSIDE a paragraph's inline content, which is what makes them dangerous
   * in untrusted text a caller may reparse (see `containsInternalMarker` in
   * the serializer — its set is derived from this facet). `"block"` markers
   * are emitted in block context, on the line of the construct they precede.
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
 * The `.tex` markers emitted INSIDE inline content, longest command first so
 * a regex alternation matches `\vlidend` before its `\vlid` prefix. The
 * serializer's `INTERNAL_MARKER_COMMANDS` is this list.
 */
export const INLINE_TEX_MARKERS: readonly VirgilMarker[] = ALL_VIRGIL_MARKERS
  .filter((m) => m.file === "tex" && m.position === "inline")
  .slice()
  .sort((a, b) => b.command.length - a.command.length);

/**
 * The `.tex` markers emitted in BLOCK context, longest command first (same
 * prefix-safety rule as {@link INLINE_TEX_MARKERS}). A block-position marker
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
