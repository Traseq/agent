import {
  assembleSignalGraphDraft,
  preflightStrategyDraft,
  type AssembleSignalGraphDraftInput,
  type CapabilityDocument,
  type SemanticBlock,
  type SemanticBlockRole,
  type TokenBlockCompileResponse,
  type TokenDto,
  type TraseqClient,
} from '../client/index.js';
import { asJsonObject, asNumber, asString } from '../normalize.js';
import { evaluateResearchResult } from '../evaluation.js';
import {
  runGuidedResearchRound,
  startResearchEngagement,
  summarizeResearchEngagement,
  updateResearchEngagement,
  type ResearchEngagementPatch,
} from '../guided-research.js';
import { formatResearchReport } from '../report.js';
import { runResearchRunner } from '../research-runner.js';
import { summarizeUsageHints } from '../usage-hints.js';
import { getSemantics, resolveStrategySemantics } from './resolver.js';
import { explainValidationIssues, suggestMinimalRepairs } from './repair.js';
import { normalizeStrategyDraft } from './normalize-draft.js';
import { SEMANTIC_FACETS, SEMANTIC_IMPLEMENTATIONS } from './ontology.js';
import {
  TOKEN_RECIPES,
  cloneTokenRecipe,
  findTokenRecipe,
  findTokenRecipeForImplementation,
  tokenRoleForSemanticRole,
} from './token-recipes.js';
import {
  AUTHORING_PREFERENCE_VALUES,
  type GuidedResearchRoundInput,
  type ResearchContextClient,
  type ResearchEngagementInput,
  type ResearchResultEvaluation,
  type ResearchRunnerClient,
  type ResearchRunnerResult,
  type StrategyDraftLike,
  type Timeframe,
  type ValidationSummaryLike,
} from '../types.js';
import type {
  GetSemanticsInput,
  ResolveStrategySemanticsInput,
  SemanticImplementationDefinition,
  SignalGraphFragment,
  TokenRecipeDefinition,
} from './types.js';

export interface AgentToolDefinition {
  readonly name:
    | 'get_semantics'
    | 'get_token_grammar'
    | 'materialize_token_ast'
    | 'validate_token_grammar_candidate'
    | 'get_token_semantics'
    | 'get_authoring_examples'
    | 'compose_token_block'
    | 'validate_token_block'
    | 'assemble_strategy_from_blocks'
    | 'resolve_strategy_semantics'
    | 'assemble_signal_graph'
    | 'preflight_strategy_draft'
    | 'start_research_engagement'
    | 'run_guided_research_round'
    | 'summarize_research_engagement'
    | 'run_research_draft'
    | 'evaluate_research_result'
    | 'format_research_report'
    | 'explain_validation_issues'
    | 'suggest_minimal_repairs'
    | 'compose_strategy_from_template'
    | 'update_research_engagement';
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
  readonly local: true;
}

export type AgentToolName = AgentToolDefinition['name'];

const objectProp = { type: 'object', additionalProperties: true } as const;
const stringProp = { type: 'string' } as const;
const booleanProp = { type: 'boolean' } as const;
const numberProp = { type: 'number' } as const;

const TIMEFRAME_VALUES = ['15m', '1h', '4h', '1d'] as const;
const POSITION_STYLE_VALUES = ['single', 'pyramid', 'accumulate'] as const;
const RISK_TOLERANCE_VALUES = [
  'conservative',
  'moderate',
  'aggressive',
] as const;
const TOKEN_BLOCK_ROLE_VALUES = [
  'entry_trigger',
  'context_filter',
  'confirmation_filter',
  'exit',
] as const;
const TOKEN_RECIPE_ROLE_VALUES = [...TOKEN_BLOCK_ROLE_VALUES, 'risk'] as const;

const PROMPT_MIN_LENGTH = 12;

function enumProp<T extends string>(values: readonly T[]) {
  return { type: 'string', enum: [...values] } as const;
}

function objectSchema(
  properties: Record<string, unknown>,
  required: readonly string[] = [],
) {
  return {
    type: 'object',
    additionalProperties: false,
    ...(required.length > 0 ? { required: [...required] } : {}),
    properties,
  };
}

const EMPTY_SCHEMA = objectSchema({});

interface PreflightWarningIssue {
  code: string;
  path: string;
  field: string;
  message: string;
  severity: 'warning';
  suggestion?: string;
}

function tierAwarePreflightIssues(
  draft: Record<string, unknown>,
  capabilities: unknown,
): PreflightWarningIssue[] {
  const caps = asJsonObject(capabilities);
  const limits = asJsonObject(caps?.limits);
  if (!limits) return [];
  const signalGraph = asJsonObject(draft.signalGraph);
  const strategy = asJsonObject(signalGraph?.strategy);
  if (!strategy) return [];

  const issues: PreflightWarningIssue[] = [];

  const entry = asJsonObject(strategy.entry);
  const filters = Array.isArray(entry?.filters) ? entry.filters : undefined;
  const maxEntryConditions =
    typeof limits.maxEntryConditions === 'number'
      ? limits.maxEntryConditions
      : undefined;
  if (filters && maxEntryConditions !== undefined) {
    // +1 because the trigger ref also counts as a condition under the public
    // condition-limit semantics (mirrors how the backend's
    // version-validation.service counts entries).
    const entryConditionCount = filters.length + 1;
    if (entryConditionCount > maxEntryConditions) {
      issues.push({
        code: 'tier_entry_condition_limit',
        path: 'signalGraph.strategy.entry.filters',
        field: 'signalGraph',
        severity: 'warning',
        message: `Entry has ${entryConditionCount} conditions (trigger + ${filters.length} filters) but the current tier caps maxEntryConditions at ${maxEntryConditions}. validate_strategy will reject this; reduce filters or upgrade.`,
        suggestion:
          'Combine related filters with a logical "all" or "any" node so the entry uses fewer top-level filters.',
      });
    }
  }

  const exits = Array.isArray(strategy.exits) ? strategy.exits : undefined;
  const maxExitConditions =
    typeof limits.maxExitConditions === 'number'
      ? limits.maxExitConditions
      : undefined;
  const maxExits =
    typeof limits.maxExits === 'number' ? limits.maxExits : undefined;
  if (exits) {
    if (maxExits !== undefined && exits.length > maxExits) {
      issues.push({
        code: 'tier_exit_limit',
        path: 'signalGraph.strategy.exits',
        field: 'signalGraph',
        severity: 'warning',
        message: `Strategy has ${exits.length} exit blocks but the current tier caps maxExits at ${maxExits}. Merge them with an "any" logical node so the strategy uses a single exit block referencing the merged condition.`,
        suggestion:
          'Add a logic node {kind: "logic", op: "any", inputs: [<each exit cond ref>]} and point the single exit at it.',
      });
    }
    if (maxExitConditions !== undefined) {
      // Sum exit conditions across all exit blocks (each exit "when" ref is
      // one, plus any filters within). Matches the backend tier counter.
      let totalExitConditions = 0;
      for (const exitNode of exits) {
        const exitObj = asJsonObject(exitNode);
        if (!exitObj) continue;
        totalExitConditions += 1; // the when ref
        const exitFilters = Array.isArray(exitObj.filters)
          ? exitObj.filters
          : undefined;
        if (exitFilters) totalExitConditions += exitFilters.length;
      }
      if (totalExitConditions > maxExitConditions) {
        issues.push({
          code: 'tier_exit_condition_limit',
          path: 'signalGraph.strategy.exits',
          field: 'signalGraph',
          severity: 'warning',
          message: `Exit logic has ${totalExitConditions} conditions but the current tier caps maxExitConditions at ${maxExitConditions}. Simplify the exit logic before calling validate_strategy.`,
        });
      }
    }
  }

  return issues;
}

