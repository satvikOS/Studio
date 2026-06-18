// GENUINE-CUA PHOTOREAL DEMO (the "Archie authors a photoreal room, today" pillar).
//
// Proves photoreal CREATE + PROCESS is PURELY computer-use (CUA): the scene is
// authored ONLY through the same REAL UI ops executeToolCall dispatches — one
// click per real-furniture button, last-primitive transforms via set-selection,
// a real Stage Preset click for lighting, and a real Render-button click — NEVER
// the one-shot "compose real scene" room builder (which spawns an entire room in
// one call; FORBIDDEN as the agent action — see the guard test below).
//
// Each op below is the EXACT body of the matching executeToolCall branch in
// StudioShellV3.jsx (place-furniture / set-selection / click-stage-preset /
// click-discipline / render): a querySelector(...).click() on the live
// data-studio-v3-* control, or a direct transform of the most-recently-spawned
// primitive. We dispatch them in-page the same way the cmdbar's onToolCall does
// — no composer is reachable from this path, and the guard test below asserts
// the spec source never even NAMES a composer.
//
// Loads the BUILT dist headed in Electron (no --dev), mirroring
// demo-archie-cua-cinematic.spec.js.
import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const OUT = path.resolve(__dirname, 'shots', 'studio', 'cua-photoreal');
const STEPS = path.join(OUT, 'steps');

// ─── self-guard: this spec must NEVER call a scene composer ────────────────
// The whole point is "purely CUA". Read our own source and assert it contains
// ZERO references to the forbidden composer ops, so a future edit can't quietly
// reintroduce the one-shot room builder and still pass.
test('guard: spec never calls a scene composer (purely CUA)', () => {
  const src = fs.readFileSync(__filename, 'utf8');
  const FORBIDDEN = ['__studioComposeRealScene', '__studioComposeScene'];
  // The forbidden names are NAMED once each in the FORBIDDEN array above so the
  // guard can check for them. Outside that single declaration line, neither may
  // appear anywhere in the spec (no composer call site). Blank the declaration,
  // then grep what remains.
  const scrubbed = src.replace(/const FORBIDDEN = \[[^\]]*\];/, 'const FORBIDDEN = [];');
  for (const name of FORBIDDEN) {
    expect(scrubbed, `forbidden composer call "${name}" found in spec`).not.toContain(name);
  }
});

