import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-lightingops');

test('Studio V3 — sun / HDRI / shading / smart material / node graph (slice 406)', async () => {
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
  await win.waitForFunction(() => typeof window.__studioSetSunAngle === 'function', null, { timeout: 15000 });

  // Spawn + select cube for material ops.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let cube = null;
    vp.scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cube = o; });
    vp.transformControls.attach(cube);
  });

  // ─── Sun angle ───────────────────────────────────────────────────────
  const sun = await win.evaluate(() => window.__studioSetSunAngle(45, 30));
  expect(sun.ok).toBe(true);
  expect(sun.azDeg).toBe(45);
  expect(sun.elDeg).toBe(30);
  // Bad args rejected.
  expect((await win.evaluate(() => window.__studioSetSunAngle('a', 'b'))).ok).toBe(false);

  // ─── HDRI presets ────────────────────────────────────────────────────
  const presets = await win.evaluate(() => window.__studioListHDRIPresets());
  expect(presets.ok).toBe(true);
  expect(presets.presets).toEqual(['off', 'studio', 'sunset', 'neutral']);
  for (const p of ['studio', 'sunset', 'neutral', 'off']) {
    const r = await win.evaluate((px) => window.__studioSetHDRIEnvironment(px), p);
    expect(r.ok).toBe(true);
    expect(r.preset).toBe(p);
  }
  expect((await win.evaluate(() => window.__studioSetHDRIEnvironment('foo'))).ok).toBe(false);

  // ─── Shading modes ───────────────────────────────────────────────────
  for (const mode of ['wire', 'solid', 'material', 'rendered']) {
    const r = await win.evaluate((m) => window.__studioSetShadingMode(m), mode);
    expect(r.ok).toBe(true);
    expect(await win.evaluate(() => window.__studioGetShadingMode())).toBe(mode);
  }

  // ─── Smart materials ─────────────────────────────────────────────────
  const mats = await win.evaluate(() => window.__studioListSmartMaterials());
  expect(mats.presets).toContain('metal');
  expect(mats.presets).toContain('glass');
  for (const name of ['basic', 'metal', 'glass', 'matte', 'wood', 'copper']) {
    const r = await win.evaluate((n) => window.__studioApplySmartMaterial(n), name);
    expect(r.ok).toBe(true);
  }

  // ─── Material graph eval ────────────────────────────────────────────
  // multiply(red, white) = red.
  const graph = [
    { id: 'red',   type: 'color', params: { value: [1, 0, 0] } },
    { id: 'white', type: 'color', params: { value: [1, 1, 1] } },
    { id: 'mul',   type: 'multiply', inputs: { a: 'red', b: 'white' } },
  ];
  const ev = await win.evaluate((g) => window.__studioEvalNodeGraph(g, 'mul'), graph);
  expect(ev.ok).toBe(true);
  expect(ev.output).toEqual([1, 0, 0]);
  // lerp(red, white, 0.5) = [1, 0.5, 0.5]
  const lerp = [
    { id: 'red',   type: 'color', params: { value: [1, 0, 0] } },
    { id: 'white', type: 'color', params: { value: [1, 1, 1] } },
    { id: 'mix',   type: 'lerp', params: { t: 0.5 }, inputs: { a: 'red', b: 'white' } },
  ];
  const ev2 = await win.evaluate((g) => window.__studioEvalNodeGraph(g, 'mix'), lerp);
  expect(ev2.output[0]).toBeCloseTo(1, 5);
  expect(ev2.output[1]).toBeCloseTo(0.5, 5);
  expect(ev2.output[2]).toBeCloseTo(0.5, 5);
  // applyMaterialGraph writes the colour into the active mesh's material.
  const apply = await win.evaluate((g) => window.__studioApplyMaterialGraph(g, 'mul'), graph);
  expect(apply.ok).toBe(true);
  expect(apply.color[0]).toBeCloseTo(1, 5);
  expect(apply.color[1]).toBeCloseTo(0, 5);

  await win.screenshot({ path: path.join(OUT, '00-after-lightingops.png') });

  // Reset.
  await win.evaluate(() => {
    window.localStorage.removeItem('studioV3');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });

  // eslint-disable-next-line no-console
  console.log('  slice 406: sun/HDRI/shading/smart-material/node-graph all green');

  await app.close();
});
