import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assembleSignalGraphDraft,
  buildStrategyAuthoringPayloadJsonSchema,
  buildStrategyDraftJsonSchema,
  preflightStrategyDraft,
  STRATEGY_AUTHORING_PAYLOAD_JSON_SCHEMA,
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
    assert.equal(
      result.draft.signalGraph.strategy.entry.trigger.ref,
      'trend_ok',
    );
  }
});

test('STRATEGY_DRAFT_JSON_SCHEMA exposes node-level signalGraph union', () => {
  const nodeUnion =
    STRATEGY_DRAFT_JSON_SCHEMA.schema.properties.signalGraph.properties.nodes
      .items.oneOf;

  assert.ok(Array.isArray(nodeUnion));
  assert.equal(nodeUnion.length, 22);
  assert.equal(
    STRATEGY_DRAFT_JSON_SCHEMA.schema.properties.signalGraph.properties.strategy.properties.entry.required.includes(
      'trigger',
    ),
    true,
  );
});

test('STRATEGY_AUTHORING_PAYLOAD_JSON_SCHEMA exposes nested validate_strategy contract', () => {
  const schema = STRATEGY_AUTHORING_PAYLOAD_JSON_SCHEMA.schema;

  assert.deepEqual(schema.required, ['signalGraph', 'settings']);
  assert.equal(
    schema.properties.signalGraph.properties.strategy.properties.entry.properties.action.properties.sizing.required.includes(
      'mode',
    ),
    true,
  );

  const dynamic = buildStrategyAuthoringPayloadJsonSchema({
    indicators: [
      {
        id: 'ema',
        args: [{ name: 'length', type: 'integer', required: true }],
      },
    ],
  });
  const indicatorSchemas =
    dynamic.schema.properties.signalGraph.properties.nodes.items.oneOf.filter(
      (nodeSchema) => nodeSchema.properties.kind.const === 'indicator',
    );
  assert.equal(indicatorSchemas.length, 1);
  assert.equal(indicatorSchemas[0].properties.indicator.const, 'ema');
});

test('preflightStrategyDraft returns flat validation issues', () => {
  const draft = createValidDraft();
  draft.signalGraph.strategy.entry.trigger = { ref: 'close' };

  const result = preflightStrategyDraft(draft);

  assert.equal(result.valid, false);
  assert.equal(result.summary.errors > 0, true);
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.path === 'signalGraph.strategy.entry.trigger' &&
        issue.field === 'signalGraph' &&
        issue.severity === 'error',
    ),
  );
});

test('assembleSignalGraphDraft assembles resolver fragments into a valid draft', () => {
  const result = assembleSignalGraphDraft({
    name: 'Assembled trend',
    fragments: [
      {
        nodes: [
          { id: 'close', kind: 'market', field: 'close' },
          {
            id: 'sma_50',
            kind: 'indicator',
            indicator: 'sma',
            args: { length: 50 },
          },
          {
            id: 'entry_cross',
            kind: 'cross',
            op: 'cross_up',
            left: { ref: 'close' },
            right: { ref: 'sma_50' },
          },
          {
            id: 'exit_signal',
            kind: 'compare',
            op: 'lt',
            left: { ref: 'close' },
            right: { ref: 'sma_50' },
          },
        ],
        assemblyHints: {
          entryTrigger: { ref: 'entry_cross' },
          signalExit: { ref: 'exit_signal' },
          risk: { trailingStop: { distancePercent: 5 } },
        },
      },
    ],
  });

  assert.equal(
    result.valid,
    true,
    result.valid ? undefined : JSON.stringify(result.issues, null, 2),
  );
  assert.equal(
    result.draft.signalGraph.strategy.entry.trigger.ref,
    'entry_cross',
  );
  assert.equal(
    result.draft.signalGraph.strategy.risk.trailingStop.distancePercent,
    5,
  );
});

