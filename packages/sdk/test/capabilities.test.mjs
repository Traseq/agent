import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveInstrument, preflightStrategyDraft } from '../dist/index.js';

const CAPABILITIES = {
  protocol: 'traseq.capabilities',
  version: 1,
  indicators: [
    {
      id: 'ema',
      argNames: ['length'],
      args: [{ name: 'length', type: 'integer', required: true, minimum: 1 }],
    },
    {
      id: 'supertrend',
      argNames: ['atr_length', 'multiplier'],
      args: [
        {
          name: 'atr_length',
          type: 'integer',
          required: true,
          minimum: 1,
        },
        { name: 'multiplier', type: 'number', required: true, minimum: 0 },
      ],
      output: {
        name: 'output',
        type: 'enum',
        required: true,
        enumValues: ['supertrend', 'trend_direction'],
      },
      outputs: ['supertrend', 'trend_direction'],
    },
  ],
  instruments: [
    { symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', dataStart: '2017-08-17' },
    { symbol: 'ETHUSDT', base: 'ETH', quote: 'USDT', dataStart: '2017-08-17' },
    { symbol: 'SOLUSDT', base: 'SOL', quote: 'USDT', dataStart: '2020-08-11' },
  ],
  operators: {
    compare: ['eq', 'gt', 'lt'],
    cross: ['cross_up', 'cross_down'],
  },
  signalGraph: {
    nodeKinds: ['market', 'indicator', 'compare', 'cross'],
  },
};

function draftWithNodes(nodes) {
  return {
    name: 'test',
    signalGraph: {
      protocol: 'traseq.signal-graph',
      version: 2,
      nodes,
      strategy: {
        kind: 'strategy',
        entry: {
          kind: 'entry',
          trigger: { ref: nodes.at(-1).id },
          action: {
            side: 'long',
            sizing: { mode: 'percent_equity', value: 10 },
          },
        },
      },
    },
    settings: { positionStyle: 'single', warmupPeriod: 100 },
    backtest: {
      timeframe: '1h',
      signalInstrument: { symbol: 'BTCUSDT' },
      initialBalance: 10_000,
    },
  };
}

test('preflightStrategyDraft rejects indicator output inside args', () => {
  const draft = draftWithNodes([
    {
      id: 'st_line',
      kind: 'indicator',
      indicator: 'supertrend',
      args: { atr_length: 10, multiplier: 3, output: 'supertrend' },
    },
    {
      id: 'close',
      kind: 'market',
      field: 'close',
    },
    {
      id: 'st_cross',
      kind: 'cross',
      op: 'cross_up',
      left: { ref: 'close' },
      right: { ref: 'st_line' },
    },
  ]);

  const result = preflightStrategyDraft(draft, CAPABILITIES);
  assert.equal(result.valid, false);
  assert.ok(
    result.issues.some(
      (issue) => issue.path === 'signalGraph.nodes[0].args.output',
    ),
  );
});

test('preflightStrategyDraft rejects missing required indicator output', () => {
  const draft = draftWithNodes([
    {
      id: 'st_dir',
      kind: 'indicator',
      indicator: 'supertrend',
      args: { atr_length: 10, multiplier: 3 },
    },
    {
      id: 'st_bull',
      kind: 'compare',
      op: 'eq',
      left: { ref: 'st_dir' },
      right: { const: 1 },
    },
  ]);

  const preflight = preflightStrategyDraft(draft, CAPABILITIES);
  assert.equal(preflight.valid, false);
  assert.ok(
    preflight.issues.some((issue) =>
      issue.message.includes('output is required for indicator "supertrend"'),
    ),
  );
});

test('resolveInstrument resolves exact symbols and unique base aliases', () => {
  assert.equal(resolveInstrument('BTC', CAPABILITIES).symbol, 'BTCUSDT');
  assert.equal(resolveInstrument('ethusdt', CAPABILITIES).symbol, 'ETHUSDT');
  assert.equal(resolveInstrument('SOL/USDT', CAPABILITIES).symbol, 'SOLUSDT');
});

test('resolveInstrument rejects unsupported equities without BTC fallback', () => {
  const spy = resolveInstrument('SPY', CAPABILITIES);
  const aapl = resolveInstrument('AAPL', CAPABILITIES);

  assert.equal(spy.status, 'unsupported');
  assert.equal(aapl.status, 'unsupported');
  assert.equal(spy.symbol, undefined);
  assert.ok(spy.suggestions.includes('BTCUSDT'));
});
