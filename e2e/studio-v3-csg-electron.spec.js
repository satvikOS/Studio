// ArchDisc Studio V3 — real CSG (manifold-3d) e2e.
//
// Headed Mac-Electron spec. Mirrors the user feedback rule that every
// Studio e2e MUST be headed Mac-Electron at watchable pace (the user is
// remote and watches the spec play out).
//
// Exercises the new __studioCSG* surface:
//   • union       — combined surface
//   • difference  — A minus B
//   • intersect   — overlap only
//
// For each op we:
//   • build TWO cubes at known positions/sizes inside __archdiscScene
//   • call window.__studioCSG{Union,Difference,Intersect}(uuidA, uuidB)
//   • assert: ok, new mesh in scene, userData.archdiscStudioPrimitiveKind
//             === 'csg-result', inputs left in place, result vert count
//             differs from either input, and the result bounding box
//             matches the expected union / difference / intersect bounds.
//
// Camera sweep follows the user's "≥5 named camera angles" rule from
// feedback-forge-multicam-e2e.md so the spec's screenshots are useful
// for remote-desktop verification.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-csg');
const NAMED_VIEWS = ['front', 'top', 'right', 'iso', 'close'];

test('Studio V3 — real CSG union/difference/intersect via manifold-3d', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  // Launch with --dev so Electron loads from the Vite dev server (port
  // 3000) and we can dynamic-import the csg autoload module by URL even
  // when api.js orchestration hasn't been wired yet. Mirrors the
  // pattern used by the geomnodes / shader specs.
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 220,
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
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 20000 });
  await win.waitForFunction(() => typeof window.__studioSelectedMesh === 'function', null, { timeout: 20000 });
  await win.waitForFunction(() => !!window.__archdiscScene && !!window.THREE, null, { timeout: 20000 });

  // ─── Ensure the CSG module is installed. Either api.js has wired
  // `import('./csg/autoload.js')` (preferred) or we install ourselves
  // via the autoload entry on the dev server. ──────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioCSGUnion !== 'function') {
      await import('/src/workbenches/studio/v3/csg/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioCSGUnion === 'function', null, { timeout: 20000 });

  // ─── Wait for manifold-3d WASM to finish loading. ────────────────
  const ready = await win.evaluate(async () => {
    const r = await window.__studioCSGReady();
    return r;
  });
  expect(ready.ok).toBe(true);

  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ─── Helper: seed two unit cubes at known positions. ─────────────
  //
  // Cube A: centered at the origin, side 1 → AABB [-0.5, 0.5]^3
  // Cube B: centered at (0.5, 0, 0), side 1 → AABB [0, 1] × [-0.5, 0.5]^2
  //   → union     bounds: x ∈ [-0.5, 1],  y, z ∈ [-0.5, 0.5]
  //   → difference bounds: x ∈ [-0.5, 0],  y, z ∈ [-0.5, 0.5]
  //                  (B carves the right half of A away — but only the
  //                  carve region is removed; A's left half stays)
  //   → intersect bounds: x ∈ [0,    0.5], y, z ∈ [-0.5, 0.5]
  //
  // Sizes are 1 m so the cubes dominate the viewport (per the user's
  // "scale to viewer" feedback) and so the bounds assertions are wide
  // tolerance.

  const seed = await win.evaluate(() => {
    const THREE = window.THREE;
    const scene = window.__archdiscScene;
    if (!scene || !THREE) return { ok: false };

    // Clear any previously-spawned Studio primitives so the bounds
    // assertions are unambiguous.
    const stale = [];
    scene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitive) stale.push(o);
    });
    for (const o of stale) {
      if (o.geometry && o.geometry.dispose) o.geometry.dispose();
      if (o.material && o.material.dispose) o.material.dispose();
      (o.parent || scene).remove(o);
    }

    const make = (cx, cy, cz, name) => {
      const g = new THREE.BoxGeometry(1, 1, 1);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x6699cc, roughness: 0.6 }));
      m.position.set(cx, cy, cz);
      m.name = name;
      m.userData = { archdiscStudioPrimitive: true, archdiscStudioPrimitiveKind: 'csg-input' };
      m.updateMatrixWorld(true);
      scene.add(m);
      return m;
    };

    const a = make(0,   0, 0, 'csg-input-A');
    const b = make(0.5, 0, 0, 'csg-input-B');
    return {
      ok: true,
      uuidA: a.uuid, uuidB: b.uuid,
      vertsA: a.geometry.attributes.position.count,
      vertsB: b.geometry.attributes.position.count,
    };
  });
  expect(seed.ok).toBe(true);
  expect(typeof seed.uuidA).toBe('string');
  expect(typeof seed.uuidB).toBe('string');
  expect(seed.vertsA).toBeGreaterThan(0);
  expect(seed.vertsB).toBeGreaterThan(0);

  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '01-seeded.png') });

  // ─── Helper: compute the bounding box of a mesh by uuid. ─────────
  const bboxOf = async (uuid) => win.evaluate((u) => {
    const THREE = window.THREE;
    const scene = window.__archdiscScene;
    let hit = null;
    scene.traverse((o) => { if (!hit && o.uuid === u) hit = o; });
    if (!hit) return null;
    hit.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(hit);
    return {
      min: [bb.min.x, bb.min.y, bb.min.z],
      max: [bb.max.x, bb.max.y, bb.max.z],
      verts: hit.geometry && hit.geometry.attributes && hit.geometry.attributes.position
        ? hit.geometry.attributes.position.count : 0,
      name: hit.name,
      kind: hit.userData && hit.userData.archdiscStudioPrimitiveKind,
      op: hit.userData && hit.userData.archdiscStudioCsgOp,
    };
  }, uuid);

  const within = (got, exp, tol = 0.05) => Math.abs(got - exp) <= tol;
  const boxApprox = (b, mn, mx, tol = 0.05) => (
    within(b.min[0], mn[0], tol) && within(b.min[1], mn[1], tol) && within(b.min[2], mn[2], tol) &&
    within(b.max[0], mx[0], tol) && within(b.max[1], mx[1], tol) && within(b.max[2], mx[2], tol)
  );

  // ─── 1) UNION ────────────────────────────────────────────────────
  const rUnion = await win.evaluate(({ a, b }) => window.__studioCSGUnion(a, b), { a: seed.uuidA, b: seed.uuidB });
  expect(rUnion.ok).toBe(true);
  expect(rUnion.op).toBe('union');
  expect(typeof rUnion.uuid).toBe('string');
  expect(rUnion.verts).toBeGreaterThan(0);
  // Result mesh must differ in vertex count from either pristine input
  // (a 1×1×1 box has 24 verts non-indexed; manifold returns an indexed
  // mesh with fewer unique vertices). The point is that we are NOT
  // simply echoing one of the inputs.
  expect(rUnion.verts).not.toBe(seed.vertsA);
  expect(rUnion.verts).not.toBe(seed.vertsB);

  const bUnion = await bboxOf(rUnion.uuid);
  expect(bUnion).not.toBeNull();
  expect(bUnion.kind).toBe('csg-result');
  expect(bUnion.op).toBe('union');
  // Union bounds: x ∈ [-0.5, 1], y/z ∈ [-0.5, 0.5]
  expect(boxApprox(bUnion, [-0.5, -0.5, -0.5], [1.0, 0.5, 0.5])).toBe(true);

  // Inputs still present.
  const stillThereAfterUnion = await win.evaluate(({ a, b }) => {
    const scene = window.__archdiscScene;
    let foundA = false, foundB = false;
    scene.traverse((o) => { if (o.uuid === a) foundA = true; if (o.uuid === b) foundB = true; });
    return { foundA, foundB };
  }, { a: seed.uuidA, b: seed.uuidB });
  expect(stillThereAfterUnion.foundA).toBe(true);
  expect(stillThereAfterUnion.foundB).toBe(true);

  await win.waitForTimeout(120);
  await win.screenshot({ path: path.join(OUT, '02-union.png') });

  // Hide the union result before the next op so the scene is uncluttered.
  await win.evaluate((u) => {
    const scene = window.__archdiscScene;
    scene.traverse((o) => { if (o.uuid === u) o.visible = false; });
  }, rUnion.uuid);

  // ─── 2) DIFFERENCE (A − B) ───────────────────────────────────────
  const rDiff = await win.evaluate(({ a, b }) => window.__studioCSGDifference(a, b), { a: seed.uuidA, b: seed.uuidB });
  expect(rDiff.ok).toBe(true);
  expect(rDiff.op).toBe('difference');
  expect(typeof rDiff.uuid).toBe('string');
  expect(rDiff.verts).toBeGreaterThan(0);
  expect(rDiff.verts).not.toBe(seed.vertsA);
  expect(rDiff.verts).not.toBe(seed.vertsB);
  // Result must differ from the union too — sanity check that the op
  // really branched correctly through manifold-3d.
  expect(rDiff.verts).not.toBe(rUnion.verts);

  const bDiff = await bboxOf(rDiff.uuid);
  expect(bDiff).not.toBeNull();
  expect(bDiff.kind).toBe('csg-result');
  expect(bDiff.op).toBe('difference');
  // Difference bounds: x ∈ [-0.5, 0], y/z ∈ [-0.5, 0.5]
  expect(boxApprox(bDiff, [-0.5, -0.5, -0.5], [0.0, 0.5, 0.5])).toBe(true);

  await win.waitForTimeout(120);
  await win.screenshot({ path: path.join(OUT, '03-difference.png') });

  await win.evaluate((u) => {
    const scene = window.__archdiscScene;
    scene.traverse((o) => { if (o.uuid === u) o.visible = false; });
  }, rDiff.uuid);

  // ─── 3) INTERSECT ────────────────────────────────────────────────
  const rInt = await win.evaluate(({ a, b }) => window.__studioCSGIntersect(a, b), { a: seed.uuidA, b: seed.uuidB });
  expect(rInt.ok).toBe(true);
  expect(rInt.op).toBe('intersect');
  expect(typeof rInt.uuid).toBe('string');
  expect(rInt.verts).toBeGreaterThan(0);

  const bInt = await bboxOf(rInt.uuid);
  expect(bInt).not.toBeNull();
  expect(bInt.kind).toBe('csg-result');
  expect(bInt.op).toBe('intersect');
  // Intersect bounds: x ∈ [0, 0.5], y/z ∈ [-0.5, 0.5]
  expect(boxApprox(bInt, [0.0, -0.5, -0.5], [0.5, 0.5, 0.5])).toBe(true);

  await win.waitForTimeout(120);
  await win.screenshot({ path: path.join(OUT, '04-intersect.png') });

  // ─── Command-palette registration. ───────────────────────────────
  const palette = await win.evaluate(() => {
    if (typeof window.__studioCommandList !== 'function') return { ok: false };
    return window.__studioCommandList('csg');
  });
  if (palette.ok) {
    expect(palette.commands.length).toBeGreaterThanOrEqual(5);
    const names = palette.commands.map((c) => c.name);
    expect(names).toContain('__studioCSGUnion');
    expect(names).toContain('__studioCSGDifference');
    expect(names).toContain('__studioCSGIntersect');
    expect(names).toContain('__studioCSGReady');
    expect(names).toContain('__studioCSGListAvailable');
  }

  // ─── ListAvailable should see the inputs + (now hidden) results. ─
  const listing = await win.evaluate(() => window.__studioCSGListAvailable());
  expect(listing.ok).toBe(true);
  // 2 inputs + 3 results
  expect(listing.count).toBeGreaterThanOrEqual(5);

  // ─── Multi-cam viewport screenshots. ─────────────────────────────
  // Re-show every result so the camera sweep captures all three at once.
  await win.evaluate(({ uu, du, iu }) => {
    const scene = window.__archdiscScene;
    scene.traverse((o) => {
      if (o.uuid === uu || o.uuid === du || o.uuid === iu) o.visible = true;
    });
  }, { uu: rUnion.uuid, du: rDiff.uuid, iu: rInt.uuid });

  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport;
      if (!vp || !vp.camera) return;
      const c = vp.camera;
      if (v === 'front')      c.position.set(0, 0, 3);
      else if (v === 'top')   c.position.set(0, 3, 0.001);
      else if (v === 'right') c.position.set(3, 0, 0);
      else if (v === 'iso')   c.position.set(2, 2, 2);
      else if (v === 'close') c.position.set(1.2, 1.2, 1.2);
      c.lookAt(0, 0, 0);
      if (vp.orbitControls && vp.orbitControls.target) {
        vp.orbitControls.target.set(0, 0, 0);
        if (typeof vp.orbitControls.update === 'function') vp.orbitControls.update();
      }
    }, view);
    await win.waitForTimeout(180);
    await win.screenshot({ path: path.join(OUT, `05-cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  csg slice: union verts=%d, diff verts=%d, intersect verts=%d',
    rUnion.verts, rDiff.verts, rInt.verts);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
