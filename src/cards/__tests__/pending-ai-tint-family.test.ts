/**
 * Task 1066 — the pending-AI blue is ONE colour, so it is ONE family.
 *
 * `PENDING_AI_TINT` (legacy-token-crosswalk.ts) is "the one light-blue every
 * PENDING-AI signal paints in" (Gabriel, 2026-07-03). The band and the
 * open-request wash read it in TS; but the chrome that FRAMES the same signal
 * restated it by hand in CSS/className — the two pending-change navigators in
 * `sky-200` (h≈231, cyan-leaning) beside a blue-200 band (h≈254), the
 * delete-mode strike as a bare `#60a5fa`. A TS constant cannot be read by CSS,
 * so every CSS site re-spelled it.
 *
 * The fix is a `--pending-ai-*` family in `globals.css`. This census pins:
 *   1. the CSS tint ≡ the TS constant (the two sources cannot drift);
 *   2. every pending-AI chrome site reads the family, never a palette literal;
 *   3. the family's hexes are spelled once — nowhere else in `globals.css`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cssCommentsStripped } from "@/lib/__tests__/_source-scan";
import { PENDING_AI_TINT } from "@/cards/legacy-token-crosswalk";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
const CSS = cssCommentsStripped(read("src/app/globals.css"));

function declared(name: string): string {
  const m = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(CSS);
  if (!m) throw new Error(`${name} is not declared in globals.css`);
  return m[1].trim();
}

describe("pending-AI tint family (task 1066)", () => {
  it("--pending-ai-tint is the TS constant PENDING_AI_TINT, byte for byte", () => {
    expect(declared("--pending-ai-tint").toLowerCase()).toBe(PENDING_AI_TINT.toLowerCase());
  });

  it("the navigator edge derives from the tint, so it cannot leave the band's hue", () => {
    expect(declared("--pending-ai-edge")).toBe("var(--pending-ai-tint)");
    expect(declared("--pending-ai-ink")).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("the delete-mode strike reads --pending-ai-ink", () => {
    const m = /\.linked-anchor\[data-pending-delete="true"\]\s*\{([^}]*)\}/.exec(CSS);
    expect(m, "delete-mode strike rule").not.toBeNull();
    expect(m![1]).toMatch(/text-decoration-color:\s*var\(--pending-ai-ink\)/);
  });

  /** Every chrome site that frames an applied AI change. A new navigator joins
   *  this list; it does not pick its own blue. */
  const NAVIGATORS: { file: string; marker: string }[] = [
    { file: "src/components/PendingChangePill.tsx", marker: "PendingChangePillBody" },
    { file: "src/panels/Omni/OmniViewPanel.tsx", marker: "Pending change navigator" },
  ];

  for (const { file, marker } of NAVIGATORS) {
    it(`${file}: the pending-change navigator reads --pending-ai-edge, no palette blue`, () => {
      const src = read(file);
      expect(src, `${file} no longer contains its navigator marker`).toContain(marker);
      expect(src).toContain("border-[var(--pending-ai-edge)]");
      expect(src).not.toMatch(/\b(?:border|bg|text|ring)-(?:sky|blue|cyan)-\d{2,3}\b/);
    });
  }

  it("the family's hexes are spelled once in globals.css (their declarations)", () => {
    for (const hex of [PENDING_AI_TINT, declared("--pending-ai-ink")]) {
      const hits = CSS.toLowerCase().split(hex.toLowerCase()).length - 1;
      expect(hits, `${hex} restated outside the --pending-ai-* family`).toBe(1);
    }
  });
});
