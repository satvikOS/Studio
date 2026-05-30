import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-bsphere');

test('Studio — N-panel Measure shows bounding-sphere radius (slice 257)', async () => {
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
      goal: 'bsphere demo',
      scene: { discipline: 'modeling' },
      bodies: [{ kind: 'sphere', pos: [0, 0, 0], scale: [4, 4, 4], color: '#c9a' }],
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
  await win.evaluate(() => window.__studioFrameAll && window.__studioFrameAll());
  await win.waitForTimeout(400);
  await win.evaluate(() => document.querySelector('[data-studio-npanel-tab-button="Item"]').click());
  await win.waitForTimeout(300);

  await expect(win.locator('[data-studio-npanel-bsphere-radius]')).toBeVisible();
  const r = parseFloat(await win.locator('[data-studio-npanel-bsphere-radius]').textContent());
  expect(r, 'sphere bounding radius positive').toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '00-bsphere.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 257: bounding sphere radius =', r);

  await app.close();
});
