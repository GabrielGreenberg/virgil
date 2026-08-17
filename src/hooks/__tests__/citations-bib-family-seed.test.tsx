// @vitest-environment jsdom
//
// Task 344, the AUTHORITY half — detection SEEDS a document that has no stored
// family and does nothing otherwise.
//
// Pre-fix, `refreshBib` did:
//
//   if (data.detectedPackage) setState(prev => ({ ...prev, bibPackage: … }))
//
// and `detectBibPackage` never returns null, so the guard was always true. The
// user's explicit Package choice was discarded on every doc open AND on every
// `DOC_BIB_CHANGED_EVENT` — and because `usePersistentState.update` persists
// the whole state object, the next unrelated citations write (adding a
// citation, editing a bib entry, changing the style) wrote the detected family
// to disk over it. From there the SAVE path reads `citations.json` as
// authoritative and injects that `\usepackage` into the user's `.tex`.
//
// The ORDERING is the leg most likely to be got wrong, so it is the one driven
// end-to-end here: `refreshBib` is async and races the sidecar load, so a
// "write only if unset" guard evaluated against the pre-load default would
// still stomp. The shipped fix removes the race by construction — detection
// writes to LOCAL state and never to the sidecar — and the legs below assert
// both halves (the value the hook reports AND the bytes that reach disk).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

interface BibRead {
  bibText: string;
  bibFilename: string;
  detectedPackage?: string;
}

const readSidecarIfExists = vi.fn(
  async (_id: string, _file: string): Promise<unknown> => null,
);
const writeSidecar = vi.fn(
  async (_h: unknown, _file: string, _data: unknown): Promise<void> => undefined,
);
const readBib = vi.fn(
  async (_id: string): Promise<BibRead> => ({
    bibText: "",
    bibFilename: "references.bib",
    detectedPackage: "biblatex",
  }),
);

vi.mock("@/lib/storage", () => ({
  readSidecar: vi.fn(async () => ({})),
  readSidecarIfExists: (id: string, file: string) => readSidecarIfExists(id, file),
  writeSidecar: (h: unknown, file: string, data: unknown) =>
    writeSidecar(h, file, data),
  readBib: (id: string) => readBib(id),
  writeBib: vi.fn(async () => undefined),
}));

import { useCitations } from "../useCitations";
import { DOC_BIB_CHANGED_EVENT } from "@/lib/project-bib";
import { beginDocPipeline, __resetForTests } from "@/lib/multi-window/doc-pipeline";

/** Every `bibPackage` value this session wrote to `citations.json`. */
function persistedFamilies(): unknown[] {
  return writeSidecar.mock.calls
    .filter((c) => c[1] === "citations.json")
    .map((c) => (c[2] as { bibPackage?: unknown } | undefined)?.bibPackage);
}

beforeEach(() => {
  __resetForTests();
  readSidecarIfExists.mockReset();
  readSidecarIfExists.mockResolvedValue(null);
  writeSidecar.mockReset();
  writeSidecar.mockResolvedValue(undefined);
  readBib.mockReset();
  readBib.mockResolvedValue({
    bibText: "",
    bibFilename: "references.bib",
    detectedPackage: "biblatex",
  });
});

