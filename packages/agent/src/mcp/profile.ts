import {
  OPERATION_REGISTRY,
  type OperationDefinition,
  type OperationName,
} from '../generated/operation-registry.js';

export type McpProfile = 'guided' | 'full';

export const DEFAULT_MCP_PROFILE: McpProfile = 'guided';

/**
 * Read-only platform operations exposed in the `guided` profile alongside the
 * agent-local guided/semantic/repair tools, plus `run_backtest` (non-destructive
 * write — creates a backtest record against an existing strategy version, used
 * when an agent wants to re-test a validated version with a different range or
 * config without re-running the full validate→persist→backtest pipeline). Other
 * write/destructive/long-running operations require `full`. Keep this list
 * narrow on purpose: every entry an agent sees is an entry it might call before
 * validation.
 */
export const GUIDED_PLATFORM_OPS: ReadonlySet<OperationName> =
  new Set<OperationName>([
    'get_manifest',
    'get_health',
    'get_workspace_context',
    'get_usage',
    'get_capabilities',
    'get_token_grammar_document',
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
    'list_blocks',
    'get_block',
    'compile_block',
    'validate_block',
    'validate_strategy',
    'run_backtest',
  ]);

/**
 * Agent-side tools surfaced in `guided` mode. Token semantic composition tools
 * stay visible because they are the guided path for editable blocks. Anything
 * not on this list is
 * treated as an advanced helper: the LLM can still reach it under `--profile=full`,
 * but in guided mode we keep tools/list trim so Claude Desktop and other clients
 * don't fall over MCP defer thresholds (which fire at high tool counts and add
 * a ToolSearch round-trip per call). Each entry should map to a verb the user
 * actually narrates ("start engagement", "run a guided round", "summarize",
 * "explain validation"). Internals like resolve/assemble/preflight are reachable
 * inside run_guided_research_round and don't need their own surface area.
 */
export const GUIDED_AGENT_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  'start_research_engagement',
  'run_guided_research_round',
  'summarize_research_engagement',
  'explain_validation_issues',
  'compose_strategy_from_template',
  'get_token_grammar',
  'materialize_token_ast',
  'validate_token_grammar_candidate',
  'get_token_semantics',
  'compose_token_block',
  'validate_token_block',
  'assemble_strategy_from_blocks',
  'update_research_engagement',
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

const SIDE_EFFECT_FREE_POST_OPS = new Set<string>([
  'validate_strategy',
  'compile_block',
  'validate_block',
  'materialize_token_grammar',
  'validate_token_grammar',
  'estimate_backtest_cost',
]);

export function operationStage(op: OperationDefinition): OperationStage {
  if (op.destructive) return 'destructive';
  if (SIDE_EFFECT_FREE_POST_OPS.has(op.name)) return 'read';
  return op.endpoint.method === 'GET' ? 'read' : 'write';
}
