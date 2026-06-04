import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-lights-pack');

test('Studio V3 — lights pack: point/spot/hemi/rect + shadows + list (slice 627)', async () => {
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

  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // baseline
  const base = await win.evaluate(() => window.__studioListLights());

  // 1: point ─────────────────────────────────────────────────────────
  const p = await win.evaluate(() => window.__studioAddPointLight([2, 3, 1], 0xff8844, 2));
  expect(p.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '01-point.png') });

  // 2: spot ──────────────────────────────────────────────────────────
  const s = await win.evaluate(() => window.__studioAddSpotLight([0, 4, 0], [0, 0, 0], 0xffffff, 3));
  expect(s.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '02-spot.png') });

  // 3: hemi ──────────────────────────────────────────────────────────
  const h = await win.evaluate(() => window.__studioAddHemiLight(0xa0c4ff, 0x442200, 0.5));
  expect(h.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '03-hemi.png') });

  // 4: rect ──────────────────────────────────────────────────────────
  const r = await win.evaluate(() => window.__studioAddRectLight([2, 3, 0], 1.5, 0.8, 0xffffff, 4));
  expect(r.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '04-rect.png') });

  // 5: list ──────────────────────────────────────────────────────────
  const after = await win.evaluate(() => window.__studioListLights());
  expect(after.point).toBeGreaterThanOrEqual(base.point + 1);
  expect(after.spot).toBeGreaterThanOrEqual(base.spot + 1);
  expect(after.hemi).toBeGreaterThanOrEqual(base.hemi + 1);
  expect(after.rect).toBeGreaterThanOrEqual(base.rect + 1);
  await win.screenshot({ path: path.join(OUT, '05-list.png') });

  // 6: shadows toggle ────────────────────────────────────────────────
  const wasShadow = await win.evaluate(() => window.__archdiscViewport.renderer.shadowMap.enabled);
  const sh = await win.evaluate(() => window.__studioToggleShadows());
  expect(sh.ok).toBe(true);
  expect(sh.shadows).toBe(!wasShadow);
  await win.screenshot({ path: path.join(OUT, '06-shadows.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 627: 6 features — lights:', JSON.stringify(after));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
