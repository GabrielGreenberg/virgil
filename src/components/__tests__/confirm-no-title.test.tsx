// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@/lib/storage", () => ({ isDevStorage: true }));

import ConfirmDialog from "../ConfirmDialog";
import SystemDialog, {
  SYSTEM_DIALOG_TOKENS,
  SystemDialogBody,
  SystemDialogHeader,
} from "../system-dialog";

afterEach(cleanup);

function frameFirstChild(): Element {
  const frame = document.querySelector(".dialog-frame");
  if (!frame?.firstElementChild) throw new Error("no dialog frame");
  return frame.firstElementChild;
}

describe("a dialog's top edge", () => {
  // A confirm's title is REQUIRED since task 1609 (it is the accessible name),
  // so the untitled case lives at the shell: a header with nothing to render
  // draws no empty strip, and the body's first-child padding takes the edge.
  it("draws no empty header when the shell's header has no title", () => {
    render(
      <SystemDialog open onClose={() => {}}>
        <SystemDialogHeader />
        <SystemDialogBody>Delete it?</SystemDialogBody>
      </SystemDialog>,
    );
    expect(frameFirstChild().textContent).toBe("Delete it?");
    expect(SYSTEM_DIALOG_TOKENS.body).toContain("first:pt-5");
  });

  it("a confirm keeps its header", () => {
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
