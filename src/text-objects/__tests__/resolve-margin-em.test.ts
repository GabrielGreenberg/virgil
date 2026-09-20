// @vitest-environment jsdom
/**
 * Geometry-SSOT interpreter hardening — `resolveMarginEm` (block-frame.ts)
 * must fully account for its input domain: an `em` token scales against the
 * BLOCK font-size, a `rem` token against the DOCUMENT-ROOT font-size, and a
 * `rem` token must NOT be swallowed by the `em` branch (`"1.25rem".endsWith(
 * "em")` is `true`). These are PURE-LOGIC assertions over a stubbed
 * computed-style declaration — no jsdom layout is trusted.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveChevronColumnRight,
  resolveMarginEm,
} from "@/text-objects/block-frame";

/** A minimal computed-style stand-in returning a fixed token for any property. */
function fakeCs(tokenValue: string): CSSStyleDeclaration {
  return {
    getPropertyValue: (_name: string) => tokenValue,
  } as unknown as CSSStyleDeclaration;
}

const VAR = "--margin-track-width";
const FALLBACK = 20;
const ROOT_FONT_SIZE = 20; // deliberately ≠ the block font-sizes below
const BLOCK_FONT_SIZE = 24; // e.g. a heading — makes root≠block observable

describe("resolveMarginEm — em vs rem input domain", () => {
  let priorRootFontSize: string;

  beforeEach(() => {
    priorRootFontSize = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = `${ROOT_FONT_SIZE}px`;
  });

  afterEach(() => {
    document.documentElement.style.fontSize = priorRootFontSize;
  });

  it("resolves an `em` token against the BLOCK font-size (reachable path unchanged)", () => {
    // 0.625em × 16px block = 10px (the shipped --margin-handle-gap value)
    expect(resolveMarginEm(fakeCs("0.625em"), 16, VAR, FALLBACK)).toBeCloseTo(10, 5);
    // 1.25em × 24px block = 30px — scales with the block, not the root
    expect(
      resolveMarginEm(fakeCs("1.25em"), BLOCK_FONT_SIZE, VAR, FALLBACK),
    ).toBeCloseTo(30, 5);
  });

  it("resolves a `rem` token against the ROOT font-size, NOT the block font-size", () => {
    // 1.25rem × 20px root = 25px. The old code matched "rem".endsWith("em")
    // and would have returned 1.25 × 24 (block) = 30px — the bug value.
    const resolved = resolveMarginEm(
      fakeCs("1.25rem"),
      BLOCK_FONT_SIZE,
      VAR,
      FALLBACK,
    );
    expect(resolved).toBeCloseTo(ROOT_FONT_SIZE * 1.25, 5); // 25
    expect(resolved).not.toBeCloseTo(BLOCK_FONT_SIZE * 1.25, 5); // not 30 (em-swallow)
  });

  it("passes a raw `px` token through (forward-compat)", () => {
    expect(resolveMarginEm(fakeCs("18px"), 16, VAR, FALLBACK)).toBeCloseTo(18, 5);
  });

  it("falls back when the token is missing / unparseable", () => {
    expect(resolveMarginEm(fakeCs(""), 16, VAR, FALLBACK)).toBe(FALLBACK);
    expect(resolveMarginEm(fakeCs("junk"), 16, VAR, FALLBACK)).toBe(FALLBACK);
  });
});

/**
 * Task 661 — the sign policy is a property OF THE TOKEN, stated once and
 * applied on EVERY rung. Before, the `> 0` test lived on the px rung alone: a
 * negative `em` factor sailed through on a distance token while a negative px
 * fell back. One token, two policies, decided by its spelling — and that fork
 * is exactly what sent `--margin-col-chevron` (legitimately negative) to a
 * second hand-parse rather than through this door.
 */
