import { CITE_RE_FULL } from "@/lib/cite-commands";
import { FOOTNOTE_RE_FULL } from "@/lib/footnote-commands";

/**
 * THE typed-LaTeX input-rule census — the LIVE VOCABULARY of Virgil's FOURTH
 * action surface (task 639).
 *
 * ## The question this answers
 *
 * `ACTION_REGISTRY` calls itself "the single source of truth for every editing
 * action Virgil exposes across its FOUR action surfaces", the fourth being
 * typed-LaTeX input. Three of the other three surfaces have a live vocabulary
 * the registry reconciles against — slash has `VIRGIL_COMMANDS` →
 * `SLASH_NAME_TO_ACTION_ID`, and both menus render FROM the rows. The typed
 * surface had none: each input rule is registered inside its own extension's
 * `addProseMirrorPlugins`, with no table anyone could read. So the registry's
 * `surfaces.typed` flags were DECLARED, in a hand set
 * (`CARD_IDS_WITH_TYPED_RULE`) whose own doc conceded the hazard — and measured
 * at task 639, two of them were simply FALSE (`inline-math` / `display-math`
 * own the `$` / `$$` rules and declared no typed surface, while the coverage
 * assertion's block leg FORBADE them declaring it) and a third rule
 * (`latex-comment`, `%`) had no row at all.
 *
 * This module is that missing table. It is the vocabulary the reconciliation
 * arm in `assertActionCoverage` compares the rows against, in BOTH directions,
 * exactly as the slash arm compares against `VIRGIL_COMMAND_NAMES`.
 *
 * ## Why it is ALIVE and not a second hand list
 *
 * A census beside the thing it describes is just a second place to drift. So
 * this one is LOAD-BEARING in both directions:
 *
 *   - every extension listed below MATCHES against the regex it reads FROM
 *     here (leaf-sharing — the idiom `CITE_RE_FULL` / `FOOTNOTE_RE_FULL`
 *     already established: the parser, the input rule and the registry row all
 *     reference the SAME object, so no two surfaces can recognize a different
 *     vocabulary). Delete an entry and its extension stops compiling.
 *   - `assertActionCoverage` requires each id here to have a row claiming
 *     `surfaces.typed` and recording THIS EXACT regex object as its
 *     `inputRulePattern`, and requires every typed-claiming row to be a live
 *     typed owner. A row cannot lie in either direction.
 *   - `typed-latex-census.test.ts` reconciles the KEY SET against source: the
 *     set of `handleTextInput` plugins gated by `collabReadOnly` IS the typed
 *     surface, and it must equal the keys below. A SIXTH input rule cannot ship
 *     uncensused, which is the drift the hand set could not see.
 *
 * ## What is NOT here
 *
 * The three structural WRAPPER rows (`bullet-list` / `ordered-list` /
 * `blockquote`) also own the typed surface — but through StarterKit's markdown
 * input rules (`- ` / `1. ` / `> `), not a Virgil `handleTextInput` plugin.
 * Their patterns are the extension's own exported regexes and the rows RECORD
 * them (task 427). They are the typed surface's second PROVIDER; the coverage
 * assertion unions the two halves. Keeping them out of this table is what lets
 * the source census above be exact — it looks for Virgil's own gated plugins,
 * and StarterKit has none of them.
 *
 * Keys are `ActionId`s, but typed as a plain string map here on purpose: the
 * registry imports this leaf (it must, to record the patterns), so the
 * dependency runs census → registry and the `ActionId` join is asserted on the
 * registry SIDE, where the union lives — `typedOwners()` spreads these keys
 * into a `Set<ActionId>`, so a key that is not an `ActionId` fails to COMPILE
 * there rather than turning into an import cycle here.
 */
export const TYPED_LATEX_INPUT_RULES = {
  /** `\cite{key}` → a citation atom (`citation.ts`). The FULL form; the bare
   *  `\cite ` branch soft-routes through the same rule. */
  citation: CITE_RE_FULL,
  /** `\footnote{body}` → a footnote atom (`footnote.ts`). */
  footnote: FOOTNOTE_RE_FULL,
  /** `$x$` → an inline-math atom (`math.ts`, `inlineMathInput`). The body class
   *  excludes U+FFFC so a `$` pair can never swallow an inline atom (task 578).
   *  The lookbehind REFUSES an opener that is itself preceded by `$`: a `$$`
   *  opener belongs to display math, so typing `$$x$` falls through here and
   *  the next `$` reaches the display rule's closing branch (task 744 — without
   *  it the inline rule claimed `$x` one keystroke early and `$$x$$` was
   *  unreachable by real typing). Zero-width, so `match[0]` still spans exactly
   *  the replaced `$body`. */
  "inline-math": /(?<!\$)\$([^$￼]+)$/,
  /** `$$x$$` → a display-math block (`math.ts`, `displayMathInput`). This is the
   *  CLOSING form; the rule's other branch opens an empty block on a bare `$$`
   *  at the start of a paragraph. */
  "display-math": /\$\$([^$￼]+)\$$/,
  /** `% ` at the start of a paragraph → a `latexComment` block
   *  (`latex-comment.ts`). Matched against the paragraph text INCLUDING the
   *  character being typed. */
  "latex-comment": /^% ?$/,
} as const satisfies Record<string, RegExp>;

/** The ids that own a Virgil typed-LaTeX input rule. */
export type TypedLatexActionId = keyof typeof TYPED_LATEX_INPUT_RULES;

/** The census key set — the live typed-LaTeX vocabulary, in declaration order. */
export const TYPED_LATEX_ACTION_IDS = Object.keys(
  TYPED_LATEX_INPUT_RULES,
) as readonly TypedLatexActionId[];
