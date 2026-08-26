// @vitest-environment jsdom
/**
 * Task 492 — **"Don't show this again" is a capability of the confirm DOOR.**
 *
 * Gabriel, from a real paper: *"Give 'do not show again' option for prompt that
 * comes up when deliberately dragging/reanchoring margin items."* The gesture
 * that raises that prompt is a full drag onto one paragraph's margin — the most
 * deliberate thing the app asks for — and its outcome is reversible, so once
 * read the question is pure friction.
 *
 * The capability could have been a `localStorage` check inside
 * `textObjectSideReanchorSpec`. It is not, because the app already had ONE
 * suppressible confirm and it had grown THREE hand-rolled copies of the idea in
 * a single caller: a `suppressArchiveAtomWarning` field on `ViewPrefs`, a
 * hand-authored `<input type="checkbox">` inside the dialog's own `message`, and
 * a hand-written `if (suppressed) { …; return; }` at the call site. A second
 * bespoke copy would have made two.
 *
 * So the door owns it, and BOTH confirms declare one `suppressId`. The legs with
 * TEETH are the census ones at the bottom: the door was never the part that can
 * misbehave — a caller that re-forks the checkbox, or one that renders a
 * CONTROLLED `<ConfirmDialog suppressId>` (which can show the checkbox but can
 * never SHORT-CIRCUIT, i.e. a control that appears to work and doesn't), is.
 * Neither is visible to any behavioural test of the door.
 */

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

let mockPlacement: Placement | null = null;
vi.mock("../drop-mode/hit-test", () => ({
  hitTest: () => mockPlacement,
  isUnmintedParagraphId: () => false,
  mintPlacementUuid: (_e: unknown, id: string) => id,
}));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Schema, type Node as PMNode } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import {
  beginDropSession,
  cancelDropSession,
  commitDropSession,
  setDropCtx,
} from "../drop-mode/controller";
import type {
  DropCtx,
  ParagraphAnchorApi,
  Placement,
} from "../drop-mode/types";
import { useConfirmDialog } from "../ConfirmDialog";
import { __resetDialogStack } from "../dialog-stack";
import {
  SUPPRESSIBLE_CONFIRM_IDS,
  SUPPRESSIBLE_CONFIRM_LABELS,
  __resetConfirmSuppressionsForTest,
  getSuppressedConfirms,
  isConfirmSuppressed,
  restoreAllConfirms,
  suppressConfirm,
  type SuppressibleConfirmId,
} from "../confirm-suppression";
import {
  commentsStripped,
  trackedFiles,
  REPO_ROOT,
} from "@/lib/__tests__/_source-scan";

/* ── fixture ─────────────────────────────────────────────────────── */

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "inline*",
      attrs: { uuid: { default: null } },
      toDOM: () => ["p", 0],
    },
    text: { group: "inline" },
  },
});

function buildDoc(): PMNode {
  return schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create({ uuid: "OLD" }, schema.text("first")),
    schema.nodes.paragraph.create({ uuid: "NEW" }, schema.text("second")),
  ]);
}

const CARD_KEY = "note:N1";

/* ── the rAF pump (jsdom has no frame clock worth trusting) ──────── */
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
  mockPlacement = null;
  __resetConfirmSuppressionsForTest();
  realRaf = window.requestAnimationFrame;
  realCaf = window.cancelAnimationFrame;
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafs.push(cb);
    return rafs.length;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => {}) as typeof window.cancelAnimationFrame;
});

afterEach(() => {
  cancelDropSession();
  setDropCtx(null);
  cleanup();
  rafs.length = 0;
  window.requestAnimationFrame = realRaf;
  window.cancelAnimationFrame = realCaf;
  __resetDialogStack();
  __resetConfirmSuppressionsForTest();
  vi.restoreAllMocks();
});

interface Harness {
  editor: Editor;
  anchoredTo: string[];
  removed: string[];
  /** How many times a dialog has actually MOUNTED. The measure with teeth: a
   *  suppressed confirm must cost ZERO. */
  mounts: () => number;
}

/** The REAL confirm door the `DropModeProvider` mounts, handed to the REAL
 *  drop controller. */
