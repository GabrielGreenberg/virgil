// @vitest-environment jsdom
/**
 * BugReportWindow — the window's own contract.
 *
 * The parts that matter are the ones a stray gesture can destroy or a
 * double gesture can duplicate: paste must add images WITHOUT eating a
 * text paste, Send must write exactly once however fast it's clicked, a
 * refused write must keep the draft on screen, and hiding the window
 * (Esc/outside-click → open=false) must not reset a half-written report —
 * that last one is the whole reason the window is always-mounted (the
 * PrintDialog pattern) instead of conditionally mounted like Preferences.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";

// The storage barrel `require`s its backend at module scope and cannot
// resolve under vitest (the standing gotcha).
vi.mock("@/lib/storage", () => ({
  isDevStorage: () => true,
  readSidecar: vi.fn(),
  writeSidecar: vi.fn(),
  readTex: vi.fn(),
  drainDoc: vi.fn(),
}));

// jsdom has no IndexedDB (bug-report.ts createStore's at module scope) and
// no URL.createObjectURL.
vi.mock("idb-keyval", () => ({
  createStore: () => Symbol("store"),
  get: async () => undefined,
  set: async () => {},
  del: async () => {},
}));

const writeBugReportMock = vi.fn(async () => ({ folderName: "2026-08-19-212205Z-imac-x7kq" }));
vi.mock("@/lib/bug-report", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/bug-report")>();
  return { ...actual, writeBugReport: (...args: unknown[]) => writeBugReportMock(...(args as [])) };
});

// The folder state machine is the hook's own suite's business — here it's
// held at "ready" (or overridden per test) so the window's panes drive.
const refreshSpy = vi.fn(async () => {});
const resetSpy = vi.fn(async () => {});
const fakeHandle = {} as FileSystemDirectoryHandle;
let folderState:
  | { kind: "ready"; handle: FileSystemDirectoryHandle }
  | { kind: "none" }
  | { kind: "loading" } = { kind: "ready", handle: fakeHandle };
vi.mock("@/hooks/useBugReportFolder", () => ({
  useBugReportFolder: () => ({
    state: folderState,
    pick: vi.fn(),
    grant: vi.fn(),
    reset: resetSpy,
    refresh: refreshSpy,
    pickerError: null,
  }),
}));

const ensurePermissionMock = vi.fn(async (): Promise<PermissionState> => "granted");
vi.mock("@library/lib/library-folder", () => ({
  ensureReadWritePermission: () => ensurePermissionMock(),
  queryReadWritePermission: async () => "granted" as PermissionState,
}));

import BugReportWindow from "@/components/BugReportWindow";

function pngFile(name: string, lastModified = 1000): File {
  return new File([`png-bytes-${name}`], name, { type: "image/png", lastModified });
}

/**
 * A real clipboard hands you the SAME image through BOTH views, as two
 * INDEPENDENTLY-MATERIALIZED File objects (task 419). The pre-419 harness
 * could represent neither half of that: `getAsFile` returned a stable
 * identity, and `files` was ALWAYS empty — so the second loop never ran and
 * the reference-identity dedupe in front of it was never asked a question it
 * could get wrong. Fixed at the root here: a fixture states which views the
 * payload populates, and `both` mints a DISTINCT File per view.
 */
type ClipboardViews = "items" | "files" | "both";

function paste(target: Element, files: File[], views: ClipboardViews = "items"): boolean {
  // Two File objects for one image — same name/size/type/lastModified,
  // different object identity. That is exactly what the browser produces.
  const twin = (f: File) =>
    new File([`png-bytes-${f.name}`], f.name, { type: f.type, lastModified: f.lastModified });
  const clipboardData: Record<string, unknown> = {};
  if (views !== "files") {
    clipboardData.items = files.map((file) => ({
      kind: "file",
      type: file.type,
      getAsFile: () => file,
    }));
  }
  if (views !== "items") {
    clipboardData.files = files.map((file) => (views === "both" ? twin(file) : file));
  }
  return fireEvent.paste(target, { clipboardData });
}

/** The pre-419 spelling: `items` only. Kept as the CONTROL every other leg
 *  is measured against. */
function pasteImages(target: Element, files: File[]): boolean {
  return paste(target, files, "items");
}

function mount(over: Partial<React.ComponentProps<typeof BugReportWindow>> = {}) {
  return render(
    <BugReportWindow
      open
      onClose={() => {}}
      appVersion="0.1.94"
      currentDocName="Coherence Intro"
      {...over}
    />,
  );
}

