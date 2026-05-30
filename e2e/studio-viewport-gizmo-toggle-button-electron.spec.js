import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 242: viewport-header gizmo toggle button.
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-viewport-gizmo-toggle-button');

test('Studio — viewport header gizmo button flips visibility', async () => {
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
  await win.waitForFunction(() => !!window.__studioGizmo, null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'gizmo button demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'cube', pos: [0, 0, 0], scale: [1, 1, 1], color: '#9ab' }],
      expect: { bodies: 1, kinds: ['cube'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(500);
  await win.evaluate(() => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  await win.waitForTimeout(300);

  await expect(win.locator('[data-studio-viewport-gizmo-toggle]')).toBeVisible();
  await win.evaluate(() => document.querySelector('[data-studio-viewport-gizmo-toggle]').click());
  await win.waitForTimeout(300);
  expect(await win.evaluate(() => window.__studioGizmoVisible)).toBe(false);
  await win.screenshot({ path: path.join(OUT, '00-hidden.png') });

  await win.evaluate(() => document.querySelector('[data-studio-viewport-gizmo-toggle]').click());
  await win.waitForTimeout(300);
  expect(await win.evaluate(() => window.__studioGizmoVisible)).toBe(true);
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 242: gizmo toggle button working');

  await app.close();
});
