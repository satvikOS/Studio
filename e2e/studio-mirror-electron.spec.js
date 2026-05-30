import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 210: Ctrl+M MIRROR across world X axis.
 *
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-mirror');

test('Studio — Ctrl+M mirrors selected meshes across world X', async () => {
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

  // Spawn one cube at x=0.08 and select.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'mirror demo',
      scene: { discipline: 'modeling' },
      bodies: [
        { kind: 'cube', pos: [0.08, 0, 0], scale: [1, 1, 1], color: '#9ab' },
      ],
      expect: { bodies: 1, kinds: ['cube'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);
  await win.evaluate(() => {
    const s = window.__archdiscScene;
    let m = null;
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '00-before.png') });

  // Ctrl+M -> mirror across X. Scene grows to 2 cubes at +0.08 and -0.08.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', ctrlKey: true, bubbles: true })));
  await win.waitForTimeout(500);
  const xs = await win.evaluate(() => {
    const out = [];
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') out.push(o.position.x);
    });
    return out.sort((a, b) => a - b);
  });
  expect(xs.length, 'two cubes now').toBe(2);
  expect(xs[0]).toBeCloseTo(-0.08, 3);
  expect(xs[1]).toBeCloseTo( 0.08, 3);
  await win.screenshot({ path: path.join(OUT, '01-mirrored.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 210: Ctrl+M mirror across world X working');

  await app.close();
});