beforeEach(() => {
  folderState = { kind: "ready", handle: fakeHandle };
  writeBugReportMock.mockClear();
  writeBugReportMock.mockImplementation(async () => ({
    folderName: "2026-08-19-212205Z-imac-x7kq",
  }));
  ensurePermissionMock.mockClear();
  ensurePermissionMock.mockImplementation(async () => "granted");
  refreshSpy.mockClear();
  resetSpy.mockClear();
  localStorage.clear();
  // jsdom has no object URLs; the tray only needs stable strings.
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:fake-${n++}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
});

const textarea = () => screen.getByPlaceholderText(/What went wrong/);

describe("paste", () => {
  it("an image paste adds thumbnails (and is consumed); a text paste is left alone", () => {
    mount();
    const textarea = screen.getByPlaceholderText(/What went wrong/);

    const notCancelled = pasteImages(textarea, [pngFile("a.png"), pngFile("b.png")]);
    expect(notCancelled).toBe(false); // preventDefault WAS called
    expect(screen.getByText("2 screenshots")).toBeTruthy();

    // A plain text paste must fall through to the textarea untouched.
    const textPaste = fireEvent.paste(textarea, {
      clipboardData: { items: [], files: [] },
    });
    expect(textPaste).toBe(true); // preventDefault NOT called
  });

  // ---- task 419: the two clipboard views ------------------------------
  // The DEFECT leg. Both views describe ONE screenshot as two distinct File
  // objects; the pre-419 handler's `!files.includes(file)` reference test
  // could not see they were the same image and added the thumbnail twice.
  it("one image in BOTH clipboard views adds exactly ONE thumbnail", () => {
    mount();
    const textarea = screen.getByPlaceholderText(/What went wrong/);

    const notCancelled = paste(textarea, [pngFile("shot.png")], "both");
    expect(notCancelled).toBe(false); // preventDefault WAS called
    expect(screen.getByText("1 screenshot")).toBeTruthy();
  });

  it("`items` only still yields the image (control — today's passing path)", () => {
    mount();
    paste(textarea(), [pngFile("shot.png")], "items");
    expect(screen.getByText("1 screenshot")).toBeTruthy();
  });

  // The Finder-"Copy" case the second loop was written for, which no fixture
  // had ever exercised — `files` was hard-coded empty in every one of them.
  it("`files` only still yields the image (the Finder-Copy case)", () => {
    mount();
    paste(textarea(), [pngFile("shot.png")], "files");
    expect(screen.getByText("1 screenshot")).toBeTruthy();
  });

  it("two DIFFERENT images in both views still add two", () => {
    mount();
    paste(textarea(), [pngFile("a.png"), pngFile("b.png")], "both");
    expect(screen.getByText("2 screenshots")).toBeTruthy();
  });

  // PER-EVENT SCOPE. Deduping across the session would silently swallow a
  // deliberate second paste of the same screenshot — a paste that visibly
  // does nothing, which is worse than the bug being fixed.
  it("the same image pasted in TWO separate gestures adds two", () => {
    mount();
    const ta = textarea();
    paste(ta, [pngFile("shot.png")], "both");
    paste(ta, [pngFile("shot.png")], "both");
    expect(screen.getByText("2 screenshots")).toBeTruthy();
  });

  it("remove drops the right image", () => {
    mount();
    const textarea = screen.getByPlaceholderText(/What went wrong/);
    pasteImages(textarea, [pngFile("a.png"), pngFile("b.png"), pngFile("c.png")]);
    expect(screen.getByText("3 screenshots")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Remove screenshot 2"));
    expect(screen.getByText("2 screenshots")).toBeTruthy();
    // The survivors keep their identity: 1 and (former) 3.
    expect(screen.getByAltText("Screenshot 1")).toBeTruthy();
    expect(screen.getByAltText("Screenshot 2")).toBeTruthy();
  });
});

describe("send", () => {
  it("writes once, shows the written folder name, and clears the draft", async () => {
    mount();
    const textarea = screen.getByPlaceholderText(/What went wrong/);
    fireEvent.change(textarea, { target: { value: "The markers overlap." } });
    pasteImages(textarea, [pngFile("a.png")]);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(screen.getByText("Report written")).toBeTruthy();
    });
    expect(screen.getByText("2026-08-19-212205Z-imac-x7kq")).toBeTruthy();

    expect(writeBugReportMock).toHaveBeenCalledTimes(1);
    const [, args] = writeBugReportMock.mock.calls[0] as unknown as [
      FileSystemDirectoryHandle,
      { text: string; images: { blob: Blob; ext: string }[]; meta: Record<string, unknown> },
    ];
    expect(args.text).toBe("The markers overlap.");
    expect(args.images).toHaveLength(1);
    expect(args.images[0].ext).toBe("png");
    expect(args.meta.docName).toBe("Coherence Intro");
    expect(args.meta.appVersion).toBe("0.1.94");

    // "Write another" returns to a CLEAN compose pane.
    fireEvent.click(screen.getByRole("button", { name: "Write another" }));
    const again = screen.getByPlaceholderText(/What went wrong/) as HTMLTextAreaElement;
    expect(again.value).toBe("");
    expect(screen.queryByText(/screenshots?$/)).toBeNull();
  });

  it("a double-click writes exactly once", async () => {
    // Hold the write open so the second click lands mid-send.
    let release: (v: { folderName: string }) => void = () => {};
    writeBugReportMock.mockImplementation(
      () => new Promise((res) => { release = res; }),
    );
    mount();
    const textarea = screen.getByPlaceholderText(/What went wrong/);
    fireEvent.change(textarea, { target: { value: "x" } });

    const send = screen.getByRole("button", { name: "Send" });
    fireEvent.click(send);
    fireEvent.click(send);
    // The mock is invoked after the handler's first await — wait for it
    // before releasing, or `release` is still the no-op placeholder (and a
    // never-settling task would wedge the module-global write queue for
    // every later test in this file).
    await waitFor(() => {
      expect(writeBugReportMock).toHaveBeenCalledTimes(1);
    });
    release({ folderName: "f" });
    await waitFor(() => {
      expect(screen.getByText("Report written")).toBeTruthy();
    });
    expect(writeBugReportMock).toHaveBeenCalledTimes(1);
  });

  it("a permission refusal keeps the draft, says so, and re-checks the folder", async () => {
    ensurePermissionMock.mockImplementation(async () => "denied");
    mount();
    const textarea = screen.getByPlaceholderText(/What went wrong/);
    fireEvent.change(textarea, { target: { value: "precious draft" } });
    pasteImages(textarea, [pngFile("a.png")]);

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(screen.getByText(/lost permission to the inbox folder/)).toBeTruthy();
    });
    expect(writeBugReportMock).not.toHaveBeenCalled();
    // Draft intact — text AND images.
    expect((screen.getByPlaceholderText(/What went wrong/) as HTMLTextAreaElement).value)
      .toBe("precious draft");
    expect(screen.getByText("1 screenshot")).toBeTruthy();
    expect(refreshSpy).toHaveBeenCalled();
  });

  it("a write failure surfaces the error and keeps the draft", async () => {
    writeBugReportMock.mockImplementation(async () => {
      throw new Error("disk exploded");
    });
    mount();
    const textarea = screen.getByPlaceholderText(/What went wrong/);
    fireEvent.change(textarea, { target: { value: "still here" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(screen.getByText(/Couldn't write the report: disk exploded/)).toBeTruthy();
    });
    expect((screen.getByPlaceholderText(/What went wrong/) as HTMLTextAreaElement).value)
      .toBe("still here");
  });
});

describe("always-mounted draft survival", () => {
  it("hiding the window (open=false) and reopening keeps text and images", () => {
    const view = mount();
    const textarea = screen.getByPlaceholderText(/What went wrong/);
    fireEvent.change(textarea, { target: { value: "half-written" } });
    pasteImages(textarea, [pngFile("a.png")]);

    view.rerender(
      <BugReportWindow open={false} onClose={() => {}} appVersion="0.1.94" currentDocName={null} />,
    );
    expect(screen.queryByPlaceholderText(/What went wrong/)).toBeNull();

    view.rerender(
      <BugReportWindow open onClose={() => {}} appVersion="0.1.94" currentDocName={null} />,
    );
    expect((screen.getByPlaceholderText(/What went wrong/) as HTMLTextAreaElement).value)
      .toBe("half-written");
    expect(screen.getByText("1 screenshot")).toBeTruthy();
  });

  it("the empty state can still file a report (no doc chip, Send enabled on text)", () => {
    mount({ currentDocName: null });
    expect(screen.queryByText(/about:/)).toBeNull();
    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true); // nothing to send yet
    fireEvent.change(screen.getByPlaceholderText(/What went wrong/), {
      target: { value: "from the empty state" },
    });
    expect((screen.getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("cross-window draft (task 599)", () => {
  const DRAFT_KEY = "virgil:bug-report-draft";
  const peerWrite = (value: string) => {
    localStorage.setItem(DRAFT_KEY, value);
    window.dispatchEvent(new StorageEvent("storage", { key: DRAFT_KEY }));
  };

  it("adopts a peer window's draft instead of overwriting it from a stale mount-time copy", () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(DRAFT_KEY, "old");
      mount();
      expect((textarea() as HTMLTextAreaElement).value).toBe("old");

      act(() => peerWrite("typed in the other window"));
      expect((textarea() as HTMLTextAreaElement).value).toBe("typed in the other window");

      // The debounced mirror fires: storage keeps the peer's prose, and the
      // echo is silent (no write → no storage event bounced back to the peer).
      const spy = vi.spyOn(Storage.prototype, "setItem");
      act(() => { vi.advanceTimersByTime(1000); });
      expect(localStorage.getItem(DRAFT_KEY)).toBe("typed in the other window");
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();

      // Typing here still persists.
      fireEvent.change(textarea(), { target: { value: "typed in the other window + more" } });
      act(() => { vi.advanceTimersByTime(1000); });
      expect(localStorage.getItem(DRAFT_KEY)).toBe("typed in the other window + more");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("the draft mirror's two guarantees (task 629)", () => {
  const DRAFT_KEY = "virgil:bug-report-draft";
  const MACHINE_KEY = "virgil:bug-report-machine";
  const peerWrite = (key: string, value: string) => {
    localStorage.setItem(key, value);
    window.dispatchEvent(new StorageEvent("storage", { key }));
  };

  // THE DEFECT LEG for (a). The pre-629 mirror's effect cleanup was
  // `clearTimeout(t)` — it CANCELLED the pending write — while the window's
  // own `dismissIsFree` justification said "even a reload keeps it".
  it("a teardown inside the debounce window writes the prose, not drops it", () => {
    vi.useFakeTimers();
    try {
      const view = mount();
      fireEvent.change(textarea(), { target: { value: "the last sentence I typed" } });
      expect(localStorage.getItem(DRAFT_KEY)).toBeNull(); // still only in memory
      act(() => view.unmount());
      expect(localStorage.getItem(DRAFT_KEY)).toBe("the last sentence I typed");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a reload edge (pagehide) inside the debounce window writes the prose", () => {
    vi.useFakeTimers();
    try {
      mount();
      fireEvent.change(textarea(), { target: { value: "typed, then reloaded" } });
      act(() => void window.dispatchEvent(new Event("pagehide")));
      expect(localStorage.getItem(DRAFT_KEY)).toBe("typed, then reloaded");
    } finally {
      vi.useRealTimers();
    }
  });

  // THE DEFECT LEG for (b). The existing task-599 leg exercises only the case
  // where the local buffer already EQUALS what is on disk, so the clobber is
  // invisible to it. Here the local edit is NEWER than the mirror.
  it("a peer's draft does not revert prose being composed here", () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(DRAFT_KEY, "the older persisted draft");
      mount();
      fireEvent.change(textarea(), { target: { value: "a sentence I am still typing" } });
      act(() => peerWrite(DRAFT_KEY, "the peer's draft"));
      expect((textarea() as HTMLTextAreaElement).value).toBe("a sentence I am still typing");
    } finally {
      vi.useRealTimers();
    }
  });

  // The cross-KEY coupling: one handler re-read BOTH keys, and the machine
  // label is written per keystroke, undebounced. So a character typed into a
  // second window's little "From:" field reverted this window's textarea.
  it("a peer's machine-label keystroke cannot touch the report prose", () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem(DRAFT_KEY, "the older persisted draft");
      mount();
      fireEvent.change(textarea(), { target: { value: "half a paragraph, mid-thought" } });
      act(() => peerWrite(MACHINE_KEY, "o"));
      expect((textarea() as HTMLTextAreaElement).value).toBe("half a paragraph, mid-thought");
      // …and the label itself still syncs, since that buffer IS clean.
      expect((screen.getByPlaceholderText("machine") as HTMLInputElement).value).toBe("o");
    } finally {
      vi.useRealTimers();
    }
  });

  it("the machine label writes through immediately (nothing to coalesce)", () => {
    mount();
    fireEvent.change(screen.getByPlaceholderText("machine"), {
      target: { value: "office-imac" },
    });
    expect(localStorage.getItem(MACHINE_KEY)).toBe("office-imac");
  });

  it("a sent report clears the mirror NOW, not 400 ms from now", async () => {
    // Seeded so the mirror genuinely HOLDS the report: no timer is advanced
    // anywhere below, so the clear can only come from the explicit flush.
    localStorage.setItem(DRAFT_KEY, "a report already mirrored");
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("Report written")).toBeTruthy());
    expect(localStorage.getItem(DRAFT_KEY)).toBe("");
  });

  it("a never-mirrored draft leaves no empty key behind on send", async () => {
    mount();
    fireEvent.change(textarea(), { target: { value: "sent before the debounce" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("Report written")).toBeTruthy());
    // Storage never held the draft, so there is nothing to clear — the door
    // writes only when it is dirty.
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});

describe("the way back to the folder picker (task 629)", () => {
  // `folder.reset` was a published export with no caller, and its absence was
  // user-visible: the "Choose inbox folder…" pane is reachable only while IDB
  // holds no handle, so a user who picked the wrong Dropbox folder was stuck.
  it("the ready pane offers a way to change the inbox folder", () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Change folder…" }));
    expect(resetSpy).toHaveBeenCalledTimes(1);
  });
});