function harness(): Harness {
  const doc = buildDoc();
  const editor = {
    state: EditorState.create({ schema, doc }),
    schema,
    view: { dispatch: () => {}, focus: () => {} },
  } as unknown as Editor;

  const anchoredTo: string[] = [];
  const removed: string[] = [];
  const notes: ParagraphAnchorApi = {
    exists: () => true,
    getAnchorTextObjectIds: () =>
      anchoredTo.length ? [...anchoredTo] : ["OLD"],
    addTextObjectLink: (_id, pid) => anchoredTo.push(pid),
    removeTextObjectLink: (_id, pid) => removed.push(pid),
  };

  let confirmFn: DropCtx["confirm"] | null = null;
  let mounts = 0;
  function Host() {
    const { confirm, dialog } = useConfirmDialog();
    confirmFn = confirm as DropCtx["confirm"];
    if (dialog) mounts += 1;
    return <>{dialog}</>;
  }
  render(<Host />);

  const ctx: DropCtx = {
    mainEditor: editor,
    notes,
    confirm: (opts: Parameters<NonNullable<DropCtx["confirm"]>>[0]) =>
      confirmFn!(opts),
  } as unknown as DropCtx;
  setDropCtx(ctx);
  return { editor, anchoredTo, removed, mounts: () => mounts };
}

function sidePlacement(editor: Editor): Placement {
  return {
    kind: "paragraph-side",
    editor,
    paragraphId: "NEW",
    side: "right",
    rect: { x: 0, y: 0, width: 4, height: 20 },
  };
}

async function startAndMove(placement: Placement): Promise<void> {
  mockPlacement = placement;
  beginDropSession({
    cardKey: CARD_KEY,
    origin: { x: 10, y: 10 },
    externalCommit: true,
  });
  window.dispatchEvent(
    new MouseEvent("mousemove", { clientX: 20, clientY: 20, buttons: 1 }),
  );
  await new Promise((r) => setTimeout(r, 30));
}

/** Drive one full re-anchor gesture. Returns once the commit has settled. */
async function dragAndRelease(
  h: Harness,
  answer: (opts: { tickBox: () => void }) => void,
): Promise<void> {
  await startAndMove(sidePlacement(h.editor));
  const commit = commitDropSession();
  await act(async () => {});
  flushFrames();
  answer({
    tickBox: () => {
      const box = document.querySelector<HTMLInputElement>(
        'input[type="checkbox"]',
      );
      if (!box) throw new Error("no suppression checkbox rendered");
      // `fireEvent.click`, not a hand-set `.checked` + synthetic `change`:
      // React's value tracker dedupes a programmatic property write, so the
      // hand-rolled form silently never reaches `onChange`.
      act(() => {
        fireEvent.click(box);
      });
      if (!box.checked) throw new Error("the checkbox did not tick");
    },
  });
  await commit;
  await act(async () => {});
}

function clickButton(label: string) {
  const btn = [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!btn) throw new Error(`no "${label}" button in the dialog`);
  act(() => btn.click());
}

function pressKey(key: string) {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    );
  });
}

/* ── the gesture, end to end ─────────────────────────────────────── */

