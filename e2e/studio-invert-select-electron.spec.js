import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 221: Ctrl+I inverts selection.
 * Headed Mac Electron.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-invert-select');

test('Studio — Ctrl+I inverts the multi-select set', async () => {
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
      goal: 'invert demo',
      scene: { discipline: 'modeling' },
      bodies: [
        { kind: 'cube',         pos: [-0.07, 0, 0], scale: [1, 1, 1], color: '#9ab' },
        { kind: 'sphere',       pos: [ 0,    0, 0], scale: [1, 1, 1], color: '#c9a' },
        { kind: 'icosahedron',  pos: [ 0.07, 0, 0], scale: [1, 1, 1], color: '#ac9' },
      ],
      expect: { bodies: 3, kinds: ['cube', 'icosahedron', 'sphere'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);
  // Select only the sphere.
  await win.evaluate(() => {
    const s = window.__archdiscScene;
    let m = null;
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  await win.waitForTimeout(300);
  expect(await win.evaluate(() => window.__studioSelectedMeshes().length)).toBe(1);

  // Ctrl+I inverts: cube + icosahedron selected, sphere out.
  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', ctrlKey: true, bubbles: true })));
  await win.waitForTimeout(300);
  const result = await win.evaluate(() => {
    const set = window.__studioSelectedMeshes();
    return {
      count: set.length,
      kinds: set.map((m) => m.userData && m.userData.archdiscStudioPrimitiveKind).sort(),
    };
  });
  expect(result.count, 'two other primitives selected').toBe(2);
  expect(result.kinds).toEqual(['cube', 'icosahedron']);
  await win.screenshot({ path: path.join(OUT, '00-inverted.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 221: Ctrl+I invert selection working');

  await app.close();
});
