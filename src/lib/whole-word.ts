/**
 * Boundary-aware whole-word pattern builder (LHS-panel sweep · T6 · C26).
 *
 * Both the search query compiler (`search-sources.ts compileQuery`) and the
 * citekey-rewrite regex (`useCitations.ts updateBibKeyAndType`) historically
 * bracketed their token with a bare `\b` on each side:
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
 * edge we keep the honest `\b` semantics via a `(?<!\w)` / `(?!\w)` lookaround
 * (identical match set to `\b`, but composable with the non-word case below). On
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

/** Word char per JS `\w`: `[A-Za-z0-9_]`. */
const WORD_CHAR = /[A-Za-z0-9_]/;

/**
 * The "token continuation" class for a non-word edge: word chars plus the
 * punctuation that legitimately appears *inside* a citekey / search token
 * (`: - + . / & @`). A non-word edge is a boundary iff the adjacent char is NOT
 * one of these — i.e. the token isn't part of a longer run of the same class.
 */
const TOKEN_CONTINUATION = "A-Za-z0-9_:+./&@-";

/**
 * Recover the first/last *literal* character of an escaped pattern. The regex
 * escaper (`/[.*+?^${}()|[\]\\]/g → "\\$&"`) prefixes a backslash before special
 * chars, so the escaped string's edge may be a `\` followed by the real char.
 * We look past a leading/trailing backslash to read the true edge character.
 */
function leadingLiteralChar(escaped: string): string {
  if (escaped.length === 0) return "";
  // A backslash-escaped pair: the literal char is the second of the pair.
  if (escaped[0] === "\\" && escaped.length >= 2) return escaped[1];
  return escaped[0];
}

function trailingLiteralChar(escaped: string): string {
  if (escaped.length === 0) return "";
  // A trailing backslash-escaped pair: the literal char is the last char, and
  // the char before it is the escaping backslash. (A lone trailing backslash
  // can't occur in a valid escaped pattern, so this is safe.)
  const last = escaped[escaped.length - 1];
  return last;
}

/**
 * Build a whole-word/whole-token regex pattern around an already-escaped token.
 *
 * - Word-char edge  → `(?<!\w)` / `(?!\w)` guard (the honest `\b` equivalent).
 * - Non-word edge   → `(?<![<class>])` / `(?![<class>])` guard against the token
 *                     continuation class, so punctuated tokens (`+foo`, `foo!`,
 *                     `a:b`) match as whole tokens.
 *
 * @param escaped a regex-escaped token (the output of `escapeRegExp(token)`).
 * @returns a pattern string ready to drop into `new RegExp(pattern, flags)`.
 */
export function wholeWordPattern(escaped: string): string {
  if (escaped.length === 0) return escaped;

  const firstChar = leadingLiteralChar(escaped);
  const lastChar = trailingLiteralChar(escaped);

  const leftGuard = WORD_CHAR.test(firstChar)
    ? "(?<!\\w)"
    : `(?<![${TOKEN_CONTINUATION}])`;
  const rightGuard = WORD_CHAR.test(lastChar)
    ? "(?!\\w)"
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
