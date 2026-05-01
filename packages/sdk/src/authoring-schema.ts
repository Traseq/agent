import type {
  StrategyDraft,
  StrategySettings,
  Timeframe,
  TraseqValidationIssue,
  TraseqValidationResponse,
} from './types.js';

const TIMEFRAMES: Timeframe[] = ['15m', '1h', '4h', '1d'];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const ENTRY_SIDES = ['long', 'short'] as const;
const ENTRY_SIZING_MODES = [
  'fixed',
  'fixed_cash',
  'percent_equity',
  'percent_balance',
] as const;
const EXIT_SIZING_MODES = ['fixed', 'percent_position'] as const;
const COMPARE_OPERATORS = ['gt', 'lt', 'gte', 'lte', 'eq', 'neq'] as const;
const CROSS_OPERATORS = ['cross_up', 'cross_down'] as const;
const TOLERANCE_MODES = ['absolute', 'percent'] as const;
const ROLLING_OPERATORS = ['max', 'min', 'sum', 'avg'] as const;
const MATH_OPERATORS = [
  'add',
  'sub',
  'mul',
  'div',
  'abs',
  'min',
  'max',
  'pow',
  'log',
  'sqrt',
] as const;
const ROLLING_WINDOW_MODES = [
  'any',
  'none',
  'all',
  'streak',
  'count_gt',
  'count_lt',
  'count_eq',
] as const;
const CONFLICT_POLICIES = ['set_priority', 'reset_priority'] as const;
const MARKET_FIELDS = [
  'open',
  'high',
  'low',
  'close',
  'hl2',
  'hlc3',
  'ohlc4',
  'typical',
  'median',
  'volume',
] as const;
const STATE_FIELDS = [
  'position_exists',
  'position_unrealized_pnl',
  'position_realized_pnl',
  'position_bars_since_entry',
  'position_bars_since_exit',
  'account_balance',
  'account_equity',
  'account_drawdown',
  'account_max_drawdown',
  'trades_count_total',
  'trades_count_today',
  'wins_streak',
  'losses_streak',
  'last_trade_pnl',
  'last_entry_price',
  'last_exit_price',
  'account_gross_exposure',
  'account_used_margin',
  'account_available_collateral',
  'account_margin_utilization',
] as const;
const BACKTEST_SLIPPAGE_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind'],
      properties: {
        kind: { type: 'string', enum: ['none'] },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'unit', 'value'],
      properties: {
        kind: { type: 'string', enum: ['fixed'] },
        unit: { type: 'string', enum: ['bps', 'ticks'] },
        value: { type: 'number', minimum: 0 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'reference', 'multiplier'],
      properties: {
        kind: { type: 'string', enum: ['volatility_scaled'] },
        reference: { type: 'string', enum: ['atr_pct', 'bar_range_pct'] },
        multiplier: { type: 'number', minimum: 0 },
        atrPeriod: { type: 'integer', minimum: 1, maximum: 200 },
        minBps: { type: 'number', minimum: 0 },
        maxBps: { type: 'number', minimum: 0 },
      },
    },
  ],
} as const;
const PATTERNS = [
  'doji',
  'hammer',
  'shooting_star',
  'bullish_engulfing',
  'bearish_engulfing',
  'morning_star',
  'evening_star',
  'three_white_soldiers',
  'three_black_crows',
  'bullish_harami',
  'bearish_harami',
  'piercing_line',
  'dark_cloud_cover',
  'abandoned_baby',
  'dragonfly_doji',
  'gravestone_doji',
  'tweezers_top',
  'tweezers_bottom',
  'inside_bar',
] as const;
const PIVOT_KINDS = ['high', 'low'] as const;
const PIVOT_SELECTS = ['last', 'prev'] as const;
const PIVOT_META_METRICS = [
  'bars_since_last_pivot',
  'bars_between_last_two_pivots',
  'last_pivot_index',
] as const;
const NODE_KINDS = [
  'const',
  'market',
  'indicator',
  'state',
  'rolling',
  'math',
  'capture',
  'pivot',
  'pivot_meta',
  'all',
  'any',
  'not',
  'compare',
  'cross',
  'between',
  'near',
  'pattern',
  'time_window',
  'sequence',
  'rolling_window',
  'state_machine',
  'event',
] as const;

type NodeKind = (typeof NODE_KINDS)[number];
type RefExpectation = 'bool' | 'value' | 'series';

interface DraftSchemaOk {
  ok: true;
  draft: StrategyDraft;
}

interface DraftSchemaFail {
  ok: false;
  issues: DraftSchemaIssue[];
}

interface NodeInfo {
  output: 'bool' | 'value';
  seriesCapable: boolean;
}

interface RefCheck {
  path: string;
  ref: string;
  expected: RefExpectation;
}

type CapabilityParamType =
  | 'boolean'
  | 'enum'
  | 'integer'
  | 'number'
  | 'object'
  | 'string';

interface CapabilityParamLike {
  name: string;
  type: CapabilityParamType;
  required?: boolean;
  enumValues?: string[];
  minimum?: number;
  maximum?: number;
}

interface IndicatorCapabilityLike {
  id: string;
  structuralType?: string;
  args: CapabilityParamLike[];
  output?: CapabilityParamLike;
}

interface IndicatorCapabilityDescriptor {
  id: string;
  structuralType?: string;
  args: CapabilityParamLike[];
  output?: CapabilityParamLike;
}

type CapabilitySignalInputKind = 'bool_ref' | 'series_ref' | 'value_input';
type CapabilitySignalCardinality = 'one' | 'many';

interface CapabilitySignalInputLike {
  name: string;
  kind: CapabilitySignalInputKind;
  required?: boolean;
  cardinality: CapabilitySignalCardinality;
  supportsConst?: boolean;
}

interface CapabilitySignalBindingLike {
  path: string;
  kind: CapabilitySignalInputKind;
  required?: boolean;
  cardinality: CapabilitySignalCardinality;
}

interface CapabilitySignalNodeLike {
  kind: NodeKind;
  output: 'bool' | 'value';
  inputs: CapabilitySignalInputLike[];
  fields?: CapabilityParamLike[];
  usesIndicatorCatalog?: boolean;
}

export interface DraftSchemaIssue {
  path: string;
  message: string;
  code?: string;
  severity?: 'error' | 'warning';
}

const VALUE_NODE_KINDS = new Set<NodeKind>([
  'const',
  'market',
  'indicator',
  'state',
  'rolling',
  'math',
  'capture',
  'pivot',
  'pivot_meta',
]);

const SERIES_CAPABLE_NODE_KINDS = new Set<NodeKind>([
  'market',
  'indicator',
  'state',
  'rolling',
  'math',
  'capture',
  'pivot',
  'pivot_meta',
]);

function refSchema(description: string) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['ref'],
    description,
    properties: {
      ref: {
        type: 'string',
        minLength: 1,
      },
    },
  };
}

function instrumentSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['symbol'],
    properties: {
      symbol: {
        type: 'string',
        minLength: 1,
      },
    },
  };
}

function enumJsonSchema(values: readonly string[]) {
  return {
    type: 'string',
    enum: [...values],
  };
}

function integerJsonSchema(minimum?: number, maximum?: number) {
  return {
    type: 'integer',
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
  };
}

function numberJsonSchema(
  minimum?: number,
  maximum?: number,
  exclusiveMinimum?: boolean,
) {
  return {
    type: 'number',
    ...(minimum === undefined
      ? {}
      : exclusiveMinimum
        ? { exclusiveMinimum: minimum }
        : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
  };
}

function createNodeJsonSchema(
  kind: NodeKind,
  required: string[],
  properties: Record<string, unknown>,
) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'kind', ...required],
    properties: {
      id: {
        type: 'string',
        minLength: 1,
      },
      kind: {
        type: 'string',
        const: kind,
      },
      label: {
        type: 'string',
      },
      description: {
        type: 'string',
      },
      ...properties,
    },
  };
}

