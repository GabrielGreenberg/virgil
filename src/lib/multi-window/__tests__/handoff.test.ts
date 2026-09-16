import { describe, it, expect, beforeEach, vi } from "vitest";

import { claimDocWithHandoff, type HandoffDialog } from "../handoff";

const claimDoc = vi.fn();
const ownsDoc = vi.fn();
const requestHandoff = vi.fn();

vi.mock("../doc-ownership", () => ({
  claimDoc: (...a: unknown[]) => claimDoc(...a),
  ownsDoc: (...a: unknown[]) => ownsDoc(...a),
  requestHandoff: (...a: unknown[]) => requestHandoff(...a),
}));

function makeDialog() {
  const confirm = vi.fn(async () => true);
  const alert = vi.fn(async () => {});
  return { confirm, alert } as unknown as HandoffDialog & {
    confirm: ReturnType<typeof vi.fn>;
    alert: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  claimDoc.mockReset();
  ownsDoc.mockReset().mockReturnValue(false);
  requestHandoff.mockReset().mockResolvedValue(true);
});

describe("claimDocWithHandoff", () => {
  it("already owned: no claim, no dialog", async () => {
    ownsDoc.mockReturnValue(true);
    const dialog = makeDialog();
    expect(await claimDocWithHandoff({ id: "d1" }, dialog)).toBe(true);
    expect(claimDoc).not.toHaveBeenCalled();
    expect(dialog.confirm).not.toHaveBeenCalled();
  });

  it("uncontested claim: no dialog", async () => {
    claimDoc.mockResolvedValue({ owned: true });
    const dialog = makeDialog();
    expect(await claimDocWithHandoff({ id: "d1" }, dialog)).toBe(true);
    expect(dialog.confirm).not.toHaveBeenCalled();
  });

  it("declined confirm returns false QUIETLY — declining is the answer", async () => {
    claimDoc.mockResolvedValue({ owned: false, currentOwner: "win-B" });
    const dialog = makeDialog();
    dialog.confirm.mockResolvedValue(false);
    expect(await claimDocWithHandoff({ id: "d1" }, dialog)).toBe(false);
    expect(requestHandoff).not.toHaveBeenCalled();
    expect(dialog.alert).not.toHaveBeenCalled();
  });

  it("the peer never releases: the user is told", async () => {
    claimDoc.mockResolvedValue({ owned: false });
    requestHandoff.mockResolvedValue(false);
    const dialog = makeDialog();
    expect(await claimDocWithHandoff({ id: "d1" }, dialog)).toBe(false);
    expect(dialog.alert).toHaveBeenCalledTimes(1);
  });

  // The leg this task exists for: the post-confirm claim failure used to
  // be `if (!result.owned) return;` at BOTH call sites. The user confirmed
  // the move and nothing happened, with no error anywhere.
  it("the peer released but the re-claim failed: the user is told, not silence", async () => {
    claimDoc
      .mockResolvedValueOnce({ owned: false, currentOwner: "win-B" })
      .mockResolvedValueOnce({ owned: false });
    const dialog = makeDialog();
    expect(await claimDocWithHandoff({ id: "d1" }, dialog)).toBe(false);
    expect(claimDoc).toHaveBeenCalledTimes(2);
    expect(dialog.alert).toHaveBeenCalledTimes(1);
    const opts = dialog.alert.mock.calls[0][0] as { message: string };
    expect(opts.message).toMatch(/couldn't be claimed here/i);
  });

  it("the full happy handoff: confirm, release, re-claim", async () => {
    claimDoc
      .mockResolvedValueOnce({ owned: false, currentOwner: "win-B" })
      .mockResolvedValueOnce({ owned: true });
    const dialog = makeDialog();
    expect(await claimDocWithHandoff({ id: "d1", name: "Paper" }, dialog)).toBe(true);
    expect(dialog.alert).not.toHaveBeenCalled();
    const opts = dialog.confirm.mock.calls[0][0] as { message: string };
    expect(opts.message).toContain("Paper");
  });
});
