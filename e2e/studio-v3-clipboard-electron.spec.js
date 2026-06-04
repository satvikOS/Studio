import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-clipboard');

test('Studio V3 — clipboard: copy/paste/clear/has/count/duplicate (slice 652)', async () => {
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

  // Reference mesh
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // 1: copy
  const c = await win.evaluate(() => window.__studioClipboardCopy());
  expect(c.ok).toBe(true);
  expect(c.depth).toBe(1);
  await win.screenshot({ path: path.join(OUT, '01-copy.png') });

  // 2: has content + count
  const has = await win.evaluate(() => window.__studioClipboardHasContent());
  expect(has.has).toBe(true);
  const cnt = await win.evaluate(() => window.__studioClipboardCount());
  expect(cnt.count).toBe(1);
  await win.screenshot({ path: path.join(OUT, '02-has.png') });

  // 3: paste
  const beforeMeshes = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.isMesh) n++; });
    return n;
  });
  const p = await win.evaluate(() => window.__studioClipboardPaste([1, 0, 0]));
  expect(p.ok).toBe(true);
  const afterMeshes = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.isMesh) n++; });
    return n;
  });
  expect(afterMeshes).toBe(beforeMeshes + 1);
  await win.screenshot({ path: path.join(OUT, '03-paste.png') });

  // 4: duplicate selected (one-shot copy + paste)
  const dup = await win.evaluate(() => window.__studioClipboardDuplicateSelected([0, 1, 0]));
  expect(dup.ok).toBe(true);
  const after2 = await win.evaluate(() => {
    let n = 0;
    window.__archdiscScene.traverse((o) => { if (o.isMesh) n++; });
    return n;
  });
  expect(after2).toBe(afterMeshes + 1);
  await win.screenshot({ path: path.join(OUT, '04-dup.png') });

  // 5: clear
  const cl = await win.evaluate(() => window.__studioClipboardClear());
  expect(cl.ok).toBe(true);
  expect(cl.cleared).toBeGreaterThan(0);
  const cnt2 = await win.evaluate(() => window.__studioClipboardCount());
  expect(cnt2.count).toBe(0);
  await win.screenshot({ path: path.join(OUT, '05-clear.png') });

  // 6: paste from empty returns ok=false
  const empty = await win.evaluate(() => window.__studioClipboardPaste());
  expect(empty.ok).toBe(false);
  await win.screenshot({ path: path.join(OUT, '06-empty.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 652: 6 clipboard features verified');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
