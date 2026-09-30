// @vitest-environment jsdom
/**
 * Task 860 — the Stack strip's surface is TOKENS, and its geometry is SHARED.
 *
 * The strip painted hand-typed rgba literals: a 20% warm-black band with a
 * 72%-white empty-state hint (~1.4:1 on the light canvas — the one sentence
 * that teaches the Stack was illegible). And the strip's width budget re-typed
 * the thumbnail width the thumbnail itself re-typed, so the two could drift.
 *
 * jsdom resolves no CSS vars, so these assert the SPECIFIED inline value.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { StackStrip } from "@/components/stack/StackStrip";
import {
  STACK_THUMB_W,
  STACK_THUMB_H,
} from "@/components/stack/StackThumbnail";
import {
  STACK_ICON_DIAMETER,
  STACK_INSET_LEFT,
} from "@/components/stack/StackIcon";
import type { StackItem } from "@/lib/stack/types";

afterEach(cleanup);

const strip = () =>
  document.querySelector('[data-stack-strip="true"]') as HTMLElement;

function textItem(id: string): StackItem {
  return {
    id,
    capturedAt: new Date().toISOString(),
    payload: { kind: "text", slice: null, plain: "hello" },
  } as unknown as StackItem;
}

describe("Stack strip surface (task 860)", () => {
  it("paints its band and empty hint through the --stack-strip-* tokens", () => {
    render(<StackStrip open items={[]} onRemove={() => {}} />);
    const el = strip();
    expect(el.style.background).toBe("var(--stack-strip-bg)");
    const hint = el.firstElementChild as HTMLElement;
    expect(hint.textContent).toMatch(/Drop popped paragraphs/);
    expect(hint.style.color).toBe("var(--stack-strip-hint)");
  });

  it("defines both tokens in globals.css, the hint on an ink token (not white)", () => {
    const css = readFileSync(
      resolve(__dirname, "../../../app/globals.css"),
      "utf8",
    );
    expect(css).toMatch(/--stack-strip-bg:\s*rgba\(/);
    expect(css).toMatch(/--stack-strip-hint:\s*var\(--ink-/);
  });

  it("no rgba literal is hand-typed in the strip source", () => {
    const src = readFileSync(resolve(__dirname, "../StackStrip.tsx"), "utf8");
    expect(src).not.toMatch(/rgba\(/);
  });

  it("the thumbnail box and the strip's width budget read ONE thumb size", () => {
    render(
      <StackStrip open items={[textItem("a")]} onRemove={() => {}} />,
    );
    const thumb = document.querySelector("[data-stack-thumb-id]") as HTMLElement;
    expect(thumb.style.width).toBe(`${STACK_THUMB_W}px`);
    expect(thumb.style.height).toBe(`${STACK_THUMB_H}px`);
    // The strip sits right of the icon by the exported diameter.
    const left = parseFloat(strip().style.left);
    expect(left).toBeGreaterThan(STACK_INSET_LEFT + STACK_ICON_DIAMETER);
    for (const f of ["StackStrip.tsx", "StackThumbnail.tsx", "StackIcon.tsx"]) {
      const src = readFileSync(resolve(__dirname, "..", f), "utf8");
      expect(src, f).not.toMatch(/\b(const ICON_DIAMETER|const THUMB_W)\b/);
      expect(src, f).not.toMatch(/width:\s*160\b/);
    }
  });
});
