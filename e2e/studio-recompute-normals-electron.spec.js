import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-recompute-normals');

test('Studio — Shift+N recomputes vertex normals (slice 280)', async () => {
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
      goal: 'normals demo',
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
  await win.waitForTimeout(300);

  // Zero out normals; assert; Shift+N restores.
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const n = m.geometry.attributes.normal;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 0, 0);
    n.needsUpdate = true;
  });
  const sumZero = await win.evaluate(() => {
    const n = window.__studioSelectedMesh().geometry.attributes.normal;
    let s = 0; for (let i = 0; i < n.count; i++) s += Math.abs(n.getX(i)) + Math.abs(n.getY(i)) + Math.abs(n.getZ(i));
    return s;
  });
  expect(sumZero).toBeLessThan(1e-3);

  await win.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', shiftKey: true, bubbles: true })));
  await win.waitForTimeout(300);
  const sumRecomp = await win.evaluate(() => {
    const n = window.__studioSelectedMesh().geometry.attributes.normal;
    let s = 0; for (let i = 0; i < n.count; i++) s += Math.abs(n.getX(i)) + Math.abs(n.getY(i)) + Math.abs(n.getZ(i));
    return s;
  });
  expect(sumRecomp, 'normals recomputed > 0').toBeGreaterThan(1);
  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 280: normals sum after recompute=', sumRecomp);

  await app.close();
});
