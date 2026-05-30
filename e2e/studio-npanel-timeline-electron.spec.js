import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 216: N-panel View tab shows Frame + Keyframe count.
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-npanel-timeline');

test('Studio — N-panel View tab Timeline shows live frame + keyframe count', async () => {
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

  // Switch N-panel to View tab.
  await win.evaluate(() => document.querySelector('[data-studio-npanel-tab-button="View"]').click());
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-npanel-frame]')).toHaveText('0');
  await expect(win.locator('[data-studio-npanel-keyframes]')).toHaveText('0');
  await win.screenshot({ path: path.join(OUT, '00-blank.png') });

  // Step forward 3 frames, add a primitive + keyframe.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'npanel timeline demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'cube', pos: [0, 0, 0], scale: [1, 1, 1], color: '#9ab' }],
      expect: { bodies: 1, kinds: ['cube'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(500);
  // Re-select View tab in case archieRun switched workspaces.
  await win.evaluate(() => document.querySelector('[data-studio-npanel-tab-button="View"]').click());
  await win.evaluate(() => {
    const s = window.__archdiscScene;
    let m = null;
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  await win.waitForTimeout(300);

  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-npanel-frame]')).toHaveText('3');

  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true })));
  await win.waitForTimeout(300);
  const kf = await win.locator('[data-studio-npanel-keyframes]').textContent();
  expect(Number(kf), 'keyframe count > 0').toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '01-timeline.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 216: N-panel View Timeline showing frame + keyframe count live');

  await app.close();
});
