/**
 * latex-typography.ts — ONE bidirectional typographic mapping between
 * canonical LaTeX source and the Unicode glyphs Virgil shows in the editor.
 *
 * This is the deep, source-preserving seam that smart quotes already use
 * (see `src/lib/tiptap/smart-quotes.ts` + `escapeLatex` in
 * `latex-serializer.ts`): the doc stores the composed Unicode glyph, and
 * serialize reconstructs the canonical LaTeX command. We extend that same
 * mechanism to the whole class of text-mode typography:
 *
 *   - Accents          \'e \`e \^e \"o \~n \=o \.c \u{u} \v{s} \c{c} \H{o}
 *                      \r{a} \b{x} \d{x} \k{a}  →  é è ê ö ñ ō ċ ŭ š ç ő å …
 *                      (the two-argument tie \t{xx} is intentionally excluded —
 *                       see the ACCENT_TABLE note.)
 *   - Special letters  \ss \o \O \ae \AE \aa \AA \l \L \i \j \oe \OE …
 *   - Dashes           --  →  – (U+2013, en)      ---  →  — (U+2014, em)
 *   - Ellipsis         \ldots / \dots  →  … (U+2026)
 *
 * SINGLE SOURCE OF TRUTH: parse and serialize both derive from the tables
 * below — there is no hand-duplicated list. The accent direction is fully
 * symmetric: parse composes `command + base` → NFC glyph; serialize
 * NFD-decomposes a precomposed glyph and maps the trailing combining mark
 * back to its command. Because we map combining marks (not enumerated
 * precomposed code points), ALL base letters round-trip without listing
 * every Unicode accented character.
 *
 * DIRECT-TYPED-GLYPH POLICY: a glyph the user types directly (é, –, —, …)
 * is serialized back to its canonical LaTeX form (`\'e`, `--`, `---`,
 * `\ldots`). This matches the smart-quote precedent exactly — a directly
 * typed `"` / `“` serializes to ``` `` ```/`''`. The `.tex` is always
 * canonical & recompilable regardless of how the character was entered; no
 * data is lost. We pick ONE canonical LaTeX form per glyph so that
 * parse(serialize(x)) and serialize(parse(x)) stabilize (idempotency).
 *
 * SCOPE / EXCLUSIONS: this module is pure string↔string. The CALLERS are
 * responsible for never running it inside code/verbatim spans, math
 * (`$…$`, `\[…\]`), or the raw-LaTeX `latexCommand` mark (where the user
 * deliberately typed raw LaTeX). The parser excludes math (handled before
 * text accumulates) and gates code via the `inCode` flag; the serializer
 * skips the `code` and `latexCommand` mark paths. See the wiring comments
 * in latex-parser.ts / latex-serializer.ts.
 */

// ─────────────────────────────────────────────────────────────────────────
// Accent commands ↔ Unicode combining diacritical marks
// ─────────────────────────────────────────────────────────────────────────
//
// Each entry maps a LaTeX accent command name to its combining mark. Two
// LaTeX spellings exist per accent:
//   - control symbols (\' \` \^ \" \~ \= \.)  — punctuation, no token break
//   - control words   (\u \v \c \H \r \b \d \t) — letters, need a brace or
//     a following space/brace to terminate the command name
//
// `key` is the command body (without the leading backslash). `combining`
// is the U+03xx combining mark we append to the base letter before NFC.
//
// SERIALIZE canonical form: control-symbol accents emit `\'{e}`-style with
// braces (unambiguous, the form LaTeX always accepts); control-word accents
// emit `\v{s}`-style (braces required for the token break anyway).

interface AccentEntry {
  /** Command body without the backslash, e.g. `'` or `v`. */
  key: string;
  /** Unicode combining diacritical mark appended before NFC composition. */
  combining: string;
  /** true for control symbols (\' \` …); false for control words (\v \c …). */
  controlSymbol: boolean;
}

