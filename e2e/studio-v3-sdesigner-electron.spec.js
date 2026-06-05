import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-sdesigner');

// 25 kind names baked into the spec — must mirror
// SDESIGNER_NODE_KIND_LIST in
// frontend/src/workbenches/studio/v3/sdesigner/morenodes.js.
const KINDS = [
  // Noises (8)
  'perlin', 'fractalsum', 'worley', 'cells', 'cloud', 'crystals', 'fibers', 'plasma',
  // Patterns (6)
  'stars', 'polka', 'trihex', 'honeycomb', 'sawtooth', 'triangle',
  // Filters (8)
  'blur', 'sharpen', 'emboss', 'edgedetect', 'threshold', 'posterize', 'hueshift', 'satboost',
  // Blends (3)
  'overlayblend', 'multiplyblend', 'screenblend',
];

// Multi-output kinds emit a { name → value } object; the rest emit a
// length-3 colour array.
const MULTI = new Set([
  'perlin', 'fractalsum', 'worley', 'cells', 'cloud', 'crystals', 'fibers', 'plasma',
  'stars', 'polka', 'trihex', 'honeycomb', 'sawtooth', 'triangle',
]);

test('Studio V3 — sdesigner 25 Substance-Designer-style shader node kinds', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 250,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  // Force V3 + suppress splash / tour so we land directly in the shell.
  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioSelectedMesh === 'function', null, { timeout: 15000 });

  // Install the sdesigner registry. Since api.js isn't wired to load
  // it on boot, dynamically import the autoload module on the Vite dev
  // server.
  await win.evaluate(async () => {
    if (typeof window.__studioSDesignerApply !== 'function') {
      await import('/src/workbenches/studio/v3/sdesigner/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioSDesignerApply === 'function', null, { timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioSDesignerList === 'function', null, { timeout: 15000 });

  // ── Surface check: all 25 kinds registered. ────────────────────────
  const listed = await win.evaluate(() => window.__studioSDesignerList());
  expect(listed.ok).toBe(true);
  expect(listed.count).toBe(25);
  for (const k of KINDS) expect(listed.kinds).toContain(k);

  // ── window.__studioSDesignerNodes map populated. ───────────────────
  const haveMap = await win.evaluate(() => {
    return !!(window.__studioSDesignerNodes && typeof window.__studioSDesignerNodes === 'object');
  });
  expect(haveMap).toBe(true);

  // ── Spawn a cube so we have something in the viewport. ─────────────
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(400);
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let cube = null;
    vp.scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cube = o; });
    if (cube) vp.transformControls.attach(cube);
  });
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '00-cube.png') });

  // ── Drive every kind through __studioSDesignerApply and assert a
  //    sane evaluator result.
  const evals = await win.evaluate((kinds) => {
    const out = {};
    for (const k of kinds) {
      const r = window.__studioSDesignerApply(k, {}, {
        uv: [0.3, 0.7],
        color: [0.5, 0.5, 0.5],
        a: [0.4, 0.6, 0.2],
        b: [0.7, 0.3, 0.8],
      }, {
        u: 0.3, v: 0.7, x: 76, y: 178, size: 256,
        worldX: 0.6, worldY: -0.2, worldZ: 0.4,
      });
      out[k] = r;
    }
    return out;
  }, KINDS);

  for (const k of KINDS) {
    expect(evals[k]).toBeTruthy();
    expect(evals[k].ok).toBe(true);
    const v = evals[k].value;
    if (MULTI.has(k)) {
      expect(typeof v).toBe('object');
      expect(Array.isArray(v)).toBe(false);
      // Every multi-output emits at least { color: [...], fac: number }.
      expect(Array.isArray(v.color)).toBe(true);
      expect(v.color.length).toBeGreaterThanOrEqual(3);
      expect(Number.isFinite(v.color[0])).toBe(true);
      expect(typeof v.fac).toBe('number');
      expect(Number.isFinite(v.fac)).toBe(true);
    } else {
      // colour-only kinds — must be a length-3 array of finite numbers.
      expect(Array.isArray(v)).toBe(true);
      expect(v.length).toBeGreaterThanOrEqual(3);
      expect(Number.isFinite(v[0])).toBe(true);
      expect(Number.isFinite(v[1])).toBe(true);
      expect(Number.isFinite(v[2])).toBe(true);
    }
  }

  // ── Verify a couple of specific outputs are not garbage:

  // Threshold(0.6) of 0.8 → 1; of 0.4 → 0.
  const thHigh = await win.evaluate(() => window.__studioSDesignerApply(
    'threshold', { level: 0.6 }, { color: [0.8, 0.8, 0.8] },
  ));
  expect(thHigh.ok).toBe(true);
  expect(thHigh.value[0]).toBe(1);
  const thLow = await win.evaluate(() => window.__studioSDesignerApply(
    'threshold', { level: 0.6 }, { color: [0.4, 0.4, 0.4] },
  ));
  expect(thLow.ok).toBe(true);
  expect(thLow.value[0]).toBe(0);

  // Posterize(2) of any > 0.5 → 1; < 0.5 → 0.
  const post = await win.evaluate(() => window.__studioSDesignerApply(
    'posterize', { levels: 2 }, { color: [0.7, 0.3, 0.9] },
  ));
  expect(post.ok).toBe(true);
  expect(post.value[0]).toBe(1);
  expect(post.value[1]).toBe(0);
  expect(post.value[2]).toBe(1);

  // MultiplyBlend of [0.5,0.5,0.5] × [0.5,0.5,0.5] @ fac=1 → 0.25.
  const mul = await win.evaluate(() => window.__studioSDesignerApply(
    'multiplyblend', { fac: 1 }, { a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], fac: 1 },
  ));
  expect(mul.ok).toBe(true);
  expect(mul.value[0]).toBeCloseTo(0.25, 5);

  // ScreenBlend of [0.5,0.5,0.5] @ fac=1 → 1 - 0.5*0.5 = 0.75.
  const scr = await win.evaluate(() => window.__studioSDesignerApply(
    'screenblend', { fac: 1 }, { a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], fac: 1 },
  ));
  expect(scr.ok).toBe(true);
  expect(scr.value[0]).toBeCloseTo(0.75, 5);

  // OverlayBlend of [0.25, 0.75, 0.5] over [0.5, 0.5, 0.5] @ fac=1:
  //   a<0.5: 2*a*b=2*0.25*0.5=0.25; a>0.5: 1-2*(1-a)(1-b)=1-2*0.25*0.5=0.75;
  //   a=0.5 (overlay branch x<0.5 is false): 1-2*(0.5)*(0.5)=0.5.
  const ov = await win.evaluate(() => window.__studioSDesignerApply(
    'overlayblend', { fac: 1 }, { a: [0.25, 0.75, 0.5], b: [0.5, 0.5, 0.5], fac: 1 },
  ));
  expect(ov.ok).toBe(true);
  expect(ov.value[0]).toBeCloseTo(0.25, 5);
  expect(ov.value[1]).toBeCloseTo(0.75, 5);
  expect(ov.value[2]).toBeCloseTo(0.5, 5);

  // HueShift +0.5 of pure red [1,0,0] → cyan-ish [0,1,1].
  const hs = await win.evaluate(() => window.__studioSDesignerApply(
    'hueshift', { shift: 0.5 }, { color: [1, 0, 0] },
  ));
  expect(hs.ok).toBe(true);
  expect(hs.value[0]).toBeCloseTo(0, 5);
  expect(hs.value[1]).toBeCloseTo(1, 5);
  expect(hs.value[2]).toBeCloseTo(1, 5);

  // SaturationBoost x0 (greyscale) of [1,0,0] → all channels equal.
  const sb = await win.evaluate(() => window.__studioSDesignerApply(
    'satboost', { amount: 0 }, { color: [1, 0, 0] },
  ));
  expect(sb.ok).toBe(true);
  expect(sb.value[0]).toBeCloseTo(sb.value[1], 5);
  expect(sb.value[1]).toBeCloseTo(sb.value[2], 5);

  // Sawtooth at u=0.25 with scale=1 → fract(0.25) = 0.25.
  const saw = await win.evaluate(() => window.__studioSDesignerApply(
    'sawtooth', { scale: 1, axis: 'x' }, { uv: [0.25, 0] },
  ));
  expect(saw.ok).toBe(true);
  expect(saw.value.fac).toBeCloseTo(0.25, 5);

  // Triangle at u=0.25 with scale=1 → 0.5 (rising slope of triangle).
  const tri = await win.evaluate(() => window.__studioSDesignerApply(
    'triangle', { scale: 1, axis: 'x' }, { uv: [0.25, 0] },
  ));
  expect(tri.ok).toBe(true);
  expect(tri.value.fac).toBeCloseTo(0.5, 5);

  // Polka centred sample (uv aligned to scale=8, dot at integer offset
  // 0.5 → exactly on a centre) should be inside the dot.
  const pol = await win.evaluate(() => window.__studioSDesignerApply(
    'polka', { scale: 8, radius: 0.3, color1: [1, 1, 1], color2: [0, 0, 0] },
    { uv: [0.5 / 8, 0.5 / 8] },
  ));
  expect(pol.ok).toBe(true);
  expect(pol.value.fac).toBe(1);

  // ── Per-kind window.__studioSDesigner_<kind> ops exposed. ───────────
  const opShape = await win.evaluate((kinds) => {
    const out = {};
    for (const k of kinds) {
      out[k] = typeof window[`__studioSDesigner_${k}`] === 'function';
    }
    return out;
  }, KINDS);
  for (const k of KINDS) expect(opShape[k]).toBe(true);

  // ── Command palette registrations under category 'shader'. ─────────
  const cmdShader = await win.evaluate(() => {
    if (typeof window.__studioCommandList !== 'function') return null;
    return window.__studioCommandList('shader');
  });
  if (cmdShader && cmdShader.ok) {
    const names = cmdShader.commands.map((c) => c.name);
    for (const k of KINDS) {
      expect(names).toContain(`__studioSDesigner_${k}`);
    }
    expect(names).toContain('__studioSDesignerApply');
    expect(names).toContain('__studioSDesignerList');
  }

  await win.screenshot({ path: path.join(OUT, '01-after-evals.png') });

  // ── Multi-cam viewport screenshots (front / top / right / iso / close).
  for (const view of ['front', 'top', 'right', 'iso', 'close']) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport; if (!vp || !vp.camera) return;
      const c = vp.camera;
      if (v === 'front') c.position.set(0, 0, 6);
      else if (v === 'top') c.position.set(0, 6, 0.001);
      else if (v === 'right') c.position.set(6, 0, 0);
      else if (v === 'iso') c.position.set(4, 4, 4);
      else if (v === 'close') c.position.set(1.8, 1.5, 2.0);
      c.lookAt(0, 0, 0);
    }, view);
    await win.waitForTimeout(200);
    await win.screenshot({ path: path.join(OUT, `02-cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  sdesigner: kinds=%d', listed.count);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
