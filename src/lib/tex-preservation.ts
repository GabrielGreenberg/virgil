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
 * ## Which words, not how many — the shortfall (task 357)
 *
 * A NET count is defeated by simultaneous growth, one region in. The region
 * split above closed the cross-region form of that masking; within a region a
 * pass that dropped `\author{Jane Q. Doe}` while adding four words elsewhere
 * still scored a loss of ZERO. So the measure is a per-token SHORTFALL —
 * `Σ max(0, count_before(t) − count_after(t))` — which is the number of word
 * OCCURRENCES present before and missing after, whatever else arrived.
 *
 * It is a strict strengthening: the shortfall is `≥` the net loss for every
 * input, so nothing the old rule refused is now allowed. And it is
 * ORDER-INVARIANT, which is why it is a multiset rather than the contiguous-run
 * check this was first sketched as: the serializer legitimately MOVES word runs
 * (task 356 hoists a `\title{…}` to the far end of the preamble; a figure's
 * attrs are re-emitted in the serializer's own order), and a run check
 * false-refuses on every one of those. A run check would catch one thing this
 * does not — a deleted run whose every token appears elsewhere in the same
 * region — and pays for it with refusals on documents that lost nothing.
 *
 * Measured before adopting it: over every `.tex` corpus in the repo (the
 * reference paper, both indexed library papers, all four document templates),
 * two save cycles each, the shortfall is **0** in both regions. It absorbs no
 * known behaviour, exactly as the net count did.
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
import type { PreservationRefusalDetail } from "@/lib/preservation-notice";

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
 * The user's content as a MULTISET of word tokens, plus the total. See the
 * module header: the total answers "how much", the per-token counts answer
 * "which", and only the second survives simultaneous growth.
 */
export interface WordBag {
  total: number;
  counts: ReadonlyMap<string, number>;
}

export function measureContentBag(tex: string): WordBag {
  const words = projectAwayVirgilMarkers(tex).match(WORD_RE) ?? [];
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  return { total: words.length, counts };
}

/**
 * Word OCCURRENCES present in `before` and missing from `after`. Always `≥`
 * `max(0, before.total − after.total)`, and unlike that net it cannot be paid
 * off by unrelated growth in the same region.
 */
export function missingWords(before: WordBag, after: WordBag): number {
  let missing = 0;
  for (const [token, n] of before.counts) {
    const kept = after.counts.get(token) ?? 0;
    if (n > kept) missing += n - kept;
  }
  return missing;
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
  /**
   * Word occurrences present before and missing after — the SHORTFALL, not the
   * net difference (see the module header). Never negative: a region that only
   * grew reports 0.
   */
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

/**
 * The one comparison both gates make, over two already-measured bags. Exported
 * so the WRITE gate (which retains its baseline bag at load rather than holding
 * the bytes) asks exactly this question rather than a second copy of it.
 */
export function compareRegionBags(b: WordBag, a: WordBag): RegionVerdict {
  const allowed = Math.max(
    PRESERVATION_SLACK_WORDS,
    Math.floor(b.total * PRESERVATION_SLACK_RATIO),
  );
  const lost = missingWords(b, a);
  return { before: b.total, after: a.total, lost, allowed, ok: lost <= allowed };
}

function checkRegion(before: string, after: string): RegionVerdict {
  return compareRegionBags(measureContentBag(before), measureContentBag(after));
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
 * The measured shape of a load-gate refusal, in the vocabulary the refusal
 * CHANNEL speaks ([preservation-notice.ts](preservation-notice.ts)). Kept
 * beside `describePreservationRefusal` for the same reason: both backends must
 * report one thing, and the region-picking rule ("body first, else preamble")
 * is that one thing stated once.
 */
export function preservationRefusalDetail(
  v: PreservationVerdict,
): PreservationRefusalDetail {
  const region = !v.body.ok ? v.body : v.preamble;
  return {
    source: "load",
    region: !v.body.ok ? "body" : "preamble",
    before: region.before,
    after: region.after,
    lost: region.lost,
    allowed: region.allowed,
  };
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
