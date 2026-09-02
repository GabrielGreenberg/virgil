// @vitest-environment jsdom
//
/**
 * Task 531 — **every dialog stole DOM focus and none gave it back.**
 *
 * `SystemDialog` has moved focus INTO the dialog on every open since task 389,
 * exhaustively and with a whole doctrine behind it. It restored NOTHING on
 * close: the focused element unmounted with the portal, `document.activeElement`
 * degraded to `<body>`, and the caret of a user whose main surface is a
 * contenteditable was simply gone. Dismiss any dialog and the next keystrokes
 * went nowhere; `Cmd-Z` did nothing; `Tab` restarted from the top of the
 * document.
 *
 * The codebase already knew and worked around it at exactly ONE site —
 * `drag-handle-actions.ts` re-focused the editor after its own confirm and said
 * why: *"a confirm dialog whose close orphans focus on the body; without this
 * re-focus, Cmd-Z does nothing until the user clicks back into the editor."*
 * That is the defect, described precisely, patched in one handler.
 *
 * **This is not the recorded posture.** STYLE_GUIDE declines a focus TRAP,
 * deliberately, and says nothing about restore — they are different obligations:
 * a trap CONTAINS keyboard movement, a restore declines to STRAND a caret.
 *
 * Every behavioural leg drives a REAL dialog (ConfirmDialog → SystemDialog, or
 * a bare `SystemDialog`) and closes it by a REAL path, because the part that
 * misbehaved was the shell and there is nothing in any dialog's markup to test.
 *
 * The leg with TEETH is the CENSUS at the bottom. The shell was never the part
 * that could misbehave once it captures at all; a dialog body that claims focus
 * BEHIND the shell's back is — React commits a host node's `autoFocus` in the
 * LAYOUT pass, children-then-self, so it beats every effect the shell can
 * schedule and would leave that one dialog silently restore-less. `initialFocus`
 * runs inside the shell's own focus rAF, i.e. AFTER the capture, which is why it
 * is the only sanctioned way for a body to claim focus.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The repo-wide gotcha: something on this import chain reaches `@/lib/storage`,
// whose backend `require` is not resolvable under vitest.
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

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import ConfirmDialog from "../ConfirmDialog";
import SystemDialog, {
  SystemDialogBody,
  SystemDialogButton,
  SystemDialogFooter,
  SystemDialogHeader,
} from "../system-dialog";
import { __resetDialogStack } from "../dialog-stack";
import { dialogElements, SRC_ROOT } from "./_dialog-sites";
import { elementsNamed } from "@/lib/__tests__/_source-scan";

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

let sentinel: HTMLButtonElement;

beforeEach(() => {
  realRaf = window.requestAnimationFrame;
  realCaf = window.cancelAnimationFrame;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafs.push(cb);
    return rafs.length;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;

  // The element the user's focus was on when the dialog opened. A REAL button in
  // the document, not a mock: what the shell captures is `document.activeElement`
  // and what it restores is `.focus()`, so both halves have to be real DOM.
  sentinel = document.createElement("button");
  sentinel.textContent = "sentinel";
  document.body.appendChild(sentinel);
  sentinel.focus();
});

afterEach(() => {
  cleanup();
  sentinel.remove();
  rafs.length = 0;
  window.requestAnimationFrame = realRaf;
  window.cancelAnimationFrame = realCaf;
  __resetDialogStack();
  vi.restoreAllMocks();
});

function pressEscape(target: EventTarget = document.body) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
}

function pressEnter(target: EventTarget = document.body) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function mouseDown(el: EventTarget) {
  act(() => {
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  });
}

/**
 * The class-A lifecycle — the one every `useConfirmDialog()` / `useSystemDialog()`
 * consumer has: the component that renders `<SystemDialog>` is itself mounted
 * only while the dialog is up (`pending ? … : null`).
 */
function ConfirmHarness({
  onDone,
  ...rest
}: { onDone: () => void } & Partial<React.ComponentProps<typeof ConfirmDialog>>) {
  const [open, setOpen] = useState(true);
  const close = () => {
    setOpen(false);
    onDone();
  };
  return open ? (
    <ConfirmDialog
      open
      title="Delete this note?"
      message="This cannot be undone."
      confirmLabel="Delete"
      /* A destructive confirm cues CANCEL (task 386), so "Cancel" here is the
         cued default and "Delete" is the other footer button. */
      tone="danger"
      onConfirm={close}
      onCancel={close}
      {...rest}
    />
  ) : null;
}

