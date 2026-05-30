import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 207: VIEW CUBE corner widget.
 *
 * 3x2 grid of buttons (Top / Front / Right / Bot / Back / Left) at the
 * top-right of the viewport. Each click orbits the camera to the
 * canonical view (3ds Max / Fusion 360 NavCube pattern).
 *
 * Headed Mac Electron run.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-view-cube');

test('Studio — View Cube buttons orbit camera to canonical views', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 700,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  // Widget mounted with all 6 faces.
  await expect(win.locator('[data-studio-view-cube]')).toBeVisible();
  for (const f of ['top', 'front', 'right', 'bot', 'back', 'left']) {
    await expect(win.locator(`[data-studio-view-cube-face="${f}"]`)).toBeVisible();
  }
  await win.screenshot({ path: path.join(OUT, '00-widget.png') });

  // Build a teapot to give the scene something to orbit around.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'view cube demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'teapot', pos: [0, 0, 0], scale: [1, 1, 1], color: '#bfa14a' }],
      expect: { bodies: 1, kinds: ['teapot'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);

  const cases = [
    { face: 'top',   expectedEl:  89, expectedAz:   0 },
    { face: 'front', expectedEl:   0, expectedAz:   0 },
    { face: 'right', expectedEl:   0, expectedAz:  90 },
  ];
  for (const c of cases) {
    await win.evaluate((f) => document.querySelector(`[data-studio-view-cube-face="${f}"]`).click(), c.face);
    await win.waitForTimeout(500);
    const cam = await win.evaluate(() => {
      const p = window.__archdiscViewport.camera.position;
      const r = Math.hypot(p.x, p.y, p.z);
      return { az: Math.atan2(p.x, p.z) * 180 / Math.PI, el: Math.asin(p.y / r) * 180 / Math.PI };
    });
    expect(Math.abs(cam.el - c.expectedEl), `${c.face} elevation`).toBeLessThan(6);
    expect(Math.abs(cam.az - c.expectedAz), `${c.face} azimuth`).toBeLessThan(6);
    await win.screenshot({ path: path.join(OUT, `01-${c.face}.png`) });
    await win.waitForTimeout(400);
  }

  await win.waitForTimeout(2500);
  // eslint-disable-next-line no-console
  console.log('  slice 207: View Cube buttons orbit to top/front/right cleanly');

  await app.close();
});
