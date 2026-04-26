// Generated from the Traseq public platform surface snapshot.
// Keep endpoint behavior in sync with services/app-api /public/v1.

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export interface OperationDefinition {
  readonly name: string;
  readonly description: string;
  readonly endpoint: {
    readonly method: HttpMethod;
    readonly path: string;
  };
  readonly input_schema: Record<string, unknown>;
  readonly destructive?: boolean;
  readonly longRunning?: boolean;
}

const EMPTY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {},
} as const;

function objectSchema(
  properties: Record<string, unknown>,
  required: readonly string[] = [],
  options?: { additionalProperties?: boolean },
) {
  return {
    type: 'object',
    additionalProperties: options?.additionalProperties ?? false,
    ...(required.length > 0 ? { required: [...required] } : {}),
    properties,
  };
}

const stringProp = { type: 'string' } as const;
const numberProp = { type: 'number' } as const;
const integerProp = { type: 'integer' } as const;
const booleanProp = { type: 'boolean' } as const;
const objectProp = { type: 'object', additionalProperties: true } as const;

const OPERATIONS = [
  {
    name: 'get_manifest',
    description: 'Read the Traseq Public Agent API manifest.',
    endpoint: { method: 'GET', path: '/public/v1' },
    input_schema: EMPTY_SCHEMA,
  },
  {
    name: 'get_health',
    description: 'Check public API reachability.',
    endpoint: { method: 'GET', path: '/public/v1/health' },
    input_schema: EMPTY_SCHEMA,
  },
  {
    name: 'get_workspace_context',
    description: 'Read workspace identity, granted API key scopes, and subscription tier.',
    endpoint: { method: 'GET', path: '/public/v1/workspace' },
    input_schema: EMPTY_SCHEMA,
  },
  {
    name: 'get_usage',
    description: 'Read current workspace usage, budget, and enforced limits.',
    endpoint: { method: 'GET', path: '/public/v1/usage' },
    input_schema: EMPTY_SCHEMA,
  },
  {
    name: 'get_capabilities',
    description: 'Read live strategy authoring capabilities and validation limits.',
    endpoint: { method: 'GET', path: '/public/v1/capabilities' },
    input_schema: EMPTY_SCHEMA,
  },
  {
    name: 'list_system_strategies',
    description: 'List system strategy templates.',
    endpoint: { method: 'GET', path: '/public/v1/system-strategies' },
    input_schema: objectSchema({
      category: stringProp,
      search: stringProp,
      tags: { oneOf: [stringProp, { type: 'array', items: stringProp }] },
    }),
  },
  {
    name: 'get_system_strategy',
    description: 'Get a system strategy template by key.',
    endpoint: { method: 'GET', path: '/public/v1/system-strategies/{key}' },
    input_schema: objectSchema({ key: stringProp }, ['key']),
  },
  {
    name: 'copy_system_strategy',
    description: 'Copy a system strategy template into the workspace.',
    endpoint: { method: 'POST', path: '/public/v1/system-strategies/{key}/copy' },
    input_schema: objectSchema({
      key: stringProp,
      name: stringProp,
      description: stringProp,
    }, ['key']),
  },
  {
    name: 'validate_strategy',
    description: 'Validate a strategyAst or signalGraph authoring payload.',
    endpoint: { method: 'POST', path: '/public/v1/strategies/validate' },
    input_schema: objectSchema({
      strategyAst: objectProp,
      signalGraph: objectProp,
      settings: objectProp,
    }, ['settings']),
  },
  {
    name: 'list_strategies',
    description: 'List workspace strategies.',
    endpoint: { method: 'GET', path: '/public/v1/strategies' },
    input_schema: objectSchema({
      status: stringProp,
      page: integerProp,
      limit: integerProp,
      search: stringProp,
      includeMetadata: booleanProp,
    }),
  },
  {
    name: 'create_strategy',
    description: 'Create a draft strategy with the first version attached.',
    endpoint: { method: 'POST', path: '/public/v1/strategies' },
    input_schema: objectSchema({
      name: stringProp,
      description: stringProp,
      strategyAst: objectProp,
      signalGraph: objectProp,
      settings: objectProp,
    }, ['name', 'settings']),
  },
  {
    name: 'get_strategy',
    description: 'Get strategy detail with versions.',
    endpoint: { method: 'GET', path: '/public/v1/strategies/{strategyId}' },
    input_schema: objectSchema({ strategyId: stringProp }, ['strategyId']),
  },
  {
    name: 'update_strategy',
    description: 'Update strategy metadata.',
    endpoint: { method: 'PATCH', path: '/public/v1/strategies/{strategyId}' },
    input_schema: objectSchema({
      strategyId: stringProp,
      name: stringProp,
      description: { oneOf: [stringProp, { type: 'null' }] },
    }, ['strategyId']),
  },
  {
    name: 'create_strategy_version',
    description: 'Create a draft version for an existing strategy.',
    endpoint: { method: 'POST', path: '/public/v1/strategies/{strategyId}/versions' },
    input_schema: objectSchema({
      strategyId: stringProp,
      forkedFromVersionId: stringProp,
      strategyAst: objectProp,
      signalGraph: objectProp,
      settings: objectProp,
    }, ['strategyId', 'settings']),
  },
  {
    name: 'get_strategy_version',
    description: 'Get strategy version detail.',
    endpoint: { method: 'GET', path: '/public/v1/strategies/{strategyId}/versions/{version}' },
    input_schema: objectSchema({
      strategyId: stringProp,
      version: integerProp,
    }, ['strategyId', 'version']),
  },
  {
    name: 'update_strategy_version',
    description: 'Update a draft strategy version.',
    endpoint: { method: 'PATCH', path: '/public/v1/strategies/{strategyId}/versions/{version}' },
    input_schema: objectSchema({
      strategyId: stringProp,
      version: integerProp,
      strategyAst: objectProp,
      signalGraph: objectProp,
      settings: objectProp,
    }, ['strategyId', 'version']),
  },
  {
    name: 'finalize_strategy_version',
    description: 'Finalize a draft or new strategy version.',
    endpoint: { method: 'POST', path: '/public/v1/strategies/{strategyId}/versions/finalize' },
    input_schema: objectSchema({
      strategyId: stringProp,
      version: integerProp,
      ignoreWarnings: booleanProp,
      forkedFromVersionId: stringProp,
      strategyAst: objectProp,
      signalGraph: objectProp,
      settings: objectProp,
    }, ['strategyId', 'settings']),
  },
  {
    name: 'delete_strategy_version',
    description: 'Delete a strategy version. Requires confirm=true.',
    endpoint: { method: 'DELETE', path: '/public/v1/strategies/{strategyId}/versions/{version}' },
    input_schema: objectSchema({
      strategyId: stringProp,
      version: integerProp,
      confirm: booleanProp,
    }, ['strategyId', 'version', 'confirm']),
    destructive: true,
  },
  {
    name: 'archive_strategy_version',
    description: 'Archive a ready strategy version.',
    endpoint: { method: 'POST', path: '/public/v1/strategies/{strategyId}/versions/{version}/archive' },
    input_schema: objectSchema({ strategyId: stringProp, version: integerProp }, ['strategyId', 'version']),
  },
  {
    name: 'restore_strategy_version',
    description: 'Restore an archived strategy version.',
    endpoint: { method: 'POST', path: '/public/v1/strategies/{strategyId}/versions/{version}/restore' },
    input_schema: objectSchema({ strategyId: stringProp, version: integerProp }, ['strategyId', 'version']),
  },
  {
    name: 'create_pine_export',
    description: 'Export Pine script for a strategy version.',
    endpoint: { method: 'POST', path: '/public/v1/strategies/{strategyId}/versions/{version}/pine-export' },
    input_schema: objectSchema({
      strategyId: stringProp,
      version: integerProp,
      validationMode: { type: 'string', enum: ['compatible', 'exact_only'] },
      strategyName: stringProp,
    }, ['strategyId', 'version']),
  },
  {
    name: 'validate_conflicts',
    description: 'Check conflicts between strategy blocks.',
    endpoint: { method: 'POST', path: '/public/v1/strategies/validate-conflicts' },
    input_schema: objectSchema({ blocks: { type: 'array', items: objectProp } }, ['blocks']),
  },
  {
    name: 'list_backtests',
    description: 'List workspace backtests.',
    endpoint: { method: 'GET', path: '/public/v1/backtests' },
    input_schema: objectSchema({
      status: stringProp,
      strategyId: stringProp,
      strategyVersionId: stringProp,
      search: stringProp,
      sortBy: stringProp,
      order: { type: 'string', enum: ['asc', 'desc'] },
      page: integerProp,
      limit: integerProp,
    }),
  },
  {
    name: 'run_backtest',
    description: 'Queue a backtest for a ready strategy version.',
    endpoint: { method: 'POST', path: '/public/v1/backtests' },
    input_schema: objectSchema({
      strategyVersionId: stringProp,
      config: objectProp,
    }, ['strategyVersionId', 'config']),
    longRunning: true,
  },
  {
    name: 'get_backtest',
    description: 'Get backtest detail, status, and result.',
    endpoint: { method: 'GET', path: '/public/v1/backtests/{backtestId}' },
    input_schema: objectSchema({ backtestId: stringProp }, ['backtestId']),
  },
  {
    name: 'get_backtest_progress',
    description: 'Get backtest progress snapshot.',
    endpoint: { method: 'GET', path: '/public/v1/backtests/{backtestId}/progress' },
    input_schema: objectSchema({ backtestId: stringProp }, ['backtestId']),
  },
  {
    name: 'get_backtest_chart_data',
    description: 'Get candles and indicator chart data for a backtest.',
    endpoint: { method: 'GET', path: '/public/v1/backtests/{backtestId}/chart-data' },
    input_schema: objectSchema({ backtestId: stringProp }, ['backtestId'], { additionalProperties: true }),
  },
  {
    name: 'get_backtest_price_preview',
    description: 'Get bucketed OHLC preview and trade density for a backtest.',
    endpoint: { method: 'GET', path: '/public/v1/backtests/{backtestId}/price-preview' },
    input_schema: objectSchema({ backtestId: stringProp }, ['backtestId']),
  },
  {
    name: 'set_primary_backtest',
    description: 'Set a backtest as primary for its strategy version.',
    endpoint: { method: 'PATCH', path: '/public/v1/backtests/{backtestId}/set-primary' },
    input_schema: objectSchema({ backtestId: stringProp }, ['backtestId']),
  },
  {
    name: 'delete_backtest',
    description: 'Delete a backtest. Requires confirm=true.',
    endpoint: { method: 'DELETE', path: '/public/v1/backtests/{backtestId}' },
    input_schema: objectSchema({ backtestId: stringProp, confirm: booleanProp }, ['backtestId', 'confirm']),
    destructive: true,
  },
  {
    name: 'wait_backtest',
    description: 'Poll a backtest until it reaches a terminal status.',
    endpoint: { method: 'GET', path: '/public/v1/backtests/{backtestId}' },
    input_schema: objectSchema({
      backtestId: stringProp,
      intervalMs: integerProp,
      timeoutMs: integerProp,
    }, ['backtestId']),
    longRunning: true,
  },
  {
    name: 'preview_robustness_analysis',
    description: 'Preview robustness analysis scenarios and cost.',
    endpoint: { method: 'POST', path: '/public/v1/analysis-runs/robustness/preview' },
    input_schema: objectSchema({ sourceBacktestId: stringProp, preset: { type: 'string', enum: ['core_v1'] } }, ['sourceBacktestId']),
  },
  {
    name: 'create_robustness_analysis',
    description: 'Create and start a robustness analysis run.',
    endpoint: { method: 'POST', path: '/public/v1/analysis-runs/robustness' },
    input_schema: objectSchema({ sourceBacktestId: stringProp, preset: { type: 'string', enum: ['core_v1'] } }, ['sourceBacktestId']),
    longRunning: true,
  },
  {
    name: 'list_analysis_runs',
    description: 'List analysis runs.',
    endpoint: { method: 'GET', path: '/public/v1/analysis-runs' },
    input_schema: objectSchema({ status: stringProp, page: integerProp, limit: integerProp }),
  },
  {
    name: 'get_analysis_run',
    description: 'Get analysis run detail.',
    endpoint: { method: 'GET', path: '/public/v1/analysis-runs/{analysisRunId}' },
    input_schema: objectSchema({ analysisRunId: stringProp }, ['analysisRunId']),
  },
  {
    name: 'update_analysis_run',
    description: 'Update analysis run title or description.',
    endpoint: { method: 'PATCH', path: '/public/v1/analysis-runs/{analysisRunId}' },
    input_schema: objectSchema({
      analysisRunId: stringProp,
      title: stringProp,
      description: { oneOf: [stringProp, { type: 'null' }] },
    }, ['analysisRunId']),
  },
  {
    name: 'delete_analysis_run',
    description: 'Delete analysis run and child backtests. Requires confirm=true.',
    endpoint: { method: 'DELETE', path: '/public/v1/analysis-runs/{analysisRunId}' },
    input_schema: objectSchema({ analysisRunId: stringProp, confirm: booleanProp }, ['analysisRunId', 'confirm']),
    destructive: true,
  },
  {
    name: 'wait_analysis_run',
    description: 'Poll an analysis run until terminal status.',
    endpoint: { method: 'GET', path: '/public/v1/analysis-runs/{analysisRunId}' },
    input_schema: objectSchema({
      analysisRunId: stringProp,
      intervalMs: integerProp,
      timeoutMs: integerProp,
    }, ['analysisRunId']),
    longRunning: true,
  },
  {
    name: 'list_comparison_sets',
    description: 'List comparison sets.',
    endpoint: { method: 'GET', path: '/public/v1/comparison-sets' },
    input_schema: objectSchema({ search: stringProp, page: integerProp, limit: integerProp, sortBy: stringProp, sortOrder: stringProp }),
  },
  {
    name: 'get_comparison_set',
    description: 'Get comparison set detail.',
    endpoint: { method: 'GET', path: '/public/v1/comparison-sets/{comparisonSetId}' },
    input_schema: objectSchema({ comparisonSetId: stringProp }, ['comparisonSetId']),
  },
  {
    name: 'create_comparison_set',
    description: 'Create a comparison set from backtests.',
    endpoint: { method: 'POST', path: '/public/v1/comparison-sets' },
    input_schema: objectSchema({
      name: stringProp,
      notes: stringProp,
      backtestIds: { type: 'array', items: stringProp },
    }, ['name', 'backtestIds']),
  },
  {
    name: 'update_comparison_set',
    description: 'Update comparison set metadata or backtests.',
    endpoint: { method: 'PATCH', path: '/public/v1/comparison-sets/{comparisonSetId}' },
    input_schema: objectSchema({
      comparisonSetId: stringProp,
      name: stringProp,
      notes: { oneOf: [stringProp, { type: 'null' }] },
      backtestIds: { type: 'array', items: stringProp },
    }, ['comparisonSetId']),
  },
  {
    name: 'delete_comparison_set',
    description: 'Delete a comparison set. Requires confirm=true.',
    endpoint: { method: 'DELETE', path: '/public/v1/comparison-sets/{comparisonSetId}' },
    input_schema: objectSchema({ comparisonSetId: stringProp, confirm: booleanProp }, ['comparisonSetId', 'confirm']),
    destructive: true,
  },
  {
    name: 'list_blocks',
    description: 'List reusable custom and system blocks.',
    endpoint: { method: 'GET', path: '/public/v1/blocks' },
    input_schema: objectSchema({ filter: stringProp, search: stringProp, tags: stringProp, type: stringProp, category: stringProp, page: integerProp, limit: integerProp }),
  },
  {
    name: 'get_block',
    description: 'Get reusable block detail.',
    endpoint: { method: 'GET', path: '/public/v1/blocks/{blockId}' },
    input_schema: objectSchema({ blockId: stringProp }, ['blockId']),
  },
  {
    name: 'create_block',
    description: 'Create a reusable block.',
    endpoint: { method: 'POST', path: '/public/v1/blocks' },
    input_schema: objectSchema({
      name: stringProp,
      description: stringProp,
      type: stringProp,
      category: stringProp,
      tokens: { type: 'array', items: objectProp },
      tags: { type: 'array', items: stringProp },
      indicatorFamily: stringProp,
      direction: stringProp,
      exclusiveGroup: stringProp,
      ignoreWarnings: booleanProp,
    }, ['name', 'tokens']),
  },
  {
    name: 'update_block',
    description: 'Update a reusable block.',
    endpoint: { method: 'PATCH', path: '/public/v1/blocks/{blockId}' },
    input_schema: objectSchema({
      blockId: stringProp,
      name: stringProp,
      description: stringProp,
      type: stringProp,
      category: stringProp,
      tokens: { type: 'array', items: objectProp },
      tags: { type: 'array', items: stringProp },
      indicatorFamily: stringProp,
      direction: stringProp,
      exclusiveGroup: stringProp,
      ignoreWarnings: booleanProp,
    }, ['blockId']),
  },
  {
    name: 'delete_block',
    description: 'Delete a reusable block. Requires confirm=true.',
    endpoint: { method: 'DELETE', path: '/public/v1/blocks/{blockId}' },
    input_schema: objectSchema({ blockId: stringProp, confirm: booleanProp }, ['blockId', 'confirm']),
    destructive: true,
  },
  {
    name: 'pin_block',
    description: 'Pin a reusable block.',
    endpoint: { method: 'POST', path: '/public/v1/blocks/{blockId}/pin' },
    input_schema: objectSchema({ blockId: stringProp }, ['blockId']),
  },
  {
    name: 'unpin_block',
    description: 'Unpin a reusable block.',
    endpoint: { method: 'DELETE', path: '/public/v1/blocks/{blockId}/pin' },
    input_schema: objectSchema({ blockId: stringProp }, ['blockId']),
  },
] as const satisfies readonly OperationDefinition[];

export const OPERATION_REGISTRY: readonly OperationDefinition[] = OPERATIONS;

export type OperationName = (typeof OPERATIONS)[number]['name'];

export function getOperationDefinition(name: string): OperationDefinition | undefined {
  return OPERATION_REGISTRY.find((operation) => operation.name === name);
}
