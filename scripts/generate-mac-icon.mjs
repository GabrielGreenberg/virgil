// Generate a macOS .icns (plus the PWA / apple-touch set) from the
// parchment-V source at icons/updated_icon.png.
//
// The source art is a complete icon design — parchment-V with its
// own squircle-like outline and self-shadow. We ship it full-bleed
// at each target size and let macOS 26 (and iOS) apply the squircle
// clip and ambient drop shadow itself. Pre-Tahoe macOS will render
// the .icns as-is, relying on the parchment outline for the rounded
// shape.

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

/** Full-bleed resize. The source artwork's parchment edges already
 *  form a squircle-like outline; macOS 26 applies its own squircle
 *  clip and shadow. */
async function composeIcon(srcSquare, size) {
  return sharp(srcSquare)
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
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
