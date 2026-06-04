import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-ui-theme');

test('Studio V3 — UI: setTheme/get/uiScale/get/accent/toggleHC (slice 650)', async () => {
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

  // 1: set theme light
  const lt = await win.evaluate(() => window.__studioSetTheme('light'));
  expect(lt.ok).toBe(true);
  expect(lt.theme).toBe('light');
  const rootAttr = await win.evaluate(() => document.documentElement.getAttribute('data-studio-theme'));
  expect(rootAttr).toBe('light');
  await win.screenshot({ path: path.join(OUT, '01-light.png') });

  // 2: get theme
  const g = await win.evaluate(() => window.__studioGetTheme());
  expect(g.theme).toBe('light');
  await win.screenshot({ path: path.join(OUT, '02-get.png') });

  // 3: UI scale up
  const sc = await win.evaluate(() => window.__studioSetUiScale(1.25));
  expect(sc.scale).toBe(1.25);
  const fs2 = await win.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  expect(fs2).toBeCloseTo(20, 0);
  await win.screenshot({ path: path.join(OUT, '03-scale.png') });

  // 4: get UI scale
  const sg = await win.evaluate(() => window.__studioGetUiScale());
  expect(sg.scale).toBeCloseTo(1.25, 2);
  await win.screenshot({ path: path.join(OUT, '04-getScale.png') });

  // 5: accent color
  const ac = await win.evaluate(() => window.__studioSetAccentColor(0xff5577));
  expect(ac.ok).toBe(true);
  expect(ac.accent.toLowerCase()).toBe('#ff5577');
  await win.screenshot({ path: path.join(OUT, '05-accent.png') });

  // 6: toggle high contrast
  const hc = await win.evaluate(() => window.__studioToggleHighContrast());
  expect(hc.theme).toBe('high-contrast');
  const hcAttr = await win.evaluate(() => document.documentElement.getAttribute('data-studio-theme'));
  expect(hcAttr).toBe('high-contrast');
  await win.screenshot({ path: path.join(OUT, '06-hc.png') });

  // restore dark for downstream
  await win.evaluate(() => window.__studioSetTheme('dark'));
  await win.evaluate(() => window.__studioSetUiScale(1));

  // eslint-disable-next-line no-console
  console.log('  slice 650: 6 UI features — theme light → HC, scale 1.25, accent', ac.accent);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
