import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-clear-lights');

test('Studio — N-panel Clear Lights removes every Studio light (slice 259)', async () => {
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
      goal: 'clear lights demo',
      scene: { discipline: 'rendering', lights: [
        { type: 'light-point', color: '#ffe6c0', intensity: 0.2 },
        { type: 'light-sun',   color: '#ffffff', intensity: 0.25 },
      ] },
      bodies: [{ kind: 'teapot', pos: [0, 0, 0], scale: [4, 4, 4], color: '#bfa14a' }],
      expect: { bodies: 1, kinds: ['teapot'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(500);

  const before = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioLight && o.isLight) n++; });
    return n;
  });
  expect(before).toBeGreaterThan(0);

  await win.evaluate(() => document.querySelector('[data-studio-npanel-tab-button="View"]').click());
  await win.waitForTimeout(300);
  await win.evaluate(() => document.querySelector('[data-studio-npanel-clear-lights]').click());
  await win.waitForTimeout(300);

  const after = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioLight && o.isLight) n++; });
    return n;
  });
  expect(after, 'every Studio light removed').toBe(0);
  await win.screenshot({ path: path.join(OUT, '00-no-lights.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 259: cleared', before, 'lights');

  await app.close();
});