export const AGENT_TOOL_REGISTRY: readonly AgentToolDefinition[] = [
  {
    name: 'get_semantics',
    description:
      'Read the local Traseq semantic ontology used by the agent-side resolver.',
    local: true,
    input_schema: objectSchema({
      family: stringProp,
      includeFragments: booleanProp,
    }),
  },
  {
    name: 'get_token_grammar',
    description:
      'Read the public AST/token grammar contract for block/template authoring and reference examples. SG v2 direct authoring remains the primary path for concrete custom strategies.',
    local: true,
    input_schema: EMPTY_SCHEMA,
  },
  {
    name: 'materialize_token_ast',
    description:
      'Materialize a StrategyAstV1 or BoolExpr into legal TokenDto through the public token grammar compiler. Use for block/template authoring; concrete custom strategies may author SG v2 directly.',
    local: true,
    input_schema: objectSchema({
      role: enumProp(TOKEN_BLOCK_ROLE_VALUES),
      ast: objectProp,
      expr: objectProp,
      includeFragment: booleanProp,
    }),
  },
  {
    name: 'validate_token_grammar_candidate',
    description:
      'Validate AST-first or token-first grammar candidates before assembly. Uses public grammar validation when a Traseq client is configured; raw tokens get local shape checks as a fallback.',
    local: true,
    input_schema: objectSchema({
      role: enumProp(TOKEN_BLOCK_ROLE_VALUES),
      ast: objectProp,
      expr: objectProp,
      tokens: {
        type: 'array',
        items: objectProp,
      },
      includeFragment: booleanProp,
    }),
  },
  {
    name: 'get_token_semantics',
    description:
      'Read deterministic token recipes and token-block grammar. Recipes are exact-match macros for block/template authoring, not the only strategy authoring path.',
    local: true,
    input_schema: objectSchema({
      role: enumProp(TOKEN_RECIPE_ROLE_VALUES),
      family: stringProp,
      includeTokens: booleanProp,
      includeFragments: booleanProp,
    }),
  },
  {
    name: 'get_authoring_examples',
    description:
      'Read-only reference examples for choosing template/block, hybrid, or direct SG v2 authoring. Does not compose or validate blocks.',
    local: true,
    input_schema: objectSchema({
      pattern: stringProp,
      mode: enumProp(['template', 'block', 'hybrid', 'sg_v2'] as const),
      includeSignalGraph: booleanProp,
    }),
  },
  {
    name: 'compose_token_block',
    description:
      'Compose one semantic token block only when a deterministic recipe exactly matches the intended strategy facet. Returns legal TokenDto, block role, SignalGraph fragment, rationale, and tradeoffs.',
    local: true,
    input_schema: objectSchema({
      recipeId: stringProp,
      implementationId: stringProp,
      semanticId: stringProp,
      role: enumProp(TOKEN_RECIPE_ROLE_VALUES),
      params: objectProp,
      capabilities: objectProp,
    }),
  },
  {
    name: 'validate_token_block',
    description:
      'Validate a recipe-composed token block. Local checks enforce recipe/shape; when a Traseq client exposes public block validation, it validates the TokenDto remotely.',
    local: true,
    input_schema: objectSchema({
      recipeId: stringProp,
      implementationId: stringProp,
      semanticId: stringProp,
      role: enumProp(TOKEN_RECIPE_ROLE_VALUES),
      params: objectProp,
      tokens: {
        type: 'array',
        items: objectProp,
      },
    }),
  },
  {
    name: 'assemble_strategy_from_blocks',
    description:
      'Assemble recipe blocks, remote-compiled workspace token blocks, or explicit fragments into a complete SignalGraph draft, then run local preflight. Use for template/block or hybrid paths.',
    local: true,
    input_schema: objectSchema(
      {
        blocks: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              blockId: stringProp,
              recipeId: stringProp,
              implementationId: stringProp,
              semanticId: stringProp,
              role: enumProp(TOKEN_RECIPE_ROLE_VALUES),
              params: objectProp,
              tokens: { type: 'array', items: objectProp },
              fragment: objectProp,
            },
          },
        },
        name: stringProp,
        description: stringProp,
        settings: objectProp,
        backtest: objectProp,
        instrument: stringProp,
        timeframe: enumProp(TIMEFRAME_VALUES),
        initialBalance: numberProp,
        side: enumProp(['long', 'short'] as const),
        sizing: objectProp,
        capabilities: objectProp,
      },
      ['blocks'],
    ),
  },
  {
    name: 'resolve_strategy_semantics',
    description:
      'Resolve strategy intent facets into capability-grounded signalGraph fragments. Local agent tool; fetches get_capabilities when capabilities are not supplied.',
    local: true,
    input_schema: objectSchema({
      facets: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id'],
          properties: {
            id: stringProp,
            role: stringProp,
            weight: { type: 'number' },
          },
        },
      },
      prompt: stringProp,
      constraints: objectProp,
      capabilities: objectProp,
      includeUnavailable: booleanProp,
    }),
  },
  {
    name: 'assemble_signal_graph',
    description:
      'Assemble resolver fragments with assemblyHints into a complete SignalGraph strategy draft, then run local preflight validation. Primary path for concrete custom SG v2 strategies.',
    local: true,
    input_schema: objectSchema(
      {
        name: stringProp,
        description: stringProp,
        fragments: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: true,
            required: ['nodes'],
            properties: {
              nodes: {
                type: 'array',
                minItems: 1,
                items: objectProp,
              },
              assemblyHints: objectProp,
              settingsHints: objectProp,
            },
          },
        },
        settings: objectProp,
        backtest: objectProp,
        instrument: stringProp,
        timeframe: enumProp(TIMEFRAME_VALUES),
        initialBalance: numberProp,
        side: enumProp(['long', 'short'] as const),
        sizing: objectProp,
        capabilities: objectProp,
      },
      ['fragments'],
    ),
  },
  {
    name: 'preflight_strategy_draft',
    description:
      'Validate a complete strategy draft locally before calling remote validate_strategy. Catches schema, ref, and bool/value/series issues without API budget.',
    local: true,
    input_schema: objectSchema(
      {
        draft: objectProp,
        capabilities: objectProp,
      },
      ['draft'],
    ),
  },
  {
    name: 'start_research_engagement',
    description:
      'Start a service-style Traseq research engagement. Reads live workspace context, usage, and capabilities, then returns assumptions, intent maturity, recommended authoring mode, tool paths, evidence boundaries, and provider-agnostic authoring instructions.',
    local: true,
    input_schema: objectSchema(
      {
        prompt: { type: 'string', minLength: PROMPT_MIN_LENGTH },
        instrument: stringProp,
        timeframe: enumProp(TIMEFRAME_VALUES),
        rounds: numberProp,
        objective: stringProp,
        initialBalance: numberProp,
        warmupPeriod: numberProp,
        positionStyle: enumProp(POSITION_STYLE_VALUES),
        maxConcurrentPositions: numberProp,
        riskTolerance: enumProp(RISK_TOLERANCE_VALUES),
        authoringPreference: enumProp(AUTHORING_PREFERENCE_VALUES),
      },
      ['prompt'],
    ),
  },
  {
    name: 'run_guided_research_round',
    description:
      'Run one externally-authored strategy draft as a guided research service round: validate, persist (create or version) only after validation, backtest, evaluate evidence, and return a service memo. Provider-agnostic; caller authors the draft. Pass `strategyId` when iterating on an existing strategy — the runner persists the draft as a new version under that id instead of creating a new strategy. Omit `strategyId` to create a brand-new strategy. Optionally pass `forkedFromVersionId` alongside `strategyId` to preserve lineage from a prior finalized version.',
    local: true,
    input_schema: objectSchema(
      {
        prompt: { type: 'string', minLength: PROMPT_MIN_LENGTH },
        draft: objectProp,
        instrument: stringProp,
        timeframe: enumProp(TIMEFRAME_VALUES),
        initialBalance: numberProp,
        warmupPeriod: numberProp,
        positionStyle: enumProp(POSITION_STYLE_VALUES),
        maxConcurrentPositions: numberProp,
        riskTolerance: enumProp(RISK_TOLERANCE_VALUES),
        pollIntervalMs: numberProp,
        timeoutMs: numberProp,
        producerTimeoutMs: numberProp,
        strategyId: stringProp,
        forkedFromVersionId: stringProp,
      },
      ['prompt', 'draft'],
    ),
  },
  {
    name: 'summarize_research_engagement',
    description:
      'Render a guided research round or runResearchRunner result into a user-facing service memo. Pure local JSON tool.',
    local: true,
    input_schema: objectSchema(
      {
        result: objectProp,
        evaluation: objectProp,
      },
      ['result'],
    ),
  },
  {
    name: 'run_research_draft',
    description:
      'Run one externally-authored strategy draft through validate, persist (create or version), finalize, backtest, wait, evaluate, and report. Single round, no validation-repair loop — caller is responsible for repairing rejected drafts. Pass `strategyId` to persist the draft as a new version under that strategy; omit it to create a brand-new strategy. Optionally pass `forkedFromVersionId` alongside `strategyId` to preserve lineage from a prior finalized version. Uses the configured Traseq client.',
    local: true,
    input_schema: objectSchema(
      {
        prompt: { type: 'string', minLength: PROMPT_MIN_LENGTH },
        draft: objectProp,
        instrument: stringProp,
        timeframe: enumProp(TIMEFRAME_VALUES),
        initialBalance: numberProp,
        warmupPeriod: numberProp,
        positionStyle: enumProp(POSITION_STYLE_VALUES),
        maxConcurrentPositions: numberProp,
        pollIntervalMs: numberProp,
        timeoutMs: numberProp,
        producerTimeoutMs: numberProp,
        strategyId: stringProp,
        forkedFromVersionId: stringProp,
      },
      ['prompt', 'draft'],
    ),
  },
  {
    name: 'evaluate_research_result',
    description:
      'Evaluate a runResearchRunner JSON result into confidence, risk flags, and a next decision. Pure local JSON tool.',
    local: true,
    input_schema: objectSchema({ result: objectProp }, ['result']),
  },
  {
    name: 'format_research_report',
    description:
      'Format a runResearchRunner JSON result and optional evaluation into a human-readable Markdown report. Pure local JSON tool.',
    local: true,
    input_schema: objectSchema(
      {
        result: objectProp,
        evaluation: objectProp,
      },
      ['result'],
    ),
  },
  {
    name: 'explain_validation_issues',
    description:
      'Map a validateStrategy result into structured human reasons, suggested fixes, and ontology hints per issue. Pure local JSON tool; deterministic mapping, no AI calls.',
    local: true,
    input_schema: objectSchema(
      {
        validation: objectProp,
        draft: objectProp,
      },
      ['validation'],
    ),
  },
  {
    name: 'suggest_minimal_repairs',
    description:
      'Propose the smallest set of JSON patches that would make a rejected draft validate. Heuristic and deterministic; the agent applies and re-validates. Returns unaddressed structural issues separately.',
    local: true,
    input_schema: objectSchema(
      {
        draft: objectProp,
        validation: objectProp,
      },
      ['draft', 'validation'],
    ),
  },
  {
    name: 'update_research_engagement',
    description:
      'Patch an existing in-memory research engagement (riskTolerance, instrument, timeframe, positionStyle, objective, initialBalance, maxConcurrentPositions, authoringPreference) without re-running the manifest/workspace/usage/capabilities fetch. Use after start_research_engagement when the user adjusts a parameter mid-conversation. State is per-process and resets when the MCP server restarts.',
    local: true,
    input_schema: objectSchema(
      {
        runId: stringProp,
        riskTolerance: enumProp(RISK_TOLERANCE_VALUES),
        instrument: stringProp,
        timeframe: enumProp(TIMEFRAME_VALUES),
        positionStyle: enumProp(POSITION_STYLE_VALUES),
        objective: stringProp,
        initialBalance: numberProp,
        maxConcurrentPositions: numberProp,
        authoringPreference: enumProp(AUTHORING_PREFERENCE_VALUES),
      },
      ['runId'],
    ),
  },
  {
    name: 'compose_strategy_from_template',
    description:
      'Fork a Traseq system strategy template and produce a draft (signalGraph + settings) that has already passed local preflight. Avoids hand-authoring 10+ node signal graphs from scratch — pass templateKey plus optional name/description and a settings override (shallow merged into the template settings). The returned draft can be passed straight to run_guided_research_round or validate_strategy.',
    local: true,
    input_schema: objectSchema(
      {
        templateKey: stringProp,
        name: stringProp,
        description: stringProp,
        settingsOverride: objectProp,
        capabilities: objectProp,
      },
      ['templateKey'],
    ),
  },
];

export function getAgentToolDefinition(
  name: string,
): AgentToolDefinition | undefined {
  return AGENT_TOOL_REGISTRY.find((tool) => tool.name === name);
}

