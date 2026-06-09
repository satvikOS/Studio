#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DIMENSIONAL_DOMAINS = new Set([
  'furniture', 'archviz', 'kitchen', 'fastener', 'consumer-electronics',
  'vehicle', 'boat', 'aircraft', 'foliage', 'terrain', 'character',
  'retopo', 'cad', 'manufacturing', 'material', 'lighting', 'camera',
]);

const MATERIAL_TERMS = new Set([
  'oak', 'walnut', 'pine', 'steel', 'stainless steel', 'aluminium', 'aluminum',
  'brushed aluminium', 'brushed aluminum', 'glass', 'ceramic', 'fabric',
  'leather', 'rubber', 'plastic', 'brass', 'copper', 'concrete', 'stone',
  'paint', 'powder coat', 'wood', 'woven fabric', 'anodized aluminium',
]);

const REQUIRED_TOP = [
  'object_type', 'real_world_scale', 'operations', 'constraints',
  'negative_checks', 'source', 'license', 'provenance_url', 'domain_tags',
];

function stableHash(value) {
  const normalized = JSON.stringify(sortObject(value));
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortObject(value[k])]));
}

function parseJsonl(text, sourcePath = '<memory>') {
  const rows = [];
  const errors = [];
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    try {
      rows.push({ row: JSON.parse(raw), line: i + 1, sourcePath });
    } catch (err) {
      errors.push({ line: i + 1, error: `invalid JSON: ${err.message}` });
    }
  }
  return { rows, errors };
}

function dimensionVector(row) {
  const bbox = row?.real_world_scale?.bbox;
  if (!Array.isArray(bbox)) return [];
  return bbox.map((n) => Number.isFinite(Number(n)) ? Number(n).toFixed(4) : 'nan');
}

function semanticKey(row) {
  const object = String(row.object_type || '').trim().toLowerCase();
  const dims = dimensionVector(row).join('x');
  const tags = Array.isArray(row.domain_tags)
    ? row.domain_tags.map((s) => String(s).toLowerCase()).sort().join(',')
    : '';
  const ops = Array.isArray(row.operations)
    ? row.operations.map((s) => String(s).toLowerCase()).sort().join(',')
    : '';
  return stableHash({ object, dims, tags, ops });
}

function validateSample(row) {
  const errors = [];
  const warnings = [];
  for (const key of REQUIRED_TOP) {
    if (!(key in row)) errors.push(`missing ${key}`);
  }

  const objectType = String(row.object_type || '').trim();
  if (objectType.length < 3) errors.push('object_type too short');

  const scale = row.real_world_scale || {};
  if (scale.unit !== 'm' && scale.unit !== 'mm') errors.push('real_world_scale.unit must be m or mm');
  if (!Array.isArray(scale.bbox) || scale.bbox.length !== 3) {
    errors.push('real_world_scale.bbox must be [x,y,z]');
  } else {
    for (const [idx, value] of scale.bbox.entries()) {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) errors.push(`bbox[${idx}] must be positive finite`);
      if (scale.unit === 'm' && n > 200) errors.push(`bbox[${idx}] implausible for metres: ${n}`);
      if (scale.unit === 'mm' && n > 200000) errors.push(`bbox[${idx}] implausible for millimetres: ${n}`);
    }
  }

  if (row.tolerances != null) {
    if (!Array.isArray(row.tolerances) || row.tolerances.length === 0) {
      errors.push('tolerances must be a non-empty array when present');
    } else {
      for (const [idx, tol] of row.tolerances.entries()) {
        if (!tol || typeof tol !== 'object') { errors.push(`tolerances[${idx}] must be object`); continue; }
        if (tol.unit !== 'm' && tol.unit !== 'mm' && tol.unit !== 'deg') errors.push(`tolerances[${idx}].unit invalid`);
        const min = Number(tol.min);
        const max = Number(tol.max);
        if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) errors.push(`tolerances[${idx}] invalid min/max`);
      }
    }
  }

  if (!Array.isArray(row.operations) || row.operations.length < 2) errors.push('operations must contain at least 2 concrete steps');
  if (!Array.isArray(row.constraints) || row.constraints.length < 1) errors.push('constraints must contain at least 1 real constraint');
  if (!Array.isArray(row.negative_checks) || row.negative_checks.length < 1) errors.push('negative_checks must contain at least 1 rejection rule');
  if (!Array.isArray(row.domain_tags) || row.domain_tags.length < 1) errors.push('domain_tags must contain at least 1 tag');
  else {
    const known = row.domain_tags.some((tag) => DIMENSIONAL_DOMAINS.has(String(tag).toLowerCase()));
    if (!known) warnings.push('domain_tags contain no known 3D/manufacturing domain');
  }

  if (Array.isArray(row.materials)) {
    const hasKnownMaterial = row.materials.some((m) => MATERIAL_TERMS.has(String(m).toLowerCase()));
    if (!hasKnownMaterial) warnings.push('materials contain no recognized physical material term');
  } else {
    warnings.push('materials absent; accepted only for abstract geometry samples');
  }

  if (!String(row.source || '').trim()) errors.push('source is empty');
  if (!String(row.license || '').trim()) errors.push('license is empty');
  const provenance = String(row.provenance_url || '').trim();
  if (!provenance || (!/^https?:\/\//.test(provenance) && !/^local:/.test(provenance))) {
    errors.push('provenance_url must be http(s) URL or local:<path>');
  }

  if (row.verifier_score != null) {
    const score = Number(row.verifier_score);
    if (!Number.isFinite(score) || score < 0 || score > 1) errors.push('verifier_score must be 0..1');
  }

  return { ok: errors.length === 0, errors, warnings };
}

