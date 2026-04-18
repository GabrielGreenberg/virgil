// Regenerate the PWA / apple-touch app icons from public/logo_new.png.
// Source is the ring logo on transparent background — we composite it
// centered on a solid warm-cream canvas at ~15% padding so the OS's
// squircle mask gives the soft iOS look on install.

import sharp from "sharp";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const BG = "#efecea";
const PADDING_PCT = 0.15;

const SOURCE = join(repoRoot, "public/logo_new.png");

async function composeIcon(size) {
  const pad = Math.round(size * PADDING_PCT);
  const contentSize = size - 2 * pad;

  // Source has a white background baked in. Resize onto WHITE letterbox
  // so `multiply`-blending preserves the ring's gradient while white
  // pixels collapse to the canvas cream (no visible framed rectangle).
  const resizedLogo = await sharp(SOURCE)
    .resize(contentSize, contentSize, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255 },
    })
    .toBuffer();

  const logoOnCream = await sharp({
    create: { width: size, height: size, channels: 3, background: BG },
  })
    .composite([{ input: resizedLogo, left: pad, top: pad, blend: "multiply" }])
    .png()
    .toBuffer();

  return sharp(logoOnCream).png();
}

const targets = [
  { file: "public/icon-512x512.png", size: 512 },
  { file: "public/icon-192x192.png", size: 192 },
  { file: "public/apple-touch-icon.png", size: 180 },
  { file: "icons/app-icon-1024.png", size: 1024 },
];

for (const t of targets) {
  const outPath = join(repoRoot, t.file);
  await (await composeIcon(t.size)).toFile(outPath);
  console.log(`wrote ${t.file} (${t.size}x${t.size})`);
}
