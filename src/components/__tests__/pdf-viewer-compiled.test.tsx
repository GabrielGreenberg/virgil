// @vitest-environment jsdom
/**
 * The compiled role of the one PDF viewer.
 *
 * A compile is a new file of the same document, and pdf.js cannot tell. Its
 * history is keyed by fingerprint, pdfTeX writes a new `/ID` each time, and it
 * holds 20 files. So the wrapper keeps the reader's place itself and takes the
 * compile out of that history, or a recompile lands on page 1 and twenty of them
 * cost every Library paper its reading position.
 *
 * The viewer is faked on the real iframe's contentWindow (nothing in jsdom can
 * run pdf.js). What the fake stands for is pinned against the vendored source by
 * the census in `library/components/__tests__/PdfView.viewerDefaults.test.ts`.
 */
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import PdfViewer, {
  applyViewerDefaults,
  COMPILED_VIEWER_CLASS,
  placeBookmark,
  type PdfViewerRole,
  type PdfViewerWindow,
} from "../PdfViewer";

afterEach(cleanup);

type Handler = (...a: unknown[]) => void;

/** Install a warm (already initialized) fake viewer on the iframe. */
function installViewer(iframe: HTMLIFrameElement) {
  const handlers = new Map<string, Set<Handler>>();
  const app = {
    initializedPromise: Promise.resolve(),
    open: vi.fn(async (_args: { url: string; originalUrl?: string }) => {}),
    pagesCount: 20,
    page: 1,
    pdfSidebar: { close: vi.fn() },
    pdfLinkService: { externalLinkTarget: 4 as number | null },
    isInitialViewSet: false,
    initialBookmark: null as string | null,
    store: { row: "a history row" } as unknown,
    eventBus: {
      on: (n: string, h: Handler) => {
        if (!handlers.has(n)) handlers.set(n, new Set());
        handlers.get(n)!.add(h);
      },
      off: (n: string, h: Handler) => handlers.get(n)?.delete(h),
    },
  };
  const options = { set: vi.fn() };
  Object.assign(iframe.contentWindow as object, {
    PDFViewerApplication: app,
    PDFViewerApplicationOptions: options,
  });
  const fire = (name: string, arg?: unknown) => {
    for (const h of handlers.get(name) ?? []) h(arg);
  };
  return { app, options, fire };
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** Mount with nothing to show, install the fake, then return a way to set the URL. */
function mount(id: string, role: PdfViewerRole = "compiled") {
  const element = (url: string | null, docId = id) => (
    <PdfViewer id={docId} url={url} filename="main.pdf" role={role} />
  );
  const view = render(element(null));
  const iframe = view.container.querySelector("iframe") as HTMLIFrameElement;
  const viewer = installViewer(iframe);
  const show = async (url: string, docId = id) => {
    view.rerender(element(url, docId));
    await settle();
  };
  return { ...viewer, iframe, show, view };
}

/** A first view landed, and the reader moved to `place`. */
function readerAt(
  v: ReturnType<typeof mount>,
  place: { pageNumber: number; scale: number | string; left: number; top: number },
) {
  v.fire("pagesinit");
  v.app.isInitialViewSet = true;
  v.fire("updateviewarea", { location: place });
}

describe("a recompile keeps the reader's place", () => {
  it("opens the new revision in the SAME viewer, at the place the reader left", async () => {
    const v = mount("doc-same-viewer");
    await v.show("blob:rev-1");
    readerAt(v, { pageNumber: 7, scale: "page-width", left: 0, top: 512 });

    v.app.isInitialViewSet = false; // `close()` clears it as the next file opens.
    await v.show("blob:rev-2");
    expect(v.app.open).toHaveBeenCalledTimes(2);
    expect(v.app.open.mock.calls[1][0]).toEqual({ url: "blob:rev-2", originalUrl: "main.pdf" });
    v.fire("pagesinit");
    expect(v.app.initialBookmark).toBe("page=7&zoom=page-width,0,512");
    expect(v.view.container.querySelector("iframe")).toBe(v.iframe);
  });

  it("a revision shorter than the reader's page lands on its last page", async () => {
    const v = mount("doc-shorter");
    await v.show("blob:rev-1");
    readerAt(v, { pageNumber: 18, scale: 125, left: 3, top: 90 });

    v.app.isInitialViewSet = false;
    v.app.pagesCount = 12;
    await v.show("blob:rev-2");
    v.fire("pagesinit");
    expect(v.app.initialBookmark).toBe("page=12&zoom=125,3,90");
  });

  it("the page-1 default pdf.js reports before its first view is not the reader's place", async () => {
    const v = mount("doc-first-view");
    await v.show("blob:rev-1");
    readerAt(v, { pageNumber: 9, scale: 100, left: 0, top: 40 });

    v.app.isInitialViewSet = false;
    await v.show("blob:rev-2");
    v.fire("pagesinit");
    v.fire("updateviewarea", { location: { pageNumber: 1, scale: 100, left: 0, top: 0 } });

    await v.show("blob:rev-3");
    v.fire("pagesinit");
    expect(v.app.initialBookmark).toBe("page=9&zoom=100,0,40");
  });

  it("closing the pane and reopening it returns to the place", async () => {
    const first = mount("doc-remount");
    await first.show("blob:rev-1");
    readerAt(first, { pageNumber: 4, scale: 110, left: 0, top: 200 });
    first.view.unmount();

    const second = mount("doc-remount");
    await second.show("blob:rev-1");
    second.fire("pagesinit");
    expect(second.app.initialBookmark).toBe("page=4&zoom=110,0,200");
  });

  it("two papers keep two places", async () => {
    const a = mount("doc-place-a");
    await a.show("blob:a");
    readerAt(a, { pageNumber: 3, scale: 100, left: 0, top: 10 });
    a.view.unmount();

    const b = mount("doc-place-b");
    await b.show("blob:b");
    b.fire("pagesinit");
    expect(b.app.initialBookmark).toBeNull();
  });

  it("a paper with no place yet opens wherever pdf.js would", async () => {
    const v = mount("doc-fresh");
    await v.show("blob:rev-1");
    v.fire("pagesinit");
    expect(v.app.initialBookmark).toBeNull();
  });
});

describe("a compile stays out of pdf.js's history", () => {
  it("drops the row before the first view, so nothing is ever written", async () => {
    const v = mount("doc-history");
    await v.show("blob:rev-1");
    expect(v.app.store).not.toBeNull();
    v.fire("pagesinit");
    expect(v.app.store).toBeNull();
  });
});

describe("a Library paper is untouched by any of this", () => {
  it("keeps its history row and sets no bookmark", async () => {
    const v = mount("doc-reading", "reading");
    await v.show("blob:paper");
    readerAt(v, { pageNumber: 5, scale: 100, left: 0, top: 10 });
    expect(v.app.store).not.toBeNull();

    v.app.isInitialViewSet = false;
    await v.show("blob:paper-again");
    v.fire("pagesinit");
    expect(v.app.initialBookmark).toBeNull();
  });
});

describe("the door, by role", () => {
  const root = () => ({
    classes: new Set<string>(),
    get classList() {
      const c = this.classes;
      return {
        add: (n: string) => void c.add(n),
        remove: (n: string) => void c.delete(n),
        toggle: (n: string, on: boolean) => {
          if (on) c.add(n);
          else c.delete(n);
        },
      };
    },
    style: { getPropertyValue: () => "", setProperty: () => {}, removeProperty: () => {} },
  });
  const fakeWin = () => {
    const documentElement = root();
    const links = { externalLinkTarget: 4 as number | null };
    const set = vi.fn();
    const win = {
      document: { documentElement },
      PDFViewerApplication: { open: vi.fn(), pdfLinkService: links },
      PDFViewerApplicationOptions: { set },
    } as unknown as PdfViewerWindow;
    return { win, documentElement, links, set };
  };

  it("compiled: the toolbar class goes on, and print is sharp", () => {
    const { win, documentElement, set } = fakeWin();
    applyViewerDefaults(win, "compiled");
    expect(documentElement.classes.has(COMPILED_VIEWER_CLASS)).toBe(true);
    expect(set).toHaveBeenCalledWith("printResolution", 300);
  });

  it("reading: neither", () => {
    const { win, documentElement, set } = fakeWin();
    applyViewerDefaults(win);
    expect(documentElement.classes.has(COMPILED_VIEWER_CLASS)).toBe(false);
    expect(set).not.toHaveBeenCalledWith("printResolution", expect.anything());
  });

  it("both roles send external links to a new window, never over Virgil", () => {
    for (const role of ["compiled", "reading"] as const) {
      const { win, links } = fakeWin();
      applyViewerDefaults(win, role);
      expect(links.externalLinkTarget).toBe(2);
    }
  });

  it("a viewer with no link service yet is not an error", () => {
    const win = { PDFViewerApplication: { open: vi.fn() } } as unknown as PdfViewerWindow;
    expect(() => applyViewerDefaults(win, "compiled")).not.toThrow();
  });
});

describe("placeBookmark", () => {
  it("states a place as the hash pdf.js opens at", () => {
    expect(placeBookmark({ pageNumber: 2, scale: "auto", left: -5, top: 700 }, 9)).toBe(
      "page=2&zoom=auto,-5,700",
    );
  });

  it("an empty count never yields page 0", () => {
    expect(placeBookmark({ pageNumber: 2, scale: 100, left: 0, top: 0 }, 0)).toBe(
      "page=1&zoom=100,0,0",
    );
  });
});
