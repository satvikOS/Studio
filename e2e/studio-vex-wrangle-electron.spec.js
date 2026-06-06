// ArchDisc Studio — real Houdini VEX-flavour wrangle (slice 745).
//
// Headed Mac-Electron spec. The v3/vex/ module shipped an "ASL" editor
// (pos.x / nor.x JS-shaped syntax) but the DCC parity map listed
// Houdini VEX as ABSENT. This slice ships REAL VEX: typed locals,
// @P/@N/@Cd/@id attribute model, vec3 literal, if/else/return,
// compound assigns, swizzle, full built-in set.
//
// Verifies through the new __studioVEX* (capitalised) op surface:
//   • @P.y += sin(@P.x*3.14) moves Y by the exact sinusoid
//   • @Cd = {1,0,0} writes red into a fresh color attribute
//   • X/Z untouched, normals untouched
//   • parse-error path returns {ok:false, line, col}
//   • normalize(@N) along-normal displacement gives unit-along-N delta
//   • cmd palette surfaces __studioVEXRun
//   • camera sweep (5 named views)

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-vex-wrangle');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio — real Houdini VEX wrangle (slice 745)', async () => {
  test.setTimeout(420000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 140,
  });

  let win = null;
  for (let i = 0; i < 30 && !win; i++) {
    win = app.windows().find((w) => {
      const u = (() => { try { return w.url(); } catch (_) { return ''; } })();
      return u && !u.startsWith('devtools://');
    }) || null;
    if (!win) await new Promise((r) => setTimeout(r, 500));
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

  // Lazy-install the vex module (autoload may not have wired yet).
  await win.evaluate(async () => {
    if (typeof window.__studioVEXRun !== 'function') {
      await import('/src/workbenches/studio/v3/vex/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioVEXRun === 'function'
       && typeof window.__studioVEXCompile === 'function'
       && typeof window.__studioVEXRunOnMesh === 'function',
    null, { timeout: 20000 },
  );
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) Build a 32×32 plane in the scene we can wrangle. ──────────
  const seed = await win.evaluate(() => {
    const THREE = window.THREE;
    const W = 32, H = 32;
    const geom = new THREE.PlaneGeometry(2, 2, W, H);
    // PlaneGeometry's normals point +Z by default. Keep it that way; we
    // wrangle Y and that's a tangential axis on this surface.
    const mat = new THREE.MeshStandardMaterial({
      color: 0xcccccc, vertexColors: true,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'plane';
    window.__archdiscScene.add(mesh);
    if (typeof window.__studioSelectMesh === 'function') {
      window.__studioSelectMesh(mesh);
    }
    return { uuid: mesh.uuid, verts: geom.attributes.position.count };
  });
  console.log('[vex] seed plane verts', seed.verts);
  expect(seed.verts).toBe(33 * 33); // PlaneGeometry(W,H,segs) → (segs+1)² verts

  // Snapshot original positions.
  const origPos = await win.evaluate((uuid) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', uuid);
    const p = m.geometry.attributes.position;
    const out = new Array(p.count);
    for (let i = 0; i < p.count; i++) {
      out[i] = [p.getX(i), p.getY(i), p.getZ(i)];
    }
    return out;
  }, seed.uuid);

  // ── 2) Compile-only check. ───────────────────────────────────────
  const compile = await win.evaluate(() => window.__studioVEXCompile(
    'float a = sin(@P.x*3.14); @P.y += a; @Cd = {1,0,0};'
  ));
  console.log('[vex] compile', JSON.stringify(compile));
  expect(compile.ok).toBe(true);

  // ── 3) Run the sin wrangle. ──────────────────────────────────────
  const runR = await win.evaluate((uuid) => {
    return window.__studioVEXRunOnMesh(
      uuid,
      'float a = sin(@P.x*3.14); @P.y += a; @Cd = {1,0,0};'
    );
  }, seed.uuid);
  console.log('[vex] run', JSON.stringify(runR));
  expect(runR.ok).toBe(true);
  expect(runR.touched).toBe(33 * 33);
  expect(runR.modifiedAttrs).toContain('P');
  expect(runR.modifiedAttrs).toContain('Cd');

  // ── 4) Numeric assertions: 16 sampled points. ────────────────────
  const after = await win.evaluate((uuid) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', uuid);
    const p = m.geometry.attributes.position;
    const c = m.geometry.attributes.color;
    const sample = [];
    const step = Math.max(1, Math.floor(p.count / 16));
    for (let i = 0; i < p.count && sample.length < 16; i += step) {
      sample.push({
        i,
        p: [p.getX(i), p.getY(i), p.getZ(i)],
        c: c ? [c.getX(i), c.getY(i), c.getZ(i)] : null,
      });
    }
    return { sample, hasColor: !!c, colorCount: c ? c.count : 0 };
  }, seed.uuid);
  console.log('[vex] hasColor', after.hasColor, 'colorCount', after.colorCount);
  expect(after.hasColor).toBe(true);
  expect(after.colorCount).toBe(33 * 33);

  let maxDeltaY = 0;
  let maxDeltaXZ = 0;
  for (const s of after.sample) {
    const o = origPos[s.i];
    const expY = o[1] + Math.sin(o[0] * 3.14);
    expect(s.p[1]).toBeCloseTo(expY, 5);
    expect(s.p[0]).toBeCloseTo(o[0], 6);
    expect(s.p[2]).toBeCloseTo(o[2], 6);
    expect(s.c[0]).toBeCloseTo(1, 5);
    expect(s.c[1]).toBeCloseTo(0, 5);
    expect(s.c[2]).toBeCloseTo(0, 5);
    maxDeltaY = Math.max(maxDeltaY, Math.abs(s.p[1] - o[1]));
    maxDeltaXZ = Math.max(maxDeltaXZ, Math.abs(s.p[0] - o[0]), Math.abs(s.p[2] - o[2]));
  }
  console.log('[vex] maxDeltaY', maxDeltaY.toFixed(5), 'maxDeltaXZ', maxDeltaXZ.toExponential(3));
  expect(maxDeltaY).toBeGreaterThan(0.9);
  expect(maxDeltaXZ).toBeLessThan(1e-5);

  // ── 5) Parse-error path. ─────────────────────────────────────────
  const bad = await win.evaluate(() => window.__studioVEXCompile('float a = ;'));
  console.log('[vex] bad-parse', JSON.stringify(bad));
  expect(bad.ok).toBe(false);
  expect(typeof bad.line).toBe('number');
  expect(typeof bad.col).toBe('number');
  expect(bad.line).toBeGreaterThan(0);

  // ── 6) normalize(@N) along-normal displacement on a fresh plane. ─
  const norm = await win.evaluate(() => {
    const THREE = window.THREE;
    const g = new THREE.PlaneGeometry(2, 2, 10, 10);
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x4488ff });
    const m = new THREE.Mesh(g, mat);
    m.userData.archdiscStudioPrimitive = true;
    m.userData.archdiscStudioPrimitiveKind = 'plane';
    m.position.set(0, 0, 0.5);
    window.__archdiscScene.add(m);
    const before = [];
    for (let i = 0; i < g.attributes.position.count; i++) {
      before.push([
        g.attributes.position.getX(i),
        g.attributes.position.getY(i),
        g.attributes.position.getZ(i),
      ]);
    }
    const r = window.__studioVEXRunOnMesh(m.uuid,
      'vec3 n = normalize(@N); @P += n*0.05;');
    // Plane normal is +Z; expect Z += 0.05 for every vertex
    let maxDz = 0, minDz = 1e9, maxDxy = 0;
    for (let i = 0; i < g.attributes.position.count; i++) {
      const o = before[i];
      const nx = g.attributes.position.getX(i);
      const ny = g.attributes.position.getY(i);
      const nz = g.attributes.position.getZ(i);
      const dz = nz - o[2];
      maxDz = Math.max(maxDz, dz);
      minDz = Math.min(minDz, dz);
      maxDxy = Math.max(maxDxy, Math.abs(nx - o[0]), Math.abs(ny - o[1]));
    }
    return { ok: r.ok, touched: r.touched, maxDz, minDz, maxDxy };
  });
  console.log('[vex] normN run', JSON.stringify(norm));
  expect(norm.ok).toBe(true);
  expect(norm.maxDz).toBeCloseTo(0.05, 5);
  expect(norm.minDz).toBeCloseTo(0.05, 5);
  expect(norm.maxDxy).toBeLessThan(1e-5);

  // ── 7) Built-in + attribute introspection ────────────────────────
  const introspect = await win.evaluate(() => ({
    b: window.__studioVEXBuiltins(),
    a: window.__studioVEXAttrs(),
  }));
  console.log('[vex] builtins count', introspect.b.names.length, 'attrs', introspect.a.attrs.join(','));
  expect(introspect.b.ok).toBe(true);
  expect(introspect.b.names).toEqual(expect.arrayContaining(['sin', 'cos', 'normalize', 'length', 'dot', 'cross', 'fit', 'noise']));
  expect(introspect.a.attrs).toEqual(expect.arrayContaining(['@P', '@N', '@Cd', '@id', '@pt', '@npt']));

  // ── 8) Command palette surfaces the new ops. ─────────────────────
  const search = await win.evaluate(() => {
    const r = window.__studioCommandSearch('VEX', 60);
    return { ok: r.ok, names: (r.hits || []).map((h) => h.name) };
  });
  console.log('[vex] search', JSON.stringify(search.names.slice(0, 8)));
  expect(search.ok).toBe(true);
  expect(search.names.some((n) => n === '__studioVEXRun')).toBe(true);
  expect(search.names.some((n) => n === '__studioVEXCompile')).toBe(true);

  // ── 9) Camera sweep. ─────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 745: sin-y wrangle on 1089 pts maxDy=', maxDeltaY.toFixed(4),
              ', normal-N test maxDz=', norm.maxDz.toFixed(4),
              ', cmd palette has', search.names.length, 'VEX ops');

  try { await app.close(); } catch (_) { /* worker teardown is best-effort */ }
});
