import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — CINEMA 4D MoGraph CLONER + EFFECTOR (headed Electron).
 *
 * Closes a DCC gap (C4D MoGraph, previously ABSENT — Array only). Cloner grids
 * the selected object into one InstancedMesh; a radial FALLOFF effector (1 at
 * centre -> 0 at edges) drives each clone's scale + Y-rise + twist, forming the
 * signature MoGraph bump. Deterministic (index/falloff-driven). Verified that
 * centre clones are larger + higher than edge clones, and visually.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-mograph-cloner');

test('Studio — MoGraph cloner grids clones with a real falloff effector', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: Number(process.env.STUDIO_SLOWMO) || 220 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioSelectMesh === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(500);

  // Add a cube + select it as the cloner source.
  await win.locator('[data-studio-primitive="cube"]').click();
  await win.waitForTimeout(250);
  await win.evaluate(() => {
    const s = window.__archdiscScene; let m = null;
    s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });
  await win.waitForTimeout(200);

  const cloneBtn = win.locator('[data-studio-ribbon-action="mograph-cloner"]');
  await expect(cloneBtn).toBeEnabled();
  await cloneBtn.click();
  await win.waitForTimeout(400);

  // Inspect the cloner InstancedMesh: 64 clones, centre clone bigger + higher
  // than an edge clone (the radial effector falloff at work).
  const r = await win.evaluate(() => {
    const s = window.__archdiscScene; let inst = null;
    s && s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'mograph-cloner') inst = o; });
    if (!inst || !inst.isInstancedMesh) return null;
    const Matrix4 = inst.matrixWorld.constructor; // real THREE.Matrix4, no window.THREE needed
    const read = (i) => {
      const mat = new Matrix4();
      inst.getMatrixAt(i, mat);
      const e = mat.elements;
      return { s: Math.hypot(e[0], e[1], e[2]), y: e[13] }; // |col0| = scale, e[13] = translate y
    };
    const count = inst.count;
    const side = Math.round(Math.sqrt(count)); // 8
    const centre = read(Math.floor(side / 2) * side + Math.floor(side / 2)); // ~grid centre
    const edge = read(0);                                                     // a corner clone
    return { count, kind: inst.userData.archdiscStudioPrimitiveKind, falloff: inst.userData.archdiscStudioMographFalloff, centreS: centre.s, centreY: centre.y, edgeS: edge.s, edgeY: edge.y };
  });

  expect(r, 'mograph cloner InstancedMesh exists').not.toBeNull();
  expect(r.count, '8x8 = 64 clones').toBe(64);
  expect(r.falloff).toBe('radial');
  expect(r.centreS, 'centre clone is larger than an edge clone (scale falloff)').toBeGreaterThan(r.edgeS + 0.1);
  expect(r.centreY, 'centre clone is raised above an edge clone (rise falloff)').toBeGreaterThan(r.edgeY + 1e-4);

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(34, 24, 1.2); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '01-mograph-bump.png') });

  // eslint-disable-next-line no-console
  console.log(`  mograph: ${r.count} clones, falloff=${r.falloff}, centre scale ${r.centreS.toFixed(3)} / y ${r.centreY.toFixed(4)} vs edge scale ${r.edgeS.toFixed(3)} / y ${r.edgeY.toFixed(4)}`);

  await app.close();
});
