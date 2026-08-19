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
    include: [
      "src/**/__tests__/**/*.test.{ts,tsx}",
      "library/**/__tests__/**/*.test.{ts,tsx}",
      "editor/**/__tests__/**/*.test.{ts,tsx}",
      // Repo-global build scripts (`scripts/`) had no test root; the
      // local-mirror sync earns one (task 374).
      "scripts/**/__tests__/**/*.test.{ts,tsx}",
    ],
  },
});
