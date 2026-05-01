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
    | 'suggest_minimal_repairs';
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
      return preflightStrategyDraft(draft, input.capabilities);
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
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unhandled agent tool: ${_exhaustive}`);
    }
  }
}
