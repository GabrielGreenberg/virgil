// @vitest-environment jsdom
//
// Task 363 — the surface, and the scan that feeds it.
//
// The badge was never the part that could misbehave. What could — and what a
// test of the grammar structurally cannot see — is a scan that is never WIRED,
// a report that is published but not read, or a badge that raises a permanent
// banner over a folder the user cannot clean from inside the app.
//
// Legs:
//   1. SCAN     — the real `scanSyncConflicts` lists, classifies and publishes,
//                 and a scan that throws reports nothing rather than surfacing
//                 a document error.
//   2. CLEARING — a later clean scan RETIRES a standing notice, so the pill can
//                 go away by itself once the user tidies the folder.
//   3. RENDER   — the pill states the count and the content split; a swap-only
//                 folder raises nothing.
//   4. DISMISS  — keyed on the report's SIGNATURE, not the docId: an unchanged
//                 folder stays quiet (the reporting folder holds four months of
//                 forks and a permanent banner is furniture) while a genuinely
//                 NEW fork re-raises. Virgil is a PWA that stays open for days
//                 and the daemon keeps minting, so a doc-keyed dismissal would
//                 silence exactly the live case this feature exists for.
//   5. WIRING   — the production doc-open path actually calls the scan (a
//                 SOURCE leg: the defect this closes is silence, and an unwired
//                 scan is silent in exactly the same way).
//   6. CLEANUP  — task 411. The row is offered only where the PLAN is
//                 non-empty, and the number it shows is the PROVED-INERT count,
//                 never the pill's fork total — conflating the two would make
//                 one of them lie, and only a render leg can see which number
//                 reached the user. The confirm names every file it will
//                 delete, and the request handed to the door is exactly the
//                 plan.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { render, act } from "@testing-library/react";

const mockList = vi.fn();
const mockDelete = vi.fn();
vi.mock("@/lib/storage", () => ({
  listSidecarNames: (...a: unknown[]) => mockList(...a),
  deleteSidecarSiblings: (...a: unknown[]) => mockDelete(...a),
}));

import SyncConflictBadge from "../SyncConflictBadge";
import {
  beginDocPipeline,
  __resetForTests as resetPipelines,
} from "@/lib/multi-window/doc-pipeline";
import { scanSyncConflicts } from "@/lib/sync-conflict-scan";
import {
  clearSyncConflictNotices,
  dismissSyncConflictNotice,
  getSyncConflictNotice,
} from "@/lib/sync-conflict-notice";

const FORKED = [
  "notes.json",
  "notes (Gabriel Greenberg's conflicted copy 2026-06-09).json",
  "notes (Gabriel Greenberg's conflicted copy 2026-06-09 5).json",
  "editor-state.json",
  "editor-state (Gabriel Greenberg's conflicted copy 2026-08-18).json",
  "archive.json.1.crswap",
];

beforeEach(() => {
  mockList.mockReset();
  mockDelete.mockReset();
  mockDelete.mockResolvedValue({ deleted: [], refused: [], failed: [] });
  resetPipelines();
  clearSyncConflictNotices();
});
afterEach(() => clearSyncConflictNotices());

describe("sync-conflict scan", () => {
  it("lists, classifies and publishes", async () => {
    mockList.mockResolvedValue(FORKED);
    await scanSyncConflicts("doc-1");
    const n = getSyncConflictNotice("doc-1");
    expect(n).not.toBeNull();
    expect(n!.total).toBe(3);
    expect(n!.contentTotal).toBe(2);
    expect(n!.swapFiles).toEqual(["archive.json.1.crswap"]);
  });

  it("reports NOTHING when the listing throws — a diagnostic never becomes a document error", async () => {
    mockList.mockRejectedValue(new Error("permission lost"));
    await expect(scanSyncConflicts("doc-1")).resolves.toBeUndefined();
    expect(getSyncConflictNotice("doc-1")).toBeNull();
  });

  it("a later CLEAN scan retires a standing notice", async () => {
    mockList.mockResolvedValue(FORKED);
    await scanSyncConflicts("doc-1");
    expect(getSyncConflictNotice("doc-1")).not.toBeNull();
    mockList.mockResolvedValue(["notes.json", "editor-state.json"]);
    await scanSyncConflicts("doc-1");
    expect(getSyncConflictNotice("doc-1")).toBeNull();
  });
});

