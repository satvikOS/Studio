import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-pivot-actions');

test('Studio V3 — inspector pivot/origin actions (slice 472)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
  });
  const win = await app.firstWindow();
  // Slice 471 beforeunload may prompt; auto-dismiss to keep the test
  // from getting stuck on the dialog.
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  // Spawn + select cube + offset it from origin.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  await win.evaluate(() => {
    let m = null;
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'cube') m = o; });
    if (m && window.__studioSelectMesh) window.__studioSelectMesh(m);
    if (m) m.position.set(0.5, 0.3, -0.2);
  });
  await win.waitForTimeout(500);

  // 4 action buttons.
  for (const id of ['center', 'ground', 'recenter', 'apply']) {
    await expect(win.locator(`[data-studio-v3-pivot-action="${id}"]`)).toBeVisible();
  }

  // Click Center at origin → mesh.position close to 0,0,0.
  await win.locator('[data-studio-v3-pivot-action="center"]').click();
  await win.waitForTimeout(300);
  const pos = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return [m.position.x, m.position.y, m.position.z];
  });
  // Centre-at-origin moves the mesh's centroid to origin; the position
  // should be much closer to zero than the 0.5/0.3/-0.2 we set.
  expect(Math.hypot(pos[0], pos[1], pos[2])).toBeLessThan(0.3);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 472: center button moved cube to', pos.map((x) => x.toFixed(3)));

  // Clear dirty + strip the beforeunload listener so worker teardown
  // doesn't time out on Electron's hidden dialog handling.
  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await app.close();
});
