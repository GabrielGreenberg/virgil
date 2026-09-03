/**
 * VIEW-ONLY CHROME — the one vocabulary for "this paint is the EDITOR's state,
 * not the document's", read by the writers that paint it and by the print
 * block that must not.
 *
 * THE LAW (task 408, widened by task 523, and again by task 535 — the third
 * hook, `chromeOnly`, at the bottom of this file):
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
 * TWO HOOKS here (a THIRD, for whole chrome ELEMENTS, is declared at the
 * bottom — task 535), because view-only chrome has more than one shape and
 * one blanket answer would over-reach on the others:
 *
 *  - **PAINT ON ITS OWN ELEMENT** → `VIEW_ONLY_CLASS`, stamped by the writer
 *    beside its own class (`viewOnly(SPELL_ERROR_CLASS)`). Both decorations
 *    that take it own their own wrapper, so zeroing
 *    `VIEW_ONLY_ZEROED_PROPERTIES` there cannot reach anything the document
 *    renders. ONE print rule covers every present and future member.
 *
 *    The bib cross-highlight is the one member whose class lands on a DOCUMENT
 *    element (the `.citation-node` pill itself, added imperatively rather than
 *    by a decoration). That is safe by a fact about the print block rather than
 *    by construction, and it is stated at the site: the block already flattens
 *    `.citation-node`'s background, border, padding and colour with
 *    `!important`, so the only thing the marker's zeroed properties can still
 *    reach there is the 2px ring that flatten leaves standing — which is
 *    exactly the view state being removed. A future marker on a document
 *    element owes the same argument.
 *
 *  - **PAINT ON A DOCUMENT ELEMENT** (the hover/selection/active attention
 *    chrome) → `VIEW_ONLY_ATTENTION_ATTRS`. These attributes land on the
 *    anchored paragraph / footnote marker / `.linked-anchor` itself, so a
 *    blanket `background: none` there would also erase the user's persistent
 *    highlight tint — a USER CHOICE with its own print toggle, and therefore
 *    document content by the app's own posture. Instead the print block zeroes
 *    `--link-anchor-color`, the var the `--link-anchor-color` family paints
 *    from (`color-mix(… var(--link-anchor-color) …)` collapses to transparent)
 *    — the same idiom `.linked-anchor[data-anchor-archived]` already uses, and
 *    it leaves `--tint-color` untouched by construction. The exception is
 *    stated at `ATTENTION_COLOR_VAR` below rather than glossed: the CITATION
 *    variant paints amber and is flattened by an older print rule.
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

/* The ATTENTION attributes — view-only paint that lands on a DOCUMENT element,
 * so it is neutralised by attribute rather than by marker. Declared here as
 * NAMES so the three writers (`anchor-highlight-deco`, the reconciler's Mode-B
 * raw path, `useLinkHighlight`) and the print block read one vocabulary. */

/** Card SELECTION halo — `"paragraph"` for a Mode-A block, `"true"` otherwise. */
export const DATA_CARD_SELECTED = "data-card-selected";
/** Card HOVER halo — same value vocabulary. */
export const DATA_CARD_HOVERED = "data-card-hovered";
/**
 * The Mode-B anchor's own hover/active state — `"hover"` | `"active"`, removed
 * otherwise. A THIRD channel, and the one that proves this list has to be a
 * declared vocabulary rather than the two attributes anyone would think of: it
 * paints a 45%/60% wash plus a 1px ring — HEAVIER than the 22% selection wash —
 * and until it was named here it was neutralised only by COINCIDENCE, because
 * the reconciler happens to stamp `data-card-selected` on the same element for
 * the same card. Both read one store, so they co-occur; nothing pinned that,
 * and a future colour of its own (exactly what `.citation-highlight-bib` has)
 * would have printed a 60% wash.
 */
export const DATA_LINK_HIGHLIGHT = "data-link-highlight";

