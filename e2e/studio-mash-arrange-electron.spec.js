// ArchDisc Studio V3 — Maya MASH arrange + distribute + effector
// pipeline (slice 753).
//
// Headed Mac-Electron spec. Drives the new uppercase __studioMASH*
// ops layered on top of the slice-699 network engine:
//
//   • __studioMASHDistribute({mode:'grid', ...}) lays out 10×1×10 = 100
//     instances of a unit cube
//   • the InstancedMesh actually lands in the scene with count === 100
//   • a sine effector on Y bumps each instance.y by
//     sin(idx * 0.1) * 0.5, sampled at ≥3 indices within 1e-3
//   • __studioMASHList returns ≥1 item
//   • 5 named camera angles screenshotted (required by feedback rule)

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-mash-arrange');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — Maya MASH arrange / distribute / effector', async () => {
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

  await win.evaluate(async () => {
    if (typeof window.__studioMASHDistribute !== 'function') {
      await import('/src/workbenches/studio/v3/mash/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioMASHDistribute === 'function',
    null, { timeout: 20000 });
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) Spawn a unit-cube source mesh ───────────────────────────────
  const sourceUuid = await win.evaluate(() => {
    const THREE = window.THREE;
    const geom = new THREE.BoxGeometry(0.05, 0.05, 0.05);
    const mat = new THREE.MeshStandardMaterial({ color: 0x66aaff });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'cube';
    mesh.userData.pickable = true;
    mesh.name = 'mash-source-cube';
    window.__archdiscScene.add(mesh);
    return mesh.uuid;
  });
  expect(sourceUuid).toBeTruthy();

  // ── 2) Distribute 10×1×10 = 100 instances ──────────────────────────
  const dist = await win.evaluate(({ uuid }) => window.__studioMASHDistribute({
    sourceUuid: uuid,
    mode: 'grid',
    count: 100,
    params: { nx: 10, ny: 1, nz: 10, spacing: [0.15, 0, 0.15] },
  }), { uuid: sourceUuid });
  // eslint-disable-next-line no-console
  console.log('[mash] distribute', JSON.stringify(dist));
  expect(dist.ok).toBe(true);
  expect(dist.count).toBe(100);
  expect(dist.mode).toBe('grid');
  expect(dist.sourceUuid).toBe(sourceUuid);
  const instUuid = dist.uuid;
  expect(instUuid).toBeTruthy();

  // ── 3) Scene actually contains an InstancedMesh w/ count 100 ───────
  const scenefacts = await win.evaluate(({ u }) => {
    const obj = window.__archdiscScene.getObjectByProperty('uuid', u);
    return { found: !!obj, isInst: !!(obj && obj.isInstancedMesh), cnt: obj && obj.count };
  }, { u: instUuid });
  expect(scenefacts.found).toBe(true);
  expect(scenefacts.isInst).toBe(true);
  expect(scenefacts.cnt).toBe(100);
  await win.screenshot({ path: path.join(OUT, '01-grid.png') });

  // ── 4) Read pre-effector instance.y values ─────────────────────────
  const preY = await win.evaluate(({ u }) => {
    const obj = window.__archdiscScene.getObjectByProperty('uuid', u);
    const arr = obj.instanceMatrix.array;
    const ys = new Array(100);
    for (let i = 0; i < 100; i++) ys[i] = arr[i * 16 + 13];
    return ys;
  }, { u: instUuid });
  // Grid with ny=1 → all pre-effector Y values should be at the centre
  // of the grid (ny/2 - 0)*0 = 0 since spacing.y = 0.
  expect(preY.length).toBe(100);
  for (let i = 0; i < 100; i++) expect(Math.abs(preY[i])).toBeLessThan(1e-4);

  // ── 5) Sine effector: y += sin(i * 0.1) * 0.5 ──────────────────────
  const sin = await win.evaluate(({ u }) => window.__studioMASHEffector({
    uuid: u, kind: 'sine',
    params: { axis: 'y', amplitude: 0.5, frequency: 0.1 },
  }), { u: instUuid });
  // eslint-disable-next-line no-console
  console.log('[mash] sine', JSON.stringify(sin));
  expect(sin.ok).toBe(true);

  // ── 6) Sample ≥3 indices, expect post − pre ≈ sin(i*0.1)*0.5 ──────
  const postY = await win.evaluate(({ u }) => {
    const obj = window.__archdiscScene.getObjectByProperty('uuid', u);
    const arr = obj.instanceMatrix.array;
    const ys = new Array(100);
    for (let i = 0; i < 100; i++) ys[i] = arr[i * 16 + 13];
    return ys;
  }, { u: instUuid });
  expect(postY.length).toBe(100);
  const samples = [0, 7, 23, 50, 91];
  let matched = 0;
  for (const i of samples) {
    const expected = Math.sin(i * 0.1) * 0.5;
    const actual = postY[i] - preY[i];
    const diff = Math.abs(actual - expected);
    // eslint-disable-next-line no-console
    console.log(`[mash] sine sample i=${i} expected=${expected.toFixed(6)} actual=${actual.toFixed(6)} diff=${diff.toExponential(2)}`);
    if (diff < 1e-3) matched += 1;
  }
  expect(matched).toBeGreaterThanOrEqual(3);

  // ── 7) List returns ≥1 item w/ matching uuid + sourceUuid ──────────
  const list = await win.evaluate(() => window.__studioMASHList());
  // eslint-disable-next-line no-console
  console.log('[mash] list', JSON.stringify(list));
  expect(list.ok).toBe(true);
  expect(list.items.length).toBeGreaterThanOrEqual(1);
  const item = list.items.find((it) => it.uuid === instUuid);
  expect(item).toBeTruthy();
  expect(item.sourceUuid).toBe(sourceUuid);
  expect(item.count).toBe(100);
  expect(item.mode).toBe('grid');
  expect(Array.isArray(item.effectors)).toBe(true);
  expect(item.effectors).toContain('sine');

  await win.screenshot({ path: path.join(OUT, '02-sine.png') });

  // ── 8) Camera sweep — 5 angles. ────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log(`  slice 753: MASH grid 100 instances; sine matched ${matched}/5`);

  await app.close();
});
