/**
 * SHARED SOURCE SCANNER for the grep-census guardrails.
 *
 * Not a suite — vitest's `include` collects only `*.test.{ts,tsx}`, so this
 * module is a helper the censuses import.
 *
 * Blank out comments — and, when `keepStrings` is false, string/template
 * literals too — so a census sees CODE.
 *
 * Written as a ONE-PASS SCANNER rather than a chain of regex replaces, because
 * the chain form is the task-202b runaway: stripping template literals before
 * string literals lets a backtick living inside a double-quoted string
 * (`src/lib/latex-typography.ts` has one) open a pseudo-template that eats
 * every line to the next backtick anywhere in the file — 7 kB and nine `export`
 * declarations, silently, with the suite still green. A single left-to-right
 * scan cannot make that mistake: it is already inside the string when it meets
 * the backtick. Quoted strings terminate at a newline, so a stray quote (from
 * an unhandled regex literal, the one construct this does not model) can
 * corrupt at most its own line — and each caller's own swallow self-check is
 * what would catch it if it ever cost more than that.
 *
 * `keepStrings: true` is for a needle that must match INSIDE a literal (e.g.
 * task 205's `source === "orphan"` comparison): stripping strings there would
 * make the leg unfalsifiable, since the needle requires the quoted word to
 * survive.
 *
 * This lives here because it is the THIRD census that needs it, and the two
 * prior ones were each burned by a hand-rolled variant (202b's runaway; 205's
 * unfalsifiable leg). A routine with that history gets one copy, not one per
 * caller. Callers: [margin-side-ssot.test.ts](margin-side-ssot.test.tsx),
 * [action-context-honesty.test.ts](../actions/__tests__/action-context-honesty.test.ts).
 */
export function strip(src: string, keepStrings: boolean): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      const start = i;
      i++;
      while (i < n && src[i] !== quote && src[i] !== "\n") {
        if (src[i] === "\\") i++;
        i++;
      }
      if (i < n && src[i] === quote) i++;
      out += keepStrings ? src.slice(start, i) : quote + quote;
      continue;
    }
    if (c === "`") {
      const start = i;
      i++;
      let depth = 0;
      while (i < n) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === "$" && src[i + 1] === "{") {
          depth++;
          i += 2;
          continue;
        }
        if (depth > 0 && src[i] === "}") {
          depth--;
          i++;
          continue;
        }
        if (depth === 0 && src[i] === "`") {
          i++;
          break;
        }
        // Code inside `${…}` is real code — keep it even when the surrounding
        // template text is dropped.
        if (depth > 0 && !keepStrings) out += src[i];
        i++;
      }
      out += keepStrings ? src.slice(start, i) : "``";
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Comments AND string/template literals blanked — a census that must not
 *  count a name merely MENTIONED in prose or in a string literal. */
export const codeOnly = (src: string) => strip(src, false);

/** Comments blanked, literals intact — for a needle whose match lives inside
 *  the quotes. */
export const commentsStripped = (src: string) => strip(src, true);

/**
 * CSS RULE BODIES only — the token-home blocks (`:root`, `@theme`) removed.
 *
 * The question every colour census asks is "is this literal spelled where it
 * BELONGS?", and a `:root` block is exactly where it belongs: that is the
 * definition, not a drift. So a census over literals has to be able to see the
 * two regions apart, and it cannot do that with a regex — it needs brace depth
 * plus the selector that opened the block.
 *
 * SECOND caller earns the extraction (`color-token-consumers.test.ts` had the
 * first copy; task 2026-07-20-195's destructive-red census is the second) —
 * the same rule the two strippers above record, applied one construct over.
 *
 * Comment handling is deliberately NOT folded in: a caller that must not count
 * a hex NAMED in prose composes `cssRuleBodies(cssCommentsStripped(css))`, and
 * one whose needle is a whole declaration does not have to pay for it.
 *
 * A CHARACTER scanner, not a line filter, and each of its three differences
 * from the line-based copy it replaces is a hole that copy had:
 *
 *  - **The token-home test reads the WHOLE selector**, not whether `:root`
 *    appears in it. `:root` is also a legitimate ANCESTOR combinator, and
 *    `globals.css` uses it that way three times
 *    (`:root[data-display-mode="window-controls-overlay"] .virgil-bar …`), so
 *    a substring test silently exempted three ordinary rule bodies.
 *  - **A rule's opening line keeps everything after its `{`.** A line filter
 *    must drop the whole line (the depth is still 0 when it is read), so every
 *    SINGLE-LINE rule — `globals.css` has a 20-rule block of them — was
 *    invisible in its entirety, declarations included.
 *  - **Token homes nest.** Depth is tracked per block rather than reset at 0,
 *    so a `:root` inside `@media print` is still a definition and a rule
 *    inside one is still a rule.
 *
 * Blanked characters become spaces and NEWLINES ARE PRESERVED, so byte and
 * line offsets survive — a caller reporting `file:line` stays honest.
 */