const NODE_REF_JSON_SCHEMA = refSchema('Reference to another signalGraph node');
const BOOL_REF_JSON_SCHEMA = refSchema('Reference to a bool node');
const SERIES_REF_JSON_SCHEMA = refSchema(
  'Reference to a series-capable value node',
);
const CONST_INPUT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['const'],
  properties: {
    const: {
      type: 'number',
    },
  },
};
const VALUE_INPUT_JSON_SCHEMA = {
  anyOf: [NODE_REF_JSON_SCHEMA, CONST_INPUT_JSON_SCHEMA],
};
const TIME_OF_DAY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hour', 'minute'],
  properties: {
    hour: integerJsonSchema(0, 23),
    minute: integerJsonSchema(0, 59),
  },
};
const STRATEGY_META_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: {
      type: 'string',
      minLength: 1,
    },
    tags: {
      type: 'array',
      items: {
        type: 'string',
        minLength: 1,
      },
    },
    source: {
      type: 'object',
      additionalProperties: false,
      properties: {
        editor: {
          type: 'string',
        },
        blockIds: {
          type: 'array',
          items: {
            type: 'string',
            minLength: 1,
          },
        },
      },
    },
  },
};
const BASE_SIGNAL_GRAPH_NODE_JSON_SCHEMAS = [
  createNodeJsonSchema('const', ['value'], {
    value: {
      type: 'number',
    },
  }),
  createNodeJsonSchema('market', ['field'], {
    field: enumJsonSchema(MARKET_FIELDS),
    timeframe: enumJsonSchema(TIMEFRAMES),
    offset: integerJsonSchema(0),
    instrument: instrumentSchema(),
  }),
  createNodeJsonSchema('state', ['field'], {
    field: enumJsonSchema(STATE_FIELDS),
    offset: integerJsonSchema(0),
    instrument: instrumentSchema(),
  }),
  createNodeJsonSchema('rolling', ['op', 'period', 'source'], {
    op: enumJsonSchema(ROLLING_OPERATORS),
    period: integerJsonSchema(1),
    source: VALUE_INPUT_JSON_SCHEMA,
    offset: integerJsonSchema(0),
  }),
  createNodeJsonSchema('math', ['op', 'args'], {
    op: enumJsonSchema(MATH_OPERATORS),
    args: {
      type: 'array',
      minItems: 1,
      items: VALUE_INPUT_JSON_SCHEMA,
    },
  }),
  createNodeJsonSchema('capture', ['value', 'when'], {
    value: VALUE_INPUT_JSON_SCHEMA,
    when: BOOL_REF_JSON_SCHEMA,
    lookback: integerJsonSchema(1),
    offset: integerJsonSchema(0),
  }),
  createNodeJsonSchema('pivot', ['pivotKind', 'left', 'right', 'select'], {
    pivotKind: enumJsonSchema(PIVOT_KINDS),
    left: integerJsonSchema(1),
    right: integerJsonSchema(1),
    select: enumJsonSchema(PIVOT_SELECTS),
    n: integerJsonSchema(1),
    timeframe: enumJsonSchema(TIMEFRAMES),
    offset: integerJsonSchema(0),
  }),
  createNodeJsonSchema('pivot_meta', ['metric', 'pivotKind', 'left', 'right'], {
    metric: enumJsonSchema(PIVOT_META_METRICS),
    pivotKind: enumJsonSchema(PIVOT_KINDS),
    left: integerJsonSchema(1),
    right: integerJsonSchema(1),
    select: enumJsonSchema(PIVOT_SELECTS),
    n: integerJsonSchema(1),
    timeframe: enumJsonSchema(TIMEFRAMES),
    offset: integerJsonSchema(0),
  }),
  createNodeJsonSchema('all', ['items'], {
    items: {
      type: 'array',
      minItems: 1,
      items: BOOL_REF_JSON_SCHEMA,
    },
  }),
  createNodeJsonSchema('any', ['items'], {
    items: {
      type: 'array',
      minItems: 1,
      items: BOOL_REF_JSON_SCHEMA,
    },
  }),
  createNodeJsonSchema('not', ['item'], {
    item: BOOL_REF_JSON_SCHEMA,
  }),
  createNodeJsonSchema('compare', ['op', 'left', 'right'], {
    op: enumJsonSchema(COMPARE_OPERATORS),
    left: VALUE_INPUT_JSON_SCHEMA,
    right: VALUE_INPUT_JSON_SCHEMA,
  }),
  createNodeJsonSchema('cross', ['op', 'left', 'right'], {
    op: enumJsonSchema(CROSS_OPERATORS),
    left: SERIES_REF_JSON_SCHEMA,
    right: VALUE_INPUT_JSON_SCHEMA,
  }),
  createNodeJsonSchema('between', ['value', 'lower', 'upper'], {
    value: VALUE_INPUT_JSON_SCHEMA,
    lower: VALUE_INPUT_JSON_SCHEMA,
    upper: VALUE_INPUT_JSON_SCHEMA,
    inclusiveLower: {
      type: 'boolean',
    },
    inclusiveUpper: {
      type: 'boolean',
    },
  }),
  createNodeJsonSchema('near', ['left', 'right', 'tolerance'], {
    left: VALUE_INPUT_JSON_SCHEMA,
    right: VALUE_INPUT_JSON_SCHEMA,
    tolerance: {
      type: 'object',
      additionalProperties: false,
      required: ['mode', 'value'],
      properties: {
        mode: enumJsonSchema(TOLERANCE_MODES),
        value: numberJsonSchema(0, undefined, true),
      },
    },
  }),
  createNodeJsonSchema('pattern', ['name'], {
    name: enumJsonSchema(PATTERNS),
  }),
  createNodeJsonSchema('time_window', [], {
    timezone: {
      type: 'string',
      minLength: 1,
    },
    weekdays: {
      type: 'array',
      minItems: 1,
      items: enumJsonSchema(WEEKDAYS),
    },
    cadence: {
      type: 'string',
      enum: ['daily', 'weekly', 'monthly'],
    },
    interval: {
      type: 'integer',
      minimum: 1,
    },
    weekday: {
      type: 'integer',
      minimum: 1,
      maximum: 7,
    },
    dayOfMonth: {
      type: 'integer',
      minimum: 1,
      maximum: 31,
    },
    anchorMode: {
      type: 'string',
      enum: ['backtest_start'],
    },
    dates: {
      type: 'object',
      additionalProperties: false,
      required: ['start', 'end'],
      properties: {
        start: {
          type: 'string',
          minLength: 1,
        },
        end: {
          type: 'string',
          minLength: 1,
        },
      },
    },
    between: {
      type: 'object',
      additionalProperties: false,
      required: ['start', 'end'],
      properties: {
        start: TIME_OF_DAY_JSON_SCHEMA,
        end: TIME_OF_DAY_JSON_SCHEMA,
        inclusive: {
          type: 'boolean',
        },
      },
    },
    at: TIME_OF_DAY_JSON_SCHEMA,
  }),
  createNodeJsonSchema('sequence', ['steps'], {
    steps: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['expr'],
        properties: {
          expr: BOOL_REF_JSON_SCHEMA,
          minBars: integerJsonSchema(1),
          maxBars: integerJsonSchema(1),
        },
      },
    },
  }),
  createNodeJsonSchema('rolling_window', ['window', 'mode', 'expr'], {
    window: integerJsonSchema(1),
    mode: enumJsonSchema(ROLLING_WINDOW_MODES),
    expr: BOOL_REF_JSON_SCHEMA,
    value: integerJsonSchema(0),
  }),
  createNodeJsonSchema('state_machine', ['set'], {
    set: BOOL_REF_JSON_SCHEMA,
    reset: BOOL_REF_JSON_SCHEMA,
    ttlBars: integerJsonSchema(1),
    conflictPolicy: enumJsonSchema(CONFLICT_POLICIES),
  }),
  createNodeJsonSchema('event', ['name', 'args'], {
    name: enumJsonSchema(['pivot_confirmed']),
    args: {
      type: 'object',
      additionalProperties: false,
      required: ['pivotKind', 'left', 'right'],
      properties: {
        pivotKind: enumJsonSchema(PIVOT_KINDS),
        left: integerJsonSchema(1),
        right: integerJsonSchema(1),
        timeframe: enumJsonSchema(TIMEFRAMES),
      },
    },
  }),
] as const;

function isCapabilityParamLike(value: unknown): value is CapabilityParamLike {
  return (
    isPlainObject(value) &&
    typeof value.name === 'string' &&
    typeof value.type === 'string'
  );
}

function isCapabilitySignalInputKind(
  value: unknown,
): value is CapabilitySignalInputKind {
  return (
    value === 'bool_ref' || value === 'series_ref' || value === 'value_input'
  );
}

function isCapabilitySignalCardinality(
  value: unknown,
): value is CapabilitySignalCardinality {
  return value === 'one' || value === 'many';
}

function isCapabilitySignalInputLike(
  value: unknown,
): value is CapabilitySignalInputLike {
  return (
    isPlainObject(value) &&
    typeof value.name === 'string' &&
    isCapabilitySignalInputKind(value.kind) &&
    isCapabilitySignalCardinality(value.cardinality) &&
    (value.required === undefined || typeof value.required === 'boolean') &&
    (value.supportsConst === undefined ||
      typeof value.supportsConst === 'boolean')
  );
}

function isCapabilitySignalBindingLike(
  value: unknown,
): value is CapabilitySignalBindingLike {
  return (
    isPlainObject(value) &&
    typeof value.path === 'string' &&
    isCapabilitySignalInputKind(value.kind) &&
    isCapabilitySignalCardinality(value.cardinality) &&
    (value.required === undefined || typeof value.required === 'boolean')
  );
}

function isCapabilitySignalNodeLike(
  value: unknown,
): value is CapabilitySignalNodeLike {
  return (
    isPlainObject(value) &&
    typeof value.kind === 'string' &&
    NODE_KINDS.includes(value.kind as NodeKind) &&
    (value.output === 'bool' || value.output === 'value') &&
    Array.isArray(value.inputs) &&
    value.inputs.every((input) => isCapabilitySignalInputLike(input)) &&
    (value.fields === undefined ||
      (Array.isArray(value.fields) &&
        value.fields.every((param) => isCapabilityParamLike(param)))) &&
    (value.usesIndicatorCatalog === undefined ||
      typeof value.usesIndicatorCatalog === 'boolean')
  );
}

function isIndicatorCapabilityLike(
  value: unknown,
): value is IndicatorCapabilityLike {
  return (
    isPlainObject(value) &&
    typeof value.id === 'string' &&
    (value.structuralType === undefined ||
      typeof value.structuralType === 'string') &&
    Array.isArray(value.args) &&
    value.args.every((param) => isCapabilityParamLike(param)) &&
    (value.output === undefined || isCapabilityParamLike(value.output))
  );
}

function extractIndicatorCapabilities(
  capabilities: unknown,
): IndicatorCapabilityLike[] {
  if (!isPlainObject(capabilities) || !Array.isArray(capabilities.indicators)) {
    return [];
  }

  return capabilities.indicators.filter((item) =>
    isIndicatorCapabilityLike(item),
  );
}

function extractSignalGraphNodeCapabilities(
  capabilities: unknown,
): CapabilitySignalNodeLike[] {
  if (
    !isPlainObject(capabilities) ||
    !isPlainObject(capabilities.signalGraph) ||
    !Array.isArray(capabilities.signalGraph.nodes)
  ) {
    return [];
  }

  return capabilities.signalGraph.nodes.filter((item) =>
    isCapabilitySignalNodeLike(item),
  );
}

function extractSignalGraphBindingCapabilities(
  capabilities: unknown,
): CapabilitySignalBindingLike[] {
  if (
    !isPlainObject(capabilities) ||
    !isPlainObject(capabilities.signalGraph) ||
    !Array.isArray(capabilities.signalGraph.bindings)
  ) {
    return [];
  }

  return capabilities.signalGraph.bindings.filter((item) =>
    isCapabilitySignalBindingLike(item),
  );
}

function buildCapabilityParamJsonSchema(param: CapabilityParamLike) {
  switch (param.type) {
    case 'boolean':
      return {
        type: 'boolean',
      };
    case 'enum':
      return {
        type: 'string',
        ...(Array.isArray(param.enumValues)
          ? { enum: [...param.enumValues] }
          : {}),
      };
    case 'integer':
      return integerJsonSchema(param.minimum, param.maximum);
    case 'number':
      return numberJsonSchema(param.minimum, param.maximum);
    case 'string':
      return {
        type: 'string',
      };
    case 'object':
    default:
      return {
        type: 'object',
        additionalProperties: true,
      };
  }
}

function buildIndicatorArgsJsonSchema(params: CapabilityParamLike[]) {
  const properties = Object.fromEntries(
    params.map((param) => [param.name, buildCapabilityParamJsonSchema(param)]),
  );
  const required = params
    .filter((param) => param.required)
    .map((param) => param.name);

  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length === 0 ? {} : { required }),
  };
}

function describeIndicatorStructuralType(
  structuralType: string | undefined,
): string {
  if (!structuralType) {
    return 'indicator_operand';
  }

  return structuralType;
}

function splitIndicatorCapability(
  indicator: IndicatorCapabilityLike,
): IndicatorCapabilityDescriptor {
  return {
    id: indicator.id,
    args: indicator.args,
    ...(indicator.structuralType === undefined
      ? {}
      : { structuralType: indicator.structuralType }),
    ...(indicator.output === undefined ? {} : { output: indicator.output }),
  };
}

function buildIndicatorOutputJsonSchema(
  outputParam: CapabilityParamLike | undefined,
) {
  if (!outputParam) {
    return undefined;
  }

  if (outputParam.type === 'enum') {
    return {
      type: 'string',
      ...(Array.isArray(outputParam.enumValues)
        ? { enum: [...outputParam.enumValues] }
        : {}),
      description:
        'Indicator output selector. Provide it at node.output, not inside args.',
    };
  }

  return {
    type: 'string',
    minLength: 1,
    description:
      'Indicator output selector. Provide it at node.output, not inside args.',
  };
}

function buildGenericIndicatorNodeJsonSchema() {
  return createNodeJsonSchema('indicator', ['indicator', 'args'], {
    indicator: {
      type: 'string',
      minLength: 1,
    },
    args: {
      type: 'object',
      additionalProperties: true,
    },
    output: {
      type: 'string',
      minLength: 1,
    },
    timeframe: enumJsonSchema(TIMEFRAMES),
    offset: integerJsonSchema(0),
    instrument: instrumentSchema(),
  });
}

function buildIndicatorNodeJsonSchemas(capabilities?: unknown) {
  const indicators = extractIndicatorCapabilities(capabilities);
  if (indicators.length === 0) {
    return [buildGenericIndicatorNodeJsonSchema()];
  }

  return indicators.map((indicator) => {
    const descriptor = splitIndicatorCapability(indicator);
    const outputSchema = buildIndicatorOutputJsonSchema(descriptor.output);

    return {
      ...createNodeJsonSchema(
        'indicator',
        [
          'indicator',
          'args',
          ...(descriptor.output?.required ? ['output'] : []),
        ],
        {
          indicator: {
            type: 'string',
            const: descriptor.id,
            description: `Capability-derived ${describeIndicatorStructuralType(
              descriptor.structuralType,
            )} indicator id.`,
          },
          args: buildIndicatorArgsJsonSchema(descriptor.args),
          ...(outputSchema === undefined ? {} : { output: outputSchema }),
          timeframe: enumJsonSchema(TIMEFRAMES),
          offset: integerJsonSchema(0),
          instrument: instrumentSchema(),
        },
      ),
      description: `Capability-derived indicator node for "${descriptor.id}" (${describeIndicatorStructuralType(
        descriptor.structuralType,
      )}).`,
    };
  });
}

