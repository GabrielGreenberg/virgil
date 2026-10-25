/**
 * RADIO MARK CENSUS (task 2026-10-25-1279).
 *
 * STYLE_GUIDE → Inputs: "Selection must never be signalled by colour (or a
 * border) alone." `useRadioGroup` owns a pick-one row's SEMANTICS
 * (`aria-checked`, roving tabindex, arrows); the `RadioMark` leaf owns its
 * VISUAL half — the shape cue that says which option is chosen. The doc-type
 * cards met the contract for screen readers and failed it for sighted users,
 * because the visual half was left to each consumer.
 *
 *  1. Every `useRadioGroup(` consumer renders `<RadioMark`.
 *  2. `RadioMark` is the one speller of `data-radio-mark`, so a consumer
 *     cannot satisfy the DOM pins with a hand-rolled attribute.
 *
 * (The DOM halves — exactly the checked option carries
 * `data-radio-mark="checked"` — live in `field-label-association.test.tsx`
 * and `collaborator-identity-dialog.test.tsx`; jsdom resolves no colours, so
 * the pin is structural.)
 *
 * Population: every tracked `.ts`/`.tsx` under `src/`, tests excluded.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, trackedFiles, commentsStripped } from "@/lib/__tests__/_source-scan";

const HOOK = "src/hooks/useRadioGroup.ts";
const MARK = "src/components/icons/RadioMark.tsx";

const SOURCES = trackedFiles("src", /\.tsx?$/)
  .map((abs) => path.relative(REPO_ROOT, abs))
  .filter((p) => !p.includes("/__tests__/") && !/\.test\.tsx?$/.test(p));

const code = (rel: string) =>
  commentsStripped(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

describe("RADIO MARK CENSUS", () => {
  const consumers = SOURCES.filter(
    (p) => p !== HOOK && /\buseRadioGroup\s*\(/.test(code(p)),
  );

  it("the population is real", () => {
    expect(consumers).toEqual(
      expect.arrayContaining([
        "src/components/NewDocumentModal.tsx",
        "src/components/CollaboratorIdentityDialog.tsx",
      ]),
    );
  });

  it("every useRadioGroup consumer renders the RadioMark", () => {
    const missing = consumers.filter((p) => !/<RadioMark\b/.test(code(p)));
    expect(
      missing,
      `pick-one row(s) with no shape cue for the chosen option — render <RadioMark checked={…}/> in each option: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("data-radio-mark has one speller, the RadioMark leaf", () => {
    const strays = SOURCES.filter(
      (p) => p !== MARK && /data-radio-mark/.test(code(p)),
    );
    expect(strays).toEqual([]);
  });
});
