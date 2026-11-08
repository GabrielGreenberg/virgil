// @vitest-environment jsdom
/**
 * A COLLAPSED right gutter (its width kept, its cards hidden) still publishes
 * its cards: OmniHost in `publishOnly` mode renders nothing — no card mounts,
 * no editor starts — but the omni card registry holds every card it built, so
 * the tool gutter opens a to-do row into the real card even when the right side
 * has been collapsed since mount.
 */
import { describe, expect, it, vi } from "vitest";

// jsdom has no ResizeObserver; the to-do card measures with one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);
vi.mock("../../contexts/editor-ref", () => ({
  useEditorRefContext: () => ({ editorInstance: null, editorRef: { current: null }, setOverrideEditor: vi.fn() }),
}));
vi.mock("../../contexts/card-anchor", () => ({
  useCardAnchorPass: () => ({ resolve: () => ({ rows: [], anchored: false }), posOf: () => null }),
}));
vi.mock("../../contexts/citation-display", async (orig) => ({
  ...(await orig<object>()),
  useCitationDisplayContext: () => ({ getCitationDisplayText: () => "", onCitationCreated: () => null }),
}));
vi.mock("../../contexts/selections", () => {
  const sel: Record<string, unknown> = {};
  for (const k of ["Footnote", "Citation", "Note", "Archive", "Todo", "Example", "Comment", "CutterCard", "ReportCard"]) {
    sel[`selected${k}Id`] = null;
    sel[`setSelected${k}Id`] = vi.fn();
  }
  return { useSelectionsContext: () => sel };
});
vi.mock("@/panels/Omni", async (orig) => ({
  ...(await orig<object>()),
  default: () => <div data-testid="omni-view">cards</div>,
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { OmniHost, type OmniHostProps } from "../omni-host";
import {
  OmniCardRegistryProvider,
  createOmniCardRegistry,
  useOmniCard,
} from "../../contexts/omni-card-registry";

const todo = { id: "t1", text: "Find a real Coleridge annotation", done: false, notes: "", aiRequest: false, createdAt: "", links: [] };

/** Every OmniHostProps field, read off the interface: collections empty,
 *  handlers no-ops — then the one to-do. */
function props(over: Partial<OmniHostProps> = {}): OmniHostProps {
  const src = readFileSync(join(__dirname, "..", "omni-host.tsx"), "utf8");
  const body = src.slice(src.indexOf("export interface OmniHostProps {"), src.indexOf("\n}\n", src.indexOf("export interface OmniHostProps {")));
  const out: Record<string, unknown> = {};
  for (const m of body.matchAll(/^\s{2}([a-zA-Z]+)\??:\s*([^;]+);/gm)) {
    const [, name, type] = m;
    const t = type.trim();
    if (t.includes("=>")) out[name] = vi.fn();
    else if (/^boolean\b/.test(t)) out[name] = undefined;
    else if (/Set</.test(t) || /Ids$/.test(name)) out[name] = new Set();
    else if (/Map</.test(t) || /Map$/.test(name)) out[name] = new Map();
    else if (/\[\]|Array</.test(t) || /(s|Cards|Items|Snippets|Errors)$/.test(name)) out[name] = [];
    else out[name] = vi.fn();
  }
  return {
    ...out,
    side: "right",
    todoItems: [todo],
    archivedIds: new Set<string>(),
    getOmniEnabled: () => new Set(),
    categorySides: {},
    focusState: null,
    bulkPendingChanges: undefined,
    ...over,
  } as unknown as OmniHostProps;
}

function Slot({ id }: { id: string }) {
  return <div data-testid="slot">{useOmniCard(id)?.content ?? "empty"}</div>;
}

describe("OmniHost publishOnly — a collapsed side still serves the gutter", () => {
  it("renders no cards, yet a to-do row opens into the real card", () => {
    const registry = createOmniCardRegistry();
    render(
      <OmniCardRegistryProvider value={registry}>
        <OmniHost {...props({ publishOnly: true })} />
        <Slot id="t1" />
      </OmniCardRegistryProvider>,
    );
    // Nothing of the cascade is mounted…
    expect(screen.queryByTestId("omni-view")).toBeNull();
    // …but the card is in the registry, and the gutter's slot renders it.
    expect(registry.find("t1")?.kind).toBe("todo");
    const slot = screen.getByTestId("slot");
    expect(slot.textContent).not.toBe("empty");
    expect(slot.querySelector('[data-card-key="float:card:todo:t1"]')).not.toBeNull();
  });

  it("an open side renders its cascade as before", () => {
    render(
      <OmniCardRegistryProvider value={createOmniCardRegistry()}>
        <OmniHost {...props()} />
      </OmniCardRegistryProvider>,
    );
    expect(screen.getByTestId("omni-view")).toBeTruthy();
  });
});