function buildIndicatorCapabilityMap(
  capabilities?: unknown,
): Map<string, IndicatorCapabilityDescriptor> {
  return new Map(
    extractIndicatorCapabilities(capabilities).map((indicator) => {
      const descriptor = splitIndicatorCapability(indicator);
      return [descriptor.id, descriptor] as const;
    }),
  );
}

function buildSignalGraphNodeCapabilityMap(
  capabilities?: unknown,
): Map<NodeKind, CapabilitySignalNodeLike> {
  return new Map(
    extractSignalGraphNodeCapabilities(capabilities).map((nodeSpec) => [
      nodeSpec.kind,
      nodeSpec,
    ]),
  );
}

function normalizeSignalGraphBindingPath(path: string): string {
  return path.startsWith('strategy.') ? path.slice('strategy.'.length) : path;
}

function buildSignalGraphBindingCapabilityMap(
  capabilities?: unknown,
): Map<string, CapabilitySignalBindingLike> {
  return new Map(
    extractSignalGraphBindingCapabilities(capabilities).map((binding) => {
      const normalizedPath = normalizeSignalGraphBindingPath(binding.path);

      return [
        normalizedPath,
        {
          ...binding,
          path: normalizedPath,
        },
      ] as const;
    }),
  );
}

function buildSignalGraphNodeJsonSchemas(capabilities?: unknown) {
  return [
    BASE_SIGNAL_GRAPH_NODE_JSON_SCHEMAS[0],
    BASE_SIGNAL_GRAPH_NODE_JSON_SCHEMAS[1],
    ...buildIndicatorNodeJsonSchemas(capabilities),
    ...BASE_SIGNAL_GRAPH_NODE_JSON_SCHEMAS.slice(2),
  ];
}

export function buildStrategyDraftJsonSchema(capabilities?: unknown) {
  return {
    name: 'traseq_strategy_draft',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'signalGraph', 'settings', 'backtest'],
      properties: {
        name: {
          type: 'string',
          minLength: 1,
        },
        description: {
          type: 'string',
        },
        signalGraph: {
          type: 'object',
          additionalProperties: false,
          required: ['protocol', 'version', 'nodes', 'strategy'],
          properties: {
            protocol: {
              type: 'string',
              const: 'traseq.signal-graph',
            },
            version: {
              type: 'integer',
              const: 2,
            },
            meta: {
              ...STRATEGY_META_JSON_SCHEMA,
            },
            nodes: {
              type: 'array',
              minItems: 1,
              items: {
                oneOf: buildSignalGraphNodeJsonSchemas(capabilities),
              },
            },
            strategy: {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'entry'],
              properties: {
                kind: {
                  type: 'string',
                  const: 'strategy',
                },
                defaults: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    instrument: instrumentSchema(),
                    timeframe: {
                      type: 'string',
                      enum: TIMEFRAMES,
                    },
                    timezone: {
                      type: 'string',
                    },
                    warmupBars: {
                      type: 'integer',
                      minimum: 0,
                    },
                    maxConcurrentPositions: {
                      type: 'integer',
                      minimum: 1,
                    },
                  },
                },
                entry: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['kind', 'trigger', 'action'],
                  properties: {
                    kind: {
                      type: 'string',
                      const: 'entry',
                    },
                    instrument: instrumentSchema(),
                    setup: refSchema('Optional bool reference'),
                    trigger: refSchema('Required bool reference'),
                    filters: {
                      type: 'array',
                      minItems: 1,
                      items: refSchema('Bool reference'),
                    },
                    action: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['side', 'sizing'],
                      properties: {
                        side: {
                          type: 'string',
                          enum: [...ENTRY_SIDES],
                        },
                        sizing: {
                          type: 'object',
                          additionalProperties: false,
                          required: ['mode', 'value'],
                          properties: {
                            mode: {
                              type: 'string',
                              enum: [...ENTRY_SIZING_MODES],
                            },
                            value: {
                              type: 'number',
                              exclusiveMinimum: 0,
                            },
                          },
                        },
                      },
                    },
                  },
                },
                exits: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 1,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['kind', 'when', 'action'],
                    properties: {
                      kind: {
                        type: 'string',
                        const: 'exit',
                      },
                      reason: {
                        type: 'string',
                      },
                      when: refSchema('Required bool reference'),
                      priority: {
                        type: 'integer',
                      },
                      action: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['mode', 'value'],
                        properties: {
                          mode: {
                            type: 'string',
                            enum: [...EXIT_SIZING_MODES],
                          },
                          value: {
                            type: 'number',
                            exclusiveMinimum: 0,
                          },
                        },
                      },
                    },
                  },
                },
                risk: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    stopLoss: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['mode', 'value'],
                      properties: {
                        mode: {
                          type: 'string',
                          const: 'percent',
                        },
                        value: {
                          type: 'number',
                          exclusiveMinimum: 0,
                        },
                      },
                    },
                    takeProfits: {
                      type: 'array',
                      minItems: 1,
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['triggerPercent', 'closePercent'],
                        properties: {
                          triggerPercent: {
                            type: 'number',
                            exclusiveMinimum: 0,
                          },
                          closePercent: {
                            type: 'number',
                            exclusiveMinimum: 0,
                          },
                          closeBasis: {
                            type: 'string',
                            enum: ['initial', 'remaining'],
                          },
                          moveStopToBreakeven: {
                            type: 'boolean',
                          },
                        },
                      },
                    },
                    trailingStop: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['distancePercent'],
                      properties: {
                        distancePercent: {
                          type: 'number',
                          exclusiveMinimum: 0,
                        },
                        activateAfterPercent: {
                          type: 'number',
                          exclusiveMinimum: 0,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        settings: {
          oneOf: [
            {
              type: 'object',
              additionalProperties: false,
              required: ['positionStyle'],
              properties: {
                positionStyle: {
                  const: 'single',
                },
                warmupPeriod: {
                  type: 'integer',
                  minimum: 0,
                },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              required: ['positionStyle', 'maxConcurrentPositions'],
              properties: {
                positionStyle: {
                  const: 'pyramid',
                },
                maxConcurrentPositions: {
                  type: 'integer',
                  minimum: 1,
                  maximum: 100,
                },
                warmupPeriod: {
                  type: 'integer',
                  minimum: 0,
                },
              },
            },
            {
              type: 'object',
              additionalProperties: false,
              required: ['positionStyle', 'accumulation'],
              properties: {
                positionStyle: {
                  const: 'accumulate',
                },
                warmupPeriod: {
                  type: 'integer',
                  minimum: 0,
                },
                accumulation: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['triggerMode'],
                  properties: {
                    triggerMode: {
                      type: 'string',
                      enum: ['scheduled', 'signal', 'scheduled_and_signal'],
                    },
                    schedule: {
                      type: 'object',
                      additionalProperties: false,
                      required: ['cadence'],
                      properties: {
                        cadence: {
                          type: 'string',
                          enum: ['daily', 'weekly', 'monthly'],
                        },
                        interval: {
                          type: 'integer',
                          minimum: 1,
                        },
                        weekday: {
                          type: 'integer',
                          minimum: 1,
                          maximum: 7,
                        },
                        dayOfMonth: {
                          type: 'integer',
                          minimum: 1,
                          maximum: 31,
                        },
                        anchorMode: {
                          type: 'string',
                          enum: ['backtest_start'],
                        },
                      },
                    },
                    maxAdds: {
                      type: 'integer',
                      minimum: 1,
                    },
                    budgetCap: {
                      type: 'number',
                      exclusiveMinimum: 0,
                    },
                    targetAllocationPct: {
                      type: 'number',
                      exclusiveMinimum: 0,
                      maximum: 100,
                    },
                    stopWhenNoCash: {
                      type: 'boolean',
                    },
                  },
                },
              },
            },
          ],
        },
        backtest: {
          type: 'object',
          additionalProperties: false,
          required: ['timeframe', 'signalInstrument'],
          properties: {
            timeframe: {
              type: 'string',
              enum: TIMEFRAMES,
            },
            signalInstrument: instrumentSchema(),
            range: {
              type: 'object',
              additionalProperties: false,
              required: ['start', 'end'],
              properties: {
                start: { type: 'integer' },
                end: { type: 'integer' },
              },
            },
            initialBalance: { type: 'number' },
            execution: {
              type: 'object',
              additionalProperties: false,
              properties: {
                entryOrderRole: {
                  type: 'string',
                  enum: ['maker', 'taker'],
                },
                exitOrderRole: {
                  type: 'string',
                  enum: ['maker', 'taker'],
                },
                riskOrderRole: {
                  type: 'string',
                  enum: ['maker', 'taker'],
                },
                feeModel: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['kind', 'tiers'],
                  properties: {
                    kind: {
                      type: 'string',
                      enum: ['tiered_maker_taker'],
                    },
                    tiers: {
                      type: 'array',
                      items: {
                        type: 'object',
                        additionalProperties: false,
                        required: [
                          'minCumulativeNotional',
                          'makerRate',
                          'takerRate',
                        ],
                        properties: {
                          minCumulativeNotional: {
                            type: 'number',
                            minimum: 0,
                          },
                          makerRate: { type: 'number', minimum: 0, maximum: 1 },
                          takerRate: { type: 'number', minimum: 0, maximum: 1 },
                        },
                      },
                    },
                  },
                },
                slippage: BACKTEST_SLIPPAGE_SCHEMA,
              },
            },
            ambiguityResolution: {
              type: 'string',
              enum: [
                'multi_resolution',
                'pessimistic',
                'bar_direction',
                'distance',
              ],
            },
            ambiguityFallback: {
              type: 'string',
              enum: ['pessimistic', 'bar_direction', 'distance'],
            },
          },
        },
      },
    },
    strict: true,
  } as const;
}

export const STRATEGY_DRAFT_JSON_SCHEMA = buildStrategyDraftJsonSchema();

export function buildStrategyAuthoringPayloadJsonSchema(
  capabilities?: unknown,
) {
  const draftSchema = buildStrategyDraftJsonSchema(capabilities).schema;
  const properties = draftSchema.properties as Record<string, unknown>;

  return {
    name: 'traseq_strategy_authoring_payload',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['signalGraph', 'settings'],
      properties: {
        signalGraph: properties.signalGraph,
        settings: properties.settings,
      },
    },
  };
}

export const STRATEGY_AUTHORING_PAYLOAD_JSON_SCHEMA =
  buildStrategyAuthoringPayloadJsonSchema();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: string[],
): boolean {
  const keys = Object.keys(value);
  return keys.every((key) => allowedKeys.includes(key));
}

function pushIssue(
  issues: DraftSchemaIssue[],
  path: string,
  message: string,
): void {
  issues.push({
    code: 'strategy_draft_schema',
    path,
    message,
    severity: 'error',
  });
}

function issueFieldFromPath(path: string): string {
  if (path.startsWith('signalGraph')) {
    return 'signalGraph';
  }
  if (path.startsWith('settings')) {
    return 'settings';
  }
  if (path.startsWith('backtest')) {
    return 'backtest';
  }
  return path === '$' ? 'request' : path.split('.')[0] || 'request';
}

