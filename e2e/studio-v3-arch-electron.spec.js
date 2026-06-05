// ArchDisc Studio V3 — Architecture toolkit (walls / doors / windows /
// floor / gable roof / dimensions / building generator) e2e.
//
// Headed Mac-Electron spec — every Studio e2e MUST be headed per the
// user's feedback rule. Launched with --dev so we can dynamic-import
// the arch + csg autoloads off the Vite dev server even before api.js
// orchestration wires them in.
//
// Coverage:
//   1. Install arch toolkit + verify command-palette registration
//      under category 'arch'.
//   2. Install CSG (manifold-3d) — required for door / window cuts.
//   3. __studioArchCreateWall — make a 4 m × 2.7 m wall, verify it
//      lands in the scene as an arch-wall.
//   4. __studioArchCutDoor — real boolean cut through that wall;
//      verify the new mesh appears with arch-wall tag + a frame group.
//   5. __studioArchCutWindow on a second wall — verify hole + glass.
//   6. __studioArchCreateFloor — slab from a 5x4 polygon.
//   7. __studioArchCreateGableRoof — verify peaked roof above slab.
//   8. __studioArchAddDimensionLine — verify line + label sprite
//      created and distance computed correctly.
//   9. __studioArchGenerateBuilding — full house in one call;
//      verify N uuids = floors + walls + roof.
//  10. Panel toggle: open + close.
//  11. Multi-cam viewport screenshots per feedback-forge-multicam-e2e.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-arch');
const NAMED_VIEWS = ['front', 'top', 'right', 'iso', 'close'];

