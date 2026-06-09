import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  parseJsonl,
  validateSample,
  scoreSample,
  semanticKey,
  gateSamples,
} from '../tools/archie-corpus-gate.mjs';

const fixture = path.resolve('data/archie/corpus/fixtures/studio3d-spec-fixtures.jsonl');

test('Archie corpus gate accepts grounded 3D specs and rejects bad/duplicate samples', () => {
  const parsed = parseJsonl(fs.readFileSync(fixture, 'utf8'), fixture);
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rows.length, 5);

  const result = gateSamples(parsed.rows, { minScore: 0.72 });
  assert.equal(result.accepted.length, 3);
  assert.equal(result.rejected.length, 2);

  const acceptedTypes = result.accepted.map((r) => r.object_type).sort();
  assert.deepEqual(acceptedTypes, [
    'M8 hex bolt',
    'Scandinavian dining chair',
    'cassette deck faceplate',
  ]);

  assert.ok(result.accepted.every((r) => r.verifier_score >= 0.72));
  assert.ok(result.accepted.every((r) => r.semantic_key && r.corpus_record_hash));
  assert.ok(result.rejected.some((r) => r.reasons.some((reason) => reason.includes('missing')) || r.object_type === 'bad giant chair'));
  assert.ok(result.rejected.some((r) => r.reasons.some((reason) => reason.includes('duplicate semantic_key'))));
});

test('Archie corpus validator requires real units, provenance, constraints, operations, and negative checks', () => {
  const bad = {
    object_type: 'box',
    real_world_scale: { unit: 'vibes', bbox: [1, 1, 1] },
    operations: ['spawn'],
    constraints: [],
    negative_checks: [],
    source: '',
    license: '',
    provenance_url: 'none',
    domain_tags: [],
  };
  const validation = validateSample(bad);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.includes('real_world_scale.unit must be m or mm'));
  assert.ok(validation.errors.includes('operations must contain at least 2 concrete steps'));
  assert.ok(validation.errors.includes('constraints must contain at least 1 real constraint'));
  assert.ok(validation.errors.includes('negative_checks must contain at least 1 rejection rule'));
  assert.ok(validation.errors.includes('provenance_url must be http(s) URL or local:<path>'));
  assert.equal(scoreSample(bad, validation), 0);
});

test('Archie corpus semantic key dedupes equivalent object/dimension/operation records', () => {
  const parsed = parseJsonl(fs.readFileSync(fixture, 'utf8'), fixture);
  const firstChair = parsed.rows[0].row;
  const duplicateChair = parsed.rows[4].row;
  assert.equal(semanticKey(firstChair), semanticKey(duplicateChair));
});

test('Archie corpus semantic key normalizes metres and millimetres before dedupe', () => {
  const base = {
    object_type: 'M8 hex bolt',
    real_world_scale: { unit: 'm', bbox: [0.013, 0.013, 0.04] },
    operations: ['create hex head', 'thread shaft'],
    constraints: ['ISO metric fastener proportions'],
    negative_checks: ['reject smooth unthreaded cylinder'],
    source: 'unit-test',
    license: 'CC0',
    provenance_url: 'local:test',
    domain_tags: ['fastener'],
    materials: ['steel'],
  };
  const inMm = {
    ...base,
    real_world_scale: { unit: 'mm', bbox: [13, 13, 40] },
  };

  assert.equal(semanticKey(base), semanticKey(inMm));
  const result = gateSamples([{ row: base, line: 1 }, { row: inMm, line: 2 }], { minScore: 0.5 });
  assert.equal(result.accepted.length, 1);
  assert.equal(result.rejected.length, 1);
  assert.ok(result.rejected[0].reasons.some((reason) => reason.includes('duplicate semantic_key')));
});

test('Archie corpus gate CLI writes accepted JSONL and rejection report', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archie-corpus-gate-'));
  const accepted = path.join(dir, 'accepted.jsonl');
  const rejected = path.join(dir, 'rejected.json');
  const run = spawnSync(process.execPath, [
    'tools/archie-corpus-gate.mjs',
    '--input', fixture,
    '--accepted', accepted,
    '--rejected', rejected,
    '--min-score', '0.72',
  ], { cwd: path.resolve('.'), encoding: 'utf8' });

  assert.equal(run.status, 1, 'fixture intentionally has rejections, so CLI exits 1');
  assert.match(run.stdout, /accepted=3 rejected=2/);

  const acceptedRows = fs.readFileSync(accepted, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(acceptedRows.length, 3);
  const report = JSON.parse(fs.readFileSync(rejected, 'utf8'));
  assert.equal(report.accepted, 3);
  assert.equal(report.rejected, 2);
  assert.ok(report.rejectedSamples.some((sample) => sample.reasons.some((r) => r.includes('duplicate semantic_key'))));
});
