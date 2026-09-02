// @vitest-environment jsdom
//
/**
 * Task 530 — **a dialog's DRAFT is protected from a dismissal, and an inner
 * ABORT is not a dismissal.**
 *
 * Two halves of one law, in two mechanisms, because they enter through two
 * different doors. The SHELL owns Escape / the backdrop / the outside-mousedown
 * and now ASKS `dismissGuard` before it closes; the CALLER owns
 * `setNewDocModal(null)`, which the shell can never see, so that half is a
 * REPORT the dialog reads.
 *
 * **No pre-530 suite could see either.** `StyleEditorModal` is rendered by
 * nothing anywhere in the repo, and `NewDocumentModal`'s two appearances (in
 * `dialog-enter-contract`) drive its Enter key with an `onCreate` that resolves
 * `void` — so "the caller closed me for an act that created nothing" is
 * unrepresentable in both of them.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The extension barrel pulls `@/lib/storage`, whose backend `require` is not
// resolvable under vitest (the repo-wide gotcha).
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

// Only the React COMPONENT is stubbed — `EditorView` / `EditorState` stay REAL,
// because `StyleEditorModal` builds its theme and its extension list from them
// at module scope. The stub is a real textarea so a leg can make the preamble
// dirty exactly as a user does, through the component's own `onChange`.
vi.mock("@uiw/react-codemirror", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (next: string) => void;
  }) => (
    <textarea
      data-testid="cm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

import { act, cleanup, render, screen } from "@testing-library/react";
import { __resetDialogStack } from "../dialog-stack";
import { SystemDialogProvider } from "../system-dialog-host";
import StyleEditorModal from "../StyleEditorModal";
import NewDocumentModal from "../NewDocumentModal";

/* ── harness ─────────────────────────────────────────────────────── */

/** jsdom's rAF clock is not worth trusting — drive it by hand. */
const rafs: FrameRequestCallback[] = [];
let realRaf: typeof window.requestAnimationFrame;
let realCaf: typeof window.cancelAnimationFrame;

function flushFrames() {
  const pending = rafs.splice(0, rafs.length);
  act(() => {
    for (const cb of pending) cb(performance.now());
  });
}

beforeEach(() => {
  realRaf = window.requestAnimationFrame;
  realCaf = window.cancelAnimationFrame;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    rafs.push(cb)) as unknown as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
});

afterEach(() => {
  window.requestAnimationFrame = realRaf;
  window.cancelAnimationFrame = realCaf;
  rafs.length = 0;
  cleanup();
  __resetDialogStack();
});

/** Let the guard's promise (and the confirm's queue commit) settle. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** The MODAL variant's scrim — clicking it IS the backdrop dismissal. */
function scrimOf(el: HTMLElement): HTMLElement {
  const frame = el.closest("[role='dialog']") as HTMLElement | null;
  if (!frame) throw new Error("no dialog frame");
  return frame;
}

