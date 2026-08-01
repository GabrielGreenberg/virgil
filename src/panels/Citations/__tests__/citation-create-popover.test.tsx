// @vitest-environment jsdom
//
// CitationCreatePopover — the deferred-commit semantics of the citation create
// popover (the user's chosen model): picking citekeys STAGES them and writes
// NOTHING; the citation materializes only on commit (OK button, or click-away /
// Escape) and ONLY when ≥1 key is staged. Clicking away empty creates nothing.
//
// The underlying `CitekeyPicker` (search + library merge + floating menu) is
// covered by its own tests; here it is mocked to a thin stub that surfaces the
// `onSelectKey` / `onClose` callbacks + the `footer` so this test drives the
// STAGING + COMMIT logic in isolation.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CitationCreatePopover } from "@/panels/Citations/CitationCreatePopover";

// The popover's footer now composes the `Button` primitive from the
// panel-primitives barrel, which transitively pulls in `@/lib/storage`
// (whose FSA backend `require` can't resolve under vitest). Stub it — the
// popover exercises none of these I/O paths. (vitest_extension_barrel gotcha.)
vi.mock("@/lib/storage", () => {
  const STORAGE_FNS = [
    "readSidecar", "readSidecarIfExists", "writeSidecar", "readSidecarBundle",
    "invalidateSidecarBundle", "readTex", "writeTex", "readDocBundle",
    "writeDocBundle", "readBib", "writeBib", "createDocFromPicker",
    "createDocInFolder", "pickProjectFolder", "registerDocInFolder",
    "openExistingDocFromPicker", "listDocs", "renameDoc", "deleteDocFromIndex",
    "flushDoc", "drainDoc", "detectBibPackage", "readPaperFolder",
    "getTexFilename", "getBibFilename", "statFiles", "readTextFile", "writePdf",
    "readPdf", "getPdfFilename", "pdfFilenameFromTex", "readFigureSource",
    "readFigureRaster", "writeFigureRaster", "deleteFigureRaster",
    "readFigureIndex", "writeFigureIndex", "getDocWriteHandle", "importFigureFile",
  ];
  const mod: Record<string, unknown> = { isDevStorage: false };
  for (const name of STORAGE_FNS) mod[name] = vi.fn();
  return mod;
});

vi.mock("@/panels/Citations/CitekeyPicker", () => ({
  CitekeyPicker: (props: {
    onSelectKey: (k: string) => void;
    onClose: () => void;
    onEnterCommit?: (pickedKey?: string) => void;
    footer?: React.ReactNode;
  }) => (
    <div data-testid="picker">
      <button data-testid="pick-smith" onClick={() => props.onSelectKey("smith")}>
        pick smith
      </button>
      <button data-testid="pick-jones" onClick={() => props.onSelectKey("jones")}>
        pick jones
      </button>
      {/* Return in the real picker STAGES the active key then fires
          onEnterCommit(key) in the same tick — reproduce both here. */}
      <button
        data-testid="enter-smith"
        onClick={() => {
          props.onSelectKey("smith");
          props.onEnterCommit?.("smith");
        }}
      >
        enter smith
      </button>
      <button
        data-testid="enter-jones"
        onClick={() => {
          props.onSelectKey("jones");
          props.onEnterCommit?.("jones");
        }}
      >
        enter jones
      </button>
      {/* Return with nothing new to stage (empty list / empty query). */}
      <button data-testid="enter-empty" onClick={() => props.onEnterCommit?.(undefined)}>
        enter empty
      </button>
      {/* The picker's onClose — what click-away / Escape route through. */}
      <button data-testid="dismiss" onClick={() => props.onClose()}>
        dismiss
      </button>
      {props.footer}
    </div>
  ),
}));

afterEach(cleanup);

function setup() {
  const onCommit = vi.fn();
  const onClose = vi.fn();
  render(
    <CitationCreatePopover
      anchorRect={new DOMRect(0, 0, 0, 0)}
      paperBibEntries={[]}
      onCommit={onCommit}
      onClose={onClose}
    />,
  );
  return { onCommit, onClose };
}

const okButton = () => screen.getByRole("button", { name: "Insert citation" });

describe("CitationCreatePopover — deferred commit", () => {
  it("OK with no staged keys is disabled and creates nothing", () => {
    const { onCommit } = setup();
    expect((okButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(okButton());
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("OK commits the staged keys in pick order, then closes", () => {
    const { onCommit, onClose } = setup();
    fireEvent.click(screen.getByTestId("pick-smith"));
    fireEvent.click(screen.getByTestId("pick-jones"));
    fireEvent.click(okButton());
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(["smith", "jones"]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("dedups a repeated pick", () => {
    const { onCommit } = setup();
    fireEvent.click(screen.getByTestId("pick-smith"));
    fireEvent.click(screen.getByTestId("pick-smith"));
    fireEvent.click(okButton());
    expect(onCommit).toHaveBeenCalledWith(["smith"]);
  });

  it("click-away (picker onClose) with ≥1 staged key COMMITS", () => {
    const { onCommit, onClose } = setup();
    fireEvent.click(screen.getByTestId("pick-smith"));
    fireEvent.click(screen.getByTestId("dismiss"));
    expect(onCommit).toHaveBeenCalledWith(["smith"]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("click-away with NO staged keys creates nothing (just closes)", () => {
    const { onCommit, onClose } = setup();
    fireEvent.click(screen.getByTestId("dismiss"));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("a removed staged key is excluded from the commit", () => {
    const { onCommit } = setup();
    fireEvent.click(screen.getByTestId("pick-smith"));
    fireEvent.click(screen.getByTestId("pick-jones"));
    fireEvent.click(screen.getByRole("button", { name: "Remove smith" }));
    fireEvent.click(okButton());
    expect(onCommit).toHaveBeenCalledWith(["jones"]);
  });
});

describe("CitationCreatePopover — Return commits (single keystroke)", () => {
  it("Return on a fresh key stages it and commits in one step, then closes", () => {
    const { onCommit, onClose } = setup();
    fireEvent.click(screen.getByTestId("enter-smith"));
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(["smith"]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Return folds the active key into keys staged earlier (multi-cite)", () => {
    const { onCommit } = setup();
    fireEvent.click(screen.getByTestId("pick-smith")); // staged via mouse
    fireEvent.click(screen.getByTestId("enter-jones")); // Return on the last
    expect(onCommit).toHaveBeenCalledWith(["smith", "jones"]);
  });

  it("Return dedups an already-staged active key", () => {
    const { onCommit } = setup();
    fireEvent.click(screen.getByTestId("pick-smith"));
    fireEvent.click(screen.getByTestId("enter-smith"));
    expect(onCommit).toHaveBeenCalledWith(["smith"]);
  });

  it("Return with nothing staged and no active key commits nothing, just closes", () => {
    const { onCommit, onClose } = setup();
    fireEvent.click(screen.getByTestId("enter-empty"));
    expect(onCommit).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