async function getCapabilitiesIfNeeded(
  input: ResolveStrategySemanticsInput,
  client?: Pick<TraseqClient, 'getCapabilities'>,
): Promise<CapabilityDocument> {
  const supplied = asJsonObject(input.capabilities);
  if (supplied) {
    return supplied;
  }

  if (!client) {
    throw new Error(
      [
        'resolve_strategy_semantics needs capabilities to ground candidates.',
        'Either pass `capabilities` in the tool input (offline mode), or supply a Traseq client (set TRASEQ_API_KEY) so it can call get_capabilities.',
      ].join(' '),
    );
  }

  return client.getCapabilities();
}

function isResearchRunnerClient(
  client: unknown,
): client is ResearchRunnerClient {
  if (typeof client !== 'object' || client === null) {
    return false;
  }

  // Cheap runtime guard — runBacktest is the load-bearing method that
  // distinguishes a research-capable client from a capabilities-only stub.
  // Full method coverage is enforced by the TypeScript signature at compile time.
  return (
    typeof (client as { runBacktest?: unknown }).runBacktest === 'function'
  );
}

function isResearchContextClient(
  client: unknown,
): client is ResearchContextClient {
  if (typeof client !== 'object' || client === null) {
    return false;
  }

  const candidate = client as {
    getManifest?: unknown;
    getWorkspaceContext?: unknown;
    getUsage?: unknown;
    getCapabilities?: unknown;
  };

  return (
    typeof candidate.getManifest === 'function' &&
    typeof candidate.getWorkspaceContext === 'function' &&
    typeof candidate.getUsage === 'function' &&
    typeof candidate.getCapabilities === 'function'
  );
}

type TokenRecipeRole = (typeof TOKEN_RECIPE_ROLE_VALUES)[number];

type AgentToolRuntimeClient = Partial<
  Pick<
    TraseqClient,
    | 'getCapabilities'
    | 'getTokenGrammar'
    | 'materializeTokenGrammar'
    | 'validateTokenGrammar'
    | 'getSystemStrategy'
    | 'getBlock'
    | 'compileBlock'
    | 'validateBlock'
  >
> &
  Partial<ResearchContextClient> &
  Partial<ResearchRunnerClient>;

interface ComposedTokenBlock {
  protocol: 'traseq.agent.token-block';
  version: 1;
  recipe: TokenRecipeDefinition;
  block: {
    recipeId: string;
    implementationId: string;
    role: TokenRecipeRole;
    tokenRole: string;
    produces: TokenRecipeDefinition['produces'];
    validAs: string[];
    semanticSummary: string;
    name: string;
    description: string;
    type: 'signal' | 'indicator';
    category: string;
    tokens: TokenDto[];
    params: Record<string, string | number>;
  };
  fragment: SignalGraphFragment;
  rationale: string;
  tradeoffs: SemanticImplementationDefinition['tradeoffs'];
  validationHints: string[];
}

function hasGetCapabilities(
  client: unknown,
): client is Pick<TraseqClient, 'getCapabilities'> {
  return (
    typeof client === 'object' &&
    client !== null &&
    typeof (client as { getCapabilities?: unknown }).getCapabilities ===
      'function'
  );
}

function hasGetTokenGrammar(
  client: unknown,
): client is Pick<TraseqClient, 'getTokenGrammar'> {
  return (
    typeof client === 'object' &&
    client !== null &&
    typeof (client as { getTokenGrammar?: unknown }).getTokenGrammar ===
      'function'
  );
}

function hasMaterializeTokenGrammar(
  client: unknown,
): client is Pick<TraseqClient, 'materializeTokenGrammar'> {
  return (
    typeof client === 'object' &&
    client !== null &&
    typeof (client as { materializeTokenGrammar?: unknown })
      .materializeTokenGrammar === 'function'
  );
}

function hasValidateTokenGrammar(
  client: unknown,
): client is Pick<TraseqClient, 'validateTokenGrammar'> {
  return (
    typeof client === 'object' &&
    client !== null &&
    typeof (client as { validateTokenGrammar?: unknown })
      .validateTokenGrammar === 'function'
  );
}

function hasCompileBlock(
  client: unknown,
): client is Pick<TraseqClient, 'compileBlock'> {
  return (
    typeof client === 'object' &&
    client !== null &&
    typeof (client as { compileBlock?: unknown }).compileBlock === 'function'
  );
}

function hasValidateBlock(
  client: unknown,
): client is Pick<TraseqClient, 'validateBlock'> {
  return (
    typeof client === 'object' &&
    client !== null &&
    typeof (client as { validateBlock?: unknown }).validateBlock === 'function'
  );
}

function hasGetBlock(
  client: unknown,
): client is Pick<TraseqClient, 'getBlock'> {
  return (
    typeof client === 'object' &&
    client !== null &&
    typeof (client as { getBlock?: unknown }).getBlock === 'function'
  );
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function visitObjects(
  value: unknown,
  visitor: (object: Record<string, unknown>) => void,
) {
  if (Array.isArray(value)) {
    for (const item of value) visitObjects(item, visitor);
    return;
  }
  if (typeof value !== 'object' || value === null) {
    return;
  }
  const object = value as Record<string, unknown>;
  visitor(object);
  for (const item of Object.values(object)) {
    visitObjects(item, visitor);
  }
}

function namespaceSlug(value: string): string {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toLowerCase() || 'block'
  );
}

function namespaceForAssembledBlock(
  block: Record<string, unknown>,
  index: number,
): string {
  const stablePart =
    asString(block.recipeId) ||
    asString(block.implementationId) ||
    asString(block.semanticId) ||
    asString(block.blockId) ||
    asString(block.source) ||
    'fragment';
  return `b${index + 1}_${namespaceSlug(stablePart)}`;
}

function namespaceSignalGraphFragment(
  fragment: SignalGraphFragment,
  namespace: string,
): SignalGraphFragment {
  const next = cloneJson(fragment);
  const nodes = Array.isArray(next.nodes) ? (next.nodes as unknown[]) : [];
  const refMap = new Map<string, string>();

  for (const node of nodes) {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) {
      continue;
    }
    const object = node as Record<string, unknown>;
    if (typeof object.id !== 'string' || object.id.length === 0) continue;
    const namespacedId = `${namespace}__${object.id}`;
    refMap.set(object.id, namespacedId);
    object.id = namespacedId;
  }

  if (refMap.size === 0) return next;

  visitObjects(next, (object) => {
    if (typeof object.ref !== 'string') return;
    const mapped = refMap.get(object.ref);
    if (mapped) object.ref = mapped;
  });

  return next;
}

function isTokenBlockRole(value: unknown): value is SemanticBlockRole {
  return (
    typeof value === 'string' &&
    TOKEN_BLOCK_ROLE_VALUES.includes(value as SemanticBlockRole)
  );
}

function isTokenRecipeRole(value: unknown): value is TokenRecipeRole {
  return (
    typeof value === 'string' &&
    TOKEN_RECIPE_ROLE_VALUES.includes(value as TokenRecipeRole)
  );
}

function implementationForRecipe(
  recipe: TokenRecipeDefinition,
): SemanticImplementationDefinition {
  const implementation = SEMANTIC_IMPLEMENTATIONS.find(
    (item) => item.id === recipe.implementationId,
  );
  if (!implementation) {
    throw new Error(
      `Token recipe ${recipe.recipeId} references missing implementation ${recipe.implementationId}.`,
    );
  }
  return implementation;
}

function familyForImplementation(
  implementation: SemanticImplementationDefinition,
): string {
  const facet = SEMANTIC_FACETS.find((item) =>
    implementation.semanticIds.includes(item.id),
  );
  return facet?.family ?? implementation.id.split('.')[0] ?? 'signals';
}

function categoryForFamily(family: string): string {
  if (family === 'trend') return 'Trend';
  if (family === 'momentum' || family === 'mean_reversion') return 'Momentum';
  if (family === 'volume') return 'Volume';
  if (
    family === 'volatility' ||
    family === 'compression_range' ||
    family === 'stateful_setup'
  ) {
    return 'Volatility';
  }
  if (family === 'market_structure' || family === 'temporal') return 'Market';
  return 'Signals';
}

function selectTokenRecipe(
  input: Record<string, unknown>,
): TokenRecipeDefinition {
  const role = asString(input.role);
  const roleMatches = (recipe: TokenRecipeDefinition) =>
    !role || recipe.role === role;

  const recipeId = asString(input.recipeId);
  if (recipeId) {
    const recipe = findTokenRecipe(recipeId);
    if (!recipe) {
      throw new Error(`Unknown token recipe: ${recipeId}.`);
    }
    if (!roleMatches(recipe)) {
      throw new Error(
        `Token recipe ${recipeId} has role ${recipe.role}, not ${role}.`,
      );
    }
    return cloneTokenRecipe(recipe);
  }

  const implementationId = asString(input.implementationId);
  if (implementationId) {
    const recipe = findTokenRecipeForImplementation(implementationId);
    if (!recipe) {
      throw new Error(
        `Implementation ${implementationId} does not have a token recipe.`,
      );
    }
    if (!roleMatches(recipe)) {
      throw new Error(
        `Implementation ${implementationId} has recipe role ${recipe.role}, not ${role}.`,
      );
    }
    return cloneTokenRecipe(recipe);
  }

  const semanticId = asString(input.semanticId);
  if (semanticId) {
    const facet = SEMANTIC_FACETS.find((item) => item.id === semanticId);
    const implementationIds =
      facet?.implementationIds ??
      SEMANTIC_IMPLEMENTATIONS.filter((item) =>
        item.semanticIds.includes(semanticId),
      ).map((item) => item.id);
    for (const id of implementationIds) {
      const recipe = findTokenRecipeForImplementation(id);
      if (recipe && roleMatches(recipe)) {
        return cloneTokenRecipe(recipe);
      }
    }
    throw new Error(
      `No token recipe found for semantic facet ${semanticId}${
        role ? ` with role ${role}` : ''
      }.`,
    );
  }

  throw new Error(
    'compose_token_block requires recipeId, implementationId, or semanticId.',
  );
}

