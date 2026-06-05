import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-palette');

test('Studio V3 — palette: add/list/apply/delete/import/export (slice 672)', async () => {
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
    window.localStorage.removeItem('studio.v3.palette');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // 1: add
  const a = await win.evaluate(() => window.__studioPaletteAdd('coral', 0xff7766));
  expect(a.ok).toBe(true);
  expect(a.hex).toBe('#ff7766');
  expect(a.total).toBe(1);
  await win.screenshot({ path: path.join(OUT, '01-add.png') });

  // 2: list
  const l = await win.evaluate(() => window.__studioPaletteList());
  expect(l.count).toBe(1);
  expect(l.entries[0]).toEqual({ name: 'coral', hex: '#ff7766' });
  await win.screenshot({ path: path.join(OUT, '02-list.png') });

  // 3: apply
  const ap = await win.evaluate(() => window.__studioPaletteApplyToSelection('coral'));
  expect(ap.ok).toBe(true);
  const matHex = await win.evaluate(() => {
    const m = Array.isArray(window.__studioSelectedMesh().material) ? window.__studioSelectedMesh().material[0] : window.__studioSelectedMesh().material;
    return '#' + m.color.getHexString();
  });
  expect(matHex).toBe('#ff7766');
  await win.screenshot({ path: path.join(OUT, '03-apply.png') });

  // 4: import from image — tiny 2x2 PNG
  const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAGElEQVQI12P4//8/AyMjI8N/BgYGBgYGAB0BAgD7XwsTAAAAAElFTkSuQmCC';
  const im = await win.evaluate((u) => window.__studioPaletteImportFromImage(u, 4), tinyPng);
  expect(im.ok).toBe(true);
  expect(im.added.length).toBe(4);
  await win.screenshot({ path: path.join(OUT, '04-import.png') });

  // 5: export
  const e = await win.evaluate(() => window.__studioPaletteExport());
  expect(e.ok).toBe(true);
  expect(e.count).toBeGreaterThan(0);
  expect(e.json.length).toBeGreaterThan(2);
  await win.screenshot({ path: path.join(OUT, '05-export.png') });

  // 6: delete
  const d = await win.evaluate(() => window.__studioPaletteDelete('coral'));
  expect(d.removed).toBe(true);
  await win.screenshot({ path: path.join(OUT, '06-delete.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 672: 6 palette features verified — added', im.added.length, 'auto swatches');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
