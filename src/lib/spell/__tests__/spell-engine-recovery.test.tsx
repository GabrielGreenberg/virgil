// @vitest-environment jsdom
//
// Task 2026-09-15-580 — one failed dictionary load must cost a DELAY, not the
// session.
//
// Pre-580 a failure set a latch, the latch made the port report DISABLED, a
// disabled surface never asks the client again, and the latch's only reset
// lived inside a successful ask — so the retry the worker was built for was
// dead code, and every word asked during the outage was cached KNOWN forever.
// No pre-580 suite could see any of it: nothing drove the REAL client through a
// failure at all (every decorator suite hands the plugin a hand-built port
// whose engine never fails).
//
// These legs drive the REAL `spell-client` against a mocked dictionary fetch
// that fails and then succeeds, the REAL provider over it, and a stand-in
// Worker that crashes mid-request.
import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { useEffect, useState } from "react";

const fetchState = vi.hoisted(() => ({ failNext: 0, calls: 0 }));

vi.mock("@/lib/spell/spell-core", () => ({
  fetchDictionaryText: async () => {
    fetchState.calls++;
    if (fetchState.failNext > 0) {
      fetchState.failNext--;
      throw new Error("offline");
    }
    return { aff: "", dic: "" };
  },
  createSpellEngine: () => ({
    isKnown: (w: string) => w !== "teh",
    suggest: () => ["the"],
  }),
}));

import {
  __resetSpellClientForTest,
  ensureChecked,
  knownSync,
  onSpellAvailabilityChange,
  spellAvailabilityEpoch,
  spellEngineAvailable,
  spellRetryDelayMs,
  SPELL_RETRY_BASE_MS,
  SPELL_RETRY_CAP_MS,
} from "@/lib/spell/spell-client";
import { __resetTabReturnForTests } from "@/lib/tab-hidden";
import {
  SpellcheckProvider,
  useSpellcheckPortRef,
} from "@/lib/spell/spellcheck-context";
import type { SpellcheckPort } from "@/lib/spell/spell-port";

beforeEach(() => {
  vi.useFakeTimers();
  __resetSpellClientForTest();
  __resetTabReturnForTests();
  fetchState.failNext = 0;
  fetchState.calls = 0;
});
afterEach(() => {
  cleanup();
  __resetSpellClientForTest();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Let every pending promise chain settle without moving the clock. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe("a failed load is RECOVERABLE", () => {
  it("fails, then the back-off probe recovers — and the outage's words are checked for real", async () => {
    fetchState.failNext = 1;
    await ensureChecked(["teh", "the"]);
    expect(spellEngineAvailable()).toBe(false);
    // NO failure verdict: pre-580 both were recorded KNOWN forever.
    expect(knownSync("teh")).toBeUndefined();
    expect(knownSync("the")).toBeUndefined();

    await vi.advanceTimersByTimeAsync(SPELL_RETRY_BASE_MS);
    expect(spellEngineAvailable()).toBe(true);

    await ensureChecked(["teh", "the"]);
    expect(knownSync("teh")).toBe(false); // a misspelling IS flagged
    expect(knownSync("the")).toBe(true);
  });

  it("the back-off DOUBLES while the dictionary stays unreachable, up to a cap", async () => {
    expect(spellRetryDelayMs(1)).toBe(SPELL_RETRY_BASE_MS);
    expect(spellRetryDelayMs(2)).toBe(SPELL_RETRY_BASE_MS * 2);
    expect(spellRetryDelayMs(99)).toBe(SPELL_RETRY_CAP_MS);

    fetchState.failNext = 2; // the load AND the first probe fail
    await ensureChecked(["teh"]);
    const afterLoad = fetchState.calls;

    await vi.advanceTimersByTimeAsync(SPELL_RETRY_BASE_MS);
    expect(fetchState.calls).toBe(afterLoad + 1); // first probe (fails)
    expect(spellEngineAvailable()).toBe(false);

    // The second probe is TWO base delays out, not one.
    await vi.advanceTimersByTimeAsync(SPELL_RETRY_BASE_MS);
    expect(fetchState.calls).toBe(afterLoad + 1);
    await vi.advanceTimersByTimeAsync(SPELL_RETRY_BASE_MS);
    expect(fetchState.calls).toBe(afterLoad + 2);
    expect(spellEngineAvailable()).toBe(true);
  });

  it("the tab RETURN edge retries at once, without waiting out the back-off", async () => {
    fetchState.failNext = 1;
    await ensureChecked(["teh"]);
    expect(spellEngineAvailable()).toBe(false);
    window.dispatchEvent(new Event("focus"));
    await flush();
    expect(spellEngineAvailable()).toBe(true);
  });

  it("`online` retries at once", async () => {
    fetchState.failNext = 1;
    await ensureChecked(["teh"]);
    window.dispatchEvent(new Event("online"));
    await flush();
    expect(spellEngineAvailable()).toBe(true);
  });

  it("each FLIP is published once — the failure and the recovery — and moves the epoch", async () => {
    const seen: boolean[] = [];
    const off = onSpellAvailabilityChange(() => seen.push(spellEngineAvailable()));
    const epoch0 = spellAvailabilityEpoch();
    fetchState.failNext = 2;
    await ensureChecked(["teh"]);
    await vi.advanceTimersByTimeAsync(SPELL_RETRY_BASE_MS); // failed probe: not news
    await vi.advanceTimersByTimeAsync(SPELL_RETRY_BASE_MS * 2); // recovers
    expect(seen).toEqual([false, true]);
    expect(spellAvailabilityEpoch()).toBe(epoch0 + 2);
    off();
  });
});

describe("a crashed WORKER is not a failed dictionary", () => {
  it("a request stranded by `onerror` is answered by the main-thread engine", async () => {
    class CrashingWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: Event) => void) | null = null;
      postMessage() {
        queueMicrotask(() => this.onerror?.(new Event("error")));
      }
      terminate() {}
    }
    vi.stubGlobal("Worker", CrashingWorker);
    await ensureChecked(["teh", "the"]);
    expect(spellEngineAvailable()).toBe(true);
    expect(knownSync("teh")).toBe(false);
    expect(knownSync("the")).toBe(true);
  });
});

