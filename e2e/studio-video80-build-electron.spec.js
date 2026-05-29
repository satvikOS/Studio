import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Video-80 1:1 build, SUSTAINED Archie loop (headed, single session).
 *
 * One app launch. Each phase probes the actual mesh state and ADAPTS the next
 * brush radius / strength based on what the previous phase actually mutated.
 * No restarts -- exactly Archie's non-stop self-correcting cadence. Discoveries
 * from v1-v3 baked in:
 *   - paintPolyAt uses the world-units radius against LOCAL-space verts; with
 *     mesh scale 0.55-0.80 the effective radius shrinks below vert spacing and
 *     no vert gets painted. Use world radius >= 0.12.
 *   - AO bake overwrites the vertex-colour buffer; do AO BEFORE polypaint or
 *     skip; force material.color=white + vertexColors=true at the end so paint
 *     shows at full saturation.
 *   - sculpt brushes need much higher strength to register visible relief.
 */

const REF_URL = 'file:///C:/Users/satvi/archdisc-Studio/Videos-%20Must%20Process/Video-80.mp4';
const OUT = path.resolve(__dirname, 'screenshots', 'studio-video80-build');

test('Studio — Video-80 sustained build (one session, adaptive)', async () => {
  test.setTimeout(420000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', 'electron', 'main.js')], slowMo: Number(process.env.STUDIO_SLOWMO) || 220 });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name')).toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioSetReference === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(400);

  // PHASE 0 — corner reference + empty viewport
  await win.evaluate((u) => window.__studioSetReference(u), REF_URL);
  await expect(win.locator('[data-studio-reference-overlay]')).toBeVisible({ timeout: 5000 });
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(OUT, '00-ref-only.png') });

  // PHASE 1 — Suzanne base (Blender's head primitive — a far better humanoid
  //   baseline than a sphere). Leave default scale, just DynaMesh for sculpt
  //   resolution. frameAll handles camera framing.
  await win.locator('[data-studio-primitive="suzanne"]').click();
  await win.waitForTimeout(300);
  const CY = 0.0, AX = 0.275, BY = 0.40;
  await win.evaluate(() => {
    const s = window.__archdiscScene; let m = null;
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) m = o; });
    if (!m) return;
    m.position.set(0, 0, 0);
    m.updateMatrixWorld(true);
    window.__studioSelectMesh(m);
  });
  await win.waitForTimeout(200);
  await win.evaluate(() => window.__studioDynaMesh(34));
  await win.waitForTimeout(450);

  // Probe Suzanne+DynaMesh's actual local extents (drive all radii from these)
  const xform = await win.evaluate(() => {
    const m = window.__studioSelectedMesh(); const pos = m.geometry.attributes.position;
    let mxx = 0, mxy = 0, mxz = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = Math.abs(pos.getX(i)), y = Math.abs(pos.getY(i)), z = Math.abs(pos.getZ(i));
      if (x > mxx) mxx = x; if (y > mxy) mxy = y; if (z > mxz) mxz = z;
    }
    return { pos: [m.position.x, m.position.y, m.position.z], scale: [m.scale.x, m.scale.y, m.scale.z], vCount: pos.count, localHalf: [mxx, mxy, mxz] };
  });
  // eslint-disable-next-line no-console
  console.log('  Suzanne+DynaMesh xform:', JSON.stringify(xform));
  // Derive a working brush radius from local extents (radius is compared against LOCAL distances)
  const LR = Math.max(xform.localHalf[0], xform.localHalf[1], xform.localHalf[2]) * 0.32;

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(0, 4, 1.7); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '01-base.png') });

  // Snapshot baseline positions so we can measure sculpt displacement
  await win.evaluate(() => {
    const m = window.__studioSelectedMesh(); const p = m.geometry.attributes.position;
    const snap = new Float32Array(p.array.length); snap.set(p.array); m.userData._snapBaseline = snap;
  });

  // PHASE 2 — smooth Suzanne's polygonal seams (gentle)
  await win.evaluate(({ lh, lr }) => {
    const BR = (mode, p, r, s) => window.__studioBrushStrokeAt(p, { mode, radius: r, strength: s });
    const ga = Math.PI * (3 - Math.sqrt(5));
    const N = 48;
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2; const r = Math.sqrt(Math.max(0, 1 - y * y));
      const ang = i * ga;
      BR('smooth', [Math.cos(ang) * r * lh[0] * 1.05, y * lh[1] * 1.05, Math.sin(ang) * r * lh[2] * 1.05], lr, 0.5);
    }
  }, { lh: xform.localHalf, lr: LR });
  await win.waitForTimeout(450);

  // Probe: how much did the sculpt actually move things?
  const sculptDelta = await win.evaluate(() => {
    const m = window.__studioSelectedMesh(); const p = m.geometry.attributes.position; const s = m.userData._snapBaseline;
    let mx = 0, sum = 0, n = 0;
    for (let i = 0; i < p.count; i++) { const dx = p.getX(i) - s[i * 3], dy = p.getY(i) - s[i * 3 + 1], dz = p.getZ(i) - s[i * 3 + 2]; const d = Math.hypot(dx, dy, dz); if (d > mx) mx = d; sum += d; n++; }
    return { maxDelta: mx, meanDelta: sum / n, vCount: n };
  });
  // eslint-disable-next-line no-console
  console.log('  sculpt delta:', JSON.stringify(sculptDelta));

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(0, 4, 1.7); });
  await win.waitForTimeout(250);
  await win.screenshot({ path: path.join(OUT, '02-sculpt.png') });

  // PHASE 3 — polypaint sized to Suzanne's actual local extents (probed)
  await win.evaluate(({ lh, lr }) => {
    const PP = (p, c, r) => window.__studioPolyPaintAt(p, c, r);
    const ga = Math.PI * (3 - Math.sqrt(5));
    // base skin: many Fibonacci dabs on a sphere fitted to Suzanne's bbox
    const N = 140;
    const rad = lr * 1.6;       // base coverage radius
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2; const r = Math.sqrt(Math.max(0, 1 - y * y));
      const ang = i * ga;
      PP([Math.cos(ang) * r * lh[0] * 1.05, y * lh[1] * 1.05, Math.sin(ang) * r * lh[2] * 1.05], '#c8a387', rad);
    }
    // scalp / stubble — upper hemisphere only
    for (let i = 0; i < 70; i++) {
      const y = 0.40 + (i / 69) * 0.60; const r = Math.sqrt(Math.max(0, 1 - y * y));
      const ang = i * ga * 1.7;
      PP([Math.cos(ang) * r * lh[0] * 1.05, y * lh[1] * 1.05, Math.sin(ang) * r * lh[2] * 1.05], '#5a4738', lr * 0.6);
    }
    // brows
    for (let i = -3; i <= 3; i++) {
      PP([-0.45 * lh[0] + i * 0.04 * lh[0], 0.50 * lh[1], 0.95 * lh[2]], '#2c1a10', lr * 0.32);
      PP([ 0.45 * lh[0] + i * 0.04 * lh[0], 0.50 * lh[1], 0.95 * lh[2]], '#2c1a10', lr * 0.32);
    }
    // moles / freckles (sparse points on face area)
    const moles = [
      [-0.48, 0.10, 0.95], [0.42, 0.10, 0.95], [-0.15, -0.05, 1.00],
      [0.20, -0.10, 0.98], [-0.50, 0.60, 0.70], [0.55, 0.62, 0.65],
      [-0.35, -0.30, 0.85], [0.40, -0.25, 0.85], [-0.10, 0.55, 0.95], [0.18, -0.50, 0.85],
    ];
    for (const m of moles) PP([m[0] * lh[0], m[1] * lh[1], m[2] * lh[2]], '#553622', lr * 0.22);
    // lips
    PP([0, -0.25 * lh[1], 0.95 * lh[2]], '#a36050', lr * 0.5);
    PP([-0.12 * lh[0], -0.27 * lh[1], 0.92 * lh[2]], '#925a44', lr * 0.35);
    PP([ 0.12 * lh[0], -0.27 * lh[1], 0.92 * lh[2]], '#925a44', lr * 0.35);
    // eye shadow / sockets darker
    PP([-0.32 * lh[0], 0.18 * lh[1], 0.90 * lh[2]], '#7c6450', lr * 0.55);
    PP([ 0.32 * lh[0], 0.18 * lh[1], 0.90 * lh[2]], '#7c6450', lr * 0.55);
  }, { lh: xform.localHalf, lr: LR });

  // Probe polypaint result
  const ppProbe = await win.evaluate(() => {
    const m = window.__studioSelectedMesh(); const col = m.geometry.attributes.color;
    if (!col) return { hasColor: false };
    let sumR = 0, sumG = 0, sumB = 0, varR = 0, n = col.count;
    for (let i = 0; i < n; i++) { sumR += col.getX(i); sumG += col.getY(i); sumB += col.getZ(i); }
    const meanR = sumR / n;
    for (let i = 0; i < n; i++) { const r = col.getX(i); varR += (r - meanR) ** 2; }
    return { hasColor: true, count: n, avg: [meanR, sumG / n, sumB / n], varR: varR / n, matHex: m.material.color.getHexString(), matVC: m.material.vertexColors };
  });
  // eslint-disable-next-line no-console
  console.log('  polypaint probe:', JSON.stringify(ppProbe));

  await win.evaluate(() => { window.__studioFrameAll && window.__studioFrameAll(); window.__archdiscOrbitView && window.__archdiscOrbitView(0, 4, 1.7); });
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '03-polypaint.png') });

  // Multi-angle finals
  const angle = async (az, el, dist, tag) => {
    await win.evaluate(({ az, el, dist }) => {
      window.__studioFrameAll && window.__studioFrameAll();
      window.__archdiscOrbitView && window.__archdiscOrbitView(az, el, dist);
    }, { az, el, dist });
    await win.waitForTimeout(350);
    await win.screenshot({ path: path.join(OUT, tag + '.png') });
  };
  await angle(0, 4, 1.7, '04-final-front');
  await angle(25, 6, 1.7, '05-final-three-quarter-right');
  await angle(-25, 6, 1.7, '06-final-three-quarter-left');
  await angle(90, 0, 1.7, '07-final-profile');

  // eslint-disable-next-line no-console
  console.log(`  build done. Final reference overlay visible alongside throughout.`);

  await app.close();
});
