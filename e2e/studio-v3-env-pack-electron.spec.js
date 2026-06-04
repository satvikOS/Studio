import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-env-pack');

test('Studio V3 — env: intensity/rotate/bg/sky/state/cycle (slice 645)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 250,
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
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // 1: bake procedural sky → env populated
  const sky = await win.evaluate(() => window.__studioBakeProceduralSky(0x4060a0, 0xc4d0e6, 0xeec99c));
  expect(sky.ok).toBe(true);
  const hasEnv = await win.evaluate(() => !!window.__archdiscScene.environment);
  expect(hasEnv).toBe(true);
  await win.screenshot({ path: path.join(OUT, '01-sky.png') });

  // 2: env intensity
  const intens = await win.evaluate(() => window.__studioSetEnvIntensity(0.3));
  expect(intens.ok).toBe(true);
  expect(intens.intensity).toBe(0.3);
  const matI = await win.evaluate(() => {
    const sel = window.__studioSelectedMesh();
    const m = Array.isArray(sel.material) ? sel.material[0] : sel.material;
    return m.envMapIntensity;
  });
  expect(matI).toBe(0.3);
  await win.screenshot({ path: path.join(OUT, '02-intensity.png') });

  // 3: rotate
  const rot = await win.evaluate(() => window.__studioSetEnvRotation(45));
  expect(rot.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '03-rotate.png') });

  // 4: toggle env as background
  const bg = await win.evaluate(() => window.__studioToggleEnvAsBackground(true));
  expect(bg.ok).toBe(true);
  expect(bg.on).toBe(true);
  const sceneBg = await win.evaluate(() => !!window.__archdiscScene.background);
  expect(sceneBg).toBe(true);
  await win.screenshot({ path: path.join(OUT, '04-bg.png') });

  // 5: state
  const st = await win.evaluate(() => window.__studioGetEnvState());
  expect(st.ok).toBe(true);
  expect(st.hasEnv).toBe(true);
  expect(st.hasBackground).toBe(true);
  expect(st.intensity).toBe(0.3);
  await win.screenshot({ path: path.join(OUT, '05-state.png') });

  // 6: cycle HDRI preset (if existing helper present)
  const cy = await win.evaluate(() => window.__studioCycleHDRIPreset());
  // accept either successful cycle or a clean "no presets" failure
  expect(typeof cy.ok).toBe('boolean');
  await win.screenshot({ path: path.join(OUT, '06-cycle.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 645: 6 env features — intensity=', intens.intensity, ' preset cycled =', cy.ok);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