const ACCENT_TABLE: AccentEntry[] = [
  // Control symbols
  { key: "'", combining: "́", controlSymbol: true }, // acute   é
  { key: "`", combining: "̀", controlSymbol: true }, // grave   è
  { key: "^", combining: "̂", controlSymbol: true }, // circ    ê
  { key: '"', combining: "̈", controlSymbol: true }, // umlaut  ö
  { key: "~", combining: "̃", controlSymbol: true }, // tilde   ñ
  { key: "=", combining: "̄", controlSymbol: true }, // macron  ō
  { key: ".", combining: "̇", controlSymbol: true }, // dot     ċ
  // Control words
  { key: "u", combining: "̆", controlSymbol: false }, // breve     ŭ
  { key: "v", combining: "̌", controlSymbol: false }, // caron     š
  { key: "c", combining: "̧", controlSymbol: false }, // cedilla   ç
  { key: "H", combining: "̋", controlSymbol: false }, // dbl acute ő
  { key: "r", combining: "̊", controlSymbol: false }, // ring      å
  { key: "b", combining: "̱", controlSymbol: false }, // macron-bl x̱
  { key: "d", combining: "̣", controlSymbol: false }, // dot-below ạ
  { key: "k", combining: "̨", controlSymbol: false }, // ogonek    ą
  // NOTE: `\t` (tie, U+0361) is deliberately NOT in this table. It is a
  // TWO-argument accent (`\t{oo}` ties two letters), which does not fit this
  // single-base accent model: parse rejects the 2-char base and serialize
  // would bind the combining tie to only the preceding letter and drop the
  // second tied letter (`t͡s` → `\t{t}s`, lossy). Leaving it out lets `\t{oo}`
  // round-trip cleanly as a raw `latexCommand` instead of a broken half-
  // conversion. Real two-base tie support would need a dedicated case in
  // matchAccent (consume two base letters) and typographyToLatex.
];

/** command-body → combining mark (parse direction). */
const ACCENT_BY_KEY = new Map<string, AccentEntry>(
  ACCENT_TABLE.map((e) => [e.key, e]),
);
/** combining mark → entry (serialize direction). */
const ACCENT_BY_COMBINING = new Map<string, AccentEntry>(
  ACCENT_TABLE.map((e) => [e.combining, e]),
);

const CONTROL_SYMBOL_KEYS = ACCENT_TABLE.filter((e) => e.controlSymbol).map(
  (e) => e.key,
);
const CONTROL_WORD_KEYS = ACCENT_TABLE.filter((e) => !e.controlSymbol).map(
  (e) => e.key,
);

// ─────────────────────────────────────────────────────────────────────────
// Special letters (no base letter — the command IS the glyph) ↔ glyph
// ─────────────────────────────────────────────────────────────────────────
//
// Ordered: longer command names first so a regex alternation matches
// greedily (\AE before \A-anything, etc.). `\i` / `\j` are dotless i/j —
// usable bare (ı ȷ) or as accent bases (\^{\i} → î); here we only handle the
// bare form.
//
// PARSE: every command here maps to its glyph. SERIALIZE: only glyphs with
// NO Unicode decomposition (ß ø Ø æ Æ œ Œ ł Ł ı ȷ) are reconstructed from
// this table. Glyphs that DECOMPOSE under NFD — å (a+ring), Å (A+ring) — are
// reconstructed by the general accent mechanism in `typographyToLatex`
// (å → \r{a}), which runs first. Both \aa and \r{a} compile to å, so this is
// lossless; we deliberately route through the ONE general mechanism rather
// than carve out per-glyph exceptions (the unified-design mandate).

interface SpecialLetterEntry {
  /** Command body without the backslash, e.g. `ss`, `o`, `ae`. */
  key: string;
  glyph: string;
}

const SPECIAL_LETTER_TABLE: SpecialLetterEntry[] = [
  { key: "ss", glyph: "ß" }, // ß
  { key: "ae", glyph: "æ" }, // æ
  { key: "AE", glyph: "Æ" }, // Æ
  { key: "oe", glyph: "œ" }, // œ
  { key: "OE", glyph: "Œ" }, // Œ
  { key: "aa", glyph: "å" }, // å
  { key: "AA", glyph: "Å" }, // Å
  { key: "o", glyph: "ø" }, // ø
  { key: "O", glyph: "Ø" }, // Ø
  { key: "l", glyph: "ł" }, // ł
  { key: "L", glyph: "Ł" }, // Ł
  { key: "i", glyph: "ı" }, // ı (dotless i)
  { key: "j", glyph: "ȷ" }, // ȷ (dotless j)
];

