import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 231: per-mesh opacity slider in N-panel Item tab.
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-npanel-opacity');

test('Studio — N-panel opacity slider drives material opacity + transparent', async () => {
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

  // Build cube + select.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'opacity demo',
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

  // Ensure N-panel is on Item tab.
  await win.evaluate(() => document.querySelector('[data-studio-npanel-tab-button="Item"]').click());
  await win.waitForTimeout(300);
  await expect(win.locator('[data-studio-npanel-opacity]')).toBeVisible();

  // Drive opacity to 0.4.
  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-npanel-opacity]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, '0.4');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await win.waitForTimeout(300);

  const result = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return { op: m.material.opacity, tr: m.material.transparent, mirror: window.__studioMeshOpacity };
  });
  expect(result.op).toBeCloseTo(0.4, 2);
  expect(result.tr).toBe(true);
  expect(result.mirror).toBeCloseTo(0.4, 2);
  await win.screenshot({ path: path.join(OUT, '00-opacity-04.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 231: opacity slider working');

  await app.close();
});
