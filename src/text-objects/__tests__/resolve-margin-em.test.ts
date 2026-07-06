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
import { resolveMarginEm } from "@/text-objects/block-frame";

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
