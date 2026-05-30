import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 218: Ctrl+. toggles gizmo transform space (world/local).
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-gizmo-space');

test('Studio — Ctrl+. flips gizmo space between world and local', async () => {
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
  await win.waitForFunction(() => !!window.__studioGizmo, null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  // Spawn + select a cube so the gizmo is attached.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'gizmo space demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'cube', pos: [0, 0, 0], scale: [1, 1, 1], color: '#9ab' }],
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

  const initial = await win.evaluate(() => window.__studioGizmo.space);
  // TransformControls defaults to 'world'.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '.', ctrlKey: true, bubbles: true })));
  await win.waitForTimeout(300);
  const flipped = await win.evaluate(() => window.__studioGizmo.space);
  expect(flipped, 'space flipped from initial').not.toBe(initial);
  await win.screenshot({ path: path.join(OUT, '00-flipped.png') });

  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '.', ctrlKey: true, bubbles: true })));
  await win.waitForTimeout(300);
  const back = await win.evaluate(() => window.__studioGizmo.space);
  expect(back, 'space restored').toBe(initial);
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 218: gizmo space toggle (Ctrl+.) working');

  await app.close();
});