test('assembleSignalGraphDraft rejects duplicate ids and legacy bindings', () => {
  const result = assembleSignalGraphDraft({
    fragments: [
      {
        nodes: [
          { id: 'same', kind: 'market', field: 'close' },
          { id: 'same', kind: 'market', field: 'open' },
        ],
        bindings: { entryTrigger: { ref: 'same' } },
      },
    ],
  });

  assert.equal(result.valid, false);
  assert.ok(
    result.issues.some((issue) => issue.path === 'fragments[0].bindings'),
  );
  assert.ok(
    result.issues.some((issue) =>
      issue.message.includes('Duplicate signalGraph node id'),
    ),
  );
});

test('buildStrategyDraftJsonSchema derives indicator args from capabilities', () => {
  const dynamicSchema = buildStrategyDraftJsonSchema({
    indicators: [
      {
        id: 'rsi',
        args: [
          {
            name: 'length',
            type: 'integer',
            required: true,
            minimum: 1,
          },
        ],
      },
      {
        id: 'ema',
        args: [
          {
            name: 'length',
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
        args: [
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
        ],
        output: {
          name: 'output',
          type: 'enum',
          required: true,
          enumValues: ['macd', 'signal', 'hist'],
        },
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
  assert.deepEqual(macdSchema.properties.output.enum, [
    'macd',
    'signal',
    'hist',
  ]);
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
    const messages = result.issues.map(
      (issue) => `${issue.path}:${issue.message}`,
    );
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
        args: [
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
        ],
        output: {
          name: 'output',
          type: 'enum',
          required: true,
          enumValues: ['macd', 'signal', 'hist'],
        },
      },
    ],
  });

  assert.equal(result.ok, false);
  if (!result.ok) {
    const messages = result.issues.map(
      (issue) => `${issue.path}:${issue.message}`,
    );
    assert.ok(
      messages.some((message) =>
        message.includes('signalGraph.nodes[2].args.output'),
      ),
    );
    assert.ok(
      messages.some((message) =>
        message.includes('signalGraph.nodes[2].output'),
      ),
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
      length: 20,
    },
    output: 'middle',
  });

  const result = validateStrategyDraft(draft, {
    indicators: [
      {
        id: 'ema',
        structuralType: 'price_indicator_operand',
        args: [
          {
            name: 'length',
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

test('validateStrategyDraft rejects legacy public authoring vocabulary', () => {
  const draft = createValidDraft();
  draft.signalGraph.nodes.push(
    {
      id: 'legacy_price',
      kind: 'price',
      field: 'close',
    },
    {
      id: 'legacy_indicator',
      kind: 'indicator',
      name: 'sma',
      indicator: 'sma',
      params: {
        length: 200,
      },
      source: 'close',
      shift: 1,
      args: {
        period: 200,
      },
    },
    {
      id: 'legacy_event',
      kind: 'event',
      name: 'pivot_confirmed',
      params: {
        pivotKind: 'high',
        left: 5,
        right: 5,
      },
    },
  );
  draft.signalGraph.strategy.entry.conditions = [{ ref: 'trend_ok' }];
  draft.signalGraph.strategy.entry.side = 'long';

  const result = validateStrategyDraft(draft);

  assert.equal(result.ok, false);
  if (!result.ok) {
    const paths = result.issues.map((issue) => issue.path);
    assert.ok(paths.includes('signalGraph.nodes[2].kind'));
    assert.ok(paths.includes('signalGraph.nodes[3].name'));
    assert.ok(paths.includes('signalGraph.nodes[3].params'));
    assert.ok(paths.includes('signalGraph.nodes[3].source'));
    assert.ok(paths.includes('signalGraph.nodes[3].shift'));
    assert.ok(paths.includes('signalGraph.nodes[3].args.period'));
    assert.ok(paths.includes('signalGraph.nodes[4].params'));
    assert.ok(paths.includes('signalGraph.strategy.entry.conditions'));
    assert.ok(paths.includes('signalGraph.strategy.entry.side'));
  }
});
