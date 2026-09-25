/**
 * **The interruption TONE register — decided once** (task 571).
 *
 * Task 545 built the one vocabulary for every state that stops or pauses
 * writing (`document-interruption.ts`) and gave it a `tone` — the visual
 * register a surface paints the state in. It answered the question ONCE for
 * the guided band and left two things beside it: the band's own private
 * tone → token switch (`paletteFor`, a second speller of the same palette the
 * five topbar pills each hand-wrote), and the save badge, which never read the
 * tone at all and re-derived it from its TIER — `blocked ⇒ danger`, whatever
 * the reason. So for ONE document in ONE state the band and the cowork pill
 * were amber while the save pill beside them was red; a netted conflict, whose
 * pill task 364 had deliberately un-reddened, was red again one pill over.
 *
 * > **A kind has ONE tone and a tone has ONE palette, both stated here, in a
 * > leaf every surface can reach.** `document-interruption.ts` reads
 * > {@link INTERRUPTION_TONE} for the band and the pills; `save-state.ts`
 * > reads it for the save badge through the reason → kind map it owns; and
 * > every surface that paints an interruption paints it through
 * > {@link paletteForTone}. A second switch over the tone is how the badge's
 * > red came about, and the census in `save-state-census.test.ts` forbids one.
 *
 * ## The register (STYLE_GUIDE → "The destructive / alarm family")
 *
 * - **`live`** — the breathing warm family: something happening RIGHT NOW,
 *   that clears itself (the cowork pen hold). Same tokens as `warning`; the
 *   distinction is the animated glyph, which is the ONE pill's to carry.
 * - **`warning`** — the warm family one step up: unexpected, netted, nothing
 *   destructive (a disk conflict whose both doors archive first; unsaved work
 *   past the warn threshold).
 * - **`info`** — the informational amber (a change on disk with nothing at
 *   risk here).
 * - **`danger`** — the alarm ramp, reserved for a state in which the user's
 *   work is on no disk and nothing is coming to put it there (a preservation
 *   refusal, a failed write, a refused sidecar write).
 *
 * Import-free on purpose (the placement rule `latex-markers.ts` and
 * `node-attr-sets.ts` each earned): `save-state.ts` sits BELOW
 * `document-interruption.ts` in the import graph, so a table only the upper
 * module could reach would be re-copied by the lower one — which is exactly
 * the fork this closes.
 *
 * NOT members: warm-family pills about something OTHER than a document write
 * (the sync-conflict folder report, a forest refusal badge) take the family
 * from STYLE_GUIDE directly; they present no `InterruptionKind` and must not
 * be made to look up one they have not got.
 */

/** The states that interrupt a document, in PRIORITY order (first wins when
 *  several stand at once — see `deriveDocumentInterruption`). */
export type InterruptionKind =
  /** An `/editor/*` skill holds the pen: the text is read-only, saving is
   *  paused, and it clears itself. The only "happening right now" state. */
  | "cowork-hold"
  /** A gate refused to write: the model holds less than the file. */
  | "preservation"
  /** The file changed on disk AND the user has unsaved edits here. */
  | "conflict"
  /** The last write threw (permission, lock, quota). */
  | "save-error"
  /** A write to one of the paper's `virgil/` sidecars (the AI-request inbox,
   *  the bib-review queue, a card panel) did not land — task 630. The `.tex`
   *  is fine; what the user just filed is not on disk. */
  | "sidecar-refused"
  /** The file changed on disk; nothing unsaved here, nothing at risk. */
  | "disk-change";

/** The visual register. See the module header for what each one MEANS. */
export type InterruptionTone = "live" | "warning" | "info" | "danger";

/**
 * Kind → tone. Exhaustive by the `Record`, so a new kind cannot ship without
 * stating its register — and stated as DATA rather than inside each branch of
 * the derivation, so a reader (the save badge, a pill about ONE kind) can ask
 * without building the whole view.
 */
export const INTERRUPTION_TONE: Readonly<Record<InterruptionKind, InterruptionTone>> =
  Object.freeze({
    "cowork-hold": "live",
    preservation: "danger",
    conflict: "warning",
    "save-error": "danger",
    "sidecar-refused": "danger",
    "disk-change": "info",
  });

export function toneForInterruptionKind(kind: InterruptionKind): InterruptionTone {
  return INTERRUPTION_TONE[kind];
}

/** The three tokens a pill or band paints from. All `var(--…)` — jsdom
 *  resolves no CSS vars, so a test asserts the SPECIFIED value. */
export interface TonePalette {
  /** The ground. */
  bg: string;
  /** The hairline / inset edge, and the glyph's ink. */
  edge: string;
  /** The text ink — legible on the soft ground (the `-500` rungs are too light
   *  to read at 11px, so the hue lives on the edge and the glyph). */
  ink: string;
}

/**
 * Tone → palette, spelled ONCE. `live` and `warning` share tokens by design —
 * what separates them is the breathing glyph, not the colour.
 */
export const TONE_PALETTE: Readonly<Record<InterruptionTone, TonePalette>> = Object.freeze({
  live: { bg: "var(--amber-100)", edge: "var(--amber-500)", ink: "var(--ink-strong)" },
  warning: { bg: "var(--amber-100)", edge: "var(--amber-500)", ink: "var(--ink-strong)" },
  info: { bg: "var(--amber-50)", edge: "var(--amber-200)", ink: "var(--ink-strong)" },
  danger: { bg: "var(--danger-soft)", edge: "var(--danger)", ink: "var(--ink-strong)" },
});

export function paletteForTone(tone: InterruptionTone): TonePalette {
  return TONE_PALETTE[tone];
}

/** How a surface presenting a tone ANNOUNCES itself to assistive tech. */
export interface ToneAnnouncement {
  role: "alert" | "status";
  "aria-live": "assertive" | "polite";
}

/**
 * Tone → announcement, spelled ONCE (task 769). The alarm ramp interrupts
 * (`alert` + assertive): the user's work is on no disk and nothing is coming
 * to put it there. Every other register waits its turn (`status` + polite).
 * Pre-769 the in-document band stated this pairing inline and the bar pills
 * each chose for themselves — two of seven carried a role at all, so a
 * screen-reader user heard neither the conflict pause nor the recovery offer.
 */
export const TONE_ANNOUNCEMENT: Readonly<Record<InterruptionTone, ToneAnnouncement>> =
  Object.freeze({
    live: Object.freeze({ role: "status", "aria-live": "polite" }),
    warning: Object.freeze({ role: "status", "aria-live": "polite" }),
    info: Object.freeze({ role: "status", "aria-live": "polite" }),
    danger: Object.freeze({ role: "alert", "aria-live": "assertive" }),
  });

export function announcementForTone(tone: InterruptionTone): ToneAnnouncement {
  return TONE_ANNOUNCEMENT[tone];
}
