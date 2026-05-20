import type { NextConfig } from "next";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

// Optional deploy-time URL prefix. Leave unset to serve from the
// origin root (e.g. localhost:3000 or virgil.example.com); set to
// e.g. "/tools/virgil" when copying the built site under a
// subdirectory of another website.
//
// Important: changing this after launch invalidates origin-scoped
// state (IndexedDB, FSA permission grants), so pick the final URL
// once and stick with it.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const devStorage = !!process.env.NEXT_PUBLIC_DEV_STORAGE;

// Worktrees don't carry their own node_modules — they read from the
// main repo two dirs up. Detect that case so we only widen Turbopack's
// root when we have to; otherwise root stays at the project dir and the
// watcher doesn't scan all of $HOME.
const isWorktree = !existsSync(join(__dirname, "node_modules"));

const nextConfig: NextConfig = {
  // Lets a second dev server (e.g. the Claude preview) run alongside the
  // user's own `npm run dev` by giving each its own build cache + lockfile.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),

  // Fully static export — no Node runtime, no API routes, no SSR.
  // The whole storage layer runs in the browser via the FSA spec.
  // Disabled in dev-storage mode so the /api/dev route works.
  ...(devStorage ? {} : { output: "export" as const }),

  // The dev API route uses .dev.ts so it's invisible during static
  // export builds. Only include it when dev-storage is active.
  ...(devStorage
    ? { pageExtensions: ["tsx", "ts", "jsx", "js", "dev.ts"] }
    : {}),

  // Required under static export — Next's built-in image optimizer
  // is a server feature.
  images: { unoptimized: true },

  // Honor the deploy-time prefix in URLs and asset paths.
  basePath,
  assetPrefix: basePath || undefined,

  devIndicators: false,

  // Only point Turbopack's workspace root at the parent repo when we're
  // actually in a worktree — otherwise this widens the watcher to $HOME
  // and every unrelated write triggers HMR.
  //
  // Known limitation (Next.js 16.2 / Turbopack): there is no public
  // watch-ignore knob — `turbopack.root` narrows resolution but the
  // file-system watcher still walks the entire root. With
  // `library-data/.virgil/models/` holding several GB of ML weights
  // and `library-data/.virgil/queue/` churning under active skill
  // runs, the dev watcher's startup walk and ongoing fsevents are a
  // measurable source of dev-server instability. The structural fix
  // is to keep `library-data/` outside the project tree (the
  // production default is `~/Virgil-Library/`) and repoint the dev
  // API route's `DATA_DIR` via an env var. Documented here so a
  // future session has the context — not changing the layout today
  // since the dev API route hardcodes
  // `path.join(process.cwd(), "library-data")`.
  ...(isWorktree ? { turbopack: { root: resolve(__dirname, "../../..") } } : {}),
};

export default nextConfig;
