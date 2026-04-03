import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Virgil",
    short_name: "Virgil",
    description: "WYSIWYG LaTeX editor",
    start_url: "/",
    display: "standalone",
    background_color: "#faf9f7",
    theme_color: "#7c5e3c",
    icons: [
      {
        src: "/icon-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
