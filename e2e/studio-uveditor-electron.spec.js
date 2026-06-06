// ArchDisc Studio V3 — real-time UV editor (slice 763).
//
// Headed Mac-Electron spec. Spawns a UV-mapped sphere primitive
// (`THREE.SphereGeometry` already carries spherical-projection UVs),
// finds UV islands (a clean sphere should report >=1), moves island 0
// by (0.1, 0), asserts the UV array shifted by that delta, then packs
// every island and asserts every UV coordinate ends up within [0,1].
// Captures the canonical five named camera angles per the multi-cam
// memory.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-uveditor');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — real-time UV editor (slice 763)', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 140,
  });
  // --dev may auto-open a DevTools window; app.firstWindow() can race
  // onto it. Pick the real app window (url() not devtools://).
  let win = null;
  for (let i = 0; i < 30 && !win; i++) {
    win = app.windows().find((w) => {
      const u = (() => { try { return w.url(); } catch (_) { return ''; } })();
      return u && !u.startsWith('devtools://');
    }) || null;
    if (!win) { await new Promise((r) => setTimeout(r, 500)); }
  }
  if (!win) win = await app.firstWindow();
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
  for (let attempt = 0; attempt < 4 && !shellUp; attempt++) {
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(1500);
    try {
      await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 40000 });
      shellUp = true;
    } catch (_) { /* retry */ }
  }
  expect(shellUp).toBe(true);
  await win.waitForFunction(() => !!window.__archdiscScene && !!window.THREE, null, { timeout: 30000 });

  // Make sure uveditor ops are installed.
  await win.evaluate(async () => {
    if (typeof window.__studioUVFindIslands !== 'function') {
      await import('/src/workbenches/studio/v3/uveditor/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioUVFindIslands === 'function',
    null, { timeout: 20000 });
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) Spawn a UV-mapped sphere primitive. SphereGeometry comes with
  //      spherical-projection UVs out of the box. ───────────────────────
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(250);
  const meshInfo = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    if (!m) return null;
    return {
      uuid: m.uuid,
      hasUV: !!m.geometry?.attributes?.uv,
      uvCount: m.geometry?.attributes?.uv?.count || 0,
    };
  });
  expect(meshInfo).not.toBeNull();
  expect(meshInfo.hasUV).toBe(true);
  expect(meshInfo.uvCount).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '01-sphere.png') });

  // ── 2) Find islands — sphere has at least 1 island. ────────────────────
  const found = await win.evaluate((u) => window.__studioUVFindIslands(u), meshInfo.uuid);
  console.log('[uveditor] islands ->', JSON.stringify({
    ok: found.ok, count: found.count,
    first: found.islands && found.islands[0],
  }));
  expect(found.ok).toBe(true);
  expect(found.count).toBeGreaterThanOrEqual(1);
  expect(found.islands[0].triCount).toBeGreaterThan(0);

  // ── 3) Sample a representative UV from island 0 before/after move. ─────
  const island0 = found.islands[0];
  const sampleVert = await win.evaluate(([uuid, islandId]) => {
    // Use the same flood-fill the op did to get a deterministic vert.
    const scene = window.__archdiscScene;
    const m = scene.getObjectByProperty('uuid', uuid);
    const idx = m.geometry.index ? m.geometry.index.array : null;
    const triCount = idx ? idx.length / 3 : m.geometry.attributes.position.count / 3;
    const triVerts = [];
    const vertToTris = new Map();
    for (let t = 0; t < triCount; t++) {
      const tv = idx
        ? [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]]
        : [t * 3, t * 3 + 1, t * 3 + 2];
      triVerts.push(tv);
      for (const v of tv) {
        if (!vertToTris.has(v)) vertToTris.set(v, []);
        vertToTris.get(v).push(t);
      }
    }
    const triIsland = new Int32Array(triCount).fill(-1);
    let id = 0;
    const islandFirstVert = new Map();
    for (let s = 0; s < triCount; s++) {
      if (triIsland[s] !== -1) continue;
      const myId = id++;
      const stack = [s];
      triIsland[s] = myId;
      if (!islandFirstVert.has(myId)) islandFirstVert.set(myId, triVerts[s][0]);
      while (stack.length) {
        const t = stack.pop();
        for (const v of triVerts[t]) {
          for (const nt of (vertToTris.get(v) || [])) {
            if (triIsland[nt] === -1) {
              triIsland[nt] = myId;
              stack.push(nt);
            }
          }
        }
      }
    }
    const v = islandFirstVert.get(islandId);
    const uv = m.geometry.attributes.uv.array;
    return { vert: v, u: uv[v * 2], w: uv[v * 2 + 1] };
  }, [meshInfo.uuid, island0.id]);
  expect(typeof sampleVert.vert).toBe('number');
  const uBefore = sampleVert.u;
  const vBefore = sampleVert.w;

  // ── 4) Move island 0 by (0.1, 0). ──────────────────────────────────────
  const moved = await win.evaluate(([uuid, id]) =>
    window.__studioUVMoveIsland({ meshUuid: uuid, islandId: id, du: 0.1, dv: 0 }),
    [meshInfo.uuid, island0.id]);
  console.log('[uveditor] move ->', JSON.stringify(moved));
  expect(moved.ok).toBe(true);

  const afterMove = await win.evaluate(([uuid, v]) => {
    const scene = window.__archdiscScene;
    const m = scene.getObjectByProperty('uuid', uuid);
    const uv = m.geometry.attributes.uv.array;
    return { u: uv[v * 2], w: uv[v * 2 + 1] };
  }, [meshInfo.uuid, sampleVert.vert]);
  console.log('[uveditor] uBefore=', uBefore.toFixed(4),
    'uAfter=', afterMove.u.toFixed(4), ' delta=', (afterMove.u - uBefore).toFixed(4));
  expect(Math.abs((afterMove.u - uBefore) - 0.1)).toBeLessThan(1e-5);
  expect(Math.abs(afterMove.w - vBefore)).toBeLessThan(1e-5);
  await win.screenshot({ path: path.join(OUT, '02-moved.png') });

  // ── 5) Pack — every UV coordinate must land within [0,1]. ──────────────
  const packed = await win.evaluate((u) =>
    window.__studioUVPack({ meshUuid: u, margin: 0.01 }),
    meshInfo.uuid);
  console.log('[uveditor] pack ->', JSON.stringify(packed));
  expect(packed.ok).toBe(true);
  expect(packed.packedCount).toBeGreaterThanOrEqual(1);

  const rangeReport = await win.evaluate((u) => {
    const scene = window.__archdiscScene;
    const m = scene.getObjectByProperty('uuid', u);
    const uv = m.geometry.attributes.uv.array;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < uv.length; i++) {
      if (uv[i] < lo) lo = uv[i];
      if (uv[i] > hi) hi = uv[i];
    }
    return { lo, hi, count: uv.length / 2 };
  }, meshInfo.uuid);
  console.log('[uveditor] post-pack UV range:', JSON.stringify(rangeReport));
  expect(rangeReport.lo).toBeGreaterThanOrEqual(-1e-6);
  expect(rangeReport.hi).toBeLessThanOrEqual(1 + 1e-6);
  await win.screenshot({ path: path.join(OUT, '03-packed.png') });

  // ── 6) Command-palette discovery. ──────────────────────────────────────
  const search = await win.evaluate(() => {
    const r = window.__studioCommandSearch('UV', 80);
    return { ok: r.ok, names: (r.hits || []).map((h) => h.name) };
  });
  for (const expected of [
    '__studioUVFindIslands',
    '__studioUVMoveIsland',
    '__studioUVRotateIsland',
    '__studioUVScaleIsland',
    '__studioUVMirrorIsland',
    '__studioUVPack',
    '__studioUVRelax',
  ]) {
    expect(search.names).toContain(expected);
  }

  // ── 7) Five-camera sweep. ──────────────────────────────────────────────
  const cams = [
    { name: 'front', pos: [0, 0.5, 1.5], target: [0, 0, 0] },
    { name: 'iso',   pos: [1, 1, 1],     target: [0, 0, 0] },
    { name: 'right', pos: [1.5, 0.5, 0], target: [0, 0, 0] },
    { name: 'top',   pos: [0, 1.5, 0.01], target: [0, 0, 0] },
    { name: 'close', pos: [0.4, 0.4, 0.4], target: [0, 0, 0] },
  ];
  for (const c of cams) {
    let snapped = false;
    try {
      await win.evaluate(({ pos, target }) => {
        const v = window.__archdiscViewport;
        if (!v || !v.camera) return false;
        v.camera.position.set(pos[0], pos[1], pos[2]);
        v.camera.lookAt(target[0], target[1], target[2]);
        if (v.orbitControls) {
          v.orbitControls.target.set(target[0], target[1], target[2]);
          v.orbitControls.update();
        }
        v.camera.updateMatrixWorld(true);
        if (v.renderer && v.scene) v.renderer.render(v.scene, v.camera);
        return true;
      }, c);
      snapped = true;
    } catch (_) {
      try {
        await win.evaluate((vn) => {
          if (typeof window.__studioSetView === 'function') window.__studioSetView(vn);
          else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(vn);
        }, c.name);
        snapped = true;
      } catch (_) {}
    }
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${c.name}.png`) });
    expect(snapped).toBe(true);
  }

  // eslint-disable-next-line no-console
  console.log('  slice 763: islands', found.count, '| packed', packed.packedCount,
    '| UV range [', rangeReport.lo.toFixed(4), ',', rangeReport.hi.toFixed(4), ']');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
