import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-group-multi');

test('Studio V3 — multi-select group folds all selected (slice 506)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 300,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  await win.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });

  // Spawn 3.
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(120);
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(120);
  await win.locator('[data-studio-v3-tool="plane"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(250);

  // Seed the multi-select set manually with all 3 primitives.
  await win.evaluate(() => {
    const s = window.__archdiscScene;
    const arr = [];
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitive && o.userData.archdiscStudioPrimitiveKind !== 'group') arr.push(o); });
    window.__studioSelectedMeshesSet = arr;
  });

  const r = await win.evaluate(() => window.__studioGroupSelected('group'));
  expect(r.ok).toBe(true);
  expect(r.members).toBe(3);

  // Group node now has 3 children.
  const childCount = await win.evaluate(() => {
    const s = window.__archdiscScene;
    let g = null;
    s.traverse((o) => { if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'group') g = o; });
    return g ? g.children.length : 0;
  });
  expect(childCount).toBe(3);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 506: grouped', r.members, 'meshes → group has', childCount, 'children');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
