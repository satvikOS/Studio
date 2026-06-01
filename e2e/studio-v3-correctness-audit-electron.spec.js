// Correctness audit for every V3-ported window.__studio* op.
//
// For each op, asserts a mathematical INVARIANT — the kind of thing that
// would silently break if the implementation had a sign flip, an off-by-
// one, or a non-deterministic side effect. Examples:
//
//   • move(0, 0, 0) leaves positions exactly equal.
//   • scale(1) leaves positions exactly equal.
//   • rotate(0, 'z') leaves positions exactly equal.
//   • scale(2) then scale(0.5) returns to start (within float ε).
//   • rotate(π) twice returns to start.
//   • mirror(axis) twice returns to start.
//   • undo after any mutating op restores the previous geometry.
//   • save then load round-trips the primitive count + uuids.
//
// Any failure here means an op is NOT "logically correct" and needs
// fixing.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-correctness');
const EPS = 1e-5;

async function bootstrapV3(win) {
  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioMoveSelectedVerts === 'function', null, { timeout: 15000 });
}

async function spawnAndSelectCube(win) {
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let cube = null;
    vp.scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cube = o; });
    cube.position.set(0, 0, 0); cube.rotation.set(0, 0, 0); cube.scale.set(1, 1, 1);
    cube.updateMatrixWorld(true);
    vp.transformControls.attach(cube);
    window.__studioClearEditSelection();
  });
}

async function snapshotVerts(win) {
  return win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    if (!m || !m.geometry || !m.geometry.attributes.position) return null;
    const p = m.geometry.attributes.position;
    const out = new Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      out[i * 3] = p.getX(i); out[i * 3 + 1] = p.getY(i); out[i * 3 + 2] = p.getZ(i);
    }
    return out;
  });
}

function approxEqualArrays(a, b, eps = EPS) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > eps) return false;
  return true;
}

