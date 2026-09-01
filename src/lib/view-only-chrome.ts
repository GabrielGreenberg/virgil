/**
 * VIEW-ONLY CHROME — the one vocabulary for "this paint is the EDITOR's state,
 * not the document's", read by the writers that paint it and by the print
 * block that must not.
 *
 * THE LAW (task 408, widened by task 523):
 *
 *   **WHAT PRINTS IS THE DOCUMENT, NOT THE EDITOR'S CURRENT STATE.**
 *
 * 408 stated it for the HIDE half — a folded section, a locked focus band, a
 * collapsed source pod — and shipped a census for it
 * (`print-fold-posture.test.ts`). That census discovers its population by the
 * MECHANISM (`class:` literals inside the two files that stamp a
 * `display: none` decoration) where the law is about the QUESTION. So a
 * decoration that PAINTS view state rather than HIDING document content was
 * invisible to it twice over: not in either file, and hiding nothing.
 *
 * Ten days later task 518 landed Virgil's own spellchecker and it printed — a
 * red wavy underline under every word a stock en-US dictionary does not know,
 * on paper, through BOTH print doors, with `checkSpelling` defaulting on. It is
 * the one member of the class that needs no "Background graphics" setting,
 * because `text-decoration` is painted with the text.
 *
 * TWO HOOKS, because view-only chrome has two shapes and one blanket answer
 * would over-reach on the other:
 *
 *  - **PAINT ON ITS OWN ELEMENT** → `VIEW_ONLY_CLASS`, stamped by the writer
 *    beside its own class (`viewOnly(SPELL_ERROR_CLASS)`). Both decorations
 *    that take it own their own wrapper, so neutralising background /
 *    box-shadow / text-decoration there cannot reach anything the document
 *    renders. ONE print rule covers every present and future member.
 *
 *    The bib cross-highlight is the one member whose class lands on a DOCUMENT
 *    element (the `.citation-node` pill itself, added imperatively rather than
 *    by a decoration). That is safe by a fact about the print block rather than
 *    by construction, and it is stated at the site: the block already flattens
 *    `.citation-node`'s background, border, padding and colour with
 *    `!important`, so the only thing the marker's three properties can still
 *    reach there is the 2px ring that flatten leaves standing — which is
 *    exactly the view state being removed. A future marker on a document
 *    element owes the same argument.
 *
 *  - **PAINT ON A DOCUMENT ELEMENT** (the card hover/selection attention
 *    chrome) → `VIEW_ONLY_ATTENTION_ATTRS`. These attributes land on the
 *    anchored paragraph / footnote marker / `.linked-anchor` itself, so a
 *    blanket `background: none` there would also erase the user's persistent
 *    highlight tint — a USER CHOICE with its own print toggle, and therefore
 *    document content by the app's own posture. Instead the print block zeroes
 *    `--link-anchor-color`, the ONE var every attention rule paints from
 *    (`color-mix(… var(--link-anchor-color) …)` collapses to transparent) —
 *    the same idiom `.linked-anchor[data-anchor-archived]` already uses, and it
 *    leaves `--tint-color` untouched by construction.
 *
 * WHY A LEAF WITH NO IMPORTS: `globals.css` cannot import TypeScript, so the
 * binding between this vocabulary and the print block is a CI census
 * (`print-view-only-posture.test.ts`) — the `link-dom-contract` /
 * `latex-markers` / `node-attr-sets` precedent. A facet the layer that needs it
 * cannot import will be re-copied, every time.
 *
 * WHAT IS **NOT** VIEW-ONLY, stated so a future sweep does not over-reach: a
 * decoration that renders DOCUMENT CONTENT (`pgmark-chip` draws a real
 * `\pgmark{N}`, `latex-cmd` draws raw LaTeX the schema does not model) paints
 * the paper's own text and must never carry this marker. And the two HIDE
 * classes (`section-folded`, `focus-hidden`) must not either: they are governed
 * by ABSENCE from the print block (408's finding — there is no value `display`
 * could be restated as), and the marker's neutralisation would reach the
 * document blocks *inside* a folded section.
 */

/** The marker class every view-only PAINT decoration stamps beside its own. */
export const VIEW_ONLY_CLASS = "virgil-view-only";

/**
 * Compose a decoration's own class with the view-only marker.
 *
 * A named door rather than a template literal at each site, so the census can
 * ask "does this decoration declare itself view-only?" of the SOURCE — a
 * question no behavioural test can answer, because a decoration that paints on
 * paper renders identically on screen.
 */
export function viewOnly(cls: string): string {
  return `${cls} ${VIEW_ONLY_CLASS}`;
}

/**
 * The card hover/selection attributes — view-only paint that lands on a
 * DOCUMENT element, so it is neutralised by attribute rather than by marker.
 *
 * `data-paragraph-kind` and `data-margin-side` are deliberately NOT members:
 * they only select a colour for the rules keyed on the two attributes above,
 * so zeroing the colour retires them with nothing to enumerate.
 */
export const VIEW_ONLY_ATTENTION_ATTRS = [
  "data-card-hovered",
  "data-card-selected",
] as const;

/** The custom property every attention rule paints from. Zeroing it in print
 *  collapses the footnote ring, the Mode-A accent rail (both sides) and the
 *  Mode-B selection wash in one declaration. */
export const ATTENTION_COLOR_VAR = "--link-anchor-color";