describe("sync-conflict badge", () => {
  it("renders nothing with no report", () => {
    const { container } = render(<SyncConflictBadge docId="doc-1" />);
    expect(container.innerHTML).toBe("");
  });

  it("states the count and the content split", async () => {
    mockList.mockResolvedValue(FORKED);
    const { container } = render(<SyncConflictBadge docId="doc-1" />);
    await act(async () => {
      await scanSyncConflicts("doc-1");
    });
    const pill = container.querySelector("[data-sync-conflict-notice]");
    expect(pill).not.toBeNull();
    expect(pill!.getAttribute("data-sync-conflict-notice")).toBe("3");
    expect(pill!.textContent).toContain("3 conflicted copies · 2 with content");
  });

  it("raises NOTHING for swap debris alone", async () => {
    mockList.mockResolvedValue(["notes.json", "notes.json.2.crswap"]);
    const { container } = render(<SyncConflictBadge docId="doc-1" />);
    await act(async () => {
      await scanSyncConflicts("doc-1");
    });
    expect(container.innerHTML).toBe("");
  });

  it("dismisses this FOLDER STATE — an unchanged re-scan stays quiet", async () => {
    mockList.mockResolvedValue(FORKED);
    const { container } = render(<SyncConflictBadge docId="doc-1" />);
    await act(async () => {
      await scanSyncConflicts("doc-1");
    });
    expect(container.innerHTML).not.toBe("");
    act(() => dismissSyncConflictNotice("doc-1"));
    expect(container.innerHTML).toBe("");
    // The scan re-runs on every doc activation — an identical folder must not
    // re-raise what the user has already seen.
    await act(async () => {
      await scanSyncConflicts("doc-1");
    });
    expect(container.innerHTML).toBe("");
  });

  it("…but a genuinely NEW fork re-raises after a dismissal", async () => {
    // The live case: Virgil is a PWA that stays open for days, and the daemon
    // keeps minting. A doc-keyed dismissal would silence a fork of notes.json
    // made at 4pm because the user dismissed the 9am report — on the one file
    // where silence is the thing this surface exists to end.
    mockList.mockResolvedValue(FORKED);
    const { container } = render(<SyncConflictBadge docId="doc-1" />);
    await act(async () => {
      await scanSyncConflicts("doc-1");
    });
    act(() => dismissSyncConflictNotice("doc-1"));
    expect(container.innerHTML).toBe("");

    mockList.mockResolvedValue([
      ...FORKED,
      "notes (Gabriel Greenberg's conflicted copy 2026-08-19).json",
    ]);
    await act(async () => {
      await scanSyncConflicts("doc-1");
    });
    expect(container.innerHTML).not.toBe("");
    expect(
      container
        .querySelector("[data-sync-conflict-notice]")!
        .getAttribute("data-sync-conflict-notice"),
    ).toBe("4");
  });

  it("a cleaned folder clears the dismissal too, so a later fork is judged fresh", async () => {
    mockList.mockResolvedValue(FORKED);
    const { container } = render(<SyncConflictBadge docId="doc-1" />);
    await act(async () => {
      await scanSyncConflicts("doc-1");
    });
    act(() => dismissSyncConflictNotice("doc-1"));
    // The user tidies the folder in Finder.
    mockList.mockResolvedValue(["notes.json", "editor-state.json"]);
    await act(async () => {
      await scanSyncConflicts("doc-1");
    });
    expect(container.innerHTML).toBe("");
    // …and the SAME set forking again later must raise, not read as dismissed.
    mockList.mockResolvedValue(FORKED);
    await act(async () => {
      await scanSyncConflicts("doc-1");
    });
    expect(container.innerHTML).not.toBe("");
  });
});