test('Archie authors a photoreal living room purely via CUA ops (no composer)', async () => {
  test.setTimeout(12 * 60 * 1000);
  fs.mkdirSync(STEPS, { recursive: true });

  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js')], slowMo: 50 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => { try { window.localStorage.setItem('studio.v3.tour-seen', '1'); window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {} });
  await win.reload();
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 25000 });
  // the furniture library + render controls must be mounted (right rail) and the
  // curated type set exposed on window before we drive any op.
  await win.waitForFunction(() => Array.isArray(window.__studioFurnitureTypes) && window.__studioFurnitureTypes.length >= 12, { timeout: 25000 });
  await win.waitForTimeout(600);

  // ─── the ONLY dispatch surface this spec uses ─────────────────────────────
  // A faithful, in-page re-implementation of executeToolCall's CUA branches.
  // Each branch does EXACTLY what StudioShellV3.jsx's executeToolCall does:
  //  • click-discipline   → querySelector('[data-studio-v3-wb=...]').click()
  //  • place-furniture    → validate vs window.__studioFurnitureTypes, then
  //                         querySelector('[data-studio-v3-furniture=...]').click()
  //  • set-selection      → transform the most-recently-spawned primitive
  //  • click-stage-preset → querySelector('[data-studio-v3-stage-preset=...]').click()
  //  • render             → reset window.__studioLastRender, click
  //                         [data-studio-v3-render], poll for the dataUrl
  // No composer is referenced anywhere — these are pure UI ops.
  async function op(call) {
    return win.evaluate(async ({ name, args }) => {
      const TRAINED_TO_STUDIO_DISCIPLINE = { modeling: 'model', sculpting: 'sculpt', 'uv-texture': 'uv', rigging: 'animate', animation: 'animate', 'vfx-sim': 'sim', rendering: 'render', compositing: 'compose' };
      const a = args || {};
      if (name === 'click-discipline') {
        const raw = String(a.id || '');
        const id = TRAINED_TO_STUDIO_DISCIPLINE[raw] || raw;
        const el = document.querySelector(`[data-studio-v3-wb="${id}"]`);
        if (!el) return { ok: false, summary: `unknown discipline "${raw}"` };
        el.click();
        return { ok: true, summary: `switched to ${id}` };
      }
      if (name === 'place-furniture') {
        const type = String(a.type || a.id || '').toLowerCase();
        const valid = Array.isArray(window.__studioFurnitureTypes) ? window.__studioFurnitureTypes : [];
        if (!valid.includes(type)) return { ok: false, summary: `unknown furniture type "${type}"` };
        const el = document.querySelector(`[data-studio-v3-furniture="${type}"]`);
        if (!el) return { ok: false, summary: `no furniture button for "${type}"` };
        el.click();
        await new Promise((r) => setTimeout(r, 0));
        return { ok: true, summary: `placed ${type}` };
      }
      if (name === 'set-selection') {
        const axis = String(a.axis || '').toLowerCase();
        const value = Number(a.value);
        if (!isFinite(value)) return { ok: false, summary: `set-selection bad value ${a.value}` };
        const scene = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
        if (!scene) return { ok: false, summary: 'set-selection: no scene' };
        let target = null;
        if (window.__studioLastPlacedGroup && window.__studioLastPlacedGroup.parent) target = window.__studioLastPlacedGroup;
        if (!target) scene.traverse((o) => { if (o && o.userData && o.userData.archdiscStudioPrimitive) target = o; });
        if (!target) return { ok: false, summary: 'set-selection: no primitive to configure' };
        const dash = axis.indexOf('-');
        const comp = dash >= 0 ? axis.slice(0, dash) : axis;
        const k = dash >= 0 ? axis.slice(dash + 1) : 'all';
        const vec = comp === 'scale' ? target.scale : comp === 'position' ? target.position : comp === 'rotation' ? target.rotation : null;
        if (!vec) return { ok: false, summary: `set-selection unknown axis "${axis}"` };
        if (k === 'all') vec.set(value, value, value);
        else if (k === 'x' || k === 'y' || k === 'z') vec[k] = value;
        else return { ok: false, summary: `set-selection unknown axis "${axis}"` };
        target.updateMatrix && target.updateMatrix();
        target.updateMatrixWorld && target.updateMatrixWorld(true);
        return { ok: true, summary: `set ${axis} = ${value}` };
      }
      if (name === 'click-stage-preset') {
        const id = String(a.id || a.preset || '').toLowerCase();
        const el = document.querySelector(`[data-studio-v3-stage-preset="${id}"]`);
        if (!el) return { ok: false, summary: `unknown stage preset "${id}"` };
        el.click();
        return { ok: true, summary: `stage lighting ${id}` };
      }
      if (name === 'render') {
        const el = document.querySelector('[data-studio-v3-render]');
        if (!el) return { ok: false, summary: 'no render control' };
        window.__studioLastRender = null;
        el.click();
        const deadline = Date.now() + 180000;
        while (Date.now() < deadline) {
          const r = window.__studioLastRender;
          if (r && r.dataUrl) return { ok: true, summary: `render ${r.width}x${r.height} @ ${r.samples}spp` };
          await new Promise((res) => setTimeout(res, 250));
        }
        return { ok: false, summary: 'render timed out (no __studioLastRender)' };
      }
      return { ok: false, summary: `unknown tool "${name}"` };
    }, { name: call.name, args: call.arguments });
  }

  // count real-furniture bodies (tagged archdiscRealMaterial) currently in scene.
  const realBodies = () => win.evaluate(() => {
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    let groups = 0; let meshes = 0;
    if (s) s.traverse((o) => {
      if (o && o.userData && o.userData.archdiscRealMaterial) {
        if (o.isMesh) meshes++; else groups++;
      }
    });
    return { groups, meshes };
  });

  // robust settle-wait for one real-furniture model load (glTF + textures): the
  // place-furniture click kicks an async loader; wait until the real-body count
  // actually rises (or a generous timeout) before arranging that piece.
  async function settleAfterPlace(prevGroups) {
    const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
      const c = (await realBodies()).groups;
      if (c > prevGroups) return c;
      await win.waitForTimeout(500);
    }
    return (await realBodies()).groups;
  }

  await win.screenshot({ path: path.join(STEPS, 'step-00-empty.png') });

  // ── the EXACT CUA op sequence (a living room, authored piece-by-piece) ──────
  // 1) enter the modeling workbench
  // 2-8) place 7 real pieces; after each place, settle the load then ARRANGE it
  //       with set-selection (position-x / position-z) into a sensible layout:
  //         sofa     → back of the room      (z -0.9)
  //         armchair → left flank, angled    (x -1.1, z 0.2)
  //         armchair → right flank, angled   (x  1.1, z 0.2)
  //         coffee-table → centre            (x 0, z 0)
  //         bookshelf → back-left wall        (x -1.6, z -1.1)
  //         plant    → back-right corner      (x  1.7, z -1.1)
  //         lamp     → beside the left chair  (x -1.5, z 0.6)
  // 9) cinematic lighting via a REAL Stage Preset click (showroom)
  // 10) Render (path-traced) → window.__studioLastRender
  // ~6 m living room — furniture spread so ~1.5-2 m pieces don't overlap;
  // sofa to the back wall, coffee table in front, armchairs flanking + turned
  // toward centre, bookshelf + plant against the back corners, lamp up front.
  const PIECES = [
    { type: 'sofa',         arrange: [['position-x', 0.0], ['position-z', -2.3]] },
    { type: 'armchair',     arrange: [['position-x', -2.5], ['position-z', 0.4], ['rotation-y', 0.8]] },
    { type: 'armchair',     arrange: [['position-x', 2.5], ['position-z', 0.4], ['rotation-y', -0.8]] },
    { type: 'coffee-table', arrange: [['position-x', 0.0], ['position-z', -0.7]] },
    { type: 'bookshelf',    arrange: [['position-x', -3.1], ['position-z', -2.4]] },
    { type: 'plant',        arrange: [['position-x', 3.0], ['position-z', -2.4]] },
    { type: 'lamp',         arrange: [['position-x', -3.0], ['position-z', 1.2]] },
  ];

  const seq = [];
  const log = (call, res) => { seq.push({ call, res }); console.log(`[cua] ${call.name} ${JSON.stringify(call.arguments)} → ${res.ok ? 'OK' : 'FAIL'} ${res.summary}`); expect(res.ok, `${call.name} ${JSON.stringify(call.arguments)}: ${res.summary}`).toBeTruthy(); };

  // 1) discipline
  {
    const call = { name: 'click-discipline', arguments: { id: 'modeling' } };
    log(call, await op(call));
    await win.waitForTimeout(300);
    await win.screenshot({ path: path.join(STEPS, 'step-01-modeling.png') });
  }

  // 2-8) place + arrange each piece
  let placed = 0;
  for (let i = 0; i < PIECES.length; i++) {
    const piece = PIECES[i];
    const before = (await realBodies()).groups;
    const placeCall = { name: 'place-furniture', arguments: { type: piece.type } };
    log(placeCall, await op(placeCall));
    const after = await settleAfterPlace(before);
    if (after > before) placed = after;
    console.log(`[cua] settle: real-furniture groups ${before} → ${after}`);
    // arrange THIS piece (it is the most-recently-spawned primitive that
    // set-selection targets) into the layout.
    for (const [axis, value] of piece.arrange) {
      const arr = { name: 'set-selection', arguments: { axis, value } };
      log(arr, await op(arr));
    }
    await win.screenshot({ path: path.join(STEPS, `step-${String(i + 2).padStart(2, '0')}-${piece.type}.png`) });
  }

  const afterBuild = await realBodies();
  console.log(`[cua] built living room — real-furniture groups=${afterBuild.groups} meshes=${afterBuild.meshes}`);

  // 9) cinematic lighting — REAL Stage Preset click (not the light composer)
  {
    const call = { name: 'click-stage-preset', arguments: { id: 'showroom' } };
    log(call, await op(call));
    await win.waitForTimeout(400);
    await win.screenshot({ path: path.join(STEPS, 'step-09-lit.png') });
  }

  // 10) Render (path-traced) → window.__studioLastRender
  let render;
  {
    const call = { name: 'render', arguments: {} };
    render = await op(call);
    log(call, render);
  }

  // harvest the produced render dataURL to disk.
  const last = await win.evaluate(() => {
    const r = window.__studioLastRender;
    return r ? { dataUrl: r.dataUrl, width: r.width, height: r.height, samples: r.samples } : null;
  });
  expect(last, 'no window.__studioLastRender after render op').toBeTruthy();
  expect(last.dataUrl, 'render produced no dataURL').toMatch(/^data:image\/png;base64,/);
  fs.writeFileSync(path.join(OUT, 'living-room.png'), Buffer.from(last.dataUrl.split(',')[1], 'base64'));
  console.log(`[cua] render ${last.width}x${last.height} @ ${last.samples}spp → ${path.join(OUT, 'living-room.png')}`);

  // emit the exact op sequence for the report.
  console.log('\n[cua] OP SEQUENCE:\n' + seq.map((s, i) => `  ${i + 1}. ${s.call.name} ${JSON.stringify(s.call.arguments)}`).join('\n'));

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; }).catch(() => {});
  await app.close();

  // ── assertions ─────────────────────────────────────────────────────────────
  // >=5 real-furniture bodies in the scene (tagged archdiscRealMaterial). Each
  // placed piece is a Group with >=1 real mesh; assert by group count (>=5) AND
  // that real meshes exist.
  expect(afterBuild.groups, `expected >=5 real-furniture groups, got ${afterBuild.groups}`).toBeGreaterThanOrEqual(5);
  expect(afterBuild.meshes, 'expected real-furniture meshes tagged archdiscRealMaterial').toBeGreaterThanOrEqual(5);
  // a render dataURL was produced.
  expect(render.ok, `render op failed: ${render.summary}`).toBeTruthy();
});
