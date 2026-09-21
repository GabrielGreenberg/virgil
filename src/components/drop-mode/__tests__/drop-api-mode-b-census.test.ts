/**
 * Task 698 — every drop adapter ANSWERS what a re-anchor does to the card's
 * Mode-B anchor.
 *
 * `ParagraphAnchorApi.modeB` is required, so the compiler already refuses an
 * adapter that forgets it. This census pins the other half: it enumerates the
 * `drop*Api` literals in `EditorPane.tsx` (the ONE wiring site) and requires
 * each to state its answer — `releaseModeB(…)`, or `policy: "intrinsic"` with
 * a `why` — and cross-checks that count against the `ParagraphAnchorApi`
 * slots `DropModeProvider` declares, so a new panel's adapter cannot be wired
 * somewhere this census does not look. Pre-698 the capability was an optional
 * `clearModeB?`: notes supplied it, highlights declared its absence, and five
 * adapters silently lacked it.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..", "..");
const EDITOR_PANE = readFileSync(
  join(ROOT, "src/components/EditorPane.tsx"),
  "utf8",
);
const PROVIDER = readFileSync(
  join(ROOT, "src/components/drop-mode/DropModeProvider.tsx"),
  "utf8",
);

/** Each `const drop<Name>Api = useMemo(` literal, sliced to its deps array. */
function dropApiLiterals(src: string): Array<{ name: string; body: string }> {
  const out: Array<{ name: string; body: string }> = [];
  const re = /const (drop\w+Api) = useMemo\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const end = src.indexOf("\n  );", m.index);
    out.push({ name: m[1], body: src.slice(m.index, end) });
  }
  return out;
}

describe("drop-api Mode-B census (task 698)", () => {
  const literals = dropApiLiterals(EDITOR_PANE);

  it("finds one adapter per ParagraphAnchorApi slot the provider declares", () => {
    const slots = PROVIDER.match(/^\s+\w+\?: ParagraphAnchorApi;/gm) ?? [];
    expect(slots.length).toBeGreaterThanOrEqual(7);
    expect(literals.map((l) => l.name).sort()).toHaveLength(slots.length);
  });

  it.each(dropApiLiterals(EDITOR_PANE).map((l) => [l.name, l.body]))(
    "%s states its Mode-B answer",
    (_name, body) => {
      const releases = /modeB: releaseModeB\(/.test(body);
      const intrinsic =
        /policy: "intrinsic"/.test(body) && /why: "[^"]{10,}"/.test(body);
      expect(releases || intrinsic).toBe(true);
    },
  );

  it("the ONLY declared exemption is highlights", () => {
    const exempt = literals
      .filter((l) => /policy: "intrinsic"/.test(l.body))
      .map((l) => l.name);
    expect(exempt).toEqual(["dropHighlightsApi"]);
  });
});
