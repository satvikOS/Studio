import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-paintops');

test('Studio V3 — mask / texture / vertex-color / weight / AO / procedural (slice 409)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 250,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioPaintMaskAt === 'function', null, { timeout: 15000 });

  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let cube = null;
    vp.scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cube = o; });
    vp.transformControls.attach(cube);
  });

  // ─── Mask paint at (0.5, 0.5) with radius 0.2 ────────────────────────
  const paint = await win.evaluate(() => window.__studioPaintMaskAt(0.5, 0.5, 1, 0.2));
  expect(paint.ok).toBe(true);
  expect(paint.painted).toBeGreaterThan(100);
  expect(paint.sample).toBeCloseTo(1, 1);
  // Clear → sample at centre returns 0.
  await win.evaluate(() => window.__studioClearMask());
  const cleared = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const mask = m.userData.archdiscStudioMask;
    return mask.data[32 * 64 + 32]; // centre of 64x64
  });
  expect(cleared).toBe(0);
  // Invert empty mask → all 255.
  await win.evaluate(() => window.__studioInvertMask());
  const inv = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return m.userData.archdiscStudioMask.data[32 * 64 + 32];
  });
  expect(inv).toBe(255);

  // ─── Brush stroke (segment) ──────────────────────────────────────────
  await win.evaluate(() => window.__studioClearMask());
  const stroke = await win.evaluate(() => window.__studioBrushStrokeAt(0.2, 0.2, 0.8, 0.8, 0.05, 1));
  expect(stroke.ok).toBe(true);
  expect(stroke.stamps).toBeGreaterThan(0);

  // ─── Texture paint + readTexel ───────────────────────────────────────
  await win.evaluate(() => window.__studioPaintTextureAt(0.5, 0.5, [1, 0, 0], 0.1));
  const texel = await win.evaluate(() => window.__studioReadTexel(0.5, 0.5));
  expect(texel.color[0]).toBeCloseTo(1, 1);
  expect(texel.color[1]).toBeCloseTo(0, 1);

  // ─── Normal map bake + read ──────────────────────────────────────────
  const baked = await win.evaluate(() => window.__studioBakeNormalFromHeight());
  expect(baked.ok).toBe(true);
  const n = await win.evaluate(() => window.__studioReadNormalTexel(0.5, 0.5));
  expect(n.ok).toBe(true);
  // Normal should be a unit vector.
  const len = Math.hypot(...n.normal);
  expect(len).toBeCloseTo(1, 3);

  // ─── Vertex color (polyPaint) ────────────────────────────────────────
  expect((await win.evaluate(() => window.__studioPolyPaintAt(0, [1, 0, 0]))).ok).toBe(true);
  expect((await win.evaluate(() => window.__studioReadVertexColor(0))).color).toEqual([1, 0, 0]);

  // ─── Weight paint ────────────────────────────────────────────────────
  expect((await win.evaluate(() => window.__studioWeightPaintAt(5, 0.7))).ok).toBe(true);
  expect((await win.evaluate(() => window.__studioReadWeight(5))).weight).toBeCloseTo(0.7, 5);
  // Clamping: > 1 should clamp to 1.
  await win.evaluate(() => window.__studioWeightPaintAt(5, 2.5));
  expect((await win.evaluate(() => window.__studioReadWeight(5))).weight).toBe(1);

  // ─── Procedural texture ──────────────────────────────────────────────
  for (const kind of ['noise', 'gradient-x', 'gradient-y', 'checker']) {
    const r = await win.evaluate((k) => window.__studioProceduralTexture(k, { seed: 7 }), kind);
    expect(r.ok).toBe(true);
    expect(r.kind).toBe(kind);
  }
  // Checker pattern: pixel (0,0) should differ from (8,0).
  await win.evaluate(() => window.__studioProceduralTexture('checker'));
  const t1 = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const tex = m.userData.archdiscStudioTex;
    return { a: tex.data[0], b: tex.data[8 * 4] };
  });
  expect(t1.a).not.toBe(t1.b);

  // ─── Bake AO ─────────────────────────────────────────────────────────
  const ao = await win.evaluate(() => window.__studioBakeAO());
  expect(ao.ok).toBe(true);
  expect(ao.vertCount).toBe(24);
  const aoTex = await win.evaluate(() => window.__studioBakeAOToTexture());
  expect(aoTex.ok).toBe(true);

  // ─── Project paint from camera ───────────────────────────────────────
  const proj = await win.evaluate(() => window.__studioProjectPaintFromCamera([0.2, 0.4, 0.6]));
  expect(proj.ok).toBe(true);

  await win.screenshot({ path: path.join(OUT, '00-after-paintops.png') });

  await win.evaluate(() => {
    window.localStorage.removeItem('studioV3');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });

  // eslint-disable-next-line no-console
  console.log('  slice 409: mask + stroke + tex + normal + vcolor + weight + procedural + AO all green');

  await app.close();
});