/**
 * The class-B lifecycle — `<ConfirmDialog open={confirmOpen}>` rendered
 * unconditionally (`TodoRow`, `panel-primitives`, `SourcePodNodeView`,
 * `AIWindow`, `CitationsPanel`). Its portal appears in the SAME commit as
 * `open=true`, so it is the shape that would break a capture written any later
 * than the shell's own effect.
 */
function AlwaysMountedConfirm() {
  const [open, setOpen] = useState(true);
  return (
    <ConfirmDialog
      open={open}
      title="Delete this todo?"
      message="This cannot be undone."
      confirmLabel="Delete"
      onConfirm={() => setOpen(false)}
      onCancel={() => setOpen(false)}
    />
  );
}

/** A bare scrimless (draggable) window — `PreferencesModal`'s shape. */
function DraggableHarness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return open ? (
    <SystemDialog
      open
      variant="draggable"
      onClose={() => {
        setOpen(false);
        onClose();
      }}
      dismissIsFree
      noCuedDefault
    >
      <SystemDialogHeader title="Preferences" />
      <SystemDialogBody>
        <p>Nothing here.</p>
      </SystemDialogBody>
    </SystemDialog>
  ) : null;
}

/* ── the defect: every close path gives focus back ───────────────── */

describe("closing a dialog returns focus to whatever held it", () => {
  it("DEFECT: the CUED DEFAULT — focus comes back to the trigger", () => {
    const onDone = vi.fn();
    render(<ConfirmHarness onDone={onDone} />);
    flushFrames();
    // The shell took the focus, which is the premise the whole task rests on.
    expect(document.activeElement).not.toBe(sentinel);

    click(screen.getByRole("button", { name: "Cancel" }));

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(sentinel);
  });

  it("DEFECT: ANOTHER footer button (the non-cued answer)", () => {
    render(<ConfirmHarness onDone={vi.fn()} />);
    flushFrames();

    click(screen.getByRole("button", { name: "Delete" }));

    expect(document.activeElement).toBe(sentinel);
  });

  it("DEFECT: ESCAPE", () => {
    render(<ConfirmHarness onDone={vi.fn()} />);
    flushFrames();

    pressEscape(document.body);

    expect(document.activeElement).toBe(sentinel);
  });

  it("DEFECT: ENTER on the cued default", () => {
    render(<ConfirmHarness onDone={vi.fn()} />);
    flushFrames();

    pressEnter(document.body);

    expect(document.activeElement).toBe(sentinel);
  });

  it("DEFECT: the BACKDROP", () => {
    render(<ConfirmHarness onDone={vi.fn()} />);
    flushFrames();
    // The scrim is the frame's parent; a click whose target IS the scrim closes.
    const scrim = document.querySelector('[role="dialog"][aria-modal="true"]');
    expect(scrim).toBeTruthy();
    click(scrim!);

    expect(document.activeElement).toBe(sentinel);
  });

  it("DEFECT: a scrimless window's OUTSIDE MOUSEDOWN", () => {
    const onClose = vi.fn();
    render(<DraggableHarness onClose={onClose} />);
    flushFrames();
    // The outside-click listener is rAF-armed so the opening mousedown on the
    // trigger cannot immediately re-close it.
    flushFrames();

    // A NON-focusable outside target, which is the ordinary case (a panel
    // background, the scrim of nothing). One that IS focusable is a deliberate
    // claim and gets the stand-down leg below.
    const elsewhere = document.createElement("div");
    document.body.appendChild(elsewhere);
    mouseDown(elsewhere);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(sentinel);
    elsewhere.remove();
  });

  it("DEFECT: a PROGRAMMATIC close (the parent simply stops rendering it)", () => {
    const { rerender } = render(<AlwaysMountedConfirm />);
    flushFrames();
    expect(document.activeElement).not.toBe(sentinel);

    // Nothing was clicked and no key was pressed — the caller closed us.
    act(() => {
      rerender(<div />);
    });

    expect(document.activeElement).toBe(sentinel);
  });

  it("DEFECT: the ALWAYS-MOUNTED shape, whose portal appears in the open commit", () => {
    render(<AlwaysMountedConfirm />);
    flushFrames();

    click(screen.getByRole("button", { name: "Cancel" }));

    expect(document.activeElement).toBe(sentinel);
  });

  it("restores with preventScroll — a restore is a focus, not a navigation", () => {
    const spy = vi.spyOn(sentinel, "focus");
    render(<ConfirmHarness onDone={vi.fn()} />);
    flushFrames();
    spy.mockClear();

    pressEscape(document.body);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ preventScroll: true });
  });
});

/* ── the accepting controls ──────────────────────────────────────── */