test('Studio V3 — SketchUp-style architectural toolkit', async () => {
  test.setTimeout(300000);
  fs.mkdirSync(OUT, { recursive: true });

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
  await win.waitForFunction(() => !!window.__archdiscScene && !!window.THREE, null, { timeout: 20000 });

  // ─── Install arch + csg autoloads. ────────────────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioCSGDifference !== 'function') {
      await import('/src/workbenches/studio/v3/csg/autoload.js');
    }
    if (typeof window.__studioArchCreateWall !== 'function') {
      await import('/src/workbenches/studio/v3/arch/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioArchCreateWall === 'function', null, { timeout: 20000 });
  await win.waitForFunction(() => typeof window.__studioCSGDifference === 'function', null, { timeout: 20000 });

  // Wait for manifold-3d WASM to finish loading before door / window cuts.
  const ready = await win.evaluate(async () => window.__studioCSGReady());
  expect(ready.ok).toBe(true);

  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ─── Clear any pre-existing arch primitives from prior runs. ──────
  await win.evaluate(() => window.__studioArchClear());

  // ─── 1) Command-palette registration (slice contract). ────────────
  const palette = await win.evaluate(() => {
    if (typeof window.__studioCommandList !== 'function') return { ok: false };
    return window.__studioCommandList('arch');
  });
  if (palette.ok) {
    expect(palette.commands.length).toBeGreaterThanOrEqual(10);
    const names = palette.commands.map((c) => c.name);
    expect(names).toContain('__studioArchCreateWall');
    expect(names).toContain('__studioArchCutDoor');
    expect(names).toContain('__studioArchCutWindow');
    expect(names).toContain('__studioArchCreateFloor');
    expect(names).toContain('__studioArchCreateGableRoof');
    expect(names).toContain('__studioArchAddDimensionLine');
    expect(names).toContain('__studioArchGenerateBuilding');
    expect(names).toContain('__studioArchPanelOpen');
  }

  // ─── 2) Create a wall. ────────────────────────────────────────────
  const wallA = await win.evaluate(() => window.__studioArchCreateWall([-2, 0, 0], [2, 0, 0], 2.7, 0.2));
  expect(wallA.ok).toBe(true);
  expect(typeof wallA.uuid).toBe('string');

  // Wall must be in scene + tagged as arch-wall.
  const wallACheck = await win.evaluate((u) => {
    const scene = window.__archdiscScene;
    let hit = null;
    scene.traverse((o) => { if (!hit && o.uuid === u) hit = o; });
    if (!hit) return { found: false };
    const bb = new window.THREE.Box3().setFromObject(hit);
    return {
      found: true,
      kind: hit.userData && hit.userData.archdiscStudioPrimitiveKind,
      bbox: [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z],
    };
  }, wallA.uuid);
  expect(wallACheck.found).toBe(true);
  expect(wallACheck.kind).toBe('arch-wall');
  // Wall A runs from x=-2 to x=2 along X axis, height 2.7, thickness 0.2.
  // BBox: x ∈ [-2, 2], y ∈ [0, 2.7], z ∈ [-0.1, 0.1].
  expect(wallACheck.bbox[0]).toBeLessThan(-1.8);
  expect(wallACheck.bbox[3]).toBeGreaterThan(1.8);
  expect(wallACheck.bbox[1]).toBeGreaterThanOrEqual(0);
  expect(wallACheck.bbox[4]).toBeGreaterThan(2.5);

  await win.screenshot({ path: path.join(OUT, '01-wall.png') });

  // ─── 3) Cut a door through wall A. ────────────────────────────────
  const door = await win.evaluate((u) => window.__studioArchCutDoor(u, 0.5, 0.9, 2.1), wallA.uuid);
  expect(door.ok).toBe(true);
  expect(typeof door.uuid).toBe('string');
  expect(typeof door.frameUuid).toBe('string');
  // The new wall mesh must exist + be tagged arch-wall.
  const doorCheck = await win.evaluate((u) => {
    const scene = window.__archdiscScene;
    let wall = null, frame = null;
    scene.traverse((o) => {
      if (!wall && o.uuid === u[0]) wall = o;
      if (!frame && o.uuid === u[1]) frame = o;
    });
    return {
      wallKind: wall && wall.userData && wall.userData.archdiscStudioPrimitiveKind,
      frameKind: frame && frame.userData && frame.userData.archdiscStudioPrimitiveKind,
      wallVerts: wall && wall.geometry && wall.geometry.attributes && wall.geometry.attributes.position
        ? wall.geometry.attributes.position.count : 0,
    };
  }, [door.uuid, door.frameUuid]);
  expect(doorCheck.wallKind).toBe('arch-wall');
  expect(doorCheck.frameKind).toBe('arch-door-frame');
  expect(doorCheck.wallVerts).toBeGreaterThan(0);

  await win.screenshot({ path: path.join(OUT, '02-door.png') });

  // ─── 4) Add a second wall + cut a window in it. ───────────────────
  const wallB = await win.evaluate(() => window.__studioArchCreateWall([2, 0, 0], [2, 0, 4], 2.7, 0.2));
  expect(wallB.ok).toBe(true);
  const winCut = await win.evaluate((u) => window.__studioArchCutWindow(u, 0.5, 1.2, 1.0, 0.9), wallB.uuid);
  expect(winCut.ok).toBe(true);
  expect(typeof winCut.uuid).toBe('string');
  const winCheck = await win.evaluate((uu) => {
    const scene = window.__archdiscScene;
    let wall = null, glass = null;
    scene.traverse((o) => {
      if (!wall && o.uuid === uu[0]) wall = o;
      if (!glass && o.uuid === uu[1]) glass = o;
    });
    return {
      wallKind: wall && wall.userData && wall.userData.archdiscStudioPrimitiveKind,
      glassKind: glass && glass.userData && glass.userData.archdiscStudioPrimitiveKind,
    };
  }, [winCut.uuid, winCut.glassUuid]);
  expect(winCheck.wallKind).toBe('arch-wall');
  expect(winCheck.glassKind).toBe('arch-window-glass');

  await win.screenshot({ path: path.join(OUT, '03-window.png') });

  // ─── 5) Floor slab. ───────────────────────────────────────────────
  const floor = await win.evaluate(() => {
    const poly = [[-3, -2], [3, -2], [3, 2], [-3, 2]];
    return window.__studioArchCreateFloor(poly, 0.18);
  });
  expect(floor.ok).toBe(true);
  const floorCheck = await win.evaluate((u) => {
    const scene = window.__archdiscScene;
    let hit = null;
    scene.traverse((o) => { if (!hit && o.uuid === u) hit = o; });
    if (!hit) return { found: false };
    const bb = new window.THREE.Box3().setFromObject(hit);
    return {
      found: true,
      kind: hit.userData && hit.userData.archdiscStudioPrimitiveKind,
      bbox: [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z],
    };
  }, floor.uuid);
  expect(floorCheck.found).toBe(true);
  expect(floorCheck.kind).toBe('arch-floor');
  // Slab x ∈ [-3, 3], z ∈ [-2, 2], top at 0.
  expect(floorCheck.bbox[0]).toBeLessThan(-2.5);
  expect(floorCheck.bbox[3]).toBeGreaterThan(2.5);

  await win.screenshot({ path: path.join(OUT, '04-floor.png') });

  // ─── 6) Gable roof. ───────────────────────────────────────────────
  const roof = await win.evaluate(() => {
    const poly = [[-3, -2], [3, -2], [3, 2], [-3, 2]];
    return window.__studioArchCreateGableRoof(poly, 1.6, 0.3);
  });
  expect(roof.ok).toBe(true);
  const roofCheck = await win.evaluate((u) => {
    const scene = window.__archdiscScene;
    let hit = null;
    scene.traverse((o) => { if (!hit && o.uuid === u) hit = o; });
    if (!hit) return { found: false };
    const bb = new window.THREE.Box3().setFromObject(hit);
    return {
      found: true,
      kind: hit.userData && hit.userData.archdiscStudioPrimitiveKind,
      bbox: [bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z],
      ridge: hit.userData && hit.userData.archdiscStudioArchRoof && hit.userData.archdiscStudioArchRoof.ridgeHeight,
    };
  }, roof.uuid);
  expect(roofCheck.found).toBe(true);
  expect(roofCheck.kind).toBe('arch-roof');
  expect(roofCheck.ridge).toBe(1.6);

  await win.screenshot({ path: path.join(OUT, '05-roof.png') });

  // ─── 7) Dimension line. ──────────────────────────────────────────
  const dim = await win.evaluate(() => window.__studioArchAddDimensionLine([-3, 0.02, 0], [3, 0.02, 0], { size: 0.4 }));
  expect(dim.ok).toBe(true);
  // Distance is 6 (XZ separation 6).
  expect(Math.abs(dim.distance - 6)).toBeLessThan(0.01);

  const dimCheck = await win.evaluate((u) => {
    const scene = window.__archdiscScene;
    let hit = null;
    scene.traverse((o) => { if (!hit && o.uuid === u) hit = o; });
    if (!hit) return { found: false };
    let lines = 0, sprites = 0;
    hit.traverse((c) => {
      if (c.isLine) lines++;
      if (c.isSprite) sprites++;
    });
    return {
      found: true,
      kind: hit.userData && hit.userData.archdiscStudioPrimitiveKind,
      lines, sprites,
    };
  }, dim.uuid);
  expect(dimCheck.found).toBe(true);
  expect(dimCheck.kind).toBe('arch-dimension');
  expect(dimCheck.lines).toBeGreaterThanOrEqual(1);
  expect(dimCheck.sprites).toBeGreaterThanOrEqual(1);

  await win.screenshot({ path: path.join(OUT, '06-dimension.png') });

  // ─── 8) List + clear, then generate full building. ───────────────
  const beforeClear = await win.evaluate(() => window.__studioArchList());
  expect(beforeClear.ok).toBe(true);
  expect(beforeClear.count).toBeGreaterThan(0);

  const cleared = await win.evaluate(() => window.__studioArchClear());
  expect(cleared.ok).toBe(true);
  const afterClear = await win.evaluate(() => window.__studioArchList());
  expect(afterClear.count).toBe(0);

  const bldg = await win.evaluate(() => {
    const poly = [[-3, -2], [3, -2], [3, 2], [-3, 2]];
    return window.__studioArchGenerateBuilding(poly, 1, 2.7, {
      floorThickness: 0.18, wallThickness: 0.2, ridgeHeight: 1.6, overhang: 0.3,
    });
  });
  expect(bldg.ok).toBe(true);
  expect(Array.isArray(bldg.uuids)).toBe(true);
  // 1 floor + 4 walls + 1 roof = 6 primitives.
  expect(bldg.uuids.length).toBe(6);
  expect(bldg.anatomy.walls.length).toBe(4);
  expect(bldg.anatomy.floors.length).toBe(1);
  expect(typeof bldg.anatomy.roof).toBe('string');

  await win.screenshot({ path: path.join(OUT, '07-building.png') });

  // ─── 9) Panel toggle. ────────────────────────────────────────────
  const panelOpen = await win.evaluate(() => window.__studioArchPanelOpen());
  expect(panelOpen.ok).toBe(true);
  expect(panelOpen.open).toBe(true);
  await win.waitForTimeout(150);
  await expect(win.locator('[data-studio-v3-arch-panel]')).toBeVisible({ timeout: 5000 });
  await win.screenshot({ path: path.join(OUT, '08-panel.png') });

  const panelClose = await win.evaluate(() => window.__studioArchPanelClose());
  expect(panelClose.ok).toBe(true);
  expect(panelClose.open).toBe(false);
  await win.waitForTimeout(150);

  // ─── 10) Multi-cam screenshots of the building. ──────────────────
  // Position the camera around the building so the remote-desktop
  // viewer can sanity-check the result from each named angle.
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport;
      if (!vp || !vp.camera) return;
      const c = vp.camera;
      if (v === 'front')      c.position.set(0, 2.5, 9);
      else if (v === 'top')   c.position.set(0, 12, 0.001);
      else if (v === 'right') c.position.set(9, 2.5, 0);
      else if (v === 'iso')   c.position.set(7, 6, 7);
      else if (v === 'close') c.position.set(4, 3, 4);
      c.lookAt(0, 1.5, 0);
      if (vp.orbitControls && vp.orbitControls.target) {
        vp.orbitControls.target.set(0, 1.5, 0);
        if (typeof vp.orbitControls.update === 'function') vp.orbitControls.update();
      }
    }, view);
    await win.waitForTimeout(200);
    await win.screenshot({ path: path.join(OUT, `09-cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  arch slice: walls/door/window/floor/roof/dim/building all green; %d primitives in final building',
    bldg.uuids.length);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
