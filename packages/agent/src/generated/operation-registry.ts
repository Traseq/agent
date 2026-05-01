// Generated from the Traseq public platform surface snapshot.
// Keep endpoint behavior in sync with services/app-api /public/v1.

import { STRATEGY_AUTHORING_PAYLOAD_JSON_SCHEMA } from '@traseq/sdk';

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

// Flexible time-input helper for backtest range endpoints. The MCP schema
// announces both string and number forms so LLM clients see (and learn from)
// the examples directly in the tool definition rather than discovering valid
// shapes through trial-and-error rejection.
function timeInputProp(
  description: string,
  examples: ReadonlyArray<string | number>,
) {
  return {
    oneOf: [
      {
        type: 'string',
        description:
          'ISO-8601 date ("2024-01-01" or "2024-01-01T00:00:00Z"), relative duration ("1y", "6m", "30d", "2w"), or one of the symbolic tokens "now", "inception", "ytd".',
      },
      {
        type: 'number',
        description:
          'Numeric epoch — 10-digit seconds (e.g. 1704067200) or 13-digit milliseconds (e.g. 1704067200000). The server auto-detects which.',
      },
    ],
    description,
    examples: [...examples],
  } as const;
}
const strategyAuthoringPayloadSchema =
  STRATEGY_AUTHORING_PAYLOAD_JSON_SCHEMA.schema;
