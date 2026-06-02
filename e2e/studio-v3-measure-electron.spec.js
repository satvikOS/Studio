import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-measure');

test('Studio V3 — M measures distance between 2 selected (slice 512)', async () => {
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
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(120);
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(250);

  // Space the two apart and seed the selection set.
  await win.evaluate(() => {
    const arr = [];
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) arr.push(o); });
    if (arr.length >= 2) {
      arr[0].position.set(0, 0, 0); arr[0].updateMatrixWorld(true);
      arr[1].position.set(0.5, 0, 0); arr[1].updateMatrixWorld(true);
    }
    window.__studioSelectedMeshesSet = arr.slice(0, 2);
  });

  // Listen for the result event before firing the hotkey.
  await win.evaluate(() => {
    window.__lastMeasure = null;
    window.addEventListener('studio-measure-result', (e) => { window.__lastMeasure = e.detail; });
  });

  await win.keyboard.press('m');
  await win.waitForTimeout(200);

  const res = await win.evaluate(() => window.__lastMeasure);
  expect(res).not.toBeNull();
  expect(res.distance).toBeCloseTo(0.5, 2);
  expect(res.mm).toBeCloseTo(500, 0);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 512: distance', res.mm.toFixed(1), 'mm');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
