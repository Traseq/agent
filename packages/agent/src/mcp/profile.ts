import {
  OPERATION_REGISTRY,
  type OperationDefinition,
  type OperationName,
} from '../generated/operation-registry.js';

export const MCP_PROFILE_VALUES = [
  'hybrid',
  'template',
  'authoring',
  'reference',
  'full',
] as const;

export type McpProfile = (typeof MCP_PROFILE_VALUES)[number];

export const DEFAULT_MCP_PROFILE: McpProfile = 'hybrid';

export function formatMcpProfileList(): string {
  return MCP_PROFILE_VALUES.join(', ');
}

/**
 * Safe platform operations for non-full authoring profiles. They are read-only
 * GETs or side-effect-free validation/compile POSTs.
 */
export const SAFE_PLATFORM_OPS: ReadonlySet<OperationName> =
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
    'get_backtest_price_preview',
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
  ]);

export const REFERENCE_PLATFORM_OPS: ReadonlySet<OperationName> =
  new Set<OperationName>([
    'get_manifest',
    'get_health',
    'get_capabilities',
    'get_token_grammar_document',
    'list_system_strategies',
    'get_system_strategy',
    'list_blocks',
    'get_block',
  ]);

const WORKFLOW_TOOLS = [
  'start_research_engagement',
  'run_guided_research_round',
  'summarize_research_engagement',
  'update_research_engagement',
] as const;

const REFERENCE_TOOLS = [
  'get_authoring_examples',
  'resolve_instrument',
  'get_semantics',
  'get_token_grammar',
  'get_token_semantics',
] as const;

const TEMPLATE_TOOLS = [
  ...WORKFLOW_TOOLS,
  'explain_validation_issues',
  'resolve_instrument',
  'compose_strategy_from_template',
  'get_authoring_examples',
  'get_token_grammar',
  'materialize_token_ast',
  'validate_token_grammar_candidate',
  'get_token_semantics',
  'compose_token_block',
  'validate_token_block',
  'assemble_strategy_from_blocks',
] as const;

const AUTHORING_TOOLS = [
  ...WORKFLOW_TOOLS,
  'get_authoring_examples',
  'resolve_instrument',
  'get_semantics',
  'resolve_strategy_semantics',
  'assemble_signal_graph',
  'preflight_strategy_draft',
  'explain_validation_issues',
  'suggest_minimal_repairs',
] as const;

// Hybrid is the default routing profile: one entry point per authoring path,
// plus diagnostics. Specialists who want the full token-grammar surface should
// switch to `template`; SG v2 power-users to `authoring`. Keeping hybrid lean
// avoids tripping the Claude Desktop tools/list deferred-tool threshold (~30
// entries forces a ToolSearch round-trip on the first call).
const HYBRID_TOOLS = [
  ...WORKFLOW_TOOLS,
  'explain_validation_issues',
  'resolve_instrument',
  'compose_strategy_from_template',
  'compose_token_block',
  'assemble_strategy_from_blocks',
  'resolve_strategy_semantics',
  'assemble_signal_graph',
  'preflight_strategy_draft',
  'suggest_minimal_repairs',
  'get_authoring_examples',
  'get_token_semantics',
] as const;

export const AGENT_TOOL_NAMES_BY_PROFILE: Readonly<
  Record<Exclude<McpProfile, 'full'>, ReadonlySet<string>>
> = {
  hybrid: new Set<string>(HYBRID_TOOLS),
  template: new Set<string>(TEMPLATE_TOOLS),
  authoring: new Set<string>(AUTHORING_TOOLS),
  reference: new Set<string>(REFERENCE_TOOLS),
};

/**
 * Returns the agent-tool allowlist for a profile, or `undefined` for `full`.
 * `undefined` is the sentinel for "no allowlist" — callers should expose every
 * registered agent tool. Non-full profiles always have a finite allowlist.
 */
export function agentToolNamesForProfile(
  profile: McpProfile,
): ReadonlySet<string> | undefined {
  return profile === 'full' ? undefined : AGENT_TOOL_NAMES_BY_PROFILE[profile];
}

export function parseMcpProfile(value: unknown): McpProfile {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_MCP_PROFILE;
  }
  if (
    typeof value === 'string' &&
    (MCP_PROFILE_VALUES as readonly string[]).includes(value)
  ) {
    return value as McpProfile;
  }
  throw new Error(
    `Invalid MCP profile "${String(value)}". Expected one of: ${formatMcpProfileList()}.`,
  );
}

export function platformOperationsForProfile(
  profile: McpProfile,
): readonly OperationDefinition[] {
  if (profile === 'full') {
    return OPERATION_REGISTRY;
  }
  const allowlist =
    profile === 'reference' ? REFERENCE_PLATFORM_OPS : SAFE_PLATFORM_OPS;
  return OPERATION_REGISTRY.filter((op) =>
    allowlist.has(op.name as OperationName),
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
