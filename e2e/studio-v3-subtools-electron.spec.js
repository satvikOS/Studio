// ArchDisc Studio V3 — ZBrush Subtools / subtool hierarchy e2e (slice 732).
//
// Headed Mac-Electron spec. ZBrush composes one Tool from independent
// SubTools (body, eyes, teeth, armour…), each its own mesh with its own
// visibility + sculpt state. The artist works one ACTIVE subtool, can
// SOLO it, APPEND / DUPLICATE / DELETE / reorder, and MERGE-DOWN /
// merge-visible into a single mesh.
//
// Exercises the __studioSubtool* op surface (sculpt/subtools.js):
//   • append 3 subtools → list reflects them, last is active
//   • set active by index + rename
//   • visibility toggle + solo (hide the rest) + clear solo
//   • duplicate → +1 subtool
//   • merge-down → two subtools collapse into one mesh, count drops
//   • merge-visible → all visible subtools become a single mesh
//   • reorder up/down
//   • global search surfaces the subtool ops
//   • camera sweep for remote-desktop verification

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-v3-subtools');
const NAMED_VIEWS = ['front', 'iso', 'right', 'top', 'close'];

test('Studio V3 — ZBrush Subtools / subtool hierarchy', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 140,
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
  // Boot the V3 shell, retrying the reload if the dev server served the
  // page before the app finished wiring (cold-start race). Up to 3 tries.
  let shellUp = false;
  for (let attempt = 0; attempt < 3 && !shellUp; attempt++) {
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    try {
      await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 25000 });
      shellUp = true;
    } catch (_) { /* retry */ }
  }
  expect(shellUp).toBe(true);
  await win.waitForFunction(() => !!window.__archdiscScene && !!window.THREE, null, { timeout: 30000 });

  await win.evaluate(async () => {
    if (typeof window.__studioSubtoolAppend !== 'function') {
      await import('/src/workbenches/studio/v3/sculpt/autoload.js');
    }
  });
  await win.waitForFunction(() => typeof window.__studioSubtoolAppend === 'function',
    null, { timeout: 20000 });

  // Start from a clean scene so the subtool counts are deterministic.
  await win.evaluate(() => { if (window.__studioClearScene) window.__studioClearScene(); });
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) Append three subtools. ──────────────────────────────────────
  const a = await win.evaluate(() => window.__studioSubtoolAppend('sphere', 'Body'));
  expect(a.ok).toBe(true);
  const b = await win.evaluate(() => window.__studioSubtoolAppend('cube', 'Head'));
  expect(b.ok).toBe(true);
  const c = await win.evaluate(() => window.__studioSubtoolAppend('cylinder', 'Arm'));
  expect(c.ok).toBe(true);

  let list = await win.evaluate(() => window.__studioSubtoolList());
  expect(list.ok).toBe(true);
  expect(list.count).toBe(3);
  // Last appended is active.
  expect(list.subtools[list.active].name).toBe('Arm');
  const names = list.subtools.map((s) => s.name);
  expect(names).toEqual(['Body', 'Head', 'Arm']);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '01-three-subtools.png') });

  // ── 2) Set active by index + rename. ──────────────────────────────
  const setA = await win.evaluate(() => window.__studioSubtoolSetActive(0));
  expect(setA.ok).toBe(true);
  expect(setA.subtool.name).toBe('Body');
  const ren = await win.evaluate(() => window.__studioSubtoolRename(0, 'Torso'));
  expect(ren.ok).toBe(true);
  expect(ren.name).toBe('Torso');

  // ── 3) Visibility toggle + solo. ───────────────────────────────────
  const hide = await win.evaluate(() => window.__studioSubtoolSetVisible(1, false));
  expect(hide.ok).toBe(true);
  expect(hide.visible).toBe(false);
  // Re-show then solo subtool 2 (Arm): only it stays visible.
  await win.evaluate(() => window.__studioSubtoolSetVisible(1, true));
  const solo = await win.evaluate(() => window.__studioSubtoolSolo(2));
  expect(solo.ok).toBe(true);
  list = await win.evaluate(() => window.__studioSubtoolList());
  const visibleCount = list.subtools.filter((s) => s.visible).length;
  expect(visibleCount).toBe(1);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '02-solo.png') });
  // Clear solo → all visible again.
  await win.evaluate(() => window.__studioSubtoolSolo(null));
  list = await win.evaluate(() => window.__studioSubtoolList());
  expect(list.subtools.filter((s) => s.visible).length).toBe(3);

  // ── 4) Duplicate → +1 subtool. ─────────────────────────────────────
  const dup = await win.evaluate(() => window.__studioSubtoolDuplicate(0));
  expect(dup.ok).toBe(true);
  list = await win.evaluate(() => window.__studioSubtoolList());
  expect(list.count).toBe(4);

  // ── 5) Reorder the active subtool. ─────────────────────────────────
  const mv = await win.evaluate(() => window.__studioSubtoolMove(3, -1));
  expect(mv.ok).toBe(true);
  expect(mv.to).toBe(2);

  // ── 6) Merge-down: two subtools collapse into one mesh. ────────────
  const before = (await win.evaluate(() => window.__studioSubtoolList())).count;
  const md = await win.evaluate(() => window.__studioSubtoolMergeDown(1));
  expect(md.ok).toBe(true);
  expect(md.merged).toBe(2);
  expect(md.triangles).toBeGreaterThan(0);
  const afterMd = (await win.evaluate(() => window.__studioSubtoolList())).count;
  expect(afterMd).toBe(before - 1);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '03-merged-down.png') });

  // ── 7) Merge-visible: all visible subtools → one mesh. ─────────────
  const mv2 = await win.evaluate(() => window.__studioSubtoolMergeVisible());
  expect(mv2.ok).toBe(true);
  expect(mv2.triangles).toBeGreaterThan(0);
  const finalList = await win.evaluate(() => window.__studioSubtoolList());
  expect(finalList.count).toBe(1);
  await win.waitForTimeout(150);
  await win.screenshot({ path: path.join(OUT, '04-merged-visible.png') });

  // ── 8) Global search surfaces the subtool ops. ─────────────────────
  const search = await win.evaluate(() => window.__studioCommandSearch('subtool', 40));
  expect(search.ok).toBe(true);
  const sNames = search.hits.map((h) => h.name);
  expect(sNames).toContain('__studioSubtoolAppend');
  expect(sNames).toContain('__studioSubtoolMergeVisible');

  // ── 9) Camera sweep. ───────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 732: subtools appended=3 → after merges count=', finalList.count,
    'mergeVisible tris=', mv2.triangles);

  await app.close();
});
