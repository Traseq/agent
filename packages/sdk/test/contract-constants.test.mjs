/**
 * Contract test: compares SDK authoring-schema constants against the
 * backend's domain-constants manifest.
 *
 * If this test fails, it means the SDK's embedded enum values have drifted
 * from the backend.  Fix by updating authoring-schema.ts to match.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildStrategyDraftJsonSchema } from '../dist/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifestPath = resolve(
  __dirname,
  '../../../docs/public-docs/domain-constants.json',
);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const backendConstants = manifest.constants;

// Build the SDK's JSON Schema and extract enum values from it.
const schema = buildStrategyDraftJsonSchema();
const sgProps = schema.schema.properties.signalGraph.properties;
const nodeSchemas = sgProps.nodes.items.oneOf;

function findNodeSchema(kind) {
  return nodeSchemas.find((n) => n.properties?.kind?.const === kind);
}

function extractEnum(nodeKind, field) {
  const node = findNodeSchema(nodeKind);
  assert.ok(node, `Node schema for kind "${nodeKind}" not found`);
  const prop = node.properties[field];
  assert.ok(prop, `Property "${field}" not found on node "${nodeKind}"`);
  return [...(prop.enum || prop.items?.enum || [])].sort();
}

function sorted(arr) {
  return [...arr].sort();
}

// ── Market fields ───────────────────────────────────────────────────────────
test('SDK MARKET_FIELDS matches backend', () => {
  const sdkFields = extractEnum('market', 'field');
  assert.deepEqual(sdkFields, sorted(backendConstants.MARKET_FIELDS));
});

// ── State fields ────────────────────────────────────────────────────────────
test('SDK STATE_FIELDS matches backend', () => {
  const sdkFields = extractEnum('state', 'field');
  assert.deepEqual(sdkFields, sorted(backendConstants.STATE_FIELDS));
});

// ── Patterns ────────────────────────────────────────────────────────────────
test('SDK PATTERNS matches backend', () => {
  const sdkPatterns = extractEnum('pattern', 'name');
  assert.deepEqual(sdkPatterns, sorted(backendConstants.PATTERNS));
});

// ── Timeframes ──────────────────────────────────────────────────────────────
test('SDK TIMEFRAMES matches backend', () => {
  const sdkTimeframes = extractEnum('market', 'timeframe');
  assert.deepEqual(sdkTimeframes, sorted(backendConstants.TIMEFRAMES));
});

// ── Compare operators ───────────────────────────────────────────────────────
test('SDK COMPARE_OPS matches backend', () => {
  const sdkOps = extractEnum('compare', 'op');
  assert.deepEqual(sdkOps, sorted(backendConstants.COMPARE_OPS));
});

// ── Cross operators ─────────────────────────────────────────────────────────
test('SDK CROSS_OPS matches backend', () => {
  const sdkOps = extractEnum('cross', 'op');
  assert.deepEqual(sdkOps, sorted(backendConstants.CROSS_OPS));
});

// ── Rolling operators ───────────────────────────────────────────────────────
test('SDK ROLLING_OPERATORS matches backend', () => {
  const sdkOps = extractEnum('rolling', 'op');
  assert.deepEqual(sdkOps, sorted(backendConstants.ROLLING_OPERATORS));
});

// ── Math operators ──────────────────────────────────────────────────────────
test('SDK MATH_OPERATORS matches backend', () => {
  const sdkOps = extractEnum('math', 'op');
  assert.deepEqual(sdkOps, sorted(backendConstants.MATH_OPERATORS));
});

// ── Rolling window modes ────────────────────────────────────────────────────
test('SDK ROLLING_WINDOW_MODES matches backend', () => {
  const sdkModes = extractEnum('rolling_window', 'mode');
  assert.deepEqual(sdkModes, sorted(backendConstants.ROLLING_WINDOW_MODES));
});

// ── Conflict policies ───────────────────────────────────────────────────────
test('SDK CONFLICT_POLICIES matches backend', () => {
  const sdkPolicies = extractEnum('state_machine', 'conflictPolicy');
  assert.deepEqual(sdkPolicies, sorted(backendConstants.CONFLICT_POLICIES));
});

// ── Weekdays ────────────────────────────────────────────────────────────────
test('SDK WEEKDAYS matches backend', () => {
  const sdkWeekdays = extractEnum('time_window', 'weekdays');
  assert.deepEqual(sdkWeekdays, sorted(backendConstants.WEEKDAYS));
});

// ── Entry sizing modes ──────────────────────────────────────────────────────
test('SDK ENTRY_SIZING_MODES matches backend', () => {
  const entryAction = sgProps.strategy.properties.entry.properties.action;
  const sizingMode = entryAction.properties.sizing.properties.mode;
  const sdkModes = [...(sizingMode.enum || [])].sort();
  assert.deepEqual(sdkModes, sorted(backendConstants.ENTRY_SIZING_MODES));
});

// ── Exit sizing modes ───────────────────────────────────────────────────────
test('SDK EXIT_SIZING_MODES matches backend', () => {
  const exitAction = sgProps.strategy.properties.exits.items.properties.action;
  const sizingMode = exitAction.properties.mode;
  const sdkModes = [...(sizingMode.enum || [])].sort();
  assert.deepEqual(sdkModes, sorted(backendConstants.EXIT_SIZING_MODES));
});

// ── Sides ───────────────────────────────────────────────────────────────────
test('SDK SIDES matches backend', () => {
  const entryAction = sgProps.strategy.properties.entry.properties.action;
  const side = entryAction.properties.side;
  const sdkSides = [...(side.enum || [])].sort();
  assert.deepEqual(sdkSides, sorted(backendConstants.SIDES));
});

// ── Tolerance modes ─────────────────────────────────────────────────────────
test('SDK TOLERANCE_MODES matches backend', () => {
  const nearNode = findNodeSchema('near');
  const tolerance = nearNode.properties.tolerance;
  const sdkModes = [...(tolerance.properties.mode.enum || [])].sort();
  assert.deepEqual(sdkModes, sorted(backendConstants.TOLERANCE_MODES));
});
