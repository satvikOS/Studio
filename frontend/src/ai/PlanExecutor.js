/**
 * ArchDisc Studio — AI Plan Executor.
 *
 * Universal dispatcher for plans built against ToolRegistry. Every
 * registry entry carries an exec hint that tells this executor how to
 * fire it: click a ribbon-action data-attr, click a primitive button,
 * type into a property knob, set selection-edit fields, switch the
 * discipline tab, or call a window.__studio* entry-point fn.
 *
 * Plans come from ANY source: hand-coded JSON, an LLM (Anthropic /
 * OpenAI / local SLM via PlannerProviders), Archie's data-driven
 * recipe (see runStudioRecipe), or a recorded demo.
 *
 * Two execution surfaces:
 *   - executePlan(page, plan)  — Playwright-driven for e2e
 *   - executePlanInApp(plan)   — in-app dispatch via document.querySelector
 *
 * The in-app surface lets WorkbenchStudio's runAiPrompt and Archie's
 * loop reuse the same dispatcher the e2e specs exercise. No two code
 * paths to maintain.
 */

import { findTool } from './ToolRegistry.js';

// ─── PLAYWRIGHT-DRIVEN EXECUTION (for e2e) ───────────────────────────
/**
 * Execute a step-array plan against an open Studio page.
 *
 * @param {object} page                  Playwright Page (or Electron window)
 * @param {Array}  plan                  array of {tool, comment?, params?}
 * @param {object} [options]
 * @param {number} [options.dwellMs]     pause after each step (visible playback)
 * @param {number} [options.stepTimeoutMs] per-step settle window
 * @param {function} [options.onStep]    async callback(step, index)
 * @returns {{ok, steps, errors}}
 */
export async function executePlan(page, plan, options = {}) {
  const dwellMs = options.dwellMs ?? 0;
  const stepTimeoutMs = options.stepTimeoutMs ?? 30000;
  const onStep = options.onStep ?? (async () => {});
  const errors = [];
  const stepResults = [];

  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    const meta = findTool(step.tool);
    if (!meta) {
      errors.push({ stepIndex: i, error: `Unknown tool: ${step.tool}` });
      break;
    }
    try {
      await dispatchPlaywright(page, meta, step.params || {}, stepTimeoutMs);
      stepResults.push({ stepIndex: i, tool: step.tool, ok: true });
      await onStep(step, i);
      if (dwellMs > 0) await page.waitForTimeout(dwellMs);
    } catch (err) {
      errors.push({ stepIndex: i, tool: step.tool, error: String(err && err.message || err) });
      break;
    }
  }
  return { ok: errors.length === 0, steps: stepResults, errors };
}

async function dispatchPlaywright(page, meta, params, timeoutMs) {
  const ex = meta.exec;
  switch (ex.type) {
    case 'click-action':
      await page.locator(`[data-studio-ribbon-action="${ex.id}"]`).first()
                .click({ timeout: timeoutMs });
      return;
    case 'click-primitive':
      await page.locator(`[data-studio-primitive="${ex.id}"]`).first()
                .click({ timeout: timeoutMs });
      return;
    case 'click-discipline':
      await page.locator(`[data-studio-discipline="${ex.id}"]`).first()
                .scrollIntoViewIfNeeded({ timeout: timeoutMs }).catch(() => {});
      await page.locator(`[data-studio-discipline="${ex.id}"]`).first()
                .click({ timeout: timeoutMs });
      return;
    case 'set-param': {
      const value = params.value;
      const sel = `[data-studio-${ex.group}="${ex.knob}"]`;
      await page.locator(sel).first().fill(String(value ?? ''), { timeout: timeoutMs });
      return;
    }
    case 'set-selection': {
      const value = params.value;
      const sel = `[data-studio-selection-edit="${ex.axis}"]`;
      await page.locator(sel).first().fill(String(value ?? ''), { timeout: timeoutMs });
      return;
    }
    case 'fn': {
      const args = Array.isArray(params.args) ? params.args : [];
      await page.evaluate(({ name, args }) => {
        const fn = window[name];
        if (typeof fn !== 'function') throw new Error(`${name} not available`);
        return fn.apply(null, args);
      }, { name: ex.name, args });
      return;
    }
    default:
      throw new Error(`Unhandled exec type: ${ex.type}`);
  }
}

