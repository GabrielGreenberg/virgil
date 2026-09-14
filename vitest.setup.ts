/**
 * Repo-wide test setup — a TEST owns its mounts' lifetime (task 566).
 *
 * Testing Library auto-registers `afterEach(cleanup)` only when the runner
 * exposes `afterEach` as a GLOBAL. `vitest.config.ts` sets no `globals: true`,
 * so that registration never happened: every `render` / `renderHook` in the
 * tree stayed mounted past its test — and past its FILE — with its effects'
 * window listeners still armed. Under a loaded runner an in-flight write's
 * publish then reached a still-mounted hook after jsdom had been torn down,
 * React scheduled a commit on a `window` that no longer existed, and vitest
 * exited 1 with every test PASSING (the v0.1.106 deploy gate, surfaced by
 * `bib-authority.test.tsx`; task 548's class one layer out — a timer that
 * outlived its view, here a mount that outlived its test).
 *
 * Eighty-one suites spelled `afterEach(cleanup)` by hand and ~220 did not;
 * a per-file obligation is one the next suite forgets. So the registration
 * is made HERE, once, for every file, from the `afterEach` this module
 * imports rather than a global nothing defines.
 *
 * The import is lazy and GATED. A node-env suite has no `document`. A jsdom
 * suite that mounted nothing has an EMPTY body — Testing Library appends
 * every container it creates to `document.body` — and instantiating react-dom
 * there would cost every DOM suite that never renders a React tree a module
 * load it has no use for. A suite that appends its own DOM to the body pays
 * one import and a no-op `cleanup`; that direction is the cheap one.
 *
 * Testing Library's `index` re-exports `cleanup` from the same `pure` module
 * that tracks the mounted containers, so this call sees exactly the roots
 * the test file's own `renderHook` registered.
 *
 * Pinned by `src/__tests__/test-mount-lifetime.test.tsx`.
 */
import { afterEach } from "vitest";

afterEach(async () => {
  if (typeof document === "undefined") return;
  if (!document.body || document.body.childNodes.length === 0) return;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});
