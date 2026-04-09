import type { MetadataRoute } from "next";

// Match next.config.ts. Manifest URLs (start_url, scope, icons) all
// have to be prefixed with the basePath, otherwise installing the PWA
// scopes the wrong directory.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// Required under `output: 'export'` — without this Next refuses to
// pre-render the manifest route at build time.
export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Virgil",
    short_name: "Virgil",
    description: "WYSIWYG LaTeX editor",
    start_url: `${basePath}/`,
    scope: `${basePath}/`,
    display: "standalone",
    background_color: "#faf9f7",
    theme_color: "#efecea",
    icons: [
      {
        src: `${basePath}/icon-192x192.png`,
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: `${basePath}/icon-512x512.png`,
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