function pressEscape() {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

const PREAMBLE = "\\documentclass{article}\n\\begin{document}\n\n";

function renderStyleEditor(onCancel = vi.fn()) {
  render(
    <SystemDialogProvider>
      <StyleEditorModal
        initialName="Classic"
        initialPreamble={PREAMBLE}
        onSave={() => {}}
        onCancel={onCancel}
      />
    </SystemDialogProvider>,
  );
  flushFrames();
  return onCancel;
}

/** Type into the preamble editor — the draft this dialog is the only copy of. */
function dirtyThePreamble() {
  const cm = screen.getByTestId("cm") as HTMLTextAreaElement;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    setter.call(cm, PREAMBLE + "\\usepackage{amsmath}\n");
    cm.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The discard confirm, if the guard raised one. */
function discardConfirm(): HTMLElement | null {
  return screen.queryByText("Discard changes?");
}

/* ── M1 — the shell asks before it discards ──────────────────────── */

describe("StyleEditorModal: a dismissal cannot silently discard an edited preamble", () => {
  it("a backdrop click on a DIRTY editor asks instead of closing", async () => {
    const onCancel = renderStyleEditor();
    dirtyThePreamble();

    const scrim = scrimOf(screen.getByTestId("cm"));
    act(() => {
      scrim.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    expect(onCancel).not.toHaveBeenCalled();
    expect(discardConfirm()).not.toBeNull();
    // And the draft is still on screen behind the prompt.
    expect((screen.getByTestId("cm") as HTMLTextAreaElement).value).toContain(
      "amsmath",
    );
  });

  it("ESCAPE on a DIRTY editor asks instead of closing", async () => {
    const onCancel = renderStyleEditor();
    dirtyThePreamble();

    pressEscape();
    await settle();

    expect(onCancel).not.toHaveBeenCalled();
    expect(discardConfirm()).not.toBeNull();
  });

  it("the footer's own Cancel asks too — it never enters the shell's door", async () => {
    const onCancel = renderStyleEditor();
    dirtyThePreamble();

    act(() => {
      screen.getByText("Cancel").click();
    });
    await settle();

    expect(onCancel).not.toHaveBeenCalled();
    expect(discardConfirm()).not.toBeNull();
  });

  it("editing the NAME alone is dirty too", async () => {
    const onCancel = renderStyleEditor();
    const name = screen.getByPlaceholderText("My style") as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!.call(name, "Classic v2");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });

    pressEscape();
    await settle();

    expect(onCancel).not.toHaveBeenCalled();
    expect(discardConfirm()).not.toBeNull();
  });

  it("confirming Discard closes it — a refusal is never a wedge", async () => {
    const onCancel = renderStyleEditor();
    dirtyThePreamble();
    pressEscape();
    await settle();

    act(() => {
      screen.getByText("Discard").click();
    });
    await settle();

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("declining keeps the draft AND leaves the dialog dismissable", async () => {
    const onCancel = renderStyleEditor();
    dirtyThePreamble();
    pressEscape();
    await settle();

    act(() => {
      screen.getByText("Keep editing").click();
    });
    await settle();

    expect(onCancel).not.toHaveBeenCalled();
    expect(discardConfirm()).toBeNull();
    expect((screen.getByTestId("cm") as HTMLTextAreaElement).value).toContain(
      "amsmath",
    );

    // …and the very next Escape asks again rather than being swallowed by a
    // latch the first refusal left behind.
    pressEscape();
    await settle();
    expect(discardConfirm()).not.toBeNull();
  });

  it("CONTROL: a PRISTINE editor closes with no prompt at all", async () => {
    const onCancel = renderStyleEditor();

    pressEscape();
    await settle();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(discardConfirm()).toBeNull();
  });

  it("CONTROL: a pristine BACKDROP click closes with no prompt either", async () => {
    const onCancel = renderStyleEditor();

    const scrim = scrimOf(screen.getByTestId("cm"));
    act(() => {
      scrim.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(discardConfirm()).toBeNull();
  });

  it("a second Escape is answered BY the question, not stacked behind it", async () => {
    // CONTROL for the anti-stack half, and it says what actually happens
    // rather than what the shape suggests: while the confirm is open it is
    // the TOP of the dialog stack (task 389), so the second press is ITS
    // key — it resolves "keep editing" and there is exactly ONE question,
    // never a queue. `askingRef` in the shell is the belt to that braces:
    // unreachable from a modal today (the confirm's own scrim covers every
    // dismiss trigger of the dialog underneath), so this leg cannot fail on
    // its absence and does not pretend to.
    const onCancel = renderStyleEditor();
    dirtyThePreamble();

    pressEscape();
    await settle();
    expect(discardConfirm()).not.toBeNull();

    pressEscape();
    await settle();

    expect(discardConfirm()).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
    expect((screen.getByTestId("cm") as HTMLTextAreaElement).value).toContain(
      "amsmath",
    );

    // …and the latch is clear: the NEXT Escape raises the question again.
    pressEscape();
    await settle();
    expect(discardConfirm()).not.toBeNull();
  });
});

/* ── M2 — an inner ABORT is not a dismissal ──────────────────────── */

describe("NewDocumentModal: a cancelled inner step keeps the draft", () => {
  function renderNewDoc(onCreate: NonNullable<
    React.ComponentProps<typeof NewDocumentModal>["onCreate"]
  >) {
    const onCancel = vi.fn();
    render(<NewDocumentModal onCreate={onCreate} onCancel={onCancel} />);
    flushFrames();
    const name = screen.getByPlaceholderText("My paper") as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!.call(name, "Coherence Intro");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return { onCancel, name };
  }

  it("an ABORTED create leaves the dialog usable with the typed name intact", async () => {
    const onCreate = vi.fn(async () => "cancelled" as const);
    const { name } = renderNewDoc(onCreate);

    act(() => {
      screen.getByText("Create").click();
    });
    await settle();

    expect(onCreate).toHaveBeenCalledWith("Coherence Intro", expect.any(String));
    // The dialog is still mounted with the draft in it…
    expect(name.value).toBe("Coherence Intro");
    // …and NOT wedged on "Creating…", which is what a caller-only gate would
    // have left behind: `busy` disables Create, Cancel, the name field and the
    // doc-type buttons, and kills Escape and the scrim through `onClose`.
    const create = screen.getByText("Create") as HTMLButtonElement;
    expect(create.disabled).toBe(false);
    expect(screen.queryByText("Creating…")).toBeNull();
  });

  it("a second attempt after an abort still reaches the caller", async () => {
    const onCreate = vi.fn(async () => "cancelled" as const);
    renderNewDoc(onCreate);

    act(() => screen.getByText("Create").click());
    await settle();
    act(() => screen.getByText("Create").click());
    await settle();

    expect(onCreate).toHaveBeenCalledTimes(2);
  });

  it("CONTROL: a SUCCESSFUL create leaves busy set — the caller unmounts us", async () => {
    const onCreate = vi.fn(async () => "created" as const);
    renderNewDoc(onCreate);

    act(() => screen.getByText("Create").click());
    await settle();

    // The label stayed at "Creating…" and the control is inert, so a fast
    // double-click cannot create twice in the frame before the unmount lands.
    const busyBtn = screen.getByText("Creating…") as HTMLButtonElement;
    expect(busyBtn.disabled).toBe(true);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("CONTROL: a THROWN failure still renders inline and keeps the name", async () => {
    const onCreate = vi.fn(async () => {
      throw new Error("A folder named that already exists");
    });
    const { name } = renderNewDoc(
      onCreate as unknown as NonNullable<
        React.ComponentProps<typeof NewDocumentModal>["onCreate"]
      >,
    );

    act(() => screen.getByText("Create").click());
    await settle();

    expect(
      screen.getByText("A folder named that already exists"),
    ).toBeTruthy();
    expect(name.value).toBe("Coherence Intro");
  });
});
