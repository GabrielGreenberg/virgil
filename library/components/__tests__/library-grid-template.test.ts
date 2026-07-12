// Pins the LibraryView grid-track contract (R8 — layout owns the clamp
// composition): the reader column can never collapse to 0, the nav/list
// tracks carry their hard floors AND container-relative maxes IN the
// template, and the resizable tracks read the CSS vars the pane-resize
// engine retargets. If a future edit moves a constraint back into
// render-time JS (the non-reactive `window.innerWidth` clamp class), these
// assertions catch the template losing its authority.

import { describe, expect, it } from "vitest";
import {
  LEFT_MIN,
  LIB_GRID_GUTTER,
  LIB_GRID_TEMPLATE_2COL,
  LIB_GRID_TEMPLATE_3COL,
  LIB_LIST_W_VAR,
  LIB_NAV_W_VAR,
  NAV_MIN,
  READER_MIN,
} from "../library-grid-template";

describe("library grid-track templates (R8)", () => {
  it("the reader track is minmax(READER_MIN, 1fr) in both layouts — it can never collapse to 0", () => {
    const reader = `minmax(${READER_MIN}px, 1fr)`;
    expect(LIB_GRID_TEMPLATE_3COL.endsWith(reader)).toBe(true);
    expect(LIB_GRID_TEMPLATE_2COL.endsWith(reader)).toBe(true);
  });

  it("nav and list tracks are clamp()s over the engine's CSS vars with their min floors", () => {
    expect(LIB_GRID_TEMPLATE_3COL).toContain(
      `clamp(${NAV_MIN}px, var(${LIB_NAV_W_VAR},`,
    );
    expect(LIB_GRID_TEMPLATE_3COL).toContain(
      `clamp(${LEFT_MIN}px, var(${LIB_LIST_W_VAR},`,
    );
    expect(LIB_GRID_TEMPLATE_2COL).toContain(
      `clamp(${LEFT_MIN}px, var(${LIB_LIST_W_VAR},`,
    );
    // The 2-col layout has no navigator track.
    expect(LIB_GRID_TEMPLATE_2COL).not.toContain(LIB_NAV_W_VAR);
  });

  it("the maxes compose: nav reserves list+reader mins, list reserves the RESOLVED nav track + reader min", () => {
    // Nav's cap leaves room for the list and reader floors + both gutters —
    // so nav alone can never push the others below their mins.
    expect(LIB_GRID_TEMPLATE_3COL).toContain(
      `calc(100% - ${LEFT_MIN + READER_MIN + 2 * LIB_GRID_GUTTER}px)`,
    );
    // List's cap subtracts the nav track's WHOLE clamp expression (not a
    // constant), so nav+list can never sum past what leaves the reader its
    // minimum — the composition lives in layout, not in independent JS
    // clamps.
    expect(LIB_GRID_TEMPLATE_3COL).toContain(
      `calc(100% - clamp(${NAV_MIN}px,`,
    );
    expect(LIB_GRID_TEMPLATE_3COL).toContain(
      `- ${READER_MIN + 2 * LIB_GRID_GUTTER}px)`,
    );
    // 2-col: list reserves the reader min + the single gutter.
    expect(LIB_GRID_TEMPLATE_2COL).toContain(
      `calc(100% - ${READER_MIN + LIB_GRID_GUTTER}px)`,
    );
  });

  it("gutter tracks are the shared LIB_GRID_GUTTER width", () => {
    const gutter = ` ${LIB_GRID_GUTTER}px `;
    // 3-col has two gutter tracks, 2-col has one (split on the reader track
    // to avoid matching px values inside clamp()/calc() expressions).
    expect(
      LIB_GRID_TEMPLATE_3COL.split(`minmax(${READER_MIN}px`)[0].endsWith(gutter),
    ).toBe(true);
    expect(
      LIB_GRID_TEMPLATE_2COL.split(`minmax(${READER_MIN}px`)[0].endsWith(gutter),
    ).toBe(true);
  });
});
