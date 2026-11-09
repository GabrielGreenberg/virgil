// Task 1538 — CENSUS: a card row's key verb is declared ONCE, on the registry
// row, and every card-action surface builds its rows through the one
// decorator (`decorateCardRow`) that carries it. The defect this pins: the grab
// menu bound Backspace/Delete to Delete with a `row.id === "delete"` one-off
// in its own row mapping, while the ⚡ panel's hand-copied mapping bound
// nothing — so the same row painted "⌫" over a key that did nothing there.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cardActionRows } from "@/lib/actions/action-registry";

const ROOT = resolve(__dirname, "../../../..");
const VIEWS = ["src/components/DragHandleMenu.tsx", "src/components/ActionsMenuPanel.tsx"];

/** Comment-stripped source, so prose naming the old one-off doesn't trip it. */
function code(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("card-row key verb census (task 1538)", () => {
  it("the registry's Delete row declares its Backspace/Delete key verb", () => {
    for (const surface of ["grab", "lightning"] as const) {
      const del = cardActionRows(surface).find((r) => r.id === "delete");
      expect(del?.keyAliases).toEqual(["Backspace", "Delete"]);
    }
  });

  it("every card row whose painted letter is not a typeable key declares a key verb", () => {
    for (const surface of ["grab", "lightning"] as const) {
      for (const row of cardActionRows(surface)) {
        const typeable = !!row.letter && /^[A-Za-z0-9]$/.test(row.letter);
        if (!typeable) expect(row.keyAliases?.length, row.id).toBeGreaterThan(0);
      }
    }
  });

  it.each(VIEWS)("%s builds card rows through decorateCardRow, with no per-id key one-off", (rel) => {
    const src = code(rel);
    expect(src).toMatch(/\bdecorateCardRow\(/);
    // No view decides a row's behaviour by comparing its id to a literal.
    expect(src).not.toMatch(/\b(?:row|entry)\.id\s*===?\s*["']/);
    // No view spells key aliases itself — they come from the registry row.
    expect(src).not.toMatch(/\bletterAliases\s*:/);
  });
});
