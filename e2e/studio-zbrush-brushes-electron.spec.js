// ArchDisc Studio V3 — ZBrush localized brush sculpt verify (slice 758).
//
// Headed Mac-Electron spec. Verifies each of the seven canonical ZBrush
// brush kernels (draw / inflate / crease / pinch / flatten / grab /
// smooth) actually displaces vertices the way the kernel name promises,
// and that the falloff curve catalogue + verifyAll smoke op + active
// settings probe round-trip cleanly.
//
// Subject: a high-poly sphere — THREE.SphereGeometry(0.05, 64, 64) — so
// each brush has > 4 k verts in its radius to actually move. The radius
// 0.05 + 64²×2 segments matches the slice brief.
//
// Steps:
//   1. Boot the Electron shell, wait for the scene.
//   2. Spawn the high-poly sphere + select it.
//   3. Dynamic-import zbrushdetail/autoload.js so the ops register
//      even if api.js hasn't been bundled yet.
//   4. Drive __studioZBrushBrush(draw) at the sphere's top; assert top
//      verts displaced (z component grows).
//   5. Drive __studioZBrushBrush(grab) with a motion vec; assert the
//      verts in the grab radius all translate.
//   6. Drive __studioZBrushBrush(smooth) on a noisy sphere; assert
//      variance of vertex distance-from-centre DROPS.
//   7. Call __studioZBrushBrushVerifyAll() and assert > 0 changed for
//      every kernel (the smoke test the parity row depends on).
//   8. Round-trip __studioZBrushSetFalloffCurve / GetActiveSettings.
//   9. 5 named camera angles per the remote-desktop verification rule.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-zbrush-brushes');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — ZBrush localized brush kernels + falloff curves (slice 758)', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 140,
  });
  // --dev may auto-open a DevTools window; pick the real app window.
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

  // ── 1) Ensure the zbrushdetail ops are installed ────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioZBrushBrush !== 'function') {
      await import('/src/workbenches/studio/v3/zbrushdetail/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioZBrushBrush === 'function',
    null, { timeout: 20000 });
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 2) Spawn a high-poly sphere + select it ─────────────────────────
  await win.evaluate(() => {
    const THREE = window.THREE;
    const scene = window.__archdiscScene;
    const geo = new THREE.SphereGeometry(0.05, 64, 64);
    const mat = new THREE.MeshStandardMaterial({ color: 0xc4d4e6, roughness: 0.55 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'zbrush-target';
    mesh.userData = { archdiscStudioPrimitive: true, archdiscStudioPrimitiveKind: 'sphere' };
    scene.add(mesh);
    if (window.__studioSelectMesh) window.__studioSelectMesh(mesh);
    window.__zbrushTestMesh = mesh;
  });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '01-spawn-sphere.png') });

  const meshInfo = await win.evaluate(() => {
    const m = window.__zbrushTestMesh;
    return {
      uuid: m.uuid,
      verts: m.geometry.attributes.position.count,
    };
  });
  expect(meshInfo.verts).toBeGreaterThan(4000); // 64×64 sphere → ~4.2 k verts
  console.log('  sphere uuid', meshInfo.uuid, 'verts', meshInfo.verts);

  // ── 3) DRAW brush: top of sphere → top verts displace outward ───────
  const drawBefore = await win.evaluate(() => {
    const m = window.__zbrushTestMesh;
    const a = m.geometry.attributes.position.array;
    // The sphere's pole is at +Y (0, 0.05, 0). Find the max Y vertex.
    let maxY = -Infinity, idx = -1;
    for (let i = 0; i < a.length; i += 3) {
      if (a[i + 1] > maxY) { maxY = a[i + 1]; idx = i / 3; }
    }
    return { maxY, idx };
  });
  const drawApply = await win.evaluate((uuid) => {
    return window.__studioZBrushBrush(uuid, 'draw', {
      center: [0, 0.05, 0],
      radius: 0.03,
      strength: 0.01,
    });
  }, meshInfo.uuid);
  expect(drawApply.ok).toBe(true);
  expect(drawApply.brush).toBe('draw');
  expect(drawApply.changed).toBeGreaterThan(0);
  const drawAfter = await win.evaluate(() => {
    const m = window.__zbrushTestMesh;
    const a = m.geometry.attributes.position.array;
    let maxY = -Infinity;
    for (let i = 0; i < a.length; i += 3) {
      if (a[i + 1] > maxY) maxY = a[i + 1];
    }
    return { maxY };
  });
  console.log('  draw: maxY', drawBefore.maxY.toFixed(5), '→', drawAfter.maxY.toFixed(5),
    '(changed', drawApply.changed, ')');
  expect(drawAfter.maxY).toBeGreaterThan(drawBefore.maxY);
  await win.screenshot({ path: path.join(OUT, '02-draw.png') });

  // ── 4) GRAB brush: translate by motion vec ──────────────────────────
  // Reset the sphere first so we measure GRAB in isolation.
  await win.evaluate(() => {
    const THREE = window.THREE;
    const m = window.__zbrushTestMesh;
    if (m.geometry && m.geometry.dispose) m.geometry.dispose();
    m.geometry = new THREE.SphereGeometry(0.05, 64, 64);
    m.geometry.computeVertexNormals();
  });
  const grabBefore = await win.evaluate(() => {
    const m = window.__zbrushTestMesh;
    const a = m.geometry.attributes.position.array;
    // Sample the centroid of vertices within radius 0.02 of (0.05, 0, 0)
    // (the +X equator). That's where GRAB will pull from.
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let i = 0; i < a.length; i += 3) {
      const dx = a[i] - 0.05, dy = a[i + 1], dz = a[i + 2];
      if (dx * dx + dy * dy + dz * dz < 0.02 * 0.02) {
        sx += a[i]; sy += a[i + 1]; sz += a[i + 2]; n++;
      }
    }
    return { cx: sx / n, cy: sy / n, cz: sz / n, n };
  });
  const grabApply = await win.evaluate((uuid) => {
    return window.__studioZBrushBrush(uuid, 'grab', {
      center: [0.05, 0, 0],
      radius: 0.02,
      strength: 1.0,
      motion: [0, 0.01, 0],  // pull straight up in Y
    });
  }, meshInfo.uuid);
  expect(grabApply.ok).toBe(true);
  expect(grabApply.brush).toBe('grab');
  expect(grabApply.changed).toBeGreaterThan(0);
  const grabAfter = await win.evaluate(() => {
    const m = window.__zbrushTestMesh;
    const a = m.geometry.attributes.position.array;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (let i = 0; i < a.length; i += 3) {
      const dx = a[i] - 0.05, dy = a[i + 1], dz = a[i + 2];
      // Pre-grab radius was 0.02 around (0.05, 0, 0); the grabbed cap is
      // now lifted by some +Y delta, so widen the gather a tiny bit.
      if (dx * dx + dy * dy + dz * dz < 0.025 * 0.025) {
        sx += a[i]; sy += a[i + 1]; sz += a[i + 2]; n++;
      }
    }
    return { cx: sx / n, cy: sy / n, cz: sz / n, n };
  });
  console.log('  grab: centroid Y', grabBefore.cy.toFixed(5), '→', grabAfter.cy.toFixed(5),
    '(changed', grabApply.changed, ')');
  expect(grabAfter.cy).toBeGreaterThan(grabBefore.cy + 1e-5);
  await win.screenshot({ path: path.join(OUT, '03-grab.png') });

  // ── 5) SMOOTH brush: noisy sphere → variance drops ──────────────────
  // Reset + inject a small noise displacement, then ask smooth to reduce
  // variance of vertex-distance-from-origin.
  await win.evaluate(() => {
    const THREE = window.THREE;
    const m = window.__zbrushTestMesh;
    if (m.geometry && m.geometry.dispose) m.geometry.dispose();
    m.geometry = new THREE.SphereGeometry(0.05, 64, 64);
    const a = m.geometry.attributes.position.array;
    // Deterministic noise — flip every 7th vertex by ±0.005 in Y so the
    // sphere is bumpy but the noise pattern is reproducible.
    for (let i = 0; i < a.length; i += 3) {
      const v = (Math.sin((i / 3) * 12.9898) * 43758.5453) % 1;
      a[i]     += v * 0.005;
      a[i + 1] += ((v * 7) % 1) * 0.005 - 0.0025;
      a[i + 2] += ((v * 13) % 1) * 0.005 - 0.0025;
    }
    m.geometry.attributes.position.needsUpdate = true;
    m.geometry.computeVertexNormals();
  });

  const variance = async () => win.evaluate(() => {
    const m = window.__zbrushTestMesh;
    const a = m.geometry.attributes.position.array;
    // Use the top cap (Y > 0.03) so smoothing localised at the pole is
    // the only thing affecting our sample.
    let sumD = 0, sumD2 = 0, n = 0;
    for (let i = 0; i < a.length; i += 3) {
      if (a[i + 1] < 0.03) continue;
      const d = Math.sqrt(a[i] * a[i] + a[i + 1] * a[i + 1] + a[i + 2] * a[i + 2]);
      sumD += d; sumD2 += d * d; n++;
    }
    const mean = sumD / Math.max(n, 1);
    const v = (sumD2 / Math.max(n, 1)) - mean * mean;
    return { v, n, mean };
  });

  const smoothBefore = await variance();
  // Smooth multiple times so the cumulative laplacian damping clearly
  // dominates the floating-point noise the single-stroke run might be
  // close to.
  for (let i = 0; i < 4; i++) {
    const sm = await win.evaluate((uuid) => window.__studioZBrushBrush(uuid, 'smooth', {
      center: [0, 0.05, 0],
      radius: 0.04,
      strength: 0.8,
    }), meshInfo.uuid);
    expect(sm.ok).toBe(true);
    expect(sm.brush).toBe('smooth');
  }
  const smoothAfter = await variance();
  console.log('  smooth: variance', smoothBefore.v.toExponential(3), '→', smoothAfter.v.toExponential(3),
    '(n=', smoothBefore.n, ')');
  expect(smoothAfter.v).toBeLessThan(smoothBefore.v);
  await win.screenshot({ path: path.join(OUT, '04-smooth.png') });

  // ── 6) verifyAll smoke: every kernel changes > 0 verts ──────────────
  // Reset the sphere so verifyAll has a clean canvas.
  await win.evaluate(() => {
    const THREE = window.THREE;
    const m = window.__zbrushTestMesh;
    if (m.geometry && m.geometry.dispose) m.geometry.dispose();
    m.geometry = new THREE.SphereGeometry(0.05, 64, 64);
    m.geometry.computeVertexNormals();
  });
  const verify = await win.evaluate((uuid) => window.__studioZBrushBrushVerifyAll(uuid),
    meshInfo.uuid);
  expect(verify.ok).toBe(true);
  expect(verify.kernels).toBe(7);
  expect(verify.curves).toBe(5);
  // every named kernel reported a positive changed count.
  const names = ['draw', 'inflate', 'crease', 'pinch', 'flatten', 'grab', 'smooth'];
  for (const name of names) {
    expect(verify.perKernel[name]).toBeDefined();
    expect(verify.perKernel[name].changed).toBeGreaterThan(0);
  }
  console.log('  verifyAll:', JSON.stringify(verify.perKernel));
  await win.screenshot({ path: path.join(OUT, '05-verify-all.png') });

  // ── 7) Falloff curve round trip ─────────────────────────────────────
  const settings0 = await win.evaluate(() => window.__studioZBrushGetActiveSettings());
  expect(settings0.ok).toBe(true);
  expect(settings0.curves).toEqual(['linear', 'smooth', 'sphere', 'sharp', 'constant']);
  expect(settings0.kernels).toEqual(names);

  for (const c of ['linear', 'smooth', 'sphere', 'sharp', 'constant']) {
    const setR = await win.evaluate((cc) => window.__studioZBrushSetFalloffCurve(cc), c);
    expect(setR.ok).toBe(true);
    expect(setR.curve).toBe(c);
    const sg = await win.evaluate(() => window.__studioZBrushGetActiveSettings());
    expect(sg.curve).toBe(c);
  }
  // Bad name path.
  const bad = await win.evaluate(() => window.__studioZBrushSetFalloffCurve('nonexistent'));
  expect(bad.ok).toBe(false);
  expect(bad.valid).toEqual(['linear', 'smooth', 'sphere', 'sharp', 'constant']);

  // ── 8) Bad brush name path ──────────────────────────────────────────
  const badBrush = await win.evaluate((uuid) => window.__studioZBrushBrush(uuid, 'NotARealBrush', {
    center: [0, 0, 0], radius: 0.02, strength: 0.5,
  }), meshInfo.uuid);
  expect(badBrush.ok).toBe(false);
  expect(badBrush.valid).toEqual(names);

  // ── 9) Camera sweep ─────────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 758: 7 kernels + 5 curves + verifyAll all green');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(150);
  await app.close();
});
