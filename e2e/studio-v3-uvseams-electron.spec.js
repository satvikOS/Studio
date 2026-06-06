// ArchDisc Studio V3 — auto seam-cut UV unwrap e2e (slice 736).
//
// Headed Mac-Electron spec. LSCM (slice 734) flattens a single chart;
// a CLOSED mesh (box, character) needs to be CUT into developable charts
// along seams first. This slice detects sharp-edge seams, segments the
// mesh into charts, LSCM-flattens each, and lays them out (Blender Smart
// UV Project / Maya Automatic / ZBrush UV Master auto-seam).
//
// Exercises __studioZUVMaster{ChartCount,UnwrapWithSeams,Distortion}:
//   • spawn a welded box → chartCount == 6 (one per face)
//   • unwrapWithSeams → method 'seam-lscm', 6 charts flattened
//   • the seam-cut UVs are near-zero angle distortion (flat faces),
//     DECISIVELY better than a whole-mesh single-chart LSCM on the box
//   • global search surfaces the seam ops
//   • camera sweep

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-uvseams');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — auto seam-cut + multi-chart LSCM unwrap', async () => {
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
  for (let attempt = 0; attempt < 4 && !shellUp; attempt++) {
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(1500); // let the React shell mount
    try {
      await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 40000 });
      shellUp = true;
    } catch (_) { /* retry */ }
  }
  expect(shellUp).toBe(true);
  await win.waitForFunction(() => !!window.__archdiscScene && !!window.THREE, null, { timeout: 30000 });

  await win.evaluate(async () => {
    if (typeof window.__studioZUVMasterUnwrapWithSeams !== 'function') {
      await import('/src/workbenches/studio/v3/zuvmaster/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioZUVMasterUnwrapWithSeams === 'function',
    null, { timeout: 20000 });

  // Spawn a WELDED box built manually (8 shared corners, 12 triangles)
  // so in-face edges are shared and only the sharp 90° face edges become
  // seams. Avoids an in-page bare-specifier import.
  const made = await win.evaluate(() => {
    const THREE = window.THREE;
    const scene = window.__archdiscScene;
    const s = 0.02;
    const v = [
      [-s,-s,-s],[ s,-s,-s],[ s, s,-s],[-s, s,-s],
      [-s,-s, s],[ s,-s, s],[ s, s, s],[-s, s, s],
    ];
    const pos = new Float32Array(v.length * 3);
    for (let i = 0; i < v.length; i++) { pos[i*3]=v[i][0]; pos[i*3+1]=v[i][1]; pos[i*3+2]=v[i][2]; }
    // 12 triangles (2 per face), winding consistent enough for seam test.
    const idx = new Uint32Array([
      0,1,2, 0,2,3,   // -Z
      4,6,5, 4,7,6,   // +Z
      0,4,5, 0,5,1,   // -Y
      3,2,6, 3,6,7,   // +Y
      1,5,6, 1,6,2,   // +X
      0,3,7, 0,7,4,   // -X
    ]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xb0a890 }));
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'box';
    scene.add(mesh);
    if (window.__studioSelectMesh) window.__studioSelectMesh(mesh);
    return { uuid: mesh.uuid, verts: g.attributes.position.count };
  });
  const UUID = made.uuid;
  expect(UUID).toBeTruthy();
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '00-box.png') });

  // ── 1) Chart count at 40° seam threshold → 6 (one per box face). ───
  const cc = await win.evaluate((u) => window.__studioZUVMasterChartCount(u, 40), UUID);
  expect(cc.ok).toBe(true);
  expect(cc.charts).toBe(6);
  expect(cc.seamCount).toBeGreaterThan(0);

  // ── 2) Seam-cut unwrap → 6 charts, all flattened. ─────────────────
  const sw = await win.evaluate((u) => window.__studioZUVMasterUnwrapWithSeams(u, { seamAngleDeg: 40 }), UUID);
  expect(sw.ok).toBe(true);
  expect(sw.method).toBe('seam-lscm');
  expect(sw.charts).toBe(6);
  expect(sw.flattenedCharts).toBe(6);
  const seamDist = await win.evaluate((u) => window.__studioZUVMasterDistortion(u), UUID);
  expect(seamDist.ok).toBe(true);
  expect(seamDist.meanAngleDistortionDeg).toBeLessThan(1.0); // flat faces → ~0
  console.log('[uvseams] seam-cut box distortion =', seamDist.meanAngleDistortionDeg);

  // ── 3) Whole-mesh single-chart LSCM on the box distorts much more. ──
  const wholeDist = await win.evaluate((u) => {
    const r = window.__studioZUVMasterUnwrapAll(u, {}); // single-chart LSCM
    return { method: r.method, dist: window.__studioZUVMasterDistortion(u).meanAngleDistortionDeg };
  }, UUID);
  console.log('[uvseams] whole-mesh LSCM box distortion =', wholeDist.dist, 'method', wholeDist.method);
  // Re-apply the seam unwrap (unwrapAll above overwrote it) so the final
  // mesh carries the good charts, and assert seam-cut beat whole-mesh.
  await win.evaluate((u) => window.__studioZUVMasterUnwrapWithSeams(u, { seamAngleDeg: 40 }), UUID);
  expect(seamDist.meanAngleDistortionDeg).toBeLessThan(wholeDist.dist);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '01-seam-unwrapped.png') });

  // ── 4) Global search surfaces the seam ops. ────────────────────────
  const search = await win.evaluate(() => window.__studioCommandSearch('zuvmaster', 40));
  expect(search.ok).toBe(true);
  const names = search.hits.map((h) => h.name);
  expect(names).toContain('__studioZUVMasterUnwrapWithSeams');

  // ── 5) Camera sweep. ───────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 736: seam-cut box → 6 charts, dist',
    seamDist.meanAngleDistortionDeg.toFixed(3), 'vs whole-mesh', wholeDist.dist.toFixed(1));

  await app.close();
});
