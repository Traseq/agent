import type { CapabilityDocument, TraseqClient } from '../client/index.js';
import { asJsonObject } from '../normalize.js';
import { evaluateResearchResult } from '../evaluation.js';
import {
  runGuidedResearchRound,
  startResearchEngagement,
  summarizeResearchEngagement,
} from '../guided-research.js';
import { formatResearchReport } from '../report.js';
import { runResearchRunner } from '../research-runner.js';
import { getSemantics, resolveStrategySemantics } from './resolver.js';
import type {
  GuidedResearchRoundInput,
  ResearchContextClient,
  ResearchEngagementInput,
  ResearchResultEvaluation,
  ResearchRunnerClient,
  ResearchRunnerResult,
  StrategyDraftLike,
  Timeframe,
} from '../types.js';
import type {
  GetSemanticsInput,
  ResolveStrategySemanticsInput,
} from './types.js';

export interface AgentToolDefinition {
  readonly name:
    | 'get_semantics'
    | 'resolve_strategy_semantics'
    | 'start_research_engagement'
    | 'run_guided_research_round'
    | 'summarize_research_engagement'
    | 'run_research_draft'
    | 'evaluate_research_result'
    | 'format_research_report';
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
      'Run one externally-authored strategy draft as a guided research service round: validate, create/finalize only after validation, backtest, evaluate evidence, and return a service memo. Provider-agnostic; caller authors the draft.',
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
      'Run one externally-authored strategy draft through validate, create, finalize, backtest, wait, evaluate, and report. Single round, no validation-repair loop — caller is responsible for repairing rejected drafts. Uses the configured Traseq client.',
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
      });
      const evaluation = evaluateResearchResult(result);
      const report = formatResearchReport(result, evaluation);

      return { status: result.status, result, evaluation, report };
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
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unhandled agent tool: ${_exhaustive}`);
    }
  }
}