const strategyListStatusProp = {
  type: 'string',
  enum: ['active', 'trashed', 'all'],
} as const;
const signalConditionRoleProp = {
  type: 'string',
  enum: ['entry_condition', 'exit_condition'],
} as const;
const signalTriggerPolicyProp = {
  type: 'string',
  enum: ['rising_edge', 'every_closed_bar_true'],
} as const;
const signalMonitorStatusProp = {
  type: 'string',
  enum: ['active', 'paused', 'archived'],
} as const;
const signalWebhookStatusProp = {
  type: 'string',
  enum: ['active', 'disabled', 'archived'],
} as const;
const signalEventTypeProp = {
  type: 'string',
  enum: ['strategy.condition.satisfied'],
} as const;

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
    description:
      'Read workspace identity, granted API key scopes, and subscription tier.',
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
    description:
      'Read live strategy authoring capabilities and validation limits.',
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
    endpoint: {
      method: 'POST',
      path: '/public/v1/system-strategies/{key}/copy',
    },
    input_schema: objectSchema(
      {
        key: stringProp,
        name: stringProp,
        description: stringProp,
      },
      ['key'],
    ),
  },
  {
    name: 'validate_strategy',
    description: 'Validate a SignalGraph v2 authoring payload.',
    endpoint: { method: 'POST', path: '/public/v1/strategies/validate' },
    input_schema: strategyAuthoringPayloadSchema,
  },
  {
    name: 'list_strategies',
    description: 'List workspace strategies.',
    endpoint: { method: 'GET', path: '/public/v1/strategies' },
    input_schema: objectSchema({
      status: strategyListStatusProp,
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
    input_schema: objectSchema(
      {
        name: stringProp,
        description: stringProp,
        signalGraph: objectProp,
        settings: objectProp,
      },
      ['name', 'signalGraph', 'settings'],
    ),
  },
  {
    name: 'get_strategy',
    description: 'Get strategy detail with versions.',
    endpoint: { method: 'GET', path: '/public/v1/strategies/{strategyId}' },
    input_schema: objectSchema({ strategyId: stringProp }, ['strategyId']),
  },
  {
    name: 'update_strategy',
    description: 'Update active strategy metadata or set the primary version.',
    endpoint: { method: 'PATCH', path: '/public/v1/strategies/{strategyId}' },
    input_schema: objectSchema(
      {
        strategyId: stringProp,
        name: stringProp,
        description: { oneOf: [stringProp, { type: 'null' }] },
        primaryVersionId: stringProp,
      },
      ['strategyId'],
    ),
  },
  {
    name: 'trash_strategy',
    description:
      'Move an active strategy to Trash so it no longer counts toward the active strategy limit. Requires confirm=true.',
    endpoint: {
      method: 'POST',
      path: '/public/v1/strategies/{strategyId}/trash',
    },
    input_schema: objectSchema(
      {
        strategyId: stringProp,
        confirm: booleanProp,
      },
      ['strategyId', 'confirm'],
    ),
    destructive: true,
  },
  {
    name: 'restore_strategy',
    description:
      'Restore a strategy from Trash. This can fail if the active strategy limit is already full.',
    endpoint: {
      method: 'POST',
      path: '/public/v1/strategies/{strategyId}/restore',
    },
    input_schema: objectSchema({ strategyId: stringProp }, ['strategyId']),
  },
  {
    name: 'purge_strategy',
    description:
      'Permanently delete a trashed strategy. This cannot be restored and requires confirm=true.',
    endpoint: {
      method: 'POST',
      path: '/public/v1/strategies/{strategyId}/purge',
    },
    input_schema: objectSchema(
      {
        strategyId: stringProp,
        confirm: booleanProp,
      },
      ['strategyId', 'confirm'],
    ),
    destructive: true,
  },
  {
    name: 'create_strategy_version',
    description: 'Create a draft version for an existing strategy.',
    endpoint: {
      method: 'POST',
      path: '/public/v1/strategies/{strategyId}/versions',
    },
    input_schema: objectSchema(
      {
        strategyId: stringProp,
        forkedFromVersionId: stringProp,
        signalGraph: objectProp,
        settings: objectProp,
      },
      ['strategyId', 'signalGraph', 'settings'],
    ),
  },
  {
    name: 'get_strategy_version',
    description: 'Get strategy version detail.',
    endpoint: {
      method: 'GET',
      path: '/public/v1/strategies/{strategyId}/versions/{version}',
    },
    input_schema: objectSchema(
      {
        strategyId: stringProp,
        version: integerProp,
      },
      ['strategyId', 'version'],
    ),
  },
  {
    name: 'update_strategy_version',
    description: 'Update a draft strategy version.',
    endpoint: {
      method: 'PATCH',
      path: '/public/v1/strategies/{strategyId}/versions/{version}',
    },
    input_schema: objectSchema(
      {
        strategyId: stringProp,
        version: integerProp,
        signalGraph: objectProp,
        settings: objectProp,
      },
      ['strategyId', 'version'],
    ),
  },
  {
    name: 'finalize_strategy_version',
    description: 'Finalize a draft or new strategy version.',
    endpoint: {
      method: 'POST',
      path: '/public/v1/strategies/{strategyId}/versions/finalize',
    },
    input_schema: objectSchema(
      {
        strategyId: stringProp,
        version: integerProp,
        ignoreWarnings: booleanProp,
        forkedFromVersionId: stringProp,
        signalGraph: objectProp,
        settings: objectProp,
      },
      ['strategyId', 'signalGraph', 'settings'],
    ),
  },
  {
    name: 'delete_strategy_version',
    description: 'Delete a strategy version. Requires confirm=true.',
    endpoint: {
      method: 'DELETE',
      path: '/public/v1/strategies/{strategyId}/versions/{version}',
    },
    input_schema: objectSchema(
      {
        strategyId: stringProp,
        version: integerProp,
        confirm: booleanProp,
      },
      ['strategyId', 'version', 'confirm'],
    ),
    destructive: true,
  },
  {
    name: 'archive_strategy_version',
    description: 'Archive a ready strategy version.',
    endpoint: {
      method: 'POST',
      path: '/public/v1/strategies/{strategyId}/versions/{version}/archive',
    },
    input_schema: objectSchema(
      { strategyId: stringProp, version: integerProp },
      ['strategyId', 'version'],
    ),
  },
  {
    name: 'restore_strategy_version',
    description: 'Restore an archived strategy version.',
    endpoint: {
      method: 'POST',
      path: '/public/v1/strategies/{strategyId}/versions/{version}/restore',
    },
    input_schema: objectSchema(
      { strategyId: stringProp, version: integerProp },
      ['strategyId', 'version'],
    ),
  },
  {
    name: 'create_pine_export',
    description: 'Export Pine script for a strategy version.',
    endpoint: {
      method: 'POST',
      path: '/public/v1/strategies/{strategyId}/versions/{version}/pine-export',
    },
    input_schema: objectSchema(
      {
        strategyId: stringProp,
        version: integerProp,
        validationMode: { type: 'string', enum: ['compatible', 'exact_only'] },
        strategyName: stringProp,
      },
      ['strategyId', 'version'],
    ),
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
    description:
      'Queue a backtest for a ready strategy version. ' +
      'Time inputs are flexible: range.start and range.end accept ISO dates ("2024-01-01"), ' +
      'relative durations ("1y", "6m", "30d", "2w", "ytd"), the symbolic tokens "now"/"inception", ' +
      'or numeric epoch (10-digit seconds or 13-digit milliseconds). ' +
      'When range is omitted entirely, the backtest covers the full available history for the ' +
      "instrument (from its inception to now). The response's runContext.resolvedRange echoes the " +
      'actual {start, end} (epoch ms) the engine used so the caller never has to guess.',
    endpoint: { method: 'POST', path: '/public/v1/backtests' },
    input_schema: objectSchema(
      {
        strategyVersionId: stringProp,
        config: objectSchema(
          {
            timeframe: {
              type: 'string',
              enum: ['15m', '1h', '4h', '1d'],
              description:
                'Bar granularity. Required. Common choices: "1d" for swing/position research, "1h"/"4h" for shorter-horizon work, "15m" for intraday.',
            },
            signalInstrument: objectSchema(
              {
                symbol: {
                  ...stringProp,
                  description:
                    'Instrument symbol (e.g. "BTCUSDT"). Read capabilities.instruments for the authoritative list with each symbol\'s dataStart.',
                },
              },
              ['symbol'],
            ),
            range: {
              ...objectSchema({
                start: timeInputProp(
                  'Range start. Omit to default to "inception" (instrument earliest available data). Examples: "2024-01-01", "1y", "inception", 1704067200, 1704067200000.',
                  ['2024-01-01', '1y', 'inception', 1704067200000],
                ),
                end: timeInputProp(
                  'Range end. Omit to default to "now". Examples: "now", "2025-12-31", 1735603200000.',
                  ['now', '2025-12-31', 1735603200000],
                ),
              }),
              description:
                'Backtest time window. Omit entirely to cover the full available history for the instrument. ' +
                'Both endpoints are individually optional; missing start defaults to "inception", missing end defaults to "now".',
            },
            initialBalance: {
              ...numberProp,
              description:
                'Starting account balance in quote currency. Optional.',
            },
            execution: objectProp,
            portfolioRisk: objectProp,
            ambiguityResolution: stringProp,
            ambiguityFallback: stringProp,
          },
          ['timeframe', 'signalInstrument'],
        ),
      },
      ['strategyVersionId', 'config'],
    ),
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
    endpoint: {
      method: 'GET',
      path: '/public/v1/backtests/{backtestId}/progress',
    },
    input_schema: objectSchema({ backtestId: stringProp }, ['backtestId']),
  },
  {
    name: 'get_backtest_chart_data',
    description: 'Get candles and indicator chart data for a backtest.',
    endpoint: {
      method: 'GET',
      path: '/public/v1/backtests/{backtestId}/chart-data',
    },
    input_schema: objectSchema({ backtestId: stringProp }, ['backtestId'], {
      additionalProperties: true,
    }),
  },
  {
    name: 'get_backtest_price_preview',
    description: 'Get bucketed OHLC preview and trade density for a backtest.',
    endpoint: {
      method: 'GET',
      path: '/public/v1/backtests/{backtestId}/price-preview',
    },
    input_schema: objectSchema({ backtestId: stringProp }, ['backtestId']),
  },
  {
    name: 'set_primary_backtest',
    description: 'Set a backtest as primary for its strategy version.',
    endpoint: {
      method: 'PATCH',
      path: '/public/v1/backtests/{backtestId}/set-primary',
    },
    input_schema: objectSchema({ backtestId: stringProp }, ['backtestId']),
  },
  {
    name: 'delete_backtest',
    description: 'Delete a backtest. Requires confirm=true.',
    endpoint: { method: 'DELETE', path: '/public/v1/backtests/{backtestId}' },
    input_schema: objectSchema(
      { backtestId: stringProp, confirm: booleanProp },
      ['backtestId', 'confirm'],
    ),
    destructive: true,
  },
  {
    name: 'wait_backtest',
    description: 'Poll a backtest until it reaches a terminal status.',
    endpoint: { method: 'GET', path: '/public/v1/backtests/{backtestId}' },
    input_schema: objectSchema(
      {
        backtestId: stringProp,
        intervalMs: integerProp,
        timeoutMs: integerProp,
      },
      ['backtestId'],
    ),
    longRunning: true,
  },
  {
    name: 'preview_robustness_analysis',
    description: 'Preview robustness analysis scenarios and cost.',
    endpoint: {
      method: 'POST',
      path: '/public/v1/analysis-runs/robustness/preview',
    },
    input_schema: objectSchema(
      {
        sourceBacktestId: stringProp,
        preset: { type: 'string', enum: ['core_v1'] },
      },
      ['sourceBacktestId'],
    ),
  },
  {
    name: 'create_robustness_analysis',
    description: 'Create and start a robustness analysis run.',
    endpoint: { method: 'POST', path: '/public/v1/analysis-runs/robustness' },
    input_schema: objectSchema(
      {
        sourceBacktestId: stringProp,
        preset: { type: 'string', enum: ['core_v1'] },
      },
      ['sourceBacktestId'],
    ),
    longRunning: true,
  },
  {
    name: 'list_analysis_runs',
    description: 'List analysis runs.',
    endpoint: { method: 'GET', path: '/public/v1/analysis-runs' },
    input_schema: objectSchema({
      status: stringProp,
      page: integerProp,
      limit: integerProp,
    }),
  },
  {
    name: 'get_analysis_run',
    description: 'Get analysis run detail.',
    endpoint: {
      method: 'GET',
      path: '/public/v1/analysis-runs/{analysisRunId}',
    },
    input_schema: objectSchema({ analysisRunId: stringProp }, [
      'analysisRunId',
    ]),
  },
  {
    name: 'update_analysis_run',
    description: 'Update analysis run title or description.',
    endpoint: {
      method: 'PATCH',
      path: '/public/v1/analysis-runs/{analysisRunId}',
    },
    input_schema: objectSchema(
      {
        analysisRunId: stringProp,
        title: stringProp,
        description: { oneOf: [stringProp, { type: 'null' }] },
      },
      ['analysisRunId'],
    ),
  },
  {
    name: 'delete_analysis_run',
    description:
      'Delete analysis run and child backtests. Requires confirm=true.',
    endpoint: {
      method: 'DELETE',
      path: '/public/v1/analysis-runs/{analysisRunId}',
    },
    input_schema: objectSchema(
      { analysisRunId: stringProp, confirm: booleanProp },
      ['analysisRunId', 'confirm'],
    ),
    destructive: true,
  },
  {
    name: 'wait_analysis_run',
    description: 'Poll an analysis run until terminal status.',
    endpoint: {
      method: 'GET',
      path: '/public/v1/analysis-runs/{analysisRunId}',
    },
    input_schema: objectSchema(
      {
        analysisRunId: stringProp,
        intervalMs: integerProp,
        timeoutMs: integerProp,
      },
      ['analysisRunId'],
    ),
    longRunning: true,
  },
  {
    name: 'list_comparison_sets',
    description: 'List comparison sets.',
    endpoint: { method: 'GET', path: '/public/v1/comparison-sets' },
    input_schema: objectSchema({
      search: stringProp,
      page: integerProp,
      limit: integerProp,
      sortBy: stringProp,
      sortOrder: stringProp,
    }),
  },
  {
    name: 'get_comparison_set',
    description: 'Get comparison set detail.',
    endpoint: {
      method: 'GET',
      path: '/public/v1/comparison-sets/{comparisonSetId}',
    },
    input_schema: objectSchema({ comparisonSetId: stringProp }, [
      'comparisonSetId',
    ]),
  },
  {
    name: 'create_comparison_set',
    description: 'Create a comparison set from backtests.',
    endpoint: { method: 'POST', path: '/public/v1/comparison-sets' },
    input_schema: objectSchema(
      {
        name: stringProp,
        notes: stringProp,
        backtestIds: { type: 'array', items: stringProp },
      },
      ['name', 'backtestIds'],
    ),
  },
  {
    name: 'update_comparison_set',
    description: 'Update comparison set metadata or backtests.',
    endpoint: {
      method: 'PATCH',
      path: '/public/v1/comparison-sets/{comparisonSetId}',
    },
    input_schema: objectSchema(
      {
        comparisonSetId: stringProp,
        name: stringProp,
        notes: { oneOf: [stringProp, { type: 'null' }] },
        backtestIds: { type: 'array', items: stringProp },
      },
      ['comparisonSetId'],
    ),
  },
  {
    name: 'delete_comparison_set',
    description: 'Delete a comparison set. Requires confirm=true.',
    endpoint: {
      method: 'DELETE',
      path: '/public/v1/comparison-sets/{comparisonSetId}',
    },
    input_schema: objectSchema(
      { comparisonSetId: stringProp, confirm: booleanProp },
      ['comparisonSetId', 'confirm'],
    ),
    destructive: true,
  },
  {
    name: 'create_signal_monitor',
    description:
      'Create a closed-bar neutral strategy condition monitor for a ready strategy version.',
    endpoint: { method: 'POST', path: '/public/v1/signal-monitors' },
    input_schema: objectSchema(
      {
        strategyVersionId: stringProp,
        symbol: stringProp,
        timeframe: { type: 'string', enum: ['15m', '1h', '4h', '1d'] },
        conditionRole: signalConditionRoleProp,
        triggerPolicy: signalTriggerPolicyProp,
        metadata: objectProp,
      },
      ['strategyVersionId', 'symbol', 'timeframe', 'conditionRole'],
    ),
  },
  {
    name: 'list_signal_monitors',
    description: 'List strategy condition monitors.',
    endpoint: { method: 'GET', path: '/public/v1/signal-monitors' },
    input_schema: objectSchema({
      status: signalMonitorStatusProp,
      strategyVersionId: stringProp,
      symbol: stringProp,
      timeframe: { type: 'string', enum: ['15m', '1h', '4h', '1d'] },
      limit: integerProp,
      cursor: stringProp,
    }),
  },
  {
    name: 'get_signal_monitor',
    description: 'Get a strategy condition monitor.',
    endpoint: { method: 'GET', path: '/public/v1/signal-monitors/{monitorId}' },
    input_schema: objectSchema({ monitorId: stringProp }, ['monitorId']),
  },
  {
    name: 'update_signal_monitor',
    description: 'Pause, resume, archive, or update metadata for a monitor.',
    endpoint: {
      method: 'PATCH',
      path: '/public/v1/signal-monitors/{monitorId}',
    },
    input_schema: objectSchema(
      {
        monitorId: stringProp,
        status: signalMonitorStatusProp,
        triggerPolicy: signalTriggerPolicyProp,
        metadata: { oneOf: [objectProp, { type: 'null' }] },
      },
      ['monitorId'],
    ),
  },
  {
    name: 'delete_signal_monitor',
    description: 'Archive a strategy condition monitor. Requires confirm=true.',
    endpoint: {
      method: 'DELETE',
      path: '/public/v1/signal-monitors/{monitorId}',
    },
    input_schema: objectSchema(
      { monitorId: stringProp, confirm: booleanProp },
      ['monitorId', 'confirm'],
    ),
    destructive: true,
  },
  {
    name: 'list_signal_events',
    description: 'Poll neutral strategy condition events by opaque cursor.',
    endpoint: { method: 'GET', path: '/public/v1/signal-events' },
    input_schema: objectSchema({
      cursor: stringProp,
      limit: integerProp,
      monitorId: stringProp,
    }),
  },
  {
    name: 'get_signal_event',
    description: 'Get a neutral strategy condition event.',
    endpoint: { method: 'GET', path: '/public/v1/signal-events/{eventId}' },
    input_schema: objectSchema({ eventId: stringProp }, ['eventId']),
  },
  {
    name: 'create_webhook_endpoint',
    description:
      'Register a signed webhook endpoint for neutral strategy condition events.',
    endpoint: { method: 'POST', path: '/public/v1/webhook-endpoints' },
    input_schema: objectSchema(
      {
        url: stringProp,
        eventTypes: { type: 'array', items: signalEventTypeProp },
        description: stringProp,
      },
      ['url'],
    ),
  },
  {
    name: 'list_webhook_endpoints',
    description: 'List webhook endpoints.',
    endpoint: { method: 'GET', path: '/public/v1/webhook-endpoints' },
    input_schema: EMPTY_SCHEMA,
  },
  {
    name: 'update_webhook_endpoint',
    description:
      'Update a webhook endpoint URL, status, events, or description.',
    endpoint: {
      method: 'PATCH',
      path: '/public/v1/webhook-endpoints/{webhookEndpointId}',
    },
    input_schema: objectSchema(
      {
        webhookEndpointId: stringProp,
        url: stringProp,
        status: signalWebhookStatusProp,
        eventTypes: { type: 'array', items: signalEventTypeProp },
        description: { oneOf: [stringProp, { type: 'null' }] },
      },
      ['webhookEndpointId'],
    ),
  },
  {
    name: 'delete_webhook_endpoint',
    description: 'Archive a webhook endpoint.',
    endpoint: {
      method: 'DELETE',
      path: '/public/v1/webhook-endpoints/{webhookEndpointId}',
    },
    input_schema: objectSchema(
      { webhookEndpointId: stringProp, confirm: booleanProp },
      ['webhookEndpointId', 'confirm'],
    ),
    destructive: true,
  },
  {
    name: 'test_webhook_endpoint',
    description: 'Send a signed test webhook to an endpoint.',
    endpoint: {
      method: 'POST',
      path: '/public/v1/webhook-endpoints/{webhookEndpointId}/test',
    },
    input_schema: objectSchema({ webhookEndpointId: stringProp }, [
      'webhookEndpointId',
    ]),
  },
] as const satisfies readonly OperationDefinition[];

export const OPERATION_REGISTRY: readonly OperationDefinition[] = OPERATIONS;

export type OperationName = (typeof OPERATIONS)[number]['name'];

export function getOperationDefinition(
  name: string,
): OperationDefinition | undefined {
  return OPERATION_REGISTRY.find((operation) => operation.name === name);
}