export function cssRuleBodies(css: string): string {
  /**
   * `:root {`, `:root, html {`, `@theme inline {` — never `:root[x] .y {`.
   *
   * Comments are dropped HERE rather than required of the caller: the text
   * before a selector routinely includes the prose explaining it, and
   * `color-token-consumers` passes the raw sheet. Missing this made the whole
   * `:root` block read as a rule body — with every token definition in it.
   */
  const isTokenHome = (selector: string) => {
    const s = selector.replace(/\/\*[\s\S]*?\*\//g, " ").trim();
    if (s.startsWith("@theme")) return true;
    return s.length > 0 && s.split(",").every((p) => p.trim() === ":root");
  };

  let out = "";
  let depth = 0;
  let tokenHomeDepth: number | null = null;
  let selector = "";
  const blank = (c: string) => (c === "\n" ? "\n" : " ");

  for (const c of css) {
    if (c === "{") {
      if (tokenHomeDepth === null && isTokenHome(selector)) tokenHomeDepth = depth;
      depth++;
      selector = "";
      out += " ";
      continue;
    }
    if (c === "}") {
      depth--;
      if (tokenHomeDepth !== null && depth <= tokenHomeDepth) tokenHomeDepth = null;
      selector = "";
      out += " ";
      continue;
    }
    // A `;` ends a statement, so the selector candidate starts after it —
    // otherwise a top-level `@import "…";` (and everything before it) is still
    // glued to the front of the next selector.
    if (c === ";") selector = "";
    else selector += c;
    out += depth > 0 && tokenHomeDepth === null ? c : blank(c);
  }
  return out;
}

/**
 * The CSS twin: blank `/* … *​/` comments so a token merely NAMED in prose is
 * neither a definition nor a read. CSS has no line comment and no string
 * escape worth modelling here, so it is a much smaller scanner than `strip` —
 * but it is the same rule, and this is the THIRD census to need it
 * (`phantom-css-var`, `atom-chrome-tokens`, and task 326's reverse census),
 * which by the rule the TS twin's header states earns one copy rather than one
 * per caller.
 *
 * NEWLINES ARE PRESERVED (blanked to spaces, `\n` kept), unlike the two
 * hand-rolled copies this replaces, which collapsed each comment to two
 * characters. Nothing consumed line numbers through those — `atom-chrome`
 * slices by index and `phantom-css-var` reported CSS hits at a line number
 * that had silently drifted by every multi-line comment above them. Callers
 * that count declarations or match braces are unaffected either way; a caller
 * that reports `file:line` is now honest.
 */
export function cssCommentsStripped(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    if (css[i] === "/" && css[i + 1] === "*") {
      i += 2;
      out += "  ";
      while (i < css.length && !(css[i] === "*" && css[i + 1] === "/")) {
        out += css[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < css.length) out += "  ";
      i += 2;
      continue;
    }
    out += css[i];
    i++;
  }
  return out;
}

/* ── The JSX half ────────────────────────────────────────────────────────
 *
 * A census over MARKUP needs to see a tag the way the compiler does, and each
 * of these three routines exists because a regex form of it was measurably
 * wrong on this repo's own source (`pane-drag-guardrail`, task 189, wrote the
 * first copy; the icon-button a11y census is the second caller, which by the
 * rule the stripper above records earns one copy rather than two).
 */
/**
 * Where the JSX open tag starting at `start` ends: the index of the `>` that
 * closes it at BRACE depth zero, or -1.
 *
 * Depth-aware rather than `[^>]*`, because `onMouseDown={(e) => beginResize(e)}`
 * is the dominant handler idiom in this repo and a character class truncates
 * such a tag at its arrow, dropping every attribute AFTER it out of the match.
 * A needle looking for `aria-label` there reports CLEAN on a tag that carries
 * one — precisely how the first version of this census passed over the four
 * margin-guide hit-zones while its own doctrine indicted them.
 */
export function tagEnd(source: string, start: number): number {
  let depth = 0;
  for (let j = start + 1; j < source.length; j++) {
    const c = source[j];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      j++;
      while (j < source.length && source[j] !== q) {
        if (source[j] === "\\") j++;
        j++;
      }
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth <= 0) return j;
  }
  return -1;
}

