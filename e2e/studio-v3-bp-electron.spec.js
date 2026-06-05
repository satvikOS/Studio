import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-bp');

test('Studio V3 — Blueprints visual exec+data scripting graph (slice bp-1)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  // Launch headed Mac-Electron against the Vite dev server so we can
  // dynamic-import the bp autoload (mirrors the shader spec pattern
  // — api.js may not have been wired by the orchestrator yet).
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

  // ─── Ensure the bp module is installed. ───────────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioBPNodeAdd !== 'function') {
      await import('/src/workbenches/studio/v3/bp/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioBPNodeAdd === 'function', null, { timeout: 15000 });

  // ─── Spawn a cube + attach selection (target mesh for SetMeshTransform). ─
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(400);
  const cubeUuid = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let cube = null;
    vp.scene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') cube = o; });
    if (cube) vp.transformControls.attach(cube);
    return cube ? cube.uuid : null;
  });
  expect(cubeUuid).toBeTruthy();
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '00-cube.png') });

  // ─── Default seed graph: 4 nodes (OnStart→Log, OnTick→Log). ───────
  const seeded = await win.evaluate(() => window.__studioBPListNodes());
  expect(seeded.ok).toBe(true);
  expect(seeded.count).toBeGreaterThanOrEqual(4);
  // exec wires present
  expect(seeded.wires.filter((w) => w.kind === 'exec').length).toBeGreaterThanOrEqual(2);

  // ─── Programmatic node CRUD across every kind. ────────────────────
  const allKinds = ['OnStart', 'OnTick', 'OnKeyDown',
                    'CallStudioOp', 'SetMeshTransform', 'Log', 'Branch', 'Delay',
                    'Number', 'Vector3', 'Get', 'Math'];
  const createdUuids = {};
  for (const k of allKinds) {
    const r = await win.evaluate((kind) => window.__studioBPNodeAdd(kind, {}), k);
    expect(r.ok).toBe(true);
    expect(typeof r.uuid).toBe('string');
    createdUuids[k] = r.uuid;
  }

  // ─── Wire OnKeyDown(k) → Log("k pressed"); validate exec wire. ────
  const onKey = await win.evaluate(() => window.__studioBPNodeAdd('OnKeyDown', { key: 'k' }));
  const logK = await win.evaluate(() => window.__studioBPNodeAdd('Log', { message: 'k pressed' }));
  const wExec = await win.evaluate(({ a, b }) =>
    window.__studioBPConnectExec(a, 'then', b, 'exec'),
  { a: onKey.uuid, b: logK.uuid });
  expect(wExec.ok).toBe(true);

  // ─── Wire OnTick.deltaTime (data) → Math(a) and Number(b=2) → Math(b). ─
  const onTickB = await win.evaluate(() => window.__studioBPNodeAdd('OnTick', {}));
  const num = await win.evaluate(() => window.__studioBPNodeAdd('Number', { value: 2 }));
  const mathN = await win.evaluate(() => window.__studioBPNodeAdd('Math', { op: 'mul' }));
  const logMath = await win.evaluate(() => window.__studioBPNodeAdd('Log', { message: '' }));
  expect((await win.evaluate(({ a, b }) =>
    window.__studioBPConnectExec(a, 'then', b, 'exec'),
    { a: onTickB.uuid, b: logMath.uuid })).ok).toBe(true);
  expect((await win.evaluate(({ a, b }) =>
    window.__studioBPConnectData(a, 'deltaTime', b, 'a'),
    { a: onTickB.uuid, b: mathN.uuid })).ok).toBe(true);
  expect((await win.evaluate(({ a, b }) =>
    window.__studioBPConnectData(a, 'value', b, 'b'),
    { a: num.uuid, b: mathN.uuid })).ok).toBe(true);
  expect((await win.evaluate(({ a, b }) =>
    window.__studioBPConnectData(a, 'value', b, 'message'),
    { a: mathN.uuid, b: logMath.uuid })).ok).toBe(true);

  // Bad wire kinds rejected.
  const badData = await win.evaluate(({ a, b }) =>
    window.__studioBPConnectData(a, 'then', b, 'exec'),
  { a: onKey.uuid, b: logK.uuid });
  expect(badData.ok).toBe(false);
  const badExec = await win.evaluate(({ a, b }) =>
    window.__studioBPConnectExec(a, 'value', b, 'message'),
  { a: num.uuid, b: logMath.uuid });
  expect(badExec.ok).toBe(false);

  // ─── Wire SetMeshTransform via a Vector3 data wire. ───────────────
  const setX = await win.evaluate(() => window.__studioBPNodeAdd('SetMeshTransform', {}));
  const vec = await win.evaluate(() =>
    window.__studioBPNodeAdd('Vector3', { x: 0.1, y: 0.1, z: 0.0 }));
  // Hook it from OnKeyDown so pressing K moves the cube to (0.1,0.1,0).
  expect((await win.evaluate(({ a, b }) =>
    window.__studioBPDisconnect(a, 'then', b, 'exec'),
    { a: onKey.uuid, b: logK.uuid })).ok).toBe(true);
  expect((await win.evaluate(({ a, b }) =>
    window.__studioBPConnectExec(a, 'then', b, 'exec'),
    { a: onKey.uuid, b: setX.uuid })).ok).toBe(true);
  // SetMeshTransform.uuid input is a static param; vector goes into pos.
  await win.evaluate(({ uuid, cube }) => {
    const g = window.__studioBPGraph();
    const node = g.nodes.get(uuid);
    node.params.uuid = cube;
  }, { uuid: setX.uuid, cube: cubeUuid });
  expect((await win.evaluate(({ a, b }) =>
    window.__studioBPConnectData(a, 'value', b, 'pos'),
    { a: vec.uuid, b: setX.uuid })).ok).toBe(true);

  // ─── Capture pre-run cube position to compare after key fire. ─────
  const beforePos = await win.evaluate((u) => {
    let p = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === u) p = [o.position.x, o.position.y, o.position.z]; });
    return p;
  }, cubeUuid);
  expect(Array.isArray(beforePos)).toBe(true);

  // ─── Start the runtime, fire a key, assert side-effects. ──────────
  const started = await win.evaluate(() => window.__studioBPRuntimeStart());
  expect(started.ok).toBe(true);
  // Two frames give OnTick + OnStart time to run.
  await win.waitForTimeout(120);
  // Programmatic key fire avoids OS-level focus problems.
  const fired = await win.evaluate(() => window.__studioBPFireKey('k'));
  expect(fired.ok).toBe(true);
  await win.waitForTimeout(120);
  const afterPos = await win.evaluate((u) => {
    let p = null;
    window.__archdiscScene.traverse((o) => { if (o.uuid === u) p = [o.position.x, o.position.y, o.position.z]; });
    return p;
  }, cubeUuid);
  expect(afterPos[0]).toBeCloseTo(0.1, 3);
  expect(afterPos[1]).toBeCloseTo(0.1, 3);

  // ─── Stop runtime; tick chain must un-splice cleanly. ─────────────
  const stopped = await win.evaluate(() => window.__studioBPRuntimeStop());
  expect(stopped.ok).toBe(true);
  const tickHasBp = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let head = vp && vp.__studioAnimTick;
    while (head) { if (head.__bp) return true; head = head.__prev; }
    return false;
  });
  expect(tickHasBp).toBe(false);

  // ─── Serialize / Deserialize round-trip. ──────────────────────────
  const ser = await win.evaluate(() => window.__studioBPSerialize());
  expect(ser.ok).toBe(true);
  expect(Array.isArray(ser.json.nodes)).toBe(true);
  expect(ser.json.nodes.length).toBeGreaterThan(0);
  const before = ser.json.nodes.length;
  await win.evaluate(() => window.__studioBPDeserialize({ version: 1, nodes: [], wires: [] }));
  expect((await win.evaluate(() => window.__studioBPListNodes())).count).toBe(0);
  const restored = await win.evaluate((j) => window.__studioBPDeserialize(j), ser.json);
  expect(restored.ok).toBe(true);
  expect(restored.count).toBe(before);

  // ─── Editor open → DOM mounted → add node → close. ────────────────
  await win.evaluate(() => window.__studioBPEditorOpen());
  await expect(win.locator('[data-studio-v3-bp-editor]')).toBeVisible({ timeout: 5000 });
  await win.screenshot({ path: path.join(OUT, '01-editor-open.png') });

  await win.locator('[data-studio-v3-bp-add="Branch"]').first().click();
  await win.waitForTimeout(200);
  await win.screenshot({ path: path.join(OUT, '02-add-branch.png') });

  // Run / Stop button toggles runtime state.
  await win.locator('[data-studio-v3-bp-run]').click();
  await win.waitForTimeout(200);
  expect(await win.evaluate(() => window.__studioBPRuntime().started)).toBe(true);
  await win.screenshot({ path: path.join(OUT, '03-running.png') });
  await win.locator('[data-studio-v3-bp-run]').click();
  await win.waitForTimeout(200);
  expect(await win.evaluate(() => window.__studioBPRuntime().started)).toBe(false);

  // Exec + data wires must render under distinct kinds.
  const wireKinds = await win.locator('[data-studio-v3-bp-wire-kind]').evaluateAll((els) =>
    Array.from(new Set(els.map((el) => el.getAttribute('data-studio-v3-bp-wire-kind')))));
  expect(wireKinds).toContain('exec');
  expect(wireKinds).toContain('data');

  // Close via the button.
  await win.locator('[data-studio-v3-bp-close]').click();
  await expect(win.locator('[data-studio-v3-bp-editor]')).toBeHidden();

  // ─── Command-palette registration: every op under category 'bp'. ──
  const bpCmds = await win.evaluate(() => window.__studioCommandList && window.__studioCommandList('bp'));
  expect(bpCmds.ok).toBe(true);
  // commands array is filtered, count is the registry total — assert
  // on the filtered list length so a growing registry doesn't flake.
  expect(Array.isArray(bpCmds.commands)).toBe(true);
  expect(bpCmds.commands.length).toBeGreaterThanOrEqual(14);
  expect(bpCmds.commands.every((c) => c.category === 'bp')).toBe(true);

  // ─── Multi-cam screenshots (front / top / right / iso / close). ───
  for (const view of ['front', 'top', 'right', 'iso', 'close']) {
    await win.evaluate((v) => {
      const vp = window.__archdiscViewport; if (!vp || !vp.camera) return;
      const c = vp.camera;
      if (v === 'front') c.position.set(0, 0, 6);
      else if (v === 'top') c.position.set(0, 6, 0.001);
      else if (v === 'right') c.position.set(6, 0, 0);
      else if (v === 'iso') c.position.set(4, 4, 4);
      else if (v === 'close') c.position.set(0.5, 0.5, 0.5);
      c.lookAt(0, 0, 0);
    }, view);
    await win.waitForTimeout(200);
    await win.screenshot({ path: path.join(OUT, `04-cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  bp: nodes=%d, exec/data wires render distinctly, runtime fired keydown',
    restored.count);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
