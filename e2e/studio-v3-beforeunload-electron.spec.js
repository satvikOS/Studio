import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-beforeunload');

test('Studio V3 — beforeunload guard when dirty (slice 471)', async () => {
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
  await win.waitForTimeout(400);

  // Verify the dirty flag exists + the handler is wired.
  await win.evaluate(() => { window.__studioV3Dirty = true; });
  expect(await win.evaluate(() => window.__studioV3Dirty)).toBe(true);

  // Dispatch a BeforeUnloadEvent and check the handler ran (preventDefault).
  const fired = await win.evaluate(() => {
    let prevented = false;
    const ev = new Event('beforeunload', { cancelable: true });
    // Patch preventDefault to record.
    const origPrev = ev.preventDefault.bind(ev);
    ev.preventDefault = () => { prevented = true; origPrev(); };
    window.dispatchEvent(ev);
    return { prevented, returnValue: ev.returnValue };
  });
  expect(fired.prevented).toBe(true);

  // When dirty is false, no preventDefault.
  await win.evaluate(() => { window.__studioV3Dirty = false; });
  const clean = await win.evaluate(() => {
    let prevented = false;
    const ev = new Event('beforeunload', { cancelable: true });
    const origPrev = ev.preventDefault.bind(ev);
    ev.preventDefault = () => { prevented = true; origPrev(); };
    window.dispatchEvent(ev);
    return { prevented };
  });
  expect(clean.prevented).toBe(false);

  await win.screenshot({ path: path.join(OUT, '00.png') });
  await win.waitForTimeout(500);

  // eslint-disable-next-line no-console
  console.log('  slice 471: beforeunload guard preventsDefault when dirty, lets clean unload pass');

  await app.close();
});