export function draftSchemaIssuesToValidationIssues(
  issues: readonly DraftSchemaIssue[],
): TraseqValidationIssue[] {
  return issues.map((issue) => ({
    code: issue.code ?? 'strategy_draft_schema',
    path: issue.path,
    field: issueFieldFromPath(issue.path),
    message: issue.message,
    severity: issue.severity ?? 'error',
  }));
}

function validateNonEmptyString(
  path: string,
  value: unknown,
  issues: DraftSchemaIssue[],
): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    pushIssue(issues, path, `${path} must be a non-empty string.`);
    return false;
  }

  return true;
}

function validateOptionalString(
  path: string,
  value: unknown,
  issues: DraftSchemaIssue[],
): void {
  if (
    value !== undefined &&
    (typeof value !== 'string' || value.trim().length === 0)
  ) {
    pushIssue(
      issues,
      path,
      `${path} must be a non-empty string when provided.`,
    );
  }
}

function validateBoolean(
  path: string,
  value: unknown,
  issues: DraftSchemaIssue[],
): void {
  if (typeof value !== 'boolean') {
    pushIssue(issues, path, `${path} must be a boolean.`);
  }
}

function validateFiniteNumber(
  path: string,
  value: unknown,
  issues: DraftSchemaIssue[],
): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    pushIssue(issues, path, `${path} must be a finite number.`);
    return false;
  }

  return true;
}

function validatePositiveNumber(
  path: string,
  value: unknown,
  issues: DraftSchemaIssue[],
): void {
  if (!validateFiniteNumber(path, value, issues)) {
    return;
  }

  if (value <= 0) {
    pushIssue(issues, path, `${path} must be greater than 0.`);
  }
}

function validateInteger(
  path: string,
  value: unknown,
  issues: DraftSchemaIssue[],
): value is number {
  if (!Number.isInteger(value)) {
    pushIssue(issues, path, `${path} must be an integer.`);
    return false;
  }

  return true;
}

function validateIntegerMin(
  path: string,
  value: unknown,
  min: number,
  issues: DraftSchemaIssue[],
): void {
  if (!validateInteger(path, value, issues)) {
    return;
  }

  if (Number(value) < min) {
    pushIssue(issues, path, `${path} must be greater than or equal to ${min}.`);
  }
}

function validateIntegerPositive(
  path: string,
  value: unknown,
  issues: DraftSchemaIssue[],
): void {
  validateIntegerMin(path, value, 1, issues);
}

function validateIntegerRange(
  path: string,
  value: unknown,
  min: number,
  max: number,
  issues: DraftSchemaIssue[],
): void {
  if (!validateInteger(path, value, issues)) {
    return;
  }

  if (Number(value) < min || Number(value) > max) {
    pushIssue(issues, path, `${path} must be between ${min} and ${max}.`);
  }
}

function validateOptionalIntegerMin(
  path: string,
  value: unknown,
  min: number,
  issues: DraftSchemaIssue[],
): void {
  if (value === undefined) {
    return;
  }

  validateIntegerMin(path, value, min, issues);
}

function validateOptionalEnum(
  path: string,
  value: unknown,
  allowed: readonly string[],
  issues: DraftSchemaIssue[],
): void {
  if (value === undefined) {
    return;
  }

  validateEnum(path, value, allowed, issues);
}

function validateEnum(
  path: string,
  value: unknown,
  allowed: readonly string[],
  issues: DraftSchemaIssue[],
): void {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    pushIssue(issues, path, `${path} must be one of: ${allowed.join(', ')}.`);
  }
}

function validateCapabilityParamValue(
  path: string,
  value: unknown,
  param: CapabilityParamLike,
  issues: DraftSchemaIssue[],
): void {
  switch (param.type) {
    case 'boolean':
      validateBoolean(path, value, issues);
      return;
    case 'enum':
      if (Array.isArray(param.enumValues) && param.enumValues.length > 0) {
        validateEnum(path, value, param.enumValues, issues);
        return;
      }
      validateNonEmptyString(path, value, issues);
      return;
    case 'integer':
      if (!validateInteger(path, value, issues)) {
        return;
      }
      if (param.minimum !== undefined && Number(value) < param.minimum) {
        pushIssue(
          issues,
          path,
          `${path} must be greater than or equal to ${param.minimum}.`,
        );
      }
      if (param.maximum !== undefined && Number(value) > param.maximum) {
        pushIssue(
          issues,
          path,
          `${path} must be less than or equal to ${param.maximum}.`,
        );
      }
      return;
    case 'number':
      if (!validateFiniteNumber(path, value, issues)) {
        return;
      }
      if (param.minimum !== undefined && Number(value) < param.minimum) {
        pushIssue(
          issues,
          path,
          `${path} must be greater than or equal to ${param.minimum}.`,
        );
      }
      if (param.maximum !== undefined && Number(value) > param.maximum) {
        pushIssue(
          issues,
          path,
          `${path} must be less than or equal to ${param.maximum}.`,
        );
      }
      return;
    case 'string':
      validateNonEmptyString(path, value, issues);
      return;
    case 'object':
    default:
      if (!isPlainObject(value)) {
        pushIssue(issues, path, `${path} must be an object.`);
      }
  }
}

function validateIndicatorOutputValue(
  path: string,
  value: unknown,
  outputParam: CapabilityParamLike,
  issues: DraftSchemaIssue[],
): void {
  if (outputParam.type === 'enum') {
    if (
      Array.isArray(outputParam.enumValues) &&
      outputParam.enumValues.length > 0
    ) {
      validateEnum(path, value, outputParam.enumValues, issues);
      return;
    }
    validateNonEmptyString(path, value, issues);
    return;
  }

  validateNonEmptyString(path, value, issues);
}

function validateInstrumentRef(
  path: string,
  value: unknown,
  issues: DraftSchemaIssue[],
): void {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, `${path} must be an object.`);
    return;
  }

  if (!hasOnlyKeys(value, ['symbol'])) {
    pushIssue(issues, path, `${path} may only contain "symbol".`);
  }

  validateNonEmptyString(`${path}.symbol`, value.symbol, issues);
}

function validateTimeOfDay(
  path: string,
  value: unknown,
  issues: DraftSchemaIssue[],
): void {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, `${path} must be an object.`);
    return;
  }

  validateIntegerMin(`${path}.hour`, value.hour, 0, issues);
  if (Number.isInteger(value.hour) && Number(value.hour) > 23) {
    pushIssue(
      issues,
      `${path}.hour`,
      `${path}.hour must be less than or equal to 23.`,
    );
  }

  validateIntegerMin(`${path}.minute`, value.minute, 0, issues);
  if (Number.isInteger(value.minute) && Number(value.minute) > 59) {
    pushIssue(
      issues,
      `${path}.minute`,
      `${path}.minute must be less than or equal to 59.`,
    );
  }
}

function collectRef(
  path: string,
  value: unknown,
  expected: RefExpectation,
  refChecks: RefCheck[],
  issues: DraftSchemaIssue[],
): void {
  if (!isPlainObject(value) || !hasOnlyKeys(value, ['ref'])) {
    pushIssue(
      issues,
      path,
      `${path} must be a ref object with shape { ref: string }.`,
    );
    return;
  }

  if (!validateNonEmptyString(`${path}.ref`, value.ref, issues)) {
    return;
  }

  refChecks.push({
    path,
    ref: value.ref,
    expected,
  });
}

function collectValueInput(
  path: string,
  value: unknown,
  refChecks: RefCheck[],
  issues: DraftSchemaIssue[],
): void {
  if (!isPlainObject(value)) {
    pushIssue(
      issues,
      path,
      `${path} must be either { ref: string } or { const: number }.`,
    );
    return;
  }

  if ('ref' in value) {
    if (!hasOnlyKeys(value, ['ref'])) {
      pushIssue(issues, path, `${path} ref input may only contain "ref".`);
      return;
    }

    collectRef(path, value, 'value', refChecks, issues);
    return;
  }

  if ('const' in value) {
    if (!hasOnlyKeys(value, ['const'])) {
      pushIssue(issues, path, `${path} const input may only contain "const".`);
      return;
    }

    validateFiniteNumber(`${path}.const`, value.const, issues);
    return;
  }

  pushIssue(
    issues,
    path,
    `${path} must be either { ref: string } or { const: number }.`,
  );
}

function collectValueRef(
  path: string,
  value: unknown,
  refChecks: RefCheck[],
  issues: DraftSchemaIssue[],
): void {
  collectRef(path, value, 'value', refChecks, issues);
}

function collectCapabilityInputValue(
  path: string,
  value: unknown,
  input: CapabilitySignalInputLike | CapabilitySignalBindingLike,
  refChecks: RefCheck[],
  issues: DraftSchemaIssue[],
): void {
  switch (input.kind) {
    case 'bool_ref':
      collectRef(path, value, 'bool', refChecks, issues);
      return;
    case 'series_ref':
      collectRef(path, value, 'series', refChecks, issues);
      return;
    case 'value_input':
      if ('supportsConst' in input && input.supportsConst === false) {
        collectValueRef(path, value, refChecks, issues);
        return;
      }
      collectValueInput(path, value, refChecks, issues);
      return;
  }
}

function resolveNestedObjectPath(
  rootPath: string,
  rootValue: unknown,
  segments: string[],
): {
  exists: boolean;
  path: string;
  value: unknown;
} {
  let currentValue = rootValue;
  let currentPath = rootPath;

  for (const segment of segments) {
    currentPath = `${currentPath}.${segment}`;

    if (
      segment === '__proto__' ||
      segment === 'constructor' ||
      segment === 'prototype'
    ) {
      return {
        exists: false,
        path: currentPath,
        value: undefined,
      };
    }

    if (!isPlainObject(currentValue)) {
      return {
        exists: false,
        path: currentPath,
        value: undefined,
      };
    }

    if (!Object.prototype.hasOwnProperty.call(currentValue, segment)) {
      return {
        exists: false,
        path: currentPath,
        value: undefined,
      };
    }

    // nosemgrep: prototype-pollution-loop -- guarded above: __proto__/constructor/prototype are rejected, isPlainObject + hasOwnProperty checked
    currentValue = (currentValue as Record<string, unknown>)[segment];
  }

  return {
    exists: true,
    path: currentPath,
    value: currentValue,
  };
}

function validateCapabilityResolvedValue(
  path: string,
  value: unknown,
  cardinality: CapabilitySignalCardinality,
  spec: CapabilitySignalInputLike | CapabilitySignalBindingLike,
  refChecks: RefCheck[],
  issues: DraftSchemaIssue[],
): void {
  if (cardinality === 'many') {
    if (!Array.isArray(value) || value.length === 0) {
      pushIssue(issues, path, `${path} must be a non-empty array.`);
      return;
    }

    value.forEach((item, index) => {
      collectCapabilityInputValue(
        `${path}[${index}]`,
        item,
        spec,
        refChecks,
        issues,
      );
    });
    return;
  }

  collectCapabilityInputValue(path, value, spec, refChecks, issues);
}

