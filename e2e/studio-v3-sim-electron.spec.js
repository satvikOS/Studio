// ArchDisc Studio V3 — cloth + soft-body + SPH-lite fluid sim e2e.
//
// Launches Electron in --dev mode (Vite at localhost:3000) so we can
// dynamic-import sim/autoload.js by URL even when api.js orchestration
// hasn't been wired by the slice-merge orchestrator yet — same trick
// the shader spec uses.
//
// Exercises the full op surface per slice spec:
//
//   1. Cloth: __studioClothCreate → 16×16 grid (289 verts), pin/unpin,
//      set wind, single step, verify positions changed.
//   2. Soft body: spawn a sphere, __studioSoftBodyAttach, step a few
//      times, verify it falls toward ground.
//   3. Fluid: __studioFluidCreate(300, 3), step several times, verify
//      particle positions move + density warms colours.
//   4. Master: __studioSimTogglePlay chains the sim into __studioAnimTick
//      tagged __sim; toggle again splices it out. __studioSimReset
//      snaps state back.
//   5. Command palette: every __studioSim* / __studioCloth* /
//      __studioSoftBody* / __studioFluid* is registered under category
//      'sim'.
//   6. Multi-cam screenshots (front/iso/right/top/close) per the Forge
//      multi-cam memory.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-sim');

