// @vitest-environment jsdom
//
// Task 389 — **Return did nothing in the "Re-anchor this snippet?" dialog.**
//
// Gabriel's report: a dialog whose default button is visually CUED (it renders
// as the accented default) does not respond to `Return`. `Escape` felt fine,
// which is the tell — Escape closed unconditionally while Enter was gated on
// `document.activeElement === theCuedButton`, and the cue is claimed by a
// deferred one-shot `requestAnimationFrame` at open. So the KEYBOARD contract
// depended on whether that one frame happened to win a race the user cannot see,
// while the CHROME promised a default either way. The false-affordance shape:
// what the chrome OFFERS is what the key must ACCEPT.
//
// Two halves are under test here, and the second is why this suite exists at all:
//
//  - the RULE (`dialog-enter-policy.ts`): Enter activates a BUTTON — the focused
//    in-frame button if there is one, otherwise the registered cued default —
//    independent of where DOM focus sits, with the in-frame exceptions (a
//    textarea / contenteditable / select / link keeps its own Enter, and so does
//    anything that consumed the key by calling `preventDefault`);
//  - the STACK (`dialog-stack.ts`): only the TOP dialog answers a key. Dialogs
//    genuinely stack (`ManageStylesModal` stays mounted under `StyleEditorModal`),
//    and pre-389 a single `Escape` closed BOTH of them. Making Enter
//    unconditional without the stack would have added the worse twin: two cued
//    defaults firing from one press.
//
// Every leg drives the REAL components (ConfirmDialog → SystemDialog →
// SystemDialogButton) and dispatches a REAL `keydown` on a REAL target, because
// the part that misbehaved was the shell's gate, not any dialog's markup.
//
// The DEFECT legs are the ones that force focus to `document.body` — the
// stolen/never-claimed-focus state the report is about — and they fail on the
// pre-389 shell, measured.

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

import { act, cleanup, render, screen } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import ConfirmDialog, { useConfirmDialog } from "../ConfirmDialog";
import SystemDialog, {
  SystemDialogBody,
  SystemDialogButton,
  SystemDialogFooter,
  SystemDialogHeader,
} from "../system-dialog";
import { __resetDialogStack } from "../dialog-stack";
import { SystemDialogProvider, useSystemDialog } from "../system-dialog-host";
import TexFilePickerModal from "../TexFilePickerModal";
import NewDocumentModal from "../NewDocumentModal";

/* ── harness ─────────────────────────────────────────────────────── */

/** jsdom has no rAF clock of its own worth trusting — drive it by hand. */
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
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafs.push(cb);
    return rafs.length;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
});

afterEach(() => {
  cleanup();
  rafs.length = 0;
  window.requestAnimationFrame = realRaf;
  window.cancelAnimationFrame = realCaf;
  __resetDialogStack();
  vi.restoreAllMocks();
});

function pressEnter(target: EventTarget = document.body, init: KeyboardEventInit = {}) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}

function pressEscape(target: EventTarget = document.body) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
}

interface Spies {
  onConfirm: ReturnType<typeof vi.fn>;
  onCancel: ReturnType<typeof vi.fn>;
}

function renderConfirm(
  props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {},
): Spies {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      open
      title="Re-anchor this snippet?"
      message="This note is anchored elsewhere."
      confirmLabel="Re-anchor"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  );
  flushFrames();
  return { onConfirm, onCancel };
}

/** The stolen-focus state the report is about: nothing in the dialog holds focus. */
function focusBody() {
  (document.activeElement as HTMLElement | null)?.blur?.();
  document.body.setAttribute("tabindex", "-1");
  document.body.focus();
}

/* ── the defect ──────────────────────────────────────────────────── */

