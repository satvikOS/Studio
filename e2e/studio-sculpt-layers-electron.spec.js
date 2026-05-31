import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-sculpt-layers');

test('Studio — ZBrush sculpt-layer stack (slice 285)', async () => {
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
      goal: 'sculpt layers demo',
      scene: { discipline: 'sculpting' },
      bodies: [{ kind: 'sphere', pos: [0, 0, 0], scale: [4, 4, 4], color: '#cca' }],
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

  // Add 2 sculpt layers (erode + clay).
  const add1 = await win.evaluate(() => window.__studioSculptLayerAdd('erode', 0.6));
  expect(add1.ok).toBe(true);
  const add2 = await win.evaluate(() => window.__studioSculptLayerAdd('clay', 0.4));
  expect(add2.ok).toBe(true);

  const list1 = await win.evaluate(() => window.__studioSculptLayerList());
  expect(list1.length).toBe(2);
  expect(list1[0].opName).toBe('erode');
  expect(list1[1].opName).toBe('clay');

  // Capture y0 after both layers applied.
  const yBoth = await win.evaluate(() => window.__studioSelectedMesh().geometry.attributes.position.getY(0));

  // Disable erode → composite re-runs from baseline + clay only.
  const tog = await win.evaluate(() => window.__studioSculptLayerToggle(0));
  expect(tog.ok).toBe(true);
  expect(tog.enabled).toBe(false);
  const yClayOnly = await win.evaluate(() => window.__studioSelectedMesh().geometry.attributes.position.getY(0));
  expect(yClayOnly).not.toBeCloseTo(yBoth, 5);

  // Drop clay strength to 0 → composite ≈ baseline (clay disabled by strength).
  await win.evaluate(() => window.__studioSculptLayerStrength(1, 0));
  const yBaseline = await win.evaluate(() => window.__studioSelectedMesh().geometry.attributes.position.getY(0));
  // Re-enable erode at full strength → should NOT equal baseline.
  await win.evaluate(() => window.__studioSculptLayerToggle(0));
  const yErodeOnly = await win.evaluate(() => window.__studioSelectedMesh().geometry.attributes.position.getY(0));
  expect(yErodeOnly).not.toBeCloseTo(yBaseline, 5);

  // Remove a layer.
  const rem = await win.evaluate(() => window.__studioSculptLayerRemove(1));
  expect(rem.ok).toBe(true);
  expect(rem.count).toBe(1);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 285: sculpt layers ok — added 2, toggled, strengthed, removed');

  await app.close();
});