function readRecipeParamRaw(
  supplied: Record<string, unknown>,
  param: TokenRecipeDefinition['params'][number],
): unknown {
  // Canonical name wins; aliases are a transitional fallback so legacy
  // callers that still pass e.g. `period` for a renamed `length` param keep
  // working. Order-stable scan so the first declared alias is preferred.
  if (param.name in supplied) return supplied[param.name];
  for (const alias of param.aliases ?? []) {
    if (alias in supplied) return supplied[alias];
  }
  return undefined;
}

function recipeParamValues(
  recipe: TokenRecipeDefinition,
  rawParams: unknown,
): Record<string, string | number> {
  const supplied = asJsonObject(rawParams) ?? {};
  const values: Record<string, string | number> = {};
  for (const param of recipe.params) {
    const raw = readRecipeParamRaw(supplied, param);
    if (param.type === 'number') {
      const numeric =
        asNumber(raw) ??
        (typeof raw === 'string' && raw.trim() !== ''
          ? Number(raw)
          : undefined);
      const fallback =
        typeof param.default === 'number' ? param.default : undefined;
      if (numeric !== undefined && Number.isFinite(numeric)) {
        values[param.name] = numeric;
      } else if (fallback !== undefined) {
        values[param.name] = fallback;
      }
      continue;
    }

    const text = asString(raw);
    const fallback = typeof param.default === 'string' ? param.default : '';
    const value = text || fallback;
    if (param.type === 'enum') {
      if (!value || !param.enumValues?.includes(value)) {
        throw new Error(
          `Invalid value for ${recipe.recipeId}.${param.name}; expected one of: ${(param.enumValues ?? []).join(', ')}.`,
        );
      }
      values[param.name] = value;
    } else if (value) {
      values[param.name] = value;
    }
  }
  return values;
}

