import {
  OPERATION_REGISTRY,
  type OperationDefinition,
  type OperationName,
} from '../generated/operation-registry.js';

export type McpProfile = 'guided' | 'full';

export const DEFAULT_MCP_PROFILE: McpProfile = 'guided';

/**
 * Read-only platform operations exposed in the `guided` profile alongside the
 * agent-local guided/semantic/repair tools. Write/destructive/long-running
 * operations require `full`. Keep this list narrow on purpose: every entry an
 * agent sees is an entry it might call before validation.
 */
export const GUIDED_PLATFORM_OPS: ReadonlySet<OperationName> =
  new Set<OperationName>([
    'get_manifest',
    'get_health',
    'get_workspace_context',
    'get_usage',
    'get_capabilities',
    'list_strategies',
    'get_strategy',
    'list_backtests',
    'get_backtest',
    'get_backtest_chart_data',
    'list_comparison_sets',
    'get_comparison_set',
    'list_analysis_runs',
    'get_analysis_run',
    'list_system_strategies',
    'get_system_strategy',
    'validate_strategy',
  ]);

export function parseMcpProfile(value: unknown): McpProfile {
  return value === 'full' ? 'full' : 'guided';
}

export function platformOperationsForProfile(
  profile: McpProfile,
): readonly OperationDefinition[] {
  if (profile === 'full') {
    return OPERATION_REGISTRY;
  }
  return OPERATION_REGISTRY.filter((op) =>
    GUIDED_PLATFORM_OPS.has(op.name as OperationName),
  );
}

/**
 * Stage classification used to decorate tool descriptions in `full` profile
 * so agents see explicit "do not call before validate" affordances.
 */
export type OperationStage = 'read' | 'write' | 'destructive';

export function operationStage(op: OperationDefinition): OperationStage {
  if (op.destructive) return 'destructive';
  return op.endpoint.method === 'GET' ? 'read' : 'write';
}