function validateCapabilityPathSpec(
  rootPath: string,
  rootValue: unknown,
  specPath: string,
  spec: CapabilitySignalInputLike | CapabilitySignalBindingLike,
  refChecks: RefCheck[],
  issues: DraftSchemaIssue[],
): void {
  const allArrayMatch = /^(?<property>[A-Za-z0-9_]+)\[\]\.(?<rest>.+)$/.exec(
    specPath,
  );
  if (allArrayMatch?.groups) {
    const property = allArrayMatch.groups.property;
    const rest = allArrayMatch.groups.rest;
    if (!property || !rest) {
      return;
    }
    const container = resolveNestedObjectPath(rootPath, rootValue, [property]);

    if (!container.exists) {
      if (spec.required) {
        pushIssue(
          issues,
          container.path,
          `${container.path} is required by signalGraph capabilities.`,
        );
      }
      return;
    }

    if (!Array.isArray(container.value) || container.value.length === 0) {
      pushIssue(
        issues,
        container.path,
        `${container.path} must be a non-empty array.`,
      );
      return;
    }

    container.value.forEach((item, index) => {
      const resolved = resolveNestedObjectPath(
        `${container.path}[${index}]`,
        item,
        rest.split('.'),
      );

      if (!resolved.exists) {
        if (spec.required) {
          pushIssue(
            issues,
            resolved.path,
            `${resolved.path} is required by signalGraph capabilities.`,
          );
        }
        return;
      }

      validateCapabilityResolvedValue(
        resolved.path,
        resolved.value,
        'one',
        spec,
        refChecks,
        issues,
      );
    });
    return;
  }

  const fixedIndexMatch =
    /^(?<property>[A-Za-z0-9_]+)\[(?<index>\d+)\](?:\.(?<rest>.+))?$/.exec(
      specPath,
    );
  if (fixedIndexMatch?.groups) {
    const property = fixedIndexMatch.groups.property;
    const rawIndex = fixedIndexMatch.groups.index;
    const rest = fixedIndexMatch.groups.rest;
    if (!property || !rawIndex) {
      return;
    }
    const index = Number(rawIndex);
    const container = resolveNestedObjectPath(rootPath, rootValue, [property]);
    const indexedPath = `${container.path}[${index}]`;

    if (!container.exists) {
      if (spec.required) {
        pushIssue(
          issues,
          rest ? `${indexedPath}.${rest}` : indexedPath,
          `${rest ? `${indexedPath}.${rest}` : indexedPath} is required by signalGraph capabilities.`,
        );
      }
      return;
    }

    if (!Array.isArray(container.value) || container.value.length <= index) {
      if (spec.required) {
        pushIssue(
          issues,
          rest ? `${indexedPath}.${rest}` : indexedPath,
          `${rest ? `${indexedPath}.${rest}` : indexedPath} is required by signalGraph capabilities.`,
        );
      }
      return;
    }

    const item = container.value[index];
    const resolved = rest
      ? resolveNestedObjectPath(indexedPath, item, rest.split('.'))
      : { exists: true, path: indexedPath, value: item };

    if (!resolved.exists) {
      if (spec.required) {
        pushIssue(
          issues,
          resolved.path,
          `${resolved.path} is required by signalGraph capabilities.`,
        );
      }
      return;
    }

    validateCapabilityResolvedValue(
      resolved.path,
      resolved.value,
      spec.cardinality,
      spec,
      refChecks,
      issues,
    );
    return;
  }

  const resolved = resolveNestedObjectPath(
    rootPath,
    rootValue,
    specPath.split('.'),
  );
  if (!resolved.exists) {
    if (spec.required) {
      pushIssue(
        issues,
        resolved.path,
        `${resolved.path} is required by signalGraph capabilities.`,
      );
    }
    return;
  }

  validateCapabilityResolvedValue(
    resolved.path,
    resolved.value,
    spec.cardinality,
    spec,
    refChecks,
    issues,
  );
}

function getNodeInfo(
  kind: NodeKind,
  nodeCapabilities?: Map<NodeKind, CapabilitySignalNodeLike>,
): NodeInfo {
  const capability = nodeCapabilities?.get(kind);
  return {
    output:
      capability?.output ?? (VALUE_NODE_KINDS.has(kind) ? 'value' : 'bool'),
    seriesCapable: SERIES_CAPABLE_NODE_KINDS.has(kind),
  };
}

function validateNodeInputsFromCapabilities(
  path: string,
  node: Record<string, unknown>,
  capability: CapabilitySignalNodeLike | undefined,
  refChecks: RefCheck[],
  issues: DraftSchemaIssue[],
): void {
  if (!capability) {
    return;
  }

  capability.inputs.forEach((input) => {
    validateCapabilityPathSpec(
      path,
      node,
      input.name,
      input,
      refChecks,
      issues,
    );
  });
}

const LEGACY_NODE_KINDS: Record<string, string> = {
  price: 'Use kind: "market" with a field such as "close".',
};

function validateNodeBase(
  path: string,
  node: Record<string, unknown>,
  issues: DraftSchemaIssue[],
): NodeKind | null {
  validateNonEmptyString(`${path}.id`, node.id, issues);
  validateOptionalString(`${path}.label`, node.label, issues);
  validateOptionalString(`${path}.description`, node.description, issues);

  if (
    typeof node.kind !== 'string' ||
    !NODE_KINDS.includes(node.kind as NodeKind)
  ) {
    pushIssue(
      issues,
      `${path}.kind`,
      `${path}.kind must be one of: ${NODE_KINDS.join(', ')}.`,
    );
    return null;
  }

  return node.kind as NodeKind;
}

/**
 * Single source of truth for legacy public-authoring vocabulary the agent /
 * SDK no longer accepts. Runs *before* `validateNodeBase` so legacy kinds
 * surface a precise migration message instead of a generic "kind must be
 * one of" enum error.
 *
 * Returns true when a legacy kind was matched so the caller can short-circuit.
 */
function validateNoLegacyNodeFields(
  path: string,
  node: Record<string, unknown>,
  issues: DraftSchemaIssue[],
): boolean {
  let legacyKindMatched = false;

  if (typeof node.kind === 'string' && node.kind in LEGACY_NODE_KINDS) {
    pushIssue(
      issues,
      `${path}.kind`,
      `${path}.kind is not supported. ${LEGACY_NODE_KINDS[node.kind]}`,
    );
    legacyKindMatched = true;
  }

  if ('shift' in node) {
    pushIssue(
      issues,
      `${path}.shift`,
      `${path}.shift is not supported. Use ${path}.offset for historical bars.`,
    );
  }

  if (node.kind !== 'indicator') {
    if (node.kind === 'event' && 'params' in node) {
      pushIssue(
        issues,
        `${path}.params`,
        `${path}.params is not supported on event nodes. Use ${path}.args.`,
      );
    }
    return legacyKindMatched;
  }

  if ('name' in node) {
    pushIssue(
      issues,
      `${path}.name`,
      `${path}.name is not supported on indicator nodes. Use ${path}.indicator.`,
    );
  }

  if ('params' in node) {
    pushIssue(
      issues,
      `${path}.params`,
      `${path}.params is not supported on indicator nodes. Use ${path}.args.`,
    );
  }

  if ('source' in node) {
    pushIssue(
      issues,
      `${path}.source`,
      `${path}.source is not supported on indicator nodes. Put source inside ${path}.args.source.`,
    );
  }

  if (isPlainObject(node.args) && 'period' in node.args) {
    pushIssue(
      issues,
      `${path}.args.period`,
      `${path}.args.period is not supported for indicator lookbacks. Use ${path}.args.length.`,
    );
  }

  return legacyKindMatched;
}

function validateStrategyDefaults(
  path: string,
  value: unknown,
  issues: DraftSchemaIssue[],
): void {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, `${path} must be an object.`);
    return;
  }

  if (value.instrument !== undefined) {
    validateInstrumentRef(`${path}.instrument`, value.instrument, issues);
  }

  validateOptionalEnum(
    `${path}.timeframe`,
    value.timeframe,
    TIMEFRAMES,
    issues,
  );
  validateOptionalString(`${path}.timezone`, value.timezone, issues);
  validateOptionalIntegerMin(`${path}.warmupBars`, value.warmupBars, 0, issues);
  validateOptionalIntegerMin(
    `${path}.maxConcurrentPositions`,
    value.maxConcurrentPositions,
    1,
    issues,
  );
}

function validateRisk(
  path: string,
  value: unknown,
  issues: DraftSchemaIssue[],
): void {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, `${path} must be an object.`);
    return;
  }

  if (value.stopLoss !== undefined) {
    if (!isPlainObject(value.stopLoss)) {
      pushIssue(
        issues,
        `${path}.stopLoss`,
        `${path}.stopLoss must be an object.`,
      );
    } else {
      validateEnum(
        `${path}.stopLoss.mode`,
        value.stopLoss.mode,
        ['percent'],
        issues,
      );
      validatePositiveNumber(
        `${path}.stopLoss.value`,
        value.stopLoss.value,
        issues,
      );
    }
  }

  if (value.takeProfits !== undefined) {
    if (!Array.isArray(value.takeProfits) || value.takeProfits.length === 0) {
      pushIssue(
        issues,
        `${path}.takeProfits`,
        `${path}.takeProfits must be a non-empty array.`,
      );
    } else {
      value.takeProfits.forEach((item, index) => {
        const itemPath = `${path}.takeProfits[${index}]`;
        if (!isPlainObject(item)) {
          pushIssue(issues, itemPath, `${itemPath} must be an object.`);
          return;
        }

        validatePositiveNumber(
          `${itemPath}.triggerPercent`,
          item.triggerPercent,
          issues,
        );
        validatePositiveNumber(
          `${itemPath}.closePercent`,
          item.closePercent,
          issues,
        );
        validateOptionalEnum(
          `${itemPath}.closeBasis`,
          item.closeBasis,
          ['initial', 'remaining'],
          issues,
        );
        if (item.moveStopToBreakeven !== undefined) {
          validateBoolean(
            `${itemPath}.moveStopToBreakeven`,
            item.moveStopToBreakeven,
            issues,
          );
        }
      });
    }
  }

  if (value.trailingStop !== undefined) {
    if (!isPlainObject(value.trailingStop)) {
      pushIssue(
        issues,
        `${path}.trailingStop`,
        `${path}.trailingStop must be an object.`,
      );
    } else {
      validatePositiveNumber(
        `${path}.trailingStop.distancePercent`,
        value.trailingStop.distancePercent,
        issues,
      );
      if (value.trailingStop.activateAfterPercent !== undefined) {
        validatePositiveNumber(
          `${path}.trailingStop.activateAfterPercent`,
          value.trailingStop.activateAfterPercent,
          issues,
        );
      }
    }
  }
}

