/**
 * One-off: rasterize public SVGs to PNG for Telegram / launchpads.
 * Run: cd frontend && node scripts/svg-to-png.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pub = join(__dirname, '..', 'public');

const DARK = { r: 15, g: 23, b: 42, alpha: 1 }; // slate-900
const SIZE = 512;

async function rasterize(name, svgFile, outFile, bg = DARK) {
  const buf = readFileSync(join(pub, svgFile));
  await sharp(buf, { density: 300 })
    .resize(SIZE, SIZE, { fit: 'contain', background: bg })
    .png()
    .toFile(join(pub, outFile));
  console.log('wrote', outFile);
}

await rasterize('icon', 'ceitnot.svg', 'ceitnot-pfp-512.png');
await rasterize('wordmark-dark', 'ceitnot-wordmark.svg', 'ceitnot-wordmark-512.png');
await rasterize('wordmark-light', 'ceitnot-wordmark-light.svg', 'ceitnot-wordmark-light-512.png', {
  r: 248,
  g: 250,
  b: 252,
  alpha: 1,
});
