import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-instance-recolor');

test('Studio V3 — InstancedMesh recolor adds instanceColor (slice 619)', async () => {
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
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(400);

  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(250);

  // Build the instanced mesh then select it.
  await win.evaluate(() => {
    const r = window.__studioScatterInstances(60, 0.3);
    let im = null;
    window.__archdiscScene.traverse((o) => {
      if (o.isInstancedMesh && o.userData && o.userData.archdiscStudioPrimitiveKind === 'instances') im = o;
    });
    if (im && window.__studioSelectMesh) window.__studioSelectMesh(im);
  });
  await win.waitForTimeout(150);

  const r = await win.evaluate(() => window.__studioInstanceRecolor());
  expect(r.ok).toBe(true);
  expect(r.count).toBe(60);

  const hasColor = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return !!(m && m.instanceColor);
  });
  expect(hasColor).toBe(true);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 619: instance recolor ×', r.count);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
