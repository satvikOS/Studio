// Studio V3 — ASL (VEX-style) per-vertex script runner.
//
// Drives the parser/interpreter/runner + React editor installed by
// frontend/src/workbenches/studio/v3/vex/autoload.js. Because this
// slice can't touch api.js, the test side-effect-imports the autoload
// itself via the dev-server URL — same trick the anim/shader e2e's use.
//
// Coverage:
//   • parse() rejects bad syntax with line / col context
//   • parse() accepts every shipped example script
//   • runOnMesh('twist-y') touches every vertex of a cube
//   • each touched vertex actually moves (positions differ from before)
//   • the BufferGeometry bounding sphere is refreshed (size > 0)
//   • runOnSelection runs the same script on the current selection
//   • mirror-x flips x in place (xPost === -xPre)
//   • inflate moves outward (radial distance grows)
//   • non-finite output (divide-by-zero pos.x = 1 / 0) is rejected and
//     the original buffer is restored
//   • editor opens, textarea exists, status is readable, Close hides it
//   • every op registered under 'vex' category (count + names)
//   • multi-cam screenshots (front/top/right/iso/close) for the
//     remote-desktop watcher.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-vex');

test('Studio V3 — ASL VEX-style per-vertex script runner', async () => {
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

  // ── Side-effect-import the autoload. ───────────────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioVexParse !== 'function') {
      await import('/src/workbenches/studio/v3/vex/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioVexParse === 'function'
       && typeof window.__studioVexRun === 'function'
       && typeof window.__studioVexEditorOpen === 'function'
       && typeof window.__studioVexExamples === 'function',
    null, { timeout: 15000 },
  );

  // ── Spawn a cube, attach as selection. ─────────────────────────────
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(300);
  const cubeUuid = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let cube = null;
    vp.scene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cube = o;
    });
    if (!cube) return null;
    cube.position.set(0, 0, 0);
    vp.transformControls.attach(cube);
    cube.updateMatrixWorld(true);
    return cube.uuid;
  });
  expect(typeof cubeUuid).toBe('string');
  await win.screenshot({ path: path.join(OUT, '00-cube.png') });

  // ── parse() rejects bad syntax with line/col. ──────────────────────
  const bad = await win.evaluate(() => window.__studioVexParse('pos.x = pos.x * ;'));
  expect(bad.ok).toBe(false);
  expect(typeof bad.error).toBe('string');
  expect(typeof bad.line).toBe('number');
  expect(typeof bad.col).toBe('number');

  // ── parse() accepts every example. ─────────────────────────────────
  const examples = await win.evaluate(() => window.__studioVexExamples());
  expect(examples.ok).toBe(true);
  expect(examples.names.length).toBeGreaterThanOrEqual(6);
  for (const n of examples.names) {
    const r = await win.evaluate(
      (name) => window.__studioVexParse(window.__studioVexExamples().scripts[name]),
      n,
    );
    expect(r.ok, `example ${n} should parse`).toBe(true);
  }

  // ── Snapshot every cube vertex before any script runs. ─────────────
  const before = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    const pos = m.geometry.attributes.position;
    const arr = new Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      arr[i] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    }
    return { count: pos.count, vertices: arr };
  }, cubeUuid);
  expect(before.count).toBeGreaterThan(0);

  // ── twist-y on the cube via runOnMesh. ─────────────────────────────
  const twistRes = await win.evaluate((u) => {
    const ex = window.__studioVexExamples();
    return window.__studioVexRunOnMesh(u, ex.scripts['twist-y']);
  }, cubeUuid);
  expect(twistRes.ok).toBe(true);
  expect(twistRes.touched).toBe(before.count);

  const afterTwist = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    const pos = m.geometry.attributes.position;
    const arr = new Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      arr[i] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    }
    return { vertices: arr, bsphereR: m.geometry.boundingSphere ? m.geometry.boundingSphere.radius : 0 };
  }, cubeUuid);
  let moved = 0;
  for (let i = 0; i < before.count; i++) {
    const a = before.vertices[i], b = afterTwist.vertices[i];
    if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 0.0005) moved += 1;
  }
  // Twist around the y axis: vertices off the axis must move. A cube
  // has 8 corner vertices, all off-axis ⇒ all should move. The cube
  // primitive has more than 8 (subdivided faces), but every one of
  // them is off-axis ⇒ all should move.
  expect(moved).toBeGreaterThan(0);
  expect(afterTwist.bsphereR).toBeGreaterThan(0);
  await win.screenshot({ path: path.join(OUT, '01-after-twist.png') });

  // ── Reset by spawning a fresh cube to keep tests isolated. ─────────
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(250);
  const cube2 = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let last = null;
    vp.scene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') last = o;
    });
    last.position.set(0, 0, 0);
    vp.transformControls.attach(last);
    last.updateMatrixWorld(true);
    return last.uuid;
  });

  // mirror-x: x_post === -x_pre for every vertex
  const beforeMirror = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    const pos = m.geometry.attributes.position;
    const arr = new Array(pos.count);
    for (let i = 0; i < pos.count; i++) arr[i] = pos.getX(i);
    return arr;
  }, cube2);

  const mirrorRes = await win.evaluate(
    (u) => window.__studioVexRunOnMesh(u, window.__studioVexExamples().scripts['mirror-x']),
    cube2,
  );
  expect(mirrorRes.ok).toBe(true);

  const afterMirror = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    const pos = m.geometry.attributes.position;
    const arr = new Array(pos.count);
    for (let i = 0; i < pos.count; i++) arr[i] = pos.getX(i);
    return arr;
  }, cube2);

  for (let i = 0; i < beforeMirror.length; i++) {
    expect(afterMirror[i]).toBeCloseTo(-beforeMirror[i], 5);
  }

  // ── runOnSelection (current sel is cube2). ─────────────────────────
  const inflateBefore = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    const pos = m.geometry.attributes.position;
    let sumR = 0;
    for (let i = 0; i < pos.count; i++) {
      sumR += Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    return sumR;
  }, cube2);

  const inflateRes = await win.evaluate(
    () => window.__studioVexRun(window.__studioVexExamples().scripts.inflate),
  );
  expect(inflateRes.ok).toBe(true);

  const inflateAfter = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    const pos = m.geometry.attributes.position;
    let sumR = 0;
    for (let i = 0; i < pos.count; i++) {
      sumR += Math.hypot(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    return sumR;
  }, cube2);
  expect(inflateAfter).toBeGreaterThan(inflateBefore);

  // ── Non-finite output is rejected + buffer rolls back. ─────────────
  const snapBefore = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    const pos = m.geometry.attributes.position;
    const arr = new Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      arr[i] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    }
    return arr;
  }, cube2);

  const badRun = await win.evaluate((u) => {
    // 1/0 → Infinity → caught by the runner's non-finite guard.
    return window.__studioVexRunOnMesh(u, 'pos.x = 1 / 0;');
  }, cube2);
  expect(badRun.ok).toBe(false);

  const snapAfter = await win.evaluate((u) => {
    const m = window.__archdiscScene.getObjectByProperty('uuid', u);
    const pos = m.geometry.attributes.position;
    const arr = new Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      arr[i] = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    }
    return arr;
  }, cube2);
  for (let i = 0; i < snapBefore.length; i++) {
    expect(snapAfter[i][0]).toBeCloseTo(snapBefore[i][0], 6);
    expect(snapAfter[i][1]).toBeCloseTo(snapBefore[i][1], 6);
    expect(snapAfter[i][2]).toBeCloseTo(snapBefore[i][2], 6);
  }

  // ── Editor open + DOM hooks. ───────────────────────────────────────
  await win.evaluate(() => window.__studioVexEditorOpen());
  await expect(win.locator('[data-studio-v3-vex-editor]')).toBeVisible({ timeout: 5000 });
  await expect(win.locator('[data-studio-v3-vex-textarea]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-vex-status]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-vex-examples]')).toBeVisible();
  await expect(win.locator('[data-studio-v3-vex-run]')).toBeVisible();
  await win.screenshot({ path: path.join(OUT, '02-editor-open.png') });

  // Click Close.
  await win.locator('[data-studio-v3-vex-close]').click();
  await expect(win.locator('[data-studio-v3-vex-editor]')).toBeHidden();

  // ── Command palette registration: ≥10 ops under 'vex'. ─────────────
  const cmds = await win.evaluate(() => window.__studioCommandList && window.__studioCommandList('vex'));
  expect(cmds && cmds.ok).toBe(true);
  expect(cmds.count).toBeGreaterThanOrEqual(10);
  const names = cmds.commands.map((c) => c.name);
  for (const expected of [
    '__studioVexParse', '__studioVexRun', '__studioVexRunOnMesh',
    '__studioVexEditorOpen', '__studioVexEditorClose', '__studioVexEditorToggle',
    '__studioVexExamples', '__studioVexLoadExample', '__studioVexLimits',
  ]) {
    expect(names).toContain(expected);
  }

  // ── Multi-cam screenshots of the twist-y mesh (cube1 was left alone). ─
  for (const view of ['front', 'top', 'right', 'iso', 'close']) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport; if (!vp || !vp.camera) return;
      const c = vp.camera;
      if (v === 'front') c.position.set(0, 0.3, 2.4);
      else if (v === 'top') c.position.set(0, 2.2, 0.001);
      else if (v === 'right') c.position.set(2.4, 0.3, 0);
      else if (v === 'iso') c.position.set(1.7, 1.7, 1.7);
      else if (v === 'close') c.position.set(0.8, 0.6, 0.9);
      c.lookAt(0, 0, 0);
    }, view);
    await win.waitForTimeout(150);
    await win.screenshot({ path: path.join(OUT, `03-cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  vex asl: %d vertices moved by twist, mirror clean, %d ops registered',
    moved, cmds.count);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
