import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * Studio — Slice 195: SAVE / LOAD SCENE AS JSON.
 *
 * window.__studioSaveScene() -> compact JSON string with every primitive
 * (kind, transform, material, emissive, wireframe) + every Studio light
 * (type, color, intensity, position).
 * window.__studioLoadScene(json) clears the scene and rebuilds it.
 * Parity with File > Save / File > Open in every DCC.
 *
 * Spec builds a 3-body scene, saves to JSON, clears, reloads, and
 * confirms primitive count + per-primitive kind + position survive
 * round-trip.
 *
 * Headed Mac Electron, watchable pace.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'studio-save-load');

test('Studio — save scene as JSON + load it back round-trips primitives', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 800,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('.workbench-current .workbench-name'))
    .toHaveText('ArchDisc Studio', { timeout: 30000 });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscViewport, null, { timeout: 30000 });
  await win.waitForFunction(() => typeof window.__studioSaveScene === 'function', null, { timeout: 30000 });
  await win.waitForTimeout(1500);

  // Build a 3-body scene with distinct kinds + positions.
  await win.waitForFunction(() => typeof window.__archieRun === 'function', null, { timeout: 30000 });
  await win.evaluate(() => {
    const r = {
      goal: 'save load demo',
      scene: { discipline: 'modeling' },
      bodies: [
        { kind: 'cube',         pos: [-0.07, 0, 0], scale: [1, 1, 1], color: '#9ab' },
        { kind: 'sphere',       pos: [ 0,    0, 0], scale: [1, 1, 1], color: '#c9a' },
        { kind: 'icosahedron',  pos: [ 0.07, 0, 0], scale: [1, 1, 1], color: '#ac9' },
      ],
      expect: { bodies: 3, kinds: ['cube', 'icosahedron', 'sphere'] },
    };
    window.__archieEngine.skillStore.save(r.goal, r, 1.0);
    return window.__archieRun({ goals: [r.goal], maxGoals: 1 });
  });
  await win.waitForTimeout(700);
  await win.screenshot({ path: path.join(OUT, '00-original-scene.png') });

  // Save -> json string.
  const saved = await win.evaluate(() => window.__studioSaveScene());
  expect(typeof saved, 'save returns string').toBe('string');
  const parsed = JSON.parse(saved);
  expect(parsed.version, 'schema version').toBe(1);
  expect(parsed.primitives.length, 'saved 3 primitives').toBe(3);
  const savedKinds = parsed.primitives.map((p) => p.kind).sort();
  expect(savedKinds).toEqual(['cube', 'icosahedron', 'sphere']);
  for (const p of parsed.primitives) {
    expect(p.pos, 'each primitive has pos').toHaveLength(3);
    expect(p.scale, 'each primitive has scale').toHaveLength(3);
    expect(p.rot, 'each primitive has rot').toHaveLength(3);
    expect(p.color, 'each primitive has color').toMatch(/^#[0-9a-f]{6}$/i);
  }

  // Clear scene + reload from the saved JSON.
  await win.evaluate(() => window.__archieEngine && (function () {
    // clear via direct scene wipe so we know loadSceneJSON did the rebuild
    const s = window.__archdiscScene;
    if (!s) return;
    const toRemove = [];
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) toRemove.push(o); });
    for (const m of toRemove) s.remove(m);
  })());
  await win.waitForTimeout(300);
  const cleared = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive) n++; });
    return n;
  });
  expect(cleared, 'scene cleared before reload').toBe(0);
  await win.screenshot({ path: path.join(OUT, '01-cleared.png') });
  await win.waitForTimeout(500);

  // Load -> rebuild matches the saved snapshot.
  const loadResult = await win.evaluate((j) => window.__studioLoadScene(j), saved);
  expect(loadResult.ok, 'load succeeded').toBe(true);
  expect(loadResult.primitives, 'load rebuilt 3 primitives').toBe(3);
  await win.waitForTimeout(500);
  const restored = await win.evaluate(() => {
    const kinds = [];
    const positions = [];
    window.__archdiscScene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitive) {
        kinds.push(String(o.userData.archdiscStudioPrimitiveKind || '').replace('-array', ''));
        positions.push([o.position.x, o.position.y, o.position.z]);
      }
    });
    return { kinds: kinds.sort(), positions };
  });
  expect(restored.kinds, 'kinds round-tripped').toEqual(['cube', 'icosahedron', 'sphere']);
  // X positions should be -0.07 / 0 / 0.07 within rounding.
  const xs = restored.positions.map((p) => p[0]).sort((a, b) => a - b);
  expect(xs[0]).toBeCloseTo(-0.07, 2);
  expect(xs[2]).toBeCloseTo( 0.07, 2);
  await win.screenshot({ path: path.join(OUT, '02-restored.png') });
  await win.waitForTimeout(2500);

  // eslint-disable-next-line no-console
  console.log('  slice 195: save / load scene as JSON round-trips primitives + transforms');

  await app.close();
});
