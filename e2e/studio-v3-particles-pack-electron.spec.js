import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-particles-pack');

test('Studio V3 — particles: create/step/setColors/star/toggle/list (slice 632)', async () => {
  test.setTimeout(180000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
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
  await win.waitForTimeout(400);

  // 1: create
  const c = await win.evaluate(() => window.__studioCreateParticleSystem(800, { radius: 0.3, gravity: -2 }));
  expect(c.ok).toBe(true);
  expect(c.count).toBe(800);
  await win.screenshot({ path: path.join(OUT, '01-create.png') });

  // 2: manual step moves vertices
  const before = await win.evaluate((u) => {
    const p = window.__archdiscScene.getObjectByProperty('uuid', u);
    return p.geometry.attributes.position.array[1];
  }, c.uuid);
  const step = await win.evaluate(() => window.__studioParticleStep(0.05));
  expect(step.ok).toBe(true);
  expect(step.touched).toBeGreaterThan(0);
  const after = await win.evaluate((u) => {
    const p = window.__archdiscScene.getObjectByProperty('uuid', u);
    return p.geometry.attributes.position.array[1];
  }, c.uuid);
  expect(after).not.toBe(before);
  await win.screenshot({ path: path.join(OUT, '02-step.png') });

  // 3: change colors
  const col = await win.evaluate((u) => window.__studioParticleSetColors(u, '#ff0000', '#0000ff'), c.uuid);
  expect(col.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '03-colors.png') });

  // 4: starfield
  const sf = await win.evaluate(() => window.__studioStarfield(2000, 30));
  expect(sf.ok).toBe(true);
  expect(sf.count).toBe(2000);
  await win.screenshot({ path: path.join(OUT, '04-starfield.png') });

  // 5: list
  const list = await win.evaluate(() => window.__studioListParticleSystems());
  expect(list.ok).toBe(true);
  expect(list.count).toBeGreaterThanOrEqual(1);
  await win.screenshot({ path: path.join(OUT, '05-list.png') });

  // 6: toggle anim
  const on = await win.evaluate(() => window.__studioToggleParticleAnim());
  expect(on.on).toBe(true);
  await win.waitForTimeout(250);
  const off = await win.evaluate(() => window.__studioToggleParticleAnim());
  expect(off.on).toBe(false);
  await win.screenshot({ path: path.join(OUT, '06-toggle.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 632: 6 features — particles + starfield + anim toggle (', list.count, 'systems)');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
