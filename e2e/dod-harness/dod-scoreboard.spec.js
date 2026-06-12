import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// §7 Definition-of-Done harness (bible task #53) — the ten canonical
// prompts, run headed against the LIVE stack, scored against
// per-prompt minimum bars. This spec is a MEASUREMENT instrument: it
// always passes structurally and writes a scoreboard; the mission is
// done when the scoreboard reads 10/10 in one working day. Honest
// bars only — no fallback credit.
//
// Scoreboard: e2e/dod-harness/scoreboard-YYYY-MM-DD.json + console.

const OUT_DIR = path.resolve(__dirname);
const SHOTS = path.join(OUT_DIR, 'shots');

// Per-prompt bars. `kind`:
//   studio-scene  → scene-graph stats gates (prims/lights/mats/camera)
//   meta          → thread-text gates
const DOD = [
  { id: 1, prompt: 'build me a hero shot of a Scandinavian living room in golden-hour light',
    kind: 'studio-scene', bars: { prims: 5, offOrigin: 4, physMats: 3, lights: 1, camMoved: true } },
  { id: 2, prompt: 'model an M8 hex bolt and run a Linear Static under 5 kN',
    kind: 'forge', note: 'runs in Forge — scored manually until the cross-app harness lands', skip: true },
  { id: 3, prompt: 'forest scene, 50 trees, dawn, with a wolf in the foreground silhouetted',
    kind: 'studio-scene', bars: { prims: 20, offOrigin: 15, physMats: 5, lights: 1, camMoved: true } },
  { id: 4, prompt: 'give me a chair that fits a 1.2 m³ volume and supports 120 kg, render-ready',
    kind: 'studio-scene', bars: { prims: 4, offOrigin: 3, physMats: 2, lights: 1, camMoved: true } },
  { id: 5, prompt: 'design a cassette deck — VU meters, transport buttons, hairline brushed-aluminium faceplate',
    kind: 'studio-scene', bars: { prims: 6, offOrigin: 4, physMats: 3, lights: 1, camMoved: true } },
  { id: 6, prompt: 'now make the same cassette deck in the visual language of a fishing boat',
    kind: 'studio-scene', bars: { prims: 6, offOrigin: 4, physMats: 3, lights: 1, camMoved: true } },
  { id: 7, prompt: "I'm doing arch-viz of a kitchen. Build it. Surprise me on the cabinet hardware.",
    kind: 'studio-scene', bars: { prims: 6, offOrigin: 5, physMats: 3, lights: 1, camMoved: true } },
  { id: 8, prompt: 'this character mesh has 28k tris, I need it under 8k for mobile — retopo it',
    kind: 'meta', mustMention: ['decimate'], note: 'needs a seeded dense mesh; scored on decimate dispatch' },
  { id: 9, prompt: 'load my last scene, do whatever you think it needs to be portfolio-ready, render',
    kind: 'studio-scene', bars: { prims: 1, physMats: 1, lights: 1, camMoved: true } },
  { id: 10, prompt: 'self-critique your last 3 outputs and propose 5 improvements to your own training corpus',
    kind: 'meta', mustMention: [], minReplyChars: 200 },
];

async function sceneStats(win) {
  return win.evaluate(() => {
    const vp = window.__archdiscViewport;
    const s = window.__archdiscScene || (vp && vp.scene);
    const out = { prims: 0, lights: 0, physMats: 0, offOrigin: 0, cam: null };
    if (!s) return out;
    s.traverse((o) => {
      if (o?.userData?.archdiscStudioPrimitive) {
        out.prims++;
        if (o.position && (Math.abs(o.position.x) > 1e-3 || Math.abs(o.position.y) > 1e-3 || Math.abs(o.position.z) > 1e-3)) out.offOrigin++;
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (m && m.isMeshPhysicalMaterial) out.physMats++;
      }
      if (o?.isLight) out.lights++;
    });
    if (vp?.camera) out.cam = vp.camera.position.toArray().map((v) => +v.toFixed(3));
    return out;
  });
}

