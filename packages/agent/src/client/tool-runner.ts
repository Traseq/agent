import type { TraseqClient } from '@traseq/sdk';
import {
  getOperationDefinition,
  type OperationName,
} from '../generated/operation-registry.js';
import { asJsonObject, asNumber, asString } from '../normalize.js';

type ToolInput = Record<string, unknown>;

function inputObject(input: unknown): ToolInput {
  return asJsonObject(input) ?? {};
}

function requiredString(input: ToolInput, key: string): string {
  const value = asString(input[key]);
  if (!value) {
    throw new Error(`Missing required field: ${key}`);
  }
  return value;
}

function requiredNumber(input: ToolInput, key: string): number {
  const value = asNumber(input[key]);
  if (value === undefined) {
    throw new Error(`Missing required numeric field: ${key}`);
  }
  return value;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function omit(input: ToolInput, keys: readonly string[]) {
  const next: ToolInput = {};
  for (const [key, value] of Object.entries(input)) {
    if (!keys.includes(key)) {
      next[key] = value;
    }
  }
  return next;
}

function assertConfirmed(name: OperationName, input: ToolInput): void {
  const operation = getOperationDefinition(name);
  if (operation?.destructive && input.confirm !== true) {
    throw new Error(`${name} is destructive and requires confirm: true.`);
  }
}

export async function runPlatformTool(
  client: TraseqClient,
  name: OperationName,
  rawInput: unknown = {},
): Promise<unknown> {
  const input = inputObject(rawInput);
  assertConfirmed(name, input);

  switch (name) {
    case 'get_manifest':
      return client.getManifest();
    case 'get_health':
      return client.getHealth();
    case 'get_workspace_context':
      return client.getWorkspaceContext();
    case 'get_usage':
      return client.getUsage();
    case 'get_capabilities':
      return client.getCapabilities();
    case 'get_token_grammar_document':
      return client.getTokenGrammar();
    case 'materialize_token_grammar':
      return client.materializeTokenGrammar(input as any);
    case 'validate_token_grammar':
      return client.validateTokenGrammar(input as any);
    case 'list_system_strategies':
      return client.listSystemStrategies(input as any);
    case 'get_system_strategy':
      return client.getSystemStrategy(requiredString(input, 'key'));
    case 'copy_system_strategy':
      return client.copySystemStrategy(
        requiredString(input, 'key'),
        omit(input, ['key']),
      );
    case 'list_blocks':
      return client.listBlocks(input as any);
    case 'get_block':
      return client.getBlock(requiredString(input, 'blockId'));
    case 'compile_block':
      return client.compileBlock(input as any);
    case 'validate_block':
      return client.validateBlock(input as any);
    case 'create_block':
      return client.createBlock(input as any);
    case 'update_block':
      return client.updateBlock(
        requiredString(input, 'blockId'),
        omit(input, ['blockId']) as any,
      );
    case 'delete_block':
      return client.deleteBlock(requiredString(input, 'blockId'));
    case 'validate_strategy':
      return client.validateStrategy(input as any);
    case 'list_strategies':
      return client.listStrategies(input as any);
    case 'create_strategy':
      return client.createStrategy(input as any);
    case 'get_strategy':
      return client.getStrategy(requiredString(input, 'strategyId'));
    case 'update_strategy':
      return client.updateStrategy(
        requiredString(input, 'strategyId'),
        omit(input, ['strategyId']),
      );
    case 'trash_strategy':
      return client.trashStrategy(requiredString(input, 'strategyId'), {
        confirm: true,
      });
    case 'restore_strategy':
      return client.restoreStrategy(requiredString(input, 'strategyId'));
    case 'purge_strategy':
      return client.purgeStrategy(requiredString(input, 'strategyId'), {
        confirm: true,
      });
    case 'create_strategy_version':
      return client.createStrategyVersion(
        requiredString(input, 'strategyId'),
        omit(input, ['strategyId']) as any,
      );
    case 'get_strategy_version':
      return client.getStrategyVersion(
        requiredString(input, 'strategyId'),
        requiredNumber(input, 'version'),
      );
    case 'update_strategy_version':
      return client.updateStrategyVersion(
        requiredString(input, 'strategyId'),
        requiredNumber(input, 'version'),
        omit(input, ['strategyId', 'version']) as any,
      );
    case 'finalize_strategy_version':
      return client.finalizeStrategyVersion(
        requiredString(input, 'strategyId'),
        omit(input, ['strategyId']) as any,
      );
    case 'delete_strategy_version':
      return client.deleteStrategyVersion(
        requiredString(input, 'strategyId'),
        requiredNumber(input, 'version'),
      );
    case 'archive_strategy_version':
      return client.archiveStrategyVersion(
        requiredString(input, 'strategyId'),
        requiredNumber(input, 'version'),
      );
    case 'restore_strategy_version':
      return client.restoreStrategyVersion(
        requiredString(input, 'strategyId'),
        requiredNumber(input, 'version'),
      );
    case 'create_pine_export':
      return client.createPineExport(
        requiredString(input, 'strategyId'),
        requiredNumber(input, 'version'),
        omit(input, ['strategyId', 'version']),
      );
    case 'list_backtests':
      return client.listBacktests(input as any);
    case 'run_backtest':
      return client.runBacktest(input as any);
    case 'get_backtest':
      return client.getBacktest(requiredString(input, 'backtestId'));
    case 'get_backtest_progress':
      return client.getBacktestProgress(requiredString(input, 'backtestId'));
    case 'get_backtest_chart_data':
      return client.getBacktestChartData(
        requiredString(input, 'backtestId'),
        omit(input, ['backtestId']) as any,
      );
    case 'get_backtest_price_preview':
      return client.getBacktestPricePreview(
        requiredString(input, 'backtestId'),
      );
    case 'set_primary_backtest':
      return client.setPrimaryBacktest(requiredString(input, 'backtestId'));
    case 'delete_backtest':
      return client.deleteBacktest(requiredString(input, 'backtestId'));
    case 'wait_backtest':
      return client.waitForBacktestCompletion(
        requiredString(input, 'backtestId'),
        {
          intervalMs: clamp(asNumber(input.intervalMs) ?? 3_000, 1_000, 30_000),
          timeoutMs: clamp(
            asNumber(input.timeoutMs) ?? 240_000,
            5_000,
            600_000,
          ),
        },
      );
    case 'preview_robustness_analysis':
      return client.previewRobustnessAnalysis(input as any);
    case 'create_robustness_analysis':
      return client.createRobustnessAnalysis(input as any);
    case 'list_analysis_runs':
      return client.listAnalysisRuns(input as any);
    case 'get_analysis_run':
      return client.getAnalysisRun(requiredString(input, 'analysisRunId'));
    case 'update_analysis_run':
      return client.updateAnalysisRun(
        requiredString(input, 'analysisRunId'),
        omit(input, ['analysisRunId']),
      );
    case 'delete_analysis_run':
      return client.deleteAnalysisRun(requiredString(input, 'analysisRunId'));
    case 'wait_analysis_run':
      return client.waitForAnalysisRun(requiredString(input, 'analysisRunId'), {
        intervalMs: clamp(asNumber(input.intervalMs) ?? 3_000, 1_000, 30_000),
        timeoutMs: clamp(asNumber(input.timeoutMs) ?? 240_000, 5_000, 600_000),
      });
    case 'list_comparison_sets':
      return client.listComparisonSets(input as any);
    case 'get_comparison_set':
      return client.getComparisonSet(requiredString(input, 'comparisonSetId'));
    case 'create_comparison_set':
      return client.createComparisonSet(input as any);
    case 'update_comparison_set':
      return client.updateComparisonSet(
        requiredString(input, 'comparisonSetId'),
        omit(input, ['comparisonSetId']) as any,
      );
    case 'delete_comparison_set':
      return client.deleteComparisonSet(
        requiredString(input, 'comparisonSetId'),
      );
    case 'create_signal_monitor':
      return client.createSignalMonitor(input as any);
    case 'list_signal_monitors':
      return client.listSignalMonitors(input as any);
    case 'get_signal_monitor':
      return client.getSignalMonitor(requiredString(input, 'monitorId'));
    case 'update_signal_monitor':
      return client.updateSignalMonitor(
        requiredString(input, 'monitorId'),
        omit(input, ['monitorId']) as any,
      );
    case 'delete_signal_monitor':
      return client.deleteSignalMonitor(requiredString(input, 'monitorId'));
    case 'list_signal_events':
      return client.listSignalEvents(input as any);
    case 'get_signal_event':
      return client.getSignalEvent(requiredString(input, 'eventId'));
    case 'create_webhook_endpoint':
      return client.createWebhookEndpoint(input as any);
    case 'list_webhook_endpoints':
      return client.listWebhookEndpoints();
    case 'update_webhook_endpoint':
      return client.updateWebhookEndpoint(
        requiredString(input, 'webhookEndpointId'),
        omit(input, ['webhookEndpointId']) as any,
      );
    case 'delete_webhook_endpoint':
      return client.deleteWebhookEndpoint(
        requiredString(input, 'webhookEndpointId'),
      );
    case 'test_webhook_endpoint':
      return client.testWebhookEndpoint(
        requiredString(input, 'webhookEndpointId'),
      );
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unhandled operation: ${_exhaustive}`);
    }
  }
}
