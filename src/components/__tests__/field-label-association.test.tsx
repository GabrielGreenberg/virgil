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

// Task 903 — the preference rows set a bare `<span>` beside every slider,
// select and colour field, so the whole Preferences dialog was announced
// unnamed. They render through `Field` (row register) now.
describe("preference rows resolve by their label (task 903)", () => {
  it("a slider row: the label names the range input; the description describes it", async () => {
    const { SliderPref } = await import("../PreferenceTree");
    render(
      <SliderPref
        label="Line height"
        description="Space between lines"
        value={1.6}
        defaultValue={1.5}
        min={1}
        max={2}
        step={0.1}
        unit=""
        onChange={() => {}}
      />,
    );
    const slider = screen.getByLabelText("Line height");
    expect(slider.getAttribute("type")).toBe("range");
    expect(screen.getByRole("slider", { name: "Line height", description: "Space between lines" })).toBe(slider);
  });

  it("a font row: the label names the select", async () => {
    const { FontPref } = await import("../PreferenceTree");
    render(<FontPref label="Body font" value="Inter" options={["Inter", "Lora"]} onChange={() => {}} />);
    expect(screen.getByLabelText("Body font").tagName).toBe("SELECT");
  });

  it("a colour row: the label names the swatch+hex GROUP, and its parts are named", async () => {
    const { ColorPref } = await import("../PreferenceTree");
    render(<ColorPref label="Link colour" value="#112233" defaultValue="#112233" onChange={() => {}} />);
    const group = screen.getByRole("group", { name: "Link colour" });
    expect(group.querySelector('input[type="color"]')!.getAttribute("aria-label")).toBe("Colour swatch");
    expect(screen.getByLabelText("Hex value").tagName).toBe("INPUT");
  });
});

describe("ResetButton — one control, one at-default behaviour (task 903)", () => {
  it("is present and DISABLED at the default, named for what it resets", async () => {
    const { ColorPref } = await import("../PreferenceTree");
    render(<ColorPref label="Link colour" value="#112233" defaultValue="#112233" onChange={() => {}} />);
    const reset = screen.getByRole("button", { name: "Reset Link colour" });
    expect((reset as HTMLButtonElement).disabled).toBe(true);
  });

  it("is enabled off the default and writes the default back", async () => {
    const { SliderPref } = await import("../PreferenceTree");
    let got: number | null = null;
    render(
      <SliderPref label="Gap" value={3} defaultValue={2} min={0} max={5} step={1} unit="px" onChange={(v) => { got = v; }} />,
    );
    const reset = screen.getByRole("button", { name: "Reset Gap" });
    expect((reset as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(reset);
    expect(got).toBe(2);
  });

  it("no preference surface spells its own reset button any more", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    for (const rel of ["PreferenceTree.tsx", "SmartPreferences.tsx", "FontsDialog.tsx"]) {
      const src = readFileSync(path.join(__dirname, "..", rel), "utf8");
      // The retired spellings: a raw <button> whose text is reset/Reset.
      expect(src, rel).not.toMatch(/>\s*reset\s*<\/button>/i);
      expect(src, rel).toContain("<ResetButton");
    }
  });
});
