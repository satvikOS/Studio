// Studio V3 — non-destructive modifier stack (real, not recipe).
//
// Headed Mac-Electron spec. Drives the V3 shell against the Vite dev
// server, dynamic-imports the modstack autoload (api.js is owned by
// the orchestrator), spawns a sphere, exercises all 10 modifier kinds
// + reorder + enable/disable + setParams + remove + clear + applyAll
// + resetToBase, and screenshots 5+ camera angles per the multi-cam
// memory.
//
// Verifies the modifier is NON-DESTRUCTIVE: the base geometry survives
// every mutation until applyAll() promotes the evaluated geometry to
// the new base.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-modstack');

test('Studio V3 — modifier stack: 10 kinds, non-destructive', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 80,
  });

  async function findAppWindow() {
    for (let i = 0; i < 50; i++) {
      const wins = app.windows();
      const app1 = wins.find((w) => /^https?:\/\/localhost:3000/.test(w.url()));
      if (app1) return app1;
      await new Promise((r) => setTimeout(r, 200));
    }
    return app.windows()[0];
  }
  const win = await findAppWindow();
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
  await win.waitForFunction(() => typeof window.__studioSelectedMesh === 'function'
    || (window.__archdiscViewport && typeof window.__archdiscViewport.getSelected === 'function'),
    null, { timeout: 15000 });

  // ─── Install the modstack surface via the dev-server autoload. ────────
  await win.evaluate(async () => {
    if (typeof window.__studioModStackAdd !== 'function') {
      await import('/src/workbenches/studio/v3/modstack/autoload.js');
    }
    await new Promise((r) => setTimeout(r, 50));
  });
  await win.waitForFunction(() => typeof window.__studioModStackAdd === 'function',
    null, { timeout: 15000 });

  // ─── Spawn a sphere; scale it up so it dominates the viewer. ──────────
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);
  const sphereUuid = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let sphere = null;
    vp.scene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'sphere') sphere = o;
    });
    if (sphere) {
      sphere.scale.set(40, 40, 40);
      sphere.position.set(0, 1.5, 0);
      sphere.updateMatrixWorld(true);
      vp.transformControls.attach(sphere);
      vp.renderer.render(vp.scene, vp.camera);
    }
    return sphere && sphere.uuid;
  });
  expect(sphereUuid).toBeTruthy();
  await win.screenshot({ path: path.join(OUT, '00-sphere.png') });

  // ─── Record the original vert count BEFORE any modifier touches it. ──
  const baseVerts0 = await win.evaluate((u) => {
    let m = null;
    window.__archdiscViewport.scene.traverse((o) => { if (o.uuid === u) m = o; });
    return m && m.geometry && m.geometry.attributes.position.count;
  }, sphereUuid);
  expect(baseVerts0).toBeGreaterThan(0);

  // ─── Open the panel. ─────────────────────────────────────────────────
  const opened = await win.evaluate(() => window.__studioModStackPanelOpen());
  expect(opened.ok).toBe(true);
  await expect(win.locator('[data-studio-v3-modstack-panel]')).toBeVisible({ timeout: 5000 });
  await win.screenshot({ path: path.join(OUT, '01-panel-open.png') });

  // ─── Add EVERY supported kind. ───────────────────────────────────────
  const kinds = [
    'subdivide', 'solidify', 'mirror', 'array', 'decimate',
    'bend', 'twist', 'taper', 'displace', 'smooth',
  ];
  const uuids = {};
  for (const k of kinds) {
    const r = await win.evaluate((kk) => window.__studioModStackAdd(kk), k);
    expect(r.ok).toBe(true);
    expect(typeof r.uuid).toBe('string');
    uuids[k] = r.uuid;
  }
  await win.waitForTimeout(150);
  const listed = await win.evaluate(() => window.__studioModStackList());
  expect(listed.count).toBe(10);
  expect(listed.mods.map((m) => m.kind)).toEqual(kinds);
  await win.screenshot({ path: path.join(OUT, '02-ten-mods.png') });

  // ─── The base geometry must still equal the snapshot. ────────────────
  const baseAfterAdds = await win.evaluate((u) => {
    let m = null;
    window.__archdiscViewport.scene.traverse((o) => { if (o.uuid === u) m = o; });
    return m.userData.archdiscStudioBaseGeometry &&
           m.userData.archdiscStudioBaseGeometry.attributes.position.count;
  }, sphereUuid);
  expect(baseAfterAdds).toBe(baseVerts0);

  // ─── Disable every mod → vert count returns to baseline. ─────────────
  for (const k of kinds) {
    const r = await win.evaluate(({ u }) =>
      window.__studioModStackSetEnabled(u, false), { u: uuids[k] });
    expect(r.ok).toBe(true);
  }
  const vertsAllOff = await win.evaluate((u) => {
    let m = null;
    window.__archdiscViewport.scene.traverse((o) => { if (o.uuid === u) m = o; });
    return m.geometry.attributes.position.count;
  }, sphereUuid);
  expect(vertsAllOff).toBe(baseVerts0);
  await win.screenshot({ path: path.join(OUT, '03-all-disabled.png') });

  // ─── Re-enable subdivide → vert count grows. ─────────────────────────
  const en = await win.evaluate(({ u }) =>
    window.__studioModStackSetEnabled(u, true), { u: uuids.subdivide });
  expect(en.ok).toBe(true);
  const vertsAfterSubdiv = await win.evaluate((u) => {
    let m = null;
    window.__archdiscViewport.scene.traverse((o) => { if (o.uuid === u) m = o; });
    return m.geometry.attributes.position.count;
  }, sphereUuid);
  expect(vertsAfterSubdiv).toBeGreaterThan(baseVerts0);

  // ─── setParams: bump subdivide iterations → vert count grows again. ──
  const setP = await win.evaluate(({ u }) =>
    window.__studioModStackSetParams(u, { iterations: 2 }), { u: uuids.subdivide });
  expect(setP.ok).toBe(true);
  const vertsAfterIter2 = await win.evaluate((u) => {
    let m = null;
    window.__archdiscViewport.scene.traverse((o) => { if (o.uuid === u) m = o; });
    return m.geometry.attributes.position.count;
  }, sphereUuid);
  expect(vertsAfterIter2).toBeGreaterThan(vertsAfterSubdiv);

  // ─── Reorder: move smooth to index 0 → list reflects the move. ───────
  const reord = await win.evaluate(({ u }) =>
    window.__studioModStackReorder(u, 0), { u: uuids.smooth });
  expect(reord.ok).toBe(true);
  const orderAfter = await win.evaluate(() =>
    window.__studioModStackList().mods.map((m) => m.kind));
  expect(orderAfter[0]).toBe('smooth');

  // ─── Enable decimate too so the stack chains 3 mods at once. ─────────
  await win.evaluate(({ u }) =>
    window.__studioModStackSetEnabled(u, true), { u: uuids.decimate });
  await win.evaluate(({ u }) =>
    window.__studioModStackSetParams(u, { ratio: 0.3 }), { u: uuids.decimate });
  await win.screenshot({ path: path.join(OUT, '04-chain-of-3.png') });

  // ─── Remove subdivide → vert count drops, stack count is 9. ──────────
  const rem = await win.evaluate(({ u }) =>
    window.__studioModStackRemove(u), { u: uuids.subdivide });
  expect(rem.ok).toBe(true);
  expect(rem.count).toBe(9);

  // ─── resetToBase → mesh.geometry equals the base, stack survives. ────
  const reset = await win.evaluate(() => window.__studioModStackResetToBase());
  expect(reset.ok).toBe(true);
  const vertsReset = await win.evaluate((u) => {
    let m = null;
    window.__archdiscViewport.scene.traverse((o) => { if (o.uuid === u) m = o; });
    return m.geometry.attributes.position.count;
  }, sphereUuid);
  expect(vertsReset).toBe(baseVerts0);
  const stackStillThere = await win.evaluate(() => window.__studioModStackList());
  expect(stackStillThere.count).toBe(9);
  await win.screenshot({ path: path.join(OUT, '05-reset-to-base.png') });

  // ─── Rebuild so we have the chain back, then applyAll → stack empty,
  //     evaluated geometry is the NEW base. ─────────────────────────────
  await win.evaluate(() => window.__studioModStackRebuild());
  const evaluated = await win.evaluate((u) => {
    let m = null;
    window.__archdiscViewport.scene.traverse((o) => { if (o.uuid === u) m = o; });
    return m.geometry.attributes.position.count;
  }, sphereUuid);
  expect(evaluated).not.toBe(baseVerts0);

  const apply = await win.evaluate(() => window.__studioModStackApplyAll());
  expect(apply.ok).toBe(true);
  expect(apply.baked).toBe(9);
  const afterApply = await win.evaluate(() => window.__studioModStackList());
  expect(afterApply.count).toBe(0);
  const newBase = await win.evaluate((u) => {
    let m = null;
    window.__archdiscViewport.scene.traverse((o) => { if (o.uuid === u) m = o; });
    return m.userData.archdiscStudioBaseGeometry.attributes.position.count;
  }, sphereUuid);
  expect(newBase).toBe(evaluated);
  await win.screenshot({ path: path.join(OUT, '06-apply-all.png') });

  // ─── Clear after applyAll is a no-op for vert count but should ok. ───
  const cleared = await win.evaluate(() => window.__studioModStackClear());
  expect(cleared.ok).toBe(true);

  // ─── Command palette discovery — every modstack op registered. ───────
  const cmds = await win.evaluate(() => window.__studioCommandList('modstack'));
  expect(cmds.ok).toBe(true);
  const names = new Set(cmds.commands.map((c) => c.name));
  for (const n of [
    '__studioModStackAdd', '__studioModStackList',
    '__studioModStackSetEnabled', '__studioModStackSetViewport',
    '__studioModStackReorder', '__studioModStackSetParams',
    '__studioModStackRemove', '__studioModStackClear',
    '__studioModStackApplyAll', '__studioModStackResetToBase',
    '__studioModStackPanelOpen', '__studioModStackPanelClose', '__studioModStackPanelToggle',
  ]) {
    expect(names.has(n)).toBe(true);
  }

  // ─── 5 camera angles (Forge multi-cam memory). ──────────────────────
  const angles = [
    { name: 'front', set: () => window.__studioViewFront && window.__studioViewFront() },
    { name: 'top',   set: () => window.__studioViewTop && window.__studioViewTop() },
    { name: 'right', set: () => window.__studioViewRight && window.__studioViewRight() },
    { name: 'iso',   set: () => window.__studioViewIso && window.__studioViewIso() },
    { name: 'close', set: () => window.__studioFrameSelection && window.__studioFrameSelection() },
  ];
  for (const a of angles) {
    try { await win.evaluate(a.set); } catch (_) {}
    await win.waitForTimeout(120);
    await win.screenshot({ path: path.join(OUT, `07-angle-${a.name}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  modstack slice: 10 kinds + non-destructive base + applyAll/reset ok');

  try { await win.evaluate(() => { try { window.close(); } catch (_) {} }); } catch (_) {}
  try {
    await Promise.race([
      app.close(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('close-timeout')), 10000)),
    ]);
  } catch (_) {
    try { app.process().kill('SIGKILL'); } catch (_) {}
  }
});
