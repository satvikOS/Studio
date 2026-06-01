import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-editops');

test('Studio V3 — edit-mode ops port (pickers + G/R/S + select + extrude/inset/subdivide) (slice 402)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 350,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioPickFaceFromClick === 'function', null, { timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioExtrudeSelectedFaces === 'function', null, { timeout: 15000 });

  // Spawn a cube + select it as the active mesh (via gizmo attach).
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let cube = null;
    vp.scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cube = o; });
    cube.position.set(0, 0, 0); cube.scale.set(1, 1, 1); cube.updateMatrixWorld(true);
    vp.transformControls.attach(cube);
    vp.camera.position.set(0, 0, 6);
    vp.orbitControls.target.set(0, 0, 0);
    vp.orbitControls.update();
    vp.camera.updateMatrixWorld(true);
    window.__studioClearEditSelection();
  });
  await win.waitForTimeout(200);

  // PICKERS — vertex / face / edge from centre-screen NDC.
  const pv = await win.evaluate(() => window.__studioPickVertexFromClick(0, 0));
  expect(pv.ok).toBe(true);
  expect(pv.vertIdx).toBeGreaterThanOrEqual(0);
  const pf = await win.evaluate(() => window.__studioPickFaceFromClick(0, 0));
  expect(pf.ok).toBe(true);
  expect(pf.vertIdx.length).toBe(3);
  expect(pf.normal[2]).toBeGreaterThan(0.5);
  const pe = await win.evaluate(() => window.__studioPickEdgeFromClick(0, 0));
  expect(pe.ok).toBe(true);
  expect(pe.vertIdx.length).toBe(2);

  // MOVE selected face — verts shift along X.
  let r = await win.evaluate(() => {
    window.__studioReplaceEditSelection('face', 0);
    return window.__studioMoveSelectedVerts(0.01, 0, 0);
  });
  expect(r.ok).toBe(true);
  expect(r.vertCount).toBe(3);

  // SCALE selected face × 2 around centroid.
  r = await win.evaluate(() => {
    window.__studioReplaceEditSelection('face', 0);
    return window.__studioScaleSelectedVerts(2);
  });
  expect(r.ok).toBe(true);
  expect(r.vertCount).toBe(3);

  // ROTATE selected face 180° z — verts mirror around centroid.
  r = await win.evaluate(() => {
    window.__studioReplaceEditSelection('face', 0);
    return window.__studioRotateSelectedVerts(Math.PI, 'z');
  });
  expect(r.ok).toBe(true);
  expect(r.vertCount).toBe(3);

  // SELECT ALL — vertex/face/edge counts.
  let sa = await win.evaluate(() => window.__studioSelectAllEdit('vertex'));
  expect(sa.counts.vertices).toBe(24);
  sa = await win.evaluate(() => window.__studioSelectAllEdit('face'));
  expect(sa.counts.faces).toBe(12);
  sa = await win.evaluate(() => window.__studioSelectAllEdit('edge'));
  expect(sa.counts.edges).toBe(30);

  // INVERT — vertex 1 selected → invert → 23.
  await win.evaluate(() => window.__studioReplaceEditSelection('vertex', 0));
  const inv = await win.evaluate(() => window.__studioInvertEditSelection('vertex'));
  expect(inv.counts.vertices).toBe(23);

  // EXTRUDE face 0 → 24v/12t → 27v/18t.
  await win.evaluate(() => window.__studioReplaceEditSelection('face', 0));
  const ex = await win.evaluate(() => window.__studioExtrudeSelectedFaces(0.005));
  expect(ex.ok).toBe(true);
  expect(ex.vertCount).toBe(27);
  expect(ex.triCount).toBe(18);

  // INSET face 0 → 27v/18t → 30v/24t (-1 + 7 = +6).
  await win.evaluate(() => window.__studioReplaceEditSelection('face', 0));
  const ins = await win.evaluate(() => window.__studioInsetSelectedFaces(0.3));
  expect(ins.ok).toBe(true);
  expect(ins.vertCount).toBe(30);
  expect(ins.triCount).toBe(24);

  // SUBDIVIDE face 0 → 30v/24t → 33v/27t (-1 + 4 = +3).
  await win.evaluate(() => window.__studioReplaceEditSelection('face', 0));
  const sub = await win.evaluate(() => window.__studioSubdivideSelectedFaces());
  expect(sub.ok).toBe(true);
  expect(sub.vertCount).toBe(33);
  expect(sub.triCount).toBe(27);

  await win.screenshot({ path: path.join(OUT, '00-after-editops.png') });

  // Reset.
  await win.evaluate(() => {
    window.localStorage.removeItem('studioV3');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });

  // eslint-disable-next-line no-console
  console.log('  slice 402: pickers + G/R/S + selectAll/invert + extrude/inset/subdivide all green');

  await app.close();
});
