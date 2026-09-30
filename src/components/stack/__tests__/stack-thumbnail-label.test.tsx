// @vitest-environment jsdom
/**
 * Task 861 — a stack thumbnail names its card by the REGISTRY label.
 *
 * It printed `cardKind.toUpperCase()`: TODO / BIB / REVISION-SUGGESTION /
 * CUTTER-COMMENT — code ids leaking into the UI (and into aria-description),
 * disagreeing with the panels the user had just captured from.
 */

import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  StackThumbnail,
  stackItemKindLabel,
} from "@/components/stack/StackThumbnail";
import { CARD_REGISTRY } from "@/cards/card-registry";
import {
  STACK_CARD_KINDS,
  CARD_KIND_BY_STACK_CARD_KIND,
} from "@/lib/stack/card-kinds";
import type { StackItem } from "@/lib/stack/types";

afterEach(cleanup);

function cardItem(cardKind: string): StackItem {
  return {
    id: `i-${cardKind}`,
    capturedAt: new Date().toISOString(),
    payload: { kind: "card", card: { cardKind, data: {} } },
  } as unknown as StackItem;
}

describe("stack thumbnail kind label (task 861)", () => {
  it("a todo card reads the registry's 'Task', in the header and the a11y text", () => {
    const todo = cardItem("todo");
    (todo.payload as unknown as { card: { data: { text: string } } }).card.data.text = "buy milk";
    render(<StackThumbnail item={todo} onRemove={() => {}} />);
    const el = document.querySelector("[data-stack-thumb-id]") as HTMLElement;
    expect(el.getAttribute("aria-description")).toMatch(/^Task · /);
    expect(el.textContent).toContain("Task");
    expect(el.textContent).not.toContain("TODO");
  });

  it("every stack card kind's label IS its registry label", () => {
    for (const k of STACK_CARD_KINDS) {
      const reg = CARD_REGISTRY[CARD_KIND_BY_STACK_CARD_KIND[k]];
      expect(reg.stackable, k).toBe(true);
      expect(stackItemKindLabel(cardItem(k)), k).toBe(reg.label);
    }
  });

  it("no raw-id uppercasing survives in the thumbnail source", () => {
    const src = readFileSync(
      resolve(__dirname, "../StackThumbnail.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/cardKind\.toUpperCase\(\)/);
  });
});
