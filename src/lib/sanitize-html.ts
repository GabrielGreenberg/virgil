/**
 * Allowlist-based HTML sanitizer for the small rich-text surfaces Virgil
 * persists as raw HTML strings (today: the bibliography annotation editor; any
 * future contentEditable note body should reuse this).
 *
 * SECURITY (BIB-F5-01): the bibliography annotation is a contentEditable whose
 * `innerHTML` is persisted to `annotations.json` and seeded back into the live
 * DOM when the card opens. That HTML can arrive from an AI skill
 * (`answer-bib-review` writes `annotations.json`) or travel with a shared
 * paper, so it is UNTRUSTED. Routing it through `innerHTML` without
 * sanitization is a stored-XSS sink — `<img onerror>` / `<svg onload>` /
 * `<iframe>` / event-handler payloads execute on render.
 *
 * Strategy (no third-party dependency — matches the project's existing
 * `sanitizeInlineCitationHtml` precedent in `bib-parser.ts`):
 *   1. Parse with `DOMParser` into an INERT document. A DOMParser document has
 *      no browsing context, so parsing alone runs no scripts and fetches no
 *      resources — the payload is neutralized before we even walk it.
 *   2. Rebuild a fresh tree keeping ONLY an allowlist of formatting tags, each
 *      recreated with ZERO attributes. Because no attacker attribute
 *      (`onerror`, `src`, `href`, `style`, …) is ever copied and only inert
 *      formatting tags survive, the mutation-XSS surface is near zero.
 *
 * The output is composed solely of our own attribute-free elements plus text
 * nodes (which `innerHTML` serialization HTML-escapes), so it is safe to assign
 * to a live element's `innerHTML`.
 */

/** Inline + block formatting tags the annotation toolbar (`execCommand`) emits. */
const DEFAULT_ALLOWED_TAGS = new Set([
  "p", "div", "br", "span",
  "b", "strong", "i", "em", "u", "s", "strike",
  "ul", "ol", "li",
]);

/**
 * Disallowed tags whose entire subtree (including text) must be DROPPED rather
 * than unwrapped — surfacing a `<script>`'s body as visible text, or recursing
 * into `<svg>`/`<math>` foreign content, is undesirable. Everything else not in
 * the allowlist is unwrapped (tag removed, sanitized children kept).
 */
const DROP_WHOLE = new Set([
  "script", "style", "noscript", "template", "iframe",
  "object", "embed", "svg", "math", "head", "title", "link", "meta",
]);

export interface SanitizeOptions {
  /** Override the default formatting-tag allowlist. */
  allowedTags?: Set<string>;
}

/**
 * Sanitize an HTML fragment down to an allowlist of attribute-free formatting
 * tags. Safe to assign to a live element's `innerHTML`.
 */
export function sanitizeRichHtml(html: string, opts: SanitizeOptions = {}): string {
  if (!html) return "";
  const allowed = opts.allowedTags ?? DEFAULT_ALLOWED_TAGS;

  // SSR / non-DOM fallback: strip every tag, leaving (escaped) text only.
  if (typeof DOMParser === "undefined" || typeof document === "undefined") {
    return html.replace(/<[^>]*>/g, "");
  }

  // Inert parse — no browsing context, so nothing executes or fetches here.
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const out = document.createElement("div");

  const appendClean = (src: Node, dest: Node): void => {
    src.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        dest.appendChild(document.createTextNode(node.textContent || ""));
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return; // drop comments etc.

      const el = node as Element;
      const tag = el.tagName.toLowerCase();

      if (allowed.has(tag)) {
        // Recreate with ZERO attributes; recurse into the (sanitized) children.
        const clean = document.createElement(tag);
        appendClean(el, clean);
        dest.appendChild(clean);
      } else if (DROP_WHOLE.has(tag)) {
        return; // drop element AND its content
      } else {
        // Unknown wrapper: drop the tag, keep its sanitized children.
        appendClean(el, dest);
      }
    });
  };

  appendClean(parsed.body, out);
  return out.innerHTML;
}

/** Allowlist tuned to the bibliography annotation editor. */
export function sanitizeAnnotationHtml(html: string): string {
  return sanitizeRichHtml(html);
}
