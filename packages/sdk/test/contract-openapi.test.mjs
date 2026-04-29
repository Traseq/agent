/**
 * Contract test: verifies that every TraseqClient method maps to a real
 * endpoint in the committed OpenAPI spec, and that the spec doesn't contain
 * public/v1 endpoints the SDK fails to expose.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const specPath = resolve(
  __dirname,
  '../../../docs/public-docs/openapi/traseq-public-agent.json',
);
const spec = JSON.parse(readFileSync(specPath, 'utf8'));

// Collect all public/v1 endpoints from the OpenAPI spec.
// Normalise path params: /public/v1/strategies/{id} → /public/v1/strategies/:param
function normalisePath(p) {
  return p.replace(/\{[^}]+\}/g, ':param');
}

const specEndpoints = new Map();
for (const [path, methods] of Object.entries(spec.paths)) {
  if (!path.startsWith('/public/v1')) continue;
  for (const method of Object.keys(methods)) {
    if (method === 'parameters') continue;
    const key = `${method.toUpperCase()} ${normalisePath(path)}`;
    specEndpoints.set(key, { path, method });
  }
}

// Define the expected mapping from TraseqClient methods to OpenAPI paths.
const CLIENT_METHOD_MAP = [
  { method: 'getManifest', verb: 'GET', path: '/public/v1' },
  { method: 'getHealth', verb: 'GET', path: '/public/v1/health' },
  { method: 'getWorkspaceContext', verb: 'GET', path: '/public/v1/workspace' },
  { method: 'getUsage', verb: 'GET', path: '/public/v1/usage' },
  {
    method: 'getCapabilities',
    verb: 'GET',
    path: '/public/v1/capabilities',
    optional: true, // capabilities endpoint may not be in the OpenAPI export
  },
  {
    method: 'listSystemStrategies',
    verb: 'GET',
    path: '/public/v1/system-strategies',
  },
  {
    method: 'getSystemStrategy',
    verb: 'GET',
    path: '/public/v1/system-strategies/:param',
  },
  {
    method: 'copySystemStrategy',
    verb: 'POST',
    path: '/public/v1/system-strategies/:param/copy',
    requestBody: true,
  },
  {
    method: 'validateStrategy',
    verb: 'POST',
    path: '/public/v1/strategies/validate',
    requestBody: true,
  },
  {
    method: 'validateConflicts',
    verb: 'POST',
    path: '/public/v1/strategies/validate-conflicts',
    requestBody: true,
  },
  { method: 'listStrategies', verb: 'GET', path: '/public/v1/strategies' },
  {
    method: 'createStrategy',
    verb: 'POST',
    path: '/public/v1/strategies',
    requestBody: true,
  },
  { method: 'getStrategy', verb: 'GET', path: '/public/v1/strategies/:param' },
  {
    method: 'updateStrategy',
    verb: 'PATCH',
    path: '/public/v1/strategies/:param',
    requestBody: true,
  },
  {
    method: 'createStrategyVersion',
    verb: 'POST',
    path: '/public/v1/strategies/:param/versions',
    requestBody: true,
  },
  {
    method: 'getStrategyVersion',
    verb: 'GET',
    path: '/public/v1/strategies/:param/versions/:param',
  },
  {
    method: 'updateStrategyVersion',
    verb: 'PATCH',
    path: '/public/v1/strategies/:param/versions/:param',
    requestBody: true,
  },
  {
    method: 'finalizeStrategyVersion',
    verb: 'POST',
    path: '/public/v1/strategies/:param/versions/finalize',
    requestBody: true,
  },
  {
    method: 'deleteStrategyVersion',
    verb: 'DELETE',
    path: '/public/v1/strategies/:param/versions/:param',
  },
  {
    method: 'archiveStrategyVersion',
    verb: 'POST',
    path: '/public/v1/strategies/:param/versions/:param/archive',
  },
  {
    method: 'restoreStrategyVersion',
    verb: 'POST',
    path: '/public/v1/strategies/:param/versions/:param/restore',
  },
  {
    method: 'createPineExport',
    verb: 'POST',
    path: '/public/v1/strategies/:param/versions/:param/pine-export',
    requestBody: true,
  },
  { method: 'listBacktests', verb: 'GET', path: '/public/v1/backtests' },
  {
    method: 'runBacktest',
    verb: 'POST',
    path: '/public/v1/backtests',
    requestBody: true,
  },
  {
    method: 'getBacktest',
    verb: 'GET',
    path: '/public/v1/backtests/:param',
  },
  {
    method: 'getBacktestProgress',
    verb: 'GET',
    path: '/public/v1/backtests/:param/progress',
  },
  {
    method: 'getBacktestChartData',
    verb: 'GET',
    path: '/public/v1/backtests/:param/chart-data',
  },
  {
    method: 'getBacktestPricePreview',
    verb: 'GET',
    path: '/public/v1/backtests/:param/price-preview',
  },
  {
    method: 'setPrimaryBacktest',
    verb: 'PATCH',
    path: '/public/v1/backtests/:param/set-primary',
  },
  {
    method: 'deleteBacktest',
    verb: 'DELETE',
    path: '/public/v1/backtests/:param',
  },
  {
    method: 'previewRobustnessAnalysis',
    verb: 'POST',
    path: '/public/v1/analysis-runs/robustness/preview',
    requestBody: true,
  },
  {
    method: 'createRobustnessAnalysis',
    verb: 'POST',
    path: '/public/v1/analysis-runs/robustness',
    requestBody: true,
  },
  {
    method: 'listAnalysisRuns',
    verb: 'GET',
    path: '/public/v1/analysis-runs',
  },
  {
    method: 'getAnalysisRun',
    verb: 'GET',
    path: '/public/v1/analysis-runs/:param',
  },
  {
    method: 'updateAnalysisRun',
    verb: 'PATCH',
    path: '/public/v1/analysis-runs/:param',
    requestBody: true,
  },
  {
    method: 'deleteAnalysisRun',
    verb: 'DELETE',
    path: '/public/v1/analysis-runs/:param',
  },
  {
    method: 'listComparisonSets',
    verb: 'GET',
    path: '/public/v1/comparison-sets',
  },
  {
    method: 'getComparisonSet',
    verb: 'GET',
    path: '/public/v1/comparison-sets/:param',
  },
  {
    method: 'createComparisonSet',
    verb: 'POST',
    path: '/public/v1/comparison-sets',
    requestBody: true,
  },
  {
    method: 'updateComparisonSet',
    verb: 'PATCH',
    path: '/public/v1/comparison-sets/:param',
    requestBody: true,
  },
  {
    method: 'deleteComparisonSet',
    verb: 'DELETE',
    path: '/public/v1/comparison-sets/:param',
  },
  { method: 'listBlocks', verb: 'GET', path: '/public/v1/blocks' },
  { method: 'getBlock', verb: 'GET', path: '/public/v1/blocks/:param' },
  {
    method: 'createBlock',
    verb: 'POST',
    path: '/public/v1/blocks',
    requestBody: true,
  },
  {
    method: 'updateBlock',
    verb: 'PATCH',
    path: '/public/v1/blocks/:param',
    requestBody: true,
  },
  { method: 'deleteBlock', verb: 'DELETE', path: '/public/v1/blocks/:param' },
  {
    method: 'pinBlock',
    verb: 'POST',
    path: '/public/v1/blocks/:param/pin',
  },
  {
    method: 'unpinBlock',
    verb: 'DELETE',
    path: '/public/v1/blocks/:param/pin',
  },
];

// ── Every SDK method must correspond to an OpenAPI endpoint ──────────────
test('every TraseqClient method maps to an existing OpenAPI endpoint', () => {
  const mismatches = [];
  for (const { method, verb, path, optional } of CLIENT_METHOD_MAP) {
    const key = `${verb} ${path}`;
    if (!specEndpoints.has(key) && !optional) {
      mismatches.push(`${method} → ${key} not found in OpenAPI spec`);
    }
  }
  assert.deepEqual(
    mismatches,
    [],
    `SDK methods reference endpoints missing from OpenAPI spec:\n${mismatches.join('\n')}`,
  );
});

// ── Every public/v1 endpoint should be covered by the SDK ───────────────
test('no uncovered public/v1 endpoints in OpenAPI spec', () => {
  const coveredPaths = new Set(
    CLIENT_METHOD_MAP.map((m) => `${m.verb} ${m.path}`),
  );

  const uncovered = [];
  for (const key of specEndpoints.keys()) {
    if (!coveredPaths.has(key)) {
      uncovered.push(key);
    }
  }

  assert.deepEqual(
    uncovered,
    [],
    `OpenAPI spec has public/v1 endpoints the SDK does not cover:\n${uncovered.join('\n')}\n` +
      `Either add them to TraseqClient or add to intentionallySkipped.`,
  );
});

// ── OpenAPI spec has well-formed request bodies for body-carrying endpoints ──────
test('body-carrying endpoints have request body schemas in OpenAPI spec', () => {
  const writeEndpoints = CLIENT_METHOD_MAP.filter((m) => m.requestBody);
  const missing = [];
  for (const { method, verb, path } of writeEndpoints) {
    const specPath = Object.keys(spec.paths).find(
      (p) => normalisePath(p) === path,
    );
    if (!specPath) continue;
    const op = spec.paths[specPath][verb.toLowerCase()];
    const hasBody =
      op?.requestBody?.content?.['application/json']?.schema != null;
    if (!hasBody) {
      missing.push(`${method} → ${verb} ${path}`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    `Write endpoints missing request body schema in OpenAPI:\n${missing.join('\n')}`,
  );
});

function responseSchema(path, method, status) {
  return spec.paths[path]?.[method]?.responses?.[status]?.content?.[
    'application/json'
  ]?.schema;
}

// ── Backtest responses expose agent-friendly navigation and run context ──────
test('backtest response schemas expose app links and run context', () => {
  const runSchema = responseSchema('/public/v1/backtests', 'post', '201');
  const listItemSchema = responseSchema('/public/v1/backtests', 'get', '200')
    ?.properties?.data?.items;
  const detailSchema = responseSchema(
    '/public/v1/backtests/{id}',
    'get',
    '200',
  );

  for (const schema of [runSchema, listItemSchema, detailSchema]) {
    assert.ok(schema, 'missing backtest response schema');
    assert.ok(schema.properties.appLinks, 'missing appLinks schema');
    assert.ok(schema.properties.runContext, 'missing runContext schema');
    assert.ok(
      schema.properties.appLinks.properties.backtest,
      'missing backtest URL schema',
    );
    assert.ok(
      schema.properties.runContext.properties.timeframe,
      'missing timeframe context schema',
    );
    assert.ok(
      schema.properties.runContext.properties.instrument.properties.symbol,
      'missing instrument symbol context schema',
    );
    assert.ok(
      schema.properties.runContext.properties.strategyVersionId,
      'missing strategy version context schema',
    );
  }
});
