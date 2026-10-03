// @vitest-environment jsdom
//
// Task 918 — the omni strip's zero state names the RIGHT cause.
//
// `enabledCategories` fuses two facts (placed on this side AND not hidden), so
// it is empty both when the user hid every category here and when no panel is
// placed on this side at all. Only the first is answered by the filter menu —
// with nothing placed, that menu has no rows. The sentence reads placement
// from `categorySides` (the task-381 SSOT) to tell them apart.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import type { Editor } from "@tiptap/react";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import OmniViewPanel from "@/panels/Omni/OmniViewPanel";
import { OMNI_CATEGORIES, type OmniCategory } from "@/panels/Omni/omni-categories";

afterEach(cleanup);

const editor = {} as Editor;
const NOTHING = new Set<OmniCategory>();
const allOn = (side: "left" | "right") =>
  Object.fromEntries(OMNI_CATEGORIES.map((c) => [c, side])) as Record<
    OmniCategory,
    "left" | "right"
  >;

describe("omni zero state distinguishes 'nothing placed' from 'everything hidden'", () => {
  it("a side that owns no panel does not send the user to an empty filter menu", () => {
    const { container } = render(
      <OmniViewPanel
        side="right"
        items={[]}
        editor={editor}
        enabledCategories={NOTHING}
        categorySides={allOn("left")}
      />,
    );
    const zero = container.querySelector("[data-omni-zero-state]");
    expect(zero?.getAttribute("data-omni-zero-state")).toBe("no-panels");
    expect(container.textContent).not.toContain("filter menu");
    expect(container.textContent).toContain("No panels on this side");
  });

  it("a side whose placed panels are all hidden keeps the filter-menu sentence", () => {
    const { container } = render(
      <OmniViewPanel
        side="right"
        items={[]}
        editor={editor}
        enabledCategories={NOTHING}
        categorySides={allOn("right")}
      />,
    );
    const zero = container.querySelector("[data-omni-zero-state]");
    expect(zero?.getAttribute("data-omni-zero-state")).toBe("all-hidden");
    expect(container.textContent).toContain("use the filter menu");
  });
});
