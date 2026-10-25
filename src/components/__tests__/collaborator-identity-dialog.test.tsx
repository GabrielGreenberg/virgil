// @vitest-environment jsdom
//
// Task 1216 — the collaborator identity dialog's colour swatches showed the
// chosen colour only as a border (nothing announced, arrow keys dead), and the
// "Edit identity…" door opened on the first-time SETUP copy because
// `useCollaboratorIdentity` never passed the title the prop existed for.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage", () => {
  const noop = () => undefined;
  return new Proxy(
    {},
    {
      get: (_t, prop) =>
        prop === "__esModule" ? true : prop === "then" ? undefined : noop,
    },
  );
});

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import CollaboratorIdentityDialog, {
  IDENTITY_EDIT_COPY,
  useCollaboratorIdentity,
} from "../CollaboratorIdentityDialog";
import { __resetDialogStack } from "../dialog-stack";
import { COLLAB_COLORS, COLLAB_IDENTITY_KEY } from "@/lib/collab";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  __resetDialogStack();
  localStorage.clear();
});

const checked = () =>
  screen
    .getAllByRole("radio")
    .filter((r) => r.getAttribute("aria-checked") === "true");

describe("identity colour swatches are a radio group", () => {
  it("exactly the current colour is checked, and it is the one tab stop", () => {
    const initial = { name: "Sam", color: COLLAB_COLORS[2].hex.toUpperCase() };
    render(
      <CollaboratorIdentityDialog
        open
        initial={initial}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const group = screen.getByRole("radiogroup", { name: "Color" });
    expect(group).toBeTruthy();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(COLLAB_COLORS.length);
    expect(checked()).toEqual([radios[2]]);
    expect(radios.filter((r) => r.tabIndex === 0)).toEqual([radios[2]]);
    // The chosen swatch carries a check (task 1279) — a shape cue, not only
    // its border; the others carry none.
    const marked = radios.filter(
      (r) => r.querySelector('[data-radio-mark="checked"]') !== null,
    );
    expect(marked).toEqual([radios[2]]);
  });

  it("arrow keys move the choice and focus together, wrapping; Save commits it", () => {
    const onConfirm = vi.fn();
    render(
      <CollaboratorIdentityDialog
        open
        initial={{ name: "Sam", color: COLLAB_COLORS[0].hex }}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    const radios = () => screen.getAllByRole("radio");
    fireEvent.keyDown(radios()[0], { key: "ArrowRight" });
    expect(checked()).toEqual([radios()[1]]);
    expect(document.activeElement).toBe(radios()[1]);
    fireEvent.keyDown(radios()[1], { key: "ArrowLeft" });
    fireEvent.keyDown(radios()[0], { key: "ArrowLeft" });
    const last = COLLAB_COLORS.length - 1;
    expect(checked()).toEqual([radios()[last]]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onConfirm).toHaveBeenCalledWith({
      name: "Sam",
      color: COLLAB_COLORS[last].hex.toLowerCase(),
    });
  });

  it("a stored colour outside the palette still leaves the group reachable by Tab", () => {
    render(
      <CollaboratorIdentityDialog
        open
        initial={{ name: "Sam", color: "#123456" }}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    const radios = screen.getAllByRole("radio");
    expect(checked()).toEqual([]);
    expect(radios.filter((r) => r.tabIndex === 0)).toEqual([radios[0]]);
  });

  it("Escape still cancels", () => {
    const onCancel = vi.fn();
    render(
      <CollaboratorIdentityDialog
        open
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(screen.getAllByRole("radio")[0], { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("the dialog's copy follows the door", () => {
  function Harness({ force }: { force: boolean }) {
    const { ensureIdentity, dialog } = useCollaboratorIdentity();
    useEffect(() => {
      void ensureIdentity({ force });
    }, [ensureIdentity, force]);
    return dialog;
  }

  it("ensureIdentity({force:true}) with a stored identity opens the EDIT copy", async () => {
    localStorage.setItem(
      COLLAB_IDENTITY_KEY,
      JSON.stringify({ name: "Sam", color: COLLAB_COLORS[1].hex }),
    );
    await act(async () => {
      render(<Harness force />);
    });
    expect(screen.getByText(IDENTITY_EDIT_COPY.title)).toBeTruthy();
    expect(screen.queryByText("Collaborator identity")).toBeNull();
  });

  it("with no stored identity it opens the first-time setup copy", async () => {
    await act(async () => {
      render(<Harness force={false} />);
    });
    expect(screen.getByText("Collaborator identity")).toBeTruthy();
    expect(screen.queryByText(IDENTITY_EDIT_COPY.title)).toBeNull();
  });
});
