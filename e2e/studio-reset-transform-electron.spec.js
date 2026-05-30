import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 212: Alt+G / Alt+R / Alt+S clear position / rotation / scale.
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-reset-transform');

test('Studio — Alt+G/R/S reset selected transforms', async () => {
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
      goal: 'reset xform demo',
      scene: { discipline: 'modeling' },
      bodies: [
        { kind: 'cube', pos: [0.3, 0.2, 0.1], scale: [2, 2, 2], rot: [0.4, 0.5, 0.6], color: '#9ab' },
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
  await win.screenshot({ path: path.join(OUT, '00-offset.png') });

  // Alt+G clears position.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', altKey: true, bubbles: true })));
  await win.waitForTimeout(300);
  const pos = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return [m.position.x, m.position.y, m.position.z];
  });
  expect(pos[0]).toBeCloseTo(0, 4); expect(pos[1]).toBeCloseTo(0, 4); expect(pos[2]).toBeCloseTo(0, 4);
  await win.screenshot({ path: path.join(OUT, '01-pos-cleared.png') });

  // Alt+R clears rotation.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', altKey: true, bubbles: true })));
  await win.waitForTimeout(300);
  const rot = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return [m.rotation.x, m.rotation.y, m.rotation.z];
  });
  expect(rot[0]).toBeCloseTo(0, 4); expect(rot[1]).toBeCloseTo(0, 4); expect(rot[2]).toBeCloseTo(0, 4);
  await win.screenshot({ path: path.join(OUT, '02-rot-cleared.png') });

  // Alt+S clears scale (back to 1).
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', altKey: true, bubbles: true })));
  await win.waitForTimeout(300);
  const sc = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return [m.scale.x, m.scale.y, m.scale.z];
  });
  expect(sc[0]).toBeCloseTo(1, 4); expect(sc[1]).toBeCloseTo(1, 4); expect(sc[2]).toBeCloseTo(1, 4);
  await win.screenshot({ path: path.join(OUT, '03-scale-cleared.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 212: Alt+G/R/S reset transforms working');

  await app.close();
});
