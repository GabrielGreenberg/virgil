/**
 * Gutter stability — the ONE necessity rule behind every gesture-driven
 * reposition (task 328).
 *
 * A click in Virgil can move two different things: the CARD (an omni pin
 * re-places one card and the deck re-cascades around it) and the DOCUMENT
 * (an `alignEntryToY` scroll drags the shared row so some element lands at a
 * chosen Y). Before this module every publisher decided on its own — which
 * is to say, none of them decided at all: each one moved its end
 * unconditionally, and only `usePlacement` carried a private 8px "already
 * roughly aligned" check. The result is the class Gabriel reported: cards
 * that reset several times while scrolling, and a perfectly visible card
 * that jumps to "the best position" the moment you click its text.
 *
 * > **A reposition is sanctioned only when the thing the user needs is not
 * > already where they need it.** One predicate answers that for both axes;
 * > every door consults it, and no call site keeps a private copy.
 *
 * The rule, in order:
 *
 *  0. A move smaller than `REPOSITION_EPSILON_PX` is JITTER, never a
 *     decision — hold. (Same constant the measure pass uses to decide
 *     whether a re-measured top is worth committing, so a "hold" here and a
 *     no-commit there mean the same thing.)
 *  1. A rect or band we cannot READ fails OPEN (move). We cannot prove the
 *     element is visible, and the asymmetry matters: failing open costs a
 *     move the user might not have needed — the PRE-328 behaviour, and one
 *     they asked for by clicking — while failing closed makes a deliberate
 *     click do nothing at all, with nothing on screen to explain it.
 *  2. Not FULLY visible in its band ⇒ move. This is necessity (a): you
 *     cannot read what you cannot see.
 *  3. Farther from the target than `farThresholdFor(band)` ⇒ move. This is
 *     necessity (b), "very, very far from its linked text". It is what
 *     surfaces the dense-stack case (necessity (c) in Gabriel's wording): a
 *     card buried in a 16-card deck sits far from its own anchor, because
 *     that displacement IS what being buried means — so it needs no third
 *     rule of its own.
 *  4. Otherwise HOLD. Visible and near enough is the whole of "no move".
 *
 * Note that (3) can only fire where one end is off screen or the band is
 * taller than the threshold: with the element and the target BOTH on screen
 * the delta is bounded by the band height, so (2) has usually answered
 * first. It is stated separately anyway because the two are different
 * claims, and because a partially-scrolled band makes them diverge.
 *
 * Pure arithmetic with ZERO imports, deliberately: the consumers span
 * `src/links` (the jump paths), `src/components/editor-layout` (the pin
 * publishers and the scroll door) and `src/hooks` (the measure pass), and a
 * rule the layer that needs it cannot import is a rule that gets re-copied.
 */

/** A 1-D screen band: a rect's vertical extent, or a viewport's. */
export interface Band {
  readonly top: number;
  readonly bottom: number;
}

/**
 * Movement below this is jitter, not intent (px).
 *
 * Sized between the two things it must separate: large enough to swallow
 * sub-pixel rounding and the ±px that a re-measure/refinement pass reports
 * for unchanged content, small enough to sit well under one line box (~24px)
 * so a real anchor move always tracks. Because every comparison is against
 * the last COMMITTED value (never the last measured one), a slow real drift
 * accumulates and commits — the held error is bounded by this constant, it
 * does not integrate.
 */
export const REPOSITION_EPSILON_PX = 6;

/**
 * Height movement below this is jitter (px). Deliberately tighter than the
 * position epsilon: a card's height feeds the cascade, so every following
 * card in a packed run inherits the wobble, and a real height change (a
 * collapse, a font swap, a re-wrap) is always many px. This swallows
 * sub-pixel glyph-metric noise and nothing else.
 */
export const HEIGHT_EPSILON_PX = 1;

/** "Very, very far" as a fraction of the visible band. */
export const REPOSITION_FAR_FRACTION = 0.5;
/** Floor for the above, so a short band (a squeezed panel) can't make every
 *  small move look far. */
export const REPOSITION_FAR_MIN_PX = 240;

/** Sub-pixel slack when comparing a rect against its band. */
const VISIBILITY_SLACK_PX = 0.5;

export type RepositionVerdict = "move" | "hold";

export interface RepositionQuery {
  /** Where the element is now (any 1-D space, as long as `target` shares it). */
  readonly current: number;
  /** Where the publisher would put it. */
  readonly target: number;
  /** The element's CURRENT screen band, or null when it can't be read. */
  readonly rect: Band | null;
  /** The band it must sit inside to count as visible (its scroll container),
   *  or null when it can't be read. */
  readonly band: Band | null;
}

/** A band we can actually reason about: present, finite and non-degenerate.
 *  A zero-height band is what a `display:none` keep-alive pane reports, and
 *  an unrendered wrapper reports the same — treating either as "visible"
 *  would hold every move for a pane nobody can see. */
function isKnown(b: Band | null | undefined): b is Band {
  return (
    !!b &&
    Number.isFinite(b.top) &&
    Number.isFinite(b.bottom) &&
    b.bottom - b.top > 0
  );
}

/**
 * Is the whole element on screen?
 *
 * Expressed as "the visible span equals everything there is to see" so an
 * element TALLER than its band — a long card in a short gutter — counts as
 * visible once it covers the band, instead of being permanently unsatisfiable
 * and therefore permanently move-eligible.
 */
export function isFullyVisible(
  rect: Band | null,
  band: Band | null,
): boolean {
  if (!isKnown(rect) || !isKnown(band)) return false;
  const visible = Math.min(rect.bottom, band.bottom) - Math.max(rect.top, band.top);
  const whole = Math.min(rect.bottom - rect.top, band.bottom - band.top);
  return visible >= whole - VISIBILITY_SLACK_PX;
}

/** The "very far" distance for a given band. */
export function farThresholdFor(band: Band | null): number {
  if (!isKnown(band)) return REPOSITION_FAR_MIN_PX;
  return Math.max(
    REPOSITION_FAR_MIN_PX,
    (band.bottom - band.top) * REPOSITION_FAR_FRACTION,
  );
}

/** The rule. See the header for the ordering and why each rung exists. */
export function mayReposition(q: RepositionQuery): RepositionVerdict {
  const delta = Math.abs(q.target - q.current);
  if (!Number.isFinite(delta)) return "move"; // unreadable ⇒ fail open
  if (delta <= REPOSITION_EPSILON_PX) return "hold";
  if (!isKnown(q.rect) || !isKnown(q.band)) return "move"; // fail open
  if (!isFullyVisible(q.rect, q.band)) return "move";
  if (delta > farThresholdFor(q.band)) return "move";
  return "hold";
}

/**
 * The measure-pass half of the same rule: the value to COMMIT this pass,
 * given what was committed last time.
 *
 * A pass that would move a value by less than `epsilon` keeps the previous
 * one, so the deck does not re-render — and, since the omni wrapper
 * transitions its transform, so that no sub-threshold correction can present
 * itself to the user as a slide. There is no separate "should I commit"
 * predicate: holding IS the answer, and it is spelled here so the measure
 * pass and the click paths cannot drift apart on what counts as movement.
 */
export function holdWithinEpsilon(
  previous: number | undefined,
  next: number,
  epsilon: number = REPOSITION_EPSILON_PX,
): number {
  if (previous === undefined) return next;
  if (!Number.isFinite(next)) return previous;
  return Math.abs(next - previous) <= epsilon ? previous : next;
}
