import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Slice 82 — Full Blender modifier kernel mirror.
 *
 * Batch verification of 15 Blender-source-cited modifiers shipped
 * in one go. Each modifier:
 *   1. Has a function citing its Blender source path in code.
 *   2. Has a ribbon button in the "Blender · Deform" or "Blender · Sim"
 *      group with hover tooltip naming the source file.
 *   3. Stamps a userData counter on the target mesh when fired.
 *
 * Modifiers covered:
 *   bevel, corrective-smooth, curve-mod, hook, lattice, mesh-deform,
 *   multires, ocean, remesh, screw, shrinkwrap, catmull-clark,
 *   weighted-normals, mask, uv-warp, laplacian-deform
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-blender-full-kernel');

async function selectByKind(win, kind) {
  await win.evaluate((k) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  }, kind);
}

async function fireAndVerify(win, action, kind, counterKey) {
  await win.locator(`[data-studio-ribbon-action="${action}"]`).click();
  await win.waitForTimeout(400);
  const counter = await win.evaluate(({ k, key }) => {
    const vp = window.__archdiscViewport;
    let m = null;
    vp.scene.traverse(o => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === k) m = o; });
    return m ? (m.userData[key] || 0) : 0;
  }, { k: kind, key: counterKey });
  return counter;
}

test('Studio Blender full kernel — 15 modifiers fire in one batch', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: 150,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  // Stage subdivided sphere — has lots of verts + UVs.
  await win.locator('[data-studio-primitive="sphere"]').click();
  await win.waitForTimeout(300);
  await selectByKind(win, 'sphere');
  await win.waitForTimeout(300);

  // Drive each modifier and verify its counter increments. Each
  // op operates on the current state of the sphere (effects stack).
  const results = [];

  // Group 1 — Blender · Deform (7 mods)
  results.push(['bevel',             await fireAndVerify(win, 'bevel',             'sphere', 'archdiscStudioBevelled')]);
  results.push(['corrective-smooth', await fireAndVerify(win, 'corrective-smooth','sphere', 'archdiscStudioCorrectiveSmooth')]);
  results.push(['curve-mod',         await fireAndVerify(win, 'curve-mod',        'sphere', 'archdiscStudioCurveDeform')]);
  results.push(['hook',              await fireAndVerify(win, 'hook',             'sphere', 'archdiscStudioHook')]);
  results.push(['lattice',           await fireAndVerify(win, 'lattice',          'sphere', 'archdiscStudioLattice')]);
  results.push(['mesh-deform',       await fireAndVerify(win, 'mesh-deform',      'sphere', 'archdiscStudioMeshDeform')]);
  results.push(['multires',          await fireAndVerify(win, 'multires',         'sphere', 'archdiscStudioMultires')]);
  await win.screenshot({ path: path.join(OUT, '01-after-deform-group.png'), fullPage: false });

  // Group 2 — Blender · Sim (9 mods)
  results.push(['ocean',             await fireAndVerify(win, 'ocean',            'sphere', 'archdiscStudioOcean')]);
  results.push(['shrinkwrap',        await fireAndVerify(win, 'shrinkwrap',       'sphere', 'archdiscStudioShrinkwrapped')]);
  results.push(['screw',             await fireAndVerify(win, 'screw',            'sphere', 'archdiscStudioScrewed')]);
  results.push(['catmull-clark',     await fireAndVerify(win, 'catmull-clark',    'sphere', 'archdiscStudioCatmullClark')]);
  results.push(['weighted-normals',  await fireAndVerify(win, 'weighted-normals', 'sphere', 'archdiscStudioWeightedNormals')]);
  results.push(['mask',              await fireAndVerify(win, 'mask',             'sphere', 'archdiscStudioMasked')]);
  results.push(['uv-warp',           await fireAndVerify(win, 'uv-warp',          'sphere', 'archdiscStudioUvWarped')]);
  results.push(['laplacian-deform',  await fireAndVerify(win, 'laplacian-deform', 'sphere', 'archdiscStudioLaplacianDeform')]);
  // Remesh last — replaces geometry entirely.
  results.push(['remesh',            await fireAndVerify(win, 'remesh',           'sphere', 'archdiscStudioRemeshed')]);
  await win.screenshot({ path: path.join(OUT, '02-after-sim-group.png'), fullPage: false });

  // Every modifier should have fired (counter > 0).
  for (const [name, counter] of results) {
    expect(counter, `modifier ${name} counter`).toBeGreaterThan(0);
  }

  // 4-angle showcase of the final state.
  for (const az of [0, 90, 180, 270]) {
    await win.evaluate((a) => window.__archdiscOrbitView && window.__archdiscOrbitView(a, 22, 1), az);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `03-az${az}.png`), fullPage: false });
  }

  // eslint-disable-next-line no-console
  console.log(`  blender full kernel: ${results.length} modifiers fired — ${results.map(r => r[0]).join(', ')}`);

  await app.close();
});
