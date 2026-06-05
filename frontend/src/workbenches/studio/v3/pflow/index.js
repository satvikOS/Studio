// Slice 698 — Particle Flow event-driven particle graph.

import { registerOps } from '../common/registry.js';
import {
  createEvent, listEvents, removeEvent, setOperator, setTest, connect,
} from './events.js';
import { start, stop, reset, getStats } from './runtime.js';

let _installed = false;

export function installPFlow() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioPFlowCreateEvent: (name, opts) => {
      const ev = createEvent(name, opts);
      return { ok: true, uuid: ev.uuid, name: ev.name };
    },
    __studioPFlowListEvents: () => ({
      ok: true,
      count: listEvents().length,
      events: listEvents().map((e) => ({ uuid: e.uuid, name: e.name, enabled: e.enabled, operators: e.operators.map((o) => o.name), tests: e.tests.length })),
    }),
    __studioPFlowRemoveEvent: (uuid) => ({ ok: removeEvent(uuid) }),
    __studioPFlowSetOperator: (eventUuid, opName, params) => setOperator(eventUuid, opName, params),
    __studioPFlowSetTest: (eventUuid, idx, kind, params) => setTest(eventUuid, idx, kind, params),
    __studioPFlowConnect: (srcUuid, srcTestIdx, dstUuid) => connect(srcUuid, srcTestIdx, dstUuid),
    __studioPFlowStart: start,
    __studioPFlowStop: stop,
    __studioPFlowReset: reset,
    __studioPFlowGetStats: getStats,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'fx', 'Particle Flow event-driven particle graph');
}
