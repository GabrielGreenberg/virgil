// @vitest-environment jsdom
//
// TASK 132 — the reported bug, at the surface that reported it.
//
// The Reader is KEPT ALIVE (`ReaderLRU` wraps the header in a `KeepAliveSlot`
// that hides it with `display:none`, capacity 4), so `PaperHeader` never
// remounts while its tab stays open and `handle`/`citekey` are stable across
// catalog polls. Its queued state used to come from a `[handle, citekey]`
// effect — the ONLY populator — so once a background
// `/loop /library/index-pending` session drained the queue and deleted
// `queue/<citekey>.json`, the AI-request checkboxes and the menu's count badge
// went on claiming "queued" for the whole life of the tab. A re-render (the 6 s
// catalog poll fires plenty) does not re-run a same-deps effect.
//
// So the assertion is deliberately made WITHOUT unmounting anything: drain the
// queue on the virtual disk, let the shared queue-state poll tick, and require
// the live header to tell the truth. It also pins the other direction — a
// request filed elsewhere (a row action in the list) must APPEAR on an open
// header — which the once-per-mount read could never do either.

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { CatalogEntry } from "@library/lib/catalog";

const disk = vi.hoisted(() => ({ files: new Map<string, unknown>() }));

vi.mock("@library/lib/library-storage", () => ({
  SUBDIRS: { queue: ".virgil/queue", notifications: ".virgil/notifications" },
  listDir: vi.fn(async (_root: unknown, path: string) => {
    if (path !== ".virgil/queue") return undefined;
    return [...disk.files.keys()].map((name) => ({
      name,
      kind: "file" as const,
    }));
  }),
  readJsonFile: vi.fn(async (_root: unknown, path: string) => {
    const name = path.split("/").pop() ?? "";
    return disk.files.get(name);
  }),
  writeJsonFile: vi.fn(async () => {}),
  deleteFile: vi.fn(async () => {}),
  writeBinaryFile: vi.fn(async () => {}),
}));

// Heavy/irrelevant children — the assertion is about the AI-request state.
vi.mock("@/components/library/bib-entry-chrome", () => ({
  BibEntryChrome: () => <div data-testid="bib-chrome" />,
}));
vi.mock("../PagePicker", () => ({ default: () => <div /> }));
vi.mock("../BibCard", () => ({ ExpandedFields: () => <div /> }));
vi.mock("@/hooks/useLibrary", () => ({ mapTier: () => "none" }));

const HANDLE = {} as unknown as FileSystemDirectoryHandle;

const ENTRY: CatalogEntry = {
  citekey: "alpha2020",
  title: "A Paper",
  authors: ["Alpha"],
  year: 2020,
  addedAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  pdf: { present: true, pageCount: 12 },
  indexed: { state: "indexed" },
  bib: { state: "authenticated" },
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.resetModules();
  disk.files.clear();
});

afterEach(() => {
  cleanup();
});

/** Open the AI-requests dropdown and read each item's checked state. */
function checkedItems(): string[] {
  fireEvent.click(screen.getByRole("button", { name: /AI requests/i }));
  return screen
    .getAllByRole("menuitemcheckbox")
    .filter((el) => el.getAttribute("aria-checked") === "true")
    .map((el) => (el.textContent ?? "").replace("✓", "").trim());
}

async function mountHeader() {
  const { default: PaperHeader } = await import("../PaperHeader");
  return render(
    <PaperHeader
      handle={HANDLE}
      entry={ENTRY}
      bib={null}
      viewMode="text"
      onViewModeChange={() => {}}
      pdfAvailable
      indexedState="indexed"
    />,
  );
}

describe("PaperHeader — AI-request state re-syncs without a remount (task 132)", () => {
  it("clears a checkbox + the count badge when a skill drains the queue", async () => {
    disk.files.set("alpha2020-deepindex.json", {
      kind: "deepIndex",
      status: "requested",
      citekey: "alpha2020",
    });
    const { refreshQueueState } = await import("@library/lib/queue-state-store");

    await mountHeader();
    await act(flush);

    expect(checkedItems()).toEqual(["Deep index"]);
    expect(
      screen.getByRole("button", { name: /AI requests/i }).textContent,
    ).toContain("1");

    // The background session finishes the deep index and deletes the file.
    // Nothing unmounts — this is the kept-alive Reader.
    disk.files.delete("alpha2020-deepindex.json");
    await act(async () => {
      void refreshQueueState();
      await flush();
    });

    expect(
      screen
        .getAllByRole("menuitemcheckbox")
        .filter((el) => el.getAttribute("aria-checked") === "true"),
    ).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: /AI requests/i }).textContent,
    ).not.toContain("1");
  });

  it("shows a request filed from another surface while the header stays mounted", async () => {
    const { refreshQueueState } = await import("@library/lib/queue-state-store");
    await mountHeader();
    await act(flush);
    expect(checkedItems()).toEqual([]);

    // A row action in the list files a bib review for this paper.
    disk.files.set("alpha2020.json", {
      kind: "authenticate",
      status: "requested",
      citekey: "alpha2020",
    });
    await act(async () => {
      void refreshQueueState();
      await flush();
    });

    expect(
      screen
        .getAllByRole("menuitemcheckbox")
        .filter((el) => el.getAttribute("aria-checked") === "true")
        .map((el) => (el.textContent ?? "").replace("✓", "").trim()),
    ).toEqual(["Bib review"]);
  });

  it("tells `index` and `bib` apart though they share one queue file", async () => {
    disk.files.set("alpha2020.json", {
      kind: "index",
      status: "requested",
      citekey: "alpha2020",
    });
    await mountHeader();
    await act(flush);
    expect(checkedItems()).toEqual(["Index"]);
  });
});
