// @vitest-environment jsdom
//
// Task 357 hole 4 — the banner half. The gates' finding is only useful if the
// one person who can act on it sees it, so this drives the REAL badge against
// the REAL notice store: a refusal published from a storage backend must raise
// the pill in the topbar, live, with no doc reload and no editor subscription.
//
// The acknowledgment leg matters as much as the appearance leg: "Save anyway"
// is the ONLY way out, and once taken the pill must go and stay gone.
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act, screen, fireEvent } from "@testing-library/react";

// The badge's chrome imports reach `@/lib/storage`, whose dynamic
// `require("@/lib/storage-fsa")` doesn't resolve under vitest (the same stub
// the sibling external-change badge suite takes). Nothing here touches disk.
vi.mock("@/lib/storage", () => ({}));

// Task 567 — the manual-save DOOR is the thing "Save anyway" must ask, so it is
// spied: what the badge hands it (the acknowledgment CLAIM) and how it routes a
// blocked answer are the render facts this suite can see. The door's own
// behaviour — writing, landing, recording the acknowledgment on the receipt —
// is pinned in `useDocument.mirror-receipt.test.ts` against the REAL store.
let saveOutcome: { landed: true } | { landed: false; reason: string } = { landed: true };
const saveSpy = vi.fn(async (_docId: string, _opts?: unknown) => saveOutcome);
const routeSpy = vi.fn();
vi.mock("@/lib/save-request", () => ({
  requestSaveNow: (...a: [string, unknown?]) => saveSpy(...a),
  requestBlockingFlow: (...a: unknown[]) => routeSpy(...a),
  subscribeBlockingFlow: () => () => {},
  getBlockingFlowRequest: () => null,
}));
// The danger confirm, resolved deterministically (the sibling badge suite's
// shape) — `confirmResult` is what the user answered.
let confirmResult = true;
const confirmSpy = vi.fn(async (_opts: { title?: string; tone?: string }) => confirmResult);
vi.mock("../ConfirmDialog", () => ({
  useConfirmDialog: () => ({ confirm: confirmSpy, dialog: null }),
}));

import PreservationNoticeBadge from "../PreservationNoticeBadge";
import {
  recordPreservationRefusal,
  acknowledgePreservationNotice,
  clearPreservationNotice,
} from "@/lib/preservation-notice";

const DOC = "doc-1";
const DETAIL = {
  source: "load",
  region: "body",
  before: 400,
  after: 120,
  lost: 280,
  allowed: 4,
} as const;

beforeEach(() => {
  saveSpy.mockClear();
  routeSpy.mockClear();
  confirmSpy.mockClear();
  saveOutcome = { landed: true };
  confirmResult = true;
});

afterEach(() => {
  cleanup();
  clearPreservationNotice();
});

const pill = () => document.querySelector("[data-preservation-notice]");

