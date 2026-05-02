import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStrategyDraft } from '../dist/index.js';

const CAPABILITIES = {
  protocol: 'traseq.capabilities',
  version: 1,
  indicators: [
    {
      id: 'ema',
      argNames: ['length', 'source'],
      args: [{ name: 'length', type: 'integer', required: true, minimum: 1 }],
    },
    {
      id: 'rsi',
      argNames: ['length'],
      args: [{ name: 'length', type: 'integer', required: true, minimum: 1 }],
    },
    {
      id: 'macd',
      argNames: ['fast_length', 'slow_length', 'signal_length', 'source'],
      args: [
        { name: 'fast_length', type: 'integer', required: true, minimum: 1 },
        { name: 'slow_length', type: 'integer', required: true, minimum: 1 },
        { name: 'signal_length', type: 'integer', required: true, minimum: 1 },
      ],
      output: {
        name: 'output',
        type: 'enum',
        required: true,
        enumValues: ['macd', 'signal', 'hist'],
      },
      outputs: ['macd', 'signal', 'hist'],
    },
  ],
};

function draftWithNodes(nodes) {
  return {
    name: 'test',
    signalGraph: { nodes },
    settings: { positionStyle: 'single', warmupPeriod: 100 },
    backtest: {
      timeframe: '1h',
      signalInstrument: { symbol: 'BTCUSDT' },
      initialBalance: 10_000,
    },
  };
}

describe('normalizeStrategyDraft', () => {
  it('renames args.period to args.length on indicator nodes', () => {
    const draft = draftWithNodes([
      { id: 'ema_50', kind: 'indicator', indicator: 'ema', args: { period: 50 } },
    ]);

    const result = normalizeStrategyDraft(draft, CAPABILITIES);
    assert.equal(result.changed, true);
    assert.equal(result.draft.signalGraph.nodes[0].args.length, 50);
    assert.ok(!('period' in result.draft.signalGraph.nodes[0].args));
    assert.ok(result.patches.some((p) => p.op === 'rename'));
    // Original draft must remain untouched.
    assert.equal(draft.signalGraph.nodes[0].args.period, 50);
  });

  it('lifts args.output to top-level output for multi-output indicators', () => {
    const draft = draftWithNodes([
      {
        id: 'macd_line',
        kind: 'indicator',
        indicator: 'macd',
        args: {
          fast_length: 12,
          slow_length: 26,
          signal_length: 9,
          output: 'macd',
        },
      },
    ]);

    const result = normalizeStrategyDraft(draft, CAPABILITIES);
    assert.equal(result.changed, true);
    const node = result.draft.signalGraph.nodes[0];
    assert.equal(node.output, 'macd');
    assert.ok(!('output' in node.args));
    assert.ok(result.patches.some((p) => p.op === 'lift'));
  });

  it('drops args.output for indicators with no output selector', () => {
    const draft = draftWithNodes([
      {
        id: 'ema_50',
        kind: 'indicator',
        indicator: 'ema',
        args: { length: 50, output: 'value' },
      },
    ]);

    const result = normalizeStrategyDraft(draft, CAPABILITIES);
    assert.equal(result.changed, true);
    const node = result.draft.signalGraph.nodes[0];
    assert.ok(!('output' in node.args));
    assert.ok(!('output' in node)); // never lifted — the indicator has no output
    assert.ok(result.patches.some((p) => p.op === 'remove'));
  });

  it('drops top-level output for non-multi-output indicators', () => {
    const draft = draftWithNodes([
      {
        id: 'rsi_14',
        kind: 'indicator',
        indicator: 'rsi',
        args: { length: 14 },
        output: 'value',
      },
    ]);

    const result = normalizeStrategyDraft(draft, CAPABILITIES);
    assert.equal(result.changed, true);
    assert.ok(!('output' in result.draft.signalGraph.nodes[0]));
  });

  it('dedupes args.length + args.period by keeping length', () => {
    const draft = draftWithNodes([
      {
        id: 'ema_50',
        kind: 'indicator',
        indicator: 'ema',
        args: { length: 50, period: 100 },
      },
    ]);

    const result = normalizeStrategyDraft(draft, CAPABILITIES);
    assert.equal(result.changed, true);
    assert.equal(result.draft.signalGraph.nodes[0].args.length, 50);
    assert.ok(!('period' in result.draft.signalGraph.nodes[0].args));
  });

  it('leaves rolling nodes (kind: rolling) alone — period is canonical there', () => {
    const draft = draftWithNodes([
      {
        id: 'high_max_20',
        kind: 'rolling',
        op: 'max',
        period: 20,
        source: { ref: 'high_price' },
      },
    ]);

    const result = normalizeStrategyDraft(draft, CAPABILITIES);
    assert.equal(result.changed, false);
    assert.equal(result.draft.signalGraph.nodes[0].period, 20);
  });

  it('falls back to safe rewrites when capabilities omit indicator catalog', () => {
    const draft = draftWithNodes([
      { id: 'ema_50', kind: 'indicator', indicator: 'ema', args: { period: 50 } },
      {
        id: 'macd_line',
        kind: 'indicator',
        indicator: 'macd',
        args: { fast_length: 12, slow_length: 26, signal_length: 9, output: 'macd' },
      },
    ]);

    const result = normalizeStrategyDraft(draft, undefined);
    assert.equal(result.changed, true);
    // period -> length even without catalog (indicator nodes never use period).
    assert.equal(result.draft.signalGraph.nodes[0].args.length, 50);
    // args.output is lifted (we'd rather surface one error than two).
    assert.equal(result.draft.signalGraph.nodes[1].output, 'macd');
  });

  it('returns changed=false when nothing needs rewriting', () => {
    const draft = draftWithNodes([
      { id: 'ema_50', kind: 'indicator', indicator: 'ema', args: { length: 50 } },
    ]);
    const result = normalizeStrategyDraft(draft, CAPABILITIES);
    assert.equal(result.changed, false);
    assert.deepEqual(result.patches, []);
  });
});
