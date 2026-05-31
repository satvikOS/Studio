import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-sculpt-layers-ui');

test('Studio — N-panel Sculpt Layers UI (slice 286)', async () => {
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

  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'sculpt layers UI demo',
      scene: { discipline: 'sculpting' },
      bodies: [{ kind: 'sphere', pos: [0, 0, 0], scale: [4, 4, 4], color: '#cba' }],
      expect: { bodies: 1, kinds: ['sphere'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);
  await win.evaluate(() => {
    let m = null;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  await win.waitForTimeout(400);

  // Section visible + empty initially.
  await expect(win.locator('[data-studio-npanel-section="sculpt-layers"]')).toBeVisible();
  await expect(win.locator('[data-studio-sculpt-layer-empty]')).toBeVisible();

  // Add a sculpt layer via the API; UI should render a row.
  await win.evaluate(() => window.__studioSculptLayerAdd('clay', 0.5));
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-sculpt-layer-name]')).toHaveCount(1);
  await expect(win.locator('[data-studio-sculpt-layer-name]').first()).toContainText('clay');

  // Click the toggle checkbox — layer disables.
  await win.locator('[data-studio-sculpt-layer-enabled="0"]').click();
  await win.waitForTimeout(200);
  const after = await win.evaluate(() => window.__studioSculptLayerList()[0].enabled);
  expect(after).toBe(false);

  // Remove via the × button.
  await win.locator('[data-studio-sculpt-layer-remove="0"]').click();
  await win.waitForTimeout(200);
  await expect(win.locator('[data-studio-sculpt-layer-name]')).toHaveCount(0);
  await expect(win.locator('[data-studio-sculpt-layer-empty]')).toBeVisible();

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 286: sculpt-layers UI renders, toggles, and removes');

  await app.close();
});
