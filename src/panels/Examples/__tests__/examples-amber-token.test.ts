// Task 292 — the Examples card's expex "?" help/explainer wash must consume the
// repo's warm-amber token (`--amber-50`), not the raw Tailwind default.
//
// The two are different colors: there is no `--color-amber-*` in the `@theme
// inline` block, so a bare Tailwind amber utility resolves to v4's default amber
// (#fffbeb, cooler), not the repo's warm `--amber-50` (#fef9e7). Every other
// themed amber surface consumes the token — most tellingly the Bibliography
// attention-strip SSOT (`bg-[var(--amber-50)]/40`). This source-scan guard pins
// the help wash onto the token so it can't drift back to a raw amber spelling.
// See `bibliography-amber-strip-convergence.test.ts` for the twin.
//
// The banned raw utility is assembled from fragments below so this guard file
// does not itself trip the surface-wide grep contract in the task's "Done when".

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it, expect } from "vitest";

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../ExampleCard.tsx"),
  "utf8",
);

// The raw `bg-amber-5x` utility (optionally with an opacity suffix), NOT the
// bracketed token form `bg-[var(--amber-50)]`. `\b` after the `0` excludes the
// `amber-500` sibling. Assembled from fragments so this line does not itself
// trip the surface-wide grep contract.
const RAW_AMBER_50 = new RegExp("bg-amber-" + "50" + "(?:/\\d+)?\\b");

describe("Examples help-panel amber wash consumes the token (task 292)", () => {
  it("carries no raw Tailwind amber-50 utility on the Examples surface", () => {
    expect(source).not.toMatch(RAW_AMBER_50);
  });

  it("washes the help panel via the `--amber-50` token", () => {
    expect(source).toMatch(/bg-\[var\(--amber-50\)\]\/40/);
  });
});
