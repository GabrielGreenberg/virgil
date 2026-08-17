/**
 * **The preservation gate** — the net under every NON-USER-EDIT write of a
 * `.tex` (task 350 defect D).
 *
 * `readDocBundle` re-serializes the parsed model and writes it back to disk on
 * OPEN, unconditionally, in both backends. That is a write the user never asked
 * for, so a parser bug on that path destroys content with **zero user edits** —
 * which is exactly what happened: an unterminated `\ex` swallowed the rest of
 * the document, the example body builder kept the paragraphs and dropped every
 * heading, figure and nested example, and the truncation reached disk before
 * the user had typed anything. Task 350's defects A and B make that particular
 * parse impossible. This makes the CLASS non-destructive — including the
 * members nobody has found yet.
 *
 * > **A write the user did not ask for must not be able to lose content. Before
 * > an automatic rewrite lands, compare what it would write against what was
 * > read: markers and anchors may be ADDED, nothing may be LOST. A shrink is a
 * > REFUSAL, loud, with the file left byte-identical.**
 *
 * ## What is measured, and why it is WORDS
 *
 * The obvious measure is character mass, and it is the wrong one: the
 * serializer legitimately normalizes punctuation (`\(x\)` → `$x$`, `$$…$$` →
 * `$…$`, blank-line runs collapsed, an anchor canonicalized to the far side of
 * a comment tail). Every one of those moves characters and none of them loses
 * content, so a character-mass gate needs a tolerance wide enough to hide real
 * loss on a large document.
 *
 * A WORD token (`[A-Za-z0-9]+`) survives all of them. Command names count as
 * words, which is a feature rather than a compromise: `\section` and
 * `\begin{align}` are exactly the things the pre-350 example-body whitelist
 * dropped, and losing one is a two-word drop the gate can see. So the tolerance
 * can be tight instead of generous, which is the whole difference between a net
 * and a formality.
 *
 * ## What is projected away first
 *
 * Virgil's OWN markers, on both sides — the `%!v:xxxx` block anchors, the
 * `%!vtex:` sentinels, and every `\v*` marker command from the
 * {@link VIRGIL_MARKER_COMMANDS} vocabulary, together with their braced
 * arguments. Two reasons, and the second is the load-bearing one: they are
 * routinely ADDED by the very pass being gated (that is what the load-writeback
 * is FOR), so counting them would make every first save look like a gain; and a
 * gain is exactly what could mask a simultaneous loss. Project them away and
 * the comparison is about the user's content alone.
 *
 * User comments are deliberately NOT projected away. Since task 347 a `%`
 * comment is content that round-trips, so a pass that dropped every comment in
 * the document should be refused like any other loss.
 *
 * ## The PREAMBLE and the BODY are weighed SEPARATELY, and that is the fix
 *
 * A single whole-document count is **defeated by Virgil's own output**, and
 * this was measured rather than reasoned: the first save of a fresh paper
 * injects the seven-line `\providecommand{\vfid}[1]{}` marker-shim block plus
 * any `\usepackage` the requirements pass declares. That is ~21 words of
 * legitimate GROWTH in the preamble — and against a document whose body had
 * just lost a `\section` and a whole `\begin{quote}` to the example-body
 * whitelist, the sum came out POSITIVE and the gate passed a real destruction.
 * (The shim escapes the marker projection above by construction: it spells
 * `{\vfid}`, the command inside the braces rather than in front of them.)
 *
 * So the two regions are counted independently and EITHER shrinking is a
 * refusal. Nothing a growing preamble can do will mask a shrinking body. The
 * split is on `\begin{document}`, and a source with no such marker is treated
 * as all-body — the fail-safe direction, since it puts every word under the
 * stricter of the two comparisons rather than exempting them.
 *
 * ## What this does NOT cover, stated
 *
 * The gate governs writes the user did not ask for. **The first user-edit
 * autosave after a lossy parse is out of its reach BY DESIGN** — by then the
 * damaged model is what the user has been editing, and refusing to save their
 * typing would be a worse failure than the one being guarded. Defect B (an
 * unterminated construct fails closed) is what protects that path; this is the
 * net under the automatic write, and it does not claim more.
 *
 * It is also a CONTENT gate, not a correctness gate: a pass that rewrote every
 * word to a different word of the same count passes. Nothing here substitutes
 * for the round-trip suites.
 */
