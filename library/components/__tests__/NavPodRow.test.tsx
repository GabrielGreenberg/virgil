// @vitest-environment jsdom
//
// Task 1380: both NavPod pods (Libraries navigator, My Papers) render the ONE
// NavPodRow, so their rows are keyboard-operable controls (Tab stop, Enter /
// Space activate), carry no JS hover state, and a key or click on the ⋮ kebab
// is the kebab's — never the row's.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { NavPodRow } from "../NavPodRow";
import RowMenu from "../RowMenu";

afterEach(cleanup);

function renderRow(onActivate = vi.fn(), editing?: React.ReactNode) {
  const utils = render(
    <NavPodRow
      label="Central"
      active={false}
      onActivate={onActivate}
      editing={editing}
      trailing={
        <RowMenu
          items={[{ key: "x", label: "Do X", onSelect: () => {} }]}
          ariaLabel="Central actions"
        />
      }
    />,
  );
  const row = utils.getByText("Central").closest("[role='button']") as HTMLElement;
  return { ...utils, row, onActivate };
}

describe("NavPodRow (task 1380)", () => {
  it("is a tab stop that activates on click, Enter and Space", () => {
    const { row, onActivate } = renderRow();
    expect(row).not.toBeNull();
    expect(row.tabIndex).toBe(0);
    fireEvent.click(row);
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    expect(onActivate).toHaveBeenCalledTimes(3);
  });

  it("the kebab's click and keys never activate the row", () => {
    const { getByLabelText, onActivate } = renderRow();
    const kebab = getByLabelText("Central actions");
    fireEvent.click(kebab);
    fireEvent.keyDown(kebab, { key: "Enter" });
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("hovers by class, not by JS state, and rests with no inline fill", () => {
    const { row } = renderRow();
    expect(row.className).toContain("hover-on-light");
    expect(row.className).toContain("focus-ring");
    expect(row.style.background).toBe("");
  });

  it("is not a control while editing (rename input owns the row)", () => {
    const onActivate = vi.fn();
    const { container, getByLabelText } = render(
      <NavPodRow
        label="Central"
        active
        onActivate={onActivate}
        editing={<input aria-label="Library name" />}
      />,
    );
    expect(container.querySelector("[role='button']")).toBeNull();
    fireEvent.click(getByLabelText("Library name"));
    fireEvent.keyDown(getByLabelText("Library name"), { key: "Enter" });
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("CENSUS: both pods render NavPodRow and hand-roll no row of their own", () => {
    const root = resolve(__dirname, "../../..");
    for (const rel of [
      "library/components/LibrariesNavigator.tsx",
      "src/components/library/MyPapersPod.tsx",
    ]) {
      const src = readFileSync(resolve(root, rel), "utf8");
      expect(src, rel).toContain("<NavPodRow");
      expect(src, rel).not.toMatch(/setHovered|onMouseEnter/);
      expect(src, rel).not.toMatch(/rgba\(/);
      expect(src, rel).not.toMatch(/padding: "2px 14px 6px"/);
    }
  });
});