async function clearScene(win) {
  await win.evaluate(() => {
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    if (!s) return;
    const doomed = [];
    s.traverse((o) => { if (o?.userData?.archdiscStudioPrimitive) doomed.push(o); });
    for (const o of doomed) { o.geometry?.dispose?.(); o.material?.dispose?.(); o.parent?.remove(o); }
  });
}

test('DoD scoreboard — ten canonical prompts, honest bars', async () => {
  test.setTimeout(1800000); // 30 min for the full battery
  fs.mkdirSync(SHOTS, { recursive: true });
  const app = await electron.launch({
    args: [path.join(__dirname, '..', '..', 'electron', 'main.js'), '--dev'],
    slowMo: 100,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => {
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(700);

  const board = [];
  for (const item of DOD) {
    if (item.skip) { board.push({ id: item.id, pass: null, note: item.note }); continue; }
    await clearScene(win);
    const before = await sceneStats(win);
    await win.locator('[data-studio-v3-cmdbar-input]').click();
    await win.locator('[data-studio-v3-cmdbar-input]').fill(item.prompt);
    await win.locator('[data-studio-v3-cmdbar-input]').press('Enter');

    const deadline = Date.now() + 160000;
    let after = before;
    while (Date.now() < deadline) {
      after = await sceneStats(win);
      const camMoved = JSON.stringify(after.cam) !== JSON.stringify(before.cam);
      if (item.kind === 'studio-scene' && after.prims >= (item.bars.prims || 1)
          && (!item.bars.camMoved || camMoved)) break;
      if (item.kind === 'meta') {
        const last = await win.evaluate(() => {
          const els = document.querySelectorAll('[data-studio-v3-archie-msg][data-role="archie"]');
          const el = els[els.length - 1];
          return el ? (el.textContent || '') : '';
        });
        if (last && !last.includes('thinking') && last.length > 50) break;
      }
      await win.waitForTimeout(2000);
    }
    await win.screenshot({ path: path.join(SHOTS, `dod-${String(item.id).padStart(2, '0')}.png`) });

    let pass = false; const detail = {};
    if (item.kind === 'studio-scene') {
      const camMoved = JSON.stringify(after.cam) !== JSON.stringify(before.cam);
      detail.stats = after;
      pass = after.prims >= (item.bars.prims || 0)
        && (after.offOrigin || 0) >= (item.bars.offOrigin || 0)
        && (after.physMats || 0) >= (item.bars.physMats || 0)
        && (after.lights - before.lights) >= (item.bars.lights || 0)
        && (!item.bars.camMoved || camMoved);
    } else {
      const reply = await win.evaluate(() => {
        const els = document.querySelectorAll('[data-studio-v3-archie-msg][data-role="archie"]');
        const el = els[els.length - 1];
        return el ? (el.textContent || '') : '';
      });
      detail.replyChars = reply.length;
      pass = reply.length >= (item.minReplyChars || 50)
        && (item.mustMention || []).every((w) => reply.toLowerCase().includes(w));
    }
    board.push({ id: item.id, prompt: item.prompt.slice(0, 60), pass, ...detail });
    console.log(`[dod ${item.id}] ${pass ? 'PASS' : 'fail'} — ${item.prompt.slice(0, 60)}`);
  }

  const scored = board.filter((b) => b.pass !== null);
  const passed = scored.filter((b) => b.pass).length;
  const stamp = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(OUT_DIR, `scoreboard-${stamp}.json`),
    JSON.stringify({ date: stamp, passed, of: scored.length, board }, null, 2));
  console.log(`\n=== DoD scoreboard: ${passed}/${scored.length} (target: all, one working day) ===`);

  // Structural pass — the harness measures; the mission gates on 10/10.
  expect(board.length).toBe(DOD.length);

  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
});
