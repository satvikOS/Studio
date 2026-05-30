import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 206: COPY / PASTE + NUMPAD ORBIT EXTENSIONS.
 *
 *   Ctrl+C   copy selection into clipboard ref
 *   Ctrl+V   paste clipboard at offset position
 *   Numpad-2/8 orbit camera 15deg down/up
 *   Numpad-4/6 orbit camera 15deg left/right
 *   Numpad-9 invert view (orbit 180deg azimuth)
 *
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-copy-paste');

test('Studio — Ctrl+C / Ctrl+V duplicate via clipboard + Numpad orbit nudges', async () => {
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

  // Build one cube; select it.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'copy paste demo',
      scene: { discipline: 'modeling' },
      bodies: [
        { kind: 'cube', pos: [0, 0, 0], scale: [1, 1, 1], color: '#9ab' },
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

  // Ctrl+C then Ctrl+V three times — scene should grow from 1 to 4 cubes.
  const result = await win.evaluate(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
    for (let i = 0; i < 3; i++) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));
    }
    let n = 0;
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') n++;
    });
    return n;
  });
  expect(result, '1 original + 3 pastes = 4 cubes').toBe(4);
  await win.screenshot({ path: path.join(OUT, '00-after-3-paste.png') });
  await win.waitForTimeout(700);

  // Numpad-2/8 nudge camera elevation; record before + after.
  const elBefore = await win.evaluate(() => {
    const p = window.__archdiscViewport.camera.position;
    const r = Math.hypot(p.x, p.y, p.z);
    return Math.asin(p.y / r) * 180 / Math.PI;
  });
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: '8', bubbles: true })));
  await win.waitForTimeout(300);
  const elAfter = await win.evaluate(() => {
    const p = window.__archdiscViewport.camera.position;
    const r = Math.hypot(p.x, p.y, p.z);
    return Math.asin(p.y / r) * 180 / Math.PI;
  });
  expect(elAfter - elBefore, 'Numpad-8 raised elevation ~15deg').toBeGreaterThan(10);
  await win.screenshot({ path: path.join(OUT, '01-after-numpad-8.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 206: copy/paste + numpad orbit nudges working');

  await app.close();
});
