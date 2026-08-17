import { describe, expect, it } from "vitest";
import { extractBracketed, extractBraced } from "@/lib/latex-lexer";

/**
 * Task 340 — THE optional-argument scanner.
 *
 * The `\item[label]` capture needed a bracket reader, and this file's own
 * neighbourhood already had thirteen hand-rolled `indexOf("]")` copies, every
 * one of them wrong on the same two inputs. So the scan is spelled ONCE,
 * beside the brace scanners it borrows both of its rules from, rather than
 * becoming a fourteenth copy.
 *
 * The failure modes are silent in opposite directions, which is why this needs
 * a rule rather than care: a close bracket found too EARLY leaks the rest of
 * the optional argument into the body, and a `]` mistaken for a delimiter when
 * it was ordinary text eats prose.
 */
describe("extractBracketed — the optional-argument scanner", () => {
  it("reads a plain optional argument and reports the index past the ]", () => {
    const got = extractBracketed("[abc]tail", 0);
    expect(got).toEqual({ content: "abc", end: 5 });
    expect("[abc]tail".slice(got!.end)).toBe("tail");
  });

  it("reads an EMPTY optional argument as \"\", not as absence", () => {
    // `\item[]` suppresses the marker — a real value, distinct from no arg.
    expect(extractBracketed("[]x", 0)).toEqual({ content: "", end: 2 });
  });

  it("refuses when the char at the offset is not a [", () => {
    expect(extractBracketed("abc]", 0)).toBeNull();
    expect(extractBracketed("{a}", 0)).toBeNull();
  });

  it("is BRACE-AWARE — a ] inside a balanced group is not the delimiter", () => {
    // The headline defect of the naive scan: `indexOf("]")` stops at index 8.
    const src = "[\\textbf{a]b}]rest";
    expect(src.indexOf("]")).toBe(10); // what the naive scan would have found
    const got = extractBracketed(src, 0);
    expect(got!.content).toBe("\\textbf{a]b}");
    expect(src.slice(got!.end)).toBe("rest");
  });

  it("handles nested braces to any depth", () => {
    const got = extractBracketed("[{{a]b}}]z", 0);
    expect(got!.content).toBe("{{a]b}}");
    expect("[{{a]b}}]z".slice(got!.end)).toBe("z");
  });

  it("treats \\] as literal by the shared escape-parity rule", () => {
    const got = extractBracketed("[a\\]b]z", 0);
    expect(got!.content).toBe("a\\]b");
    expect("[a\\]b]z".slice(got!.end)).toBe("z");
  });

  it("still closes on a REAL delimiter after a \\\\ line break", () => {
    // The parity rule's whole point: `\\` is an escaped backslash, so the `]`
    // that follows it is NOT escaped. Same case `findMatchingBrace` documents.
    const got = extractBracketed("[a\\\\]z", 0);
    expect(got!.content).toBe("a\\\\");
    expect("[a\\\\]z".slice(got!.end)).toBe("z");
  });

  it("treats an escaped brace as literal, so it does not shift depth", () => {
    const got = extractBracketed("[a\\{b]z", 0);
    expect(got!.content).toBe("a\\{b");
  });

  it("FAILS CLOSED on an unterminated argument rather than guessing", () => {
    expect(extractBracketed("[abc", 0)).toBeNull();
    // An unbalanced `{` swallows the only `]`, so there is no depth-0 close.
    expect(extractBracketed("[a{b] more", 0)).toBeNull();
  });

  it("scans from a NON-zero offset", () => {
    const src = "\\item[(a)] alpha";
    const got = extractBracketed(src, 5);
    expect(got!.content).toBe("(a)");
    expect(src.slice(got!.end)).toBe(" alpha");
  });

  it("agrees with extractBraced on the escape rule it borrows", () => {
    // Both scanners read the same parity rule, so a `\}`/`\]` behaves the
    // same way in each. A drift here is a drift in one of the two copies.
    expect(extractBraced("{a\\}b}", 0)!.content).toBe("a\\}b");
    expect(extractBracketed("[a\\]b]", 0)!.content).toBe("a\\]b");
  });
});
