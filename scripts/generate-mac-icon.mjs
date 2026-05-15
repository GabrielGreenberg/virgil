// Generate a macOS .icns (plus the PWA / apple-touch set) from the
// parchment-V source at icons/updated_icon.png.
//
// The source art already carries its own squircle shape. We pad to
// square, inset slightly to leave room for a soft ambient drop shadow
// (standard macOS look), and composite: shadow → artwork on a
// transparent canvas.

import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const SOURCE = join(repoRoot, "icons/updated_icon.png");
const ICONSET_DIR = join(repoRoot, "icons/Virgil.iconset");
const ICNS_OUT = join(repoRoot, "icons/Virgil.icns");
const MASTER_1024 = join(repoRoot, "icons/app-icon-1024.png");

// Inset the squircle inside the canvas so the shadow has breathing
// room. Kept modest (~6%) so the icon still looks big at small sizes.
const INSET_PCT = 0.06;
// Subtle ambient shadow.
const SHADOW_BLUR_PCT = 0.014;  // stdDeviation, ~14px at 1024
const SHADOW_DY_PCT = 0.006;    // vertical offset, ~6px at 1024
const SHADOW_OPACITY = 0.30;

/** Pad source to a perfect square on a transparent canvas. */
async function loadSquareSource() {
  const meta = await sharp(SOURCE).metadata();
  const side = Math.max(meta.width, meta.height);
  const padX = Math.round((side - meta.width) / 2);
  const padY = Math.round((side - meta.height) / 2);
  return sharp(SOURCE)
    .extend({
      top: padY,
      bottom: side - meta.height - padY,
      left: padX,
      right: side - meta.width - padX,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

/** Build a soft black silhouette of `artwork` (RGBA buffer, square). */
async function makeShadow(artwork, artSize, blurPx) {
  // Solid black square of the artwork's size, then mask it by the
  // artwork's alpha using dest-in. The input to dest-in must be a
  // full RGBA image (not a single-channel alpha), otherwise the
  // blend degenerates into a filled square.
  const blackBox = await sharp({
    create: {
      width: artSize,
      height: artSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const silhouette = await sharp(blackBox)
    .composite([{ input: artwork, blend: "dest-in" }])
    .png()
    .toBuffer();

  // Blur, then dim the alpha to SHADOW_OPACITY.
  return sharp(silhouette)
    .blur(blurPx)
    .ensureAlpha()
    .linear([1, 1, 1, SHADOW_OPACITY], [0, 0, 0, 0])
    .png()
    .toBuffer();
}

/** Resize art → inset canvas, add soft drop shadow, emit PNG. */
async function composeIcon(srcSquare, size) {
  const inset = Math.round(size * INSET_PCT);
  const artSize = size - 2 * inset;
  const blurPx = Math.max(1, size * SHADOW_BLUR_PCT);
  const dy = Math.max(1, Math.round(size * SHADOW_DY_PCT));

  const artwork = await sharp(srcSquare)
    .resize(artSize, artSize, { fit: "contain" })
    .png()
    .toBuffer();

  const shadow = await makeShadow(artwork, artSize, blurPx);

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: shadow, left: inset, top: inset + dy },
      { input: artwork, left: inset, top: inset },
    ])
    .png();
}

// macOS .iconset required sizes.
const ICONSET_SIZES = [
  { name: "icon_16x16.png", size: 16 },
  { name: "icon_16x16@2x.png", size: 32 },
  { name: "icon_32x32.png", size: 32 },
  { name: "icon_32x32@2x.png", size: 64 },
  { name: "icon_128x128.png", size: 128 },
  { name: "icon_128x128@2x.png", size: 256 },
  { name: "icon_256x256.png", size: 256 },
  { name: "icon_256x256@2x.png", size: 512 },
  { name: "icon_512x512.png", size: 512 },
  { name: "icon_512x512@2x.png", size: 1024 },
];

async function main() {
  const srcSquare = await loadSquareSource();

  rmSync(ICONSET_DIR, { recursive: true, force: true });
  mkdirSync(ICONSET_DIR, { recursive: true });

  for (const { name, size } of ICONSET_SIZES) {
    await (await composeIcon(srcSquare, size)).toFile(join(ICONSET_DIR, name));
    console.log(`wrote iconset/${name} (${size}x${size})`);
  }

  await (await composeIcon(srcSquare, 1024)).toFile(MASTER_1024);
  console.log(`wrote icons/app-icon-1024.png (1024x1024)`);

  const pwa = [
    { file: "public/apple-touch-icon.png", size: 180 },
    { file: "public/icon-192x192.png", size: 192 },
    { file: "public/icon-512x512.png", size: 512 },
  ];
  for (const { file, size } of pwa) {
    await (await composeIcon(srcSquare, size)).toFile(join(repoRoot, file));
    console.log(`wrote ${file} (${size}x${size})`);
  }

  execFileSync("iconutil", ["--convert", "icns", "--output", ICNS_OUT, ICONSET_DIR], {
    stdio: "inherit",
  });
  console.log(`wrote icons/Virgil.icns`);
}

await main();