describe("it fails SAFE and stands DOWN", () => {
  it("CONTROL: a trigger that has since UNMOUNTED restores nothing and does not throw", () => {
    render(<ConfirmHarness onDone={vi.fn()} />);
    flushFrames();

    // The shape of the real case: the confirm's own action deleted the card, so
    // the trash button that opened it is gone by the time the dialog closes.
    sentinel.remove();

    expect(() => pressEscape(document.body)).not.toThrow();
    expect(document.activeElement).toBe(document.body);
  });

  it("CONTROL: something else claimed focus during the close — it keeps it", () => {
    const other = document.createElement("button");
    document.body.appendChild(other);

    render(
      <ConfirmHarness
        onDone={() => {
          // A handler that focuses a fresh card, the editor, a next dialog.
          other.focus();
        }}
      />,
    );
    flushFrames();

    click(screen.getByRole("button", { name: "Cancel" }));

    expect(document.activeElement).toBe(other);
    expect(document.activeElement).not.toBe(sentinel);
    other.remove();
  });

  it("CONTROL: an outside mousedown that lands on a real CONTROL is not undone", () => {
    render(<DraggableHarness onClose={vi.fn()} />);
    flushFrames();
    flushFrames();

    const outsideButton = document.createElement("button");
    document.body.appendChild(outsideButton);
    // A real mousedown on a button focuses it; jsdom does not, so do it here —
    // what is under test is the shell's stand-down, not jsdom's focus emulation.
    act(() => outsideButton.focus());
    mouseDown(outsideButton);

    expect(document.activeElement).toBe(outsideButton);
    outsideButton.remove();
  });

  it("CONTROL: nothing was focused at open ⇒ nothing to give back, and no throw", () => {
    act(() => sentinel.blur());
    expect(document.activeElement).toBe(document.body);

    render(<ConfirmHarness onDone={vi.fn()} />);
    flushFrames();

    expect(() => pressEscape(document.body)).not.toThrow();
    expect(document.activeElement).toBe(document.body);
  });

  it("CONTROL: it still puts focus INSIDE the dialog on open (task 389, unchanged)", () => {
    render(<ConfirmHarness onDone={vi.fn()} />);
    flushFrames();

    const cued = screen.getByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(cued);
  });
});

/* ── it composes with the STACK ──────────────────────────────────── */

describe("a nested dialog hands focus back to the one beneath it", () => {
  function Nested() {
    const [inner, setInner] = useState(false);
    return (
      <>
        <SystemDialog open onClose={() => {}} dismissIsFree noCuedDefault>
          <SystemDialogHeader title="Manage styles" />
          <SystemDialogBody>
            <button type="button" onClick={() => setInner(true)}>
              open inner
            </button>
          </SystemDialogBody>
        </SystemDialog>
        {inner ? (
          <SystemDialog open onClose={() => setInner(false)} dismissIsFree>
            <SystemDialogHeader title="Edit style" />
            <SystemDialogBody>
              <p>inner</p>
            </SystemDialogBody>
            <SystemDialogFooter>
              <SystemDialogButton autoFocus onClick={() => setInner(false)}>
                Close inner
              </SystemDialogButton>
            </SystemDialogFooter>
          </SystemDialog>
        ) : null}
      </>
    );
  }

  it("closing the inner dialog restores focus INTO the outer one", () => {
    render(<Nested />);
    flushFrames();

    const opener = screen.getByRole("button", { name: "open inner" });
    act(() => opener.focus());
    click(opener);
    flushFrames();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Close inner" }),
    );

    click(screen.getByRole("button", { name: "Close inner" }));

    // Back into the OUTER dialog, not out to the sentinel behind both of them —
    // which is the behaviour the LIFO already implies for keys.
    expect(document.activeElement).toBe(opener);
  });
});

/* ── the leg with teeth: a body claims focus through the SHELL ───── */

/**
 * Component names that mean "a user can type here". Same vocabulary
 * `_dialog-sites.ts` uses for the draft census — a `Select` is a choice, not a
 * field, and nothing about a picker's `autoFocus` races the capture in a way
 * that matters (it is a button as far as focus is concerned).
 */
const FIELD_TAGS = ["Input", "Textarea", "CodeMirror", "input", "textarea"];

/**
 * Sites that carry a raw DOM `autoFocus` on a field inside a `<SystemDialog>`
 * subtree and are nonetheless SAFE.
 *
 * Keyed per FILE with the shape that justifies it (task 204's rule) — and the
 * shape here is MID-LIFE: a field that cannot exist in the dialog's first render
 * cannot race a capture that happened on the open edge. The list may only
 * SHRINK; a new entry is a design question, not a line to add.
 */
