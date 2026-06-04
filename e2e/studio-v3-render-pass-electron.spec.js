import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-render-pass');

test('Studio V3 — render passes: depth/normal/matcap/toon/clay/xray (slice 656)', async () => {
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

  // Add a couple of meshes so the renders aren't empty.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  const checkPng = (r) => {
    expect(r.ok).toBe(true);
    expect(typeof r.dataUrl).toBe('string');
    expect(r.dataUrl.startsWith('data:image/png')).toBe(true);
    expect(r.dataUrl.length).toBeGreaterThan(2000); // not a 1×1 blank
  };

  const d = await win.evaluate(() => window.__studioRenderDepthImage());
  checkPng(d);
  await win.screenshot({ path: path.join(OUT, '01-depth.png') });

  const n = await win.evaluate(() => window.__studioRenderNormalImage());
  checkPng(n);
  await win.screenshot({ path: path.join(OUT, '02-normal.png') });

  // tiny 2x2 PNG as matcap
  const tinyMatcap = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGElEQVQI12P4//8/AyMjI8N/BgYGBgYGAB0BAgD7XwsTAAAAAElFTkSuQmCC';
  const mc = await win.evaluate((u) => window.__studioRenderMatcapImage(u), tinyMatcap);
  checkPng(mc);
  await win.screenshot({ path: path.join(OUT, '03-matcap.png') });

  const t = await win.evaluate(() => window.__studioRenderToonImage(0xc4c4d8));
  checkPng(t);
  await win.screenshot({ path: path.join(OUT, '04-toon.png') });

  const c = await win.evaluate(() => window.__studioRenderClayImage());
  checkPng(c);
  await win.screenshot({ path: path.join(OUT, '05-clay.png') });

  const x = await win.evaluate(() => window.__studioRenderXrayImage());
  checkPng(x);
  await win.screenshot({ path: path.join(OUT, '06-xray.png') });

  // Materials are restored after each pass — current selection material should be intact.
  const stillHasMat = await win.evaluate(() => {
    const sel = window.__studioSelectedMesh();
    const m = Array.isArray(sel.material) ? sel.material[0] : sel.material;
    return !!m && !m.isMeshDepthMaterial && !m.isMeshNormalMaterial;
  });
  expect(stillHasMat).toBe(true);

  // eslint-disable-next-line no-console
  console.log('  slice 656: 6 render-pass features verified, materials restored');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
