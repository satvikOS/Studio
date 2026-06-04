import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-annotation-pack');

test('Studio V3 — annotations: label/arrow/dimension/callout/list/clear (slice 637)', async () => {
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

  // 1: text label
  const lbl = await win.evaluate(() => window.__studioAddTextLabel([0, 1, 0], 'Hello'));
  expect(lbl.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '01-label.png') });

  // 2: arrow
  const arr = await win.evaluate(() => window.__studioAddArrow([0, 0, 0], [2, 1, 0], 0xff8800));
  expect(arr.ok).toBe(true);
  expect(arr.length).toBeCloseTo(Math.sqrt(5), 4);
  await win.screenshot({ path: path.join(OUT, '02-arrow.png') });

  // 3: dimension
  const dim = await win.evaluate(() => window.__studioAddDimension([0, 0, 0], [3, 0, 4]));
  expect(dim.ok).toBe(true);
  expect(dim.distance).toBeCloseTo(5, 3);
  await win.screenshot({ path: path.join(OUT, '03-dim.png') });

  // 4: callout
  const co = await win.evaluate(() => window.__studioAddCallout([1, 0.5, 0], 'pin A'));
  expect(co.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '04-callout.png') });

  // 5: list
  const list = await win.evaluate(() => window.__studioListAnnotations());
  expect(list.count).toBeGreaterThanOrEqual(4);
  const kinds = list.annotations.map((a) => a.kind);
  expect(kinds).toContain('label');
  expect(kinds).toContain('arrow');
  expect(kinds).toContain('dimension');
  expect(kinds).toContain('callout');
  await win.screenshot({ path: path.join(OUT, '05-list.png') });

  // 6: clear
  const cl = await win.evaluate(() => window.__studioClearAnnotations());
  expect(cl.ok).toBe(true);
  expect(cl.cleared).toBeGreaterThanOrEqual(4);
  const empty = await win.evaluate(() => window.__studioListAnnotations());
  expect(empty.count).toBe(0);
  await win.screenshot({ path: path.join(OUT, '06-clear.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 637: 6 annotation features verified (dim =', dim.distance.toFixed(2), ')');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
