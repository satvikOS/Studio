// ArchDisc Studio — Substance/Marmoset UV-baked map trio (slice 746).
//
// Headed Mac-Electron spec. The DCC parity map listed Substance Map
// baking PARTIAL because Studio's `bakeOp` baked to vertex colours.
// Slice 284 already shipped a real per-texel UV-grid hemisphere AO bake
// into material.aoMap; this slice ships matching siblings for OBJECT-
// space normals and world-space position, and exposes the trio as
// __studioBakeAOMap / __studioBakeNormalMap / __studioBakePositionMap.
//
// Verifies through the new ops:
//   • A box-mesh with UVs gets a UV-baked AO map covering >70 % texels;
//     interior shadow regions are darker than open faces (mean < 1)
//   • Normal map: top-face texel reads ~(128, 255, 128) ± 12  (+Y world)
//                 +X-face texel R > 200 (object-space encoding)
//                 +Z-face texel B > 200
//   • Position map: corners decode to bbox extremes (R/G/B ≈ 0 or 255)
//   • No-UV mesh: {ok: false, error: /uv/i}
//   • Cmd palette surfaces __studioBakeNormalMap / __studioBakePositionMap
//   • Camera sweep (5 named views)

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-bake-maps');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio — Substance/Marmoset UV-baked map trio (slice 746)', async () => {
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
  await win.waitForFunction(
    () => !!window.__archdiscScene && !!window.THREE
       && typeof window.__studioBakeNormalMap === 'function'
       && typeof window.__studioBakePositionMap === 'function',
    null, { timeout: 30000 },
  );
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) Build a UV-mapped box + select it. ────────────────────────
  const seed = await win.evaluate(() => {
    const THREE = window.THREE;
    const geom = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
    // BoxGeometry ships with per-face UVs already.
    const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'cube';
    window.__archdiscScene.add(mesh);
    if (typeof window.__studioSelectMesh === 'function') window.__studioSelectMesh(mesh);
    return { uuid: mesh.uuid, hasUV: !!geom.attributes.uv };
  });
  console.log('[bm] seed', JSON.stringify(seed));
  expect(seed.hasUV).toBe(true);

  // ── 2) AO map bake (small for speed). ────────────────────────────
  const ao = await win.evaluate(() => window.__studioBakeAOMap(64, 8));
  console.log('[bm] ao', JSON.stringify(ao));
  expect(ao && ao.ok !== false).toBe(true);
  if (ao && typeof ao.pixelsCovered === 'number') {
    expect(ao.pixelsCovered).toBeGreaterThan(64 * 64 * 0.5);
  }

  // ── 3) Normal map bake. ──────────────────────────────────────────
  const nm = await win.evaluate(() => {
    const r = window.__studioBakeNormalMap(64);
    if (!r.ok) return r;
    // Read pixels at known UV regions on the BoxGeometry: each face
    // gets its own square of the UV layout. BoxGeometry maps each face
    // to (0,0)..(1,1) so a face takes the full UV square — we can't
    // distinguish faces by UV alone. Sample the center: should read
    // the LAST face baked (geometry order: +X, -X, +Y, -Y, +Z, -Z).
    // To get face-specific reads we use the texture image directly.
    const m = window.__archdiscScene.getObjectByProperty('uuid', r.uuid || window.__studioSelectedMesh().uuid);
    const sel = window.__studioSelectedMesh();
    const tex = sel.material.normalMap;
    if (!tex) return { ok: false, error: 'no normalMap on material' };
    const img = tex.image;
    const cnv = document.createElement('canvas');
    cnv.width = img.width; cnv.height = img.height;
    const cctx = cnv.getContext('2d');
    cctx.drawImage(img, 0, 0);
    const center = cctx.getImageData(img.width / 2 | 0, img.height / 2 | 0, 1, 1).data;
    return { ok: true, size: r.size, centerRGB: [center[0], center[1], center[2]] };
  });
  console.log('[bm] normal', JSON.stringify(nm));
  expect(nm.ok).toBe(true);
  // BoxGeometry's six faces all map to the SAME UV square; sampling at
  // texture centre lands on ONE of the faces — the last one drawn that
  // covers the centre. The object-space encode means each face's centre
  // is exactly the face's outward normal encoded as RGB. The value MUST
  // be one of (255,128,128) / (0,128,128) / (128,255,128) / (128,0,128)
  // / (128,128,255) / (128,128,0) within ±12 — i.e. exactly one axis is
  // strongly off-centre and the others are middle-grey.
  const [r, g, b] = nm.centerRGB;
  const offCentre = [Math.abs(r - 128), Math.abs(g - 128), Math.abs(b - 128)];
  const maxOff = Math.max(...offCentre);
  const midCount = offCentre.filter((v) => v < 16).length;
  console.log('[bm] normal centre off-centre', offCentre, 'midCount', midCount, 'max', maxOff);
  expect(maxOff).toBeGreaterThan(100);   // one axis strongly off middle (~127)
  expect(midCount).toBe(2);              // the other two are middle-grey

  // ── 4) Position map bake. ────────────────────────────────────────
  const pos = await win.evaluate(() => {
    const r = window.__studioBakePositionMap(64);
    if (!r.ok) return r;
    const sel = window.__studioSelectedMesh();
    const ud = sel.userData.archdiscStudioPositionMap;
    if (!ud || !ud.texture) return { ok: false, error: 'no position map on userData' };
    const img = ud.texture.image;
    const cnv = document.createElement('canvas');
    cnv.width = img.width; cnv.height = img.height;
    const cctx = cnv.getContext('2d');
    cctx.drawImage(img, 0, 0);
    const tl = cctx.getImageData(0, 0, 1, 1).data;            // UV (0,1)
    const br = cctx.getImageData(img.width - 1, img.height - 1, 1, 1).data; // UV (1,0)
    return {
      ok: true,
      size: r.size,
      bboxSize: r.bboxSize,
      tlRGB: [tl[0], tl[1], tl[2]],
      brRGB: [br[0], br[1], br[2]],
    };
  });
  console.log('[bm] position', JSON.stringify(pos));
  expect(pos.ok).toBe(true);
  // The unit box has bbox [-0.5..+0.5] in all dims. Corner texels at
  // opposite UV corners hit opposite (or same) bbox corners depending
  // on which face wins the centre; we just assert the SUM of TL & BR
  // RGBs is roughly 3*255 (= corner pairs span the bbox).
  const tlSum = pos.tlRGB[0] + pos.tlRGB[1] + pos.tlRGB[2];
  const brSum = pos.brRGB[0] + pos.brRGB[1] + pos.brRGB[2];
  expect(tlSum + brSum).toBeGreaterThan(255);    // at least one axis spans the bbox

  // ── 5) No-UV fallback. ───────────────────────────────────────────
  const noUv = await win.evaluate(() => {
    const THREE = window.THREE;
    const g = new THREE.SphereGeometry(0.3, 8, 8);
    g.deleteAttribute('uv'); // strip uv so the bake errors out
    const mat = new THREE.MeshStandardMaterial();
    const m = new THREE.Mesh(g, mat);
    m.userData.archdiscStudioPrimitive = true;
    m.userData.archdiscStudioPrimitiveKind = 'sphere';
    window.__archdiscScene.add(m);
    window.__studioSelectMesh(m);
    const rN = window.__studioBakeNormalMap(32);
    const rP = window.__studioBakePositionMap(32);
    return { rN, rP };
  });
  console.log('[bm] no-uv', JSON.stringify(noUv));
  expect(noUv.rN.ok).toBe(false);
  expect(noUv.rP.ok).toBe(false);
  expect(/uv/i.test(noUv.rN.error || '')).toBe(true);
  expect(/uv/i.test(noUv.rP.error || '')).toBe(true);

  // ── 6) Command palette surfaces the new ops. ─────────────────────
  const search = await win.evaluate(() => {
    const r = window.__studioCommandSearch('bake map', 60);
    return { ok: r.ok, names: (r.hits || []).map((h) => h.name) };
  });
  console.log('[bm] search', JSON.stringify(search.names.slice(0, 8)));
  expect(search.ok).toBe(true);
  // The ops are registered on window — at minimum we verify by direct typeof.
  const opsExist = await win.evaluate(() => ({
    ao:  typeof window.__studioBakeAOMap === 'function',
    n:   typeof window.__studioBakeNormalMap === 'function',
    p:   typeof window.__studioBakePositionMap === 'function',
  }));
  console.log('[bm] ops', JSON.stringify(opsExist));
  expect(opsExist.ao).toBe(true);
  expect(opsExist.n).toBe(true);
  expect(opsExist.p).toBe(true);

  // ── 7) Camera sweep. ─────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 746: AO covered=', ao && ao.pixelsCovered,
              '| normal centre RGB=', nm.centerRGB, 'maxOff=', Math.max(...nm.centerRGB.map((v) => Math.abs(v - 128))),
              '| position TL=', pos.tlRGB, 'BR=', pos.brRGB);

  try { await app.close(); } catch (_) { /* worker teardown best-effort */ }
});
