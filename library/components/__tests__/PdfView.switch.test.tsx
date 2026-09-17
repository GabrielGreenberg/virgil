// @vitest-environment jsdom
/**
 * Task 612 — PdfView's source is ONE fact, and a paper switch is WARM.
 *
 * Before the fix the blob URL and the citekey were two states. On an in-place
 * citekey change (the standalone paper tab) the commit revoked paper A's URL
 * and then re-ran the open effect with that revoked URL and citekey B, so
 * pdf.js closed the document on screen and tried to open A's dead blob titled
 * `B.pdf`. And the `!url` "Loading PDF…" early return unmounted the iframe, so
 * the "one warm viewer across switches" the doctrine describes never existed.
 *
 * The viewer is faked on the real iframe's contentWindow (nothing in jsdom can
 * run pdf.js); `readFile` is a deferred mock so each read resolves on cue.
 */
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reads = new Map<string, (file: Blob | null) => void>();
vi.mock("@library/lib/library-storage", () => ({
  readFile: vi.fn(
    (_handle: unknown, path: string) =>
      new Promise<Blob | null>((resolve) => reads.set(path, resolve)),
  ),
}));

import PdfView from "../PdfView";

const handle = {} as FileSystemDirectoryHandle;
const pathOf = (k: string) => `papers/${k}/${k}.pdf`;

let minted = 0;
const revoked = new Set<string>();
const opens: { url: string; originalUrl?: string; revokedAtCall: boolean }[] = [];

beforeEach(() => {
  minted = 0;
  revoked.clear();
  opens.length = 0;
  reads.clear();
  URL.createObjectURL = vi.fn(() => `blob:fake/${++minted}`);
  URL.revokeObjectURL = vi.fn((u: string) => void revoked.add(u));
});

afterEach(() => {
  vi.clearAllMocks();
});

/** Install a warm (already initialized) fake viewer on the iframe. */
function installViewer(iframe: HTMLIFrameElement) {
  const handlers = new Map<string, Set<(...a: unknown[]) => void>>();
  const app = {
    initializedPromise: Promise.resolve(),
    open: vi.fn(async (args: { url: string; originalUrl?: string }) => {
      opens.push({ ...args, revokedAtCall: revoked.has(args.url) });
    }),
    pagesCount: 0,
    page: 1,
    pdfSidebar: { close: vi.fn() },
    eventBus: {
      on: (n: string, h: (...a: unknown[]) => void) => {
        if (!handlers.has(n)) handlers.set(n, new Set());
        handlers.get(n)!.add(h);
      },
      off: (n: string, h: (...a: unknown[]) => void) => handlers.get(n)?.delete(h),
    },
  };
  Object.assign(iframe.contentWindow as object, {
    PDFViewerApplication: app,
    PDFViewerApplicationOptions: { set: vi.fn() },
  });
  return { app, handlers };
}

async function resolveRead(citekey: string, file: Blob | null) {
  await act(async () => {
    reads.get(pathOf(citekey))!(file);
    await new Promise((r) => setTimeout(r, 0));
  });
}

describe("PdfView — an in-place paper switch (task 612)", () => {
  it("never opens a URL under another paper's title, nor a revoked URL, and keeps ONE iframe", async () => {
    const { container, rerender } = render(<PdfView handle={handle} citekey="A" />);
    const iframe = container.querySelector("iframe")!;
    // The viewer mounts while the first read is still pending.
    expect(iframe).not.toBeNull();
    expect(container.textContent).toContain("Loading PDF…");
    installViewer(iframe);

    await resolveRead("A", new Blob(["a"]));
    expect(opens).toEqual([
      { url: "blob:fake/1", originalUrl: "A.pdf", revokedAtCall: false },
    ]);

    await act(async () => {
      rerender(<PdfView handle={handle} citekey="B" />);
      await new Promise((r) => setTimeout(r, 0));
    });
    // Pre-fix: A's (revoked) URL was re-opened here titled B.pdf.
    expect(opens).toHaveLength(1);
    expect(container.querySelector("iframe")).toBe(iframe);
    expect(container.textContent).toContain("Loading PDF…");

    await resolveRead("B", new Blob(["b"]));
    expect(container.querySelector("iframe")).toBe(iframe);
    expect(container.textContent).not.toContain("Loading PDF…");

    const forB = opens.filter((o) => o.originalUrl === "B.pdf");
    expect(forB).toEqual([{ url: "blob:fake/2", originalUrl: "B.pdf", revokedAtCall: false }]);
    expect(opens.every((o) => !o.revokedAtCall)).toBe(true);
    // A's URL is released once B replaced it — and B's is still alive.
    expect(revoked.has("blob:fake/1")).toBe(true);
    expect(revoked.has("blob:fake/2")).toBe(false);
  });

  it("a paper with no PDF shows the notice over the SAME viewer, and releases the previous source", async () => {
    const pageStates: number[] = [];
    const onState = (s: { pagesCount: number }) => void pageStates.push(s.pagesCount);
    const { container, rerender, unmount } = render(
      <PdfView handle={handle} citekey="A" onPdfPageStateChange={onState} />,
    );
    const iframe = container.querySelector("iframe")!;
    installViewer(iframe);
    await resolveRead("A", new Blob(["a"]));

    await act(async () => {
      rerender(<PdfView handle={handle} citekey="C" onPdfPageStateChange={onState} />);
    });
    await resolveRead("C", null);
    expect(container.textContent).toContain("No PDF on disk for");
    expect(container.querySelector("iframe")).toBe(iframe);
    expect(revoked.has("blob:fake/1")).toBe(true);
    // The picker was reset to not-ready when A stopped being the live source.
    expect(pageStates.at(-1)).toBe(0);
    expect(opens.filter((o) => o.originalUrl === "C.pdf")).toEqual([]);

    // And the warm viewer still serves the next real paper.
    await act(async () => {
      rerender(<PdfView handle={handle} citekey="D" onPdfPageStateChange={onState} />);
    });
    await resolveRead("D", new Blob(["d"]));
    expect(container.textContent).not.toContain("No PDF on disk");
    expect(opens.at(-1)).toEqual({ url: "blob:fake/2", originalUrl: "D.pdf", revokedAtCall: false });

    unmount();
    expect(revoked.has("blob:fake/2")).toBe(true);
  });

  it("opens once even when the eager attempt and the load event both clear init (cold mount)", async () => {
    const { container } = render(<PdfView handle={handle} citekey="A" />);
    const iframe = container.querySelector("iframe")!;
    const { app } = installViewer(iframe);
    await resolveRead("A", new Blob(["a"]));
    await act(async () => {
      iframe.dispatchEvent(new Event("load"));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(app.open).toHaveBeenCalledTimes(1);
  });
});