describe("Enter activates the cued default whatever holds focus", () => {
  it("DEFECT: focus on <body> — Enter still confirms", () => {
    const { onConfirm, onCancel } = renderConfirm();
    focusBody();
    expect(document.activeElement).toBe(document.body);

    pressEnter(document.body);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("DEFECT: focus in the DOCUMENT behind a modal — Enter confirms and the document never sees the key", () => {
    // The reported geometry: the drag released over the editor, the producers
    // `preventDefault()` their mousedown so focus never left `.ProseMirror`, and
    // pre-389 Enter went straight into the user's prose behind an open modal.
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    document.body.appendChild(editor);
    const pmSaw = vi.fn();
    editor.addEventListener("keydown", pmSaw);

    const { onConfirm } = renderConfirm();
    editor.focus();

    pressEnter(editor);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    // Stopped at window CAPTURE, so ProseMirror's own handler never runs.
    expect(pmSaw).not.toHaveBeenCalled();
    editor.remove();
  });

  it("still confirms when the cued button DOES hold focus — exactly once", () => {
    const { onConfirm } = renderConfirm();
    const cued = screen.getByRole("button", { name: "Re-anchor" });
    act(() => cued.focus());
    expect(document.activeElement).toBe(cued);

    pressEnter(cued);

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("composes with task 386: a DANGER confirm cues Cancel, so Enter CANCELS", () => {
    const { onConfirm, onCancel } = renderConfirm({
      tone: "danger",
      confirmLabel: "Delete",
    });
    focusBody();

    pressEnter(document.body);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("a single-button DANGER notice cues nothing, so Enter does nothing", () => {
    const { onConfirm } = renderConfirm({
      tone: "danger",
      hideCancel: true,
      confirmLabel: "Delete",
    });
    focusBody();

    pressEnter(document.body);

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("a DISABLED cued default is not pressed", () => {
    const onOk = vi.fn();
    render(
      <SystemDialog open onClose={() => {}}>
        <SystemDialogHeader title="Busy" />
        <SystemDialogFooter>
          <SystemDialogButton autoFocus disabled onClick={onOk}>
            OK
          </SystemDialogButton>
        </SystemDialogFooter>
      </SystemDialog>,
    );
    flushFrames();
    focusBody();

    pressEnter(document.body);

    expect(onOk).not.toHaveBeenCalled();
  });

  it("Escape is unchanged", () => {
    const { onCancel, onConfirm } = renderConfirm();
    focusBody();

    pressEscape(document.body);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("a modifier chord and an IME commit are never the dialog's Enter", () => {
    const { onConfirm } = renderConfirm();
    focusBody();

    pressEnter(document.body, { metaKey: true });
    pressEnter(document.body, { ctrlKey: true });
    pressEnter(document.body, { altKey: true });
    // jsdom drops `isComposing`, so the legacy IME signal is what a leg can pin.
    pressEnter(document.body, { keyCode: 229 });

    expect(onConfirm).not.toHaveBeenCalled();
  });
});

/* ── in-frame targets keep their own Enter ───────────────────────── */

function DialogWithBody({
  onOk,
  children,
}: {
  onOk: () => void;
  children: React.ReactNode;
}) {
  return (
    <SystemDialog open onClose={() => {}}>
      <SystemDialogHeader title="Body" />
      <SystemDialogBody>{children}</SystemDialogBody>
      <SystemDialogFooter>
        <SystemDialogButton autoFocus onClick={onOk}>
          Save
        </SystemDialogButton>
      </SystemDialogFooter>
    </SystemDialog>
  );
}

describe("a control INSIDE the dialog that owns Enter keeps it", () => {
  it("a focused textarea types a newline — the cued default does not fire", () => {
    const onOk = vi.fn();
    render(
      <DialogWithBody onOk={onOk}>
        <textarea data-testid="ta" defaultValue="" />
      </DialogWithBody>,
    );
    flushFrames();
    const ta = screen.getByTestId("ta");
    act(() => ta.focus());

    pressEnter(ta);

    expect(onOk).not.toHaveBeenCalled();
  });

  it("a focused contenteditable (a CodeMirror/ProseMirror surface) keeps Enter", () => {
    const onOk = vi.fn();
    render(
      <DialogWithBody onOk={onOk}>
        <div data-testid="ce" contentEditable suppressContentEditableWarning />
      </DialogWithBody>,
    );
    flushFrames();
    const ce = screen.getByTestId("ce");
    // jsdom does not derive `isContentEditable` from the attribute.
    Object.defineProperty(ce, "isContentEditable", { value: true });
    act(() => ce.focus());

    pressEnter(ce);

    expect(onOk).not.toHaveBeenCalled();
  });

  it("a focused <select> keeps Enter", () => {
    const onOk = vi.fn();
    render(
      <DialogWithBody onOk={onOk}>
        <select data-testid="sel" defaultValue="a">
          <option value="a">a</option>
        </select>
      </DialogWithBody>,
    );
    flushFrames();
    const sel = screen.getByTestId("sel");
    act(() => sel.focus());

    pressEnter(sel);

    expect(onOk).not.toHaveBeenCalled();
  });

  it("a focused non-cued BUTTON activates ITSELF, once, and not the cued default", () => {
    const { onConfirm, onCancel } = renderConfirm();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    act(() => cancel.focus());

    pressEnter(cancel);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("a focused radio/checkbox keeps Enter — it must not press the cued default", () => {
    // RENEGOTIATED from this suite's first cut, which asserted the opposite on
    // the theory that Enter would otherwise be dead on a dialog checkbox. Two
    // measurements retired that: `PrintDialog`'s "checkboxes" are `<button>`s
    // (covered by the BUTTON rule), and the one genuine `<input type="radio">`
    // in a dialog is `ManageStylesModal`'s default-style picker — whose cued
    // default is "Done", so pressing it would have closed the whole modal from a
    // key that did nothing before 389. The defect asserted as the contract; the
    // reason is stated here rather than the leg quietly re-scoped.
    const onOk = vi.fn();
    render(
      <DialogWithBody onOk={onOk}>
        <input data-testid="radio" type="radio" name="pick" />
        <input data-testid="cb" type="checkbox" />
      </DialogWithBody>,
    );
    flushFrames();
    for (const id of ["radio", "cb"]) {
      const el = screen.getByTestId(id);
      act(() => el.focus());
      pressEnter(el);
    }

    expect(onOk).not.toHaveBeenCalled();
  });

  it("Shift+Enter and a HELD Enter are never the dialog's key", () => {
    const { onConfirm } = renderConfirm();
    focusBody();

    pressEnter(document.body, { shiftKey: true });
    pressEnter(document.body, { repeat: true });

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("a plain single-line <input> SUBMITS to the cued default", () => {
    const onOk = vi.fn();
    render(
      <DialogWithBody onOk={onOk}>
        <input data-testid="name" defaultValue="" />
      </DialogWithBody>,
    );
    flushFrames();
    const input = screen.getByTestId("name");
    act(() => input.focus());

    pressEnter(input);

    expect(onOk).toHaveBeenCalledTimes(1);
  });

  it("…unless that input CONSUMED the key — preventDefault is how a control says 'mine'", () => {
    const onOk = vi.fn();
    const onOwn = vi.fn();
    render(
      <DialogWithBody onOk={onOk}>
        <input
          data-testid="name"
          defaultValue=""
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onOwn();
            }
          }}
        />
      </DialogWithBody>,
    );
    flushFrames();
    const input = screen.getByTestId("name");
    act(() => input.focus());

    pressEnter(input);

    expect(onOwn).toHaveBeenCalledTimes(1);
    expect(onOk).not.toHaveBeenCalled();
  });
});

/* ── the stack ───────────────────────────────────────────────────── */

describe("only the TOP dialog answers a key", () => {
  function TwoDialogs({
    outerOk,
    outerClose,
    innerOk,
    innerClose,
    innerOpen,
  }: {
    outerOk: () => void;
    outerClose: () => void;
    innerOk: () => void;
    innerClose: () => void;
    innerOpen: boolean;
  }) {
    return (
      <>
        <SystemDialog open onClose={outerClose}>
          <SystemDialogHeader title="Manage styles" />
          <SystemDialogFooter>
            <SystemDialogButton autoFocus onClick={outerOk}>
              Done
            </SystemDialogButton>
          </SystemDialogFooter>
        </SystemDialog>
        {innerOpen && (
          <SystemDialog open onClose={innerClose}>
            <SystemDialogHeader title="Edit style" />
            <SystemDialogFooter>
              <SystemDialogButton autoFocus onClick={innerOk}>
                Save
              </SystemDialogButton>
            </SystemDialogFooter>
          </SystemDialog>
        )}
      </>
    );
  }

  it("DEFECT: Enter presses ONE cued default — the nested dialog's", () => {
    const outerOk = vi.fn();
    const innerOk = vi.fn();
    render(
      <TwoDialogs
        outerOk={outerOk}
        outerClose={() => {}}
        innerOk={innerOk}
        innerClose={() => {}}
        innerOpen
      />,
    );
    flushFrames();
    focusBody();

    pressEnter(document.body);

    expect(innerOk).toHaveBeenCalledTimes(1);
    expect(outerOk).not.toHaveBeenCalled();
  });

  it("DEFECT: Escape closes ONE dialog — the nested one (pre-389 it closed both)", () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    render(
      <TwoDialogs
        outerOk={() => {}}
        outerClose={outerClose}
        innerOk={() => {}}
        innerClose={innerClose}
        innerOpen
      />,
    );
    flushFrames();
    focusBody();

    pressEscape(document.body);

    expect(innerClose).toHaveBeenCalledTimes(1);
    expect(outerClose).not.toHaveBeenCalled();
  });

  it("the host takes the keyboard back when the nested dialog closes", () => {
    const outerOk = vi.fn();
    function Host() {
      const [innerOpen, setInnerOpen] = useState(true);
      useEffect(() => {
        setInnerOpen(false);
      }, []);
      return (
        <TwoDialogs
          outerOk={outerOk}
          outerClose={() => {}}
          innerOk={() => {}}
          innerClose={() => {}}
          innerOpen={innerOpen}
        />
      );
    }
    render(<Host />);
    flushFrames();
    focusBody();

    pressEnter(document.body);

    expect(outerOk).toHaveBeenCalledTimes(1);
  });
});

/* ── the scrimless variants are NOT modal ────────────────────────── */

describe("a scrimless window owns nothing outside its own frame", () => {
  it("Enter typed in the document does not press a draggable window's cued default", () => {
    const onSave = vi.fn();
    render(
      <SystemDialog open variant="draggable" onClose={() => {}}>
        <SystemDialogHeader title="Preferences" />
        <SystemDialogFooter>
          <SystemDialogButton autoFocus onClick={onSave}>
            Save
          </SystemDialogButton>
        </SystemDialogFooter>
      </SystemDialog>,
    );
    flushFrames();
    focusBody();

    pressEnter(document.body);

    expect(onSave).not.toHaveBeenCalled();
  });

  it("…but Enter from INSIDE it still presses the cued default", () => {
    const onSave = vi.fn();
    render(
      <SystemDialog open variant="draggable" onClose={() => {}}>
        <SystemDialogHeader title="Preferences" />
        <SystemDialogBody>
          <input data-testid="pref" defaultValue="" />
        </SystemDialogBody>
        <SystemDialogFooter>
          <SystemDialogButton autoFocus onClick={onSave}>
            Save
          </SystemDialogButton>
        </SystemDialogFooter>
      </SystemDialog>,
    );
    flushFrames();
    const input = screen.getByTestId("pref");
    act(() => input.focus());

    pressEnter(input);

    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

/* ── the focus half (suspenders) ─────────────────────────────────── */

describe("initial focus lands inside the dialog", () => {
  it("the cued default takes focus — and the rAF is scheduled from the commit where the portal EXISTS", () => {
    renderConfirm();
    // `renderConfirm` already flushed one frame batch. Pre-389 the rAF was
    // scheduled from the FIRST commit, where `mounted` is false, the portal has
    // not rendered and every ref is null — so whether focus landed depended on
    // React flushing the `setMounted(true)` re-render before the frame arrived.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Re-anchor" }),
    );
  });

  it("the focus frame is scheduled from a commit where the dialog EXISTS", () => {
    // The 389 focus half, asserted STRUCTURALLY because the failure it closes is
    // a real-browser timing race jsdom cannot reproduce: with a hand-pumped rAF
    // queue every callback runs long after React has settled, so a callback
    // scheduled too EARLY still finds its refs. What can be observed is the thing
    // that made the race losable — pre-389 the focus rAF was scheduled from the
    // dialog's FIRST commit, where `mounted` is still false, `SystemDialog`
    // returns `null`, and there is no portal, no button and no frame to focus.
    // React schedules the `setMounted(true)` re-render as a Scheduler task while
    // the rAF is tied to the frame, so on a busy main thread (the end of a drag:
    // gesture-end edge, mint transaction, RO settle) the frame arrives first and
    // the callback focuses NOTHING — which is exactly how the reported dialog
    // opened with focus still on `.ProseMirror`. There was never a thief, only a
    // claim that missed.
    const sawDialogAtSchedule: boolean[] = [];
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      sawDialogAtSchedule.push(!!document.querySelector('[role="dialog"] button'));
      rafs.push(cb);
      return rafs.length;
    }) as typeof window.requestAnimationFrame;

    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Re-anchor this snippet?"
        message="…"
        confirmLabel="Re-anchor"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(sawDialogAtSchedule).not.toHaveLength(0);
    expect(sawDialogAtSchedule.every(Boolean)).toBe(true);
  });

  it("stands DOWN when the dialog's own body already claimed focus", () => {
    // The body component mounts INSIDE the portal, so its effect runs in the
    // commit that first renders the dialog — the shape every real prompt-style
    // dialog has (NewDocumentModal's name field, TexFilePickerModal's file list).
    function ClaimingInput() {
      const ref = useRef<HTMLInputElement>(null);
      useEffect(() => {
        ref.current?.focus();
      }, []);
      return <input ref={ref} data-testid="claimed" defaultValue="" />;
    }
    render(
      <DialogWithBody onOk={() => {}}>
        <ClaimingInput />
      </DialogWithBody>,
    );
    flushFrames();

    expect(document.activeElement).toBe(screen.getByTestId("claimed"));
  });

  it("REAL prompt dialog: the input keeps focus and Enter still submits it", async () => {
    let ask: ((o: { title: string; initial?: string }) => Promise<string | null>) | null =
      null;
    function Host() {
      const api = useSystemDialog();
      ask = api.prompt;
      return null;
    }
    render(
      <SystemDialogProvider>
        <Host />
      </SystemDialogProvider>,
    );

    let answer: string | null | undefined;
    await act(async () => {
      void ask!({ title: "Rename", initial: "draft" }).then((v) => {
        answer = v;
      });
    });
    flushFrames();

    const input = document.querySelector<HTMLInputElement>(
      'input[value="draft"], input',
    )!;
    expect(document.activeElement).toBe(input);

    pressEnter(input);
    await act(async () => {});

    expect(answer).toBe("draft");
  });

  it("a dialog that DECLARES no cue and registers one anyway is loud in dev", () => {
    // What makes `noCuedDefault` a live prop rather than a marker only the
    // census reads — a suite is not a consumer (task 202).
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <SystemDialog open onClose={() => {}} noCuedDefault>
        <SystemDialogHeader title="Contradiction" />
        <SystemDialogFooter>
          <SystemDialogButton autoFocus onClick={() => {}}>
            Go
          </SystemDialogButton>
        </SystemDialogFooter>
      </SystemDialog>,
    );
    flushFrames();

    expect(err).toHaveBeenCalledWith(
      expect.stringContaining("noCuedDefault"),
      expect.anything(),
    );
  });

  it("falls back to the FRAME when no button cues itself", () => {
    render(
      <SystemDialog open onClose={() => {}} noCuedDefault>
        <SystemDialogHeader title="Pick a file" />
        <SystemDialogFooter>
          <SystemDialogButton onClick={() => {}}>Cancel</SystemDialogButton>
        </SystemDialogFooter>
      </SystemDialog>,
    );
    flushFrames();

    const active = document.activeElement as HTMLElement;
    expect(active).not.toBe(document.body);
    expect(active.getAttribute("tabindex")).toBe("-1");
  });
});

/* ── the body's own claim on initial focus ───────────────────────── */

describe("a dialog whose BODY owns initial focus gets it", () => {
  // The shell renders `null` until `mounted`, so a CALLER's `useEffect(…, [])`
  // fires in a commit where the body is not in the DOM: the ref is null, the
  // effect never re-runs, and the field is never focused. Three shipped dialogs
  // had exactly that shape and nobody noticed, because the shell's frame
  // fallback focuses SOMETHING and the dialog looks fine. `TexFilePickerModal`
  // was the worst of them — no focused row AND (by design) no cued default, so
  // `Return` in it did nothing at all, which is the symptom 389 exists to remove
  // and which this suite's own census then pinned as deliberate.
  //
  // Both legs drive the REAL dialogs, because the defect was a caller's mount
  // effect, not anything a test of the shell can see.

  it("TexFilePickerModal focuses its first file row (so Enter opens that file)", () => {
    const onSelect = vi.fn();
    render(
      <TexFilePickerModal
        folderName="Paper"
        texFiles={["main.tex", "other.tex"]}
        onSelect={onSelect}
        onCreateNew={() => {}}
        onCancel={() => {}}
      />,
    );
    flushFrames();

    const active = document.activeElement as HTMLElement;
    expect(active.tagName).toBe("BUTTON");
    expect(active.textContent).toContain("main.tex");

    pressEnter(active);
    expect(onSelect).toHaveBeenCalledWith("main.tex");
  });

  it("NewDocumentModal focuses and selects its name field", () => {
    render(<NewDocumentModal onCreate={async () => {}} onCancel={() => {}} />);
    flushFrames();

    const active = document.activeElement as HTMLInputElement;
    expect(active.tagName).toBe("INPUT");
    expect(active.placeholder).toBe("My paper");
  });

  it("the cued default still answers Enter from OUTSIDE, with the body focused", () => {
    const onCreate = vi.fn(async () => {});
    render(<NewDocumentModal onCreate={onCreate} onCancel={() => {}} />);
    flushFrames();
    const input = document.activeElement as HTMLInputElement;
    act(() => {
      input.focus();
      // The Create cue is `disabled` until the name is non-empty.
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "Paper");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    pressEnter(input);

    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});

/* ── two NON-MODAL windows: the owner is the one you are IN ──────── */

describe("between two scrimless windows, focus decides the owner", () => {
  function TwoWindows({
    firstClose,
    secondClose,
  }: {
    firstClose: () => void;
    secondClose: () => void;
  }) {
    return (
      <>
        <SystemDialog open variant="draggable" onClose={firstClose}>
          <SystemDialogHeader title="Bug report" />
          <SystemDialogBody>
            <input data-testid="in-first" defaultValue="" />
          </SystemDialogBody>
        </SystemDialog>
        <SystemDialog open variant="draggable" onClose={secondClose}>
          <SystemDialogHeader title="Preferences" />
          <SystemDialogBody>
            <input data-testid="in-second" defaultValue="" />
          </SystemDialogBody>
        </SystemDialog>
      </>
    );
  }

  it("Escape closes the window CONTAINING focus, not the one that opened last", () => {
    // `BugReportWindow` and `PreferencesModal` are both `variant="draggable"`,
    // both rendered side by side in EditorLayout, and both can be open at once —
    // so mount order is not "the one the user is in". Pre-fix, Escape typed in
    // the first window closed the SECOND.
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    render(<TwoWindows firstClose={firstClose} secondClose={secondClose} />);
    flushFrames();
    const input = screen.getByTestId("in-first");
    act(() => input.focus());

    pressEscape(input);

    expect(firstClose).toHaveBeenCalledTimes(1);
    expect(secondClose).not.toHaveBeenCalled();
  });

  it("…and mount order still decides when focus is in neither", () => {
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    render(<TwoWindows firstClose={firstClose} secondClose={secondClose} />);
    flushFrames();
    focusBody();

    pressEscape(document.body);

    expect(secondClose).toHaveBeenCalledTimes(1);
    expect(firstClose).not.toHaveBeenCalled();
  });

  it("a MODAL outranks a focused non-modal window — modality IS the claim", () => {
    const windowClose = vi.fn();
    const modalClose = vi.fn();
    render(
      <>
        <SystemDialog open variant="draggable" onClose={windowClose}>
          <SystemDialogHeader title="Preferences" />
          <SystemDialogBody>
            <input data-testid="in-window" defaultValue="" />
          </SystemDialogBody>
        </SystemDialog>
        <SystemDialog open onClose={modalClose}>
          <SystemDialogHeader title="Confirm" />
        </SystemDialog>
      </>,
    );
    flushFrames();
    const input = screen.getByTestId("in-window");
    act(() => input.focus());

    pressEscape(input);

    expect(modalClose).toHaveBeenCalledTimes(1);
    expect(windowClose).not.toHaveBeenCalled();
  });
});

/* ── the imperative door the drop-mode confirm awaits ────────────── */

describe("useConfirmDialog: the promise resolves on Enter alone", () => {
  it("resolves TRUE with focus nowhere near the dialog", async () => {
    let ask: ((o: { title: string; message: string }) => Promise<boolean>) | null = null;
    function Host() {
      const { confirm, dialog } = useConfirmDialog();
      ask = confirm;
      return <>{dialog}</>;
    }
    render(<Host />);

    let resolved: boolean | null = null;
    await act(async () => {
      void ask!({ title: "Re-anchor this note?", message: "…" }).then((v) => {
        resolved = v;
      });
    });
    flushFrames();
    focusBody();

    pressEnter(document.body);
    await act(async () => {});

    expect(resolved).toBe(true);
  });
});