function numberRecipeParam(
  params: Record<string, string | number>,
  name: string,
): number | undefined {
  const value = params[name];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

// Token mutation helpers operate on explicit recipe-defined token indices so
// parameterization stays deterministic — heuristics like "the EMA whose
// current length === 20" silently lose their target if a recipe's default
// token shape changes. Each recipe declares the slot it wants to update.
function tokenAt(tokens: TokenDto[], index: number): TokenDto | undefined {
  return index >= 0 && index < tokens.length ? tokens[index] : undefined;
}

function setTokenArgsLength(tokens: TokenDto[], index: number, length: number) {
  const params = asJsonObject(tokenAt(tokens, index)?.params);
  const args = asJsonObject(params?.args);
  if (args) args.length = length;
}

function setTokenParamPeriod(
  tokens: TokenDto[],
  index: number,
  period: number,
) {
  const params = asJsonObject(tokenAt(tokens, index)?.params);
  if (params && Object.prototype.hasOwnProperty.call(params, 'period')) {
    params.period = period;
  }
}

function setTokenParamValue(tokens: TokenDto[], index: number, value: number) {
  const params = asJsonObject(tokenAt(tokens, index)?.params);
  if (params && Object.prototype.hasOwnProperty.call(params, 'value')) {
    params.value = value;
  }
}

function setTokenParamTolerance(
  tokens: TokenDto[],
  index: number,
  tolerance: number,
) {
  const params = asJsonObject(tokenAt(tokens, index)?.params);
  if (params && Object.prototype.hasOwnProperty.call(params, 'tolerance')) {
    params.tolerance = tolerance;
  }
}

function setFragmentIndicatorLength(
  fragment: SignalGraphFragment,
  indicator: string,
  length: number,
  nodeId?: string,
) {
  visitObjects(fragment, (object) => {
    if (nodeId && object.id !== nodeId) return;
    if (object.kind !== 'indicator' || object.indicator !== indicator) return;
    const args = asJsonObject(object.args);
    if (args) args.length = length;
  });
}

function setFragmentRollingPeriod(
  fragment: SignalGraphFragment,
  period: number,
  nodeId?: string,
) {
  visitObjects(fragment, (object) => {
    if (nodeId && object.id !== nodeId) return;
    if (object.kind !== 'rolling') return;
    object.period = period;
  });
}

function setFragmentRightConst(
  fragment: SignalGraphFragment,
  value: number,
  nodeId?: string,
) {
  visitObjects(fragment, (object) => {
    if (nodeId && object.id !== nodeId) return;
    const right = asJsonObject(object.right);
    if (!right || !Object.prototype.hasOwnProperty.call(right, 'const')) {
      return;
    }
    right.const = value;
  });
}

function setFragmentTolerance(
  fragment: SignalGraphFragment,
  tolerance: number,
  nodeId?: string,
) {
  visitObjects(fragment, (object) => {
    if (nodeId && object.id !== nodeId) return;
    const toleranceObject = asJsonObject(object.tolerance);
    if (toleranceObject?.mode === 'percent') {
      toleranceObject.value = tolerance;
    }
  });
}

function setWarmup(fragment: SignalGraphFragment, warmupPeriod: number) {
  fragment.settingsHints = {
    ...(fragment.settingsHints ?? {}),
    warmupPeriod,
  };
}

function setRiskHint(
  fragment: SignalGraphFragment,
  update: (risk: Record<string, unknown>) => void,
) {
  const assemblyHints = fragment.assemblyHints as Record<string, unknown>;
  const risk = asJsonObject(assemblyHints.risk)
    ? { ...(assemblyHints.risk as Record<string, unknown>) }
    : {};
  update(risk);
  assemblyHints.risk = risk;
}

function setEntrySizingHint(fragment: SignalGraphFragment, percent: number) {
  const assemblyHints = fragment.assemblyHints as Record<string, unknown>;
  assemblyHints.entryActionHint = {
    side: 'long',
    sizing: { mode: 'percent_equity', value: percent },
  };
}

function semanticSummaryForRecipe(
  recipe: TokenRecipeDefinition,
  params: Record<string, string | number>,
): string {
  switch (recipe.recipeId) {
    case 'trend.close_above_ema_100':
      return `Close is above EMA(${params.length}).`;
    case 'trend.ema_fast_above_slow':
      return `EMA(${params.fastLength}) is above EMA(${params.slowLength}).`;
    case 'momentum.rsi_cross_up_30':
      return `RSI(${params.length}) crosses above ${params.threshold}.`;
    case 'mean_reversion.close_near_ema_after_pullback':
      return `Close is near EMA(20) within ${params.tolerance}%.`;
    case 'breakout.close_crosses_20_high':
      return `Close crosses above the prior ${params.length}-bar high.`;
    case 'volume.volume_above_avg_20':
      return `Volume is above its ${params.length}-bar average.`;
    case 'position.exit_after_10_bars':
      return `Exit after holding for more than ${params.bars} bars.`;
    case 'position.exit_unrealized_loss':
      return `Exit when unrealized PnL drops below ${params.lossAmount}.`;
    case 'risk.percent_stop_loss':
      return `Attach a fixed ${params.percent}% stop loss.`;
    case 'risk.percent_take_profit':
      return `Attach a fixed ${params.percent}% take-profit target.`;
    case 'risk.trailing_stop':
      return `Attach a ${params.distancePercent}% trailing stop after ${params.activateAfterPercent}% profit.`;
    case 'sizing.percent_equity_10':
      return `Use ${params.percent}% equity position sizing.`;
    case 'execution.close_near_breakout_level':
      return `Close remains within ${params.tolerance}% of the breakout level.`;
    default:
      return recipe.semanticSummary;
  }
}

function materializeRecipe(
  recipe: TokenRecipeDefinition,
  implementation: SemanticImplementationDefinition,
  rawParams: unknown,
): {
  recipe: TokenRecipeDefinition;
  fragment: SignalGraphFragment;
  params: Record<string, string | number>;
} {
  const params = recipeParamValues(recipe, rawParams);
  const materialized = cloneTokenRecipe(recipe);
  const tokens = materialized.tokens as unknown as TokenDto[];
  const fragment = cloneJson(implementation.fragment);

  switch (recipe.recipeId) {
    case 'trend.close_above_ema_100': {
      const length = numberRecipeParam(params, 'length');
      if (length !== undefined) {
        // tokens: [close, gt, ema(100)] — ema lives at index 2.
        setTokenArgsLength(tokens, 2, length);
        setFragmentIndicatorLength(fragment, 'ema', length, 'ema_100');
        setWarmup(fragment, Math.max(50, Math.ceil(length * 2)));
      }
      break;
    }
    case 'trend.ema_fast_above_slow': {
      const fastLength = numberRecipeParam(params, 'fastLength');
      const slowLength = numberRecipeParam(params, 'slowLength');
      // tokens: [ema(fast), gt, ema(slow)] — fast=0, slow=2.
      if (fastLength !== undefined) {
        setTokenArgsLength(tokens, 0, fastLength);
        setFragmentIndicatorLength(fragment, 'ema', fastLength, 'ema_fast');
      }
      if (slowLength !== undefined) {
        setTokenArgsLength(tokens, 2, slowLength);
        setFragmentIndicatorLength(fragment, 'ema', slowLength, 'ema_slow');
        setWarmup(fragment, Math.max(50, Math.ceil(slowLength * 2)));
      }
      break;
    }
    case 'momentum.rsi_cross_up_30': {
      const length = numberRecipeParam(params, 'length');
      const threshold = numberRecipeParam(params, 'threshold');
      // tokens: [rsi(length), cross_up, constant(threshold)] — rsi=0, threshold=2.
      if (length !== undefined) {
        setTokenArgsLength(tokens, 0, length);
        setFragmentIndicatorLength(fragment, 'rsi', length, 'rsi_14');
        setWarmup(fragment, Math.max(50, Math.ceil(length * 3)));
      }
      if (threshold !== undefined) {
        setTokenParamValue(tokens, 2, threshold);
        setFragmentRightConst(fragment, threshold, 'rsi_reclaim');
      }
      break;
    }
    case 'mean_reversion.close_near_ema_after_pullback':
    case 'execution.close_near_breakout_level': {
      const tolerance = numberRecipeParam(params, 'tolerance');
      if (tolerance !== undefined) {
        // tokens: [close, proximity{tolerance}] — proximity at index 1.
        setTokenParamTolerance(tokens, 1, tolerance);
        setFragmentTolerance(fragment, tolerance);
      }
      break;
    }
    case 'breakout.close_crosses_20_high': {
      // Recipe param is `length` (matches indicator vocabulary); the rolling
      // token field is still called `period` internally — that's the only
      // place the rename does NOT propagate, by design.
      const length = numberRecipeParam(params, 'length');
      if (length !== undefined) {
        // tokens: [close, cross_up, rolling{period}] — rolling at index 2.
        setTokenParamPeriod(tokens, 2, length);
        setFragmentRollingPeriod(fragment, length, 'range_high_20');
        setWarmup(fragment, Math.max(50, Math.ceil(length * 2.5)));
      }
      break;
    }
    case 'volume.volume_above_avg_20': {
      const length = numberRecipeParam(params, 'length');
      if (length !== undefined) {
        // tokens: [volume, gt, rolling{period}] — rolling at index 2.
        setTokenParamPeriod(tokens, 2, length);
        setFragmentRollingPeriod(fragment, length, 'volume_avg_20');
        setWarmup(fragment, Math.max(50, Math.ceil(length * 2.5)));
      }
      break;
    }
    case 'position.exit_after_10_bars': {
      const bars = numberRecipeParam(params, 'bars');
      if (bars !== undefined) {
        // tokens: [state(bars_since_entry), gt, constant(bars)] — constant at 2.
        setTokenParamValue(tokens, 2, bars);
        setFragmentRightConst(fragment, bars, 'exit_after_10_bars');
      }
      break;
    }
    case 'position.exit_unrealized_loss': {
      const lossAmount = numberRecipeParam(params, 'lossAmount');
      if (lossAmount !== undefined) {
        // tokens: [state(unrealized_pnl), lt, constant(loss)] — constant at 2.
        setTokenParamValue(tokens, 2, lossAmount);
        setFragmentRightConst(fragment, lossAmount, 'loss_limit_exit');
      }
      break;
    }
    case 'risk.percent_stop_loss': {
      const percent = numberRecipeParam(params, 'percent');
      if (percent !== undefined) {
        setRiskHint(fragment, (risk) => {
          risk.stopLoss = { mode: 'percent', value: percent };
        });
      }
      break;
    }
    case 'risk.percent_take_profit': {
      const percent = numberRecipeParam(params, 'percent');
      if (percent !== undefined) {
        setRiskHint(fragment, (risk) => {
          risk.takeProfits = [{ triggerPercent: percent, closePercent: 100 }];
        });
      }
      break;
    }
    case 'risk.trailing_stop': {
      const distancePercent = numberRecipeParam(params, 'distancePercent');
      const activateAfterPercent = numberRecipeParam(
        params,
        'activateAfterPercent',
      );
      if (distancePercent !== undefined && activateAfterPercent !== undefined) {
        setRiskHint(fragment, (risk) => {
          risk.trailingStop = { distancePercent, activateAfterPercent };
        });
      }
      break;
    }
    case 'sizing.percent_equity_10': {
      const percent = numberRecipeParam(params, 'percent');
      if (percent !== undefined) {
        setEntrySizingHint(fragment, percent);
      }
      break;
    }
    default:
      break;
  }

  materialized.semanticSummary = semanticSummaryForRecipe(materialized, params);
  materialized.tokens = tokens as unknown as Record<string, unknown>[];

  return { recipe: materialized, fragment, params };
}

function firstFragmentRef(
  fragment: SignalGraphFragment,
): { ref: string } | undefined {
  const hints = asJsonObject(fragment.assemblyHints);
  const entryTrigger = asJsonObject(hints?.entryTrigger);
  if (typeof entryTrigger?.ref === 'string') return { ref: entryTrigger.ref };
  for (const key of ['contextFilters', 'confirmationFilters'] as const) {
    const refs = hints?.[key];
    if (!Array.isArray(refs)) continue;
    const first = refs
      .map(asJsonObject)
      .find((item) => typeof item?.ref === 'string');
    if (typeof first?.ref === 'string') return { ref: first.ref };
  }
  const signalExit = asJsonObject(hints?.signalExit);
  if (typeof signalExit?.ref === 'string') return { ref: signalExit.ref };
  const exit = asJsonObject(hints?.exit);
  const exitWhen = asJsonObject(exit?.when);
  if (typeof exitWhen?.ref === 'string') return { ref: exitWhen.ref };
  return undefined;
}

function applyBlockRoleToFragment(
  fragment: SignalGraphFragment,
  role: TokenRecipeRole,
): SignalGraphFragment {
  if (!isTokenBlockRole(role)) return fragment;
  const ref = firstFragmentRef(fragment);
  if (!ref) return fragment;

  const next = cloneJson(fragment);
  if (role === 'entry_trigger') {
    next.assemblyHints = { entryTrigger: ref };
  } else if (role === 'context_filter') {
    next.assemblyHints = { contextFilters: [ref] };
  } else if (role === 'confirmation_filter') {
    next.assemblyHints = { confirmationFilters: [ref] };
  } else {
    next.assemblyHints = {
      signalExit: {
        when: ref,
        action: { mode: 'percent_position', value: 100 },
      },
    };
  }
  return next;
}

function composeTokenBlock(input: Record<string, unknown>): ComposedTokenBlock {
  const selected = selectTokenRecipe(input);
  const implementation = implementationForRecipe(selected);
  const roleInput = asString(input.role);
  const role = isTokenRecipeRole(roleInput) ? roleInput : selected.role;
  const {
    recipe,
    fragment: materializedFragment,
    params,
  } = materializeRecipe(selected, implementation, input.params);
  const fragment =
    role === recipe.role
      ? materializedFragment
      : applyBlockRoleToFragment(materializedFragment, role);
  const family = familyForImplementation(implementation);
  const semanticSummary = semanticSummaryForRecipe(recipe, params);

  return {
    protocol: 'traseq.agent.token-block',
    version: 1,
    recipe,
    block: {
      recipeId: recipe.recipeId,
      implementationId: recipe.implementationId,
      role,
      tokenRole: tokenRoleForSemanticRole(role),
      produces: recipe.produces,
      validAs: [...recipe.validAs],
      semanticSummary,
      name: recipe.displayName,
      description: implementation.description,
      type: 'signal',
      category: categoryForFamily(family),
      tokens: cloneJson(recipe.tokens) as unknown as TokenDto[],
      params,
    },
    fragment,
    rationale:
      'Deterministic recipe composition: the agent selected a curated semantic recipe, filled typed slots, and received both TokenDto and SignalGraph fragment from the same semantic implementation.',
    tradeoffs: cloneJson(implementation.tradeoffs),
    validationHints: [...implementation.validationHints],
  };
}

function validateTokenShape(tokens: unknown): {
  tokens?: TokenDto[];
  issues: Array<{
    code: string;
    path: string;
    field: string;
    message: string;
    severity: 'error';
  }>;
} {
  if (!Array.isArray(tokens)) {
    return {
      issues: [
        {
          code: 'token_block_shape',
          path: 'tokens',
          field: 'tokens',
          message: 'tokens must be an array.',
          severity: 'error',
        },
      ],
    };
  }
  const issues: ReturnType<typeof validateTokenShape>['issues'] = [];
  const normalized: TokenDto[] = [];
  tokens.forEach((item, index) => {
    const object = asJsonObject(item);
    const type = asString(object?.type);
    if (!object || !type) {
      issues.push({
        code: 'token_block_shape',
        path: `tokens[${index}].type`,
        field: 'tokens',
        message: 'Every token must be an object with a non-empty string type.',
        severity: 'error',
      });
      return;
    }
    normalized.push(object as unknown as TokenDto);
  });
  return { tokens: normalized, issues };
}

async function remoteCompileTokenBlock(
  client: unknown,
  tokens: TokenDto[],
  role: SemanticBlockRole,
): Promise<TokenBlockCompileResponse> {
  if (!hasCompileBlock(client)) {
    throw new Error(
      'Raw workspace block tokens require a Traseq client with compileBlock. Use compose_token_block for local recipe blocks, or pass an explicit fragment.',
    );
  }
  return client.compileBlock({ tokens, role });
}

function localTokenGrammarFallback() {
  return {
    protocol: 'traseq.token-grammar',
    version: 1,
    source: 'agent_local_fallback',
    grammarEndpoint: '/public/v1/token-grammar',
    warning:
      'Configure a Traseq client/API key for the authoritative public token grammar document.',
    roles: [...TOKEN_BLOCK_ROLE_VALUES],
    tokenCategories: [
      'value',
      'bool_condition',
      'logic',
      'action',
      'structural',
    ],
    authoringRule:
      'Prefer AST-first generation. Use materialize_token_ast with a Traseq client to convert StrategyAstV1 or BoolExpr into TokenDto.',
    recipeMacroCount: TOKEN_RECIPES.length,
  };
}

async function getTokenGrammar(client: unknown) {
  if (hasGetTokenGrammar(client)) {
    return client.getTokenGrammar();
  }
  return localTokenGrammarFallback();
}

async function materializeTokenAst(
  input: Record<string, unknown>,
  client: unknown,
) {
  if (!hasMaterializeTokenGrammar(client)) {
    throw new Error(
      'materialize_token_ast requires a Traseq client with materializeTokenGrammar. Configure TRASEQ_API_KEY or use get_token_semantics/compose_token_block for local recipe macros.',
    );
  }
  return client.materializeTokenGrammar(input as never);
}

async function validateTokenGrammarCandidate(
  input: Record<string, unknown>,
  client: unknown,
) {
  if (hasValidateTokenGrammar(client)) {
    return client.validateTokenGrammar(input as never);
  }

  if (Array.isArray(input.tokens)) {
    const shape = validateTokenShape(input.tokens);
    return {
      valid: shape.issues.length === 0,
      source: 'local_shape',
      role: isTokenBlockRole(input.role) ? input.role : 'entry_trigger',
      tokens: shape.tokens ?? [],
      issues: shape.issues,
      warning:
        'Only local token shape was checked. Configure a Traseq client/API key for public token grammar validation.',
    };
  }

  throw new Error(
    'validate_token_grammar_candidate requires a Traseq client for AST-first candidates. Raw tokens can receive a local shape-only fallback.',
  );
}

function getTokenSemantics(input: Record<string, unknown>) {
  const requestedRole = asString(input.role);
  const requestedFamily = asString(input.family);
  const includeTokens = input.includeTokens === true;
  const includeFragments = input.includeFragments === true;
  const tokenTypes = new Set<string>();
  const roles = new Set<string>();

  const recipes = TOKEN_RECIPES.map((recipe) => {
    const implementation = implementationForRecipe(recipe);
    const family = familyForImplementation(implementation);
    if (requestedRole && recipe.role !== requestedRole) return undefined;
    if (requestedFamily && family !== requestedFamily) return undefined;
    roles.add(recipe.role);
    visitObjects(recipe.tokens, (object) => {
      if (typeof object.type === 'string') tokenTypes.add(object.type);
    });
    return {
      recipeId: recipe.recipeId,
      implementationId: recipe.implementationId,
      family,
      role: recipe.role,
      tokenRole: tokenRoleForSemanticRole(recipe.role),
      produces: recipe.produces,
      validAs: [...recipe.validAs],
      semanticSummary: recipe.semanticSummary,
      params: cloneJson(recipe.params),
      ...(includeTokens ? { tokens: cloneJson(recipe.tokens) } : {}),
      ...(includeFragments
        ? { fragment: cloneJson(implementation.fragment) }
        : {}),
      tradeoffs: cloneJson(implementation.tradeoffs),
      validationHints: [...implementation.validationHints],
    };
  }).filter((item): item is NonNullable<typeof item> => item !== undefined);

  return {
    protocol: 'traseq.agent.token-semantics',
    version: 1,
    grammar: {
      authoringRule:
        'Recipes are exact-match macros for block/template authoring. For concrete custom strategies, author SG v2 directly and use recipes only when they preserve the facet literally.',
      tokenBlockFlow: [
        'get_token_semantics',
        'compose_token_block',
        'validate_token_block',
        'assemble_strategy_from_blocks',
      ],
      roles: [...new Set([...roles, ...TOKEN_RECIPE_ROLE_VALUES])],
      availableTokenTypes: [...tokenTypes].sort(),
      publicValidation:
        'Recipe blocks validate locally by shape and can validate remotely through public block validation when a client is configured.',
    },
    facets: SEMANTIC_FACETS.map((facet) => ({
      id: facet.id,
      family: facet.family,
      role: facet.role,
      implementationIds: [...facet.implementationIds],
      description: facet.description,
    })).filter((facet) =>
      requestedFamily ? facet.family === requestedFamily : true,
    ),
    recipes,
  };
}

// Canonical SG v2 reference draft for sg_v2-mode authoring examples.
// IMPORTANT: this literal is the single example handed to LLM agents as a
// "what should a concrete SG v2 draft look like" reference. Any drift from the
// SG v2 schema cascades into every agent that copies the shape. The
// "validates against preflight" test in semantics.test.mjs is the safety net —
// keep it green.
export const SG_V2_EXAMPLE = {
  protocol: 'traseq.signal-graph',
  version: 2,
  nodes: [
    { id: 'close_price', kind: 'market', field: 'close' },
    {
      id: 'rsi_14',
      kind: 'indicator',
      indicator: 'rsi',
      args: { length: 14 },
    },
    {
      id: 'ema_100',
      kind: 'indicator',
      indicator: 'ema',
      args: { length: 100 },
    },
    { id: 'rsi_threshold', kind: 'const', value: 30 },
    {
      id: 'rsi_reclaim',
      kind: 'cross',
      op: 'cross_up',
      left: { ref: 'rsi_14' },
      right: { ref: 'rsi_threshold' },
    },
    {
      id: 'trend_ok',
      kind: 'compare',
      op: 'gt',
      left: { ref: 'close_price' },
      right: { ref: 'ema_100' },
    },
    {
      id: 'entry_trigger',
      kind: 'all',
      items: [{ ref: 'rsi_reclaim' }, { ref: 'trend_ok' }],
    },
    { id: 'rsi_overbought', kind: 'const', value: 70 },
    {
      id: 'exit_signal',
      kind: 'cross',
      op: 'cross_up',
      left: { ref: 'rsi_14' },
      right: { ref: 'rsi_overbought' },
    },
  ],
  strategy: {
    kind: 'strategy',
    entry: {
      kind: 'entry',
      trigger: { ref: 'entry_trigger' },
      action: {
        side: 'long',
        sizing: { mode: 'percent_equity', value: 10 },
      },
    },
    exits: [
      {
        kind: 'exit',
        when: { ref: 'exit_signal' },
        action: { mode: 'percent_position', value: 100 },
      },
    ],
    risk: {
      stopLoss: { mode: 'percent', value: 2 },
    },
  },
} as const;

function getAuthoringExamples(input: Record<string, unknown>) {
  const requestedMode = asString(input.mode);
  const pattern = asString(input.pattern).toLowerCase();
  const includeSignalGraph = input.includeSignalGraph !== false;
  const rsiRecipe = findTokenRecipe('momentum.rsi_cross_up_30');
  const emaRecipe = findTokenRecipe('trend.close_above_ema_100');

  const examples = [
    {
      id: 'template.vague_start',
      mode: 'template',
      title:
        'Start from a system template when the user has no concrete rules.',
      whenToUse:
        'Use when the user asks for ideas, templates, or a general research starting point.',
      recommendedToolPath: [
        'list_system_strategies',
        'get_system_strategy',
        'compose_strategy_from_template',
        'run_guided_research_round',
      ],
      customizationHints:
        'Fork the closest system strategy, then revise only the smallest set of settings or conditions the user names.',
    },
    ...(rsiRecipe
      ? [
          {
            id: 'block.rsi_reclaim',
            mode: 'block',
            title: 'RSI reclaim editable block',
            whenToUse:
              'Use only when the user literally wants an RSI reclaim/cross-up condition.',
            recipeId: rsiRecipe.recipeId,
            implementationId: rsiRecipe.implementationId,
            role: rsiRecipe.role,
            semanticSummary: rsiRecipe.semanticSummary,
            params: cloneJson(rsiRecipe.params),
            recommendedToolPath: [
              'compose_token_block',
              'validate_token_block',
              'assemble_strategy_from_blocks',
              'run_guided_research_round',
            ],
          },
        ]
      : []),
    ...(emaRecipe
      ? [
          {
            id: 'hybrid.rsi_with_trend_filter',
            mode: 'hybrid',
            title: 'SG v2 primary draft with exact-match block macros',
            whenToUse:
              'Use when some facets match curated recipes exactly, but the whole strategy should preserve custom SG v2 structure.',
            recipeIds: [rsiRecipe?.recipeId, emaRecipe.recipeId].filter(
              (value): value is string => typeof value === 'string',
            ),
            recommendedToolPath: [
              'resolve_strategy_semantics',
              'assemble_signal_graph',
              'preflight_strategy_draft',
              'assemble_strategy_from_blocks',
              'run_guided_research_round',
            ],
          },
        ]
      : []),
    {
      id: 'sg_v2.rsi_ema_stop',
      mode: 'sg_v2',
      title: 'Direct SG v2 for concrete RSI + EMA + stop logic',
      whenToUse:
        'Use when the user gives concrete conditions and preserving the exact strategy logic matters more than fitting a recipe.',
      recommendedToolPath: [
        'get_capabilities',
        'resolve_strategy_semantics',
        'assemble_signal_graph',
        'preflight_strategy_draft',
        'run_guided_research_round',
      ],
      ...(includeSignalGraph ? { exampleSignalGraph: SG_V2_EXAMPLE } : {}),
    },
  ];

  const filtered = examples.filter((example) => {
    if (requestedMode && example.mode !== requestedMode) return false;
    if (!pattern) return true;
    return JSON.stringify(example).toLowerCase().includes(pattern);
  });

  return {
    protocol: 'traseq.agent.authoring-examples',
    version: 1,
    guidance: {
      primaryRule:
        'Use SG v2 directly for concrete custom strategies; use templates, recipes, and blocks for vague intent or exact-match reusable facets.',
      recipeRule:
        'Recipes are deterministic macros. Inspect them as references or compose them only when they exactly preserve the user intent.',
      nonGoal:
        'This tool is read-only and never materializes TokenDto or validates a block.',
    },
    examples: filtered,
  };
}

async function validateTokenBlock(
  input: Record<string, unknown>,
  client: unknown,
) {
  const hasRecipeInput =
    asString(input.recipeId) ||
    asString(input.implementationId) ||
    asString(input.semanticId);
  const composed = hasRecipeInput ? composeTokenBlock(input) : undefined;
  const roleInput = input.role ?? composed?.block.role;
  const role = isTokenBlockRole(roleInput) ? roleInput : undefined;
  const tokensSource = composed?.block.tokens ?? input.tokens;

  if (composed && composed.block.produces !== 'bool') {
    // Risk/sizing recipes don't emit token-block bytecode — their materialization
    // lives in fragment.assemblyHints.risk / .entryActionHint instead. We still
    // refuse to short-circuit if a recipe ever ships with a non-empty token
    // array, because that would silently bypass shape and remote validation.
    if (composed.block.tokens.length > 0) {
      return {
        valid: false,
        source: 'local_recipe',
        role: composed.block.role,
        tokens: composed.block.tokens,
        issues: [
          {
            code: 'token_block_recipe_invariant',
            path: 'tokens',
            field: 'tokens',
            severity: 'error',
            message: `Recipe ${composed.recipe.recipeId} produces ${composed.block.produces} but emits non-empty tokens; recipe definition is inconsistent.`,
          },
        ],
      };
    }
    return {
      valid: true,
      source: 'local_recipe',
      role: composed.block.role,
      tokens: composed.block.tokens,
      issues: [],
      fragment: composed.fragment,
      note: 'Recipe produces strategy risk/action hints rather than a boolean token block; remote block validation is not applicable.',
    };
  }

  const shape = validateTokenShape(tokensSource);
  if (shape.issues.length > 0 || !shape.tokens) {
    return {
      valid: false,
      source: 'local_shape',
      role: role ?? 'entry_trigger',
      tokens: [],
      issues: shape.issues,
    };
  }

  if (hasValidateBlock(client) && role) {
    const remote = await client.validateBlock({ tokens: shape.tokens, role });
    return {
      ...remote,
      source: 'remote',
      ...(composed
        ? { fragment: composed.fragment, recipe: composed.recipe }
        : {}),
    };
  }

  return {
    valid: true,
    source: 'local_shape',
    role: role ?? 'entry_trigger',
    tokens: shape.tokens,
    issues: [],
    ...(composed
      ? { fragment: composed.fragment, recipe: composed.recipe }
      : {}),
    warning:
      'Only local token shape was checked. Configure a Traseq client/API key for public block validation.',
  };
}

async function fragmentFromBlockInput(
  rawBlock: unknown,
  client: unknown,
): Promise<{
  fragment: SignalGraphFragment;
  block: Record<string, unknown>;
}> {
  const block = asJsonObject(rawBlock);
  if (!block) {
    throw new Error(
      'Every assemble_strategy_from_blocks item must be an object.',
    );
  }

  const explicitFragment = asJsonObject(block.fragment);
  if (explicitFragment && Array.isArray(explicitFragment.nodes)) {
    return {
      fragment: explicitFragment as unknown as SignalGraphFragment,
      block: {
        source: 'fragment',
        role: asString(block.role) || 'unknown',
      },
    };
  }

  if (
    asString(block.recipeId) ||
    asString(block.implementationId) ||
    asString(block.semanticId)
  ) {
    const composed = composeTokenBlock(block);
    return {
      fragment: composed.fragment,
      block: {
        source: 'recipe',
        recipeId: composed.block.recipeId,
        implementationId: composed.block.implementationId,
        role: composed.block.role,
        semanticSummary: composed.block.semanticSummary,
      },
    };
  }

  let tokens: TokenDto[] | undefined;
  const blockId = asString(block.blockId);
  if (blockId) {
    if (!hasGetBlock(client)) {
      throw new Error(
        'assemble_strategy_from_blocks blockId requires a Traseq client with getBlock.',
      );
    }
    const workspaceBlock = (await client.getBlock(blockId)) as SemanticBlock;
    tokens = workspaceBlock.tokens;
  } else {
    const shape = validateTokenShape(block.tokens);
    if (shape.issues.length > 0 || !shape.tokens) {
      throw new Error(
        `Invalid raw token block: ${shape.issues.map((issue) => issue.message).join('; ')}`,
      );
    }
    tokens = shape.tokens;
  }

  const role = isTokenBlockRole(block.role) ? block.role : undefined;
  if (!role) {
    throw new Error(
      'assemble_strategy_from_blocks requires an explicit role for workspace blockId or raw token blocks. Pass one of: entry_trigger, context_filter, confirmation_filter, exit.',
    );
  }
  const compiled = await remoteCompileTokenBlock(client, tokens, role);
  if (!compiled.valid || !compiled.fragment) {
    throw new Error(
      `Token block failed remote compile/validation: ${compiled.issues
        .map((issue) => issue.message)
        .join('; ')}`,
    );
  }
  return {
    fragment: compiled.fragment as SignalGraphFragment,
    block: {
      source: blockId ? 'workspace_block' : 'remote_compiled_tokens',
      ...(blockId ? { blockId } : {}),
      role,
      tokens,
    },
  };
}

async function assembleStrategyFromBlocks(
  input: Record<string, unknown>,
  client: unknown,
) {
  const blocks = Array.isArray(input.blocks) ? input.blocks : undefined;
  if (!blocks || blocks.length === 0) {
    throw new Error('assemble_strategy_from_blocks requires blocks.');
  }
  const composed = await Promise.all(
    blocks.map((block) => fragmentFromBlockInput(block, client)),
  );
  const namespaced = composed.map((item, index) => {
    const namespace = namespaceForAssembledBlock(item.block, index);
    return {
      namespace,
      fragment: namespaceSignalGraphFragment(item.fragment, namespace),
      block: item.block,
    };
  });
  const fragments = namespaced.map((item) => item.fragment);
  const assemblyInput: AssembleSignalGraphDraftInput = {
    fragments: fragments as AssembleSignalGraphDraftInput['fragments'],
  };
  if (typeof input.name === 'string') {
    assemblyInput.name = input.name;
  }
  if (typeof input.description === 'string') {
    assemblyInput.description = input.description;
  }
  const settings = asJsonObject(input.settings);
  if (settings) {
    assemblyInput.settings = settings as NonNullable<
      AssembleSignalGraphDraftInput['settings']
    >;
  }
  const backtest = asJsonObject(input.backtest);
  if (backtest) {
    assemblyInput.backtest = backtest as NonNullable<
      AssembleSignalGraphDraftInput['backtest']
    >;
  }
  if (typeof input.instrument === 'string') {
    assemblyInput.instrument = input.instrument;
  }
  if (typeof input.timeframe === 'string') {
    assemblyInput.timeframe = input.timeframe as Timeframe;
  }
  if (typeof input.initialBalance === 'number') {
    assemblyInput.initialBalance = input.initialBalance;
  }
  if (input.side === 'long' || input.side === 'short') {
    assemblyInput.side = input.side;
  }
  const sizing = asJsonObject(input.sizing);
  if (sizing) {
    assemblyInput.sizing = sizing as NonNullable<
      AssembleSignalGraphDraftInput['sizing']
    >;
  }
  if (input.capabilities !== undefined) {
    assemblyInput.capabilities = input.capabilities;
  }
  const assembly = assembleSignalGraphDraft(assemblyInput);
  return {
    ...assembly,
    blocks: namespaced.map((item) => ({
      ...item.block,
      fragmentNamespace: item.namespace,
    })),
    fragments,
  };
}

export async function runAgentTool(
  name: AgentToolName,
  rawInput: unknown = {},
  options: {
    client?: AgentToolRuntimeClient;
  } = {},
): Promise<unknown> {
  const input = asJsonObject(rawInput) ?? {};

  switch (name) {
    case 'get_semantics':
      return getSemantics(input as GetSemanticsInput);
    case 'get_token_grammar':
      return getTokenGrammar(options.client);
    case 'materialize_token_ast':
      return materializeTokenAst(input, options.client);
    case 'validate_token_grammar_candidate':
      return validateTokenGrammarCandidate(input, options.client);
    case 'get_token_semantics':
      return getTokenSemantics(input);
    case 'get_authoring_examples':
      return getAuthoringExamples(input);
    case 'compose_token_block':
      return composeTokenBlock(input);
    case 'validate_token_block':
      return validateTokenBlock(input, options.client);
    case 'assemble_strategy_from_blocks':
      return assembleStrategyFromBlocks(input, options.client);
    case 'resolve_strategy_semantics': {
      const resolveInput = input as ResolveStrategySemanticsInput;
      const capabilities = await getCapabilitiesIfNeeded(
        resolveInput,
        hasGetCapabilities(options.client) ? options.client : undefined,
      );
      return resolveStrategySemantics({
        ...resolveInput,
        capabilities,
      });
    }
    case 'assemble_signal_graph': {
      const fragments = Array.isArray(input.fragments)
        ? input.fragments
        : undefined;
      if (!fragments) {
        throw new Error('assemble_signal_graph requires fragments.');
      }
      return assembleSignalGraphDraft({
        ...(typeof input.name === 'string' ? { name: input.name } : {}),
        ...(typeof input.description === 'string'
          ? { description: input.description }
          : {}),
        fragments: fragments as any,
        ...(asJsonObject(input.settings)
          ? { settings: input.settings as any }
          : {}),
        ...(asJsonObject(input.backtest)
          ? { backtest: input.backtest as any }
          : {}),
        ...(typeof input.instrument === 'string'
          ? { instrument: input.instrument }
          : {}),
        ...(typeof input.timeframe === 'string'
          ? { timeframe: input.timeframe as Timeframe }
          : {}),
        ...(typeof input.initialBalance === 'number'
          ? { initialBalance: input.initialBalance }
          : {}),
        ...(input.side === 'long' || input.side === 'short'
          ? { side: input.side }
          : {}),
        ...(asJsonObject(input.sizing) ? { sizing: input.sizing as any } : {}),
        ...(input.capabilities !== undefined
          ? { capabilities: input.capabilities }
          : {}),
      });
    }
    case 'preflight_strategy_draft': {
      const draft = asJsonObject(input.draft);
      if (!draft) {
        throw new Error('preflight_strategy_draft requires draft.');
      }

      // P-Vocab: normalize first so deterministic vocabulary drift
      // (`args.period`, misplaced `args.output`, etc.) does not show up as
      // SDK schema errors the LLM has to manually patch. The normalize
      // result is returned alongside the validation summary so callers can
      // see exactly what was rewritten and surface it to the user.
      const normalized = normalizeStrategyDraft(
        draft as unknown as StrategyDraftLike,
        input.capabilities,
      );
      const draftToValidate = normalized.changed
        ? (normalized.draft as unknown as Record<string, unknown>)
        : draft;
      const result = preflightStrategyDraft(
        draftToValidate,
        input.capabilities,
      );
      // P2-I: tier-aware lint. The SDK preflight runs the structural schema;
      // we layer count-based capacity checks on top so the LLM sees "you have
      // 3 entry filters but free tier caps at 2" before validate_strategy
      // returns a 400 for the same reason. Warnings (severity: 'warning') are
      // additive — never flip valid:false — so callers can choose to ignore
      // and let the backend reconfirm.
      const tierIssues = tierAwarePreflightIssues(
        draftToValidate,
        input.capabilities,
      );
      const baseIssues = result.issues ?? [];
      const baseSummary = result.summary ?? { errors: 0, warnings: 0 };
      const issues = [...baseIssues, ...tierIssues];
      const summary = {
        errors: baseSummary.errors,
        warnings: baseSummary.warnings + tierIssues.length,
      };

      return {
        ...result,
        summary,
        issues,
        ...(normalized.changed
          ? {
              normalize: {
                applied: true,
                patches: normalized.patches,
                draft: normalized.draft,
              },
            }
          : {}),
      };
    }
    case 'start_research_engagement': {
      if (!isResearchContextClient(options.client)) {
        throw new Error(
          'start_research_engagement requires a Traseq client with workspace context methods.',
        );
      }

      return startResearchEngagement(
        input as unknown as ResearchEngagementInput,
        {
          client: options.client,
        },
      );
    }
    case 'run_guided_research_round': {
      if (!isResearchRunnerClient(options.client)) {
        throw new Error(
          'run_guided_research_round requires a Traseq client with research runner methods.',
        );
      }

      const prompt = typeof input.prompt === 'string' ? input.prompt : '';
      const draft = asJsonObject(input.draft);
      if (prompt.trim().length < PROMPT_MIN_LENGTH) {
        throw new Error(
          `run_guided_research_round requires prompt of at least ${PROMPT_MIN_LENGTH} characters.`,
        );
      }
      if (!draft) {
        throw new Error('run_guided_research_round requires draft.');
      }
      if (
        input.timeframe !== undefined &&
        !TIMEFRAME_VALUES.includes(input.timeframe as Timeframe)
      ) {
        throw new Error(
          `run_guided_research_round timeframe must be one of: ${TIMEFRAME_VALUES.join(', ')}.`,
        );
      }
      if (
        input.positionStyle !== undefined &&
        !POSITION_STYLE_VALUES.includes(
          input.positionStyle as (typeof POSITION_STYLE_VALUES)[number],
        )
      ) {
        throw new Error(
          `run_guided_research_round positionStyle must be one of: ${POSITION_STYLE_VALUES.join(', ')}.`,
        );
      }

      return runGuidedResearchRound(
        input as unknown as GuidedResearchRoundInput,
        {
          client: options.client,
        },
      );
    }
    case 'summarize_research_engagement': {
      const result = asJsonObject(input.result);
      if (!result) {
        throw new Error('summarize_research_engagement requires result.');
      }

      const evaluation = asJsonObject(input.evaluation);
      return {
        report: summarizeResearchEngagement(
          result as unknown as ResearchRunnerResult,
          evaluation as ResearchResultEvaluation | undefined,
        ),
      };
    }
    case 'run_research_draft': {
      if (!isResearchRunnerClient(options.client)) {
        throw new Error(
          'run_research_draft requires a Traseq client with research runner methods.',
        );
      }

      const prompt = typeof input.prompt === 'string' ? input.prompt : '';
      const draft = asJsonObject(input.draft);
      if (prompt.trim().length < PROMPT_MIN_LENGTH) {
        throw new Error(
          `run_research_draft requires prompt of at least ${PROMPT_MIN_LENGTH} characters.`,
        );
      }
      if (!draft) {
        throw new Error('run_research_draft requires draft.');
      }
      if (
        input.timeframe !== undefined &&
        !TIMEFRAME_VALUES.includes(input.timeframe as Timeframe)
      ) {
        throw new Error(
          `run_research_draft timeframe must be one of: ${TIMEFRAME_VALUES.join(', ')}.`,
        );
      }
      if (
        input.positionStyle !== undefined &&
        !POSITION_STYLE_VALUES.includes(
          input.positionStyle as (typeof POSITION_STYLE_VALUES)[number],
        )
      ) {
        throw new Error(
          `run_research_draft positionStyle must be one of: ${POSITION_STYLE_VALUES.join(', ')}.`,
        );
      }

      const result = await runResearchRunner({
        client: options.client,
        input: {
          prompt,
          ...(typeof input.instrument === 'string'
            ? { instrument: input.instrument }
            : {}),
          ...(typeof input.timeframe === 'string'
            ? { timeframe: input.timeframe as Timeframe }
            : {}),
          ...(typeof input.initialBalance === 'number'
            ? { initialBalance: input.initialBalance }
            : {}),
          ...(typeof input.warmupPeriod === 'number'
            ? { warmupPeriod: input.warmupPeriod }
            : {}),
          ...(typeof input.positionStyle === 'string'
            ? { positionStyle: input.positionStyle }
            : {}),
          ...(typeof input.maxConcurrentPositions === 'number'
            ? { maxConcurrentPositions: input.maxConcurrentPositions }
            : {}),
          rounds: 1,
        },
        draftProducer: () => draft as unknown as StrategyDraftLike,
        ...(typeof input.pollIntervalMs === 'number'
          ? { pollIntervalMs: input.pollIntervalMs }
          : {}),
        ...(typeof input.timeoutMs === 'number'
          ? { timeoutMs: input.timeoutMs }
          : {}),
        ...(typeof input.producerTimeoutMs === 'number'
          ? { producerTimeoutMs: input.producerTimeoutMs }
          : {}),
        ...(typeof input.strategyId === 'string' && input.strategyId.length > 0
          ? { strategyId: input.strategyId }
          : {}),
        ...(typeof input.forkedFromVersionId === 'string' &&
        input.forkedFromVersionId.length > 0
          ? { forkedFromVersionId: input.forkedFromVersionId }
          : {}),
      });
      const evaluation = evaluateResearchResult(result);
      const usageStatus = summarizeUsageHints({
        usage: result.live.usage,
        workspace: result.live.workspace,
        manifest: result.live.manifest,
      });
      const report = formatResearchReport(result, evaluation, { usageStatus });

      return { status: result.status, usageStatus, result, evaluation, report };
    }
    case 'evaluate_research_result': {
      const result = asJsonObject(input.result);
      if (!result) {
        throw new Error('evaluate_research_result requires result.');
      }

      return evaluateResearchResult(result as unknown as ResearchRunnerResult);
    }
    case 'format_research_report': {
      const result = asJsonObject(input.result);
      if (!result) {
        throw new Error('format_research_report requires result.');
      }

      const evaluation = asJsonObject(input.evaluation);
      return {
        report: evaluation
          ? formatResearchReport(
              result as unknown as ResearchRunnerResult,
              evaluation as unknown as ResearchResultEvaluation,
            )
          : formatResearchReport(result as unknown as ResearchRunnerResult),
      };
    }
    case 'explain_validation_issues': {
      const validation = asJsonObject(input.validation);
      if (!validation) {
        throw new Error('explain_validation_issues requires validation.');
      }
      const draft = asJsonObject(input.draft);
      return explainValidationIssues({
        validation: validation as unknown as ValidationSummaryLike,
        ...(draft ? { draft: draft as unknown as StrategyDraftLike } : {}),
      });
    }
    case 'suggest_minimal_repairs': {
      const draft = asJsonObject(input.draft);
      const validation = asJsonObject(input.validation);
      if (!draft) {
        throw new Error('suggest_minimal_repairs requires draft.');
      }
      if (!validation) {
        throw new Error('suggest_minimal_repairs requires validation.');
      }
      return suggestMinimalRepairs({
        draft: draft as unknown as StrategyDraftLike,
        validation: validation as unknown as ValidationSummaryLike,
      });
    }
    case 'update_research_engagement': {
      const runId = typeof input.runId === 'string' ? input.runId.trim() : '';
      if (!runId) {
        throw new Error('update_research_engagement requires runId.');
      }
      const patch: ResearchEngagementPatch = {};
      if (typeof input.riskTolerance === 'string') {
        patch.riskTolerance = input.riskTolerance as NonNullable<
          ResearchEngagementPatch['riskTolerance']
        >;
      }
      if (typeof input.instrument === 'string') {
        patch.instrument = input.instrument;
      }
      if (typeof input.timeframe === 'string') {
        patch.timeframe = input.timeframe;
      }
      if (typeof input.positionStyle === 'string') {
        patch.positionStyle = input.positionStyle;
      }
      if (typeof input.objective === 'string') {
        patch.objective = input.objective;
      }
      if (typeof input.initialBalance === 'number') {
        patch.initialBalance = input.initialBalance;
      }
      if (typeof input.maxConcurrentPositions === 'number') {
        patch.maxConcurrentPositions = input.maxConcurrentPositions;
      }
      return updateResearchEngagement(runId, patch);
    }
    case 'compose_strategy_from_template': {
      const templateKey =
        typeof input.templateKey === 'string' ? input.templateKey.trim() : '';
      if (!templateKey) {
        throw new Error('compose_strategy_from_template requires templateKey.');
      }
      const client = options.client as
        | (Pick<TraseqClient, 'getSystemStrategy' | 'getCapabilities'> &
            Record<string, unknown>)
        | undefined;
      if (!client || typeof client.getSystemStrategy !== 'function') {
        throw new Error(
          'compose_strategy_from_template requires a Traseq client with getSystemStrategy.',
        );
      }
      const template = await client.getSystemStrategy(templateKey);
      if (!template?.signalGraph) {
        throw new Error(
          `compose_strategy_from_template: template "${templateKey}" has no signalGraph (template may be deprecated or token-only).`,
        );
      }
      const overrideSettings = asJsonObject(input.settingsOverride) ?? {};
      const baseSettings = asJsonObject(template.settings) ?? {};
      // Shallow merge: caller is responsible for keeping discriminated-union
      // shape consistent. If they change positionStyle they must also pass the
      // fields that style requires; preflightStrategyDraft will catch the
      // mismatch and the caller fixes it before validate_strategy is called.
      const mergedSettings = { ...baseSettings, ...overrideSettings };
      const draft: Record<string, unknown> = {
        name:
          typeof input.name === 'string' && input.name.trim()
            ? input.name.trim()
            : (template.name ?? `Forked from ${templateKey}`),
        signalGraph: template.signalGraph,
        settings: mergedSettings,
      };
      if (typeof input.description === 'string' && input.description.trim()) {
        draft.description = input.description.trim();
      } else if (typeof template.description === 'string') {
        draft.description = template.description;
      }
      let capabilities = input.capabilities;
      if (
        capabilities === undefined &&
        typeof client.getCapabilities === 'function'
      ) {
        try {
          capabilities = await client.getCapabilities();
        } catch {
          // Preflight tolerates undefined capabilities (skips capability
          // checks, runs structural ones). Fall back gracefully.
        }
      }
      const preflight = preflightStrategyDraft(draft, capabilities);
      return {
        template: {
          key: templateKey,
          ...(typeof template.name === 'string' ? { name: template.name } : {}),
          ...(typeof template.description === 'string'
            ? { description: template.description }
            : {}),
          ...(typeof template.category === 'string'
            ? { category: template.category }
            : {}),
          ...(Array.isArray(template.tags) ? { tags: template.tags } : {}),
        },
        draft,
        preflight,
        nextStep: preflight.valid
          ? 'Pass `draft` to run_guided_research_round (or validate_strategy) — preflight already cleared.'
          : 'Read `preflight.issues` for code/path/severity, fix the override settings, and re-call this tool. Common cause: changing positionStyle without supplying the required fields for the new style.',
      };
    }
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unhandled agent tool: ${_exhaustive}`);
    }
  }
}
