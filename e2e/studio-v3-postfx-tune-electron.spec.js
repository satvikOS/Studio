import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-postfx-tune');

test('Studio V3 — post-fx tune: bloomStr/Thresh/ssaoR/I/outlineCol/Thick (slice 674)', async () => {
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

  // Enable composer + bloom + ssao first
  await win.evaluate(() => window.__studioToggleOutlinePass());
  await win.evaluate(() => window.__studioToggleBloom());
  await win.evaluate(() => window.__studioToggleSSAO());
  await win.waitForTimeout(150);

  // 1: bloom strength
  const bs = await win.evaluate(() => window.__studioSetBloomStrength(1.4));
  expect(bs.ok).toBe(true);
  expect(bs.strength).toBe(1.4);
  await win.screenshot({ path: path.join(OUT, '01-bloomStr.png') });

  // 2: bloom threshold
  const bt = await win.evaluate(() => window.__studioSetBloomThreshold(0.4));
  expect(bt.ok).toBe(true);
  expect(bt.threshold).toBe(0.4);
  await win.screenshot({ path: path.join(OUT, '02-bloomThresh.png') });

  // 3: SSAO radius
  const sr = await win.evaluate(() => window.__studioSetSSAORadius(0.5));
  expect(sr.ok).toBe(true);
  expect(sr.radius).toBe(0.5);
  await win.screenshot({ path: path.join(OUT, '03-ssaoR.png') });

  // 4: SSAO intensity (minDistance)
  const si = await win.evaluate(() => window.__studioSetSSAOIntensity(0.05));
  expect(si.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '04-ssaoI.png') });

  // 5: outline color
  const oc = await win.evaluate(() => window.__studioSetOutlineColor(0xff5577, 0x440011));
  expect(oc.ok).toBe(true);
  expect(oc.visible.toLowerCase()).toBe('#ff5577');
  await win.screenshot({ path: path.join(OUT, '05-outlineCol.png') });

  // 6: outline thickness
  const ot = await win.evaluate(() => window.__studioSetOutlineThickness(2.5, 0.8, 6));
  expect(ot.ok).toBe(true);
  expect(ot.thickness).toBe(2.5);
  await win.screenshot({ path: path.join(OUT, '06-outlineThick.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 674: 6 post-fx tune features verified — bloom', bs.strength, 'outline t/g/s', ot.thickness, ot.glow, ot.strength);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
