// ArchDisc Studio V3 — Plasticity solid history operations (slice 776).
//
// Headed Mac-Electron spec. Verifies the five history-preserving solid
// construction ops installed by `v3/plasthist/`.
//
// Flow:
//   • boot the V3 shell
//   • ensure the plasthist autoload has installed __studioPlast*
//   • __studioPlastRevolve({profile:<square>, axis:[0,1,0], angle:2π})
//       → cylindrical-shell mesh in scene
//   • __studioPlastSweep({profile:<circle>, path:<sine>}) → tube in scene
//   • __studioPlastList() → 2 entries
//   • 5 named camera angles get captured for remote-desktop watchers.
//
// e2e DOES NOT run during this slice (per the brief); this file just
// has to compile when written.

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'studio-plasthist');
const NAMED_VIEWS = ['front', 'top', 'right', 'iso', 'close'];

test('Studio V3 — Plasticity solid history ops (slice 776)', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 140,
  });
  let win = null;
  for (let i = 0; i < 30 && !win; i++) {
    win = app.windows().find((w) => {
      const u = (() => { try { return w.url(); } catch (_) { return ''; } })();
      return u && !u.startsWith('devtools://');
    }) || null;
    if (!win) { await new Promise((r) => setTimeout(r, 500)); }
  }
  if (!win) win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studioV3', '1');
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.removeItem('studio.v3.theme');
    window.localStorage.removeItem('studio.v3.wb');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  let shellUp = false;
  for (let attempt = 0; attempt < 4 && !shellUp; attempt++) {
    await win.reload();
    await win.waitForLoadState('domcontentloaded');
    await win.waitForTimeout(1500);
    try {
      await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 40000 });
      shellUp = true;
    } catch (_) { /* retry */ }
  }
  expect(shellUp).toBe(true);
  await win.waitForFunction(() => !!window.__archdiscScene && !!window.THREE, null, { timeout: 30000 });

  // ── Ensure the plasthist autoload has run. ───────────────────────
  await win.evaluate(async () => {
    if (typeof window.__studioPlastRevolve !== 'function') {
      await import('/src/workbenches/studio/v3/plasthist/autoload.js');
    }
  });
  await win.waitForFunction(
    () => typeof window.__studioPlastRevolve === 'function'
       && typeof window.__studioPlastSweep === 'function'
       && typeof window.__studioPlastLoft === 'function'
       && typeof window.__studioPlastShell === 'function'
       && typeof window.__studioPlastChamfer === 'function'
       && typeof window.__studioPlastList === 'function',
    null, { timeout: 20000 }
  );
  await win.screenshot({ path: path.join(OUT, '00-shell.png') });

  // ── 1) Revolve a square profile around Y → a cylindrical-ish shell. ──
  const rev = await win.evaluate(() => {
    // Square cross-section offset from the axis so it actually revolves
    // (a vertex at x=0 would just spin in place).
    const profile = [
      [0.3, -0.5, 0],
      [0.6, -0.5, 0],
      [0.6,  0.5, 0],
      [0.3,  0.5, 0],
      [0.3, -0.5, 0],
    ];
    return window.__studioPlastRevolve({ profile, axis: [0, 1, 0], angle: Math.PI * 2 });
  });
  expect(rev.ok).toBe(true);
  expect(typeof rev.uuid).toBe('string');
  expect(rev.vertCount).toBeGreaterThan(0);

  const hasRev = await win.evaluate((uuid) => {
    const s = window.__archdiscScene;
    if (!s) return false;
    let found = null;
    s.traverse((o) => { if (o.uuid === uuid) found = o; });
    return !!(found && found.isMesh);
  }, rev.uuid);
  expect(hasRev).toBe(true);
  await win.waitForTimeout(180);
  await win.screenshot({ path: path.join(OUT, '01-revolve.png') });

  // ── 2) Sweep a circle profile along a sine path → tube. ──────────
  const swp = await win.evaluate(() => {
    // 12-pt circle XY profile, radius 0.05.
    const circle = [];
    for (let i = 0; i <= 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      circle.push([Math.cos(a) * 0.05, Math.sin(a) * 0.05, 0]);
    }
    // 24-sample sine path along +X.
    const path = [];
    for (let i = 0; i <= 24; i++) {
      const t = (i / 24) * 2.0;
      path.push([t - 1.0, Math.sin(t * Math.PI * 2) * 0.3, 0]);
    }
    return window.__studioPlastSweep({ profile: circle, path });
  });
  expect(swp.ok).toBe(true);
  expect(typeof swp.uuid).toBe('string');
  expect(swp.vertCount).toBeGreaterThan(0);

  const hasSwp = await win.evaluate((uuid) => {
    const s = window.__archdiscScene;
    if (!s) return false;
    let found = null;
    s.traverse((o) => { if (o.uuid === uuid) found = o; });
    return !!(found && found.isMesh);
  }, swp.uuid);
  expect(hasSwp).toBe(true);
  await win.waitForTimeout(180);
  await win.screenshot({ path: path.join(OUT, '02-sweep.png') });

  // ── 3) List sees both creations. ──────────────────────────────────
  const list = await win.evaluate(() => window.__studioPlastList());
  expect(list.ok).toBe(true);
  expect(list.count).toBeGreaterThanOrEqual(2);
  expect(list.entries.find((e) => e.kind === 'revolve')).toBeTruthy();
  expect(list.entries.find((e) => e.kind === 'sweep')).toBeTruthy();

  // ── 4) Shell the revolved mesh inward → another mesh enters scene. ──
  const shell = await win.evaluate((uuid) => window.__studioPlastShell({
    meshUuid: uuid, thickness: 0.03,
  }), rev.uuid);
  expect(shell.ok).toBe(true);
  expect(typeof shell.uuid).toBe('string');

  // ── 5) Chamfer the swept mesh → another mesh enters scene. ───────
  const cham = await win.evaluate((uuid) => window.__studioPlastChamfer({
    meshUuid: uuid, distance: 0.005,
  }), swp.uuid);
  expect(cham.ok).toBe(true);
  expect(typeof cham.uuid).toBe('string');

  // ── 6) 5-cam sweep. ──────────────────────────────────────────────
  for (const view of NAMED_VIEWS) {
    await win.evaluate((v) => {
      if (typeof window.__studioSetView === 'function') window.__studioSetView(v);
      else if (typeof window.__archdiscSetView === 'function') window.__archdiscSetView(v);
    }, view);
    await win.waitForTimeout(220);
    await win.screenshot({ path: path.join(OUT, `cam-${view}.png`) });
  }

  // eslint-disable-next-line no-console
  console.log('  slice 776: revolve uuid', rev.uuid,
    'sweep uuid', swp.uuid, 'shell uuid', shell.uuid,
    'chamfer uuid', cham.uuid, 'list count', list.count);

  await app.close();
});
