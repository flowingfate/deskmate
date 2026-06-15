/**
 * One-shot: generate Deskmate brand icons from light.svg/dark.svg.
 *
 * The source SVGs are Figma exports that use <foreignObject> + CSS
 * conic-gradient, which resvg/sharp cannot render (the gradient ring
 * silently disappears). We render via Chromium (playwright-core) instead.
 *
 * Run with: bun scripts/generate-deskmate-icons.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';
// @ts-ignore
import pngToIco from 'png-to-ico';

const ROOT = path.resolve(__dirname, '..');
const BRAND_DIR = path.join(ROOT, 'brands/deskmate/assets');
const MAC_DIR = path.join(BRAND_DIR, 'mac');
const WIN_DIR = path.join(BRAND_DIR, 'win');
const SVG_DARK = path.join(BRAND_DIR, 'app-dark.svg'); // dark.svg (for light theme)

// App is light-mode only → use dark.svg.
const MASTER_SVG = SVG_DARK;

const MAC_SIZES = [16, 32, 128, 256, 512, 1024];
const WIN_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

let browserPromise: ReturnType<typeof chromium.launch> | null = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch();
  }
  return browserPromise;
}

/**
 * Render the master SVG at the requested size using Chromium and return PNG bytes.
 * Chromium fully supports foreignObject + CSS conic-gradient, unlike resvg/sharp.
 */
async function renderSvg(size: number): Promise<Buffer> {
  const svg = fs.readFileSync(MASTER_SVG, 'utf8');
  const html = `<!doctype html>
<html><head><style>
  html, body { margin: 0; padding: 0; background: transparent; }
  body { width: ${size}px; height: ${size}px; }
  svg { width: ${size}px; height: ${size}px; display: block; }
</style></head><body>${svg}</body></html>`;

  const browser = await getBrowser();
  const ctx = await browser.newContext({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  // Give Chromium a tick to paint the foreignObject layer.
  await page.waitForTimeout(50);
  const buf = await page.screenshot({
    type: 'png',
    omitBackground: true,
    clip: { x: 0, y: 0, width: size, height: size },
  });
  await ctx.close();
  return buf;
}

async function writePng(size: number, outPath: string) {
  const buf = await renderSvg(size);
  fs.writeFileSync(outPath, buf);
}

async function genMacPngs() {
  console.log('🍎 mac PNGs');
  for (const s of MAC_SIZES) {
    const out = path.join(MAC_DIR, `icon_${s}x${s}.png`);
    await writePng(s, out);
    console.log('  ', path.basename(out));
  }
}

async function genWinPngs() {
  console.log('🪟 win PNGs');
  for (const s of WIN_SIZES) {
    const out = path.join(WIN_DIR, `icon_round_${s}x${s}.png`);
    await writePng(s, out);
    console.log('  ', path.basename(out));
  }
}

async function genMacIcns() {
  console.log('🍎 .icns via iconutil');
  const iconsetDir = path.join(MAC_DIR, 'app.iconset');
  fs.mkdirSync(iconsetDir, { recursive: true });
  const map: Array<[number, string]> = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png'],
  ];
  // Reuse already-generated PNGs when sizes match to save renders.
  for (const [size, name] of map) {
    const src = path.join(MAC_DIR, `icon_${size}x${size}.png`);
    const dst = path.join(iconsetDir, name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
    } else {
      await writePng(size, dst);
    }
  }
  const icnsPath = path.join(MAC_DIR, 'app.icns');
  execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`, { stdio: 'inherit' });
  console.log('  ', icnsPath);
}

async function genWinIco() {
  console.log('🪟 .ico via png-to-ico');
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const buffers: Buffer[] = [];
  for (const s of sizes) {
    const cached = path.join(WIN_DIR, `icon_round_${s}x${s}.png`);
    if (fs.existsSync(cached)) {
      buffers.push(fs.readFileSync(cached));
    } else {
      buffers.push(await renderSvg(s));
    }
  }
  const ico = await pngToIco(buffers);
  const icoPath = path.join(WIN_DIR, 'app.ico');
  fs.writeFileSync(icoPath, ico);
  console.log('  ', icoPath);
}

async function main() {
  try {
    await genMacPngs();
    await genWinPngs();
    await genMacIcns();
    await genWinIco();
    console.log('✅ Done');
  } finally {
    if (browserPromise) {
      const b = await browserPromise;
      await b.close();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