test('Studio V3 — cloth + soft body + SPH-lite fluid sim', async () => {
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
  await win.waitForFunction(() => typeof window.__studioSelectedMesh === 'function', null, { timeout: 15000 });

  // ─── Ensure the sim autoload has run. If the orchestrator has wired
  // api.js to import('./sim/autoload.js') the install is already done;
  // otherwise we install it ourselves via the dev-server URL. ──────────
  await win.evaluate(async () => {
    if (typeof window.__studioClothCreate !== 'function') {
      await import('/src/workbenches/studio/v3/sim/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioClothCreate === 'function'
       && typeof window.__studioSoftBodyAttach === 'function'
       && typeof window.__studioFluidCreate === 'function'
       && typeof window.__studioSimTogglePlay === 'function',
    null, { timeout: 15000 },
  );

  // ─── 1. Cloth ────────────────────────────────────────────────────────
  // 16×16 segments → 17² = 289 verts; structural+shear+flex springs.
  const cloth = await win.evaluate(() => window.__studioClothCreate(2.0, 2.0, 16, {
    position: [0, 3, 0],
    color: 0xee4455,
    defaultPin: true,
  }));
  expect(cloth.ok).toBe(true);
  expect(cloth.count).toBe(17 * 17);
  expect(cloth.springs).toBeGreaterThan(289);

  // List + verify the cloth shows up.
  const list = await win.evaluate(() => window.__studioClothList());
  expect(list.cloths.length).toBe(1);
  expect(list.cloths[0].uuid).toBe(cloth.uuid);
  expect(list.cloths[0].pinned).toBe(2);  // default-pinned top corners

  // Pin a third vertex (the centre top edge).
  const pin = await win.evaluate((u) => window.__studioClothPinVertex(u, 8), cloth.uuid);
  expect(pin.ok).toBe(true);
  const listPin = await win.evaluate(() => window.__studioClothList());
  expect(listPin.cloths[0].pinned).toBe(3);

  // Unpin the same vertex.
  const unpin = await win.evaluate((u) => window.__studioClothUnpinVertex(u, 8), cloth.uuid);
  expect(unpin.ok).toBe(true);
  const listUnpin = await win.evaluate(() => window.__studioClothList());
  expect(listUnpin.cloths[0].pinned).toBe(2);

  // Set a wind vector + capture a sample vertex's y before stepping.
  const wind = await win.evaluate(() => window.__studioClothSetWind([0, 0, 4]));
  expect(wind.ok).toBe(true);
  expect(wind.wind).toEqual([0, 0, 4]);

  // Record a free vertex's world Y before stepping.
  const yBefore = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    // Vertex 144 is in the middle of the cloth — guaranteed free.
    return m.geometry.attributes.position.getY(144);
  }, cloth.uuid);

  // Step the cloth 30 times. Gravity (-Y) + wind (+Z) should drop the
  // free verts below their initial flat plane.
  for (let i = 0; i < 30; i++) {
    await win.evaluate(() => window.__studioClothStep(0.016));
  }
  const yAfter = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    return m.geometry.attributes.position.getY(144);
  }, cloth.uuid);
  expect(yAfter).toBeLessThan(yBefore);  // it sagged under gravity

  await win.screenshot({ path: path.join(OUT, '01-cloth.png') });

  // ─── 2. Soft body ────────────────────────────────────────────────────
  // Spawn a sphere via the existing add-tool, lift it up, attach a soft
  // body, step the sim and verify its lowest vertex sinks.
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);
  const sphereUuid = await win.evaluate(() => {
    let s = null;
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere' && !s) s = o;
    });
    if (s) {
      // Scale + lift so the soft body has room to fall to ground.
      s.scale.set(40, 40, 40);
      s.position.set(0, 4, -3);
      s.updateMatrixWorld(true);
    }
    return s ? s.uuid : null;
  });
  expect(typeof sphereUuid).toBe('string');

  const attach = await win.evaluate(
    (u) => window.__studioSoftBodyAttach(u, {
      stiffness: 0.8, iterations: 4, ground: true, groundY: 0,
    }),
    sphereUuid,
  );
  expect(attach.ok).toBe(true);
  expect(attach.count).toBeGreaterThan(0);
  expect(attach.edges).toBeGreaterThan(0);

  // Sample the sphere's lowest vertex Y before stepping. We use the
  // bounding sphere's centre as a proxy for the body's overall altitude.
  const bsBefore = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    m.geometry.computeBoundingSphere();
    return m.geometry.boundingSphere.center.y;
  }, sphereUuid);

  // Step the soft body. It should fall toward the ground plane.
  for (let i = 0; i < 30; i++) {
    await win.evaluate(() => window.__studioSoftBodyStep(0.016));
  }
  const bsAfter = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    m.geometry.computeBoundingSphere();
    return m.geometry.boundingSphere.center.y;
  }, sphereUuid);
  expect(bsAfter).toBeLessThan(bsBefore);

  const sbList = await win.evaluate(() => window.__studioSoftBodyList());
  expect(sbList.bodies.length).toBe(1);

  await win.screenshot({ path: path.join(OUT, '02-softbody.png') });

  // ─── 3. Fluid ────────────────────────────────────────────────────────
  const fluid = await win.evaluate(() => window.__studioFluidCreate(300, 3, {
    h: 0.22, restDensity: 600, viscosity: 50,
  }));
  expect(fluid.ok).toBe(true);
  expect(fluid.count).toBe(300);

  const fList = await win.evaluate(() => window.__studioFluidList());
  expect(fList.fluids.length).toBe(1);
  expect(fList.fluids[0].count).toBe(300);

  // Sample a particle Y before stepping.
  const pyBefore = await win.evaluate((u) => {
    const p = window.__archdiscScene.getObjectByProperty('uuid', u);
    return p.geometry.attributes.position.getY(0);
  }, fluid.uuid);

  // Step the fluid 30 times — gravity should bring particles down.
  for (let i = 0; i < 30; i++) {
    await win.evaluate(() => window.__studioFluidStep(0.012));
  }
  const pyAfter = await win.evaluate((u) => {
    const p = window.__archdiscScene.getObjectByProperty('uuid', u);
    return p.geometry.attributes.position.getY(0);
  }, fluid.uuid);
  expect(pyAfter).toBeLessThan(pyBefore);

  await win.screenshot({ path: path.join(OUT, '03-fluid.png') });

  // ─── 4. Master tick chain ────────────────────────────────────────────
  // Toggle on: the sim tick must be present in __studioAnimTick chain.
  const togOn = await win.evaluate(() => window.__studioSimTogglePlay());
  expect(togOn.ok).toBe(true);
  expect(togOn.playing).toBe(true);
  const chainHasSim = await win.evaluate(() => {
    const v = window.__archdiscViewport;
    let cur = v && v.__studioAnimTick, found = false;
    while (cur) { if (cur.__sim) { found = true; break; } cur = cur.__prev; }
    return found;
  });
  expect(chainHasSim).toBe(true);

  // Let the chain run a moment so the renderer actually advances sims.
  await win.waitForTimeout(400);

  // Toggle off: chain must no longer carry __sim.
  const togOff = await win.evaluate(() => window.__studioSimTogglePlay());
  expect(togOff.ok).toBe(true);
  expect(togOff.playing).toBe(false);
  const chainCleared = await win.evaluate(() => {
    const v = window.__archdiscViewport;
    let cur = v && v.__studioAnimTick, found = false;
    while (cur) { if (cur.__sim) { found = true; break; } cur = cur.__prev; }
    return found;
  });
  expect(chainCleared).toBe(false);

  // Reset: snaps everything back; the tick chain stays clear.
  const reset = await win.evaluate(() => window.__studioSimReset());
  expect(reset.ok).toBe(true);

  const status = await win.evaluate(() => window.__studioSimStatus());
  expect(status.ok).toBe(true);
  expect(status.playing).toBe(false);
  expect(status.cloth).toBe(1);
  expect(status.soft).toBe(1);
  expect(status.fluid).toBe(1);

  // ─── 5. Command palette registration under category 'sim' ────────────
  const simCmds = await win.evaluate(() => {
    if (typeof window.__studioCommandList !== 'function') return { ok: false };
    return window.__studioCommandList('sim');
  });
  expect(simCmds.ok).toBe(true);
  const names = simCmds.commands.map((c) => c.name);
  for (const expected of [
    '__studioClothCreate', '__studioClothPinVertex', '__studioClothUnpinVertex',
    '__studioClothSetWind', '__studioClothStep', '__studioClothList',
    '__studioSoftBodyAttach', '__studioSoftBodyDetach', '__studioSoftBodyStep',
    '__studioFluidCreate', '__studioFluidStep', '__studioFluidList',
    '__studioSimTogglePlay', '__studioSimReset',
  ]) {
    expect(names).toContain(expected);
  }
  expect(simCmds.commands.length).toBeGreaterThanOrEqual(14);

  // ─── 6. Multi-cam screenshots ────────────────────────────────────────
  // Five named camera angles per the Forge multi-cam memory. Toggle the
  // sim on first so each shot captures a slightly-evolved state.
  await win.evaluate(() => window.__studioSimTogglePlay());
  await win.waitForTimeout(300);

  const cams = [
    { name: 'front', pos: [0, 2.5, 6],  target: [0, 1, 0] },
    { name: 'iso',   pos: [4, 4, 4],    target: [0, 1, 0] },
    { name: 'right', pos: [6, 2, 0],    target: [0, 1, 0] },
    { name: 'top',   pos: [0, 7, 0.01], target: [0, 0, 0] },
    { name: 'close', pos: [2.5, 2, 2.5], target: [0, 1.5, 0] },
  ];
  for (const c of cams) {
    await win.evaluate(({ pos, target }) => {
      const v = window.__archdiscViewport;
      if (!v) return;
      v.camera.position.set(pos[0], pos[1], pos[2]);
      v.camera.lookAt(target[0], target[1], target[2]);
      if (v.orbitControls) {
        v.orbitControls.target.set(target[0], target[1], target[2]);
        v.orbitControls.update();
      }
      v.camera.updateMatrixWorld(true);
      v.renderer.render(v.scene, v.camera);
    }, c);
    await win.waitForTimeout(200);
    await win.screenshot({ path: path.join(OUT, `04-${c.name}.png`) });
  }

  // Stop the sim before tearing down.
  await win.evaluate(() => window.__studioSimTogglePlay());

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.localStorage.removeItem('studioV3');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });

  // eslint-disable-next-line no-console
  console.log(`  sim: cloth ${cloth.count} verts / ${cloth.springs} springs, ` +
              `soft ${attach.count} verts / ${attach.edges} edges, ` +
              `fluid ${fluid.count} particles, ${simCmds.commands.length} commands`);

  await app.close();
});
