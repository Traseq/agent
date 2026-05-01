import {
  assembleSignalGraphDraft,
  preflightStrategyDraft,
  type CapabilityDocument,
  type TraseqClient,
} from '../client/index.js';
import { asJsonObject } from '../normalize.js';
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
import type {
  GuidedResearchRoundInput,
  ResearchContextClient,
  ResearchEngagementInput,
  ResearchResultEvaluation,
  ResearchRunnerClient,
  ResearchRunnerResult,
  StrategyDraftLike,
  Timeframe,
  ValidationSummaryLike,
} from '../types.js';
import type {
  GetSemanticsInput,
  ResolveStrategySemanticsInput,
} from './types.js';

export interface AgentToolDefinition {
  readonly name:
    | 'get_semantics'
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
      'Assemble resolver fragments with assemblyHints into a complete SignalGraph strategy draft, then run local preflight validation. Pure local JSON tool.',
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
      'Start a service-style Traseq research engagement. Reads live workspace context, usage, and capabilities, then returns assumptions, decision points, evidence boundaries, and provider-agnostic authoring instructions.',
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
      'Patch an existing in-memory research engagement (riskTolerance, instrument, timeframe, positionStyle, objective, initialBalance, maxConcurrentPositions) without re-running the manifest/workspace/usage/capabilities fetch. Use after start_research_engagement when the user adjusts a parameter mid-conversation. State is per-process and resets when the MCP server restarts.',
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

export async function runAgentTool(
  name: AgentToolName,
  rawInput: unknown = {},
  options: {
    client?:
      | Pick<TraseqClient, 'getCapabilities'>
      | ResearchContextClient
      | ResearchRunnerClient;
  } = {},
): Promise<unknown> {
  const input = asJsonObject(rawInput) ?? {};

  switch (name) {
    case 'get_semantics':
      return getSemantics(input as GetSemanticsInput);
    case 'resolve_strategy_semantics': {
      const resolveInput = input as ResolveStrategySemanticsInput;
      const capabilities = await getCapabilitiesIfNeeded(
        resolveInput,
        options.client,
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
      const result = preflightStrategyDraft(draft, input.capabilities);
      // P2-I: tier-aware lint. The SDK preflight runs the structural schema;
      // we layer count-based capacity checks on top so the LLM sees "you have
      // 3 entry filters but free tier caps at 2" before validate_strategy
      // returns a 400 for the same reason. Warnings (severity: 'warning') are
      // additive — never flip valid:false — so callers can choose to ignore
      // and let the backend reconfirm.
      const tierIssues = tierAwarePreflightIssues(draft, input.capabilities);
      if (tierIssues.length === 0) {
        return result;
      }
      return {
        ...result,
        summary: {
          errors: result.summary?.errors ?? 0,
          warnings: (result.summary?.warnings ?? 0) + tierIssues.length,
        },
        issues: [...(result.issues ?? []), ...tierIssues],
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
