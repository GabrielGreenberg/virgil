// Regenerate the PWA / apple-touch app icons from public/logo_new.png.
// Bakes a squircle-style rounded corner into the PNG itself (transparent
// outside the rounded rect) because macOS/PWA installs don't reliably
// apply the mask themselves — a square PNG shows as a square in the Dock.

import sharp from "sharp";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const BG = "#efecea";
// Apple HIG / web.dev maskable safe zone — content sits inside an
// 80%-diameter circle (≈20% padding). 15% was visibly too tight.
const PADDING_PCT = 0.20;
// Apple's continuous-curvature squircle is ≈22.37% of the edge.
// A plain rounded-rect at this radius reads as the same shape at
// typical Dock sizes.
const CORNER_RADIUS_PCT = 0.2237;

const SOURCE = join(repoRoot, "public/logo_new.png");

/** Produce the square icon art (cream canvas + logo via multiply).
 *  This is the "unmasked" form — iOS will apply its own squircle to it. */
async function composeSquare(size) {
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

  return sharp({
    create: { width: size, height: size, channels: 3, background: BG },
  })
    .composite([{ input: resizedLogo, left: pad, top: pad, blend: "multiply" }])
    .png()
    .toBuffer();
}

/** Bake a squircle-style rounded-rect alpha mask into the square art.
 *  Used for macOS Dock / manifest icons where the OS doesn't mask. */
async function applySquircle(squareBuf, size) {
  const radius = Math.round(size * CORNER_RADIUS_PCT);
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#000"/>
    </svg>`,
  );
  return sharp(squareBuf)
    .ensureAlpha()
    .composite([{ input: mask, blend: "dest-in" }])
    .png();
}

const targets = [
  // iOS masks the apple-touch-icon itself — ship as a full-bleed square.
  { file: "public/apple-touch-icon.png", size: 180, square: true },
  // Manifest icons land in the macOS Dock, which does NOT mask — bake
  // the squircle corners so the Dock renders the soft shape.
  { file: "public/icon-192x192.png", size: 192, square: false },
  { file: "public/icon-512x512.png", size: 512, square: false },
  // Archive copy of the rounded 1024 master.
  { file: "icons/app-icon-1024.png", size: 1024, square: false },
];

for (const t of targets) {
  const outPath = join(repoRoot, t.file);
  const square = await composeSquare(t.size);
  const img = t.square ? sharp(square).png() : await applySquircle(square, t.size);
  await img.toFile(outPath);
  console.log(`wrote ${t.file} (${t.size}x${t.size})${t.square ? " [square]" : " [squircle]"}`);
}