/** glyph → command-body (serialize direction). */
const SPECIAL_LETTER_BY_GLYPH = new Map<string, string>(
  SPECIAL_LETTER_TABLE.map((e) => [e.glyph, e.key]),
);

// ─────────────────────────────────────────────────────────────────────────
// Literal sequences: dashes & ellipsis ↔ glyph
// ─────────────────────────────────────────────────────────────────────────

export const EN_DASH = "–"; // –
export const EM_DASH = "—"; // —
export const ELLIPSIS = "…"; // …

/**
 * Literal-sequence table. Ordered longest-first so the serialize/parse
 * passes match `---` before `--`. `parse` is what the LaTeX source emits;
 * `glyph` is the editor glyph. Ellipsis lists `\ldots` as canonical and
 * `\dots` as an accepted parse-alias.
 */
interface LiteralEntry {
  /** All LaTeX spellings that PARSE to `glyph` (canonical first). */
  latexForms: string[];
  glyph: string;
}

const LITERAL_TABLE: LiteralEntry[] = [
  { latexForms: ["---"], glyph: EM_DASH },
  { latexForms: ["--"], glyph: EN_DASH },
  { latexForms: ["\\ldots", "\\dots"], glyph: ELLIPSIS },
];

/** glyph → canonical LaTeX (serialize direction). */
const LITERAL_BY_GLYPH = new Map<string, string>(
  LITERAL_TABLE.map((e) => [e.glyph, e.latexForms[0]]),
);

// ─────────────────────────────────────────────────────────────────────────
// PARSE direction helpers (LaTeX source → glyph)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Compose an accent command applied to a base letter into an NFC glyph.
 * Returns null if the base can't compose (we return base+combining anyway,
 * NFC-normalized — for bases without a precomposed form this yields the
 * combining-sequence, which still renders correctly).
 */
function composeAccent(combining: string, base: string): string {
  return (base + combining).normalize("NFC");
}

/**
 * Try to match an accent command at `text[start]` (which must be `\`).
 *
 * Handles all three LaTeX spellings:
 *   - `\<sym>{x}`   braced control symbol      \'{e}
 *   - `\<sym>x`     bare control symbol         \'e
 *   - `\<word>{x}`  braced control word         \v{s}
 *   - `\<word> x`   spaced control word          \v s   (LaTeX token break)
 *
 * The base `x` may itself be a special letter (`\v{\i}` etc.) or escaped
 * (`\'{\j}`). We resolve a single-letter base or a nested special letter.
 *
 * Returns the composed glyph + the index just past the consumed sequence,
 * or null if no accent matches.
 */
export function matchAccent(
  text: string,
  start: number,
): { glyph: string; end: number } | null {
  if (text[start] !== "\\") return null;
  const c1 = text[start + 1];
  if (c1 === undefined) return null;

  // Control symbol: the char right after `\` is the accent key.
  if (CONTROL_SYMBOL_KEYS.includes(c1)) {
    const entry = ACCENT_BY_KEY.get(c1)!;
    return consumeAccentBase(text, start + 2, entry.combining);
  }

  // Control word: a run of letters that exactly equals one of our keys.
  const wordMatch = text.slice(start + 1).match(/^[a-zA-Z]+/);
  if (wordMatch) {
    const word = wordMatch[0];
    // Match the LONGEST control-word key that is a prefix only if it equals
    // the whole command token — LaTeX commands are greedy letter runs, so
    // `\verb` is NOT `\v` + `erb`. We require the command name to be exactly
    // a control-word key followed by a non-letter (brace, space, or `\`).
    if (CONTROL_WORD_KEYS.includes(word)) {
      const entry = ACCENT_BY_KEY.get(word)!;
      let p = start + 1 + word.length;
      // Braced form: \v{s}
      if (text[p] === "{") {
        return consumeAccentBase(text, p, entry.combining);
      }
      // Spaced form: \v s  (one or more spaces, then a single base)
      if (text[p] === " ") {
        while (text[p] === " ") p++;
        return consumeAccentBase(text, p, entry.combining);
      }
      // No valid base (e.g. `\v` at end, or `\v3`) — not an accent.
      return null;
    }
  }

  return null;
}

