// @vitest-environment jsdom
import { createRef } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PanelTabStrip, type TabDef } from "../PanelTabStrip";

/**
 * TASK 1211 — no per-tab UI id outlives its element.
 *
 * `editingId` (the rename box) and `tabMenuOpenId` (a tab's ⋮ menu) were
 * cleared only by that UI's own `onClose`, which a teardown never runs. A
 * rename box unmounted by an activation change (no blur) reopened, focused,
 * the next time its tab became active; a ⋮ menu whose tab left the strip came
 * back open when the same id was re-added.
 */

const MENU_LABEL = "Rename library…";
const CENTRAL: TabDef = { id: "central", label: "Central Library", closable: false, renamable: false };
const LIB: TabDef = {
  id: "lib-a",
  label: "SEP Iconicity",
  closable: true,
  renamable: true,
  menu: [{ label: MENU_LABEL, onClick() {} }],
};

function noop() {}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeAll(() => {
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

const panelRef = createRef<HTMLDivElement>();
function renderStrip(tabs: TabDef[], activeId: string) {
  act(() => {
    root.render(
      <PanelTabStrip
        panel="left"
        tabs={tabs}
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
  });
}

const flush = () => act(async () => { await Promise.resolve(); });
const renameBox = () => host.querySelector('input[aria-label="Tab name"]');
const menuShown = () => document.body.textContent?.includes(MENU_LABEL) ?? false;

describe("PanelTabStrip — per-tab ids end with their element (task 1211)", () => {
  it("a rename box torn down by an activation change does not reopen", async () => {
    renderStrip([CENTRAL, LIB], "lib-a");
    const label = Array.from(host.querySelectorAll("span")).find(
      (s) => s.textContent === LIB.label,
    )!;
    act(() => {
      label.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(renameBox()).not.toBeNull();
    // Activation moves away with NO blur (keyboard/programmatic switch).
    renderStrip([CENTRAL, LIB], "central");
    await flush();
    renderStrip([CENTRAL, LIB], "lib-a");
    await flush();
    expect(renameBox()).toBeNull();
  });

  it("a ⋮ menu whose tab left the strip is closed when the same id returns", async () => {
    renderStrip([CENTRAL, LIB], "lib-a");
    const trigger = host.querySelector('[aria-label="Library options"]') as HTMLElement;
    expect(trigger).not.toBeNull();
    act(() => trigger.click());
    expect(menuShown()).toBe(true);
    renderStrip([CENTRAL], "central");
    await flush();
    expect(menuShown()).toBe(false);
    renderStrip([CENTRAL, LIB], "central");
    await flush();
    expect(menuShown()).toBe(false);
  });

  it("a ⋮ menu whose tab's `menu` emptied stays closed when it refills", async () => {
    renderStrip([CENTRAL, LIB], "lib-a");
    act(() => (host.querySelector('[aria-label="Library options"]') as HTMLElement).click());
    expect(menuShown()).toBe(true);
    renderStrip([CENTRAL, { ...LIB, menu: [] }], "lib-a");
    renderStrip([CENTRAL, LIB], "lib-a");
    await flush();
    expect(menuShown()).toBe(false);
  });
});
