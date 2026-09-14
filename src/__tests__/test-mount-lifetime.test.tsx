// @vitest-environment jsdom
//
// A TEST owns its mounts' lifetime (task 566).
//
// Testing Library registers its per-test `cleanup` only off a GLOBAL
// `afterEach`, and this repo's vitest config sets no `globals: true` — so for
// the whole life of the tree every `render` / `renderHook` stayed mounted
// past its test and past its file, with its effects' window listeners armed.
// Under a loaded runner an in-flight write's publish reached a still-mounted
// `useCitations` after jsdom had been torn down, React committed on a
// `window` that no longer existed, and the v0.1.106 deploy gate exited 1
// with all 11,663 tests PASSING (`bib-authority.test.tsx`, 7 unhandled
// errors). `vitest.setup.ts` now makes the registration explicitly, once,
// for every file. This suite is what keeps that from silently un-happening:
//
//   1. CENSUS — the config spells the setup file and the setup file spells
//      the registration off an IMPORTED `afterEach`, not a global nothing
//      defines. A config edit that drops the entry type-checks perfectly and
//      restores the leak for every suite at once.
//   2. BEHAVIOUR — a hook mounted in one test is UNMOUNTED before the next
//      test runs: its effect cleanup ran, its window listener is gone, and
//      Testing Library's container has left the body. Measured by neutering
//      the config entry: this leg fails.
//   3. The suite that lost the race waits by DRAINING the real write queue,
//      never by a wall-clock timer — a timer is a guess about scheduler load,
//      and the gate runner is the one place the guess is wrong.
//
// No pre-566 suite could see any of this: every one of them asserts what a
// mounted hook DOES, and a mount that is still alive afterwards is invisible
// to a test that has already passed — the leaked ticks fire after it.

import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { useEffect } from "react";
import fs from "node:fs";
import path from "node:path";
// Two readings, deliberately: a needle that IS a quoted path (an import
// specifier, a setup-file entry) wants `commentsStripped`, where `codeOnly`
// would blank the very literal it greps for — the trap `_source-scan`'s own
// header records; a symbol needle wants `codeOnly`.
import { codeOnly, commentsStripped } from "../lib/__tests__/_source-scan";

const REPO = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");

// ---------------------------------------------------------------------------
// 1. CENSUS
// ---------------------------------------------------------------------------

describe("census · the per-test cleanup is registered once, for every file", () => {
  it("vitest.config.ts spells the setup file and no `globals: true`", () => {
    const code = codeOnly(read("vitest.config.ts"));
    // The needle is quoted text, so the literal-KEPT reading.
    expect(commentsStripped(read("vitest.config.ts"))).toMatch(/setupFiles:\s*\[\s*"\.\/vitest\.setup\.ts"\s*\]/);
    // `globals: true` would make Testing Library's OWN registration fire
    // beside this one — harmless, but it is the shape that was relied on by
    // accident for a year, so it stays a deliberate absence.
    expect(code).not.toMatch(/\bglobals\s*:\s*true\b/);
  });

  it("vitest.setup.ts registers `cleanup` off an IMPORTED afterEach", () => {
    const code = commentsStripped(read("vitest.setup.ts"));
    expect(code).toMatch(/import\s*\{\s*afterEach\s*\}\s*from\s*["']vitest["']/);
    expect(code).toMatch(/\bafterEach\(/);
    expect(code).toMatch(/\bcleanup\(\)/);
    // The import is lazy (a node-env suite has no document; a jsdom suite
    // that mounted nothing has an empty body), so it is a dynamic import of
    // the package whose `pure` module tracks the mounted containers.
    expect(code).toMatch(/import\(\s*["']@testing-library\/react["']\s*\)/);
    expect(code).toMatch(/typeof document === ["']undefined["']/);
  });
});

// ---------------------------------------------------------------------------
// 2. BEHAVIOUR — a mount from test A is gone by test B.
//
// Vitest runs a file's tests in declaration order, so the second `it` reads
// what the setup file's afterEach did after the first.
// ---------------------------------------------------------------------------

const PROBE_EVENT = "virgil-test-mount-probe";
let unmounts = 0;
let seenAfterUnmount = 0;

function useProbe() {
  useEffect(() => {
    const handler = () => {
      seenAfterUnmount++;
    };
    window.addEventListener(PROBE_EVENT, handler);
    return () => {
      unmounts++;
      window.removeEventListener(PROBE_EVENT, handler);
    };
  }, []);
}

describe("behaviour · a hook mounted in one test is unmounted before the next", () => {
  it("test A mounts a hook with an armed window listener and does NOT unmount it", () => {
    renderHook(() => useProbe());
    expect(unmounts).toBe(0);
    expect(document.body.childNodes.length).toBeGreaterThan(0);
  });

  it("test B finds it unmounted: cleanup ran, the listener is gone, the body is empty", () => {
    expect(unmounts).toBe(1);
    window.dispatchEvent(new Event(PROBE_EVENT));
    expect(seenAfterUnmount).toBe(0);
    expect(document.body.childNodes.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. The suite that lost the race drains the queue.
// ---------------------------------------------------------------------------

describe("census · bib-authority waits on the queue, not the clock", () => {
  it("settles by draining `flushPrefix` and drains again after every test", () => {
    const code = commentsStripped(read("src/lib/__tests__/bib-authority.test.tsx"));
    expect(code).toMatch(/import\s*\{\s*flushPrefix\s*\}\s*from\s*["']@\/lib\/write-queue["']/);
    // The settle helper and the afterEach both enter the drain.
    expect((code.match(/\bflushPrefix\(DOC\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(code).toMatch(/\bafterEach\(/);
    // No wall-clock wait of 10 ms or more anywhere in the file: the only
    // timer left is the door's own `setTimeout(r, 0)` tick, which is what
    // makes it a serialized door rather than a synchronous one.
    expect(code).not.toMatch(/setTimeout\(\s*\w+\s*,\s*\d{2,}\s*\)/);
    expect(code).not.toMatch(/\bsettle\(\s*\d+\s*\)/);
  });
});