/**
 * Consume the base of an accent starting at `pos`, which is either a `{...}`
 * group or a single character (possibly an escaped special letter like
 * `\i`). Returns the composed glyph and the end index.
 */
function consumeAccentBase(
  text: string,
  pos: number,
  combining: string,
): { glyph: string; end: number } | null {
  if (pos >= text.length) return null;

  // Braced base: `{x}` or `{\i}` or `{}` (empty → accent over a space-less
  // nothing; LaTeX treats `\'{}` as a bare accent — we render the combining
  // mark on its own, which NFC leaves as the bare combining char).
  if (text[pos] === "{") {
    const close = findMatchingBrace(text, pos);
    if (close === -1) return null;
    const inner = text.slice(pos + 1, close);
    const base = resolveAccentBase(inner);
    if (base === null) return null;
    return { glyph: composeAccent(combining, base), end: close + 1 };
  }

  // Bare escaped special letter as base: `\'\i` → î
  if (text[pos] === "\\") {
    const sp = text.slice(pos + 1).match(/^[a-zA-Z]+/);
    if (sp) {
      const key = sp[0];
      const glyph = SPECIAL_LETTER_TABLE.find((e) => e.key === key)?.glyph;
      if (glyph) {
        return { glyph: composeAccent(combining, glyph), end: pos + 1 + key.length };
      }
    }
    return null;
  }

  // Bare single character base: `\'e`
  const base = text[pos];
  // Only letters are sensible accent bases; anything else (digit, space,
  // punctuation) means this wasn't really an accent we should compose.
  if (!/[a-zA-Z]/.test(base)) return null;
  return { glyph: composeAccent(combining, base), end: pos + 1 };
}

/**
 * Resolve a braced accent base into its single composing character. May
 * itself be a string carrying stacked combining marks (for a nested accent
 * base) — `composeAccent` NFC-normalizes the whole thing.
 */
function resolveAccentBase(inner: string): string | null {
  const trimmed = inner;
  if (trimmed === "") return ""; // \'{} → bare accent
  // Nested ACCENT command: {\d{a}} {\^{a}} … — a stacked diacritic. This is
  // the canonical spelling our serializer emits for a glyph with 2+ combining
  // marks (Vietnamese ặ → `\u{\d{a}}`); the parse side must compose it
  // inside-out or the whole accent falls through to the grey latexCommand
  // fallback (the D4 round-trip half). matchAccent must consume the ENTIRE
  // inner string for this to be a clean nested accent.
  if (trimmed[0] === "\\") {
    const nested = matchAccent(trimmed, 0);
    if (nested && nested.end === trimmed.length) {
      return nested.glyph;
    }
  }
  // Nested special letter: {\i} {\j} {\ss} … — INCLUDING the LaTeX
  // token-break form `{\i{}}` (a trailing `{}` that terminates the control
  // word). This is the canonical spelling our own serializer emits for an
  // accent over a special-letter glyph (`\^{\i{}}`), and it is perfectly
  // valid LaTeX a human or another tool may write, so the parse side must
  // accept it or the whole accent falls through to the grey latexCommand
  // fallback (the D1 round-trip corruption). Match an optional `{}` suffix.
  const sp = trimmed.match(/^\\([a-zA-Z]+)(\{\})?$/);
  if (sp) {
    const glyph = SPECIAL_LETTER_TABLE.find((e) => e.key === sp[1])?.glyph;
    if (glyph) return glyph;
    return null;
  }
  // Single letter
  if (/^[a-zA-Z]$/.test(trimmed)) return trimmed;
  // Anything longer / non-letter — not something we compose.
  return null;
}

/**
 * Match a special-letter command (`\ss`, `\o`, …) at `text[start]` (`\`).
 * Requires the command name to be terminated by a non-letter and consumes a
 * following `{}` (the LaTeX `\ss{}` token-break idiom) or a single space.
 */