describe("sync-conflict cleanup affordance (task 411)", () => {
  /** Open the kebab menu and return the rendered menu element. */
  async function openMenu(container: HTMLElement): Promise<HTMLElement> {
    const kebab = container.querySelector("button[aria-haspopup='menu']");
    expect(kebab, "the badge must render its kebab").not.toBeNull();
    await act(async () => {
      (kebab as HTMLButtonElement).click();
    });
    const menu = document.querySelector("[role='menu']");
    expect(menu, "the menu must open").not.toBeNull();
    return menu as HTMLElement;
  }

  function rowLabelled(menu: HTMLElement, needle: string): HTMLButtonElement | null {
    return (
      [...menu.querySelectorAll("button")].find((b) =>
        (b.textContent ?? "").includes(needle),
      ) ?? null
    );
  }

  it("offers the row with the PROVED-INERT count, not the pill's fork total", async () => {
    // FORKED holds 3 conflict forks (2 of `notes`, 1 of `editor-state`) plus one
    // `.crswap`. The pill says 3 — that is the report. The plan is 2: the
    // view-tier fork and the debris. A row that said "3" would be offering to
    // delete a note the user wrote.
    mockList.mockResolvedValue(FORKED);
    const { container } = render(<SyncConflictBadge docId="doc-1" />);
    await act(async () => {
      await scanSyncConflicts("doc-1");
    });
    expect(
      container
        .querySelector("[data-sync-conflict-notice]")!
        .getAttribute("data-sync-conflict-notice"),
    ).toBe("3");
    const menu = await openMenu(container);
    const row = rowLabelled(menu, "that carry nothing");
    expect(row, "the cleanup row must be offered").not.toBeNull();
    expect(row!.textContent).toContain("Delete 2 files");
  });

  it("offers NOTHING when every fork is content — the row is absent, not disabled", async () => {
    // A false affordance is the shape this cluster legislates against: a row
    // that opens a confirm the door would then refuse in full.
    mockList.mockResolvedValue([
      "notes.json",
      "notes (Gabriel Greenberg's conflicted copy 2026-06-09).json",
    ]);
    const { container } = render(<SyncConflictBadge docId="doc-1" />);
    await act(async () => {
      await scanSyncConflicts("doc-1");
    });
    const menu = await openMenu(container);
    expect(rowLabelled(menu, "that carry nothing")).toBeNull();
    expect(rowLabelled(menu, "Dismiss for this session")).not.toBeNull();
  });

  it("names every file in the confirm, and hands the door exactly the plan", async () => {
    beginDocPipeline("doc-1");
    mockDelete.mockResolvedValue({
      deleted: [
        "editor-state (Gabriel Greenberg's conflicted copy 2026-08-18).json",
        "archive.json.1.crswap",
      ],
      refused: [],
      failed: [],
    });
    mockList.mockResolvedValue(FORKED);
    const { container } = render(<SyncConflictBadge docId="doc-1" />);
    await act(async () => {
      await scanSyncConflicts("doc-1");
    });
    const menu = await openMenu(container);
    await act(async () => {
      rowLabelled(menu, "that carry nothing")!.click();
    });

    // The confirm names EXACTLY what will go, and says what is being kept.
    const dialog = document.querySelector("[role='dialog']");
    expect(dialog, "the confirm must open before anything is deleted").not.toBeNull();
    const text = dialog!.textContent ?? "";
    expect(text).toContain(
      "editor-state (Gabriel Greenberg's conflicted copy 2026-08-18).json",
    );
    expect(text).toContain("archive.json.1.crswap");
    // …and never a content fork.
    expect(text).not.toContain(
      "notes (Gabriel Greenberg's conflicted copy 2026-06-09).json",
    );
    // Nothing has been asked of the door yet.
    expect(mockDelete).not.toHaveBeenCalled();

    const go = [...dialog!.querySelectorAll("button")].find((b) =>
      (b.textContent ?? "").startsWith("Delete 2"),
    );
    expect(go, "the confirm must carry its own delete button").not.toBeUndefined();
    await act(async () => {
      go!.click();
    });
    expect(mockDelete).toHaveBeenCalledTimes(1);
    const [, requested] = mockDelete.mock.calls[0]!;
    expect([...(requested as string[])].sort()).toEqual(
      [
        "archive.json.1.crswap",
        "editor-state (Gabriel Greenberg's conflicted copy 2026-08-18).json",
      ].sort(),
    );
  });

  it("says so when the door could not run at all", async () => {
    // No open pipeline ⇒ `runSyncConflictCleanup` refuses with an empty receipt
    // rather than guessing a destination. A surface that read that as success
    // would silently claim a cleanup that never happened.
    mockList.mockResolvedValue(FORKED);
    const { container } = render(<SyncConflictBadge docId="doc-1" />);
    await act(async () => {
      await scanSyncConflicts("doc-1");
    });
    const menu = await openMenu(container);
    await act(async () => {
      rowLabelled(menu, "that carry nothing")!.click();
    });
    const confirmBtn = [...document.querySelectorAll("[role='dialog'] button")].find(
      (b) => (b.textContent ?? "").startsWith("Delete 2"),
    );
    await act(async () => {
      (confirmBtn as HTMLButtonElement).click();
    });
    expect(mockDelete).not.toHaveBeenCalled(); // no handle — the door is never reached
    const report = document.querySelector("[role='dialog']")!;
    expect(report.textContent).toContain("Nothing was deleted");
    // Dismiss it — an open portal would otherwise be the next leg's `[role=dialog]`.
    await act(async () => {
      ([...report.querySelectorAll("button")].find(
        (b) => (b.textContent ?? "").trim() === "OK",
      ) as HTMLButtonElement).click();
    });
  });

  it("a door that THROWS is reported, not swallowed into a dead button", async () => {
    beginDocPipeline("doc-1");
    mockDelete.mockRejectedValue(new Error("permission lost"));
    mockList.mockResolvedValue(FORKED);
    const { container } = render(<SyncConflictBadge docId="doc-1" />);
    await act(async () => {
      await scanSyncConflicts("doc-1");
    });
    const menu = await openMenu(container);
    await act(async () => {
      rowLabelled(menu, "that carry nothing")!.click();
    });
    await act(async () => {
      ([...document.querySelectorAll("[role='dialog'] button")].find((b) =>
        (b.textContent ?? "").startsWith("Delete 2"),
      ) as HTMLButtonElement).click();
    });
    const report = document.querySelector("[role='dialog']")!;
    expect(report.textContent).toContain("Nothing was deleted");
    await act(async () => {
      ([...report.querySelectorAll("button")].find(
        (b) => (b.textContent ?? "").trim() === "OK",
      ) as HTMLButtonElement).click();
    });
  });

  it("cancelling deletes NOTHING", async () => {
    beginDocPipeline("doc-1");
    mockList.mockResolvedValue(FORKED);
    const { container } = render(<SyncConflictBadge docId="doc-1" />);
    await act(async () => {
      await scanSyncConflicts("doc-1");
    });
    const menu = await openMenu(container);
    await act(async () => {
      rowLabelled(menu, "that carry nothing")!.click();
    });
    const dialog = document.querySelector("[role='dialog']")!;
    const cancel = [...dialog.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === "Cancel",
    );
    expect(cancel, "a danger confirm cues its safest button").not.toBeUndefined();
    await act(async () => {
      cancel!.click();
    });
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe("sync-conflict wiring", () => {
  const REPO = path.resolve(__dirname, "../../..");

  it("the doc-open path calls the scan, and the badge is mounted", () => {
    // A source leg on purpose: the defect this whole task closes is SILENCE,
    // and a scan nobody calls (or a badge nobody renders) is silent in exactly
    // the same way, with every behavioural leg above still green.
    const useFiles = fs.readFileSync(
      path.join(REPO, "src/hooks/useFiles.ts"),
      "utf8",
    );
    // Keyed on `currentDocId`, NOT on activateDoc: the paths that actually open
    // an already-indexed paper (`openFile` from Recents, `createFile`, the
    // session-restore effect) all set `currentDocId` directly and never reach
    // `activateDoc`, so a scan wired there fired for a first-ever picker open
    // and never again.
    expect(useFiles).toContain("void scanSyncConflicts(currentDocId);");
    expect(useFiles).not.toContain("scanSyncConflicts(meta.id)");
    const cluster = fs.readFileSync(
      path.join(REPO, "src/components/editor-layout/StatusCluster.tsx"),
      "utf8",
    );
    expect(cluster).toContain("<SyncConflictBadge docId={currentDocId} />");
  });

  it("both storage backends can list the sidecar directory", () => {
    // The scan is only as portable as its listing; a backend without one would
    // make the whole surface silently inert there.
    for (const rel of ["src/lib/storage-fsa.ts", "src/lib/storage-dev.ts"]) {
      const src = fs.readFileSync(path.join(REPO, rel), "utf8");
      expect(src, rel).toMatch(/export async function listSidecarNames/);
    }
  });
});
