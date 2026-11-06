// @vitest-environment jsdom
/**
 * An open dropdown owns its keys. `Select` is a real `<select>` drawn by this
 * app's stylesheet, so while its list is open the keyboard is on an `<option>`
 * inside the dialog, where a browser-drawn list used to keep it from the page.
 * Escape must close the list and leave the dialog, and Enter must pick the row
 * and leave the dialog's cued button alone.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/storage", async () =>
  (await import("@/lib/__tests__/_mock-storage")).mockStorageModule(),
);

import SystemDialog, {
  SystemDialogBody,
  SystemDialogButton,
  SystemDialogFooter,
  SystemDialogHeader,
} from "../system-dialog";
import { resolveDialogEnter } from "../dialog-enter-policy";

afterEach(cleanup);

function mount() {
  const onClose = vi.fn();
  render(
    <SystemDialog open onClose={onClose} dismissIsFree>
      <SystemDialogHeader title="Pick" />
      <SystemDialogBody>
        <select aria-label="Kind">
          <option>One</option>
        </select>
      </SystemDialogBody>
      <SystemDialogFooter>
        <SystemDialogButton variant="primary" onClick={onClose} autoFocus>
          Done
        </SystemDialogButton>
      </SystemDialogFooter>
    </SystemDialog>,
  );
  return { onClose };
}

describe("a dialog and its open dropdown", () => {
  it("Escape on an open list leaves the dialog; Escape anywhere else closes it", () => {
    const { onClose } = mount();
    fireEvent.keyDown(screen.getByRole("option"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText("Kind"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("an option keeps its Enter", () => {
    const frame = document.createElement("div");
    const option = frame.appendChild(document.createElement("option"));
    expect(
      resolveDialogEnter({
        target: option,
        frame,
        modal: true,
        alreadyHandled: false,
        phase: "bubble",
      }).kind,
    ).toBe("hands-off");
  });
});