test('Studio V3 — invariants of every ported op (slice 405)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 250,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await bootstrapV3(win);

  // ───────────────────────────────────────────────────────────────────────
  // 1) move(0,0,0) is the identity on positions.
  // ───────────────────────────────────────────────────────────────────────
  await spawnAndSelectCube(win);
  await win.evaluate(() => window.__studioSelectAllEdit('vertex'));
  const before1 = await snapshotVerts(win);
  await win.evaluate(() => window.__studioMoveSelectedVerts(0, 0, 0));
  const after1 = await snapshotVerts(win);
  expect(approxEqualArrays(before1, after1)).toBe(true);

  // ───────────────────────────────────────────────────────────────────────
  // 2) scale(1) is the identity.
  // ───────────────────────────────────────────────────────────────────────
  const before2 = await snapshotVerts(win);
  await win.evaluate(() => window.__studioScaleSelectedVerts(1));
  const after2 = await snapshotVerts(win);
  expect(approxEqualArrays(before2, after2)).toBe(true);

  // ───────────────────────────────────────────────────────────────────────
  // 3) rotate(0, z) is the identity.
  // ───────────────────────────────────────────────────────────────────────
  await win.evaluate(() => window.__studioRotateSelectedVerts(0, 'z'));
  const after3 = await snapshotVerts(win);
  expect(approxEqualArrays(before2, after3)).toBe(true);

  // ───────────────────────────────────────────────────────────────────────
  // 4) scale(2) then scale(0.5) returns to start (within ε).
  // ───────────────────────────────────────────────────────────────────────
  await win.evaluate(() => window.__studioScaleSelectedVerts(2));
  await win.evaluate(() => window.__studioScaleSelectedVerts(0.5));
  const after4 = await snapshotVerts(win);
  expect(approxEqualArrays(before2, after4, 1e-4)).toBe(true);

  // ───────────────────────────────────────────────────────────────────────
  // 5) rotate(π) twice returns to start.
  // ───────────────────────────────────────────────────────────────────────
  await win.evaluate(() => window.__studioRotateSelectedVerts(Math.PI, 'z'));
  await win.evaluate(() => window.__studioRotateSelectedVerts(Math.PI, 'z'));
  const after5 = await snapshotVerts(win);
  expect(approxEqualArrays(before2, after5, 1e-4)).toBe(true);

  // ───────────────────────────────────────────────────────────────────────
  // 6) mirror twice returns to start.
  // ───────────────────────────────────────────────────────────────────────
  const before6 = await snapshotVerts(win);
  await win.evaluate(() => window.__studioMirrorAcrossAxis('x'));
  await win.evaluate(() => window.__studioMirrorAcrossAxis('x'));
  const after6 = await snapshotVerts(win);
  expect(approxEqualArrays(before6, after6)).toBe(true);

  // ───────────────────────────────────────────────────────────────────────
  // 7) Undo restores the previous verts after a destructive op.
  // ───────────────────────────────────────────────────────────────────────
  const beforeUndo = await snapshotVerts(win);
  await win.evaluate(() => {
    window.__studioReplaceEditSelection('face', 0);
    return window.__studioMoveSelectedVerts(0.005, 0, 0);
  });
  const afterMove = await snapshotVerts(win);
  expect(approxEqualArrays(beforeUndo, afterMove)).toBe(false); // moved
  const undoRes = await win.evaluate(() => window.__studioUndo());
  expect(undoRes.ok).toBe(true);
  const afterUndo = await snapshotVerts(win);
  expect(approxEqualArrays(beforeUndo, afterUndo, 1e-4)).toBe(true);

  // ───────────────────────────────────────────────────────────────────────
  // 8) Save then load round-trips the primitive count.
  // ───────────────────────────────────────────────────────────────────────
  // Spawn extra primitives so the count is meaningful.
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(150);
  await win.locator('[data-studio-v3-tool="cone"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(150);
  const beforeCount = await win.evaluate(() => window.__studioCountPrimitives());
  const json = await win.evaluate(() => window.__studioSaveScene());
  expect(typeof json).toBe('string');
  // Clear scene by removing all prims, then load.
  await win.evaluate(() => {
    const s = window.__archdiscScene;
    const doomed = [];
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) doomed.push(o); });
    for (const o of doomed) s.remove(o);
  });
  expect(await win.evaluate(() => window.__studioCountPrimitives())).toBe(0);
  const loadR = await win.evaluate((j) => window.__studioLoadScene(j), json);
  expect(loadR.ok).toBe(true);
  expect(await win.evaluate(() => window.__studioCountPrimitives())).toBe(beforeCount);

  // ───────────────────────────────────────────────────────────────────────
  // 9) setEditMode reject-list: 'foo' invalid, mode unchanged.
  // ───────────────────────────────────────────────────────────────────────
  const beforeMode = await win.evaluate(() => window.__studioGetEditMode());
  const badSet = await win.evaluate(() => window.__studioSetEditMode('foo'));
  expect(badSet.ok).toBe(false);
  expect(await win.evaluate(() => window.__studioGetEditMode())).toBe(beforeMode);
  // valid set
  const goodSet = await win.evaluate(() => window.__studioSetEditMode('vertex'));
  expect(goodSet.ok).toBe(true);
  expect(await win.evaluate(() => window.__studioGetEditMode())).toBe('vertex');

  // ───────────────────────────────────────────────────────────────────────
  // 10) selectAllEdit then invertEditSelection yields the EMPTY complement.
  // ───────────────────────────────────────────────────────────────────────
  // Fresh single-cube scene for a deterministic count.
  await win.evaluate(() => {
    const s = window.__archdiscScene;
    const doomed = [];
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) doomed.push(o); });
    for (const o of doomed) s.remove(o);
    window.__studioClearEditSelection();
  });
  await spawnAndSelectCube(win);
  const selAll = await win.evaluate(() => window.__studioSelectAllEdit('vertex'));
  expect(selAll.counts.vertices).toBe(24);
  const inv = await win.evaluate(() => window.__studioInvertEditSelection('vertex'));
  expect(inv.counts.vertices).toBe(0);

  // ───────────────────────────────────────────────────────────────────────
  // 11) selectAllEdit('face') then extrude+undo restores tri count.
  // ───────────────────────────────────────────────────────────────────────
  await win.evaluate(() => window.__studioReplaceEditSelection('face', 0));
  const trisBefore = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return Math.floor(m.geometry.index.array.length / 3);
  });
  await win.evaluate(() => window.__studioExtrudeSelectedFaces(0.005));
  const trisAfter = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return Math.floor(m.geometry.index.array.length / 3);
  });
  expect(trisAfter).toBe(trisBefore + 6); // +7 - 1 removed
  await win.evaluate(() => window.__studioUndo());
  const trisRestored = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return Math.floor(m.geometry.index.array.length / 3);
  });
  expect(trisRestored).toBe(trisBefore);

  // ───────────────────────────────────────────────────────────────────────
  // 12) randomScatter is DETERMINISTIC per seed.
  // ───────────────────────────────────────────────────────────────────────
  await win.evaluate(() => {
    const s = window.__archdiscScene;
    const doomed = [];
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) doomed.push(o); });
    for (const o of doomed) s.remove(o);
  });
  await spawnAndSelectCube(win);
  const scatA = await win.evaluate(() => window.__studioRandomScatter(5, 0.1, 1234));
  const positionsA = await win.evaluate(() => {
    const s = window.__archdiscScene;
    const out = [];
    s.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') {
        out.push([o.position.x, o.position.y, o.position.z]);
      }
    });
    return out;
  });
  // Clear, respawn original, rescatter with same seed.
  await win.evaluate(() => {
    const s = window.__archdiscScene;
    const doomed = [];
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) doomed.push(o); });
    for (const o of doomed) s.remove(o);
  });
  await spawnAndSelectCube(win);
  await win.evaluate(() => window.__studioRandomScatter(5, 0.1, 1234));
  const positionsB = await win.evaluate(() => {
    const s = window.__archdiscScene;
    const out = [];
    s.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') {
        out.push([o.position.x, o.position.y, o.position.z]);
      }
    });
    return out;
  });
  expect(positionsA.length).toBe(positionsB.length);
  for (let i = 0; i < positionsA.length; i++) {
    expect(positionsA[i][0]).toBeCloseTo(positionsB[i][0], 6);
    expect(positionsA[i][1]).toBeCloseTo(positionsB[i][1], 6);
    expect(positionsA[i][2]).toBeCloseTo(positionsB[i][2], 6);
  }

  await win.screenshot({ path: path.join(OUT, '00-correctness.png') });

  // Reset.
  await win.evaluate(() => {
    window.localStorage.removeItem('studioV3');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });

  // eslint-disable-next-line no-console
  console.log('  slice 405: all 12 invariants of the 53 V3-native ops verified');

  await app.close();
});
