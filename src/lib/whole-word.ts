/**
 * Boundary-aware whole-word pattern builder (LHS-panel sweep · T6 · C26).
 *
 * The search query compiler (`search-sources.ts compileQuery`, via
 * `compileLiteral` below — every Search scope and the click-time
 * `revalidateInBlock` copy) historically bracketed its token with a bare `\b`
 * on each side (as did a since-retired citekey-rewrite regex):
 *
 *     `\b${escaped}\b`
 *
 * JavaScript's `\b` is a *transition* between a word char (`[A-Za-z0-9_]`) and a
 * non-word char. It silently mis-fires whenever the token itself *begins or ends
 * with a non-word char* — exactly the shape LaTeX citekeys and punctuated search
 * queries take (`+foo`, `foo!`, `a:b`). At such an edge `\b` asserts a
 * `\W`↔`\W` seam that never exists, so the match drops to zero (or rewrites the
 * wrong span). See BIB-F7-04 / SR-F1-04.
 *
 * The deep fix is to stop assuming a tidy word-char-bounded token: build the
 * boundary per-edge from the token's actual edge character. On a *word-char*
 * edge we keep `\b` semantics via a negative lookaround on the Unicode WORD
 * class (task 1202: `\b`'s own class is ASCII, so it mis-read `é`/`ö`). On
 * a *non-word* edge we instead assert that the token is not glued to a
 * continuation of the SAME token-character class — so `+foo` matches in `( +foo)`
 * but not inside `x+foo` or `++foo`, keeping whole-token semantics honest for
 * punctuation-bearing tokens.
 *
 * The input is the *already regex-escaped* token (the same value the call sites
 * pass to `new RegExp(...)`), matching the call-site contract
 * `wholeWordPattern(escapeRegExp(token))`. The escaping is the caller's job; this
 * helper only adds the boundary guards.
 */

/**
 * The WORD class, Unicode-aware (task 1202): letters, combining marks, numbers
 * and `_`. JS's own `\w` / `\b` are ASCII-only, so they call `é` / `ö` a
 * NON-word char — "café" never matched whole and "del" matched inside
 * "Gödel". Every pattern built here therefore needs the `u` flag; callers get
 * it from `wholeWordFlags` / `compileLiteral`, never by remembering it.
 */
const WORD_CLASS = "\\p{L}\\p{M}\\p{N}_";
const WORD_CHAR = new RegExp(`[${WORD_CLASS}]`, "u");

/**
 * The "token continuation" class for a non-word edge: word chars plus the
 * punctuation that legitimately appears *inside* a citekey / search token
 * (`: - + . / & @`). A non-word edge is a boundary iff the adjacent char is NOT
 * one of these — i.e. the token isn't part of a longer run of the same class.
 */
const TOKEN_CONTINUATION = `${WORD_CLASS}:+./&@-`;

/**
 * Recover the first/last *literal* character of an escaped pattern. The regex
 * escaper (`/[.*+?^${}()|[\]\\]/g → "\\$&"`) prefixes a backslash before special
 * chars, so the escaped string's edge may be a `\` followed by the real char.
 * We look past a leading backslash to read the true edge character. Both read
 * a whole CODE POINT, so an astral letter (𝑥) is classed as the letter it is.
 */
function leadingLiteralChar(escaped: string): string {
  if (escaped.length === 0) return "";
  // A backslash-escaped pair: the literal char is the second of the pair.
  const at = escaped[0] === "\\" && escaped.length >= 2 ? 1 : 0;
  return String.fromCodePoint(escaped.codePointAt(at)!);
}

function trailingLiteralChar(escaped: string): string {
  if (escaped.length === 0) return "";
  // A trailing backslash-escaped pair: the literal char is the last char, and
  // the char before it is the escaping backslash. (A lone trailing backslash
  // can't occur in a valid escaped pattern, so this is safe.)
  const chars = Array.from(escaped.slice(-2));
  return chars[chars.length - 1];
}

/**
 * Build a whole-word/whole-token regex pattern around an already-escaped token.
 *
 * - Word-char edge  → `(?<![<word>])` / `(?![<word>])` guard (`\b`, made
 *                     Unicode-honest).
 * - Non-word edge   → `(?<![<class>])` / `(?![<class>])` guard against the token
 *                     continuation class, so punctuated tokens (`+foo`, `foo!`,
 *                     `a:b`) match as whole tokens.
 *
 * @param escaped a regex-escaped token (the output of `escapeRegExp(token)`).
 * @returns a pattern string for `new RegExp(pattern, wholeWordFlags(…))` —
 *          it REQUIRES the `u` flag.
 */
export function wholeWordPattern(escaped: string): string {
  if (escaped.length === 0) return escaped;

  const firstChar = leadingLiteralChar(escaped);
  const lastChar = trailingLiteralChar(escaped);

  const leftGuard = WORD_CHAR.test(firstChar)
    ? `(?<![${WORD_CLASS}])`
    : `(?<![${TOKEN_CONTINUATION}])`;
  const rightGuard = WORD_CHAR.test(lastChar)
    ? `(?![${WORD_CLASS}])`
    : `(?![${TOKEN_CONTINUATION}])`;

  return `${leftGuard}${escaped}${rightGuard}`;
}

/**
 * Convenience: regex-escape a raw token AND wrap it as a whole-word pattern in
 * one call. Equivalent to `wholeWordPattern(escapeRegExp(raw))`. Provided for
 * call sites that hold the raw token (later-wave consumers); the escape regex is
 * the same one the existing sites use inline.
 */
export function escapeRegExp(raw: string): string {
  return raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Raw token → whole-word pattern (escape + boundary guards). */
export function wholeWordPatternFor(raw: string): string {
  return wholeWordPattern(escapeRegExp(raw));
}

/**
 * The flags every pattern from this module compiles with: global, Unicode
 * (required by the `\p{…}` guards — and it makes case-folding Unicode-honest,
 * so `É` finds `é`), and `i` unless case-sensitive.
 */
export function wholeWordFlags(caseSensitive: boolean): "gu" | "giu" {
  return caseSensitive ? "gu" : "giu";
}

/**
 * Raw literal → compiled global RegExp, optionally whole-word. The ONE door
 * for "find this literal text": the plain and whole-word modes share one
 * escape and one flag set, so a caller cannot pair a `\p{…}` guard with a
 * non-`u` regex. Returns null for an empty or uncompilable query.
 */
export function compileLiteral(
  raw: string,
  opts: { caseSensitive: boolean; wholeWord: boolean },
): RegExp | null {
  if (!raw) return null;
  const pattern = opts.wholeWord ? wholeWordPatternFor(raw) : escapeRegExp(raw);
  try {
    return new RegExp(pattern, wholeWordFlags(opts.caseSensitive));
  } catch {
    return null;
  }
}