describe("the re-anchor confirm is suppressible", () => {
  it("unsuppressed: the dialog asks, and confirming persists NOTHING on its own", async () => {
    const h = harness();
    await dragAndRelease(h, () => clickButton("Re-anchor"));

    expect(h.mounts()).toBeGreaterThan(0);
    expect(h.anchoredTo).toEqual(["NEW"]);
    // Confirming WITHOUT the box is not a suppression.
    expect(getSuppressedConfirms()).toEqual([]);
  });

  it("DEFECT: ticking the box and confirming remembers the answer", async () => {
    const h = harness();
    await dragAndRelease(h, ({ tickBox }) => {
      tickBox();
      clickButton("Re-anchor");
    });

    expect(h.anchoredTo).toEqual(["NEW"]);
    expect(isConfirmSuppressed("reanchor-margin-item")).toBe(true);
  });

  it("DEFECT: a suppressed re-anchor lands with ZERO dialog mounts", async () => {
    suppressConfirm("reanchor-margin-item");
    const h = harness();
    const before = h.mounts();

    await startAndMove(sidePlacement(h.editor));
    await commitDropSession();
    await act(async () => {});

    // The spec still ran BOTH doors — only the QUESTION was skipped.
    expect(h.anchoredTo).toEqual(["NEW"]);
    expect(h.removed).toEqual(["OLD"]);
    expect(h.mounts()).toBe(before);
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it("Cancel with the box ticked persists NOTHING — the next drop still asks", async () => {
    const h = harness();
    await dragAndRelease(h, ({ tickBox }) => {
      tickBox();
      clickButton("Cancel");
    });

    expect(h.anchoredTo).toEqual([]);
    expect(getSuppressedConfirms()).toEqual([]);

    const mountsAfterFirst = h.mounts();
    await dragAndRelease(h, () => clickButton("Re-anchor"));
    expect(h.mounts()).toBeGreaterThan(mountsAfterFirst);
    expect(h.anchoredTo).toEqual(["NEW"]);
  });

  it("restoring brings the question back", async () => {
    suppressConfirm("reanchor-margin-item");
    restoreAllConfirms();
    expect(isConfirmSuppressed("reanchor-margin-item")).toBe(false);

    const h = harness();
    await dragAndRelease(h, () => clickButton("Re-anchor"));
    expect(h.mounts()).toBeGreaterThan(0);
    expect(h.anchoredTo).toEqual(["NEW"]);
  });

  it("the checkbox does not steal the cue — Return still confirms (task 389)", async () => {
    const h = harness();
    await startAndMove(sidePlacement(h.editor));
    const commit = commitDropSession();
    await act(async () => {});
    flushFrames();

    // The checkbox exists AND is not the cued default.
    const box = document.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    expect(box).not.toBeNull();
    expect(document.activeElement).not.toBe(box);

    pressKey("Enter");
    await commit;
    expect(h.anchoredTo).toEqual(["NEW"]);
    // Enter is not a tick.
    expect(getSuppressedConfirms()).toEqual([]);
  });
});

/* ── the door's one refusal ──────────────────────────────────────── */

describe("a DANGER confirm may never be suppressible", () => {
  function DangerHost({
    onResult,
  }: {
    onResult: (v: boolean) => void;
  }) {
    const { confirm, dialog } = useConfirmDialog();
    return (
      <>
        <button
          onClick={() =>
            void confirm({
              message: "Delete it?",
              confirmLabel: "Delete",
              tone: "danger",
              // Deliberately wrong — the door must refuse it.
              suppressId: "archive-atom-marker",
            }).then(onResult)
          }
        >
          open
        </button>
        {dialog}
      </>
    );
  }

  it("renders no checkbox and says so in dev", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<DangerHost onResult={() => {}} />);
    clickButton("open");
    await act(async () => {});
    flushFrames();

    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
    expect(err).toHaveBeenCalledWith(
      expect.stringContaining('tone="danger" confirm declares suppressId'),
    );
  });

  it("still ASKS even when its id is stored as suppressed (it fails toward asking)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    suppressConfirm("archive-atom-marker");
    const results: boolean[] = [];
    render(<DangerHost onResult={(v) => results.push(v)} />);
    clickButton("open");
    await act(async () => {});
    flushFrames();

    // A dialog is on screen — the short-circuit did NOT fire.
    expect(screen.getByText("Delete it?")).toBeTruthy();
    expect(results).toEqual([]);
  });
});

/* ── the store ───────────────────────────────────────────────────── */

describe("the suppression store", () => {
  it("re-hydrates from a PEER window's write (cross-window law)", () => {
    expect(isConfirmSuppressed("archive-atom-marker")).toBe(false);
    localStorage.setItem(
      "virgil:suppressed-confirms",
      JSON.stringify(["archive-atom-marker"]),
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "virgil:suppressed-confirms",
        storageArea: localStorage,
      }),
    );
    expect(isConfirmSuppressed("archive-atom-marker")).toBe(true);
  });

  it("drops an id this build does not know (a retired confirm cannot gate)", () => {
    localStorage.setItem(
      "virgil:suppressed-confirms",
      JSON.stringify(["archive-atom-marker", "some-retired-confirm"]),
    );
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: "virgil:suppressed-confirms",
        storageArea: localStorage,
      }),
    );
    expect(getSuppressedConfirms()).toEqual(["archive-atom-marker"]);
  });

  it("restore WRITES an empty list rather than removing the key", () => {
    suppressConfirm("archive-atom-marker");
    restoreAllConfirms();
    expect(localStorage.getItem("virgil:suppressed-confirms")).toBe("[]");
  });

  it("every declared id has a label", () => {
    for (const id of SUPPRESSIBLE_CONFIRM_IDS) {
      expect(SUPPRESSIBLE_CONFIRM_LABELS[id]).toBeTruthy();
    }
  });
});

/* ── the census — the leg with teeth ─────────────────────────────── */

