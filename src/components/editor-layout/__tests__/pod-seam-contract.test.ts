import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { cssCommentsStripped, commentsStripped } from "@/lib/__tests__/_source-scan";

/**
 * The pod SEAM contract (task 329) — separation between a raised pod and the
 * card lane behind it is ELEVATION plus a thin canvas seam, never a wide
 * field-colored band.
 *
 * The bug this pins: `--pod-gap` was answering two questions — how wide is a
 * *gutter*, and how much canvas shows over a *lower layer* — and only the
 * first had an owner. So the seam was spelled three ways in one file
 * (`var(--pod-gap)` at the band bottom, a hard-coded `10` fade below it, a
 * hard-coded `10 + 14` gradient at the column edge), and where two of them
 * overlapped — a docked pod whose bottom edge sits near the column bottom —
 * they SUMMED to ~44px of opaque desk between the pod and the cards behind
 * it. Eleven times the deck's own 4px MIN_GAP. Nothing failed; three
 * independently reasonable values simply stacked.
 *
 * So the leg with teeth here is the CENSUS. `--pod-seam` was never the part
 * that could misbehave — a painter that spells its own copy is, and a copy is
 * invisible to types, to the radius lint, and to every other guard in this
 * directory. A hit is ROUTE-it-through-the-token, never an allowlist entry.
 *
 * Comments are stripped and string literals KEPT at every needle: this file's
 * values live in inline-style strings, so blanking literals would make every
 * leg vacuous (the mistake `_source-scan` exists to stop being re-made).
 */
const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const globals = readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");
const panelColumn = commentsStripped(
  readFileSync(
    path.join(ROOT, "src/components/editor-layout/panel-column.tsx"),
    "utf8",
  ),
);
const styleGuide = readFileSync(path.join(ROOT, "src/STYLE_GUIDE.md"), "utf8");

/** First `:root` value a token is given, in px. */
function tokenPx(name: string): number {
  const m = cssCommentsStripped(globals).match(
    new RegExp(`${name}\\s*:\\s*([0-9.]+)px\\s*;`),
  );
  if (!m) throw new Error(`token ${name} not found as a px value`);
  return parseFloat(m[1]);
}

/**
 * The greatest DOWNWARD reach of a multi-layer box-shadow token, in px: per
 * layer, `offset-y + blur / 2 + spread` (a Gaussian blur of B extends ~B/2
 * past the shadow's own edge). This is the arithmetic `--pod-seam`'s comment
 * states, re-derived here from the LIVE token rather than restated — if the
 * shadow tier moves, this test moves with it and the seam must follow.
 */
function shadowDownwardReach(name: string): number {
  const decl = cssCommentsStripped(globals).match(
    new RegExp(`${name}\\s*:\\s*([^;]+);`),
  );
  if (!decl) throw new Error(`token ${name} not found`);
  let worst = 0;
  for (const layer of decl[1].split(/,(?![^(]*\))/)) {
    // Drop the color (any notation) and the `inset` keyword; what remains is
    // the length list, where a bare `0` is a length too — which is exactly
    // why this can't be a `/([0-9.]+)px/g` sweep.
    const lengths = layer
      .replace(/[a-z]*\([^)]*\)/gi, " ")
      .replace(/#[0-9a-f]{3,8}/gi, " ")
      .replace(/\binset\b/gi, " ")
      .trim()
      .split(/\s+/)
      .filter((t) => /^-?[0-9.]+(px)?$/.test(t))
      .map(parseFloat);
    if (lengths.length < 3) continue; // x, y, blur[, spread]
    worst = Math.max(worst, lengths[1] + lengths[2] / 2 + (lengths[3] ?? 0));
  }
  return worst;
}

