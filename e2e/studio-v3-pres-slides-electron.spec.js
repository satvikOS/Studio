import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-pres-slides');

test('Studio V3 — presentation slide capture/list/start/next/delete/clear (slice 657)', async () => {
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

  await win.evaluate(() => { window.__archdiscViewport.camera.position.set(2, 1, 2); });
  const s1 = await win.evaluate(() => window.__studioPresentationCaptureSlide('intro'));
  expect(s1.ok).toBe(true);
  await win.evaluate(() => { window.__archdiscViewport.camera.position.set(-2, 2, 1); });
  await win.evaluate(() => window.__studioPresentationCaptureSlide('side'));
  await win.evaluate(() => { window.__archdiscViewport.camera.position.set(0, 4, 0); });
  const s3 = await win.evaluate(() => window.__studioPresentationCaptureSlide('top'));
  expect(s3.total).toBe(3);
  await win.screenshot({ path: path.join(OUT, '01-capture.png') });

  const list = await win.evaluate(() => window.__studioPresentationListSlides());
  expect(list.count).toBe(3);
  expect(list.slides.map((s) => s.name)).toEqual(['intro', 'side', 'top']);
  await win.screenshot({ path: path.join(OUT, '02-list.png') });

  const st = await win.evaluate(() => window.__studioPresentationStart());
  expect(st.ok).toBe(true);
  expect(st.name).toBe('intro');
  const pos0 = await win.evaluate(() => [
    window.__archdiscViewport.camera.position.x,
    window.__archdiscViewport.camera.position.y,
    window.__archdiscViewport.camera.position.z,
  ]);
  expect(pos0[0]).toBeCloseTo(2, 3);
  await win.screenshot({ path: path.join(OUT, '03-start.png') });

  const n = await win.evaluate(() => window.__studioPresentationNext());
  expect(n.name).toBe('side');
  await win.screenshot({ path: path.join(OUT, '04-next.png') });

  const d = await win.evaluate(() => window.__studioPresentationDeleteSlide('top'));
  expect(d.remaining).toBe(2);
  await win.screenshot({ path: path.join(OUT, '05-delete.png') });

  const cl = await win.evaluate(() => window.__studioPresentationClear());
  expect(cl.ok).toBe(true);
  expect(cl.cleared).toBe(2);
  await win.screenshot({ path: path.join(OUT, '06-clear.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 657: 6 presentation features verified');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