describe("resolveMarginEm — sign policy", () => {
  // The rem rung reads the live root font-size; pin it ≠ the block font-size
  // below so a rem leg is about the ROOT, not about 16 twice.
  let priorRootFontSize: string;
  beforeEach(() => {
    priorRootFontSize = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = `${ROOT_FONT_SIZE}px`;
  });
  afterEach(() => {
    document.documentElement.style.fontSize = priorRootFontSize;
  });

  it('defaults to "positive": a non-positive value is unreadable on EVERY rung', () => {
    expect(resolveMarginEm(fakeCs("-18px"), 16, VAR, FALLBACK)).toBe(FALLBACK);
    expect(resolveMarginEm(fakeCs("0px"), 16, VAR, FALLBACK)).toBe(FALLBACK);
    // The rung that used to leak: a negative em resolved to a negative px.
    expect(resolveMarginEm(fakeCs("-1.25em"), 16, VAR, FALLBACK)).toBe(FALLBACK);
    expect(resolveMarginEm(fakeCs("-1.25rem"), 16, VAR, FALLBACK)).toBe(FALLBACK);
  });

  it('"signed" admits a negative OFFSET — on every rung, not just px', () => {
    expect(resolveMarginEm(fakeCs("-44px"), 16, VAR, FALLBACK, "signed")).toBeCloseTo(-44, 5);
    expect(
      resolveMarginEm(fakeCs("-2.75em"), 16, VAR, FALLBACK, "signed"),
    ).toBeCloseTo(-44, 5);
    expect(
      resolveMarginEm(fakeCs("-2.2rem"), 16, VAR, FALLBACK, "signed"),
    ).toBeCloseTo(-2.2 * ROOT_FONT_SIZE, 5);
  });

  it('"signed" still rejects an UNREADABLE token (NaN is not a sign question)', () => {
    expect(resolveMarginEm(fakeCs("junk"), 16, VAR, FALLBACK, "signed")).toBe(FALLBACK);
    expect(resolveMarginEm(fakeCs(""), 16, VAR, FALLBACK, "signed")).toBe(FALLBACK);
  });
});

/**
 * The chevron column's two tokens now come through the SAME door (task 661) —
 * the last `--margin-*` hand-parse in `block-frame.ts`. Its own docstring named
 * this as the right eventual move: the exemption it argued for was never "these
 * tokens are different", it was "the shared resolver has no signed rung".
 */
describe("resolveChevronColumnRight — through the one interpreter", () => {
  /** Distinct values per property, so a leg can tell which rung ran. */
  function tokenCs(map: Record<string, string>): CSSStyleDeclaration {
    return {
      getPropertyValue: (name: string) => map[name] ?? "",
      fontSize: "16px",
    } as unknown as CSSStyleDeclaration;
  }

  it("resolves the shipped px literals exactly as before", () => {
    const cs = tokenCs({
      "--margin-col-chevron": "-44px",
      "--margin-col-chevron-width": "14px",
    });
    expect(resolveChevronColumnRight(cs, "heading", 200)).toBeCloseTo(170, 5);
  });

  it("now resolves an `em` spelling of either token (the ladder it never had)", () => {
    const cs = tokenCs({
      "--margin-col-chevron": "-2.75em",
      "--margin-col-chevron-width": "0.875em",
    });
    // Hand-parsed, these were -2.75 and 0.875 — a 14px column at 186.125
    // instead of the 170 the stylesheet asked for.
    expect(resolveChevronColumnRight(cs, "heading", 200, 16)).toBeCloseTo(170, 5);
  });

  it("falls back per token: the offset keeps its sign, the width its floor", () => {
    const cs = tokenCs({
      "--margin-col-chevron": "junk",
      "--margin-col-chevron-width": "-9px", // a negative WIDTH is unreadable
    });
    // DEFAULT_CHEVRON_OFFSET_PX (-44) + DEFAULT_CHEVRON_WIDTH_PX (14).
    expect(resolveChevronColumnRight(cs, "heading", 200)).toBeCloseTo(170, 5);
  });

  it("answers null for a kind that reserves no column", () => {
    const cs = tokenCs({ "--margin-col-chevron": "-44px" });
    expect(resolveChevronColumnRight(cs, "paragraph", 200)).toBeNull();
    expect(resolveChevronColumnRight(cs, null, 200)).toBeNull();
  });
});