/** Open the kebab and press "Save anyway", then let the awaited handler settle. */
async function pressSaveAnyway() {
  act(() => {
    (pill()?.querySelector("button[aria-haspopup='menu']") as HTMLElement)?.click();
  });
  await act(async () => {
    fireEvent.click(screen.getByText(/save anyway/i));
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

describe("PreservationNoticeBadge", () => {
  it("renders nothing with no doc and nothing with a clean doc", () => {
    render(<PreservationNoticeBadge docId={null} />);
    expect(pill()).toBeNull();
    cleanup();
    render(<PreservationNoticeBadge docId={DOC} />);
    expect(pill()).toBeNull();
  });

  it("rises when a gate publishes a refusal, without a remount", () => {
    render(<PreservationNoticeBadge docId={DOC} />);
    expect(pill()).toBeNull();
    act(() => {
      recordPreservationRefusal(DOC, DETAIL);
    });
    expect(pill()).not.toBeNull();
    // The two facts that matter, in the order they matter: not saving, and
    // (in the menu detail) the file on disk is unchanged.
    expect(screen.getByLabelText(/not saving/i)).toBeTruthy();
  });

  it("ignores a refusal published for a DIFFERENT document", () => {
    render(<PreservationNoticeBadge docId={DOC} />);
    act(() => {
      recordPreservationRefusal("some-other-doc", DETAIL);
    });
    expect(pill()).toBeNull();
  });

  it("goes away on acknowledgment and does not come back on a later refusal", () => {
    render(<PreservationNoticeBadge docId={DOC} />);
    act(() => {
      recordPreservationRefusal(DOC, DETAIL);
    });
    expect(pill()).not.toBeNull();
    act(() => {
      acknowledgePreservationNotice(DOC);
    });
    expect(pill()).toBeNull();
    // The user decided. A later refusal for the same doc must not re-raise a
    // banner over a choice they already made.
    act(() => {
      recordPreservationRefusal(DOC, DETAIL);
    });
    expect(pill()).toBeNull();
  });

  it("a SERIALIZE refusal reads differently and offers no way to save", () => {
    // Task 357's serializer gate. The other three refusals have a version to
    // save — a shorter document the user may knowingly accept. This one does
    // not: the serializer produced no bytes at all, so "Save anyway" would
    // promise what the commit cannot do and refuse again one gesture later.
    render(<PreservationNoticeBadge docId={DOC} />);
    act(() => {
      recordPreservationRefusal(DOC, {
        ...DETAIL,
        source: "serialize",
        after: 0,
        lost: DETAIL.before,
        allowed: 0,
        reason: "Unknown node type: sideNoteBlock",
      });
    });
    const el = pill();
    expect(el).not.toBeNull();
    expect(el?.getAttribute("data-preservation-notice")).toBe("serialize");
    // The pill says the right thing — "can't write", not "didn't load".
    expect(el?.textContent ?? "").toMatch(/can't write/i);
    // …and the one action row is withheld. Open the menu and look.
    act(() => {
      (el?.querySelector("button[aria-haspopup='menu']") as HTMLElement)?.click();
    });
    expect(screen.queryByText(/save anyway/i)).toBeNull();
    // The explanation is still there — withholding the action must not mean
    // withholding the account of what happened.
    expect(document.body.textContent ?? "").toMatch(/sideNoteBlock/);
  });
});

describe("\"Save anyway\" is a WRITE (task 567)", () => {
  // Until 567 the confirm's handler called `acknowledgePreservationNotice` and
  // nothing else: the pill went away, the file stayed stale (the refusal had
  // disarmed the debounce and nothing re-armed it), and the save badge kept
  // saying "Not saving … Review…" over a document whose next Save would then
  // silently overwrite the file. The handler asks the manual-save door now,
  // carrying the acknowledgment as a CLAIM; the acknowledgment is recorded on
  // the landed receipt inside `useDocument`, never here.
  it("asks the manual-save door with the acknowledgment CLAIM", async () => {
    render(<PreservationNoticeBadge docId={DOC} />);
    act(() => {
      recordPreservationRefusal(DOC, DETAIL);
    });
    await pressSaveAnyway();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0].tone).toBe("danger");
    // PRE-567: `saveSpy` had zero calls — no write was ever requested.
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).toHaveBeenCalledWith(DOC, { acknowledgePreservation: true });
    // The badge itself recorded nothing: with a door that (here) touches no
    // store, the notice is exactly as it was. The flag's one writer is the
    // landed receipt in `useDocument.save`.
    expect(pill(), "the pill stands until a write with the claim LANDS").not.toBeNull();
    expect(routeSpy).not.toHaveBeenCalled();
  });

  it("ROUTES a blocked answer to the flow that owns it (the 392 rule)", async () => {
    // A document can be both refused and conflicted; the door reports the
    // conflict without writing, and the badge hands the user to that flow
    // rather than re-refusing in silence or walking past the guard.
    saveOutcome = { landed: false, reason: "conflict" };
    render(<PreservationNoticeBadge docId={DOC} />);
    act(() => {
      recordPreservationRefusal(DOC, DETAIL);
    });
    await pressSaveAnyway();
    expect(saveSpy).toHaveBeenCalledWith(DOC, { acknowledgePreservation: true });
    expect(routeSpy).toHaveBeenCalledWith(DOC, "conflict");
    expect(pill(), "nothing landed, so nothing is acknowledged").not.toBeNull();
  });

  it("a cancelled confirm asks for nothing", async () => {
    confirmResult = false;
    render(<PreservationNoticeBadge docId={DOC} />);
    act(() => {
      recordPreservationRefusal(DOC, DETAIL);
    });
    await pressSaveAnyway();
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(routeSpy).not.toHaveBeenCalled();
    expect(pill()).not.toBeNull();
  });
});
