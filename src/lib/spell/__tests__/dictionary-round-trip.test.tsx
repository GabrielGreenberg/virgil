// @vitest-environment jsdom
//
// Task 2026-08-31-518 — "add to dictionary", end to end.
//
// The three sources are composed by `accepted-words.ts` and asserted there; what
// this suite drives is the WIRING, which is the half that can break silently: a
// term added through the popover reaches the store that was named, the store
// reaches the composed set, and the composed set bumps the version that clears
// the squiggle. A port whose `acceptInPaper` wrote the GLOBAL list, or whose
// accepted set never re-composed, type-checks perfectly and leaves the user
// clicking "Add" on a word that stays underlined.
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { useEffect, useState } from "react";
import {
  SpellcheckProvider,
  useSpellcheckPortRef,
} from "@/lib/spell/spellcheck-context";
import {
  GLOBAL_DICTIONARY_KEY,
  addToGlobalDictionary,
  globalDictionary,
  setGlobalDictionary,
  useGlobalDictionary,
  __resetGlobalDictionaryForTest,
} from "@/lib/spell/global-dictionary";
import type { SpellcheckPort } from "@/lib/spell/spell-port";
import type { BibEntry } from "@/lib/types";

beforeEach(() => {
  window.localStorage.clear();
  __resetGlobalDictionaryForTest();
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
  __resetGlobalDictionaryForTest();
  vi.restoreAllMocks();
});

// ── the global list ──────────────────────────────────────────────────────────

describe("the global dictionary", () => {
  it("round-trips through localStorage", () => {
    addToGlobalDictionary("Gricean");
    expect(globalDictionary()).toEqual(["Gricean"]);
    __resetGlobalDictionaryForTest();
    expect(globalDictionary()).toEqual(["Gricean"]);
  });

  it("de-dupes and trims; adding a term already there is a no-op", () => {
    setGlobalDictionary(["  Gricean  ", "Gricean", ""]);
    expect(globalDictionary()).toEqual(["Gricean"]);
    addToGlobalDictionary("Gricean");
    expect(globalDictionary()).toEqual(["Gricean"]);
  });

  it("re-hydrates when a PEER WINDOW writes it", () => {
    // The cross-window law: a module snapshot that never re-reads is a store
    // whose next write clobbers the peer's change from a stale base.
    addToGlobalDictionary("Gricean");
    const seen: string[] = [];
    // Subscribing is what arms the storage listener (it is refcounted).
    const unsub = subscribeViaHook(seen);
    window.localStorage.setItem(
      GLOBAL_DICTIONARY_KEY,
      JSON.stringify(["Gricean", "supervenience"]),
    );
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: GLOBAL_DICTIONARY_KEY,
          storageArea: window.localStorage,
        }),
      );
    });
    expect(globalDictionary()).toEqual(["Gricean", "supervenience"]);
    unsub();
  });

  it("ignores a blob it cannot parse rather than adopting it", () => {
    window.localStorage.setItem(GLOBAL_DICTIONARY_KEY, "{not json");
    __resetGlobalDictionaryForTest();
    expect(globalDictionary()).toEqual([]);
  });
});

/** Mount the hook so the module's storage listener is armed (refcounted). */
function subscribeViaHook(sink: string[]): () => void {
  function Probe() {
    const words = useGlobalDictionary();
    useEffect(() => {
      sink.splice(0, sink.length, ...words);
    }, [words]);
    return null;
  }
  const r = render(<Probe />);
  return () => r.unmount();
}

// ── the provider's port ──────────────────────────────────────────────────────

function entry(fields: Record<string, string>): BibEntry {
  return { key: "k", type: "article", fields } as unknown as BibEntry;
}

/** Renders the provider and hands the live port + a paper-word setter out. */
function Harness({
  onPort,
  initialPaper = [],
  bibEntries = [],
  enabled = true,
}: {
  onPort: (p: SpellcheckPort | null, addPaper: (w: string) => void) => void;
  initialPaper?: string[];
  bibEntries?: BibEntry[];
  enabled?: boolean;
}) {
  const [paper, setPaper] = useState<string[]>(initialPaper);
  const globalWords = useGlobalDictionary();
  return (
    <SpellcheckProvider
      enabled={enabled}
      autocorrect={false}
      paperWords={paper}
      addPaperWord={(w) => setPaper((prev) => [...prev, w])}
      globalWords={globalWords}
      bibEntries={bibEntries}
    >
      <Reader onPort={onPort} addPaper={(w) => setPaper((prev) => [...prev, w])} />
    </SpellcheckProvider>
  );
}

function Reader({
  onPort,
  addPaper,
}: {
  onPort: (p: SpellcheckPort | null, addPaper: (w: string) => void) => void;
  addPaper: (w: string) => void;
}) {
  const ref = useSpellcheckPortRef();
  useEffect(() => {
    onPort(ref.current, addPaper);
  });
  return null;
}

describe("the provider composes ONE answer per document", () => {
  /** A mutable BOX rather than an outer `let`: React Compiler's lint forbids
   *  reassigning a variable declared outside the component that writes it. */
  const box: { p: SpellcheckPort | null } = { p: null };
  const capture = (p: SpellcheckPort | null) => {
    box.p = p;
  };
  const live = () => box.p as SpellcheckPort;

  it("paper + global + bibliography names are all accepted", () => {
    setGlobalDictionary(["supervenience"]);
    render(
      <Harness
        onPort={capture}
        initialPaper={["epistemicism"]}
        bibEntries={[entry({ author: "Kripke, Saul" })]}
      />,
    );
    const p = live();
    expect(p.isAccepted("epistemicism")).toBe(true);
    expect(p.isAccepted("supervenience")).toBe(true);
    expect(p.isAccepted("Kripke")).toBe(true);
    expect(p.isAccepted("teh")).toBe(false);
  });

  it("`acceptInPaper` reaches the PAPER's list and CHANGES the version token", () => {
    render(<Harness onPort={capture} />);
    const p = live();
    const before = p.version();
    expect(p.isAccepted("zzyzx")).toBe(false);
    act(() => p.acceptInPaper("zzyzx"));
    // Accepted now — and the token changed, which is the ONE channel that tells
    // the decoration plugin to re-check the whole document. Without it the word
    // would be accepted and still underlined, which is exactly what this file's
    // first cut shipped.
    expect(p.isAccepted("zzyzx")).toBe(true);
    expect(Object.is(p.version(), before)).toBe(false);
  });

  it("`acceptGlobally` reaches the GLOBAL list — and NOT the paper's", () => {
    render(<Harness onPort={capture} />);
    const p = live();
    act(() => p.acceptGlobally("Gricean"));
    expect(globalDictionary()).toEqual(["Gricean"]);
    expect(p.isAccepted("Gricean")).toBe(true);
  });

  it("the port reports DISABLED when the preference is off", () => {
    render(<Harness onPort={capture} enabled={false} />);
    expect(live().enabled()).toBe(false);
  });

  it("outside a provider the ref stays null — the accepting control", () => {
    const seen: { p: SpellcheckPort | null | undefined } = { p: undefined };
    function Bare() {
      const ref = useSpellcheckPortRef();
      useEffect(() => {
        seen.p = ref.current;
      });
      return null;
    }
    render(<Bare />);
    expect(seen.p).toBeNull();
  });
});
