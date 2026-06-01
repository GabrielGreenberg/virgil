import { describe, expect, it } from "vitest";
import { POPOUT_MAX_VH, capPopoutHeight } from "../text-object-registry";

// Issue-13: a lifted-section popout was spawned at ~the section's full visible
// height and ran off the bottom of the screen. The fix imposes a GENERAL
// viewport-fraction cap on the captured source height at the single capture
// site (`TextObjectGrabHandle`), shared with `FloatingCards`' auto-fit grow
// cap via `capPopoutHeight`. These tests pin the policy value and prove the
// two safety properties the fix relies on: the cap is a MAX (short content is
// untouched), and a capped popout + its chrome + the spawn-fit margins always
// fit on screen (so a valid on-screen spawn-Y exists).

// Popout chrome added on top of the capped source height by the release spawn
// (TextObjectGrabHandle): POPOUT_HEADER_HEIGHT 24 + 2*POPOUT_BODY_PADDING_Y 32
// + 2*POPOUT_BORDER 2 = 58. The spawn-Y clamp keeps SPAWN_FIT_MARGIN (20) of
// inset at top AND bottom.
const POPOUT_CHROME = 24 + 2 * 16 + 2 * 1; // = 58
const SPAWN_FIT_MARGIN = 20;

const VIEWPORTS = [600, 700, 768, 900, 1024, 1080, 1200, 1400, 1600, 2000];

describe("POPOUT_MAX_VH", () => {
  it("is the user-chosen comfortable viewport fraction (50–60%)", () => {
    expect(POPOUT_MAX_VH).toBe(0.55);
    expect(POPOUT_MAX_VH).toBeGreaterThanOrEqual(0.5);
    expect(POPOUT_MAX_VH).toBeLessThanOrEqual(0.6);
  });
});

describe("capPopoutHeight", () => {
  it("is a MAX, not a floor — short content is returned unchanged", () => {
    // 100px of content is far below the cap at any realistic viewport, so it
    // must pass through untouched (no minimum height imposed).
    expect(capPopoutHeight(100, 900)).toBe(100);
    expect(capPopoutHeight(10, 2000)).toBe(10);
    // Exactly at the cap is unchanged too.
    const cap900 = Math.floor(900 * POPOUT_MAX_VH); // 495
    expect(capPopoutHeight(cap900, 900)).toBe(cap900);
    expect(capPopoutHeight(cap900 - 1, 900)).toBe(cap900 - 1);
  });

  it("clamps tall content to floor(viewport * POPOUT_MAX_VH)", () => {
    // The real dev-doc multi-page section "Digital Remediation" measured an
    // extent of 2673 at an innerHeight of 900 (live measurement); pre-fix it
    // spawned a 926px window (off the bottom of the 900px viewport). Capped:
    expect(capPopoutHeight(2673, 900)).toBe(495); // floor(900*0.55)
    expect(capPopoutHeight(5000, 1200)).toBe(660); // floor(1200*0.55)
    for (const vh of VIEWPORTS) {
      expect(capPopoutHeight(Number.MAX_SAFE_INTEGER, vh)).toBe(
        Math.floor(vh * POPOUT_MAX_VH),
      );
    }
  });

  it("guarantees a capped popout + chrome + margins fits on screen", () => {
    // The spawn-Y clamp can only keep the window on screen if a valid Y
    // exists, i.e. windowHeight <= viewport - 2*margin. The worst case is the
    // tallest possible capped lift popout: cap + chrome.
    for (const vh of VIEWPORTS) {
      const cappedSource = capPopoutHeight(Number.MAX_SAFE_INTEGER, vh);
      const windowHeight = cappedSource + POPOUT_CHROME;
      expect(windowHeight + 2 * SPAWN_FIT_MARGIN).toBeLessThanOrEqual(vh);
    }
  });
});
