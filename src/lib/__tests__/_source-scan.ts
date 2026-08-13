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
