// @vitest-environment jsdom
//
// The strip reorder commits an IDENTITY, not an index (task 440).
//
// ## What this pins, and why no pre-440 suite could see it
//
// The strip drag ends by resolving which RENDERED button the cursor is above.
// The rendered strip is a PROJECTION of `prefs.placements` —
// `filterPanelKinds(chrome, …)` narrows it by `chrome.visiblePanelKinds` — so a
// count taken off the DOM is not an index into the model. `movePanel` used to
// take that count and `splice` it into every placement on the side; the two
// spaces coincided only while nothing filtered the strip.
//
// `READER_CHROME.visiblePanelKinds` was the six reading panels, and the shipped
// LEFT placement order opens with `search`, which was NOT in that whitelist. So
// the Library Reader rendered 5 icons over a 6-entry list and every DOM index k
// addressed model index k+1: EVERY drop below the first gap landed one slot
// early, in the direction the user did not aim.
//
// TASK 485 whitelisted `search` INTO the Reader, so the shipped Reader's LEFT
// strip now renders every left placement and is no longer a filtered projection
// at all. The property under test is about ANY filtered projection — a
// whitelist, a per-doc hide, a search filter — so the left case keeps the
// PRE-485 Reader list as a synthetic divergent whitelist rather than being
// deleted with the one host that happened to exhibit it. Each case still
// ASSERTS its own divergence, so a fixture that stopped diverging fails loudly
// instead of passing vacuously.
//
// Every pre-440 `movePanel` fixture drives the FULL placement list — the main
// app's `FULL_CHROME` passes no whitelist — where the projection and the model
// are the same list by construction and the divergence is unrepresentable. That
// is how this shipped.
//
// The legs below therefore drive the REAL `useViewPrefs` engine (ephemeral
// mode, the same engine the Reader mounts) through the REAL `movePanel`, over
// the REAL shipped defaults and the REAL Reader whitelist, and SWEEP every gap
// on both sides rather than pinning one. The defect legs reimplement the
// RETIRED integer rule locally rather than re-parameterising the live one, so
// they fail for the reason they name instead of by arithmetic identity.
import { describe, it, expect, afterEach, beforeAll, beforeEach, vi } from "vitest";

const WINDOW_ID = "test-window";
vi.mock("@/lib/multi-window/window-id", () => ({ getWindowId: () => WINDOW_ID }));
// useViewPrefs transitively pulls `@/lib/storage` (see the
// vitest_extension_barrel_storage_mock memo).
vi.mock("@/lib/storage", () => ({ isDevStorage: false }));
vi.mock("@/lib/multi-window/bus", () => ({
  publish: () => {},
  subscribe: () => () => {},
}));

import { render, cleanup, act } from "@testing-library/react";
import { useViewPrefs, type PanelId, type Side } from "../useViewPrefs";
import { READER_CHROME, filterPanelKinds } from "@/components/editor-layout/chrome-config";
import { panelSidesFromPlacements, resolvePanelSide } from "@/lib/panel-side";
import { PANEL_REGISTRY } from "@/panels/panel-registry";
import type { PanelKind } from "@/panels/_shared/types";

interface Placement {
  id: string;
  side: Side;
}

