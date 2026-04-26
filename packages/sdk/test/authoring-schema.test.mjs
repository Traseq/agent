import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStrategyDraftJsonSchema,
  STRATEGY_DRAFT_JSON_SCHEMA,
  validateStrategyDraft,
} from '../dist/index.js';

function createValidDraft() {
  return {
    name: 'Valid Draft',
    signalGraph: {
      protocol: 'traseq.signal-graph',
      version: 2,
      nodes: [
        {
          id: 'close',
          kind: 'market',
          field: 'close',
        },
        {
          id: 'trend_ok',
          kind: 'compare',
          op: 'gt',
          left: {
            ref: 'close',
          },
          right: {
            const: 100,
          },
        },
      ],
      strategy: {
        kind: 'strategy',
        entry: {
          kind: 'entry',
          trigger: {
            ref: 'trend_ok',
          },
          action: {
            side: 'long',
            sizing: {
              mode: 'percent_equity',
              value: 10,
            },
          },
        },
      },
    },
    settings: {
      positionStyle: 'single',
      warmupPeriod: 200,
    },
    backtest: {
      timeframe: '4h',
      signalInstrument: {
        symbol: 'BTCUSDT',
      },
      initialBalance: 10000,
    },
  };
}

test('validateStrategyDraft accepts a structurally valid draft', () => {
  const result = validateStrategyDraft(createValidDraft());

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.draft.signalGraph.strategy.entry.trigger.ref, 'trend_ok');
  }
});

test('STRATEGY_DRAFT_JSON_SCHEMA exposes node-level signalGraph union', () => {
  const nodeUnion =
    STRATEGY_DRAFT_JSON_SCHEMA.schema.properties.signalGraph.properties.nodes.items
      .oneOf;

  assert.ok(Array.isArray(nodeUnion));
  assert.equal(nodeUnion.length, 22);
  assert.equal(
    STRATEGY_DRAFT_JSON_SCHEMA.schema.properties.signalGraph.properties.strategy
      .properties.entry.required.includes('trigger'),
    true,
  );
});

test('buildStrategyDraftJsonSchema derives indicator args from capabilities', () => {
  const dynamicSchema = buildStrategyDraftJsonSchema({
    indicators: [
      {
        id: 'rsi',
        params: [
          {
            name: 'period',
            type: 'integer',
            required: true,
            minimum: 1,
          },
        ],
      },
      {
        id: 'ema',
        params: [
          {
            name: 'period',
            type: 'integer',
            required: true,
            minimum: 1,
          },
          {
            name: 'source',
            type: 'enum',
            required: false,
            enumValues: ['close', 'hl2'],
          },
        ],
      },
    ],
  });

  const nodeSchemas =
    dynamicSchema.schema.properties.signalGraph.properties.nodes.items.oneOf;
  const indicatorSchemas = nodeSchemas.filter(
    (schema) => schema.properties.kind.const === 'indicator',
  );

  assert.equal(indicatorSchemas.length, 2);
  assert.deepEqual(
    indicatorSchemas.map((schema) => schema.properties.indicator.const).sort(),
    ['ema', 'rsi'],
  );
  assert.deepEqual(indicatorSchemas[0].properties.args.type, 'object');
});

test('buildStrategyDraftJsonSchema promotes indicator output from args into top-level output', () => {
  const dynamicSchema = buildStrategyDraftJsonSchema({
    indicators: [
      {
        id: 'macd',
        structuralType: 'oscillator_operand',
        params: [
          {
            name: 'fast',
            type: 'integer',
            required: true,
            minimum: 1,
          },
          {
            name: 'slow',
            type: 'integer',
            required: true,
            minimum: 1,
          },
          {
            name: 'output',
            type: 'enum',
            required: true,
            enumValues: ['macd', 'signal', 'hist'],
          },
        ],
      },
    ],
  });

  const nodeSchemas =
    dynamicSchema.schema.properties.signalGraph.properties.nodes.items.oneOf;
  const macdSchema = nodeSchemas.find(
    (schema) => schema.properties.kind.const === 'indicator',
  );

  assert.ok(macdSchema);
  assert.equal(macdSchema.required.includes('output'), true);
  assert.deepEqual(macdSchema.properties.output.enum, ['macd', 'signal', 'hist']);
  assert.equal('output' in macdSchema.properties.args.properties, false);
  assert.match(macdSchema.description, /oscillator_operand/);
});

test('validateStrategyDraft rejects duplicate ids and unknown refs', () => {
  const draft = createValidDraft();
  draft.signalGraph.nodes.push({
    id: 'close',
    kind: 'pattern',
    name: 'inside_bar',
  });
  draft.signalGraph.strategy.entry.filters = [
    {
      ref: 'missing_node',
    },
  ];

  const result = validateStrategyDraft(draft);

  assert.equal(result.ok, false);
  if (!result.ok) {
    const paths = result.issues.map((issue) => issue.path);
    assert.ok(paths.includes('signalGraph.nodes[2].id'));
    assert.ok(paths.includes('signalGraph.strategy.entry.filters[0]'));
  }
});

