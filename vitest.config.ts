import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@library": path.resolve(__dirname, "./library"),
    },
  },
  test: {
    // Per-file envs via the // @vitest-environment jsdom comment.
    // Default is node so pure-logic tests are fast.
    environment: "node",
    // No `globals: true` — and that is why the setup file exists: Testing
    // Library registers its per-test `cleanup` only off a GLOBAL `afterEach`,
    // so without this entry every render stays mounted past its test (task
    // 566: a mount that outlives jsdom teardown exits vitest 1 with every
    // test passing). The file registers it explicitly for every suite.
    setupFiles: ["./vitest.setup.ts"],
    // No suite may leave Python bytecode in the tree it is scanning. A suite
    // that spawns a `library/`/`editor/` script used to write
    // `__pycache__/*.pyc` (atomically: a `.pyc.<pid>` temp, then a rename) in
    // the very directories the source-walking censuses list — and a census
    // that stat'd the temp between listing and asking died ENOENT in the
    // deploy gate (task 954). Workers export this to every child they spawn.
    env: { PYTHONDONTWRITEBYTECODE: "1" },
    include: [
      "src/**/__tests__/**/*.test.{ts,tsx}",
      "library/**/__tests__/**/*.test.{ts,tsx}",
      "editor/**/__tests__/**/*.test.{ts,tsx}",
      // The FRONT DOOR silo (`virgil/skills/`) had no test root at all — which
      // is the structural reason nothing guarded it (task 473 M3). Same
      // remedy `scripts/` got in task 374.
      "virgil/**/__tests__/**/*.test.{ts,tsx}",
      // Repo-global build scripts (`scripts/`) had no test root; the
      // local-mirror sync earns one (task 374).
      "scripts/**/__tests__/**/*.test.{ts,tsx}",
    ],
  },
});
