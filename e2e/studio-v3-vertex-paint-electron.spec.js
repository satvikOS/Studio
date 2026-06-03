import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-vertex-paint');

test('Studio V3 — Vertex paint flood-fill adds color attribute (slice 576)', async () => {
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
  await win.waitForTimeout(600);

  await expect(win.locator('[data-studio-v3-vertex-paint]')).toBeVisible();

  // Set color picker via setter so React's onChange fires.
  await win.evaluate(() => {
    const el = document.querySelector('[data-studio-v3-vpaint-color]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, '#00ff00');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await win.waitForTimeout(150);

  await win.locator('[data-studio-v3-vpaint-flood]').click();
  await win.waitForTimeout(250);

  const state = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    const col = m.geometry.attributes.color;
    if (!col) return null;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    return {
      count: col.count,
      first: [col.getX(0), col.getY(0), col.getZ(0)],
      vertexColors: !!(mat && mat.vertexColors),
    };
  });
  expect(state).not.toBeNull();
  expect(state.count).toBeGreaterThan(0);
  expect(state.first[0]).toBeCloseTo(0, 2);
  expect(state.first[1]).toBeCloseTo(1, 2);
  expect(state.first[2]).toBeCloseTo(0, 2);
  expect(state.vertexColors).toBe(true);

  // Rainbow randomises so a single vertex won't be uniform; verify
  // attribute persists and is rewritten.
  await win.locator('[data-studio-v3-vpaint-rainbow]').click();
  await win.waitForTimeout(200);
  const after = await win.evaluate(() => {
    const m = window.__studioSelectedMesh();
    return !!(m.geometry.attributes.color);
  });
  expect(after).toBe(true);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 576: vertex paint flood + rainbow on', state.count, 'verts');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
