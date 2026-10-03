// @vitest-environment jsdom
/**
 * The chime's header promises "never an exception on the timer path". A
 * suspended context's `resume()` REJECTS rather than throws, so a synchronous
 * try/catch never saw it — it escaped as an unhandled rejection (task 905).
 *
 * Asserted as the contract itself — a rejection handler is ATTACHED to what
 * `resume()` returns — because the runner's own unhandled-rejection plumbing
 * makes "no unhandledRejection event fired" a vacuous pass (verified: it
 * passed against the unfixed `void ctx.resume()`).
 */

import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
  vi.resetModules();
});

describe("armPomodoroAudio", () => {
  it("handles a resume() rejection instead of leaving it unhandled", async () => {
    const rejected = Promise.reject(new Error("blocked"));
    rejected.catch(() => {}); // the test's own copy must not leak either
    let onRejected: unknown = null;
    const thenable = {
      then: vi.fn((res: (v: unknown) => void, rej: (e: unknown) => void) => {
        onRejected = rej;
        return rejected.then(res, rej);
      }),
    };
    const resume = vi.fn(() => thenable);
    (window as unknown as { AudioContext: unknown }).AudioContext = class {
      state = "suspended";
      resume = resume;
    };
    const { armPomodoroAudio } = await import("@/lib/pomodoro-chime");
    expect(() => armPomodoroAudio()).not.toThrow();
    expect(resume).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(thenable.then).toHaveBeenCalled();
    expect(typeof onRejected).toBe("function");
  });
});
