import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-measure-chip');

test('Studio V3 — measurement chip appears + fades (slice 549)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
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

  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(120);
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(250);

  await win.evaluate(() => {
    const arr = [];
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) arr.push(o); });
    if (arr.length >= 2) {
      arr[0].position.set(0, 0, 0); arr[0].updateMatrixWorld(true);
      arr[1].position.set(0.42, 0, 0); arr[1].updateMatrixWorld(true);
    }
    window.__studioSelectedMeshesSet = arr.slice(0, 2);
  });

  await win.keyboard.press('m');
  await win.waitForTimeout(250);

  const chip = win.locator('[data-studio-v3-measure-chip]');
  await expect(chip).toBeVisible();
  const mm = Number(await chip.getAttribute('data-studio-v3-measure-mm'));
  expect(mm).toBeGreaterThan(400);
  expect(mm).toBeLessThan(450);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 549: measure chip', mm.toFixed(2), 'mm');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
