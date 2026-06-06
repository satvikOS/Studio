// ArchDisc Studio V3 — tangent-space multires detail e2e (slice 735).
//
// Headed Mac-Electron spec. Slice 733 shipped multires with OBJECT-space
// detail (honest limitation noted: large low-level rotations shear the
// detail off the surface). Slice 735 stores detail in TANGENT space
// (coefficients along the smooth surface's normal/tangent/bitangent), so
// when a LOWER level rotates or deforms, the high-frequency detail RIDES
// the surface — the Mudbox/ZBrush/Blender Multires behaviour.
//
// Proof: sculpt a bump along the surface normal at level 2, bake (stored
// in tangent space), then ROTATE the base (level 0) 90° about Y, bake,
// step back to level 2. The bump's surface normal must align with the
// rotated-original normal (dot ≈ 1) — i.e. the bump rotated WITH the
// surface instead of staying frozen in object space.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-tsmultires');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — tangent-space multires detail (rides surface rotation)', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 140,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  let shellUp = false;
  for (let attempt = 0; attempt < 3 && !shellUp; attempt++) {
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    try {
      await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 25000 });
      shellUp = true;
    } catch (_) { /* retry */ }
  }
  expect(shellUp).toBe(true);
  await win.waitForFunction(() => !!window.__archdiscScene && !!window.THREE, null, { timeout: 30000 });

  await win.evaluate(async () => {
    if (typeof window.__studioMultiresInit !== 'function') {
      await import('/src/workbenches/studio/v3/subdiv/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioMultiresInit === 'function',
    null, { timeout: 20000 });

  await win.evaluate(() => { if (window.__studioClearScene) window.__studioClearScene(); });

  // Spawn an icosahedron and select it.
  const made = await win.evaluate(() => {
    const THREE = window.THREE;
    const scene = window.__archdiscScene;
    const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(0.03, 0),
      new THREE.MeshStandardMaterial({ color: 0xaab4c0 }));
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'icosahedron';
    scene.add(mesh);
    if (window.__studioSelectMesh) window.__studioSelectMesh(mesh);
    return { uuid: mesh.uuid };
  });
  const UUID = made.uuid;
  expect(UUID).toBeTruthy();
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '00-base.png') });

  // Init + subdivide twice.
  expect((await win.evaluate((u) => window.__studioMultiresInit(u), UUID)).ok).toBe(true);
  expect((await win.evaluate((u) => window.__studioMultiresSubdivide(u), UUID)).level).toBe(1);
  expect((await win.evaluate((u) => window.__studioMultiresSubdivide(u), UUID)).level).toBe(2);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '01-subdivided.png') });

  // Sculpt a bump along the surface normal at vertex 5, then bake.
  const baked = await win.evaluate((u) => {
    const scene = window.__archdiscScene;
    let mesh = null; scene.traverse((o) => { if (o.uuid === u) mesh = o; });
    const g = mesh.geometry; g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal;
    const i = 5;
    const nb = [n.getX(i), n.getY(i), n.getZ(i)];
    p.setXYZ(i, p.getX(i) + nb[0] * 0.008, p.getY(i) + nb[1] * 0.008, p.getZ(i) + nb[2] * 0.008);
    p.needsUpdate = true;
    return { nb };
  }, UUID);
  const bake = await win.evaluate((u) => window.__studioMultiresBake(u), UUID);
  expect(bake.ok).toBe(true);
  expect(bake.space).toBe('tangent'); // detail stored in tangent space
  expect(bake.maxDisplacement).toBeGreaterThan(0.001);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '02-bumped.png') });

  // Rotate the BASE (level 0) 90° about Y, bake, step back to level 2.
  expect((await win.evaluate((u) => window.__studioMultiresSetLevel(u, 0), UUID)).level).toBe(0);
  await win.evaluate((u) => {
    const THREE = window.THREE;
    const scene = window.__archdiscScene;
    let mesh = null; scene.traverse((o) => { if (o.uuid === u) mesh = o; });
    const p = mesh.geometry.attributes.position;
    const m = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    for (let k = 0; k < p.count; k++) {
      const v = new THREE.Vector3(p.getX(k), p.getY(k), p.getZ(k)).applyMatrix4(m);
      p.setXYZ(k, v.x, v.y, v.z);
    }
    p.needsUpdate = true;
  }, UUID);
  expect((await win.evaluate((u) => window.__studioMultiresBake(u), UUID)).ok).toBe(true);
  expect((await win.evaluate((u) => window.__studioMultiresSetLevel(u, 2), UUID)).level).toBe(2);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '03-rotated-up.png') });

  // The bump must have RIDDEN the rotation: the surface normal at v5 now
  // aligns with the rotated-original normal (dot ≈ 1).
  const dot = await win.evaluate((args) => {
    const THREE = window.THREE;
    const scene = window.__archdiscScene;
    let mesh = null; scene.traverse((o) => { if (o.uuid === args.u) mesh = o; });
    const g = mesh.geometry; g.computeVertexNormals();
    const n = g.attributes.normal; const i = 5;
    const m = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    const origRot = new THREE.Vector3(args.nb[0], args.nb[1], args.nb[2]).applyMatrix4(m).normalize();
    const cur = new THREE.Vector3(n.getX(i), n.getY(i), n.getZ(i)).normalize();
    return origRot.dot(cur);
  }, { u: UUID, nb: baked.nb });
  console.log('[ts-multires] surface-normal dot after rotation =', dot);
  expect(dot).toBeGreaterThan(0.9); // detail rode the surface rotation

  // Global search surfaces the multires ops.
  const search = await win.evaluate(() => window.__studioCommandSearch('multires', 40));
  expect(search.hits.map((h) => h.name)).toContain('__studioMultiresBake');

  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 735: tangent-space multires — bump rode 90° base rotation, normal dot =', dot.toFixed(3));

  await app.close();
});
