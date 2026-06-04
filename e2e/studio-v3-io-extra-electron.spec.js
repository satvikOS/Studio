import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-io-extra');

test('Studio V3 — IO extra: ply/glb/svg/image/snapshot/sceneJson (slice 639)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 250,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  // 1: PLY ASCII export
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  const ply = await win.evaluate(() => window.__studioExportPlyAscii());
  expect(ply.ok).toBe(true);
  expect(ply.text.startsWith('ply')).toBe(true);
  expect(ply.faces).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '01-ply.png') });

  // 2: GLB binary export
  const glb = await win.evaluate(() => window.__studioExportGlbBinary());
  expect(glb.ok).toBe(true);
  expect(glb.bytes).toBeGreaterThan(100);
  await win.screenshot({ path: path.join(OUT, '02-glb.png') });

  // 3: SVG import
  const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#ff8866"/></svg>`;
  const svgR = await win.evaluate((s) => window.__studioImportSvgPaths(s, 0.1), svg);
  expect(svgR.ok).toBe(true);
  expect(svgR.paths).toBeGreaterThanOrEqual(1);
  await win.screenshot({ path: path.join(OUT, '03-svg.png') });

  // 4: Image plane
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGElEQVQI12P4//8/AyMjI8N/BgYGBgYGAB0BAgD7XwsTAAAAAElFTkSuQmCC';
  const imgR = await win.evaluate((u) => window.__studioImportImagePlane(u, 1.5), tinyPng);
  expect(imgR.ok).toBe(true);
  expect(imgR.width).toBe(1.5);
  await win.screenshot({ path: path.join(OUT, '04-image.png') });

  // 5: PNG snapshot at custom resolution
  const snap = await win.evaluate(() => window.__studioExportSnapshotPng(640, 360));
  expect(snap.ok).toBe(true);
  expect(snap.dataUrl.startsWith('data:image/png')).toBe(true);
  expect(snap.width).toBe(640);
  await win.screenshot({ path: path.join(OUT, '05-snapshot.png') });

  // 6: Scene JSON
  const j = await win.evaluate(() => window.__studioExportSceneJson());
  expect(j.ok).toBe(true);
  expect(j.bytes).toBeGreaterThan(100);
  await win.screenshot({ path: path.join(OUT, '06-sceneJson.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 639: 6 IO features — PLY', ply.text.length, 'b, GLB', glb.bytes, 'b, sceneJson', j.bytes, 'b');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
