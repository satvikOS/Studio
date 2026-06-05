import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-shaderdeep');

// 20 kind names baked into the spec — must mirror MORE_NODE_KIND_LIST
// in frontend/src/workbenches/studio/v3/shaderdeep/morenodes.js.
const KINDS = [
  'brick', 'wave', 'magic', 'musgrave', 'voronoi',
  'checker3d', 'gradient3d', 'hsv', 'invertcolor', 'gamma',
  'brightcontrast', 'coloradd', 'colorsub', 'colormul', 'colordiv',
  'separatergb', 'combinergb', 'dot', 'length', 'distance',
  'normalmap', 'fresnel', 'aofake',
];

test('Studio V3 — shaderdeep 20 deeper Cycles-style node kinds', async () => {
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

  // Install the deeper-shader registry. If the orchestrator hasn't
  // wired the autoload via api.js, fall back to a direct dynamic
  // import of the autoload module on the Vite dev server.
  await win.evaluate(async () => {
    if (typeof window.__studioShaderDeepApply !== 'function') {
      await import('/src/workbenches/studio/v3/shaderdeep/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioShaderDeepApply === 'function', null, { timeout: 15000 });
  await win.waitForFunction(() => typeof window.__studioShaderDeepList === 'function', null, { timeout: 15000 });

  // ── Surface check: all 20 kinds registered. ────────────────────────
  const listed = await win.evaluate(() => window.__studioShaderDeepList());
  expect(listed.ok).toBe(true);
  expect(listed.count).toBe(23); // 20 listed in brief, 4 ColorMath split = 23 total
  for (const k of KINDS) expect(listed.kinds).toContain(k);

  // ── window.__studioShaderDeepNodes map populated. ──────────────────
  const haveMap = await win.evaluate(() => {
    return !!(window.__studioShaderDeepNodes && typeof window.__studioShaderDeepNodes === 'object');
  });
  expect(haveMap).toBe(true);

  // ── Spawn a cube so apply-to-selection has a target. ───────────────
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

  // ── Drive every kind through __studioShaderDeepApply and assert a
  //    sane evaluator result. The 9 multi-output kinds emit a plain
  //    object; the 14 single-output kinds emit a colour array or float.
  const MULTI = new Set([
    'brick', 'wave', 'magic', 'voronoi', 'checker3d', 'gradient3d', 'separatergb',
  ]);
  const FLOAT_ONLY = new Set([
    'musgrave', 'dot', 'length', 'distance', 'fresnel', 'aofake',
  ]);

  const evals = await win.evaluate((kinds) => {
    const out = {};
    for (const k of kinds) {
      const r = window.__studioShaderDeepApply(k, {}, {}, {
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
    } else if (FLOAT_ONLY.has(k)) {
      expect(typeof v).toBe('number');
      expect(Number.isFinite(v)).toBe(true);
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
  //    Brick at uv (0,0) sits on a mortar line → fac = 1.
  const brickEdge = await win.evaluate(() => window.__studioShaderDeepApply('brick', {}, { uv: [0, 0] }));
  expect(brickEdge.ok).toBe(true);
  expect(brickEdge.value.fac).toBe(1);

  //    Invert at white → black.
  const invWhite = await win.evaluate(() => window.__studioShaderDeepApply(
    'invertcolor', { fac: 1 }, { fac: 1, color: [1, 1, 1] },
  ));
  expect(invWhite.ok).toBe(true);
  expect(invWhite.value[0]).toBeCloseTo(0, 5);
  expect(invWhite.value[1]).toBeCloseTo(0, 5);
  expect(invWhite.value[2]).toBeCloseTo(0, 5);

  //    Gamma 2.2 on 0.5 → ~0.7297.
  const gam = await win.evaluate(() => window.__studioShaderDeepApply(
    'gamma', { gamma: 2.2 }, { color: [0.5, 0.5, 0.5] },
  ));
  expect(gam.ok).toBe(true);
  expect(gam.value[0]).toBeGreaterThan(0.7);
  expect(gam.value[0]).toBeLessThan(0.75);

  //    Length of (3,4,0) → 5.
  const len = await win.evaluate(() => window.__studioShaderDeepApply(
    'length', {}, { vector: [3, 4, 0] },
  ));
  expect(len.ok).toBe(true);
  expect(len.value).toBeCloseTo(5, 5);

  //    Dot of (1,2,3) · (4,-5,6) → 12.
  const dotR = await win.evaluate(() => window.__studioShaderDeepApply(
    'dot', {}, { a: [1, 2, 3], b: [4, -5, 6] },
  ));
  expect(dotR.ok).toBe(true);
  expect(dotR.value).toBeCloseTo(12, 5);

  //    Distance of (0,0,0) and (1,2,2) → 3.
  const dst = await win.evaluate(() => window.__studioShaderDeepApply(
    'distance', {}, { a: [0, 0, 0], b: [1, 2, 2] },
  ));
  expect(dst.ok).toBe(true);
  expect(dst.value).toBeCloseTo(3, 5);

  //    Separate RGB of magenta → r=1, g=0, b=1.
  const sep = await win.evaluate(() => window.__studioShaderDeepApply(
    'separatergb', {}, { color: [1, 0, 1] },
  ));
  expect(sep.ok).toBe(true);
  expect(sep.value.r).toBe(1);
  expect(sep.value.g).toBe(0);
  expect(sep.value.b).toBe(1);

  //    Combine RGB → [0.1, 0.2, 0.3].
  const cmb = await win.evaluate(() => window.__studioShaderDeepApply(
    'combinergb', {}, { r: 0.1, g: 0.2, b: 0.3 },
  ));
  expect(cmb.ok).toBe(true);
  expect(cmb.value[0]).toBeCloseTo(0.1, 5);
  expect(cmb.value[1]).toBeCloseTo(0.2, 5);
  expect(cmb.value[2]).toBeCloseTo(0.3, 5);

  // ── Per-kind window.__studioShaderDeep_<kind> ops exposed. ─────────
  const opShape = await win.evaluate((kinds) => {
    const out = {};
    for (const k of kinds) {
      out[k] = typeof window[`__studioShaderDeep_${k}`] === 'function';
    }
    return out;
  }, KINDS);
  for (const k of KINDS) expect(opShape[k]).toBe(true);

  // ── Command palette registrations. ─────────────────────────────────
  const cmdShader = await win.evaluate(() => {
    if (typeof window.__studioCommandList !== 'function') return null;
    return window.__studioCommandList('shader');
  });
  if (cmdShader && cmdShader.ok) {
    const names = cmdShader.commands.map((c) => c.name);
    for (const k of KINDS) {
      expect(names).toContain(`__studioShaderDeep_${k}`);
    }
    expect(names).toContain('__studioShaderDeepApply');
    expect(names).toContain('__studioShaderDeepList');
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
  console.log('  shaderdeep: kinds=%d', listed.count);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
