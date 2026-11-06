// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/lib/storage", () => ({ isDevStorage: true }));

import ConfirmDialog from "../ConfirmDialog";
import { SYSTEM_DIALOG_TOKENS } from "../system-dialog";

afterEach(cleanup);

function frameFirstChild(): Element {
  const frame = document.querySelector(".dialog-frame");
  if (!frame?.firstElementChild) throw new Error("no dialog frame");
  return frame.firstElementChild;
}

describe("a confirm's top edge", () => {
  it("draws no empty header when there is no title", () => {
    render(
      <ConfirmDialog open message="Delete it?" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(frameFirstChild().textContent).toBe("Delete it?");
    expect(SYSTEM_DIALOG_TOKENS.body).toContain("first:pt-5");
  });

  it("keeps the header when there is one", () => {
    render(
      <ConfirmDialog
        open
        title="Move footnote?"
        message="It moves with its paragraph."
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Move footnote?" })).toBeTruthy();
    expect(frameFirstChild().className).toContain(SYSTEM_DIALOG_TOKENS.header);
  });
});
