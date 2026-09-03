/**
 * # A derived DOM write is idempotence-gated
 *
 * A vanilla NodeView's `update()` runs on EVERY transaction that touches its
 * node — and ProseMirror re-creates every ANCESTOR of an edited node, so a
 * container view's `update()` runs on every keystroke typed anywhere inside
 * it. Whatever that body writes to the DOM is therefore written per
 * keystroke, and the platform does not de-duplicate for it:
 *
 * - `setAttribute` / a `dataset.x =` write INVALIDATES STYLE even when the
 *   value is unchanged (tasks 416 / 430 / 524), and queues a mutation record
 *   the view then has to `ignoreMutation`.
 * - `el.textContent = same` REPLACES the text node — a real DOM mutation plus
 *   a layout of whatever measured that text (the expex item marker, task 551).
 * - `el.className = same` is a full class-string write (a style invalidation
 *   on the element and its subtree).
 *
 * The rule the paragraph / list / heading views already followed by hand
 * (the typing-latency fix 1c memo, the heading's "same-value dataset writes
 * still queue mutation records — guard on change") and the two expex views
 * never got (task 551) is stated ONCE here: **read first, write only on a
 * changed answer.** Every writer returns whether it wrote, so a caller that
 * needs "did anything move" (a cascade, a re-measure) can ask.
 *
 * Import-free of the editor so every NodeView — main-editor titled blocks,
 * the expex family, the inline atoms, the card-body paragraph — can take it.
 * The census in `render-annot-bail.test.ts` forbids a bare DOM write inside
 * any `addNodeView` `update()` body; this module is the door it points at.
 *
 * Reads are O(1) for the attribute forms. `setTextIfChanged` reads
 * `textContent`, which concatenates the element's DESCENDANTS — call it on a
 * leaf (a marker span, an annotation with one text node), never on a
 * container holding editable content.
 */

/** Set (or, with `null` / `undefined`, remove) an attribute, only on change. */
export function setAttrIfChanged(
  el: Element,
  name: string,
  value: string | null | undefined,
): boolean {
  if (value == null) {
    if (!el.hasAttribute(name)) return false;
    el.removeAttribute(name);
    return true;
  }
  if (el.getAttribute(name) === value) return false;
  el.setAttribute(name, value);
  return true;
}

/**
 * Set (or, with `null` / `undefined`, delete) a `data-*` entry by its
 * `dataset` KEY (`"sectionNumber"` ↔ `data-section-number`), only on change.
 */
export function setDataIfChanged(
  el: HTMLElement,
  key: string,
  value: string | null | undefined,
): boolean {
  const current = el.dataset[key];
  if (value == null) {
    if (current === undefined) return false;
    delete el.dataset[key];
    return true;
  }
  if (current === value) return false;
  el.dataset[key] = value;
  return true;
}

/** Replace a LEAF element's text, only when it differs. */
export function setTextIfChanged(el: Node, text: string): boolean {
  if (el.textContent === text) return false;
  el.textContent = text;
  return true;
}

/** Replace the whole class string, only when it differs. */
export function setClassNameIfChanged(el: Element, className: string): boolean {
  if (el.className === className) return false;
  el.className = className;
  return true;
}

/** Set an element's `title` (the hover tooltip), only when it differs. */
export function setTitleIfChanged(el: HTMLElement, title: string): boolean {
  if (el.title === title) return false;
  el.title = title;
  return true;
}