export function matchSpecialLetter(
  text: string,
  start: number,
): { glyph: string; end: number } | null {
  if (text[start] !== "\\") return null;
  const wordMatch = text.slice(start + 1).match(/^[a-zA-Z]+/);
  if (!wordMatch) return null;
  const word = wordMatch[0];
  const entry = SPECIAL_LETTER_TABLE.find((e) => e.key === word);
  if (!entry) return null;
  let end = start + 1 + word.length;
  // Consume the token-break `{}` if present (`\ss{}`), else an optional
  // single trailing space that LaTeX uses to terminate the control word.
  if (text[end] === "{" && text[end + 1] === "}") {
    end += 2;
  } else if (text[end] === " ") {
    end += 1;
  }
  return { glyph: entry.glyph, end };
}

/**
 * THE escape rule for LaTeX delimiters — the single definition of "is the
 * char at `i` escaped by a preceding backslash?" for the whole codebase.
 *
 * Escaping is **backslash-run parity**, not a single-character look-behind:
 * a delimiter is escaped iff the unbroken run of backslashes ending just
 * before it has ODD length. `\{` (run 1, odd) is a literal brace; `\\{`
 * (run 2, even — an escaped backslash, i.e. a `\\` line break) is a REAL
 * group delimiter. The naive `text[i - 1] !== "\\"` test gets the even case
 * backwards, so `\emph{text\\}` never balances and `end\\$x^2$` never
 * toggles math (task 206).
 *
 * Lives here because `latex-typography.ts` is the true zero-import leaf;
 * `latex-lexer.ts` re-exports it so every other consumer imports it from the
 * lexer SSOT rather than reaching past it.
 */
export function isEscaped(text: string, i: number): boolean {
  let bs = 0;
  let j = i - 1;
  while (j >= 0 && text[j] === "\\") {
    bs++;
    j--;
  }
  return bs % 2 === 1;
}

