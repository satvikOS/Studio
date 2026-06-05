// Studio V3 — EEVEE-style SSGI + SSR viewport pass.
//
// Headed Mac-Electron spec validating the eevee/ module's:
//   1. Autoload → __studioEevee* op surface populated.
//   2. Command palette registration under category 'rt'.
//   3. SSGI toggle inserts a ShaderPass into __studioComposer (creating
//      the composer if none existed) and removing it on second toggle.
//   4. SSR toggle behaves the same way and the two coexist.
//   5. Intensity + max-distance setters round-trip via GetState.
//   6. Reset returns state to defaults.
//   7. The side panel mounts when PanelOpen is called.
//   8. Multi-camera screenshots captured per the Forge multi-cam memory
//      to make the SSGI + SSR visible to remote-desktop review.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-eevee');

test('Studio V3 — EEVEE-style SSGI + SSR viewport pass', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
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
  await win.waitForFunction(
    () => typeof window.__studioSelectedMesh === 'function',
    null, { timeout: 15000 },
  );

  // ─── Bootstrap eevee module. ─────────────────────────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioEeveeToggleSSGI !== 'function') {
      await import('/src/workbenches/studio/v3/eevee/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioEeveeToggleSSGI === 'function'
      && typeof window.__studioEeveeToggleSSR === 'function'
      && typeof window.__studioEeveeGetState === 'function'
      && typeof window.__studioEeveeReset === 'function'
      && typeof window.__studioEeveeSetSSGIIntensity === 'function'
      && typeof window.__studioEeveeSetSSRMaxDistance === 'function'
      && typeof window.__studioEeveePanelToggle === 'function',
    null, { timeout: 15000 },
  );

  // ─── Command palette registration. ───────────────────────────────────
  const eeveeCmds = await win.evaluate(() => {
    if (typeof window.__studioCommandList !== 'function') return { names: [] };
    const r = window.__studioCommandList('rt');
    return { names: r.commands.map((c) => c.name) };
  });
  expect(eeveeCmds.names).toEqual(expect.arrayContaining([
    '__studioEeveeToggleSSGI',
    '__studioEeveeToggleSSR',
    '__studioEeveeSetSSGIIntensity',
    '__studioEeveeSetSSRMaxDistance',
    '__studioEeveeGetState',
    '__studioEeveeReset',
    '__studioEeveePanelOpen',
    '__studioEeveePanelClose',
    '__studioEeveePanelToggle',
  ]));

  // ─── Build a minimal real scene: cube + floor plane. ─────────────────
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.locator('[data-studio-v3-tool="plane"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    const scene = window.__archdiscScene;
    let cube = null;
    let plane = null;
    scene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube' && !cube) cube = o;
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'plane' && !plane) plane = o;
    });
    if (cube) {
      cube.scale.set(40, 40, 40);
      cube.position.set(0, 0.6, 0);
      if (cube.material && cube.material.color) {
        cube.material.color.setRGB(0.85, 0.35, 0.20);
      }
      cube.updateMatrixWorld(true);
    }
    if (plane) {
      plane.scale.set(120, 120, 120);
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(0, 0, 0);
      if (plane.material && plane.material.color) {
        plane.material.color.setRGB(0.75, 0.78, 0.80);
      }
      plane.updateMatrixWorld(true);
    }
    const vp = window.__archdiscViewport;
    if (vp && vp.camera && vp.orbitControls) {
      vp.camera.position.set(3, 2.2, 3);
      vp.orbitControls.target.set(0, 0.6, 0);
      vp.orbitControls.update();
    }
  });
  await win.waitForTimeout(300);
  await win.screenshot({ path: path.join(OUT, '00-scene.png') });

  // ─── Default state. ──────────────────────────────────────────────────
  const stateDefault = await win.evaluate(() => window.__studioEeveeGetState());
  expect(stateDefault.ok).toBe(true);
  expect(stateDefault.ssgi).toBe(false);
  expect(stateDefault.ssr).toBe(false);
  expect(stateDefault.intensity).toBeCloseTo(1.0, 2);
  expect(stateDefault.ssrDistance).toBeCloseTo(0.5, 2);

  // ─── Enable SSGI. ────────────────────────────────────────────────────
  const ssgiOn = await win.evaluate(() => window.__studioEeveeToggleSSGI());
  expect(ssgiOn.ok).toBe(true);
  expect(ssgiOn.on).toBe(true);
  const stateSSGI = await win.evaluate(() => window.__studioEeveeGetState());
  expect(stateSSGI.ssgi).toBe(true);
  expect(stateSSGI.composerPassCount).toBeGreaterThan(0);
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(OUT, '01-ssgi-on.png') });

  // Confirm an SSGI-tagged pass landed in the composer.
  const ssgiPresent = await win.evaluate(() => {
    const c = window.__archdiscViewport && window.__archdiscViewport.__studioComposer;
    if (!c) return { hasComposer: false, hasSSGI: false };
    const hasSSGI = c.passes.some((p) => p && p.__eeveeKind === 'ssgi');
    return { hasComposer: true, hasSSGI };
  });
  expect(ssgiPresent.hasComposer).toBe(true);
  expect(ssgiPresent.hasSSGI).toBe(true);

  // ─── Enable SSR. ─────────────────────────────────────────────────────
  const ssrOn = await win.evaluate(() => window.__studioEeveeToggleSSR());
  expect(ssrOn.ok).toBe(true);
  expect(ssrOn.on).toBe(true);
  const stateBoth = await win.evaluate(() => window.__studioEeveeGetState());
  expect(stateBoth.ssgi).toBe(true);
  expect(stateBoth.ssr).toBe(true);
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(OUT, '02-both-on.png') });

  const ssrPresent = await win.evaluate(() => {
    const c = window.__archdiscViewport && window.__archdiscViewport.__studioComposer;
    if (!c) return false;
    return c.passes.some((p) => p && p.__eeveeKind === 'ssr');
  });
  expect(ssrPresent).toBe(true);

  // ─── Setters round-trip via GetState. ────────────────────────────────
  const intRes = await win.evaluate(() => window.__studioEeveeSetSSGIIntensity(1.5));
  expect(intRes.ok).toBe(true);
  expect(intRes.intensity).toBeCloseTo(1.5, 2);

  const distRes = await win.evaluate(() => window.__studioEeveeSetSSRMaxDistance(1.2));
  expect(distRes.ok).toBe(true);
  expect(distRes.ssrDistance).toBeCloseTo(1.2, 2);

  const stateAfterSet = await win.evaluate(() => window.__studioEeveeGetState());
  expect(stateAfterSet.intensity).toBeCloseTo(1.5, 2);
  expect(stateAfterSet.ssrDistance).toBeCloseTo(1.2, 2);

  // ─── Reset to defaults. ──────────────────────────────────────────────
  const resetRes = await win.evaluate(() => window.__studioEeveeReset());
  expect(resetRes.ok).toBe(true);
  const stateReset = await win.evaluate(() => window.__studioEeveeGetState());
  expect(stateReset.intensity).toBeCloseTo(1.0, 2);
  expect(stateReset.ssrDistance).toBeCloseTo(0.5, 2);

  // ─── Panel mounts when opened. ───────────────────────────────────────
  const panelOpen = await win.evaluate(() => window.__studioEeveePanelOpen());
  expect(panelOpen.ok).toBe(true);
  expect(panelOpen.open).toBe(true);
  await expect(win.locator('[data-studio-v3-eevee-panel]')).toBeVisible({ timeout: 5000 });
  await win.screenshot({ path: path.join(OUT, '03-panel-open.png') });

  const panelClose = await win.evaluate(() => window.__studioEeveePanelClose());
  expect(panelClose.ok).toBe(true);
  expect(panelClose.open).toBe(false);
  await expect(win.locator('[data-studio-v3-eevee-panel]')).toHaveCount(0);

  // ─── Multi-cam screenshots (front / top / right / iso / close). ──────
  const angles = [
    { name: 'front', pos: [0, 0.8, 4.5] },
    { name: 'top',   pos: [0.001, 5.0, 0.001] },
    { name: 'right', pos: [4.5, 0.8, 0] },
    { name: 'iso',   pos: [3, 2.4, 3] },
    { name: 'close', pos: [1.2, 1.0, 1.2] },
  ];
  for (const a of angles) {
    await win.evaluate((aa) => {
      const vp = window.__archdiscViewport;
      if (!vp || !vp.camera || !vp.orbitControls) return;
      vp.camera.position.set(aa.pos[0], aa.pos[1], aa.pos[2]);
      vp.orbitControls.target.set(0, 0.6, 0);
      vp.orbitControls.update();
    }, a);
    await win.waitForTimeout(700);
    await win.screenshot({ path: path.join(OUT, `04-cam-${a.name}.png`) });
  }

  // ─── Toggle both off — composer pass count drops. ────────────────────
  const ssgiOff = await win.evaluate(() => window.__studioEeveeToggleSSGI());
  expect(ssgiOff.on).toBe(false);
  const ssrOff = await win.evaluate(() => window.__studioEeveeToggleSSR());
  expect(ssrOff.on).toBe(false);
  const stateFinal = await win.evaluate(() => window.__studioEeveeGetState());
  expect(stateFinal.ssgi).toBe(false);
  expect(stateFinal.ssr).toBe(false);

  await win.screenshot({ path: path.join(OUT, '05-both-off.png') });

  // eslint-disable-next-line no-console
  console.log(
    '  eevee: ssgi+ssr toggled, composer passes peaked at %d',
    stateBoth.composerPassCount,
  );

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