const PERMITTED_RAW_AUTOFOCUS: Record<string, string> = {
  "components/ManageStylesModal.tsx":
    "the RENAME field, rendered only behind `isRenaming ?` — it appears mid-life, " +
    "long after the shell captured on the open edge, so it can never outrun it. " +
    "(And focus landing there IS a valid capture target for a dialog opened on top.)",
};

/**
 * `<Tag …autoFocus…>` where Tag is a field — read through the SHARED tag
 * scanner, never a `[^>]*` class.
 *
 * `onKeyDown={(e) => …}` is this repo's dominant idiom and its arrow TRUNCATES
 * a `[^>]*` tag match at the `=>`, which is exactly the trap `_dialog-sites.ts`
 * records about its own scan — and, measured, exactly what made the first cut
 * of this census blind to `CollaboratorIdentityDialog`, the one offender it was
 * written for. `elementsNamed` scans to the tag's real end.
 */
function rawAutoFocusFields(subtree: string): string[] {
  const out: string[] = [];
  for (const tag of FIELD_TAGS) {
    for (const hit of elementsNamed(subtree, tag)) {
      if (/\bautoFocus\b/.test(hit.tag)) {
        out.push(hit.tag.replace(/\s+/g, " ").slice(0, 90));
      }
    }
  }
  return out;
}

describe("CENSUS — a dialog body claims initial focus through the SHELL", () => {
  it("no <SystemDialog> subtree carries a raw DOM autoFocus on a field", () => {
    const offenders: string[] = [];
    for (const { rel, subtree } of dialogElements()) {
      if (rel in PERMITTED_RAW_AUTOFOCUS) continue;
      for (const hit of rawAutoFocusFields(subtree)) {
        offenders.push(`${rel} — ${hit}`);
      }
    }
    // A raw `autoFocus` fires in React's LAYOUT pass, children-then-self, so it
    // beats every effect the shell can schedule; the body would then be what the
    // shell captures, and that dialog would silently have no restore. Say
    // `initialFocus` instead — the shell runs it inside its own focus rAF.
    expect(offenders).toEqual([]);
  });

  it("the census can SEE the shape it forbids", () => {
    // A canary on a SYNTHETIC fixture, never on a production line: a canary that
    // stands on the defect evaporates the moment the defect is drained.
    expect(
      rawAutoFocusFields('<SystemDialogBody><Input autoFocus value={x} /></SystemDialogBody>'),
    ).toHaveLength(1);
    expect(
      rawAutoFocusFields('<SystemDialogBody><Input value={x} /></SystemDialogBody>'),
    ).toHaveLength(0);
    // …and the shape a `[^>]*` tag class truncates: an arrow-function handler
    // puts a `>` INSIDE the tag, which is how this census's own first cut went
    // blind to the one production offender it was written for.
    expect(
      rawAutoFocusFields(
        '<Input onKeyDown={(e) => submit(e)} placeholder="x" autoFocus className="y" />',
      ),
    ).toHaveLength(1);
    // A cued BUTTON is not a field and is the shell's own vocabulary.
    expect(
      rawAutoFocusFields('<SystemDialogButton autoFocus>Save</SystemDialogButton>'),
    ).toHaveLength(0);
  });

  it("every exemption still EXCUSES something", () => {
    // An exemption that has stopped excusing anything is a standing licence for
    // the next raw claim added under the exempted name.
    for (const rel of Object.keys(PERMITTED_RAW_AUTOFOCUS)) {
      const sites = dialogElements().filter((s) => s.rel === rel);
      expect(sites.length, `${rel} renders no <SystemDialog>`).toBeGreaterThan(0);
      const hits = sites.flatMap((s) => rawAutoFocusFields(s.subtree));
      expect(hits.length, `${rel} no longer carries a raw autoFocus`).toBeGreaterThan(0);
    }
  });

  it("the SHELL is the only place a focus restore is spelled", () => {
    // The shell was never the part that could misbehave; a dialog that re-forks
    // the restore in its own `onClose` is — which is the shape that produced this
    // finding, one site patched and the rest not.
    const shell = readFileSync(join(SRC_ROOT, "components/system-dialog.tsx"), "utf8");
    expect(shell).toContain("preventScroll: true");
    expect(shell).toMatch(/document\.activeElement/);
  });

  it("CollaboratorIdentityDialog takes the shell's door, not a raw autoFocus", () => {
    // Named because it was the ONE offender, and because the conversion is what
    // makes the census's premise true rather than a coincidence of which dialogs
    // happen to exist.
    const src = readFileSync(
      join(SRC_ROOT, "components/CollaboratorIdentityDialog.tsx"),
      "utf8",
    );
    expect(src).toContain("initialFocus={");
    expect(rawAutoFocusFields(src)).toEqual([]);
  });
});
