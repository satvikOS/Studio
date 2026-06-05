// Studio V3 — Drivers + NLA (animation depth).
//
// Drives the drivers/nla/NLAEditor surface installed by
// frontend/src/workbenches/studio/v3/animadv/autoload.js. The slice
// brief forbids touching api.js, so the test side-effect-imports the
// autoload itself via the dev-server URL — same trick the anim-graph
// + shader e2e specs use.
//
// Coverage:
//   • Adding a driver writes target = expr(source) immediately when
//     __studioAnimAdvDriverApplyNow() is called.
//   • Expression whitelist: +, -, *, /, sin, cos, clamp, min, max, if.
//   • Bad expressions reject with { ok: false }.
//   • Disabling a driver halts further writes.
//   • NLA strips sample a curve into a target window with the chosen
//     blend mode (replace / add / mul).
//   • Strip stack of two strips on the same target produces stacked
//     evaluation in insertion order.
//   • NLA editor opens, lists strips, lets us delete one, then closes.
//   • Command palette exposes every op under category "animadv".
//   • Multi-cam screenshots (front / top / right / iso / close) so the
//     remote-desktop watcher can see motion.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-animadv');

test('Studio V3 — Drivers + NLA depth', async () => {
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

  // ─── Side-effect-import the autoloads. We need anim/ (curves for
  // NLA) AND animadv/ (drivers + strips). ───────────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioAnimCurveAdd !== 'function') {
      await import('/src/workbenches/studio/v3/anim/autoload.js');
    }
    if (typeof window.__studioAnimAdvDriverAdd !== 'function') {
      await import('/src/workbenches/studio/v3/animadv/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioAnimAdvDriverAdd === 'function'
       && typeof window.__studioAnimAdvNLAStripAdd === 'function'
       && typeof window.__studioAnimAdvNLAEditorOpen === 'function'
       && typeof window.__studioAnimCurveAdd === 'function',
    null, { timeout: 15000 },
  );

  // ─── Spawn two cubes — one source, one target. ────────────────────
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);

  const { srcUuid, tgtUuid } = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const cubes = [];
    vp.scene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cubes.push(o);
    });
    if (cubes.length < 2) return { srcUuid: null, tgtUuid: null };
    cubes[0].position.set(0.05, 0, 0);
    cubes[1].position.set(-0.05, 0, 0);
    cubes[0].updateMatrixWorld(true);
    cubes[1].updateMatrixWorld(true);
    vp.transformControls.attach(cubes[1]);
    return { srcUuid: cubes[0].uuid, tgtUuid: cubes[1].uuid };
  });
  expect(typeof srcUuid).toBe('string');
  expect(typeof tgtUuid).toBe('string');
  await win.screenshot({ path: path.join(OUT, '00-cubes.png') });

  // ─── DRIVER 1: target.position.y = source.position.x * 2. ─────────
  const addDrv = await win.evaluate(({ s, t }) =>
    window.__studioAnimAdvDriverAdd(t, 'position.y', s, 'position.x', 'a * 2'),
    { s: srcUuid, t: tgtUuid },
  );
  expect(addDrv.ok).toBe(true);
  expect(typeof addDrv.uuid).toBe('string');
  const drvUuid = addDrv.uuid;

  // Move the source and apply once — target's y should snap to 2*0.05=0.1.
  await win.evaluate(({ s }) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', s);
    m.position.x = 0.05;
  }, { s: srcUuid });
  await win.evaluate(() => window.__studioAnimAdvDriverApplyNow(0));
  let tgtY = await win.evaluate((t) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', t);
    return m.position.y;
  }, tgtUuid);
  expect(tgtY).toBeCloseTo(0.1, 4);

  // ─── Whitelist sanity: sin / clamp / if all parse & evaluate. ─────
  const sinDrv = await win.evaluate(({ s, t }) =>
    window.__studioAnimAdvDriverAdd(t, 'position.z', s, 'position.x', 'sin(a) + clamp(a, 0, 1) + (if a > 0 1 0)'),
    { s: srcUuid, t: tgtUuid },
  );
  expect(sinDrv.ok).toBe(true);
  await win.evaluate(() => window.__studioAnimAdvDriverApplyNow(0));
  const tgtZ = await win.evaluate((t) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', t);
    return m.position.z;
  }, tgtUuid);
  // a = 0.05  →  sin(0.05) + clamp(0.05,0,1) + 1 ≈ 0.04998 + 0.05 + 1 ≈ 1.0999
  expect(tgtZ).toBeGreaterThan(1.0);
  expect(tgtZ).toBeLessThan(1.2);

  // ─── Bad expression rejects without throwing. ─────────────────────
  const bad = await win.evaluate(({ s, t }) =>
    window.__studioAnimAdvDriverAdd(t, 'position.y', s, 'position.x', 'a ^ 2'),
    { s: srcUuid, t: tgtUuid },
  );
  expect(bad.ok).toBe(false);
  expect(String(bad.error || '')).toMatch(/parse|illegal/i);

  // The slice mandates pure parser — no eval / no Function. Sanity-
  // check the bundle never resolves `Function('return a')` etc.
  const evalRes = await win.evaluate(({ s, t }) =>
    window.__studioAnimAdvDriverAdd(t, 'position.y', s, 'position.x', 'constructor.constructor("return 42")()'),
    { s: srcUuid, t: tgtUuid },
  );
  expect(evalRes.ok).toBe(false);

  // ─── Disable then re-enable: writes pause / resume. ───────────────
  // First move source so target.y would be 4*0.07=0.28 if driver fires.
  await win.evaluate(({ s, t }) => {
    const ms = window.__archdiscScene.getObjectByProperty('uuid', s);
    const mt = window.__archdiscScene.getObjectByProperty('uuid', t);
    ms.position.x = 0.07;
    mt.position.y = 999;
  }, { s: srcUuid, t: tgtUuid });
  await win.evaluate((u) => window.__studioAnimAdvDriverEnable(u, false), drvUuid);
  await win.evaluate(() => window.__studioAnimAdvDriverApplyNow(0));
  const disabledY = await win.evaluate((t) =>
    window.__archdiscScene.getObjectByProperty('uuid', t).position.y, tgtUuid);
  expect(disabledY).toBeCloseTo(999, 1);
  await win.evaluate((u) => window.__studioAnimAdvDriverEnable(u, true), drvUuid);
  await win.evaluate(() => window.__studioAnimAdvDriverApplyNow(0));
  const reenabledY = await win.evaluate((t) =>
    window.__archdiscScene.getObjectByProperty('uuid', t).position.y, tgtUuid);
  expect(reenabledY).toBeCloseTo(0.14, 4);

  // Driver list reports both drivers.
  const drvList = await win.evaluate(() => window.__studioAnimAdvDriverList());
  expect(drvList.ok).toBe(true);
  expect(drvList.count).toBe(2);

  await win.screenshot({ path: path.join(OUT, '01-drivers.png') });

  // ─── NLA: author a curve, wrap it in two strips. ──────────────────
  const curveAdd = await win.evaluate((t) =>
    window.__studioAnimCurveAdd(t, 'position', 1),
    tgtUuid,
  );
  expect(curveAdd.ok).toBe(true);
  const curveUuid = curveAdd.uuid;
  // Replace seeded keys with an explicit ramp 0 → 0.3 over 1 second.
  await win.evaluate(({ c }) => {
    window.__studioAnimCurveAddKey(c, 0, 0, { x: -0.1, y: 0 }, { x: 0.1, y: 0 }, 'linear');
    window.__studioAnimCurveAddKey(c, 1, 0.3, { x: -0.1, y: 0 }, { x: 0.1, y: 0 }, 'linear');
  }, { c: curveUuid });

  // Strip A: t∈[0,1], replace.
  const stripA = await win.evaluate(({ t, c }) =>
    window.__studioAnimAdvNLAStripAdd(t, 'position.y', c, 0, 1, { blend: 'replace' }),
    { t: tgtUuid, c: curveUuid },
  );
  expect(stripA.ok).toBe(true);
  // Strip B: t∈[2,3], add (so it stacks on top of whatever was there).
  const stripB = await win.evaluate(({ t, c }) =>
    window.__studioAnimAdvNLAStripAdd(t, 'position.y', c, 2, 3, { blend: 'add' }),
    { t: tgtUuid, c: curveUuid },
  );
  expect(stripB.ok).toBe(true);

  // Disable the driver so it doesn't fight the NLA on position.y.
  await win.evaluate((u) => window.__studioAnimAdvDriverEnable(u, false), drvUuid);

  // Apply at t=0.5 — strip A is half-way (curve sampled at local 0.5 = 0.15).
  await win.evaluate((t) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', t);
    m.position.y = 0;
  }, tgtUuid);
  await win.evaluate(() => window.__studioAnimAdvNLAStripApplyNow(0.5));
  const stripA_Y = await win.evaluate((t) =>
    window.__archdiscScene.getObjectByProperty('uuid', t).position.y, tgtUuid);
  expect(stripA_Y).toBeCloseTo(0.15, 3);

  // Apply at t=2.5 — strip B (additive) over current value (0.15 from
  // last write). Local 0.5 → 0.15. Result: 0.15 + 0.15 = 0.30.
  await win.evaluate(() => window.__studioAnimAdvNLAStripApplyNow(2.5));
  const stripB_Y = await win.evaluate((t) =>
    window.__archdiscScene.getObjectByProperty('uuid', t).position.y, tgtUuid);
  expect(stripB_Y).toBeCloseTo(0.30, 3);

  // Apply outside any strip window — value is left alone.
  await win.evaluate(() => window.__studioAnimAdvNLAStripApplyNow(5));
  const outside_Y = await win.evaluate((t) =>
    window.__archdiscScene.getObjectByProperty('uuid', t).position.y, tgtUuid);
  expect(outside_Y).toBeCloseTo(0.30, 3);

  // Multi-strip list + mul-blend update.
  const stripList = await win.evaluate(() => window.__studioAnimAdvNLAStripList());
  expect(stripList.ok).toBe(true);
  expect(stripList.count).toBe(2);
  await win.evaluate((u) => window.__studioAnimAdvNLAStripSetBlend(u, 'mul'), stripB.uuid);
  const stripList2 = await win.evaluate(() => window.__studioAnimAdvNLAStripList());
  expect(stripList2.strips.find((s) => s.uuid === stripB.uuid).blend).toBe('mul');

  // Move strip B with setTime.
  const setT = await win.evaluate((u) =>
    window.__studioAnimAdvNLAStripSetTime(u, 4, 5),
    stripB.uuid,
  );
  expect(setT.ok).toBe(true);
  expect(setT.start).toBeCloseTo(4, 5);
  expect(setT.end).toBeCloseTo(5, 5);

  await win.screenshot({ path: path.join(OUT, '02-nla-applied.png') });

  // ─── NLA editor open → DOM checks → close. ────────────────────────
  await win.evaluate(() => window.__studioAnimAdvNLAEditorOpen());
  await expect(win.locator('[data-studio-v3-animadv-nla-editor]')).toBeVisible({ timeout: 5000 });
  await expect(win.locator('[data-studio-v3-animadv-nla-svg]')).toBeVisible({ timeout: 5000 });
  await expect(win.locator(`[data-studio-v3-animadv-nla-block="${stripA.uuid}"]`)).toHaveCount(1);
  await expect(win.locator(`[data-studio-v3-animadv-nla-block="${stripB.uuid}"]`)).toHaveCount(1);
  await win.screenshot({ path: path.join(OUT, '03-nla-editor.png') });

  // Delete strip A through the editor row button.
  await win.locator(`[data-studio-v3-animadv-nla-delete="${stripA.uuid}"]`).click();
  await win.waitForTimeout(150);
  const stripList3 = await win.evaluate(() => window.__studioAnimAdvNLAStripList());
  expect(stripList3.count).toBe(1);

  // Change blend through the editor dropdown.
  await win.locator(`[data-studio-v3-animadv-nla-blend="${stripB.uuid}"]`).selectOption('add');
  const stripList4 = await win.evaluate(() => window.__studioAnimAdvNLAStripList());
  expect(stripList4.strips[0].blend).toBe('add');

  await win.locator('[data-studio-v3-animadv-nla-close]').click();
  await expect(win.locator('[data-studio-v3-animadv-nla-editor]')).toBeHidden();

  // ─── TogglePlay arms the per-frame tick. ──────────────────────────
  const playOn = await win.evaluate(() => window.__studioAnimAdvTogglePlay());
  expect(playOn.ok).toBe(true);
  expect(playOn.playing).toBe(true);
  const playOff = await win.evaluate(() => window.__studioAnimAdvTogglePlay());
  expect(playOff.ok).toBe(true);
  expect(playOff.playing).toBe(false);

  // ─── Multi-cam screenshots so the remote watcher can see motion. ──
  await win.evaluate(() => window.__studioAnimAdvNLAStripApplyNow(0.5));
  for (const view of ['front', 'top', 'right', 'iso', 'close']) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport; if (!vp || !vp.camera) return;
      const c = vp.camera;
      if (v === 'front') c.position.set(0, 0.3, 0.4);
      else if (v === 'top') c.position.set(0, 0.6, 0.001);
      else if (v === 'right') c.position.set(0.4, 0.3, 0);
      else if (v === 'iso') c.position.set(0.3, 0.3, 0.3);
      else if (v === 'close') c.position.set(0.1, 0.15, 0.18);
      c.lookAt(0, 0.1, 0);
    }, view);
    await win.waitForTimeout(120);
    await win.screenshot({ path: path.join(OUT, `04-cam-${view}.png`) });
  }

  // ─── Command palette: every animadv op exists under "animadv". ────
  const cmds = await win.evaluate(() => window.__studioCommandList && window.__studioCommandList('animadv'));
  expect(cmds && cmds.ok).toBe(true);
  expect(cmds.count).toBeGreaterThanOrEqual(15);
  const names = cmds.commands.map((c) => c.name);
  for (const expected of [
    '__studioAnimAdvDriverAdd', '__studioAnimAdvDriverList',
    '__studioAnimAdvDriverDelete', '__studioAnimAdvDriverEnable',
    '__studioAnimAdvNLAStripAdd', '__studioAnimAdvNLAStripList',
    '__studioAnimAdvNLAStripSetBlend', '__studioAnimAdvNLAStripSetTime',
    '__studioAnimAdvNLAStripDelete',
    '__studioAnimAdvNLAEditorOpen', '__studioAnimAdvNLAEditorClose',
    '__studioAnimAdvNLAEditorToggle',
    '__studioAnimAdvTogglePlay',
  ]) {
    expect(names).toContain(expected);
  }

  // eslint-disable-next-line no-console
  console.log('  animadv: %d drivers, %d strips, stripA_Y=%f, stripB_Y=%f',
    drvList.count, stripList.count, stripA_Y, stripB_Y);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
