// Generate a macOS .icns (plus the PWA / apple-touch set) from the
// parchment-V source at icons/new_new_icon.png.
//
// The source art is already a squircle-shaped illustration with a
// transparent canvas around it — so unlike generate-app-icons.mjs we
// don't composite onto a ceramic background. We just pad to square,
// inset inside a transparent canvas (Apple reserves ~10% breathing
// room around the squircle for shadow/glow), add a soft ambient
// shadow, and render out every size the iconset needs.

import sharp from "sharp";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const SOURCE = join(repoRoot, "icons/new_new_icon.png");
const ICONSET_DIR = join(repoRoot, "icons/Virgil.iconset");
const ICNS_OUT = join(repoRoot, "icons/Virgil.icns");
const MASTER_1024 = join(repoRoot, "icons/app-icon-1024.png");

// Apple reserves ~10% transparent padding around the squircle on the
// 1024 canvas. The shadow lives in that margin.
const SQUIRCLE_INSET_PCT = 0.10;

// Soft ambient shadow below the squircle. Kept subtle so it doesn't
// fight the watercolor's own painterly edges.
const SHADOW_BLUR_PCT = 0.018;   // stdDeviation, at 1024 → ~18px
const SHADOW_DY_PCT = 0.009;     // vertical offset, at 1024 → ~9px
const SHADOW_OPACITY = 0.28;

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

/** Compose the squircle artwork onto a transparent canvas of `size`
 *  with the Apple-style inset and a soft ambient drop shadow. */
async function composeIcon(srcSquare, size) {
  const inset = Math.round(size * SQUIRCLE_INSET_PCT);
  const squircleSize = size - 2 * inset;
  const shadowBlur = Math.max(1, Math.round(size * SHADOW_BLUR_PCT));
  const shadowDy = Math.max(1, Math.round(size * SHADOW_DY_PCT));

  // Resize art to squircle size.
  const artwork = await sharp(srcSquare)
    .resize(squircleSize, squircleSize, { fit: "contain" })
    .toBuffer();

  // Build the shadow by blurring the alpha channel of the artwork,
  // then recolouring it to semi-transparent black, then offsetting.
  const alphaOnly = await sharp(artwork)
    .extractChannel("alpha")
    .toBuffer();

  // Turn the alpha mask into a black-on-transparent image, blur it,
  // and dim it.
  const shadowLayer = await sharp({
    create: {
      width: squircleSize,
      height: squircleSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: await sharp({
          create: {
            width: squircleSize,
            height: squircleSize,
            channels: 3,
            background: { r: 0, g: 0, b: 0 },
          },
        })
          .png()
          .toBuffer(),
        blend: "over",
      },
      { input: alphaOnly, blend: "dest-in" },
    ])
    .blur(shadowBlur)
    .png()
    .toBuffer();

  // Dim the shadow via linear (multiply alpha by SHADOW_OPACITY).
  const shadowDimmed = await sharp(shadowLayer)
    .ensureAlpha()
    .linear([1, 1, 1, SHADOW_OPACITY], [0, 0, 0, 0])
    .toBuffer();

  // Composite: transparent canvas → shadow (offset down) → artwork.
  const canvas = sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });

  return canvas
    .composite([
      { input: shadowDimmed, left: inset, top: inset + shadowDy },
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
    const outPath = join(ICONSET_DIR, name);
    await (await composeIcon(srcSquare, size)).toFile(outPath);
    console.log(`wrote iconset/${name} (${size}x${size})`);
  }

  // Master PNG, re-used as the canonical 1024 archive.
  await (await composeIcon(srcSquare, 1024)).toFile(MASTER_1024);
  console.log(`wrote ${MASTER_1024.replace(repoRoot + "/", "")} (1024x1024)`);

  // PWA icons. These are baked transparent PNGs — no ceramic
  // background, since the parchment art already carries its own look.
  const pwa = [
    { file: "public/apple-touch-icon.png", size: 180 },
    { file: "public/icon-192x192.png", size: 192 },
    { file: "public/icon-512x512.png", size: 512 },
  ];
  for (const { file, size } of pwa) {
    const outPath = join(repoRoot, file);
    await (await composeIcon(srcSquare, size)).toFile(outPath);
    console.log(`wrote ${file} (${size}x${size})`);
  }

  execFileSync("iconutil", ["--convert", "icns", "--output", ICNS_OUT, ICONSET_DIR], {
    stdio: "inherit",
  });
  console.log(`wrote ${ICNS_OUT.replace(repoRoot + "/", "")}`);
}

await main();
