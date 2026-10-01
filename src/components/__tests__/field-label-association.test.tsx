// @vitest-environment jsdom
//
// Task 869 — dialog field labels were SIBLING `<label>`s with no `htmlFor`, so
// clicking "Name" focused nothing and a screen reader met an unlabeled textbox;
// and NewDocumentModal's document-type picker said which type was chosen by
// colour alone. `Field` (field-primitives.tsx) owns the association now. These
// legs ask the accessibility question directly — does the LABEL resolve the
// CONTROL — against the real dialogs.

import { afterEach, describe, expect, it, vi } from "vitest";

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

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Field, Input } from "../field-primitives";
import NewDocumentModal from "../NewDocumentModal";
import StyleEditorModal from "../StyleEditorModal";
import { SystemDialogProvider } from "../system-dialog-host";
import { __resetDialogStack } from "../dialog-stack";
import { DOC_TYPES } from "@/lib/doc-types";

afterEach(() => {
  cleanup();
  __resetDialogStack();
});

describe("Field — the label is associated with its control", () => {
  it("native: getByLabelText resolves the input, and the label carries the section register", () => {
    render(<Field label="Title">{({ id }) => <Input id={id} />}</Field>);
    const input = screen.getByLabelText("Title");
    expect(input.tagName).toBe("INPUT");
    const label = screen.getByText("Title");
    expect(label.tagName).toBe("LABEL");
    expect(label.className).toContain("uppercase");
  });

  it("group: the label is text the widget names via aria-labelledby", () => {
    render(
      <Field label="Size" register="row" control="group">
        {({ labelId }) => <div role="group" aria-labelledby={labelId} />}
      </Field>,
    );
    expect(screen.getByText("Size").tagName).toBe("SPAN");
    expect(screen.getByRole("group", { name: "Size" })).toBeTruthy();
  });
});

describe("dialog field labels (task 869)", () => {
  it("NewDocumentModal: Name resolves the input; the doc-type picker is a radiogroup", () => {
    render(
      <NewDocumentModal onCreate={() => "created"} onCancel={() => {}} />,
    );
    expect(screen.getByLabelText("Name").tagName).toBe("INPUT");

    const group = screen.getByRole("radiogroup", { name: "Document type" });
    expect(group).toBeTruthy();
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(DOC_TYPES.length);
    const checked = radios.filter(
      (r) => r.getAttribute("aria-checked") === "true",
    );
    expect(checked).toHaveLength(1);
    // Roving tabindex: one tab stop, the checked card.
    expect(radios.filter((r) => r.tabIndex === 0)).toEqual(checked);
  });

  it("NewDocumentModal: arrow keys move the choice and focus together, wrapping", () => {
    render(
      <NewDocumentModal
        initialTemplateId={DOC_TYPES[0].id}
        onCreate={() => "created"}
        onCancel={() => {}}
      />,
    );
    const radios = () => screen.getAllByRole("radio");
    fireEvent.keyDown(radios()[0], { key: "ArrowDown" });
    expect(radios()[1].getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(radios()[1]);
    fireEvent.keyDown(radios()[1], { key: "ArrowUp" });
    fireEvent.keyDown(radios()[0], { key: "ArrowUp" });
    const last = DOC_TYPES.length - 1;
    expect(radios()[last].getAttribute("aria-checked")).toBe("true");
  });

  it("StyleEditorModal: Name resolves the input", () => {
    render(
      <SystemDialogProvider>
        <StyleEditorModal onSave={() => {}} onCancel={() => {}} />
      </SystemDialogProvider>,
    );
    expect(screen.getByLabelText("Name").tagName).toBe("INPUT");
  });
});
