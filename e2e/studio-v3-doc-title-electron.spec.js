import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-doc-title');

test('Studio V3 — document.title reflects workbench + dirty (slice 497)', async () => {
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
  await win.waitForTimeout(800);

  // Title reflects default workbench, no dirty marker.
  const t0 = await win.title();
  expect(t0).toMatch(/ArchDisc Studio$/);
  expect(t0.startsWith('•')).toBe(false);

  // Mark dirty + wait for DocTitle poll.
  await win.evaluate(() => { window.__studioV3Dirty = true; });
  await win.waitForTimeout(900);
  const t1 = await win.title();
  expect(t1.startsWith('• ')).toBe(true);

  // Clear dirty.
  await win.evaluate(() => { window.__studioV3Dirty = false; });
  await win.waitForTimeout(900);
  const t2 = await win.title();
  expect(t2.startsWith('• ')).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 497: title:', JSON.stringify(t0), '→', JSON.stringify(t1), '→', JSON.stringify(t2));

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