describe("pod seam — the width is DERIVED from the shadow it has to hold", () => {
  it("is at least the pod shadow's downward reach (no smudge onto the card below)", () => {
    // The docked pod paints --card-shadow-ambient (FloatingPanel's docked
    // branch). A seam narrower than that reach puts the shadow ON the card
    // behind it, which reads as a smear rather than a lift.
    expect(shadowDownwardReach("--card-shadow-ambient")).toBeGreaterThan(0);
    expect(tokenPx("--pod-seam")).toBeGreaterThanOrEqual(
      shadowDownwardReach("--card-shadow-ambient"),
    );
  });

  it("is no wider than it has to be — one px of slack, not a moat", () => {
    // The upper bound is the whole point. A seam free to grow is the defect
    // returning one value at a time; the only sanctioned reason to widen it is
    // a shadow that reaches further, which the lower bound already carries.
    expect(tokenPx("--pod-seam")).toBeLessThanOrEqual(
      Math.ceil(shadowDownwardReach("--card-shadow-ambient")) + 1,
    );
  });

  it("is thinner than the gutter it was split out of", () => {
    // --pod-gap stays the gutter (resize strip, column inset, band↔band desk).
    // If these two converge again the split has been undone by accident.
    expect(tokenPx("--pod-seam")).toBeLessThan(tokenPx("--pod-gap"));
  });

  it("the worst STACKED case can no longer reach the reported moat", () => {
    // A docked pod whose bottom edge sits near the column bottom is where the
    // band seam and the column-edge fade coincide — the ~44px Gabriel
    // photographed. Bound the SUM, not each half: bounding the halves alone is
    // exactly what let three reasonable values add up.
    const fade = panelColumn.match(
      /var\(--background\) var\(--pod-seam\), transparent calc\(var\(--pod-seam\) \+ (\d+)px\)/,
    );
    expect(fade, "ColumnEdgeFade must ramp from the seam token").not.toBeNull();
    const fadeVisible = tokenPx("--pod-seam") + parseFloat(fade![1]);
    expect(tokenPx("--pod-seam") + fadeVisible).toBeLessThanOrEqual(24);
  });
});

describe("pod seam — the census: no site re-spells the value", () => {
  it("the band-bottom strip takes its height from the token", () => {
    expect(panelColumn).toMatch(/height:\s*'var\(--pod-seam\)'/);
  });

  it("the column-edge fade takes its SOLID run from the token", () => {
    expect(panelColumn).toMatch(/var\(--background\) var\(--pod-seam\)/);
    // ...and no longer from --pod-gap, the spelling that made it a gutter.
    expect(panelColumn).not.toMatch(/var\(--background\) var\(--pod-gap\)/);
  });

  it("the field veil under a lone docked band stays deleted", () => {
    // A fade over a card that nothing is clipping is just a thinner moat. It
    // was also the third, hard-coded, spelling of this band — so its return is
    // both a visual regression and a re-fork.
    expect(panelColumn).not.toMatch(
      /linear-gradient\(to bottom, var\(--background\), transparent\)/,
    );
    expect(panelColumn).not.toMatch(/\blone\b/);
  });

  it("the band-bottom declaration names the token and not the gutter", () => {
    const at = panelColumn.indexOf("data-bottom-edge");
    expect(at).toBeGreaterThan(-1);
    const bandBottom = panelColumn.slice(at, at + 900);
    expect(bandBottom).toContain("var(--pod-seam)");
    expect(bandBottom).not.toContain("var(--pod-gap)");
  });
});

describe("pod seam — hit area is not the painted band", () => {
  it("thinning the paint did not thin the REACHABLE grab target", () => {
    // The seam below the last band is that band's ONLY resize handle, so
    // thinning the paint must not thin the grab. The measurement that matters
    // is the REACHABLE half, not the nominal box: the docked pod sits at
    // z-1001 directly above the strip and swallows the upward extension whole
    // (measured in the preview — a probe one pixel above the band's bottom
    // edge hits the panel card list). So the floor is `seam + bottom`, and it
    // is the 14px the pre-329 strip offered at 10px + 4.
    //
    // This leg's own first draft asserted the nominal `top + seam + bottom`
    // and passed at a genuinely smaller target — a grab that had quietly gone
    // 14 → 12 while the suite stayed green. Assert what the user can reach.
    const ext = panelColumn.match(
      /top:\s*-(\d+),\s*bottom:\s*-(\d+),\s*background:\s*'transparent'/,
    );
    expect(ext, "bottom-edge hit extension not found").not.toBeNull();
    const reachable = tokenPx("--pod-seam") + parseFloat(ext![2]);
    expect(reachable).toBeGreaterThanOrEqual(14);
  });
});

describe("pod seam — the prose says what the code ships", () => {
  it("STYLE_GUIDE names the token and states the derivation, not a magic number", () => {
    const at = styleGuide.indexOf("### The seam");
    expect(at, "STYLE_GUIDE is missing the seam rule").toBeGreaterThan(-1);
    const seam = styleGuide.slice(at);
    expect(seam).toContain("--pod-seam");
    expect(seam).toContain("--card-shadow-ambient");
    // The guide must state the SHIPPED value; a stale number here is the
    // `--header-h`-was-LOCKED-at-34px failure this suite's sibling exists for.
    expect(seam).toMatch(new RegExp(`rounded up to\\s+${tokenPx("--pod-seam")}\\b`));
  });
});
