import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 15 — Rigging / Armature.
 *
 * Pick a bone count (2–16), click Add Bone Chain → merged-geometry
 * armature (alternating joint spheres + tapered-cylinder bones) drops
 * into the scene as a single Studio primitive. Vertex count scales
 * predictably with bone count, so the spec asserts that growth.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-armature');

test('Studio armature — Add Bone Chain at multiple bone counts', async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 300,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  await expect(win.locator('[data-studio-section="armature"]')).toBeVisible();
  await expect(win.locator('[data-studio-armature-readout="bones"]')).toHaveText('5');
  await win.screenshot({ path: path.join(OUT, '00-armature-panel-default.png'), fullPage: false });

  // ---- 5-bone chain (default) ----
  await win.locator('[data-studio-action="add-armature"]').click();
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('1 primitive in scene');

  const a5 = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let target = null;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'armature') target = o;
    });
    if (!target) return null;
    return {
      bones: target.userData.archdiscStudioArmatureBones,
      vCount: target.geometry.attributes.position.count,
    };
  });
  expect(a5).not.toBeNull();
  expect(a5.bones).toBe(5);

  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(35, 20, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '01-armature-5-bones.png'), fullPage: false });

  // ---- 10-bone chain ----
  await win.locator('[data-studio-armature="bones"]').fill('10');
  await win.dispatchEvent('[data-studio-armature="bones"]', 'input');
  await expect(win.locator('[data-studio-armature-readout="bones"]')).toHaveText('10');
  await win.locator('[data-studio-action="add-armature"]').click();
  await win.waitForTimeout(500);
  await expect(win.locator('[data-studio-primitive-count]')).toHaveText('2 primitives in scene');

  // Larger bone count → larger merged geometry (more joints + segments).
  const totalArmatureV = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let sum = 0;
    vp.scene.traverse(o => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'armature') {
        sum += o.geometry.attributes.position.count;
      }
    });
    return sum;
  });
  // 5-bone armature + 10-bone armature: 10-bone must contribute more
  // than 5-bone's share, so total > 2 * a5.vCount.
  expect(totalArmatureV).toBeGreaterThan(a5.vCount * 2);

  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(45, 25, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '02-two-armatures-az45.png'), fullPage: false });
  await win.evaluate(() => window.__archdiscOrbitView && window.__archdiscOrbitView(225, 25, 1));
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '03-two-armatures-az225.png'), fullPage: false });

  // eslint-disable-next-line no-console
  console.log(`  armature: 5 bones (${a5.vCount}v) + 10 bones → total ${totalArmatureV}v across 2 primitives`);

  await app.close();
});
