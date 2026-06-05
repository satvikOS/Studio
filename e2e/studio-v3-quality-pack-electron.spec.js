import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-quality-pack');

test('Studio V3 — quality: preset/current/list/custom/reset/export (slice 680)', async () => {
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
    window.localStorage.removeItem('studio.v3.quality');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  // 1: preset low
  const lo = await win.evaluate(() => window.__studioQualityPreset('low'));
  expect(lo.ok).toBe(true);
  expect(lo.preset).toBe('low');
  expect(lo.pixelRatio).toBe(0.5);
  expect(lo.fpsCap).toBe(30);
  await win.screenshot({ path: path.join(OUT, '01-low.png') });

  // 2: get current
  const g = await win.evaluate(() => window.__studioQualityGetCurrent());
  expect(g.preset).toBe('low');
  await win.screenshot({ path: path.join(OUT, '02-cur.png') });

  // 3: list presets
  const l = await win.evaluate(() => window.__studioQualityListPresets());
  expect(l.presets.length).toBe(4);
  expect(l.presets.map((p) => p.name)).toEqual(['low', 'medium', 'high', 'ultra']);
  await win.screenshot({ path: path.join(OUT, '03-list.png') });

  // 4: set custom
  const c = await win.evaluate(() => window.__studioQualitySetCustom({ pixelRatio: 1.2, shadows: 'high', fpsCap: 45, postFx: false }));
  expect(c.ok).toBe(true);
  const g2 = await win.evaluate(() => window.__studioQualityGetCurrent());
  expect(g2.preset).toBe('custom');
  await win.screenshot({ path: path.join(OUT, '04-custom.png') });

  // 5: reset default
  const r = await win.evaluate(() => window.__studioQualityResetDefault());
  expect(r.ok).toBe(true);
  expect(r.preset).toBe('high');
  await win.screenshot({ path: path.join(OUT, '05-reset.png') });

  // 6: export
  const e = await win.evaluate(() => window.__studioQualityExportPreset());
  expect(e.ok).toBe(true);
  const parsed = JSON.parse(e.json);
  expect(parsed.preset).toBe('high');
  await win.screenshot({ path: path.join(OUT, '06-export.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 680: 6 quality features verified — final preset', parsed.preset);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
