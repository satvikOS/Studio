import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Video-80 build with REAL human head asset, single sustained session.
 *
 * Iterates against the photoreal portrait reference with a proper character mesh
 * (LeePerrySmith, a classic CC-licensed head used in three.js demos) instead of
 * a sphere or Suzanne — the right baseline for a photoreal portrait target.
 * Pipeline: load asset via __studioImportAsset -> select -> probe extents ->
 * polypaint skin / brows / lips / moles with LR-scaled radii -> AO bake (this
 * head has clean topology + UVs so the bake reads cleanly) -> render alongside
 * the live Video-80 reference overlay at multiple angles.
 */

const REF_URL = 'file:///C:/Users/satvi/archdisc-Studio/Videos-%20Must%20Process/Video-80.mp4';
const ASSET_URL = 'file:///C:/Users/satvi/archdisc-Studio/assets/LeePerrySmith.glb';
const OUT = path.resolve(__dirname, 'screenshots', 'studio-video80-leeperry');

test('Studio — Video-80 with imported character head (LeePerrySmith)', async () => {
  test.setTimeout(360000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: Number(process.env.STUDIO_SLOWMO) || 220 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioImportAsset === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(400);

  // PHASE 0 — reference + empty viewport
  await win.evaluate((u) => window.__studioSetReference(u), REF_URL);
  await expect(win.locator('[data-studio-reference-overlay]')).toBeVisible({ timeout: 5000 });
  await win.waitForTimeout(400);
  await win.screenshot({ path: path.join(OUT, '00-ref-only.png') });

  // PHASE 1 — import the real character head via file:// fetch
  const imported = await win.evaluate(async (u) => {
    const r = await fetch(u); const buf = await r.arrayBuffer();
    const res = await window.__studioImportAsset('glb', buf);
    return res;
  }, ASSET_URL);
  // eslint-disable-next-line no-console
  console.log('  import result:', JSON.stringify(imported));
  expect(imported.error, 'imported without error').toBeFalsy();
  expect(imported.added, 'at least one mesh imported').toBeGreaterThan(0);
  await win.waitForTimeout(400);

  // Find the imported head (largest archdiscStudioPrimitive mesh just added) and select it.
  const xform = await win.evaluate(() => {
    const s = window.__archdiscScene; let best = null, bestVerts = 0;
    s.traverse((o) => {
      if (!o.isMesh || !(o.userData && o.userData.archdiscStudioPrimitive)) return;
      const v = o.geometry && o.geometry.attributes && o.geometry.attributes.position ? o.geometry.attributes.position.count : 0;
      if (v > bestVerts) { bestVerts = v; best = o; }
    });
    if (!best) return null;
    if (best.geometry && !best.geometry.boundingBox) best.geometry.computeBoundingBox();
    const bb = best.geometry.boundingBox;
    let mxx = 0, mxy = 0, mxz = 0; const pos = best.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = Math.abs(pos.getX(i)), y = Math.abs(pos.getY(i)), z = Math.abs(pos.getZ(i));
      if (x > mxx) mxx = x; if (y > mxy) mxy = y; if (z > mxz) mxz = z;
    }
    window.__studioSelectMesh(best);
    return { name: best.name, vCount: bestVerts, pos: [best.position.x, best.position.y, best.position.z], scale: [best.scale.x, best.scale.y, best.scale.z], box: [bb.min.x, bb.max.x, bb.min.y, bb.max.y, bb.min.z, bb.max.z], localHalf: [mxx, mxy, mxz] };
  });
  // eslint-disable-next-line no-console
  console.log('  imported head xform:', JSON.stringify(xform));
  expect(xform, 'head selected').not.toBeNull();
  const LR = Math.max(xform.localHalf[0], xform.localHalf[1], xform.localHalf[2]) * 0.28;

  // Frame + capture baseline (pre-polypaint), camera at a comfortable distance
  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(0, 4, 1.5); });
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '01-imported.png') });

  // PHASE 2 — refined polypaint (denser stubble, darker sockets, defined lips,
  //   slight neutral mix to soften the over-warm baseline).
  await win.evaluate(({ lh, lr }) => {
    const PP = (p, c, r) => window.__studioPolyPaintAt(p, c, r);
    const ga = Math.PI * (3 - Math.sqrt(5));
    // base skin tone — slightly cooler/neutral so it doesn't read orange
    const N = 280;
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2; const r = Math.sqrt(Math.max(0, 1 - y * y));
      const ang = i * ga;
      PP([Math.cos(ang) * r * lh[0] * 1.05, y * lh[1] * 1.05, Math.sin(ang) * r * lh[2] * 1.05], '#c0998a', lr * 1.4);
    }
    // mid-tone variation on the face
    for (let i = 0; i < 100; i++) {
      const y = -0.25 + (i / 99) * 0.6; const r = Math.sqrt(Math.max(0, 1 - y * y));
      const ang = i * ga * 1.3;
      PP([Math.cos(ang) * r * lh[0] * 1.0, y * lh[1] * 1.0, Math.sin(ang) * r * lh[2] * 1.05], '#a87f6e', lr * 0.55);
    }
    // DENSE stubble — many small dark dabs across the scalp + lower jaw region
    for (let i = 0; i < 240; i++) {
      const t = i / 239; const y = 0.35 + t * 0.65;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const ang = i * ga * 1.9;
      PP([Math.cos(ang) * r * lh[0] * 1.04, y * lh[1] * 1.04, Math.sin(ang) * r * lh[2] * 1.04], '#3a2c20', lr * 0.18);
    }
    // jaw stubble
    for (let i = 0; i < 100; i++) {
      const t = i / 99; const y = -0.55 + t * 0.35;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const ang = i * ga * 1.6;
      PP([Math.cos(ang) * r * lh[0] * 1.04, y * lh[1] * 1.04, Math.sin(ang) * r * lh[2] * 1.04], '#5a4030', lr * 0.18);
    }
    // brows — denser + darker
    for (let i = -5; i <= 5; i++) {
      PP([(-0.30 + i * 0.030) * lh[0], 0.30 * lh[1], 0.92 * lh[2]], '#1c0e08', lr * 0.26);
      PP([( 0.30 + i * 0.030) * lh[0], 0.30 * lh[1], 0.92 * lh[2]], '#1c0e08', lr * 0.26);
    }
    // eye sockets — much darker (read as depth)
    PP([-0.30 * lh[0], 0.18 * lh[1], 0.85 * lh[2]], '#4c3a30', lr * 0.50);
    PP([ 0.30 * lh[0], 0.18 * lh[1], 0.85 * lh[2]], '#4c3a30', lr * 0.50);
    PP([-0.30 * lh[0], 0.12 * lh[1], 0.88 * lh[2]], '#5a4438', lr * 0.40);
    PP([ 0.30 * lh[0], 0.12 * lh[1], 0.88 * lh[2]], '#5a4438', lr * 0.40);
    // lips — better defined
    PP([0,     -0.18 * lh[1], 0.92 * lh[2]], '#9d5b4a', lr * 0.55);
    PP([0,     -0.22 * lh[1], 0.92 * lh[2]], '#8a4f3e', lr * 0.45);
    PP([-0.12 * lh[0], -0.20 * lh[1], 0.90 * lh[2]], '#9a5946', lr * 0.32);
    PP([ 0.12 * lh[0], -0.20 * lh[1], 0.90 * lh[2]], '#9a5946', lr * 0.32);
    // shadow under chin (gives proper jaw definition)
    PP([0, -0.55 * lh[1], 0.55 * lh[2]], '#7a5a48', lr * 0.55);
    PP([-0.18 * lh[0], -0.45 * lh[1], 0.60 * lh[2]], '#8a6a54', lr * 0.40);
    PP([ 0.18 * lh[0], -0.45 * lh[1], 0.60 * lh[2]], '#8a6a54', lr * 0.40);
    // nose-side shadow
    PP([-0.10 * lh[0], 0.05 * lh[1], 0.90 * lh[2]], '#a07560', lr * 0.30);
    PP([ 0.10 * lh[0], 0.05 * lh[1], 0.90 * lh[2]], '#a07560', lr * 0.30);
    // ears — slightly redder/warm
    PP([-0.95 * lh[0], 0.08 * lh[1], 0.05 * lh[2]], '#b07868', lr * 0.50);
    PP([ 0.95 * lh[0], 0.08 * lh[1], 0.05 * lh[2]], '#b07868', lr * 0.50);
    // moles / freckles
    for (const m of [
      [-0.42, 0.05, 0.92], [0.38, 0.04, 0.92], [-0.18, -0.05, 0.96],
      [0.16, -0.08, 0.95], [-0.30, -0.30, 0.80], [0.32, -0.28, 0.80],
      [-0.10, 0.45, 0.92], [0.18, -0.50, 0.82],
    ]) PP([m[0] * lh[0], m[1] * lh[1], m[2] * lh[2]], '#4a3020', lr * 0.18);
  }, { lh: xform.localHalf, lr: LR });

  const ppProbe = await win.evaluate(() => {
    const m = window.__studioSelectedMesh(); const col = m.geometry.attributes.color;
    if (!col) return { hasColor: false };
    let sR = 0, sG = 0, sB = 0, vR = 0, n = col.count;
    for (let i = 0; i < n; i++) { sR += col.getX(i); sG += col.getY(i); sB += col.getZ(i); }
    const mR = sR / n;
    for (let i = 0; i < n; i++) vR += (col.getX(i) - mR) ** 2;
    return { hasColor: true, count: n, avg: [mR, sG / n, sB / n], varR: vR / n, matHex: m.material.color.getHexString(), matVC: m.material.vertexColors };
  });
  // eslint-disable-next-line no-console
  console.log('  polypaint probe:', JSON.stringify(ppProbe));
  await win.waitForTimeout(300);

  // Multi-angle finals at a tighter framing
  const angle = async (az, el, dist, tag) => {
    await win.evaluate(({ az, el, dist }) => {
      window.__studioFrameAll && window.__studioFrameAll();
      window.__archdiscOrbitView && window.__archdiscOrbitView(az, el, dist);
    }, { az, el, dist });
    await win.waitForTimeout(350);
    await win.screenshot({ path: path.join(OUT, tag + '.png') });
  };
  await angle(0, 4, 1.5, '02-front');
  await angle(25, 6, 1.5, '03-three-quarter-right');
  await angle(-25, 6, 1.5, '04-three-quarter-left');
  await angle(90, 0, 1.5, '05-profile-right');

  // eslint-disable-next-line no-console
  console.log('  build with imported head done.');

  await app.close();
});