/** Find the index of the `}` matching the `{` at `open`. -1 if unbalanced. */
function findMatchingBrace(text: string, open: number): number {
  if (text[open] !== "{") return -1;
  let depth = 1;
  let i = open + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "{" && !isEscaped(text, i)) depth++;
    else if (ch === "}" && !isEscaped(text, i)) {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/**
 * Convert `--`/`---` runs in a plain-text buffer to en/em dash glyphs.
 * Longest-first (`---` before `--`). Only ASCII hyphen runs are touched;
 * existing glyphs pass through. Callers must NOT run this inside code spans.
 */
export function dashesToGlyphs(text: string): string {
  // Replace runs of 2+ hyphens. 3→em, 2→en. Runs longer than 3 are LaTeX-
  // meaningless; collapse to em-dash + remaining hyphens handled greedily.
  return text
    .replace(/-{3}/g, EM_DASH)
    .replace(/-{2}/g, EN_DASH);
}

// ─────────────────────────────────────────────────────────────────────────
// SERIALIZE direction (glyph → canonical LaTeX)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Reverse-map every typographic glyph in `text` to its canonical LaTeX form.
 * This is the serialize counterpart of the parse helpers — driven by the
 * SAME tables. Order:
 *   1. NFD-decompose, fold accented letters back to `\cmd{base}`.
 *   2. Special letters (ß → \ss{}, ø → \o{}, …).
 *   3. Dashes (– → --, — → ---) and ellipsis (… → \ldots).
 *
 * Callers MUST NOT run this on code-marked or raw-`latexCommand` text. It is
 * the typographic layer that sits beside `escapeLatex`'s char-escaping +
 * smart-quote pass.
 */
export function typographyToLatex(text: string): string {
  // 1. Accents — NFD-decompose, then collapse `base + combining` → `\cmd{base}`.
  //    We normalize to NFD so precomposed code points (é) AND already-
  //    decomposed sequences (e + U+0301) are handled by one path. We then
  //    rebuild the string, mapping any combining mark in our table.
  const decomposed = text.normalize("NFD");
  let out = "";
  for (let i = 0; i < decomposed.length; i++) {
    const ch = decomposed[i];
    // Gather the FULL run of consecutive combining marks we recognize that
    // follow this base char. Stacked diacritics (Vietnamese ặ = a + breve +
    // dot-below, ấ = a + circ + acute) decompose under NFD to a base followed
    // by 2+ combining marks. Folding only the first mark would leave the rest
    // as bare combining codepoints floating after the brace (`\d{a}̆`) — not
    // valid/portable LaTeX (the D4 defect). Instead we NEST the accents
    // inner-to-outer in NFD order, which is canonical-combining-class order
    // (innermost mark closest to the base): ặ → `\d{\u{a}}`.
    const marks: AccentEntry[] = [];
    let j = i + 1;
    while (j < decomposed.length && ACCENT_BY_COMBINING.has(decomposed[j])) {
      marks.push(ACCENT_BY_COMBINING.get(decomposed[j])!);
      j++;
    }
    if (marks.length > 0) {
      // Canonical serialize form is braced for BOTH control symbols and
      // control words (`\'{e}`, `\v{s}`) — braces are unambiguous and the
      // form LaTeX always accepts. The base `ch` is the bare letter NFD left
      // behind (or a rare special-letter glyph, kept literal in the brace —
      // LaTeX accepts it and stays lossless on re-parse). Wrap each mark in
      // turn so the first (innermost) mark binds tightest.
      let folded = ch;
      for (const entry of marks) {
        folded = `\\${entry.key}{${folded}}`;
      }
      out += folded;
      i = j - 1; // consume all the combining marks (loop's i++ lands on j)
      continue;
    }
    out += ch;
  }

  // 2. Special letters (single-glyph). Done after accent folding so a glyph
  //    like å — which NFD-decomposes to a+ring and is already handled as an
  //    accent above — does NOT also hit the special-letter map. Glyphs that
  //    have NO decomposition (ß, ø, æ, œ, ł, ı, ȷ) survive NFD intact and
  //    are mapped here.
  out = out.replace(/[ßæÆœŒøØłŁıȷ]/g, (g) => {
    const key = SPECIAL_LETTER_BY_GLYPH.get(g);
    return key ? `\\${key}{}` : g;
  });

  // 3. Dashes + ellipsis — canonical literal form from the table.
  out = out
    .replace(new RegExp(EM_DASH, "g"), LITERAL_BY_GLYPH.get(EM_DASH)!)
    .replace(new RegExp(EN_DASH, "g"), LITERAL_BY_GLYPH.get(EN_DASH)!)
    .replace(new RegExp(ELLIPSIS, "g"), LITERAL_BY_GLYPH.get(ELLIPSIS)!);

  return out;
}

/**
 * Reverse-map straight/curly double quotes to their canonical LaTeX pairs:
 * an OPENING `"` → ``` `` ```, a CLOSING `"` → `''`. A `"` opens when it sits
 * at the start of the buffer or immediately after whitespace / opening
 * punctuation (`(` `[` `{` `/`) or a dash glyph (— –); otherwise it closes.
 * Curly `“`/`”` map directly to the opening/closing pair regardless of
 * context. Ordered opener-before-closer so the greedy closing catch-all only
 * sees the quotes the opener rule didn't claim.
 *
 * This is the ONE serialize-side smart-quote transform, shared by
 * `escapeLatex` (prose char-escape path) and `serializeMarks`' raw
 * `latexCommand` path — previously duplicated byte-for-byte in both, which let
 * the opener character class drift (the `/` omission that made `and/"or"`
 * serialize a wrong-way closing pair). Sits beside `typographyToLatex` because
 * it is the same "glyph → canonical LaTeX" direction, but is a SEPARATE export:
 * the `latexCommand` path smartens quotes WITHOUT running the full typographic
 * reverse-map (the user typed raw LaTeX there on purpose).
 *
 * Callers run this INSIDE `escapeLatex` after char-escaping and, for
 * `latexCommand`, on the raw mark text — never on `code`/verbatim spans.
 */
export function smartenStraightQuotes(text: string): string {
  return (
    text
      .replace(/“/g, "``")
      .replace(/”/g, "''")
      // Straight `"` → smart LaTeX pair. Opening if at start or after
      // whitespace / opening punctuation (incl. `/`) / a dash glyph;
      // otherwise closing.
      .replace(/(^|[\s([{/—–])"/g, "$1``")
      .replace(/"/g, "''")
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Introspection for tests — expose the table so the golden round-trip test
// derives its cases from the SAME source of truth, not a hand-copied list.
// ─────────────────────────────────────────────────────────────────────────

export const __typographyTables = {
  ACCENT_TABLE,
  SPECIAL_LETTER_TABLE,
  LITERAL_TABLE,
};