function installStorageShim(name: "localStorage" | "sessionStorage") {
  const store = new Map<string, string>();
  Object.defineProperty(window, name, {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
}

/** Capture the live hook return so a leg can drive `movePanel` and read
 *  `prefs.placements` back. */
function mountPrefs(): { vp: () => ReturnType<typeof useViewPrefs> } {
  let live: ReturnType<typeof useViewPrefs> | null = null;
  function Harness() {
    live = useViewPrefs({ persistence: "ephemeral" });
    return null;
  }
  render(<Harness />);
  return { vp: () => live! };
}

// ── The projection under test's premise ─────────────────────────────────────
// Exactly what `EditorPane` renders into a strip: the chrome whitelist, then
// this side's panels in PLACEMENT order, then any visible-but-unplaced kind as
// a tail (`orderedSidePanels`). Built from the REAL helpers so a change to the
// side ladder or the whitelist moves this with it.
function renderedStrip(
  placements: readonly Placement[],
  side: Side,
  whitelist: PanelKind[] | undefined,
): PanelKind[] {
  const chrome = { ...READER_CHROME, visiblePanelKinds: whitelist };
  const all = (whitelist ?? (Object.keys(PANEL_REGISTRY) as PanelKind[])) as PanelKind[];
  const visible = new Set(
    filterPanelKinds(chrome, all).filter(
      (k) => resolvePanelSide(k, panelSidesFromPlacements(placements)) === side,
    ),
  );
  const out: PanelKind[] = [];
  for (const p of placements) {
    if (p.side === side && visible.has(p.id as PanelKind)) {
      out.push(p.id as PanelKind);
      visible.delete(p.id as PanelKind);
    }
  }
  for (const k of all) if (visible.has(k)) out.push(k);
  return out;
}

/** The RETIRED rule, restated locally: count the gap off the RENDERED strip
 *  (with the dragged icon filtered out, as the gesture's snapshot does) and
 *  splice that integer into the full placements list for the side. */
function movePanelByRenderedIndex(
  placements: readonly Placement[],
  id: PanelId,
  toSide: Side,
  domIndex: number,
): Placement[] {
  const filtered = placements.filter((pl) => pl.id !== id);
  const same = filtered.filter((pl) => pl.side === toSide);
  const other = filtered.filter((pl) => pl.side !== toSide);
  same.splice(Math.min(domIndex, same.length), 0, { id, side: toSide });
  return [...other, ...same];
}

const READER_WHITELIST: PanelKind[] = [...READER_CHROME.visiblePanelKinds!];

/** The PRE-485 Reader list — the shipped whitelist minus `search`, which task
 *  485 added. `search` sits at LEFT index 0 in the shipped placements, so
 *  hiding it is exactly the shape that made every DOM index off-by-one: the
 *  historical fixture, kept because the RULE is about any filtered projection
 *  and not about one host's membership list. */
const LEFT_FILTERED_WHITELIST: PanelKind[] = READER_WHITELIST.filter(
  (k) => k !== "search",
);

/** The two sides, each with a whitelist that genuinely DIVERGES from the model.
 *
 *  LEFT is the pre-485 Reader case verbatim (`search`, left index 0, was not a
 *  reading panel then). The Reader's whitelist leaves only ONE panel on the RIGHT,
 *  which has no gaps to sweep — so the right case uses the Reader's six plus
 *  two more right-side kinds, which hides `wordcount` (right index 0) above
 *  them. That is the same shape, not a different rule: any whitelist, per-doc
 *  hide or search filter produces it, which is the whole reason the drop must
 *  stop speaking in indices. Each case ASSERTS its own divergence below rather
 *  than assuming it. */
const CASES = [
  { side: "left" as const, whitelist: LEFT_FILTERED_WHITELIST },
  {
    side: "right" as const,
    whitelist: [...READER_WHITELIST, "todo", "cutter"] as PanelKind[],
  },
];

describe("movePanel resolves a drop by IDENTITY, not by rendered index", () => {
  beforeAll(() => {
    installStorageShim("localStorage");
    installStorageShim("sessionStorage");
  });
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  for (const { side, whitelist } of CASES) {
    it(`the ${side} fixture really is the divergent shape (the premise, not an assumption)`, () => {
      const { vp } = mountPrefs();
      const placements = vp().prefs.placements as Placement[];
      const model = placements.filter((p) => p.side === side).map((p) => p.id);
      const rendered = renderedStrip(placements, side, whitelist);
      // The strip is SHORTER than the model list, and the first hidden panel
      // sits ABOVE a rendered one — so the offset is non-zero from index 0 and
      // every gap below the first is addressed wrongly by a count.
      expect(rendered.length).toBeLessThan(model.length);
      expect(model.indexOf(rendered[0] as string)).toBeGreaterThan(0);
    });

    it(`sweeps every gap on the ${side} strip: the icon lands in the gap the user aimed at`, () => {
      const { vp } = mountPrefs();
      const base = vp().prefs.placements as Placement[];
      const strip = renderedStrip(base, side, whitelist);
      expect(strip.length).toBeGreaterThan(1); // the sweep must have gaps to cross

      let crossedAGapBelowTheFirst = false;

      for (const dragged of strip) {
        // The gesture's snapshot filters the dragged icon out of its OWN side,
        // so the landing targets are the OTHER rendered icons plus "append".
        const targets = strip.filter((k) => k !== dragged);
        for (let gap = 0; gap <= targets.length; gap++) {
          const beforeId = (targets[gap] ?? null) as PanelId | null;
          if (gap > 0) crossedAGapBelowTheFirst = true;

          // Re-mount so every gap is measured from the shipped defaults.
          cleanup();
          const fresh = mountPrefs();
          act(() => {
            fresh.vp().movePanel(dragged as PanelId, side, beforeId);
          });
          const after = fresh.vp().prefs.placements as Placement[];

          const expected = [...targets];
          expected.splice(gap, 0, dragged);
          expect(renderedStrip(after, side, whitelist)).toEqual(expected);

          // …and the whitelisted-OUT panels are left exactly where they were:
          // the user reordered the strip, not the model behind it.
          const hidden = (pls: Placement[]) =>
            pls
              .filter((p) => p.side === side && !strip.includes(p.id as PanelKind))
              .map((p) => p.id);
          expect(hidden(after)).toEqual(hidden(base));
        }
      }

      expect(crossedAGapBelowTheFirst).toBe(true);
    });
  }

  it("DEFECT: the retired rendered-index rule lands every filtered drop one slot early", () => {
    const { vp } = mountPrefs();
    const base = vp().prefs.placements as Placement[];
    const strip = renderedStrip(base, "left", LEFT_FILTERED_WHITELIST);

    // The task's worked example first, spelled out: drop `outline` into the
    // gap between `citations` and `bibliography`.
    // Annotated: TS infers a narrowing predicate for a `!== <literal>` filter,
    // which would type this as `Exclude<PanelKind, "outline">[]`.
    const targets: PanelKind[] = strip.filter((k) => k !== "outline");
    const gap = targets.indexOf("bibliography" as PanelKind);
    expect(gap).toBeGreaterThan(0);
    const expected = [...targets];
    expected.splice(gap, 0, "outline" as PanelKind);

    const retiredStrip = renderedStrip(
      movePanelByRenderedIndex(base, "outline", "left", gap),
      "left",
      LEFT_FILTERED_WHITELIST,
    );
    expect(retiredStrip).not.toEqual(expected);
    // One slot early, by exactly the number of hidden panels above the gap
    // (`search`, left index 0, is the only one).
    expect(retiredStrip.indexOf("outline" as PanelKind)).toBe(gap - 1);

    // …and it is not one unlucky gap: the retired rule is wrong at EVERY gap
    // below the first, for every icon, on the shipped Reader strip.
    let checked = 0;
    for (const dragged of strip) {
      const t = strip.filter((k) => k !== dragged);
      for (let g = 1; g <= t.length; g++) {
        const got = renderedStrip(
          movePanelByRenderedIndex(base, dragged as PanelId, "left", g),
          "left",
          LEFT_FILTERED_WHITELIST,
        );
        expect(got.indexOf(dragged)).toBe(g - 1);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);

    // The live path, over the same gesture, lands where the user aimed.
    act(() => {
      vp().movePanel("outline", "left", targets[gap] as PanelId);
    });
    expect(
      renderedStrip(vp().prefs.placements as Placement[], "left", LEFT_FILTERED_WHITELIST),
    ).toEqual(expected);
  });

  it("NON-REGRESSION: with no whitelist the identity path is byte-identical to the retired index path", () => {
    const { vp } = mountPrefs();
    const base = vp().prefs.placements as Placement[];

    for (const side of ["left", "right"] as const) {
      const strip = renderedStrip(base, side, undefined);
      for (const dragged of strip) {
        const targets = strip.filter((k) => k !== dragged);
        for (let gap = 0; gap <= targets.length; gap++) {
          const beforeId = (targets[gap] ?? null) as PanelId | null;

          cleanup();
          const fresh = mountPrefs();
          act(() => {
            fresh.vp().movePanel(dragged as PanelId, side, beforeId);
          });
          const live = fresh.vp().prefs.placements as Placement[];
          const retired = movePanelByRenderedIndex(base, dragged as PanelId, side, gap);
          expect(live).toEqual(retired);
        }
      }
    }
  });

  it("a cross-side move appends when the drop names no icon, and lands in front of one when it does", () => {
    const { vp } = mountPrefs();
    // `notes` ships on the RIGHT; drag it to the LEFT strip.
    act(() => {
      vp().movePanel("notes", "left", null);
    });
    let left = (vp().prefs.placements as Placement[])
      .filter((p) => p.side === "left")
      .map((p) => p.id);
    expect(left[left.length - 1]).toBe("notes");
    expect(left.filter((id) => id === "notes")).toHaveLength(1);

    act(() => {
      vp().movePanel("notes", "left", "footnotes");
    });
    left = (vp().prefs.placements as Placement[])
      .filter((p) => p.side === "left")
      .map((p) => p.id);
    expect(left[left.indexOf("footnotes") - 1]).toBe("notes");
    expect(left.filter((id) => id === "notes")).toHaveLength(1);
  });

  it("resolve-or-append: an id no longer on that side degrades to append rather than throwing", () => {
    const { vp } = mountPrefs();
    // `notes` is on the RIGHT — naming it as the LEFT strip's landing target is
    // exactly what a peer window's concurrent reorder (or a visible-but-unplaced
    // tail kind, which has no placement row at all) produces.
    act(() => {
      vp().movePanel("outline", "left", "notes");
    });
    const left = (vp().prefs.placements as Placement[])
      .filter((p) => p.side === "left")
      .map((p) => p.id);
    expect(left[left.length - 1]).toBe("outline");
  });
});