function validateStrategyNode(
  path: string,
  value: unknown,
  refChecks: RefCheck[],
  issues: DraftSchemaIssue[],
  bindingCapabilities: Map<string, CapabilitySignalBindingLike>,
): void {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, `${path} must be an object.`);
    return;
  }

  validateEnum(`${path}.kind`, value.kind, ['strategy'], issues);

  if (value.defaults !== undefined) {
    validateStrategyDefaults(`${path}.defaults`, value.defaults, issues);
  }

  if (!isPlainObject(value.entry)) {
    pushIssue(issues, `${path}.entry`, `${path}.entry must be an object.`);
  } else {
    validateEnum(`${path}.entry.kind`, value.entry.kind, ['entry'], issues);

    if ('conditions' in value.entry) {
      pushIssue(
        issues,
        `${path}.entry.conditions`,
        `${path}.entry.conditions is not supported. Combine bool nodes with all/any and reference the result from ${path}.entry.trigger.`,
      );
    }

    if ('side' in value.entry) {
      pushIssue(
        issues,
        `${path}.entry.side`,
        `${path}.entry.side is not supported. Use ${path}.entry.action.side.`,
      );
    }

    if (value.entry.instrument !== undefined) {
      validateInstrumentRef(
        `${path}.entry.instrument`,
        value.entry.instrument,
        issues,
      );
    }

    const setupBinding = bindingCapabilities.get('entry.setup');
    const triggerBinding = bindingCapabilities.get('entry.trigger');
    const filtersBinding = bindingCapabilities.get('entry.filters');

    if (setupBinding) {
      validateCapabilityPathSpec(
        path,
        value,
        setupBinding.path,
        setupBinding,
        refChecks,
        issues,
      );
    } else if (value.entry.setup !== undefined) {
      collectRef(
        `${path}.entry.setup`,
        value.entry.setup,
        'bool',
        refChecks,
        issues,
      );
    }

    if (triggerBinding) {
      validateCapabilityPathSpec(
        path,
        value,
        triggerBinding.path,
        triggerBinding,
        refChecks,
        issues,
      );
    } else {
      collectRef(
        `${path}.entry.trigger`,
        value.entry.trigger,
        'bool',
        refChecks,
        issues,
      );
    }

    if (filtersBinding) {
      validateCapabilityPathSpec(
        path,
        value,
        filtersBinding.path,
        filtersBinding,
        refChecks,
        issues,
      );
    } else if (value.entry.filters !== undefined) {
      if (
        !Array.isArray(value.entry.filters) ||
        value.entry.filters.length === 0
      ) {
        pushIssue(
          issues,
          `${path}.entry.filters`,
          `${path}.entry.filters must be a non-empty array.`,
        );
      } else {
        value.entry.filters.forEach((item, index) => {
          collectRef(
            `${path}.entry.filters[${index}]`,
            item,
            'bool',
            refChecks,
            issues,
          );
        });
      }
    }

    if (!isPlainObject(value.entry.action)) {
      pushIssue(
        issues,
        `${path}.entry.action`,
        `${path}.entry.action must be an object.`,
      );
    } else {
      validateEnum(
        `${path}.entry.action.side`,
        value.entry.action.side,
        ENTRY_SIDES,
        issues,
      );

      if (!isPlainObject(value.entry.action.sizing)) {
        pushIssue(
          issues,
          `${path}.entry.action.sizing`,
          `${path}.entry.action.sizing must be an object.`,
        );
      } else {
        validateEnum(
          `${path}.entry.action.sizing.mode`,
          value.entry.action.sizing.mode,
          ENTRY_SIZING_MODES,
          issues,
        );
        validatePositiveNumber(
          `${path}.entry.action.sizing.value`,
          value.entry.action.sizing.value,
          issues,
        );
      }
    }
  }

  if (value.exits !== undefined) {
    if (!Array.isArray(value.exits) || value.exits.length !== 1) {
      pushIssue(
        issues,
        `${path}.exits`,
        `${path}.exits must be an array with exactly one exit.`,
      );
    } else {
      const exit = value.exits[0];
      const exitPath = `${path}.exits[0]`;
      if (!isPlainObject(exit)) {
        pushIssue(issues, exitPath, `${exitPath} must be an object.`);
      } else {
        validateEnum(`${exitPath}.kind`, exit.kind, ['exit'], issues);
        validateOptionalString(`${exitPath}.reason`, exit.reason, issues);
        const exitWhenBinding = bindingCapabilities.get('exits[0].when');
        if (exitWhenBinding) {
          validateCapabilityPathSpec(
            path,
            value,
            exitWhenBinding.path,
            exitWhenBinding,
            refChecks,
            issues,
          );
        } else {
          collectRef(`${exitPath}.when`, exit.when, 'bool', refChecks, issues);
        }
        validateOptionalIntegerMin(
          `${exitPath}.priority`,
          exit.priority,
          0,
          issues,
        );

        if (!isPlainObject(exit.action)) {
          pushIssue(
            issues,
            `${exitPath}.action`,
            `${exitPath}.action must be an object.`,
          );
        } else {
          validateEnum(
            `${exitPath}.action.mode`,
            exit.action.mode,
            EXIT_SIZING_MODES,
            issues,
          );
          validatePositiveNumber(
            `${exitPath}.action.value`,
            exit.action.value,
            issues,
          );
        }
      }
    }
  }

  if (value.risk !== undefined) {
    validateRisk(`${path}.risk`, value.risk, issues);
  }
}

