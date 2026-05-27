import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 79 — Two more Blender mods:
 *
 *   Twist     <- blender/source/blender/modifiers/intern/MOD_simpledeform.cc
 *                (MOD_SIMPLEDEFORM_MODE_TWIST)
 *   EdgeSplit <- blender/source/blender/modifiers/intern/MOD_edgesplit.cc
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-twist-edgesplit');

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

async function meshState(win, kind) {
  return await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (!m) return null;
    const pos = m.geometry.attributes.position;
    let sum = 0;
    for (let i = 0; i < pos.count; i++) sum += Math.abs(pos.getX(i)) + Math.abs(pos.getY(i)) + Math.abs(pos.getZ(i));
    return {
      verts: pos.count,
      indexed: !!m.geometry.index,
      checksum: sum,
      twisted: m.userData.archdiscStudioTwisted || 0,
      edgeSplit: m.userData.archdiscStudioEdgeSplit || 0,
    };
  }, kind);
}

test('Studio Blender Twist + EdgeSplit — both ribbon mods fire', async () => {
  test.setTimeout(120000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 220,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // ---- TWIST on a torus (visible spiral) ----
  await win.locator('[data-studio-primitive="torus"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'torus');
  await win.waitForTimeout(300);
  const torusBaseline = await meshState(win, 'torus');
  await win.locator('[data-studio-ribbon-action="twist"]').click();
  await win.waitForTimeout(400);
  const afterTwist = await meshState(win, 'torus');
  expect(afterTwist.twisted).toBe(1);
  expect(Math.abs(afterTwist.checksum - torusBaseline.checksum)).toBeGreaterThan(0.001);
  await win.screenshot({ path: path.join(OUT, '01-torus-twisted.png'), fullPage: false });

  // ---- EDGE SPLIT on a fresh sphere (sphere is indexed -> after edge-
  //      split it becomes non-indexed) ----
  await win.locator('[data-studio-action="clear-scene-ribbon"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'sphere');
  await win.waitForTimeout(300);
  const sphBaseline = await meshState(win, 'sphere');
  expect(sphBaseline.indexed).toBe(true);
  await win.locator('[data-studio-ribbon-action="edge-split"]').click();
  await win.waitForTimeout(400);
  const afterEdgeSplit = await meshState(win, 'sphere');
  expect(afterEdgeSplit.edgeSplit).toBe(1);
  expect(afterEdgeSplit.indexed).toBe(false);
  // Vert count grows because each face's corners are now unique.
  expect(afterEdgeSplit.verts).toBeGreaterThan(sphBaseline.verts);
  await win.screenshot({ path: path.join(OUT, '02-sphere-edgesplit.png'), fullPage: false });

  // ---- 4-angle showcase ----
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 22, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `03-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  blender twist + edgesplit: torus twist cs ${torusBaseline.checksum.toFixed(3)} -> ${afterTwist.checksum.toFixed(3)}; sphere ${sphBaseline.verts}v indexed -> ${afterEdgeSplit.verts}v non-indexed after edgesplit`);

  await app.close();
});