describe("the provider publishes availability to the surface", () => {
  function Capture({ onPort }: { onPort: (p: SpellcheckPort | null) => void }) {
    const ref = useSpellcheckPortRef();
    useEffect(() => onPort(ref.current));
    return null;
  }
  const box: { p: SpellcheckPort | null } = { p: null };
  const capture = (p: SpellcheckPort | null) => {
    box.p = p;
  };

  function mount() {
    render(
      <SpellcheckProvider
        enabled
        autocorrect={false}
        paperWords={[]}
        addPaperWord={() => {}}
        globalWords={[]}
        bibEntries={[]}
      >
        <Capture onPort={capture} />
      </SpellcheckProvider>,
    );
    return box.p as SpellcheckPort;
  }

  it("a failure DISABLES the port, a recovery re-enables it — each pushed, each a new version", async () => {
    const port = mount();
    const pushes: boolean[] = [];
    const off = port.onInvalidate(() => pushes.push(port.enabled()));
    const v0 = port.version();
    expect(Object.is(port.version(), v0)).toBe(true); // stable when nothing changed

    fetchState.failNext = 1;
    await act(async () => {
      await port.ensure(["teh"]);
    });
    expect(port.enabled()).toBe(false);
    const v1 = port.version();
    expect(Object.is(v1, v0)).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(SPELL_RETRY_BASE_MS);
    });
    expect(port.enabled()).toBe(true);
    expect(Object.is(port.version(), v1)).toBe(false); // ⇒ one whole-doc re-check
    expect(pushes).toEqual([false, true]);
    off();
  });

  it("a render-derived token change is PUSHED too, not left for the next transaction", async () => {
    let add: (w: string) => void = () => {};
    function Stateful() {
      const [words, setWords] = useState<string[]>([]);
      add = (w) => setWords((prev) => [...prev, w]);
      return (
        <SpellcheckProvider
          enabled
          autocorrect={false}
          paperWords={words}
          addPaperWord={(w) => add(w)}
          globalWords={[]}
          bibEntries={[]}
        >
          <Capture onPort={capture} />
        </SpellcheckProvider>
      );
    }
    render(<Stateful />);
    const port = box.p as SpellcheckPort;
    let pushed = 0;
    const off = port.onInvalidate(() => pushed++);
    act(() => port.acceptInPaper("zzyzx"));
    expect(port.isAccepted("zzyzx")).toBe(true);
    expect(pushed).toBeGreaterThan(0);
    off();
  });
});
