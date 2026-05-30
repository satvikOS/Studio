import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 193: BLENDER NUMPAD VIEW SHORTCUTS.
 *
 *   Numpad-1 -> front (az=0, el=0)
 *   Numpad-3 -> right (az=90, el=0)
 *   Numpad-7 -> top   (az=0, el=89)
 *   Ctrl + 1/3/7 -> back / left / bottom
 *   Numpad-5 -> toggle ortho/persp projection marker
 *
 * Headed Mac Electron run at watchable pace.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-numpad-views');

test('Studio — Blender numpad view shortcuts orbit camera to canonical views', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 800,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  // Build a body so there's something to orbit around.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'numpad views demo',
      scene: { discipline: 'modeling' },
      bodies: [
        { kind: 'teapot', pos: [0, 0, 0], scale: [1, 1, 1], color: '#bfa14a' },
      ],
      expect: { bodies: 1, kinds: ['teapot'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);

  // For each numpad view, dispatch the key + verify the camera moved to
  // expected azimuth/elevation (read back from orbit controls).
  const cases = [
    { key: '1',  expectedAz: 0,    expectedEl: 0,   name: '01-front'  },
    { key: '3',  expectedAz: 90,   expectedEl: 0,   name: '02-right'  },
    { key: '7',  expectedAz: 0,    expectedEl: 89,  name: '03-top'    },
  ];

  for (const c of cases) {
    await win.evaluate((key) => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }, c.key);
    await win.waitForTimeout(500);
    const cam = await win.evaluate(() => {
      // Read camera spherical position relative to scene origin so the
      // assertion is projection-independent.
      const v = window.__archdiscViewport;
      if (!v) return null;
      const p = v.camera.position;
      const r = Math.hypot(p.x, p.y, p.z);
      const el = Math.asin(p.y / r) * 180 / Math.PI;
      const az = Math.atan2(p.x, p.z) * 180 / Math.PI;
      return { az, el, r };
    });
    // eslint-disable-next-line no-console
    console.log(`  ${c.name} cam:`, JSON.stringify(cam));
    expect(cam, `${c.name} cam present`).not.toBeNull();
    expect(Math.abs(cam.az - c.expectedAz), `${c.name} azimuth ~${c.expectedAz}`).toBeLessThan(6);
    expect(Math.abs(cam.el - c.expectedEl), `${c.name} elevation ~${c.expectedEl}`).toBeLessThan(6);
    await win.screenshot({ path: path.join(OUT, `${c.name}.png`) });
    await win.waitForTimeout(400);
  }

  // Numpad-5 toggles ortho/persp projection marker on the window.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '5', bubbles: true })));
  await win.waitForTimeout(200);
  const proj = await win.evaluate(() => window.__studioViewProjection);
  expect(proj, 'Numpad-5 toggled projection marker').toBe('ortho');

  await win.waitForTimeout(2500);
  // eslint-disable-next-line no-console
  console.log('  slice 193: Blender numpad view shortcuts (1/3/7 + 5) wired end-to-end');

  await app.close();
});
