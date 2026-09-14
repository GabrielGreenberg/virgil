// @vitest-environment jsdom
/**
 * THE INNER LIBRARY STRIP TAKES THE SHARED LADDER (task 2026-09-13-561).
 *
 * This strip pioneered the compress-then-scroll ladder ("F#15") and kept it
 * private: a tab-level floor, a `scrollLeft` nudge written inline, and an
 * `overflow-x: hidden` strip that only the nudge could scroll. The ladder is
 * `src/components/chrome/tab-strip-occupancy.ts` now and this strip READS it —
 * which is also what makes it USER-scrollable for the first time (Gabriel's
 * "scroll left/right like Chrome/Safari" is unmet on both strips otherwise).
 *
 * The one behavioural fix this file pins beyond the adoption: the strip's
 * drop indicator is an absolutely-positioned child of a SCROLL CONTAINER, so
 * its `left` is in scrolled coordinates while the tab rects it is placed from
 * are viewport rects — at any non-zero scrollLeft it painted `scrollLeft` px
 * too far left. Latent while only the nudge could scroll the strip; live the
 * moment the user can.
 */

import { describe, it, expect, afterEach, beforeAll } from "vitest";
import { createRef } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { PanelTabStrip, type TabDef } from "@library/components/panel-tabs/PanelTabStrip";
import { TAB_DT_TYPE } from "@library/lib/dnd-types";
import {
  TAB_LABEL_ATTR,
  TAB_LABEL_FLOOR_MIN_WIDTH,
} from "@/components/chrome/tab-strip-occupancy";

const TABS: TabDef[] = [
  { id: "central", label: "Central", closable: false, renamable: false },
  { id: "custom-a", label: "Reading list", closable: true, renamable: true },
  { id: "custom-b", label: "Coherence sources", closable: true, renamable: true },
];
const noop = () => {};

beforeAll(() => {
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});
afterEach(cleanup);

function renderStrip(activeId = "central") {
  const panelRef = createRef<HTMLDivElement>();
  const view = render(
    <PanelTabStrip
      panel="left"
      tabs={TABS}
      activeId={activeId}
      recentLibraries={[]}
      onActivate={noop}
      onClose={noop}
      onRename={noop}
      onCreate={() => "new"}
      onOpenRecent={noop}
      onMoveTab={noop}
      onDropEntries={noop}
      panelRef={panelRef}
    />,
  );
  const strip = view.container.firstElementChild as HTMLElement;
  return { ...view, strip };
}

describe("the inner strip on the shared ladder", () => {
  it("is a real SCROLLER now: overflow-x auto, overflow-y hidden, scrollbar hidden — with the seam pair intact", () => {
    const { strip } = renderStrip();
    expect(strip.style.overflowX).toBe("auto");
    expect(strip.style.overflowY).toBe("hidden");
    expect(strip.style.scrollbarWidth).toBe("none");
    // The task-324 seam pair keeps the active tab's 1px overhang inside the
    // clip; a scroller that lost it would eat the seam.
    expect(strip.style.marginBottom).toBe("-1px");
    expect(strip.style.padding).toMatch(/1px$/);
  });

  it("every inactive label carries the shared FLOOR and the label attribute; the active label the attribute", () => {
    const { strip } = renderStrip();
    const labels = Array.from(strip.querySelectorAll<HTMLElement>(`[${TAB_LABEL_ATTR}]`));
    expect(labels.map((l) => l.textContent)).toEqual(["Central", "Reading list", "Coherence sources"]);
    const [active, ...inactive] = labels;
    for (const l of inactive) {
      expect(l.tagName).toBe("BUTTON");
      expect(l.style.minWidth, `${l.textContent} lost the compression floor`).toBe(TAB_LABEL_FLOOR_MIN_WIDTH);
      expect(l.style.overflow).toBe("hidden");
      expect(l.style.textOverflow).toBe("ellipsis");
    }
    // The active tab RESISTS (flex 0 0 auto) — its label has no floor to
    // reach, but it is still a label the occupancy reader can see.
    expect(active.style.minWidth).not.toBe(TAB_LABEL_FLOOR_MIN_WIDTH);
  });

  it("inactive tabs no longer carry a chrome-blind tab-level floor (the tab's minimum is chrome + the label floor)", () => {
    const { strip } = renderStrip();
    const tab = strip.querySelector<HTMLElement>('[data-tab-id="custom-a"]')!;
    expect(tab.style.flex).toBe("1 1 auto");
    expect(tab.style.maxWidth).toBe("max-content");
    expect(tab.style.minWidth, "a tab-level literal floor overflows a pinned+menu tab at the floor").toBe("");
  });

  it("the drop indicator adds the strip's scrollLeft back (it lives in scrolled coordinates)", () => {
    const { strip } = renderStrip();
    strip.scrollLeft = 120;
    fireEvent.dragOver(strip, {
      dataTransfer: { types: [TAB_DT_TYPE], dropEffect: "none" },
      clientX: 0,
    });
    const indicator = Array.from(strip.children).find(
      (c) => (c as HTMLElement).style.position === "absolute" && (c as HTMLElement).style.width === "2px",
    ) as HTMLElement | undefined;
    expect(indicator, "a tab dragover paints the indicator").toBeDefined();
    // jsdom rects are all zero: the insertion index resolves to "after the
    // last tab", whose x is last.right − strip.left + 1 = 1; plus the 120 of
    // scroll the strip's own coordinate space is offset by.
    expect(indicator!.style.left).toBe("121px");
  });
});
