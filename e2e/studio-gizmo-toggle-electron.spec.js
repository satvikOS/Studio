import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 234: Y key toggles gizmo visibility.
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-gizmo-toggle');

test('Studio — Y key hides + shows the transform gizmo', async () => {
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

  // Spawn + select cube so gizmo is attached.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'gizmo toggle demo',
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

  // Y hides.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', bubbles: true })));
  await win.waitForTimeout(300);
  expect(await win.evaluate(() => window.__studioGizmoVisible)).toBe(false);
  await win.screenshot({ path: path.join(OUT, '00-hidden.png') });

  // Y shows.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', bubbles: true })));
  await win.waitForTimeout(300);
  expect(await win.evaluate(() => window.__studioGizmoVisible)).toBe(true);
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 234: Y gizmo toggle working');

  await app.close();
});
