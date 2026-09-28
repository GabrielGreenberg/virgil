/**
 * citation-display — what a citation atom SHOWS, as one pure answer (task 823).
 *
 * The atom's visible content had two writers that disagreed: the live NodeView
 * (sanitized `<i>`/`<b>` display text through `innerHTML`, and a dotted
 * `[cite]` pill for an empty `\cite{}`) and `renderHTML` (the raw display
 * string as ONE text node — so a `\citetitle` title showed a literal
 * `<i>Title</i>`, and an empty cite showed its bare command). `renderHTML` is
 * what the static card tier (T1, `renderBorrowedHtml`) and the HTML clipboard
 * paint from, so every collapsed card with a titled or empty citation looked
 * different from the same card expanded.
 *
 * Now both read THIS: a DOM-free tree of text and `i`/`b` elements, shaped as
 * ProseMirror `DOMOutputSpec` children so `renderHTML` can splice it straight
 * into its spec and the NodeView can render it through `DOMSerializer`.
 */

export type CitationDisplayChild = string | ["i" | "b", ...CitationDisplayChild[]];

export interface CitationDisplay {
  /** An empty `\cite{}` with no display text yet: paints the `[cite]` pill
   *  (`.citation-node[data-empty="true"]`). */
  empty: boolean;
  children: CitationDisplayChild[];
}

export const EMPTY_CITATION_PILL_TEXT = "[cite]";

const isEmptyCiteCommand = (command: string): boolean =>
  /^\\[A-Za-z]+\*?\{\s*\}$/.test(command || "");

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** The entity decoding `innerHTML` applied to the formatted branch. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * Parse display text holding `<i>`/`<b>` into a nested tree. Every other tag
 * is DROPPED (its text kept) — the same allow-list the NodeView's sanitizer
 * applied; an unclosed element closes at the end and a stray close is ignored,
 * as the HTML parser would.
 */
function parseFormatted(text: string): CitationDisplayChild[] {
  const root: CitationDisplayChild[] = [];
  const stack: { tag: "i" | "b" | null; children: CitationDisplayChild[] }[] = [
    { tag: null, children: root },
  ];
  const re = /<(\/?)([a-z][a-z0-9]*)?[^>]*>/gi;
  let last = 0;
  const pushText = (s: string) => {
    if (!s) return;
    stack[stack.length - 1]!.children.push(decodeEntities(s));
  };
  for (let m = re.exec(text); m; m = re.exec(text)) {
    pushText(text.slice(last, m.index));
    last = re.lastIndex;
    const name = (m[2] ?? "").toLowerCase();
    // Only the exact `<i>` / `<b>` / `</i>` / `</b>` spellings are kept.
    if ((name !== "i" && name !== "b") || m[0].length !== name.length + 2 + m[1]!.length) {
      continue;
    }
    if (m[1]) {
      const at = stack.map((f) => f.tag).lastIndexOf(name);
      if (at > 0) stack.length = at;
    } else {
      const el: ["i" | "b", ...CitationDisplayChild[]] = [name];
      stack[stack.length - 1]!.children.push(el);
      stack.push({ tag: name, children: el as unknown as CitationDisplayChild[] });
    }
  }
  pushText(text.slice(last));
  return root;
}

/** What a citation atom with these attrs shows. Pure; O(display text). */
export function citationDisplay(displayText: string, command: string): CitationDisplay {
  const display = displayText || "";
  if (!display && isEmptyCiteCommand(command)) {
    return { empty: true, children: [EMPTY_CITATION_PILL_TEXT] };
  }
  const text = display || command || "";
  if (/<[ib]>/i.test(text)) return { empty: false, children: parseFormatted(text) };
  return { empty: false, children: text ? [text] : [] };
}