describe("useCitations — detection SEEDS, never STOMPS", () => {
  it("a stored natbib survives a .tex that detects biblatex", async () => {
    // The defect leg. Sidecar says natbib (the user's Package choice); the
    // `.tex` detects biblatex. Pre-fix the hook reported biblatex within a
    // tick of mount.
    readSidecarIfExists.mockResolvedValue({
      citations: [],
      bibPath: "",
      citationStyle: "apa",
      bibPackage: "natbib",
    });
    beginDocPipeline("doc-stored-natbib");
    const { result } = renderHook(() => useCitations("doc-stored-natbib"));

    await waitFor(() => expect(readBib).toHaveBeenCalled());
    // Let every pending microtask (the sidecar load AND the .bib read) settle,
    // so a late stomp has every chance to land.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(result.current.bibPackage).toBe("natbib");
  });

  it("…and a later out-of-band .bib change does not stomp it either", async () => {
    // `refreshBib` also runs on DOC_BIB_CHANGED_EVENT — a second stomp site
    // that fires long after load, when the stored family is definitely loaded.
    readSidecarIfExists.mockResolvedValue({
      citations: [],
      bibPath: "",
      citationStyle: "apa",
      bibPackage: "natbib",
    });
    beginDocPipeline("doc-bib-event");
    const { result } = renderHook(() => useCitations("doc-bib-event"));
    await waitFor(() => expect(result.current.bibPackage).toBe("natbib"));

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(DOC_BIB_CHANGED_EVENT, { detail: { docId: "doc-bib-event" } }),
      );
      await new Promise((r) => setTimeout(r, 20));
    });

    expect(result.current.bibPackage).toBe("natbib");
  });

  it("detection never writes a family to citations.json", async () => {
    // The durability half: the stomp was in-memory, but the whole state object
    // is persisted, so an unrelated write made it permanent. Here an unrelated
    // write (adding a citation) must NOT carry a detected family.
    readSidecarIfExists.mockResolvedValue({
      citations: [],
      bibPath: "",
      citationStyle: "apa",
    });
    beginDocPipeline("doc-no-write");
    const { result } = renderHook(() => useCitations("doc-no-write"));
    await waitFor(() => expect(result.current.bibPackage).toBe("biblatex"));

    act(() => {
      result.current.addCitation("\\cite{smith2020}");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });

    expect(writeSidecar).toHaveBeenCalled();
    expect(persistedFamilies().every((f) => f === undefined)).toBe(true);
  });

  it("seeds the VIEW when nothing is stored", async () => {
    // The seed half — without it the fix would be "ignore the .tex", which is
    // not what was asked for. No stored family ⇒ the detected one answers.
    readSidecarIfExists.mockResolvedValue(null);
    beginDocPipeline("doc-seed");
    const { result } = renderHook(() => useCitations("doc-seed"));
    await waitFor(() => expect(result.current.bibPackage).toBe("biblatex"));
  });

  it("the user's own choice IS written, and then wins", async () => {
    // `setBibPackage` is the one writer. Without this leg the suite would pass
    // for a hook that had simply stopped persisting the family at all.
    readSidecarIfExists.mockResolvedValue(null);
    beginDocPipeline("doc-user-choice");
    const { result } = renderHook(() => useCitations("doc-user-choice"));
    await waitFor(() => expect(result.current.bibPackage).toBe("biblatex"));

    act(() => {
      result.current.setBibPackage("natbib");
    });
    expect(result.current.bibPackage).toBe("natbib");

    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(persistedFamilies()).toContain("natbib");
  });

  it("before anything resolves the hook answers the BASELINE, not a second default", async () => {
    // Pre-344 the hook opened at "biblatex" while the detector defaulted to
    // "natbib", so on the majority of documents (the baseline is natbib) an
    // ordinary doc OPEN changed this value — and CitationCard's
    // package-change effect reads any change of it as a package switch and
    // re-derives every citation's command shape.
    let resolveBib: (v: BibRead) => void = () => {};
    readBib.mockImplementation(
      () => new Promise<BibRead>((r) => { resolveBib = r; }),
    );
    readSidecarIfExists.mockResolvedValue(null);
    beginDocPipeline("doc-baseline");
    const { result } = renderHook(() => useCitations("doc-baseline"));

    expect(result.current.bibPackage).toBe("natbib");

    // …and a plain natbib document SETTLES on that same value, so the open
    // costs no observable package change at all.
    await act(async () => {
      resolveBib({ bibText: "", bibFilename: "references.bib", detectedPackage: "natbib" });
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current.bibPackage).toBe("natbib");
  });

  it("a garbage stored value is not authoritative — detection seeds through it", async () => {
    // `bibPackage` is typed as a free-form string on disk. A value this build
    // does not recognize must not shadow detection, or a corrupt sidecar would
    // pin the family forever with no way to see why.
    readSidecarIfExists.mockResolvedValue({
      citations: [],
      bibPath: "",
      citationStyle: "apa",
      bibPackage: "bibtex8",
    });
    beginDocPipeline("doc-garbage");
    const { result } = renderHook(() => useCitations("doc-garbage"));
    await waitFor(() => expect(result.current.bibPackage).toBe("biblatex"));
  });

  it("a doc switch does not carry the previous paper's detected family", async () => {
    readSidecarIfExists.mockResolvedValue(null);
    beginDocPipeline("doc-a");
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useCitations(id),
      { initialProps: { id: "doc-a" } },
    );
    await waitFor(() => expect(result.current.bibPackage).toBe("biblatex"));

    let resolveB: (v: BibRead) => void = () => {};
    readBib.mockImplementation(
      () => new Promise<BibRead>((r) => { resolveB = r; }),
    );
    beginDocPipeline("doc-b");
    rerender({ id: "doc-b" });

    // Doc B's read is still in flight — the answer must be the baseline, not
    // doc A's biblatex.
    expect(result.current.bibPackage).toBe("natbib");
    await act(async () => {
      resolveB({ bibText: "", bibFilename: "references.bib", detectedPackage: "natbib" });
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(result.current.bibPackage).toBe("natbib");
  });
});
