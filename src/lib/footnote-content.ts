// Footnote content lives as HTML in the node's `content` attribute so it can
// hold formatting (bold, italic, lists, etc). LaTeX serialization needs plain
// LaTeX commands, not HTML. These helpers convert in both directions and
// normalize legacy plain-text content on read.

const HTML_TAG_RE = /<[^>]+>/;

export function looksLikeHtml(s: string): boolean {
  return HTML_TAG_RE.test(s);
}

/**
 * Normalize footnote content to HTML form. Old documents stored plain strings;
 * we wrap those in a single `<p>` so the contentEditable surface always sees
 * a block container.
 */
export function normalizeFootnoteContent(content: string): string {
  if (!content) return "";
  if (looksLikeHtml(content)) return content;
  return `<p>${escapeHtml(content)}</p>`;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function unescapeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * Convert footnote HTML to a LaTeX-friendly string suitable for `\footnote{...}`.
 * Preserves \textbf / \textit / \underline; flattens lists and paragraphs.
 */
export function footnoteHtmlToLatex(html: string): string {
  if (!html) return "";

  let s = html;

  // Lists: each <li> becomes a bullet-prefixed line; the surrounding ul/ol
  // is dropped. We use middle dots so the LaTeX still reads naturally.
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "\u00b7 $1; ");
  s = s.replace(/<\/?(ul|ol)[^>]*>/gi, " ");

  // Inline formatting → LaTeX commands.
  s = s.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner) => `\\textbf{${inner}}`);
  s = s.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _t, inner) => `\\textit{${inner}}`);
  s = s.replace(/<u[^>]*>([\s\S]*?)<\/u>/gi, (_m, inner) => `\\underline{${inner}}`);

  // Paragraph and line break separators.
  s = s.replace(/<\/p\s*>/gi, " ");
  s = s.replace(/<p[^>]*>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, " ");
  s = s.replace(/<div[^>]*>/gi, "");
  s = s.replace(/<\/div\s*>/gi, " ");

  // Strip anything else.
  s = s.replace(/<[^>]+>/g, "");

  s = unescapeHtmlEntities(s);

  // Collapse runs of whitespace and trailing list separators.
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/;\s*$/g, "");

  return s;
}

/**
 * Convert LaTeX inside a `\footnote{...}` body back to HTML for editing.
 * Recognizes the same subset emitted by footnoteHtmlToLatex.
 */
export function footnoteLatexToHtml(latex: string): string {
  if (!latex) return "";

  // Escape first so any literal angle brackets in the LaTeX don't become tags.
  let s = escapeHtml(latex);

  // Re-introduce known formatting commands. Only matches balanced single-level
  // braces — nested formatting inside footnotes is rare and round-trip stays
  // lossless for the common case.
  const replaceCmd = (input: string, cmd: string, tag: string): string =>
    input.replace(new RegExp(`\\\\${cmd}\\{([^{}]*)\\}`, "g"), `<${tag}>$1</${tag}>`);

  s = replaceCmd(s, "textbf", "strong");
  s = replaceCmd(s, "textit", "em");
  s = replaceCmd(s, "emph", "em");
  s = replaceCmd(s, "underline", "u");

  return `<p>${s}</p>`;
}

/**
 * Strip a footnote HTML body to plain text (used by the inline editor popup
 * and by drag ghosts that need a quick preview).
 */
export function footnoteHtmlToPlainText(html: string): string {
  if (!html) return "";
  let s = html;
  s = s.replace(/<\/p\s*>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/li\s*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = unescapeHtmlEntities(s);
  return s.replace(/\n{2,}/g, "\n").trim();
}
