// frontend/src/ai/ArchieTraceSink.js — T6.1
//
// Persists ArchieLoop iterations to disk so a run can be replayed, folded
// into the per-discipline training corpus by `~/archdisc-Models/scripts/
// fold_traces.mjs`, or audited later. Matches the JSONL contract at
// ~/archdisc-Models/runtime/trace.md (one line per run; the line is the
// full trace object).
//
// Two writers (sniffed via `typeof window`):
//   1. Electron renderer — uses `window.studio.trace.write(...)` (preload
//      handles fs access; the renderer has no fs). The preload bridge is
//      a 4-line addition to electron/preload.js exposing `studio.trace`.
//   2. Node-side test/loader — uses `fs.promises.appendFile` directly.
//
// Output: <dir>/studio-trace-YYYY-MM-DD.jsonl (default dir is
// `~/.archdisc/studio-traces/`).
//
// Integration: the caller wraps runArchieLoop's `onEvent` to collect
// per-iteration data, then calls `flushTrace(trace)` once on
// `goal-done`. See README in ~/archdisc-Models/runtime/trace.md for the
// expected trace shape consumed by fold_traces.mjs.

const DAY = (iso) => (iso || new Date().toISOString()).slice(0, 10);

function defaultFilename(trace) {
  return `studio-trace-${DAY(trace?.ts || trace?.ts_iso)}.jsonl`;
}

/**
 * Serialize a trace into a single JSONL line + newline. Drops non-
 * serialisable fields (functions, three.js handles, mesh buffers) so the
 * line stays `JSON.parse`-able. Mesh blobs are summarised by vertex
 * count so a 100k-triangle response does not bloat the log to GB.
 */
export function serializeTrace(trace) {
  const summariseResp = (r) => {
    if (!r || typeof r !== 'object') return r;
    const out = { ...r };
    if (out.mesh && Array.isArray(out.mesh.positions)) {
      out.mesh = {
        kind: 'mesh-summary',
        vertices: out.mesh.positions.length / 3,
        triangles: (out.mesh.indices?.length || 0) / 3,
        bbox: out.mesh.bbox || null,
      };
    }
    return out;
  };
  const safe = {
    run_id: trace.run_id || trace.runId,
    ts_iso: trace.ts_iso || trace.ts || new Date().toISOString(),
    app: trace.app || 'studio',
    discipline: trace.discipline,
    user_prompt: trace.user_prompt || trace.prompt,
    iterations: (trace.iterations || []).map((iter) => ({
      think: iter.think,
      plan: iter.plan,
      tool_calls: iter.tool_calls || iter.toolCalls,
      executor_results: (iter.executor_results || iter.toolResponses || []).map(summariseResp),
      verifier: iter.verifier ? {
        ok: !!iter.verifier.ok,
        violations: iter.verifier.violations || [],
        score: iter.verifier.score,
      } : null,
      clarify: iter.clarify,
      took_ms: iter.took_ms,
    })),
    final_outcome: trace.final_outcome || trace.final,
    screenshots: trace.screenshots || [],
  };
  return JSON.stringify(safe) + '\n';
}

/**
 * Flush one trace to the day's JSONL file. Best-effort — failures log
 * but never throw (the trace sink is not the place to surface fs problems).
 *
 * Returns { path, bytes } on success, null on failure.
 */
export async function flushTrace(trace, opts = {}) {
  if (!trace || typeof trace !== 'object') return null;
  const line = serializeTrace(trace);
  const filename = opts.filename || defaultFilename(trace);

  // -- Electron renderer path
  if (typeof window !== 'undefined' && window.studio && window.studio.trace) {
    try {
      const out = await window.studio.trace.write(filename, line);
      return { path: out?.path || filename, bytes: line.length };
    } catch (err) {
      console.error('[studio.trace] renderer flush failed:', err.message);
      return null;
    }
  }

  // -- Node path (tests, headless CLI, e2e)
  try {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const dir = opts.dir || path.join(os.homedir(), '.archdisc', 'studio-traces');
    await fs.mkdir(dir, { recursive: true });
    const full = path.join(dir, filename);
    await fs.appendFile(full, line, 'utf8');
    return { path: full, bytes: line.length };
  } catch (err) {
    console.error('[studio.trace] node flush failed:', err.message);
    return null;
  }
}

/**
 * Caller helper: build an onEvent wrapper that collects per-iteration
 * data into in-memory traces and flushes one trace per goal at
 * `goal-done`. Drop-in for runArchieLoop:
 *
 *   const tracer = makeTraceCollector({ app: 'studio' });
 *   await runArchieLoop({ ..., onEvent: tracer.onEvent });
 *
 * After the loop, `tracer.traces` holds the flushed trace objects.
 */
export function makeTraceCollector(opts = {}) {
  const app = opts.app || 'studio';
  const traces = [];
  let active = null;
  return {
    traces,
    onEvent(ev) {
      if (ev.type === 'goal-start') {
        active = {
          run_id: `${app}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          ts_iso: new Date().toISOString(),
          app,
          discipline: ev.discipline || opts.discipline,
          user_prompt: ev.goal,
          iterations: [],
        };
      } else if (ev.type === 'iteration' && active) {
        active.iterations.push({
          plan: ev.plan,
          tool_calls: ev.tool_calls,
          executor_results: ev.bodies ? [{ bodies: ev.bodies }] : [],
          verifier: { ok: ev.score >= 1.0, score: ev.score },
          took_ms: ev.took_ms,
        });
      } else if (ev.type === 'goal-done' && active) {
        active.final_outcome = ev.parity ? 'success' : (active.iterations.length > 1 ? 'recovered' : 'abandoned');
        traces.push(active);
        flushTrace(active, opts).catch(() => {});
        active = null;
      }
      if (opts.passthrough) opts.passthrough(ev);
    },
  };
}