/**
 * The whole open tag CONTAINING the character at `index`, or null.
 *
 * Anchored on the needle and walked outward, deliberately — enumerating every
 * `<` in a file first is what an earlier draft did, and a bare `<` from a
 * comparison or a generic (`useState<Foo>`) starts a pseudo-tag whose
 * brace-balanced scan can run past, and swallow, the real tag after it. In a
 * 3,000-line component that silently produced a handle with no tags, i.e. a
 * false "unchromed" report. Anchoring means a junk `<` can only ever affect
 * its own line.
 */
export function tagAround(source: string, index: number): string | null {
  const start = source.lastIndexOf("<", index);
  if (start < 0 || !/[A-Za-z/]/.test(source[start + 1] ?? "")) return null;
  const end = tagEnd(source, start);
  if (end < index) return null;
  return source.slice(start, end + 1);
}

/** Every distinct JSX open tag whose text matches `needle`. */
export function tagsContaining(source: string, needle: RegExp): string[] {
  const g = new RegExp(
    needle.source,
    needle.flags.includes("g") ? needle.flags : `${needle.flags}g`,
  );
  const out = new Set<string>();
  for (const m of source.matchAll(g)) {
    const tag = tagAround(source, m.index ?? 0);
    if (tag) out.add(tag);
  }
  return [...out];
}

/** The element name an open tag declares (`div` for `<div …>`). */
function tagName(tag: string): string {
  return /^<([A-Za-z][\w.-]*)/.exec(tag)?.[1] ?? "";
}

/**
 * The source enclosed by the element whose open tag is `tag` — "" when the tag
 * is self-closing, null when the close can't be located (fail LOUD: an
 * unparsed subtree must not read as "no focusable children").
 *
 * Depth counting must ask each same-named open tag whether it SELF-CLOSES; a
 * regex that counts `<div` occurrences treats `<div … />` as opening a level
 * that never closes, and every handle wrapping a self-closing child then
 * reports "close tag not found" — which is what the first draft did to
 * `panel-column`, whose widened hit-target is exactly that shape.
 */
export function elementSubtree(source: string, tag: string): string | null {
  if (/\/\s*>$/.test(tag)) return "";
  const start = source.indexOf(tag);
  if (start < 0) return null;
  const name = tagName(tag);
  if (!name) return null;
  const step = new RegExp(`</?${name}(?![\\w.-])`, "g");
  let depth = 1;
  step.lastIndex = start + tag.length;
  let m: RegExpExecArray | null;
  while ((m = step.exec(source))) {
    if (m[0].startsWith("</")) {
      depth--;
      if (depth === 0) return source.slice(start + tag.length, m.index);
      continue;
    }
    const end = tagEnd(source, m.index);
    if (end < 0) return null;
    if (source[end - 1] !== "/") depth++; // a self-closing tag opens nothing
    step.lastIndex = end;
  }
  return null;
}

/** One JSX element occurrence: its open tag, the source it encloses (null when
 *  the close tag can't be found), and where the tag starts. */
export interface JsxElementHit {
  tag: string;
  subtree: string | null;
  index: number;
}

/**
 * EVERY `<name …>` occurrence, paired with its OWN subtree.
 *
 * `tagsContaining` + `elementSubtree` answers the same question for a needle,
 * and cannot answer it here: it de-dupes by tag TEXT, and then resolves a
 * subtree by `indexOf(tag)`. Three byte-identical `<button className="…">`
 * open tags — `TabStrip` has exactly that, one per tab kind — collapse to one
 * entry whose children are always the first one's. For a census that asks
 * "what does this button RENDER", that is the difference between reading a
 * control's own icon and reading a sibling's.
 */
export function elementsNamed(source: string, name: string): JsxElementHit[] {
  const out: JsxElementHit[] = [];
  const open = new RegExp(`<${name}(?![\\w.-])`, "g");
  let m: RegExpExecArray | null;
  while ((m = open.exec(source))) {
    const end = tagEnd(source, m.index);
    if (end < 0) continue;
    const tag = source.slice(m.index, end + 1);
    out.push({ tag, subtree: subtreeFrom(source, m.index, tag, name), index: m.index });
    open.lastIndex = end;
  }
  return out;
}

/** `elementSubtree` keyed on a POSITION rather than on the tag's text. */
function subtreeFrom(
  source: string,
  start: number,
  tag: string,
  name: string,
): string | null {
  if (/\/\s*>$/.test(tag)) return "";
  const step = new RegExp(`</?${name}(?![\\w.-])`, "g");
  let depth = 1;
  step.lastIndex = start + tag.length;
  let m: RegExpExecArray | null;
  while ((m = step.exec(source))) {
    if (m[0].startsWith("</")) {
      depth--;
      if (depth === 0) return source.slice(start + tag.length, m.index);
      continue;
    }
    const end = tagEnd(source, m.index);
    if (end < 0) return null;
    if (source[end - 1] !== "/") depth++;
    step.lastIndex = end;
  }
  return null;
}