function validateNode(
  path: string,
  node: unknown,
  refChecks: RefCheck[],
  issues: DraftSchemaIssue[],
  indicatorCapabilities: Map<string, IndicatorCapabilityDescriptor>,
  nodeCapabilities: Map<NodeKind, CapabilitySignalNodeLike>,
): NodeInfo | null {
  if (!isPlainObject(node)) {
    pushIssue(issues, path, `${path} must be an object.`);
    return null;
  }

  const legacyKindMatched = validateNoLegacyNodeFields(path, node, issues);
  if (legacyKindMatched) {
    return null;
  }
  const kind = validateNodeBase(path, node, issues);
  if (!kind) {
    return null;
  }
  const nodeCapability = nodeCapabilities.get(kind);

  switch (kind) {
    case 'const':
      validateFiniteNumber(`${path}.value`, node.value, issues);
      break;
    case 'market':
      validateEnum(`${path}.field`, node.field, MARKET_FIELDS, issues);
      validateOptionalEnum(
        `${path}.timeframe`,
        node.timeframe,
        TIMEFRAMES,
        issues,
      );
      validateOptionalIntegerMin(`${path}.offset`, node.offset, 0, issues);
      if (node.instrument !== undefined) {
        validateInstrumentRef(`${path}.instrument`, node.instrument, issues);
      }
      break;
    case 'indicator':
      validateNonEmptyString(`${path}.indicator`, node.indicator, issues);
      if (!isPlainObject(node.args)) {
        pushIssue(issues, `${path}.args`, `${path}.args must be an object.`);
      } else if (
        indicatorCapabilities.size > 0 &&
        typeof node.indicator === 'string'
      ) {
        const indicatorArgs = node.args;
        const indicator = indicatorCapabilities.get(node.indicator);

        if (!indicator) {
          pushIssue(
            issues,
            `${path}.indicator`,
            `${path}.indicator must be one of the capability catalog indicators.`,
          );
        } else {
          if ('output' in indicatorArgs) {
            pushIssue(
              issues,
              `${path}.args.output`,
              `${path}.args.output is not supported. Use ${path}.output instead.`,
            );
          }

          const allowedArgNames = new Set(
            indicator.args.map((param) => param.name),
          );
          Object.keys(indicatorArgs).forEach((key) => {
            if (!allowedArgNames.has(key)) {
              pushIssue(
                issues,
                `${path}.args.${key}`,
                `${path}.args.${key} is not supported for indicator "${indicator.id}".`,
              );
            }
          });

          indicator.args.forEach((param) => {
            const argValue = indicatorArgs[param.name];

            if (argValue === undefined) {
              if (param.required) {
                pushIssue(
                  issues,
                  `${path}.args.${param.name}`,
                  `${path}.args.${param.name} is required for indicator "${indicator.id}".`,
                );
              }
              return;
            }

            validateCapabilityParamValue(
              `${path}.args.${param.name}`,
              argValue,
              param,
              issues,
            );
          });

          if (indicator.output) {
            if (node.output === undefined) {
              if (indicator.output.required) {
                pushIssue(
                  issues,
                  `${path}.output`,
                  `${path}.output is required for indicator "${indicator.id}".`,
                );
              }
            } else {
              validateIndicatorOutputValue(
                `${path}.output`,
                node.output,
                indicator.output,
                issues,
              );
            }
          } else if (node.output !== undefined) {
            pushIssue(
              issues,
              `${path}.output`,
              `${path}.output is not supported for indicator "${indicator.id}".`,
            );
          }
        }
      }
      if (indicatorCapabilities.size === 0) {
        validateOptionalString(`${path}.output`, node.output, issues);
      }
      validateOptionalEnum(
        `${path}.timeframe`,
        node.timeframe,
        TIMEFRAMES,
        issues,
      );
      validateOptionalIntegerMin(`${path}.offset`, node.offset, 0, issues);
      if (node.instrument !== undefined) {
        validateInstrumentRef(`${path}.instrument`, node.instrument, issues);
      }
      break;
    case 'state':
      validateEnum(`${path}.field`, node.field, STATE_FIELDS, issues);
      validateOptionalIntegerMin(`${path}.offset`, node.offset, 0, issues);
      if (node.instrument !== undefined) {
        validateInstrumentRef(`${path}.instrument`, node.instrument, issues);
      }
      break;
    case 'rolling':
      validateEnum(`${path}.op`, node.op, ROLLING_OPERATORS, issues);
      validateIntegerPositive(`${path}.period`, node.period, issues);
      if (nodeCapability) {
        validateNodeInputsFromCapabilities(
          path,
          node,
          nodeCapability,
          refChecks,
          issues,
        );
      } else {
        collectValueInput(`${path}.source`, node.source, refChecks, issues);
      }
      validateOptionalIntegerMin(`${path}.offset`, node.offset, 0, issues);
      break;
    case 'math':
      validateEnum(`${path}.op`, node.op, MATH_OPERATORS, issues);
      if (nodeCapability) {
        validateNodeInputsFromCapabilities(
          path,
          node,
          nodeCapability,
          refChecks,
          issues,
        );
      } else if (!Array.isArray(node.args) || node.args.length === 0) {
        pushIssue(
          issues,
          `${path}.args`,
          `${path}.args must be a non-empty array.`,
        );
      } else {
        node.args.forEach((item, index) => {
          collectValueInput(`${path}.args[${index}]`, item, refChecks, issues);
        });
      }
      break;
    case 'capture':
      if (nodeCapability) {
        validateNodeInputsFromCapabilities(
          path,
          node,
          nodeCapability,
          refChecks,
          issues,
        );
      } else {
        collectValueInput(`${path}.value`, node.value, refChecks, issues);
        collectRef(`${path}.when`, node.when, 'bool', refChecks, issues);
      }
      validateOptionalIntegerMin(`${path}.lookback`, node.lookback, 1, issues);
      validateOptionalIntegerMin(`${path}.offset`, node.offset, 0, issues);
      break;
    case 'pivot':
      validateEnum(`${path}.pivotKind`, node.pivotKind, PIVOT_KINDS, issues);
      validateIntegerPositive(`${path}.left`, node.left, issues);
      validateIntegerPositive(`${path}.right`, node.right, issues);
      validateEnum(`${path}.select`, node.select, PIVOT_SELECTS, issues);
      validateOptionalIntegerMin(`${path}.n`, node.n, 1, issues);
      validateOptionalEnum(
        `${path}.timeframe`,
        node.timeframe,
        TIMEFRAMES,
        issues,
      );
      validateOptionalIntegerMin(`${path}.offset`, node.offset, 0, issues);
      break;
    case 'pivot_meta':
      validateEnum(`${path}.metric`, node.metric, PIVOT_META_METRICS, issues);
      validateEnum(`${path}.pivotKind`, node.pivotKind, PIVOT_KINDS, issues);
      validateIntegerPositive(`${path}.left`, node.left, issues);
      validateIntegerPositive(`${path}.right`, node.right, issues);
      validateOptionalEnum(
        `${path}.select`,
        node.select,
        PIVOT_SELECTS,
        issues,
      );
      validateOptionalIntegerMin(`${path}.n`, node.n, 1, issues);
      validateOptionalEnum(
        `${path}.timeframe`,
        node.timeframe,
        TIMEFRAMES,
        issues,
      );
      validateOptionalIntegerMin(`${path}.offset`, node.offset, 0, issues);
      break;
    case 'all':
    case 'any':
      if (nodeCapability) {
        validateNodeInputsFromCapabilities(
          path,
          node,
          nodeCapability,
          refChecks,
          issues,
        );
      } else if (!Array.isArray(node.items) || node.items.length === 0) {
        pushIssue(
          issues,
          `${path}.items`,
          `${path}.items must be a non-empty array.`,
        );
      } else {
        node.items.forEach((item, index) => {
          collectRef(
            `${path}.items[${index}]`,
            item,
            'bool',
            refChecks,
            issues,
          );
        });
      }
      break;
    case 'not':
      if (nodeCapability) {
        validateNodeInputsFromCapabilities(
          path,
          node,
          nodeCapability,
          refChecks,
          issues,
        );
      } else {
        collectRef(`${path}.item`, node.item, 'bool', refChecks, issues);
      }
      break;
    case 'compare':
      validateEnum(`${path}.op`, node.op, COMPARE_OPERATORS, issues);
      if (nodeCapability) {
        validateNodeInputsFromCapabilities(
          path,
          node,
          nodeCapability,
          refChecks,
          issues,
        );
      } else {
        collectValueInput(`${path}.left`, node.left, refChecks, issues);
        collectValueInput(`${path}.right`, node.right, refChecks, issues);
      }
      break;
    case 'cross':
      validateEnum(`${path}.op`, node.op, CROSS_OPERATORS, issues);
      if (nodeCapability) {
        validateNodeInputsFromCapabilities(
          path,
          node,
          nodeCapability,
          refChecks,
          issues,
        );
      } else {
        collectRef(`${path}.left`, node.left, 'series', refChecks, issues);
        collectValueInput(`${path}.right`, node.right, refChecks, issues);
      }
      break;
    case 'between':
      if (nodeCapability) {
        validateNodeInputsFromCapabilities(
          path,
          node,
          nodeCapability,
          refChecks,
          issues,
        );
      } else {
        collectValueInput(`${path}.value`, node.value, refChecks, issues);
        collectValueInput(`${path}.lower`, node.lower, refChecks, issues);
        collectValueInput(`${path}.upper`, node.upper, refChecks, issues);
      }
      if (node.inclusiveLower !== undefined) {
        validateBoolean(`${path}.inclusiveLower`, node.inclusiveLower, issues);
      }
      if (node.inclusiveUpper !== undefined) {
        validateBoolean(`${path}.inclusiveUpper`, node.inclusiveUpper, issues);
      }
      break;
    case 'near':
      if (nodeCapability) {
        validateNodeInputsFromCapabilities(
          path,
          node,
          nodeCapability,
          refChecks,
          issues,
        );
      } else {
        collectValueInput(`${path}.left`, node.left, refChecks, issues);
        collectValueInput(`${path}.right`, node.right, refChecks, issues);
      }
      if (!isPlainObject(node.tolerance)) {
        pushIssue(
          issues,
          `${path}.tolerance`,
          `${path}.tolerance must be an object.`,
        );
      } else {
        validateEnum(
          `${path}.tolerance.mode`,
          node.tolerance.mode,
          TOLERANCE_MODES,
          issues,
        );
        validatePositiveNumber(
          `${path}.tolerance.value`,
          node.tolerance.value,
          issues,
        );
      }
      break;
    case 'pattern':
      validateEnum(`${path}.name`, node.name, PATTERNS, issues);
      break;
    case 'time_window':
      validateOptionalString(`${path}.timezone`, node.timezone, issues);
      if (node.weekdays !== undefined) {
        if (!Array.isArray(node.weekdays) || node.weekdays.length === 0) {
          pushIssue(
            issues,
            `${path}.weekdays`,
            `${path}.weekdays must be a non-empty array.`,
          );
        } else {
          node.weekdays.forEach((day, index) => {
            validateEnum(`${path}.weekdays[${index}]`, day, WEEKDAYS, issues);
          });
        }
      }
      if (node.cadence !== undefined) {
        validateEnum(
          `${path}.cadence`,
          node.cadence,
          ['daily', 'weekly', 'monthly'] as const,
          issues,
        );
      }
      validateOptionalIntegerMin(`${path}.interval`, node.interval, 1, issues);
      if (node.weekday !== undefined) {
        validateIntegerRange(`${path}.weekday`, node.weekday, 1, 7, issues);
      }
      if (node.dayOfMonth !== undefined) {
        validateIntegerRange(
          `${path}.dayOfMonth`,
          node.dayOfMonth,
          1,
          31,
          issues,
        );
      }
      if (node.anchorMode !== undefined) {
        validateEnum(
          `${path}.anchorMode`,
          node.anchorMode,
          ['backtest_start'] as const,
          issues,
        );
      }
      if (node.dates !== undefined) {
        if (!isPlainObject(node.dates)) {
          pushIssue(
            issues,
            `${path}.dates`,
            `${path}.dates must be an object.`,
          );
        } else {
          validateNonEmptyString(
            `${path}.dates.start`,
            node.dates.start,
            issues,
          );
          validateNonEmptyString(`${path}.dates.end`, node.dates.end, issues);
        }
      }
      if (node.between !== undefined) {
        if (!isPlainObject(node.between)) {
          pushIssue(
            issues,
            `${path}.between`,
            `${path}.between must be an object.`,
          );
        } else {
          validateTimeOfDay(
            `${path}.between.start`,
            node.between.start,
            issues,
          );
          validateTimeOfDay(`${path}.between.end`, node.between.end, issues);
          if (node.between.inclusive !== undefined) {
            validateBoolean(
              `${path}.between.inclusive`,
              node.between.inclusive,
              issues,
            );
          }
        }
      }
      if (node.at !== undefined) {
        validateTimeOfDay(`${path}.at`, node.at, issues);
      }
      break;
    case 'sequence':
      if (!Array.isArray(node.steps) || node.steps.length === 0) {
        if (!nodeCapability) {
          pushIssue(
            issues,
            `${path}.steps`,
            `${path}.steps must be a non-empty array.`,
          );
        }
      } else {
        node.steps.forEach((step, index) => {
          const stepPath = `${path}.steps[${index}]`;
          if (!isPlainObject(step)) {
            pushIssue(issues, stepPath, `${stepPath} must be an object.`);
            return;
          }
          if (!nodeCapability) {
            collectRef(
              `${stepPath}.expr`,
              step.expr,
              'bool',
              refChecks,
              issues,
            );
          }
          validateOptionalIntegerMin(
            `${stepPath}.minBars`,
            step.minBars,
            1,
            issues,
          );
          validateOptionalIntegerMin(
            `${stepPath}.maxBars`,
            step.maxBars,
            1,
            issues,
          );
        });
      }
      if (nodeCapability) {
        validateNodeInputsFromCapabilities(
          path,
          node,
          nodeCapability,
          refChecks,
          issues,
        );
      }
      break;
    case 'rolling_window':
      validateIntegerPositive(`${path}.window`, node.window, issues);
      validateEnum(`${path}.mode`, node.mode, ROLLING_WINDOW_MODES, issues);
      if (nodeCapability) {
        validateNodeInputsFromCapabilities(
          path,
          node,
          nodeCapability,
          refChecks,
          issues,
        );
      } else {
        collectRef(`${path}.expr`, node.expr, 'bool', refChecks, issues);
      }
      validateOptionalIntegerMin(`${path}.value`, node.value, 0, issues);
      break;
    case 'state_machine':
      if (nodeCapability) {
        validateNodeInputsFromCapabilities(
          path,
          node,
          nodeCapability,
          refChecks,
          issues,
        );
      } else {
        collectRef(`${path}.set`, node.set, 'bool', refChecks, issues);
        if (node.reset !== undefined) {
          collectRef(`${path}.reset`, node.reset, 'bool', refChecks, issues);
        }
      }
      validateOptionalIntegerMin(`${path}.ttlBars`, node.ttlBars, 1, issues);
      validateOptionalEnum(
        `${path}.conflictPolicy`,
        node.conflictPolicy,
        CONFLICT_POLICIES,
        issues,
      );
      break;
    case 'event':
      validateEnum(`${path}.name`, node.name, ['pivot_confirmed'], issues);
      if (!isPlainObject(node.args)) {
        pushIssue(issues, `${path}.args`, `${path}.args must be an object.`);
      } else {
        validateEnum(
          `${path}.args.pivotKind`,
          node.args.pivotKind,
          PIVOT_KINDS,
          issues,
        );
        validateIntegerPositive(`${path}.args.left`, node.args.left, issues);
        validateIntegerPositive(`${path}.args.right`, node.args.right, issues);
        validateOptionalEnum(
          `${path}.args.timeframe`,
          node.args.timeframe,
          TIMEFRAMES,
          issues,
        );
      }
      break;
  }

  return getNodeInfo(kind, nodeCapabilities);
}

function validateSignalGraph(
  path: string,
  value: unknown,
  issues: DraftSchemaIssue[],
  capabilities?: unknown,
): void {
  if (!isPlainObject(value)) {
    pushIssue(issues, path, `${path} must be an object.`);
    return;
  }

  validateEnum(
    `${path}.protocol`,
    value.protocol,
    ['traseq.signal-graph'],
    issues,
  );
  if (value.version !== 2) {
    pushIssue(issues, `${path}.version`, `${path}.version must be 2.`);
  }

  if (value.meta !== undefined && !isPlainObject(value.meta)) {
    pushIssue(issues, `${path}.meta`, `${path}.meta must be an object.`);
  }

  const refChecks: RefCheck[] = [];
  const nodeMap = new Map<string, NodeInfo>();
  const indicatorCapabilities = buildIndicatorCapabilityMap(capabilities);
  const nodeCapabilities = buildSignalGraphNodeCapabilityMap(capabilities);
  const bindingCapabilities =
    buildSignalGraphBindingCapabilityMap(capabilities);

  if (!Array.isArray(value.nodes) || value.nodes.length === 0) {
    pushIssue(
      issues,
      `${path}.nodes`,
      `${path}.nodes must be a non-empty array.`,
    );
  } else {
    value.nodes.forEach((node, index) => {
      const nodePath = `${path}.nodes[${index}]`;
      const nodeInfo = validateNode(
        nodePath,
        node,
        refChecks,
        issues,
        indicatorCapabilities,
        nodeCapabilities,
      );

      if (
        !isPlainObject(node) ||
        typeof node.id !== 'string' ||
        node.id.trim().length === 0
      ) {
        return;
      }

      if (nodeMap.has(node.id)) {
        pushIssue(
          issues,
          `${nodePath}.id`,
          `Duplicate signal graph node id "${node.id}".`,
        );
        return;
      }

      if (nodeInfo) {
        nodeMap.set(node.id, nodeInfo);
      }
    });
  }

  validateStrategyNode(
    `${path}.strategy`,
    value.strategy,
    refChecks,
    issues,
    bindingCapabilities,
  );

  refChecks.forEach((refCheck) => {
    const target = nodeMap.get(refCheck.ref);

    if (!target) {
      pushIssue(
        issues,
        refCheck.path,
        `${refCheck.path} references unknown node "${refCheck.ref}".`,
      );
      return;
    }

    if (refCheck.expected === 'bool' && target.output !== 'bool') {
      pushIssue(
        issues,
        refCheck.path,
        `${refCheck.path} must reference a bool node, but "${refCheck.ref}" is ${target.output}.`,
      );
      return;
    }

    if (refCheck.expected === 'value' && target.output !== 'value') {
      pushIssue(
        issues,
        refCheck.path,
        `${refCheck.path} must reference a value node, but "${refCheck.ref}" is ${target.output}.`,
      );
      return;
    }

    if (refCheck.expected === 'series') {
      if (target.output !== 'value') {
        pushIssue(
          issues,
          refCheck.path,
          `${refCheck.path} must reference a series-capable value node, but "${refCheck.ref}" is ${target.output}.`,
        );
        return;
      }

      if (!target.seriesCapable) {
        pushIssue(
          issues,
          refCheck.path,
          `${refCheck.path} must reference a series-capable value node, but "${refCheck.ref}" is not series-capable.`,
        );
      }
    }
  });
}

