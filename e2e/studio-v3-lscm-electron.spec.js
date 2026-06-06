// ArchDisc Studio V3 — LSCM conformal UV unwrap e2e (slice 734).
//
// Headed Mac-Electron spec. The UV Master "Unwrap All" now runs a REAL
// LSCM (Least Squares Conformal Maps) solver (Lévy et al. 2002 — the
// unwrap Blender/Maya/Headus use) instead of a spherical projection.
// LSCM minimises ANGLE distortion, so on a developable surface (plane,
// cylinder) the angle distortion is near zero.
//
// Exercises __studioZUVMaster* (zuvmaster/uvmaster.js + lscm.js):
//   • spawn a plane, tilt it in 3D, unwrap → method === 'lscm', UVs set
//   • measure angle distortion → near zero (LSCM is conformal)
//   • compare against a spherical-projection baseline computed in-page →
//     LSCM is dramatically lower (proves it's a real conformal solve)
//   • unwrap a cylinder (developable) → also low distortion
//   • global search surfaces the unwrap ops
//   • camera sweep for remote verification

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-lscm');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — LSCM conformal UV unwrap (UV Master)', async () => {
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
  // Resilient boot (retry reload on cold-start race).
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
    if (typeof window.__studioZUVMasterUnwrapAll !== 'function') {
      await import('/src/workbenches/studio/v3/zuvmaster/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioZUVMasterUnwrapAll === 'function',
    null, { timeout: 20000 });

  await win.evaluate(() => { if (window.__studioClearScene) window.__studioClearScene(); });

  // ── 1) Spawn a subdivided plane, tilt it in 3D, add it to the scene. ──
  const made = await win.evaluate(() => {
    const THREE = window.THREE;
    const scene = window.__archdiscScene;
    const g = new THREE.PlaneGeometry(0.06, 0.03, 8, 4);
    g.rotateX(0.6); g.rotateY(0.4); // tilt so a planar projection would distort
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x99aabb }));
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'plane';
    scene.add(mesh);
    if (window.__studioSelectMesh) window.__studioSelectMesh(mesh);
    return { uuid: mesh.uuid };
  });
  expect(made.uuid).toBeTruthy();
  const UUID = made.uuid;
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '00-tilted-plane.png') });

  // ── 2) Unwrap with LSCM. ───────────────────────────────────────────
  const unwrap = await win.evaluate((u) => window.__studioZUVMasterUnwrapAll(u, {}), UUID);
  expect(unwrap.ok).toBe(true);
  expect(unwrap.method).toBe('lscm');  // real conformal solver, not projection
  expect(unwrap.vertices).toBeGreaterThan(0);

  // ── 3) Measure angle distortion — LSCM is conformal → near zero. ───
  const dist = await win.evaluate((u) => window.__studioZUVMasterDistortion(u), UUID);
  expect(dist.ok).toBe(true);
  expect(dist.meanAngleDistortionDeg).toBeLessThan(2.0); // near-perfectly conformal on a flat surface
  console.log('[lscm] plane distortion deg =', dist.meanAngleDistortionDeg);

  // ── 4) Baseline: spherical projection on the SAME mesh distorts hugely. ──
  const proj = await win.evaluate((u) => {
    const scene = window.__archdiscScene;
    const mesh = scene.getObjectByProperty('uuid', u);
    const pos = mesh.geometry.attributes.position.array;
    const idx = mesh.geometry.index ? mesh.geometry.index.array : null;
    const n = pos.length / 3;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += pos[i*3]; cy += pos[i*3+1]; cz += pos[i*3+2]; }
    cx/=n; cy/=n; cz/=n;
    const sph = new Float32Array(n*2);
    for (let i = 0; i < n; i++) {
      const dx=pos[i*3]-cx, dy=pos[i*3+1]-cy, dz=pos[i*3+2]-cz;
      const az=Math.atan2(dz,dx); const r=Math.hypot(dx,dy,dz)||1; const pl=Math.acos(dy/r);
      sph[i*2]=(az+Math.PI)/(2*Math.PI); sph[i*2+1]=pl/Math.PI;
    }
    // angle distortion of the projection UVs
    const ang3=(a,b,c)=>{const v1=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],v2=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];const d=v1[0]*v2[0]+v1[1]*v2[1]+v1[2]*v2[2];return Math.acos(Math.max(-1,Math.min(1,d/((Math.hypot(...v1)*Math.hypot(...v2))+1e-12))));};
    const ang2=(a,b,c)=>{const v1=[b[0]-a[0],b[1]-a[1]],v2=[c[0]-a[0],c[1]-a[1]];const d=v1[0]*v2[0]+v1[1]*v2[1];return Math.acos(Math.max(-1,Math.min(1,d/((Math.hypot(...v1)*Math.hypot(...v2))+1e-12))));};
    const P=(i)=>[pos[i*3],pos[i*3+1],pos[i*3+2]];
    const tc = idx ? idx.length/3 : n/3;
    let sum=0,cnt=0;
    for (let t=0;t<tc;t++){const i0=idx?idx[t*3]:t*3,i1=idx?idx[t*3+1]:t*3+1,i2=idx?idx[t*3+2]:t*3+2;
      const a=[ang3(P(i0),P(i1),P(i2)),ang3(P(i1),P(i2),P(i0)),ang3(P(i2),P(i0),P(i1))];
      const u0=[sph[i0*2],sph[i0*2+1]],u1=[sph[i1*2],sph[i1*2+1]],u2=[sph[i2*2],sph[i2*2+1]];
      const b=[ang2(u0,u1,u2),ang2(u1,u2,u0),ang2(u2,u0,u1)];
      for(let k=0;k<3;k++){sum+=Math.abs(a[k]-b[k]);cnt++;}}
    return cnt? sum/cnt*180/Math.PI : 0;
  }, UUID);
  console.log('[lscm] projection baseline distortion deg =', proj);
  // LSCM must be decisively better than the naive projection.
  expect(dist.meanAngleDistortionDeg).toBeLessThan(proj);

  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '01-unwrapped.png') });

  // ── 5) Cylinder (developable) also unwraps with low distortion. ────
  const cyl = await win.evaluate(() => {
    const THREE = window.THREE;
    const scene = window.__archdiscScene;
    const g = new THREE.CylinderGeometry(0.02, 0.02, 0.06, 16, 4, true);
    const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0xaabb99 }));
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'cylinder';
    mesh.position.x = 0.1;
    scene.add(mesh);
    return { uuid: mesh.uuid };
  });
  const cu = await win.evaluate((u) => window.__studioZUVMasterUnwrapAll(u, {}), cyl.uuid);
  expect(cu.ok).toBe(true);
  expect(cu.method).toBe('lscm');
  const cd = await win.evaluate((u) => window.__studioZUVMasterDistortion(u), cyl.uuid);
  expect(cd.ok).toBe(true);
  expect(cd.meanAngleDistortionDeg).toBeLessThan(5.0);
  console.log('[lscm] cylinder distortion deg =', cd.meanAngleDistortionDeg);

  // ── 6) Global search surfaces the UV Master ops. ───────────────────
  const search = await win.evaluate(() => window.__studioCommandSearch('uvmaster', 40));
  expect(search.ok).toBe(true);
  const names = search.hits.map((h) => h.name);
  expect(names).toContain('__studioZUVMasterUnwrapAll');

  // ── 7) Camera sweep. ───────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 734: LSCM plane dist=', dist.meanAngleDistortionDeg.toFixed(3),
    'vs projection', proj.toFixed(1), '| cylinder dist=', cd.meanAngleDistortionDeg.toFixed(3));

  await app.close();
});