/** Absolute paths of every shipped `.ts`/`.tsx` in BOTH silos. */
const PRODUCTION = [
  ...trackedFiles("src", /\.tsx?$/),
  ...trackedFiles("library", /\.tsx?$/),
].filter((abs) => !/(^|[/\\])__tests__[/\\]/.test(abs));

function rel(abs: string): string {
  return abs.slice(REPO_ROOT.length + 1).replace(/\\/g, "/");
}
function read(abs: string): string {
  return readFileSync(abs, "utf8");
}

/** The door itself, plus the two files that PLUMB an id through to it. */
const DOOR = new Set([
  "src/components/confirm-suppression.ts",
  "src/components/ConfirmDialog.tsx",
]);

describe("census — nothing re-forks the capability", () => {
  it("no production file renders a CONTROLLED <ConfirmDialog suppressId>", () => {
    const offenders: string[] = [];
    for (const abs of PRODUCTION) {
      if (DOOR.has(rel(abs))) continue;
      const src = commentsStripped(read(abs));
      // Every `<ConfirmDialog …>` open tag in the file.
      for (const m of src.matchAll(/<ConfirmDialog\b[\s\S]*?>/g)) {
        if (/\bsuppressId\b/.test(m[0])) offenders.push(rel(abs));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no production file hand-rolls a don't-ask-again control", () => {
    // The retired shape, spelled the way it shipped: a checkbox labelled
    // "Don't ask again" / "Don't show …" authored inside a caller. The one
    // legitimate spelling lives in the door's `SUPPRESS_CHECKBOX_LABEL`.
    const needle = /Don&apos;t (ask|show)|Don't (ask|show)|do not (ask|show) again/i;
    const offenders: string[] = [];
    for (const abs of PRODUCTION) {
      if (DOOR.has(rel(abs))) continue;
      if (needle.test(commentsStripped(read(abs)))) offenders.push(rel(abs));
    }
    expect(offenders).toEqual([]);
  });

  it("the retired per-window pref is DEAD in both silos", () => {
    const offenders = PRODUCTION.filter(
      (abs) =>
        rel(abs) !== "src/hooks/useViewPrefs.ts" &&
        !DOOR.has(rel(abs)) &&
        /suppressArchiveAtomWarning/.test(commentsStripped(read(abs))),
    ).map(rel);
    // Its ONLY surviving mention is the retirement itself (the scrub list +
    // the one-time fold), in the file that retires it.
    expect(offenders).toEqual([]);
    const vp = readFileSync(join(REPO_ROOT, "src/hooks/useViewPrefs.ts"), "utf8");
    expect(vp).toContain('"suppressArchiveAtomWarning"');
    expect(vp).toContain("confirmSuppressionsUntouched()");
  });

  it("every declared id is PRODUCED somewhere (no dead id)", () => {
    const haystack = PRODUCTION.filter((abs) => !DOOR.has(rel(abs)))
      // `commentsStripped`, NOT `codeOnly`: an id is a string LITERAL at every
      // producer, and `codeOnly` blanks literals — the leg would pass
      // vacuously with every id "unused".
      .map((abs) => commentsStripped(read(abs)))
      .join("\n");
    const unused = SUPPRESSIBLE_CONFIRM_IDS.filter(
      (id: SuppressibleConfirmId) => !haystack.includes(id),
    );
    expect(unused).toEqual([]);
  });

  it("the SECOND producer (atom archive) enters the imperative door", () => {
    // The unification, pinned at the site that used to hand-roll all three
    // halves. A controlled `<ConfirmDialog>` here would render a checkbox that
    // can never short-circuit — the shape the first census leg forbids — and a
    // re-forked `if (suppressed) …` gate would type-check perfectly.
    const src = commentsStripped(
      readFileSync(join(REPO_ROOT, "src/components/EditorPane.tsx"), "utf8"),
    );
    expect(src).toContain("confirmArchiveAtom({");
    expect(src).toContain('suppressId: "archive-atom-marker"');
    expect(src).not.toMatch(/<ConfirmDialog\b/);
  });

  it("Preferences offers the way back", () => {
    const src = readFileSync(
      join(REPO_ROOT, "src/components/PreferencesModal.tsx"),
      "utf8",
    );
    expect(src).toContain("useSuppressedConfirms");
    expect(src).toContain("restoreAllConfirms");
    // Count-gated: nothing rendered when nothing is suppressed (a disabled
    // control that does nothing is the false-affordance shape).
    expect(src).toMatch(/suppressed\.length === 0\)\s*return null/);
  });
});
