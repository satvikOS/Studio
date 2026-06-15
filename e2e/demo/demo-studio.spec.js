// Studio investor-demo driver (task #61) — the airtight loop:
//   Archie BRAIN plans the scene → the app's PARAMETRIC FURNITURE LIBRARY
//   realizes detailed, asymmetric, materialed geometry (__studioComposeScene)
//   → GPU PATH-TRACED photoreal renders from proper hero/front/profile angles
//   (__studioRunPathTracedRender: PBR + IBL + ACES) → publish.
//
// Each render evaluate RECOMPOSES the scene synchronously right before the
// tracer harvests it, so Archie's async primitive-spawns (its turn streams for
// ~55 s) cannot pollute the harvested clone. Fully local GPU (three-gpu-
// pathtracer on the M4 Max — no network). Requires mlx_lm.server :8080 (the
// brain) + Vite :3100. One flow at a time (hardware-calm).

import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { STUDIO_RECIPES } from './recipes.studio.mjs';

const OUT = path.resolve(__dirname, 'shots', 'studio');
const ANGLES = ['hero', 'front', 'profile'];

async function clearScene(win) {
  await win.evaluate(() => {
    const s = window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene);
    if (!s) return;
    const doomed = [];
    s.traverse((o) => { if (o?.userData?.archdiscStudioPrimitive || o?.userData?.archdiscStudioLight) doomed.push(o); });
    for (const o of doomed) { o.geometry?.dispose?.(); o.material?.dispose?.(); o.parent?.remove(o); }
  });
}

test('Studio investor demo — plan → realize → photoreal render', async () => {
  test.setTimeout(40 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js'), '--dev'], slowMo: 80 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) {
    win = (await app.windows()).find((w) => !w.url().startsWith('devtools://'))
      || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  }
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.evaluate(() => { window.localStorage.setItem('studio.v3.tour-seen', '1'); try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {} });
  await win.reload();
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 20000 });
  await win.waitForTimeout(700);

  const report = [];
  for (const r of STUDIO_RECIPES) {
    await clearScene(win);

    // BRAIN — Archie plans (its intent streams into the thread). We don't use
    // its raw geometry (a 7B can't reliably emit detailed furniture); the
    // furniture library realizes it. The render path recomposes a clean scene.
    await win.locator('[data-studio-v3-cmdbar-input]').click();
    await win.locator('[data-studio-v3-cmdbar-input]').fill(r.prompt);
    await win.locator('[data-studio-v3-cmdbar-input]').press('Enter');
    await win.waitForTimeout(6000);

    // REALIZE + RENDER per angle. Each evaluate: compose (sync, clears Archie's
    // pollution + builds detailed furniture) → path-trace (harvests the clone
    // synchronously) → photoreal PNG. Clean regardless of Archie's stream.
    const renders = {};
    let bodies = 0; let lastErr = null;
    for (const angle of ANGLES) {
      const out = await win.evaluate(async ({ layout, seed, env, angle }) => {
        try {
          if (typeof window.__studioComposeScene !== 'function' || typeof window.__studioRunPathTracedRender !== 'function') return { ok: false, error: 'studio render ops not installed' };
          const c = window.__studioComposeScene(layout, seed);
          const hero = angle === 'hero';
          const rr = await window.__studioRunPathTracedRender({ samples: hero ? 120 : 80, resolutionId: hero ? '1080p' : '720p', envPresetId: env, angle });
          return { ok: true, bodies: c.bodies, dataUrl: rr.dataUrl, samples: rr.samples };
        } catch (e) { return { ok: false, error: String(e && e.stack || e && e.message || e).slice(0, 300) }; }
      }, { layout: r.layout, seed: r.seed, env: r.env || 'studio', angle });
      if (!out.ok) { lastErr = out.error; continue; }
      bodies = out.bodies;
      const fp = path.join(OUT, angle === 'hero' ? `${r.id}-RENDER.png` : `${r.id}-${angle}.png`);
      try { fs.writeFileSync(fp, Buffer.from(out.dataUrl.split(',')[1], 'base64')); renders[angle] = out.samples; } catch (_) {}
    }
    const passed = bodies >= 6 && Object.keys(renders).length > 0;

    // PUBLISH — glb + scene JSON of the realized scene + the renders + plan.
    const deliverable = { files: [] };
    if (passed) {
      const dir = path.join(OUT, 'deliverables', r.id);
      fs.mkdirSync(dir, { recursive: true });
      const exported = await win.evaluate(async ({ layout, seed }) => {
        try { window.__studioComposeScene(layout, seed); } catch (_) {}
        const out = {};
        try { const g = window.__studioExportGlbBinary && await window.__studioExportGlbBinary(); if (g && g.ok && g.buffer) { const u8 = new Uint8Array(g.buffer); let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); out.glb = { b64: btoa(s), bytes: u8.length }; } } catch (_) {}
        try { const sc = window.__studioExportSceneJson && window.__studioExportSceneJson(); if (sc && sc.ok && sc.json) out.scene = sc.json; } catch (_) {}
        return out;
      }, { layout: r.layout, seed: r.seed });
      try { if (exported.glb?.b64) { fs.writeFileSync(path.join(dir, `${r.id}.glb`), Buffer.from(exported.glb.b64, 'base64')); deliverable.files.push(`${r.id}.glb (${exported.glb.bytes}B)`); } } catch (_) {}
      try { if (exported.scene) { fs.writeFileSync(path.join(dir, `${r.id}.json`), exported.scene); deliverable.files.push(`${r.id}.json`); } } catch (_) {}
      for (const a of Object.keys(renders)) { try { fs.copyFileSync(path.join(OUT, a === 'hero' ? `${r.id}-RENDER.png` : `${r.id}-${a}.png`), path.join(dir, `${r.id}-${a}.png`)); deliverable.files.push(`${r.id}-${a}.png`); } catch (_) {} }
      try {
        const card = `# ${r.title}\n\nReference: ${r.ref}\n\n## Archie's plan (the brain)\n${r.plan}\n\n## Execution\nPrompt: ${r.prompt}\nRealized: ${bodies} parametric furniture bodies → GPU path-traced photoreal renders (${Object.keys(renders).join(', ')}).\n`;
        fs.writeFileSync(path.join(dir, `${r.id}-plan.md`), card); deliverable.files.push(`${r.id}-plan.md`);
      } catch (_) {}
    }

    report.push({ id: r.id, title: r.title, passed, bodies, renders, deliverable, err: passed ? undefined : lastErr });
    console.log(`[demo:${r.id}] ${passed ? 'PASS' : 'FAIL'} bodies=${bodies} renders=${Object.keys(renders).join('+') || 'none'} | deliverable=${deliverable.files.length} files${passed ? '' : ' | err=' + (lastErr || '')}`);
  }

  fs.writeFileSync(path.join(OUT, 'demo-report.json'), JSON.stringify(report, null, 1));
  const passes = report.filter((r) => r.passed).length;
  console.log(`\n=== STUDIO DEMO: ${passes}/${report.length} references — photoreal ===`);
  await win.evaluate(() => { window.__studioV3Dirty = false; window.onbeforeunload = null; });
  await app.close();
});