import { VIRGIL_MARKER_COMMANDS } from "@/lib/latex-markers";

/**
 * Fraction of the original word count that may disappear before the write is
 * refused, and the absolute floor that keeps a small document from tripping on
 * a single normalized token.
 *
 * Both are deliberately SMALL. Measured against the shipped corpus (the
 * `samples/annotation-history` reference paper and the round-trip fixtures) an
 * honest save moves the word count by ZERO, so the slack is not absorbing any
 * known behaviour — it exists so an unenumerated normalization cannot wedge a
 * user's document, which is the failure direction a gate must not have.
 */
export const PRESERVATION_SLACK_RATIO = 0.01;
export const PRESERVATION_SLACK_WORDS = 4;

const MARKER_COMMAND_RE = new RegExp(
  `\\\\(?:${VIRGIL_MARKER_COMMANDS.join("|")})\\{[^}]*\\}`,
  "g",
);
/** `%!v:abcd` block anchors and the `%!vtex:begin|end` texBlock sentinels. */
const MARKER_COMMENT_RE = /%!v(?:tex)?:[^\s]*/g;
const WORD_RE = /[A-Za-z0-9]+/g;

/** Virgil's own markers, removed from BOTH sides — see the module header. */
function projectAwayVirgilMarkers(tex: string): string {
  return tex.replace(MARKER_COMMAND_RE, " ").replace(MARKER_COMMENT_RE, " ");
}

/**
 * The user's content, as a word count. See the module header for why words
 * rather than characters.
 */
export function measureContentWords(tex: string): number {
  const projected = projectAwayVirgilMarkers(tex);
  return projected.match(WORD_RE)?.length ?? 0;
}

/**
 * Split on `\begin{document}`. A source with no marker is treated as ALL BODY
 * — the fail-safe direction: every word then falls under a comparison rather
 * than into an unweighed region.
 */
function splitRegions(tex: string): { preamble: string; body: string } {
  const i = tex.indexOf("\\begin{document}");
  if (i === -1) return { preamble: "", body: tex };
  return { preamble: tex.slice(0, i), body: tex.slice(i) };
}

export interface RegionVerdict {
  before: number;
  after: number;
  /** Words lost (never negative — a gain reports 0). */
  lost: number;
  /** The largest loss that would still have been allowed. */
  allowed: number;
  ok: boolean;
}

export interface PreservationVerdict {
  /** False ⇒ the write must be REFUSED and the file left byte-identical. */
  ok: boolean;
  body: RegionVerdict;
  preamble: RegionVerdict;
}

function checkRegion(before: string, after: string): RegionVerdict {
  const b = measureContentWords(before);
  const a = measureContentWords(after);
  const allowed = Math.max(
    PRESERVATION_SLACK_WORDS,
    Math.floor(b * PRESERVATION_SLACK_RATIO),
  );
  const lost = Math.max(0, b - a);
  return { before: b, after: a, lost, allowed, ok: lost <= allowed };
}

/**
 * Would writing `after` over `before` lose content? Growth and equality always
 * pass; a shrink passes only within the stated slack — and the preamble and
 * body are weighed SEPARATELY, so a growing preamble can never mask a
 * shrinking body (see the module header: that masking was measured, not
 * hypothesized).
 */
export function checkTexPreservation(
  before: string,
  after: string,
): PreservationVerdict {
  const b = splitRegions(before);
  const a = splitRegions(after);
  const body = checkRegion(b.body, a.body);
  const preamble = checkRegion(b.preamble, a.preamble);
  return { ok: body.ok && preamble.ok, body, preamble };
}

/**
 * One-line diagnostic for a refusal. Kept here rather than at the two call
 * sites so both backends report the same thing — the refusal is the only
 * evidence the user gets that a parser bug was caught, so it must not drift.
 */
export function describePreservationRefusal(
  v: PreservationVerdict,
  docId: string,
): string {
  const region = !v.body.ok ? v.body : v.preamble;
  const where = !v.body.ok ? "body" : "preamble";
  return (
    `[virgil] REFUSED the automatic load-writeback for "${docId}": ` +
    `it would have dropped ${region.lost} of ${region.before} content words ` +
    `from the document ${where} (${region.after} would remain; at most ` +
    `${region.allowed} may be lost). The .tex on disk is UNCHANGED. This is ` +
    `Virgil's preservation gate (task 350) catching a parse that could not ` +
    `represent the document — please report the file.`
  );
}
