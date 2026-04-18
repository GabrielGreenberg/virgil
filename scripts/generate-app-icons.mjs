// Regenerate the PWA / apple-touch app icons from public/logo_new.png.
// For manifest icons (macOS Dock / Chromium install), the PNG has the
// squircle baked in, inset inside a transparent canvas so the visible
// shape matches the size of native macOS icons (Apple's own icon
// template insets the squircle ~10% from the 1024 canvas edge).
// Adds a subtle vertical gradient on the background and an ambient
// drop shadow below the squircle, matching the typical macOS look.

import sharp from "sharp";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

// Fractions of the full canvas edge:
const SQUIRCLE_INSET_PCT = 0.10;  // transparent padding around squircle
const LOGO_PADDING_PCT = 0.22;    // logo inset from canvas edge (inside squircle)
// Corner radius as fraction of canvas edge. Apple's continuous-curve
// squircle is ~22.37% of the squircle edge; at 80% squircle size that
// is ~17.9% of canvas edge.
const CORNER_RADIUS_PCT = 0.1790;

// Subtle vertical gradient — lighter at top, slightly darker at
// bottom, matching the typical macOS "ceramic" background look.
const BG_TOP = "#f4f1ee";
const BG_BOTTOM = "#e4e0db";

const SOURCE = join(repoRoot, "public/logo_new.png");

// Logo source as data URI for embedding in the composition SVG.
const LOGO_DATA_URI =
  "data:image/png;base64," +
  readFileSync(SOURCE).toString("base64");

/** Full-bleed square for the apple-touch-icon. iOS applies its own
 *  squircle mask on Add-to-Home-Screen, so no corner rounding, no
 *  shadow (would be clipped anyway). Keeps the gradient since that
 *  shows through the iOS mask. */
async function composeAppleTouch(size) {
  const pad = Math.round(size * LOGO_PADDING_PCT);
  const logoSize = size - 2 * pad;

  const bgSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${BG_TOP}"/>
          <stop offset="1" stop-color="${BG_BOTTOM}"/>
        </linearGradient>
      </defs>
      <rect width="${size}" height="${size}" fill="url(#bg)"/>
    </svg>`,
  );

  const resizedLogo = await sharp(SOURCE)
    .resize(logoSize, logoSize, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255 },
    })
    .toBuffer();

  return sharp(bgSvg)
    .composite([{ input: resizedLogo, left: pad, top: pad, blend: "multiply" }])
    .png();
}

/** Manifest / macOS Dock icon: the squircle is inset inside a
 *  transparent canvas (matching the size of native macOS icons) and
 *  carries an ambient drop shadow + vertical gradient. */
async function composeDockIcon(size) {
  const inset = Math.round(size * SQUIRCLE_INSET_PCT);
  const squircleSize = size - 2 * inset;
  const cornerRadius = Math.round(size * CORNER_RADIUS_PCT);
  const logoPad = Math.round(size * LOGO_PADDING_PCT);
  const logoSize = size - 2 * logoPad;
  // Shadow params scale with the icon size so 192 and 512 look
  // consistent once each is rendered at its own display pixel density.
  const shadowBlur = Math.round(size * 0.022);  // ~11px at 512
  const shadowDy = Math.round(size * 0.008);    // ~4px at 512

  // SVG draws: shadow → gradient squircle (as one layer via feDropShadow).
  // feDropShadow's flood-opacity controls the shadow darkness.
  const bgSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${BG_TOP}"/>
          <stop offset="1" stop-color="${BG_BOTTOM}"/>
        </linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="${shadowDy}" stdDeviation="${shadowBlur}"
            flood-color="#000" flood-opacity="0.22"/>
        </filter>
      </defs>
      <rect x="${inset}" y="${inset}" width="${squircleSize}" height="${squircleSize}"
        rx="${cornerRadius}" ry="${cornerRadius}"
        fill="url(#bg)" filter="url(#shadow)"/>
    </svg>`,
  );

  // Render the gradient+shadow background first.
  const bgPng = await sharp(bgSvg).png().toBuffer();

  // Resize logo onto a WHITE letterbox so multiply collapses the white
  // pixels into the gradient underneath (preserving the gradient where
  // the logo is blank, and darkening where the ring draws).
  const resizedLogo = await sharp(SOURCE)
    .resize(logoSize, logoSize, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255 },
    })
    .toBuffer();

  // Composite logo with multiply. Multiply against transparent pixels
  // (outside the squircle) keeps them transparent, so no extra masking
  // is needed.
  return sharp(bgPng)
    .composite([{ input: resizedLogo, left: logoPad, top: logoPad, blend: "multiply" }])
    .png();
}

const targets = [
  // iOS masks the apple-touch-icon itself — ship as a full-bleed square.
  { file: "public/apple-touch-icon.png", size: 180, kind: "apple" },
  // Manifest icons land in the macOS Dock, which does NOT mask — bake
  // the squircle, shadow, and gradient into the PNG itself.
  { file: "public/icon-192x192.png", size: 192, kind: "dock" },
  { file: "public/icon-512x512.png", size: 512, kind: "dock" },
  // Archive copy of the rendered 1024 master.
  { file: "icons/app-icon-1024.png", size: 1024, kind: "dock" },
];

for (const t of targets) {
  const outPath = join(repoRoot, t.file);
  const img =
    t.kind === "apple" ? await composeAppleTouch(t.size) : await composeDockIcon(t.size);
  await img.toFile(outPath);
  console.log(`wrote ${t.file} (${t.size}x${t.size}) [${t.kind}]`);
}
