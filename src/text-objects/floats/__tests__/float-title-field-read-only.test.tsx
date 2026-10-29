// @vitest-environment jsdom
//
// Task 1345 — a popped source pod on a read-only doc offers no dead title
// controls. Task 728 gated the WRITE (`canEdit`); the AFFORDANCE kept painting
// a `+T`, a "Remove title ×" and a `button`-role container whose handlers were
// no-ops. Both surfaces now read ONE predicate, `parTitleAffordance`, so the
// float matches the in-place `SourcePodNodeView`'s rule.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FloatTitleField } from "../float-title-field";
import { parTitleAffordance } from "@/lib/par-title-affordance";

afterEach(cleanup);

function mount(title: string | null, canEdit: boolean) {
  return render(
    <FloatTitleField
      title={title}
      editing={false}
      canEdit={canEdit}
      onStartEdit={vi.fn()}
      onCommit={vi.fn()}
      onCancel={vi.fn()}
      onClear={vi.fn()}
    />,
  );
}

describe("FloatTitleField — read-only renders no dead controls", () => {
  it("untitled + read-only: renders nothing (no +T, no button role)", () => {
    const { container } = mount(null, false);
    expect(container.textContent).not.toContain("+T");
    expect(container.querySelector('[role="button"]')).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  it("titled + read-only: the title shows as plain text, no × and no button role", () => {
    const { container } = mount("My block", false);
    expect(container.querySelector(".par-title-text")?.textContent).toBe("My block");
    expect(container.querySelector('[aria-label="Remove title"]')).toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector('[role="button"]')).toBeNull();
    expect(container.querySelector(".focus-ring")).toBeNull();
  });

  it("editable: +T / × and the button-role container still render", () => {
    expect(mount(null, true).container.textContent).toContain("+T");
    cleanup();
    const { container } = mount("My block", true);
    expect(container.querySelector('[role="button"]')).not.toBeNull();
    expect(container.querySelector("button.par-title-delete")).not.toBeNull();
  });
});

describe("parTitleAffordance — the one predicate", () => {
  it("states the in-place pod's rule", () => {
    const cases: Array<[string | null, boolean, boolean, [boolean, boolean, boolean]]> = [
      // title, editable, collapsed → [show, live, canClear]
      [null, true, false, [true, true, false]],
      [null, false, false, [false, false, false]],
      [null, true, true, [false, false, false]],
      ["T", true, false, [true, true, true]],
      ["T", false, false, [true, false, false]],
      ["T", true, true, [true, false, false]],
    ];
    for (const [title, editable, collapsed, [show, live, canClear]] of cases) {
      expect(parTitleAffordance({ title, editable, collapsed })).toEqual({
        show,
        live,
        canClear,
      });
    }
  });

  it("CENSUS: both source-pod surfaces read it (no hand-spelled predicate)", () => {
    const root = resolve(__dirname, "../../../..");
    const nodeView = readFileSync(resolve(root, "src/components/SourcePodNodeView.tsx"), "utf8");
    const field = readFileSync(resolve(root, "src/text-objects/floats/float-title-field.tsx"), "utf8");
    for (const src of [nodeView, field]) {
      expect(src).toContain("parTitleAffordance(");
    }
    expect(nodeView).not.toMatch(/title \|\| \(!collapsed && editable\)/);
    expect(nodeView).not.toMatch(/editingTitle && !collapsed && editable/);
    expect(field).not.toMatch(/canEdit \? on\w+ : \(\) => \{\}/);
  });
});