// ─── IN-APP EXECUTION (for runAiPrompt and Archie's loop) ─────────────
/**
 * Execute a step-array plan inside the running app via
 * document.querySelector. Used by the in-app AI prompt panel and by
 * Archie's per-body op dispatch.
 *
 * @param {Array} plan  array of {tool, params?}
 * @param {object} [options]
 * @param {number} [options.dwellMs]
 * @returns {{ok, steps, errors}}
 */
export async function executePlanInApp(plan, options = {}) {
  const dwellMs = options.dwellMs ?? 0;
  const errors = [];
  const stepResults = [];
  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    const meta = findTool(step.tool);
    if (!meta) {
      errors.push({ stepIndex: i, error: `Unknown tool: ${step.tool}` });
      break;
    }
    try {
      dispatchInApp(meta, step.params || {});
      stepResults.push({ stepIndex: i, tool: step.tool, ok: true });
      if (dwellMs > 0) await new Promise((r) => setTimeout(r, dwellMs));
    } catch (err) {
      errors.push({ stepIndex: i, tool: step.tool,
        error: String(err && err.message || err) });
      break;
    }
  }
  return { ok: errors.length === 0, steps: stepResults, errors };
}

/** Dispatch a single registry entry in-app. Exported so callers
 *  (Archie's executor, WorkbenchStudio's runAiPrompt) can fire a
 *  one-off without building a full plan. */
export function dispatchInApp(meta, params = {}) {
  const ex = meta.exec;
  switch (ex.type) {
    case 'click-action':       return clickByAttr(`data-studio-ribbon-action`, ex.id);
    case 'click-primitive':    return clickByAttr(`data-studio-primitive`, ex.id);
    case 'click-discipline':   return clickByAttr(`data-studio-discipline`, ex.id);
    case 'set-param':          return setInputValue(
      `[data-studio-${ex.group}="${ex.knob}"]`, params.value);
    case 'set-selection':      return setInputValue(
      `[data-studio-selection-edit="${ex.axis}"]`, params.value);
    case 'fn': {
      const fn = typeof window !== 'undefined' ? window[ex.name] : null;
      if (typeof fn !== 'function') throw new Error(`${ex.name} not available`);
      const args = Array.isArray(params.args) ? params.args : [];
      return fn.apply(null, args);
    }
    default:
      throw new Error(`Unhandled exec type: ${ex.type}`);
  }
}

function clickByAttr(attr, value) {
  if (typeof document === 'undefined') return false;
  const el = document.querySelector(`[${attr}="${value}"]`);
  if (!el) throw new Error(`No element matches [${attr}="${value}"]`);
  el.click();
  return true;
}

function setInputValue(selector, value) {
  if (typeof document === 'undefined') return false;
  const el = document.querySelector(selector);
  if (!el) throw new Error(`No element matches ${selector}`);
  // React-controlled inputs need the native setter so React's onChange fires.
  const proto = el instanceof HTMLSelectElement
    ? window.HTMLSelectElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(el, value == null ? '' : String(value));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

// ─── PLAN VALIDATION ──────────────────────────────────────────────────
/** Validate a step-array plan against the registry. Returns {ok, errors}. */
export function validatePlan(plan) {
  const errors = [];
  if (!Array.isArray(plan)) {
    errors.push('Plan must be an array');
    return { ok: false, errors };
  }
  for (let i = 0; i < plan.length; i++) {
    const step = plan[i];
    if (typeof step !== 'object' || !step.tool) {
      errors.push(`Step ${i}: missing 'tool'`);
      continue;
    }
    if (!findTool(step.tool)) {
      errors.push(`Step ${i}: unknown tool '${step.tool}'`);
    }
  }
  return { ok: errors.length === 0, errors };
}