/**
 * `data-paragraph-kind` and `data-margin-side` are deliberately NOT members:
 * they only select a colour for the rules keyed on the attributes above, so
 * zeroing the colour retires them with nothing to enumerate. Neither are the
 * `data-show-hl-*` root toggles — those are a USER CHOICE with their own print
 * toggle, i.e. document content by this same posture.
 */
export const VIEW_ONLY_ATTENTION_ATTRS = [
  DATA_CARD_HOVERED,
  DATA_CARD_SELECTED,
  DATA_LINK_HIGHLIGHT,
] as const;

/**
 * The custom property the `--link-anchor-color` family of attention rules
 * paints from. Zeroing it in print collapses the footnote ring, BOTH sides of
 * the Mode-A accent rail, the Mode-B selection wash and the Mode-B hover/active
 * wash + ring in one declaration.
 *
 * NOT every attention rule, and the exception is stated rather than glossed:
 * the CITATION variant (`.citation-node[data-card-hovered]`) paints from the
 * amber highlight vars instead. It reaches paper flattened by the print block's
 * OLDER `.citation-node, .label-ref-node` rule, whose `!important` outranks the
 * non-important attention rule — a fact about that rule rather than about this
 * var, so the census pins it instead of leaving it to be rediscovered.
 */
export const ATTENTION_COLOR_VAR = "--link-anchor-color";

/**
 * The properties the print block zeroes for view-only paint. Declared so the
 * marker rule and the census cannot come to disagree about the list — `outline`
 * is the one a reader would omit, and it is the one a SELECTED card carries
 * into the print appendix.
 */
export const VIEW_ONLY_ZEROED_PROPERTIES = [
  "text-decoration",
  "background",
  "box-shadow",
  "outline",
] as const;

/* ── THE THIRD HOOK: a whole ELEMENT that is not document content (task 535) ──
 *
 * Neither hook above fits a NodeView's CHROME — a "Choose image…" button, a
 * "Loading …" line, the blue label lozenge, a fold chevron. Each is a whole
 * element that renders nothing of the node: not paint on a wrapper to
 * de-paint, not an attribute on a document element to neutralise. The right
 * print answer is `display: none`, and it is a DIFFERENT answer: measured,
 * the view-only rule zeroes `text-decoration` / `background` / `box-shadow` /
 * `outline`, every one of which leaves a "Choose image…" button's TEXT on
 * the page.
 *
 * Why a third hook rather than the two-item hand list the print block used
 * to carry (`.title-field-annotation, .heading-annotation { display: none }`):
 * the block's own comment said a hand list was the thing the marker rule
 * existed to replace, and the sibling it was missing was the figure lozenge —
 * task 523's census asks *every file that constructs a PM decoration*, and a
 * NodeView constructs none. So the writer declares it, beside its own class
 * (`chromeOnly("figure-annotation")`), ONE print rule hides every present and
 * future member, and `print-chrome-only-posture.test.ts` asks the QUESTION
 * over a population that includes NodeView chrome: every chrome-SHAPED
 * element a NodeView renders (a control, or static UI copy) is either stamped
 * — itself or a chrome container above it — or carries a class on a small
 * reviewed allowlist that states why it is DOCUMENT content.
 *
 * NOT a member, stated: a NodeView's ROOT is the node itself and never takes
 * this. An empty figure's root keeps its `figure` env on paper and has its
 * drop-zone paint FLATTENED there instead (the `.citation-node` shape). Nor
 * does a paragraph title (`.par-title-annotation`): it is the user's own
 * writing and prints — only its `+T` / `×` / input children are chrome. */

/** The marker class every editor-only chrome ELEMENT stamps beside its own. */
export const CHROME_ONLY_CLASS = "virgil-chrome-only";

/**
 * Compose an element's own class with the chrome-only marker. A named door
 * rather than a template literal at each site, for the same reason `viewOnly`
 * is one: the census asks "does this element declare itself chrome?" of the
 * SOURCE, because chrome that prints renders identically on screen.
 */
export function chromeOnly(cls: string): string {
  return cls ? `${cls} ${CHROME_ONLY_CLASS}` : CHROME_ONLY_CLASS;
}
