import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 213: K inserts keyframe, ArrowLeft/Right step frames.
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-keyframe');

test('Studio — K inserts keyframe + Left/Right step frames', async () => {
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
  await win.waitForFunction(() => typeof window.__studioInsertKeyframeAt === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  // Build + select a cube. Initialize the frame mirror to 0.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'keyframe demo',
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
    window.__studioSetFrame(0);
  });
  await win.waitForTimeout(300);

  // K at frame 0 → keyframe count grows.
  const before = await win.evaluate(() => window.__studioGetKeyframes().length);
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true })));
  await win.waitForTimeout(300);
  const after = await win.evaluate(() => window.__studioGetKeyframes().length);
  expect(after - before, 'K added a keyframe').toBeGreaterThanOrEqual(1);
  await win.screenshot({ path: path.join(OUT, '00-after-K.png') });

  // Right arrow steps frame forward; Left steps back.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  await win.waitForTimeout(300);
  expect(await win.evaluate(() => window.__studioGetFrame())).toBe(1);
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  await win.waitForTimeout(300);
  expect(await win.evaluate(() => window.__studioGetFrame())).toBe(2);
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
  await win.waitForTimeout(300);
  expect(await win.evaluate(() => window.__studioGetFrame())).toBe(1);
  await win.screenshot({ path: path.join(OUT, '01-frame-stepped.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 213: K keyframe + Left/Right step frames working');

  await app.close();
});
