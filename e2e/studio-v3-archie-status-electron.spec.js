import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-archie-status');

test('Studio V3 — Archie status dot mounts + reflects ping state (slice 505)', async () => {
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

  const dot = win.locator('[data-studio-v3-archie-status]');
  await expect(dot).toHaveCount(1);
  await expect(dot).toContainText(/Archie/i);

  // After the first ping (Archie may or may not be live in CI), the state
  // should resolve to either online / offline within 3 s.
  await win.waitForFunction(() => {
    const el = document.querySelector('[data-studio-v3-archie-status]');
    return el && el.getAttribute('data-studio-v3-archie-state') !== 'unknown';
  }, null, { timeout: 5000 });

  const state = await dot.getAttribute('data-studio-v3-archie-state');
  expect(['online', 'offline', 'streaming']).toContain(state);

  // Dispatch streaming event → state flips.
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('archie-stream-start')));
  await win.waitForTimeout(200);
  await expect(dot).toHaveAttribute('data-studio-v3-archie-state', 'streaming');

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 505: Archie dot initial state', state, '→ streaming');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
