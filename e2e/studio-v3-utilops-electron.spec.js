import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-utilops');

test('Studio V3 — utility ops family (slice 423)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
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
  await win.waitForFunction(() => typeof window.__studioFilletEdges === 'function', null, { timeout: 15000 });

  // Spawn + select cube.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    let m = null;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
  });

  // BumpOutliner fires custom event.
  const heard = await win.evaluate(() => new Promise((resolve) => {
    const h = (ev) => { window.removeEventListener('studio-outliner-bumped', h); resolve(!!ev); };
    window.addEventListener('studio-outliner-bumped', h);
    window.__studioBumpOutliner();
  }));
  expect(heard).toBe(true);

  // InstancedStress spawns N copies.
  let r = await win.evaluate(() => window.__studioInstancedStress(25));
  expect(r.ok).toBe(true);
  expect(r.count).toBe(25);

  // FilletEdges on the cube — should report sharp edges + shifted verts.
  r = await win.evaluate(() => {
    let m = null;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
    return window.__studioFilletEdges({ radius: 0.001, threshold: Math.PI / 6 });
  });
  expect(r.ok).toBe(true);
  expect(r.filletedEdges).toBeGreaterThan(0);
  expect(r.shiftedVerts).toBeGreaterThan(0);

  // StreamAround → returns ok with a record (may stream 0 cells in mini scene).
  r = await win.evaluate(() => window.__studioStreamAround([0, 0, 0], 0.4, 2));
  expect(r.ok).toBe(true);

  // RevealAll → ok.
  r = await win.evaluate(() => window.__studioRevealAll());
  expect(r.ok).toBe(true);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 423: bumpOutliner + instanced(25) + fillet + stream + reveal all ok');

  await app.close();
});
