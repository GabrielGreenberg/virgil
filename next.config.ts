import type { NextConfig } from "next";

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

const nextConfig: NextConfig = {
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

  // Point Turbopack's workspace root at the parent repo so node_modules
  // resolves there (worktrees don't have their own copy). CWD stays at
  // the worktree, so src/ is served from the worktree.
  turbopack: { root: require("path").resolve(__dirname, "../../..") },
};

export default nextConfig;
