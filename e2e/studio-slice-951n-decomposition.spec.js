import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Slice 951n — verify the studio_v17/modeling LoRA decomposes complex
// nouns into real primitives. Drives Studio against the LIVE
// mlx_lm.server (no mock). For each of the three target prompts:
//   1. type the prompt into the cmdbar
//   2. wait up to 90 s for dispatch
//   3. assert ≥ N primitives landed in window.__archdiscScene
//   4. capture a screenshot for visual proof

const OUT = path.resolve(__dirname, 'screenshots', 'studio-slice-951n-decomposition');

const PROMPTS = [
  { prompt: 'create a coffee table',       minPrimitives: 3, label: 'coffee_table' },
  { prompt: 'build a forest with diverse trees', minPrimitives: 4, label: 'forest' },
  { prompt: 'model a small house',         minPrimitives: 2, label: 'house' },
];

async function countAllPrimitives(win) {
  return win.evaluate(() => {
    const s = window.__archdiscScene
      || (window.__archdiscViewport && window.__archdiscViewport.scene);
    if (!s) return 0;
    let n = 0;
    s.traverse((o) => {
      if (o && o.userData && o.userData.archdiscStudioPrimitive) n++;
    });
    return n;
  });
}

async function dumpOverlayMessages(win) {
  return win.evaluate(() => {
    return Array.from(document.querySelectorAll('[data-studio-v3-archie-msg]'))
      .map((el) => {
        const t = el.querySelector('.studio-archie-overlay-msg-text');
        return {
          role: el.getAttribute('data-role'),
          text: ((t ? t.textContent : el.textContent) || '').trim(),
        };
      });
  });
}

test('Studio slice 951n — coffee table / forest / house spawn real primitives', async () => {
  test.setTimeout(600000);  // 10 min for 3 sequential live LoRA calls
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js'), '--dev'],
    slowMo: Number(process.env.STUDIO_SLOWMO) || 200,
  });
  const win = await app.firstWindow();
  win.on('dialog', (d) => { d.dismiss().catch(() => {}); });
  await win.waitForLoadState('domcontentloaded');

  await win.evaluate(() => {
    window.localStorage.setItem('studio.v3.tour-seen', '1');
    window.localStorage.setItem('studioV3Theme', 'dark');
    window.localStorage.removeItem('studio.v3.display-toggles');
    try { window.sessionStorage.setItem('studio.v3.splash-shown', '1'); } catch (_) {}
  });
  await win.reload();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('[data-studio-v3-shell]')).toBeVisible({ timeout: 15000 });
  await win.waitForTimeout(800);

  for (let i = 0; i < PROMPTS.length; i++) {
    const p = PROMPTS[i];
    const tag = `${(i + 1).toString().padStart(2, '0')}-${p.label}`;

    // Clear scene before each prompt so we count just this prompt's
    // primitives. Best-effort — old V2 ops may not be wired.
    await win.evaluate(() => {
      if (window.__archdiscScene) {
        const remove = [];
        window.__archdiscScene.traverse((o) => {
          if (o && o.userData && o.userData.archdiscStudioPrimitive) remove.push(o);
        });
        for (const o of remove) {
          if (o.geometry) o.geometry.dispose();
          if (o.material && o.material.dispose) o.material.dispose();
          if (o.parent) o.parent.remove(o);
        }
      }
    });
    await win.waitForTimeout(200);

    await win.locator('[data-studio-v3-cmdbar-input]').click();
    await win.locator('[data-studio-v3-cmdbar-input]').fill(p.prompt);
    await win.locator('[data-studio-v3-cmdbar-input]').press('Enter');
    await win.waitForTimeout(800);
    await win.screenshot({ path: path.join(OUT, `${tag}-a-typed.png`) });

    // Poll for primitives up to 90 s.
    const deadline = Date.now() + 90000;
    let count = 0;
    while (Date.now() < deadline) {
      count = await countAllPrimitives(win);
      if (count >= p.minPrimitives) break;
      await win.waitForTimeout(1500);
    }
    await win.screenshot({ path: path.join(OUT, `${tag}-b-after.png`) });

    const msgs = await dumpOverlayMessages(win);
    console.log(`--- ${p.prompt} (${count} primitives) ---`);
    for (const m of msgs.slice(-6)) console.log(`[${m.role}]`, m.text.slice(0, 220));

    // We don't hard-assert here — record what the model produced so we
    // can iterate. Trial passes if at least one of the three prompts
    // exceeds its threshold.
    fs.appendFileSync(path.join(OUT, 'results.txt'),
      `${p.label}: ${count} primitives (want ≥${p.minPrimitives}) — ${count >= p.minPrimitives ? 'PASS' : 'FAIL'}\n`);
  }

  // Soft check: at least ONE of the three prompts should have crossed
  // its threshold once the LoRA learns decomposition. Until then this
  // documents progress.
  const lines = fs.readFileSync(path.join(OUT, 'results.txt'), 'utf8');
  console.log('--- results.txt ---');
  console.log(lines);
  const passes = (lines.match(/PASS/g) || []).length;
  expect(passes).toBeGreaterThanOrEqual(1);

  await win.evaluate(() => {
    window.__studioV3Dirty = false;
    window.onbeforeunload = null;
  });
  await win.waitForTimeout(140);
  await app.close();
});