test('validateStrategyDraft rejects bool/value/series ref mismatches', () => {
  const draft = createValidDraft();
  draft.signalGraph.nodes.push(
    {
      id: 'scalar_5',
      kind: 'const',
      value: 5,
    },
    {
      id: 'cross_bad',
      kind: 'cross',
      op: 'cross_up',
      left: {
        ref: 'scalar_5',
      },
      right: {
        const: 100,
      },
    },
  );
  draft.signalGraph.strategy.entry.trigger = {
    ref: 'close',
  };

  const result = validateStrategyDraft(draft);

  assert.equal(result.ok, false);
  if (!result.ok) {
    const messages = result.issues.map((issue) => `${issue.path}:${issue.message}`);
    assert.ok(
      messages.some((message) =>
        message.includes('signalGraph.strategy.entry.trigger'),
      ),
    );
    assert.ok(
      messages.some((message) => message.includes('signalGraph.nodes[3].left')),
    );
  }
});

test('validateStrategyDraft enforces capability-derived indicator output contracts', () => {
  const draft = createValidDraft();
  draft.signalGraph.nodes.push({
    id: 'macd_line',
    kind: 'indicator',
    indicator: 'macd',
    args: {
      fast: 12,
      slow: 26,
      output: 'macd',
    },
  });

  const result = validateStrategyDraft(draft, {
    indicators: [
      {
        id: 'macd',
        structuralType: 'oscillator_operand',
        params: [
          {
            name: 'fast',
            type: 'integer',
            required: true,
            minimum: 1,
          },
          {
            name: 'slow',
            type: 'integer',
            required: true,
            minimum: 1,
          },
          {
            name: 'output',
            type: 'enum',
            required: true,
            enumValues: ['macd', 'signal', 'hist'],
          },
        ],
      },
    ],
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    const messages = result.issues.map((issue) => `${issue.path}:${issue.message}`);
    assert.ok(
      messages.some((message) =>
        message.includes('signalGraph.nodes[2].args.output'),
      ),
    );
    assert.ok(
      messages.some((message) => message.includes('signalGraph.nodes[2].output')),
    );
  }
});

test('validateStrategyDraft rejects unsupported indicator output selectors', () => {
  const draft = createValidDraft();
  draft.signalGraph.nodes.push({
    id: 'ema_20',
    kind: 'indicator',
    indicator: 'ema',
    args: {
      period: 20,
    },
    output: 'middle',
  });

  const result = validateStrategyDraft(draft, {
    indicators: [
      {
        id: 'ema',
        structuralType: 'price_indicator_operand',
        params: [
          {
            name: 'period',
            type: 'integer',
            required: true,
            minimum: 1,
          },
        ],
      },
    ],
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(
      result.issues.some(
        (issue) =>
          issue.path === 'signalGraph.nodes[2].output' &&
          issue.message.includes('is not supported'),
      ),
    );
  }
});

test('validateStrategyDraft enforces capability-derived strategy bindings', () => {
  const draft = createValidDraft();

  const result = validateStrategyDraft(draft, {
    signalGraph: {
      bindings: [
        {
          path: 'strategy.entry.setup',
          kind: 'bool_ref',
          required: true,
          cardinality: 'one',
        },
        {
          path: 'strategy.entry.trigger',
          kind: 'bool_ref',
          required: true,
          cardinality: 'one',
        },
      ],
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(
      result.issues.some(
        (issue) =>
          issue.path === 'signalGraph.strategy.entry.setup' &&
          issue.message.includes('required by signalGraph capabilities'),
      ),
    );
  }
});

test('validateStrategyDraft enforces capability-derived node input cardinality and const support', () => {
  const draft = createValidDraft();
  draft.signalGraph.nodes.push({
    id: 'strict_compare',
    kind: 'compare',
    op: 'gt',
    left: {
      ref: 'close',
    },
    right: {
      const: 50,
    },
  });
  draft.signalGraph.strategy.entry.filters = [{ ref: 'strict_compare' }];

  const result = validateStrategyDraft(draft, {
    signalGraph: {
      nodes: [
        {
          kind: 'compare',
          output: 'bool',
          inputs: [
            {
              name: 'left',
              kind: 'value_input',
              required: true,
              cardinality: 'many',
              supportsConst: true,
            },
            {
              name: 'right',
              kind: 'value_input',
              required: true,
              cardinality: 'one',
              supportsConst: false,
            },
          ],
        },
      ],
    },
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(
      result.issues.some(
        (issue) =>
          issue.path === 'signalGraph.nodes[2].left' &&
          issue.message.includes('non-empty array'),
      ),
    );
    assert.ok(
      result.issues.some(
        (issue) =>
          issue.path === 'signalGraph.nodes[2].right' &&
          issue.message.includes('ref object'),
      ),
    );
  }
});
