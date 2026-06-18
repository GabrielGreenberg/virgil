/**
 * `wholeWordPattern` — boundary-aware whole-word matcher (LHS sweep · T6 · C26).
 *
 * Regression pins for the bare-`\b` bug (BIB-F7-04 citekey rewrite, SR-F1-04
 * search whole-word): a token that begins/ends with a non-word char (`+foo`,
 * `foo!`, `a:b`) must still match as a whole token, where plain `\b\W…\W\b`
 * silently matched nothing. Plain word tokens (`foo`) must keep exact `\b`
 * semantics: matched as a whole word, NOT inside `foobar`.
 *
 * The helper takes the *already regex-escaped* token (call-site contract
 * `wholeWordPattern(escapeRegExp(token))`); these tests escape with the same
 * regex the live sites use so the pin matches production input.
 */
import { describe, it, expect } from "vitest";
import {
  wholeWordPattern,
  wholeWordPatternFor,
  escapeRegExp,
} from "@/lib/whole-word";

/** Match the escaper used inline at the two live `\b` sites. */
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function re(token: string, flags = "g"): RegExp {
  return new RegExp(wholeWordPattern(esc(token)), flags);
}

describe("wholeWordPattern — produces a valid, usable RegExp", () => {
  it("escapeRegExp matches the inline escaper at the live sites", () => {
    expect(escapeRegExp("+foo.bar")).toBe(esc("+foo.bar"));
  });

  it("never throws when compiled for any of the design tokens", () => {
    for (const tok of ["foo", "+foo", "foo!", "a:b", "Smith:2020", "x-y_z"]) {
      expect(() => re(tok)).not.toThrow();
    }
  });

  it("wholeWordPatternFor === wholeWordPattern(escapeRegExp(raw))", () => {
    expect(wholeWordPatternFor("+foo")).toBe(wholeWordPattern(esc("+foo")));
  });

  it("empty token yields empty pattern (no stray guards)", () => {
    expect(wholeWordPattern("")).toBe("");
  });
});

describe("plain word token `foo` — keeps honest `\\b` semantics", () => {
  it("matches `foo` as a standalone word", () => {
    expect("a foo b".match(re("foo"))).toEqual(["foo"]);
  });

  it("does NOT match inside `foobar` (left/right word-char glue)", () => {
    expect("foobar".match(re("foo"))).toBeNull();
    expect("barfoo".match(re("foo"))).toBeNull();
  });

  it("matches at string start and end", () => {
    expect("foo".match(re("foo"))).toEqual(["foo"]);
    expect("(foo)".match(re("foo"))).toEqual(["foo"]);
  });
});

describe("leading non-word edge `+foo` — the bare-`\\b` zero-match bug", () => {
  // Sanity: prove the OLD pattern actually fails, so the fix is load-bearing.
  it("plain `\\b+foo\\b` matches NOTHING after a space (the bug)", () => {
    const old = new RegExp(`\\b${esc("+foo")}\\b`, "g");
    expect("a +foo b".match(old)).toBeNull();
  });

  it("wholeWordPattern matches `+foo` after a space", () => {
    expect("a +foo b".match(re("+foo"))).toEqual(["+foo"]);
  });

  it("matches `+foo` at string start and inside braces", () => {
    expect("+foo".match(re("+foo"))).toEqual(["+foo"]);
    expect("\\cite{+foo}".match(re("+foo"))).toEqual(["+foo"]);
  });

  it("does NOT match the trailing word-char glue `+foobar`", () => {
    expect("+foobar".match(re("+foo"))).toBeNull();
  });

  it("does NOT match when glued to a leading token char `x+foo`", () => {
    expect("x+foo".match(re("+foo"))).toBeNull();
    expect("++foo".match(re("+foo"))).toBeNull();
  });
});

describe("trailing non-word edge `foo!` — symmetric bare-`\\b` bug", () => {
  it("plain `\\bfoo!\\b` matches NOTHING before a space (the bug)", () => {
    const old = new RegExp(`\\b${esc("foo!")}\\b`, "g");
    expect("a foo! b".match(old)).toBeNull();
  });

  it("wholeWordPattern matches `foo!` before a space / at end", () => {
    expect("a foo! b".match(re("foo!"))).toEqual(["foo!"]);
    expect("foo!".match(re("foo!"))).toEqual(["foo!"]);
  });

  it("does NOT match the leading word-char glue `barfoo!`", () => {
    expect("barfoo!".match(re("foo!"))).toBeNull();
  });

  it("does NOT match when followed by a token-continuation char (`foo!bar`)", () => {
    // `bar` is a word-char continuation of the token → not a whole-token match.
    expect("foo!bar".match(re("foo!"))).toBeNull();
  });

  it("DOES match when followed by a non-continuation char (`foo!!` / `foo! `)", () => {
    // A second `!` (or a space) is a genuine boundary, not a continuation, so
    // the whole token `foo!` is honestly present.
    expect("foo!!".match(re("foo!"))).toEqual(["foo!"]);
    expect("foo! ".match(re("foo!"))).toEqual(["foo!"]);
  });
});

describe("internal non-word char `a:b` — citekey-with-colon", () => {
  it("matches `a:b` as a whole token (both edges word chars)", () => {
    expect("see a:b here".match(re("a:b"))).toEqual(["a:b"]);
    expect("\\cite{a:b}".match(re("a:b"))).toEqual(["a:b"]);
  });

  it("does NOT match inside a longer token `a:bc` / `za:b`", () => {
    expect("a:bc".match(re("a:b"))).toBeNull();
    expect("za:b".match(re("a:b"))).toBeNull();
  });
});

describe("realistic citekey rewrite (BIB-F7-04) — whole-token replace", () => {
  it("rewrites a colon citekey inside `\\cite{}` without touching a superset key", () => {
    const oldKey = "Smith:2020";
    const newKey = "Smith:2021";
    const command = "\\cite{Smith:2020,Smith:2020a}";
    const result = command.replace(re(oldKey), newKey);
    // Only the exact whole-token occurrence is rewritten; `Smith:2020a` is left.
    expect(result).toBe("\\cite{Smith:2021,Smith:2020a}");
  });

  it("rewrites a `+`-prefixed citekey that plain `\\b` would miss", () => {
    const command = "\\cite{+weird}";
    const result = command.replace(re("+weird"), "tidy");
    expect(result).toBe("\\cite{tidy}");
  });
});
