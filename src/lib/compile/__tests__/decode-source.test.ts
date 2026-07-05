import { describe, expect, it } from "vitest";
import { decodeTexBytes } from "@/lib/compile/decode-source";

const REPLACEMENT_CHAR = "�";

describe("decodeTexBytes — fatal UTF-8 with raw fallback", () => {
  it("decodes valid UTF-8 to text", () => {
    const bytes = new TextEncoder().encode("\\documentclass{article}\nHola.");
    const result = decodeTexBytes(bytes);
    expect("text" in result).toBe(true);
    if ("text" in result) {
      expect(result.text).toBe("\\documentclass{article}\nHola.");
    }
  });

  it("decodes multibyte UTF-8 (accents, emoji) to text", () => {
    const original = "café — naïve — 数学 — 🎓";
    const bytes = new TextEncoder().encode(original);
    const result = decodeTexBytes(bytes);
    expect("text" in result).toBe(true);
    if ("text" in result) expect(result.text).toBe(original);
  });

  it("returns RAW bytes (no U+FFFD) for invalid UTF-8", () => {
    // 0xE9 is Latin-1 'é' — a lone high byte, invalid as UTF-8.
    const bytes = new Uint8Array([
      ...new TextEncoder().encode("caf"),
      0xe9,
      ...new TextEncoder().encode(" text"),
    ]);
    const result = decodeTexBytes(bytes);
    expect("raw" in result).toBe(true);
    if ("raw" in result) {
      // Byte-exact passthrough — same reference / same bytes, never corrupted.
      expect(result.raw).toBe(bytes);
      expect(Array.from(result.raw)).toEqual(Array.from(bytes));
    }
  });

  it("never silently substitutes U+FFFD on invalid input", () => {
    const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x41]);
    const result = decodeTexBytes(bytes);
    // Must NOT have produced a lossy text with the replacement char.
    if ("text" in result) {
      expect(result.text).not.toContain(REPLACEMENT_CHAR);
    } else {
      expect("raw" in result).toBe(true);
    }
  });

  it("handles an empty buffer as empty text", () => {
    const result = decodeTexBytes(new Uint8Array([]));
    expect("text" in result).toBe(true);
    if ("text" in result) expect(result.text).toBe("");
  });
});