function validateSettings(
  value: unknown,
  issues: DraftSchemaIssue[],
): value is StrategySettings {
  if (!isPlainObject(value)) {
    pushIssue(issues, 'settings', 'settings must be an object.');
    return false;
  }

  if (
    value.warmupPeriod !== undefined &&
    (!Number.isInteger(value.warmupPeriod) || Number(value.warmupPeriod) < 0)
  ) {
    pushIssue(
      issues,
      'settings.warmupPeriod',
      'warmupPeriod must be an integer greater than or equal to 0.',
    );
  }

  if (
    typeof value.positionStyle !== 'string' ||
    !['single', 'pyramid', 'accumulate'].includes(value.positionStyle)
  ) {
    pushIssue(
      issues,
      'settings.positionStyle',
      'positionStyle must be one of single, pyramid, or accumulate.',
    );
    return false;
  }

  if (value.positionStyle === 'single') {
    if (value.maxConcurrentPositions !== undefined) {
      pushIssue(
        issues,
        'settings.maxConcurrentPositions',
        'maxConcurrentPositions is not allowed when positionStyle is single.',
      );
    }
    if (value.accumulation !== undefined) {
      pushIssue(
        issues,
        'settings.accumulation',
        'accumulation is not allowed when positionStyle is single.',
      );
    }
    return true;
  }

  if (value.positionStyle === 'pyramid') {
    if (
      !Number.isInteger(value.maxConcurrentPositions) ||
      Number(value.maxConcurrentPositions) < 1 ||
      Number(value.maxConcurrentPositions) > 100
    ) {
      pushIssue(
        issues,
        'settings.maxConcurrentPositions',
        'maxConcurrentPositions must be an integer between 1 and 100.',
      );
    }

    if (value.accumulation !== undefined) {
      pushIssue(
        issues,
        'settings.accumulation',
        'accumulation is not allowed when positionStyle is pyramid.',
      );
    }
    return true;
  }

  if (!isPlainObject(value.accumulation)) {
    pushIssue(
      issues,
      'settings.accumulation',
      'accumulation must be an object when positionStyle is accumulate.',
    );
    return false;
  }

  const accumulation = value.accumulation;
  if (
    typeof accumulation.triggerMode !== 'string' ||
    !['scheduled', 'signal', 'scheduled_and_signal'].includes(
      accumulation.triggerMode,
    )
  ) {
    pushIssue(
      issues,
      'settings.accumulation.triggerMode',
      'triggerMode must be one of scheduled, signal, or scheduled_and_signal.',
    );
  }

  if (
    accumulation.maxAdds === undefined &&
    accumulation.budgetCap === undefined &&
    accumulation.targetAllocationPct === undefined
  ) {
    pushIssue(
      issues,
      'settings.accumulation',
      'accumulation requires at least one stop condition: maxAdds, budgetCap, or targetAllocationPct.',
    );
  }

  if (
    accumulation.maxAdds !== undefined &&
    (!Number.isInteger(accumulation.maxAdds) ||
      Number(accumulation.maxAdds) < 1)
  ) {
    pushIssue(
      issues,
      'settings.accumulation.maxAdds',
      'maxAdds must be an integer greater than or equal to 1.',
    );
  }

  if (
    accumulation.budgetCap !== undefined &&
    (typeof accumulation.budgetCap !== 'number' ||
      !Number.isFinite(accumulation.budgetCap) ||
      accumulation.budgetCap <= 0)
  ) {
    pushIssue(
      issues,
      'settings.accumulation.budgetCap',
      'budgetCap must be a positive number.',
    );
  }

  if (
    accumulation.targetAllocationPct !== undefined &&
    (typeof accumulation.targetAllocationPct !== 'number' ||
      !Number.isFinite(accumulation.targetAllocationPct) ||
      accumulation.targetAllocationPct <= 0 ||
      accumulation.targetAllocationPct > 100)
  ) {
    pushIssue(
      issues,
      'settings.accumulation.targetAllocationPct',
      'targetAllocationPct must be greater than 0 and less than or equal to 100.',
    );
  }

  if (
    accumulation.stopWhenNoCash !== undefined &&
    typeof accumulation.stopWhenNoCash !== 'boolean'
  ) {
    pushIssue(
      issues,
      'settings.accumulation.stopWhenNoCash',
      'stopWhenNoCash must be a boolean.',
    );
  }

  if (accumulation.triggerMode === 'signal') {
    if (accumulation.schedule !== undefined) {
      pushIssue(
        issues,
        'settings.accumulation.schedule',
        'schedule is only allowed when triggerMode is scheduled or scheduled_and_signal.',
      );
    }
    return true;
  }

  if (!isPlainObject(accumulation.schedule)) {
    pushIssue(
      issues,
      'settings.accumulation.schedule',
      'schedule must be provided when triggerMode is scheduled or scheduled_and_signal.',
    );
    return true;
  }

  if (
    typeof accumulation.schedule.cadence !== 'string' ||
    !['daily', 'weekly', 'monthly'].includes(accumulation.schedule.cadence)
  ) {
    pushIssue(
      issues,
      'settings.accumulation.schedule.cadence',
      'cadence must be one of daily, weekly, or monthly.',
    );
    return true;
  }

  if (
    accumulation.schedule.interval !== undefined &&
    (!Number.isInteger(accumulation.schedule.interval) ||
      Number(accumulation.schedule.interval) < 1)
  ) {
    pushIssue(
      issues,
      'settings.accumulation.schedule.interval',
      'interval must be an integer greater than or equal to 1.',
    );
  }

  if (
    accumulation.schedule.cadence === 'weekly' &&
    (!Number.isInteger(accumulation.schedule.weekday) ||
      Number(accumulation.schedule.weekday) < 1 ||
      Number(accumulation.schedule.weekday) > 7)
  ) {
    pushIssue(
      issues,
      'settings.accumulation.schedule.weekday',
      'weekday must be an integer between 1 and 7 for weekly schedules.',
    );
  }

  if (
    accumulation.schedule.cadence === 'monthly' &&
    (!Number.isInteger(accumulation.schedule.dayOfMonth) ||
      Number(accumulation.schedule.dayOfMonth) < 1 ||
      Number(accumulation.schedule.dayOfMonth) > 31)
  ) {
    pushIssue(
      issues,
      'settings.accumulation.schedule.dayOfMonth',
      'dayOfMonth must be an integer between 1 and 31 for monthly schedules.',
    );
  }

  if (
    accumulation.schedule.anchorMode !== undefined &&
    accumulation.schedule.anchorMode !== 'backtest_start'
  ) {
    pushIssue(
      issues,
      'settings.accumulation.schedule.anchorMode',
      'anchorMode must be backtest_start.',
    );
  }

  return true;
}

function validateBacktest(value: unknown, issues: DraftSchemaIssue[]): void {
  if (!isPlainObject(value)) {
    pushIssue(issues, 'backtest', 'backtest must be an object.');
    return;
  }

  if (
    typeof value.timeframe !== 'string' ||
    !TIMEFRAMES.includes(value.timeframe as Timeframe)
  ) {
    pushIssue(
      issues,
      'backtest.timeframe',
      'backtest.timeframe must be one of 15m, 1h, 4h, 1d.',
    );
  }

  validateInstrumentRef(
    'backtest.signalInstrument',
    value.signalInstrument,
    issues,
  );

  if (value.range !== undefined) {
    if (!isPlainObject(value.range)) {
      pushIssue(issues, 'backtest.range', 'backtest.range must be an object.');
    } else {
      validateIntegerMin('backtest.range.start', value.range.start, 0, issues);
      validateIntegerMin('backtest.range.end', value.range.end, 0, issues);
      if (
        Number.isInteger(value.range.start) &&
        Number.isInteger(value.range.end) &&
        Number(value.range.start) >= Number(value.range.end)
      ) {
        pushIssue(
          issues,
          'backtest.range',
          'backtest.range.start must be less than backtest.range.end.',
        );
      }
    }
  }

  if (value.initialBalance !== undefined) {
    validatePositiveNumber(
      'backtest.initialBalance',
      value.initialBalance,
      issues,
    );
  }

  if (value.execution !== undefined) {
    if (!isPlainObject(value.execution)) {
      pushIssue(
        issues,
        'backtest.execution',
        'backtest.execution must be an object.',
      );
    } else {
      validateOptionalEnum(
        'backtest.execution.entryOrderRole',
        value.execution.entryOrderRole,
        ['maker', 'taker'],
        issues,
      );
      validateOptionalEnum(
        'backtest.execution.exitOrderRole',
        value.execution.exitOrderRole,
        ['maker', 'taker'],
        issues,
      );
      validateOptionalEnum(
        'backtest.execution.riskOrderRole',
        value.execution.riskOrderRole,
        ['maker', 'taker'],
        issues,
      );

      if (value.execution.feeModel !== undefined) {
        if (!isPlainObject(value.execution.feeModel)) {
          pushIssue(
            issues,
            'backtest.execution.feeModel',
            'backtest.execution.feeModel must be an object.',
          );
        } else if (value.execution.feeModel.tiers !== undefined) {
          if (!Array.isArray(value.execution.feeModel.tiers)) {
            pushIssue(
              issues,
              'backtest.execution.feeModel.tiers',
              'backtest.execution.feeModel.tiers must be an array.',
            );
          }
        }
      }

      if (value.execution.slippage !== undefined) {
        if (!isPlainObject(value.execution.slippage)) {
          pushIssue(
            issues,
            'backtest.execution.slippage',
            'backtest.execution.slippage must be an object.',
          );
        } else {
          validateOptionalEnum(
            'backtest.execution.slippage.kind',
            value.execution.slippage.kind,
            ['none', 'fixed', 'volatility_scaled'],
            issues,
          );
        }
      }
    }
  }

  validateOptionalEnum(
    'backtest.ambiguityResolution',
    value.ambiguityResolution,
    ['multi_resolution', 'pessimistic', 'bar_direction', 'distance'],
    issues,
  );
  validateOptionalEnum(
    'backtest.ambiguityFallback',
    value.ambiguityFallback,
    ['pessimistic', 'bar_direction', 'distance'],
    issues,
  );
}

export function validateStrategyDraft(
  value: unknown,
  capabilities?: unknown,
): DraftSchemaOk | DraftSchemaFail {
  const issues: DraftSchemaIssue[] = [];

  if (!isPlainObject(value)) {
    pushIssue(issues, '$', 'Draft must be a JSON object.');
    return { ok: false, issues };
  }

  validateNonEmptyString('name', value.name, issues);
  validateOptionalString('description', value.description, issues);
  validateSignalGraph('signalGraph', value.signalGraph, issues, capabilities);
  validateSettings(value.settings, issues);
  validateBacktest(value.backtest, issues);

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    draft: value as unknown as StrategyDraft,
  };
}

export function preflightStrategyDraft(
  value: unknown,
  capabilities?: unknown,
): TraseqValidationResponse & { draft?: StrategyDraft } {
  const result = validateStrategyDraft(value, capabilities);
  if (result.ok) {
    return {
      valid: true,
      summary: { errors: 0, warnings: 0 },
      issues: [],
      draft: result.draft,
    };
  }

  const issues = draftSchemaIssuesToValidationIssues(result.issues);
  return {
    valid: false,
    summary: {
      errors: issues.filter((issue) => issue.severity === 'error').length,
      warnings: issues.filter((issue) => issue.severity === 'warning').length,
    },
    issues,
  };
}
