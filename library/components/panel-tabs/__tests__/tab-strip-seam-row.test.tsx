// @vitest-environment jsdom
import { createRef } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PanelTabStrip, type TabDef } from "../PanelTabStrip";

/**
 * THE RENDERED half of the seam-row contract (task 2026-08-09-324).
 *
 * `tab-chrome-contracts.test.ts` pins the same invariant in SOURCE. This file
 * exists because that is the exact gap the bug walked through: the pre-existing
 * contract asserted that the body's `1px solid var(--library-edge)` border
 * STRING was present, and stayed green for a year in which the border never
 * painted a single pixel of its top edge — because the tab strip's opaque
 * background covered that row. A string is not a render, and the element that
 * carries a style can be renamed, moved, or replaced by a class without any
 * source grep noticing.
 *
 * So this asserts the property on the element React ACTUALLY renders, found by
 * the structural fact that defines it — the negative bottom margin with which
 * it deliberately overlaps the body's border row.
 *
 * Honest about the tool: jsdom does NOT resolve custom properties, so
 * `getComputedStyle(strip).backgroundColor` is `rgba(0, 0, 0, 0)` for BOTH
 * `background: transparent` AND `background: var(--library-bg)` (empirically
 * verified). A computed-COLOR assertion would therefore pass on the broken
 * state — a vacuous test that looks like coverage, which is the same mistake
 * one layer down. The SPECIFIED value round-trips faithfully
 * (`el.style.background === "var(--library-bg)"`), so that is what is asserted.
 */

const TABS: TabDef[] = [
  { id: "central", label: "Central Library", closable: false, renamable: false },
  { id: "lib-a", label: "SEP Iconicity", closable: true, renamable: true },
];

function noop() {}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeAll(() => {
  // The strip's flush-right tuck measure is the one sanctioned RO in the tab
  // chrome; jsdom has no ResizeObserver.
  if (!("ResizeObserver" in globalThis)) {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function renderStrip(): HTMLElement {
  const panelRef = createRef<HTMLDivElement>();
  act(() => {
    root.render(
      <PanelTabStrip
        panel="left"
        tabs={TABS}
        activeId="central"
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
  });
  const strip = host.firstElementChild as HTMLElement | null;
  expect(strip, "the strip must render a root element").not.toBeNull();
  return strip!;
}

describe("rendered seam row — the strip overlaps the body border and paints nothing (task 324)", () => {
  it("the rendered strip IS the seam-overlapping box (it carries the -1px bottom margin)", () => {
    // The premise the rest of this file rests on: this element's own box
    // reaches 1px into the body's border row, so whatever it paints lands
    // ON that row. If this ever stops being true the invariant below is
    // being asserted about the wrong element.
    const strip = renderStrip();
    expect(strip.style.marginBottom).toBe("-1px");
    expect(strip.style.padding).toMatch(/1px$/); // the 1px bottom padding row
  });

  it("the rendered strip specifies NO painting background", () => {
    const strip = renderStrip();
    const specified = strip.style.background || strip.style.backgroundColor;
    expect(
      ["", "transparent", "none"],
      `The tab strip rendered background "${specified}". An element that ` +
        `overlaps the body's 1px top border so its ACTIVE-TAB CHILD can cover ` +
        `that row under the tab's footprint must paint nothing itself — CSS ` +
        `backgrounds fill the padding box, so this erases the manila page ` +
        `outline under every inactive tab, in the inter-tab gaps, along the ` +
        `tail, and through the swoop-foot valleys (task 324). The field is ` +
        `painted once by the panel container above.`,
    ).toContain(specified);
  });

  it("the rendered INACTIVE tab paints no field of its own either (the border shows under it)", () => {
    // Inactive tabs are deliberately flat (task 048) — a `BackgroundTab` div
    // with no silhouette. The line under them IS the body's top border, which
    // only works while nothing between them and it paints.
    const strip = renderStrip();
    const inactive = strip.querySelector<HTMLElement>('[data-tab-id="lib-a"]');
    expect(inactive, "the inactive tab must render").not.toBeNull();
    expect(["", "transparent"]).toContain(inactive!.style.background);
  });

  it("the ACTIVE tab's chrome is the one thing above the border, and only over its own footprint", () => {
    // Its wrapper overlaps the seam by the geometry constant and is itself
    // unpainted; the fill comes from the FolderTabChrome children (caps'
    // bridge rects + the middle div), whose box is the tab. That is what
    // merges the tab into the page without a seam line while the border
    // continues beside it.
    const strip = renderStrip();
    const active = strip.querySelector<HTMLElement>('[data-tab-id="central"]');
    expect(active, "the active tab must render").not.toBeNull();
    expect(active!.style.marginBottom).toBe("-1px");
    expect(["", "transparent"]).toContain(active!.style.background);
    const middle = Array.from(active!.querySelectorAll<HTMLElement>("div")).find(
      (el) => el.style.borderTop.includes("1px solid"),
    );
    expect(
      middle?.style.background,
      "the active tab's stretchable middle carries the manila fill",
    ).toContain("var(--surface");
  });
});
