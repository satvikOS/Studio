import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-modops');

test('Studio V3 — modifier stack + sculpt layers + snap + merge + symmetrize (slice 404)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
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
  await win.waitForFunction(() => typeof window.__studioModStackAdd === 'function', null, { timeout: 15000 });

  // Spawn + select cube.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let cube = null;
    vp.scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cube = o; });
    vp.transformControls.attach(cube);
  });

  // ─── Modifier stack ──────────────────────────────────────────────────
  let r = await win.evaluate(() => window.__studioModStackAdd(window.__studioSelectedMesh().uuid, 'subdivide', { iterations: 1 }));
  expect(r.ok).toBe(true);
  expect(r.count).toBe(1);
  r = await win.evaluate(() => window.__studioModStackAdd(window.__studioSelectedMesh().uuid, 'mirror', { axis: 'x' }));
  expect(r.count).toBe(2);
  let stack = await win.evaluate(() => window.__studioModStackGet(window.__studioSelectedMesh().uuid));
  expect(stack.mods.length).toBe(2);
  // Reorder mirror to position 0.
  r = await win.evaluate(() => window.__studioModStackReorder(window.__studioSelectedMesh().uuid, 1, 0));
  expect(r.ok).toBe(true);
  stack = await win.evaluate(() => window.__studioModStackGet(window.__studioSelectedMesh().uuid));
  expect(stack.mods[0].type).toBe('mirror');
  // Remove the second mod (pass its id through as an evaluate arg).
  const secondId = stack.mods[1].id;
  r = await win.evaluate((id) => window.__studioModStackRemove(window.__studioSelectedMesh().uuid, id), secondId);
  expect(r.ok).toBe(true);
  stack = await win.evaluate(() => window.__studioModStackGet(window.__studioSelectedMesh().uuid));
  expect(stack.mods.length).toBe(1);

  // ─── Sculpt layers ───────────────────────────────────────────────────
  let sl = await win.evaluate(() => window.__studioSculptLayerAdd('Base'));
  expect(sl.ok).toBe(true);
  expect(sl.count).toBe(1);
  await win.evaluate(() => window.__studioSculptLayerAdd('Wrinkles'));
  let list = await win.evaluate(() => window.__studioSculptLayerList());
  expect(list.length).toBe(2);
  await win.evaluate(() => window.__studioSculptLayerToggle(0));
  await win.evaluate(() => window.__studioSculptLayerStrength(1, 0.4));
  list = await win.evaluate(() => window.__studioSculptLayerList());
  expect(list[0].enabled).toBe(false);
  expect(list[1].strength).toBeCloseTo(0.4);
  await win.evaluate(() => window.__studioSculptLayerRemove(0));
  expect((await win.evaluate(() => window.__studioSculptLayerList())).length).toBe(1);

  // ─── List edges ──────────────────────────────────────────────────────
  const eds = await win.evaluate(() => window.__studioListEdges());
  expect(eds.ok).toBe(true);
  expect(eds.count).toBe(30); // cube triangulation edges

  // ─── Snap to vertex ──────────────────────────────────────────────────
  // Spawn a second cube, move it close — snap should pull it in.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let other = null;
    let count = 0;
    vp.scene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') { count++; if (count === 2) other = o; }
    });
    other.position.set(0.04, 0, 0);
    vp.transformControls.attach(other);
  });
  const snap = await win.evaluate(() => window.__studioSnapToVertex(0.05));
  expect(snap.ok).toBe(true);
  expect(snap.distance).toBeLessThan(0.05);

  // ─── Symmetrize the active mesh ──────────────────────────────────────
  const sym = await win.evaluate(() => window.__studioSymmetrize('x'));
  expect(sym.ok).toBe(true);
  // Symmetrize roughly doubles vert + tri count.
  expect(sym.vertCount).toBe(48);
  expect(sym.triCount).toBe(24);

  // ─── Merge meshes ────────────────────────────────────────────────────
  const uuids = await win.evaluate(() => {
    const out = [];
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitive) out.push(o.uuid);
    });
    return out;
  });
  expect(uuids.length).toBeGreaterThanOrEqual(2);
  const m = await win.evaluate((u) => window.__studioMergeMeshes(u.slice(0, 2)), uuids);
  expect(m.ok).toBe(true);
  expect(m.sourceCount).toBe(2);
  expect(m.vertCount).toBeGreaterThan(24);

  await win.screenshot({ path: path.join(OUT, '00-after-modops.png') });

  // Reset.
  await win.evaluate(() => {
    window.localStorage.removeItem('studioV3');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });

  // eslint-disable-next-line no-console
  console.log('  slice 404: mod stack + sculpt layers + snap + merge + symmetrize + listEdges all green');

  await app.close();
});