function scoreSample(row, validation) {
  if (!validation.ok) return 0;
  let score = 0.55;
  if (Array.isArray(row.materials) && row.materials.length > 0) score += 0.08;
  if (Array.isArray(row.tolerances) && row.tolerances.length > 0) score += 0.10;
  if (Array.isArray(row.operations)) score += Math.min(0.12, row.operations.length * 0.02);
  if (Array.isArray(row.negative_checks)) score += Math.min(0.10, row.negative_checks.length * 0.05);
  if (Array.isArray(row.constraints)) score += Math.min(0.08, row.constraints.length * 0.04);
  if (String(row.provenance_url || '').startsWith('https://')) score += 0.04;
  score -= validation.warnings.length * 0.03;
  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}

function gateSamples(rows, opts = {}) {
  const minScore = Number.isFinite(Number(opts.minScore)) ? Number(opts.minScore) : 0.72;
  const seen = new Map();
  const accepted = [];
  const rejected = [];
  for (const item of rows) {
    const row = item.row || item;
    const line = item.line || null;
    const validation = validateSample(row);
    const score = scoreSample(row, validation);
    const key = validation.ok ? semanticKey(row) : '';
    const reasons = [...validation.errors];
    if (validation.ok && score < minScore) reasons.push(`score ${score} below threshold ${minScore}`);
    if (validation.ok && seen.has(key)) reasons.push(`duplicate semantic_key ${key.slice(0, 12)} first seen at line ${seen.get(key)}`);

    if (reasons.length) {
      rejected.push({ line, object_type: row.object_type || null, score, reasons, warnings: validation.warnings });
      continue;
    }

    seen.set(key, line || accepted.length + 1);
    accepted.push({
      ...row,
      verifier_score: score,
      semantic_key: key,
      corpus_record_hash: stableHash(row),
    });
  }
  return { accepted, rejected, minScore };
}

function readJsonlFile(filePath) {
  return parseJsonl(fs.readFileSync(filePath, 'utf8'), filePath);
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
}

function writeReport(filePath, report) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2) + '\n');
}

function runCli(argv) {
  const args = new Map();
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    args.set(key.slice(2), argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true');
  }
  const input = args.get('input');
  const acceptedPath = args.get('accepted') || 'data/archie/corpus/accepted.jsonl';
  const rejectedPath = args.get('rejected') || 'data/archie/corpus/rejected.json';
  const minScore = Number(args.get('min-score') || 0.72);
  if (!input) {
    console.error('usage: node tools/archie-corpus-gate.mjs --input <samples.jsonl> [--accepted out.jsonl] [--rejected report.json] [--min-score 0.72]');
    return 2;
  }
  const parsed = readJsonlFile(input);
  const parseRejects = parsed.errors.map((e) => ({ line: e.line, object_type: null, score: 0, reasons: [e.error], warnings: [] }));
  const result = gateSamples(parsed.rows, { minScore });
  const rejected = [...parseRejects, ...result.rejected];
  writeJsonl(acceptedPath, result.accepted);
  writeReport(rejectedPath, {
    input,
    minScore,
    accepted: result.accepted.length,
    rejected: rejected.length,
    rejectedSamples: rejected,
  });
  console.log(`archie-corpus-gate accepted=${result.accepted.length} rejected=${rejected.length} minScore=${minScore}`);
  console.log(`accepted_path=${acceptedPath}`);
  console.log(`rejected_path=${rejectedPath}`);
  return rejected.length > 0 ? 1 : 0;
}

export {
  parseJsonl,
  validateSample,
  scoreSample,
  semanticKey,
  gateSamples,
  stableHash,
};

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  process.exitCode = runCli(process.argv);
}
