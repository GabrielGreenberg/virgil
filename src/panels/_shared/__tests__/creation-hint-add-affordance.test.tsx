// @vitest-environment jsdom
//
// TASK 727 — an empty state may not promise a control the panel does not have.
//
// Two promises shipped in the Examples panel, and they were the same promise.
// Its copy named a `(1)` glyph in the formatting toolbar — retired with the
// MenuBar's example buttons, present nowhere in the app. And its `onAdd` prop
// was declared, destructured and forwarded to `CardListPanel` while NO host
// ever passed it, so the header "+" it existed to paint was never painted.
// Neither could fail: the copy is a string, and a prop nobody passes type-checks
// exactly like one that is wired.
//
// The fix inverts who speaks. The registry owns the editor ROUTE
// (`<CreationHint action="…" />` off `creation-routes.ts`); `CardListPanel`
// owns the "+", because it holds the very `handleAdd` the header renders on,
// and it publishes that through `PanelAddProvider`. So the "+" clause is not
// copy a panel can get wrong — it is a reading of the button.
//
// This file drives the REAL `CardListPanel` in both states and reads the
// rendered sentence. Its sibling legs: the provenance census (no panel writes
// such a sentence by hand) in `src/__tests__/panel-empty-state-contract.test.ts`,
// and the derivation itself in `src/lib/actions/__tests__/creation-routes.test.ts`.

import { afterEach, describe, expect, it, vi } from "vitest";

// `panel-primitives` pulls the storage barrel transitively; stub it so the
// render needs no FSA. (Same shape `archive-view-empty-state` uses.)
vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

import { cleanup, render } from "@testing-library/react";
import { CardListPanel } from "../CardListPanel";
import { CreationHint } from "../CreationHint";
import { PANEL } from "@/components/panel-primitives";

afterEach(cleanup);

interface Row {
  id: string;
}

function renderEmptyPanel(opts: {
  onAdd?: (rect?: DOMRect) => void;
  onAddOptions?: { label: string; onClick: () => void }[];
}) {
  return render(
    <CardListPanel<Row>
      kind="examples"
      items={[]}
      getId={(r) => r.id}
      selectedId={null}
      onSelect={vi.fn()}
      onAdd={opts.onAdd}
      onAddOptions={opts.onAddOptions}
      emptyState={
        <div className={PANEL.empty}>
          No examples yet.
          <CreationHint action="example" />
        </div>
      }
      renderCard={(r) => <div>{r.id}</div>}
    />,
  );
}

const text = (c: HTMLElement) => (c.textContent ?? "").replace(/\s+/g, " ").trim();

describe("the empty state reads the + off the panel, not off memory", () => {
  it("says nothing about a + when no host wired one", () => {
    // The live Examples wiring: `ExamplesHost` passes examples / selectedId /
    // onSelect / onJump and nothing else.
    const { container } = renderEmptyPanel({});
    expect(text(container)).toContain(
      "No examples yet. Type \\ex in the editor, or pick Example from the ⚡ menu.",
    );
    expect(text(container)).not.toContain("+");
    // And the header really has no "+" to click — the two agree because they
    // are the same fact read twice.
    expect(container.querySelector('button[aria-label="Add"]')).toBeNull();
  });

  it("offers the + first once a host passes one — same copy, no panel edit", () => {
    const { container } = renderEmptyPanel({ onAdd: vi.fn() });
    expect(text(container)).toContain(
      "No examples yet. Click + above, or type \\ex in the editor.",
    );
  });

  it("counts an add-MENU as a + too, exactly as the header does", () => {
    // `PanelHeader` renders `onAddOptions ? dropdown : onAdd && button`, so a
    // panel whose "+" opens a choice list (Cutter, Reports) has one just the
    // same. A condition spelled differently here would be a third opinion about
    // a button, which is the shape of the bug.
    const { container } = renderEmptyPanel({
      onAddOptions: [{ label: "Comment", onClick: vi.fn() }],
    });
    expect(text(container)).toContain("Click + above");
  });

  it("promises no + outside a CardListPanel at all", () => {
    // The provider defaults to false, so a `CreationHint` rendered anywhere
    // else teaches only the editor routes.
    const { container } = render(
      <div className={PANEL.empty}>
        No examples yet.
        <CreationHint action="example" />
      </div>,
    );
    expect(text(container)).not.toContain("+");
  });
});
