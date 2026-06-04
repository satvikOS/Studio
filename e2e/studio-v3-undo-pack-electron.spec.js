import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-undo-pack');

test('Studio V3 — undo: clear/checkpoint/list/restore/state/limit (slice 647)', async () => {
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

  // 1: clear undo (fresh baseline)
  const cl = await win.evaluate(() => window.__studioClearUndo());
  expect(cl.ok).toBe(true);
  await win.screenshot({ path: path.join(OUT, '01-clear.png') });

  // Add a cube → push something onto undo
  await win.locator('[data-studio-v3-tool="cube"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);

  // 2: checkpoint A
  const a = await win.evaluate(() => window.__studioCheckpoint('beforeSphere'));
  expect(a.ok).toBe(true);
  expect(a.name).toBe('beforeSphere');
  await win.screenshot({ path: path.join(OUT, '02-cpA.png') });

  // add a sphere then checkpoint B
  await win.locator('[data-studio-v3-tool="sphere"][data-studio-v3-tool-group="add"]').click();
  await win.waitForTimeout(200);
  const b = await win.evaluate(() => window.__studioCheckpoint('afterSphere'));
  expect(b.total).toBe(2);

  // 3: list checkpoints
  const list = await win.evaluate(() => window.__studioListCheckpoints());
  expect(list.names).toEqual(['beforeSphere', 'afterSphere']);
  await win.screenshot({ path: path.join(OUT, '03-list.png') });

  // 4: restore A → should reduce mesh count back
  const beforeCount = await win.evaluate(() => {
    let n = 0; window.__archdiscScene.traverse((o) => { if (o.isMesh && o.userData?.archdiscStudioPrimitiveKind) n++; });
    return n;
  });
  const r = await win.evaluate(() => window.__studioRestoreCheckpoint('beforeSphere'));
  expect(r.ok).toBe(true);
  const afterCount = await win.evaluate(() => {
    let n = 0; window.__archdiscScene.traverse((o) => { if (o.isMesh && o.userData?.archdiscStudioPrimitiveKind) n++; });
    return n;
  });
  expect(afterCount).toBeLessThan(beforeCount);
  await win.screenshot({ path: path.join(OUT, '04-restore.png') });

  // 5: state
  const st = await win.evaluate(() => window.__studioGetUndoState());
  expect(st.ok).toBe(true);
  expect(st.checkpoints).toBeGreaterThanOrEqual(2);
  expect(typeof st.past).toBe('number');
  await win.screenshot({ path: path.join(OUT, '05-state.png') });

  // 6: limit
  const lim = await win.evaluate(() => window.__studioSetUndoLimit(16));
  expect(lim.ok).toBe(true);
  expect(lim.limit).toBe(16);
  await win.screenshot({ path: path.join(OUT, '06-limit.png') });

  // eslint-disable-next-line no-console
  console.log('  slice 647: 6 undo features — restored to', afterCount, 'meshes (was', beforeCount, ')');

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
    window.dispatchEvent(new CustomEvent('studio-autosaved', { detail: { ts: Date.now(), bytes: 0, primitives: 0 } }));
  });
  await win.waitForTimeout(100);
  await app.close();
});
