import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  TraseqClient,
  TraseqApiError,
  formatTraseqAgentError,
} from '@traseq/sdk';

import {
  OPERATION_REGISTRY,
  type OperationDefinition,
  type OperationName,
} from '../generated/operation-registry.js';
import { readEnv, resolveTraseqApiKey } from '../env.js';
import { runPlatformTool } from '../client/tool-runner.js';
import {
  AGENT_TOOL_REGISTRY,
  getAgentToolDefinition,
  runAgentTool,
} from '../semantics/index.js';
import { packageVersion } from '../install/version.js';
import {
  DEFAULT_MCP_PROFILE,
  GUIDED_AGENT_TOOL_NAMES,
  operationStage,
  parseMcpProfile,
  platformOperationsForProfile,
  type McpProfile,
} from './profile.js';
import {
  augmentToolError,
  preflightToolArgs,
  type PreflightFailure,
} from './tool-guard.js';
import {
  classifyError,
  emitToolCallEvent,
  type ToolCallOutcome,
} from './telemetry.js';

export const GUIDED_RESEARCH_PROMPT_NAME = 'traseq_guided_research';
export const GUIDED_RESEARCH_PROMPT_DESCRIPTION =
  'Start a Traseq guided strategy research engagement by calling the start_research_engagement MCP tool first.';

const GUIDED_TOOL_ORDER = [
  'start_research_engagement',
  'run_guided_research_round',
  'summarize_research_engagement',
] as const;
const GUIDED_TOOL_NAMES = new Set<string>(GUIDED_TOOL_ORDER);

export const MCP_SERVICE_INSTRUCTIONS = [
  'Use Traseq as a guided strategy research service, not as a raw toolbox.',
  '`Traseq research engagement` is this MCP tool workflow. When asked to validate or research a strategy, call the MCP tool start_research_engagement first; do not search the local repo or ask the user for an entry point.',
  'Default flow: call start_research_engagement first, read token grammar, materialize AST-first token candidates or use deterministic recipes as macros, assemble_strategy_from_blocks, then run_guided_research_round to validate remotely, persist after validation, backtest, evaluate evidence, and return a memo.',
  'For strategy composition, prefer get_token_grammar -> materialize_token_ast -> validate_token_grammar_candidate -> assemble_strategy_from_blocks. Use get_token_semantics -> compose_token_block for common semantic macros. Token-first raw streams are for existing blocks, migration, or expert flows and must validate before assembly. Tokens/blocks are provenance/composition; SignalGraph v2 remains the strategy write contract.',
  'If start_research_engagement is not available, tell the user the Traseq MCP server is not connected or not enabled.',
  'Show users the research task, assumptions, verdict, evidence, risk flags, Traseq app links, and next step. Do not lead with raw tool names or JSON.',
  'Use lower-level platform tools only for advanced automation or when the guided tools cannot cover the requested workflow. Existing workspace/system blocks can be inspected with list_blocks/get_block and compiled/validated with compile_block/validate_block before assembly. Always pass an explicit role for workspace/raw token blocks.',
  'Tier limits in Traseq are: research credits (USD/month), active strategy count, saved backtest count, and workspaces. Backtest period is NOT tier-limited; all tiers can run all available history. Only treat a failure as a plan/billing problem if the response carries `publicAgent.category` of `plan` or `usage`. Errors with `category: validation` are schema/parameter problems — re-read the relevant reference doc and fix the call, do not suggest the user upgrade.',
  'When validation fails, read `validationIssues` (or response body `issues`) for `code` / `path` / `severity` and fix the draft directly. Do not assume the platform is broken when validation reports issues; only escalate when issues are absent AND the response has no useful body.',
  'If you need a write or destructive platform tool that is not exposed, ask the operator to enable `--profile=full`. Do not assume it is missing by accident — the server filters writes out of the default `guided` profile.',
  '@traseq/agent does not call an AI provider, place live orders, or provide investment advice. Historical backtests are research evidence only.',
  'Destructive platform tools require confirm=true.',
  'Quick capability reference: timeframes are 15m, 1h, 4h, 1d. Market fields are open/high/low/close/hl2/hlc3/ohlc4/typical/median/volume. Operator categories: compare, cross, rolling, math, conflict policies. Patterns and indicators (~30+) are listed in the reference docs. For the authoritative current list call get_capabilities, or call start_research_engagement which dumps capabilities into the engagement context.',
  'Available instruments are Binance spot, USDT-quoted only. Each symbol has its own `dataStart` — a backtest range that begins before this date returns no candles, not a quota error, and the request is rejected with `category: validation`. Approximate set: BTCUSDT/ETHUSDT from 2017-08, XRPUSDT from 2017-11, ADAUSDT/TRXUSDT/BNBUSDT from 2018, LINKUSDT/DOGEUSDT from 2019, SOLUSDT from 2020, SUIUSDT from 2023. The authoritative list with exact dates lives in `capabilities.instruments` (read once via `traseq://capabilities`). Pass `signalInstrument.symbol` as one of those exact strings.',
  'Cacheable read-only data is exposed via MCP resources: `traseq://capabilities` (full capability spec, includes `instruments` with `dataStart`/`dataEnd`), `traseq://instruments` (instruments-only shortcut), and `traseq://system-strategies` (template index). Prefer reading these resources once per session over calling the equivalent tools on each turn — capabilities alone is large.',
  'Backtest range fields use `range.start` and `range.end` in **epoch milliseconds** (UTC). Not `startDate/endDate`, not candle indices.',
].join('\n');

/**
 * Render a tool failure into the MCP `text` content payload.
 *
 * `toolName`, when provided, opts the failure into client-side augmentation
 * (see tool-guard.ts) so the LLM sees an explicit guided-flow recovery hint
 * for known state-machine failure shapes. Calls without a name (e.g. the
 * resource handler) fall through to the unaugmented format used previously.
 */
function safeErrorMessage(error: unknown, toolName?: string): string {
  if (error instanceof TraseqApiError) {
    const augmentation = toolName
      ? augmentToolError(toolName, error)
      : { extraNextSteps: [], hintCode: null };
    const formatted = formatTraseqAgentError(error);
    const augmentedFormatted =
      augmentation.extraNextSteps.length > 0
        ? `${formatted}\n\nGuided-flow recovery (client-side hint, code=${
            augmentation.hintCode ?? 'unknown'
          }):\n${augmentation.extraNextSteps
            .map((step) => `- ${step}`)
            .join('\n')}`
        : formatted;
    return JSON.stringify(
      {
        isError: true,
        status: error.status,
        method: error.method,
        path: error.path,
        message: error.message,
        body: error.parsedBody,
        formatted: augmentedFormatted,
        ...(augmentation.extraNextSteps.length > 0
          ? {
              guidedFlowHint: {
                hintCode: augmentation.hintCode,
                nextSteps: augmentation.extraNextSteps,
              },
            }
          : {}),
      },
      null,
      2,
    );
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unexpected error occurred.';
}

/**
 * Render a synchronous preflight failure into the same content shape as
 * a tool error, so MCP clients can display it identically to API errors.
 * Stays out of the API call path entirely — no quota cost, no log noise.
 */
function preflightFailureContent(
  toolName: string,
  failure: PreflightFailure,
): { isError: true; content: { type: 'text'; text: string }[] } {
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            isError: true,
            preflight: true,
            tool: toolName,
            code: failure.code,
            message: failure.message,
            nextSteps: failure.nextSteps,
          },
          null,
          2,
        ),
      },
    ],
  };
}

function orderedAgentTools(profile: McpProfile = readProfileFromEnv()) {
  const guidedHeadOrder = GUIDED_TOOL_ORDER.map((name) =>
    getAgentToolDefinition(name),
  ).filter((tool) => tool !== undefined);
  // In guided mode, hide internal helpers (resolve/assemble/preflight/etc.)
  // from tools/list — they are reachable inside run_guided_research_round and
  // exposing every local helper pushes some clients into deferred-tool flows.
  // Full mode still exposes everything so advanced operators can intervene
  // step-by-step.
  if (profile === 'guided') {
    const guidedHeadNames = new Set(guidedHeadOrder.map((tool) => tool.name));
    const tail = AGENT_TOOL_REGISTRY.filter(
      (tool) =>
        GUIDED_AGENT_TOOL_NAMES.has(tool.name) &&
        !guidedHeadNames.has(tool.name),
    );
    return [...guidedHeadOrder, ...tail];
  }
  const rest = AGENT_TOOL_REGISTRY.filter(
    (tool) => !GUIDED_TOOL_NAMES.has(tool.name),
  );
  return [...guidedHeadOrder, ...rest];
}

function describeAgentTool(tool: {
  name: string;
  description: string;
}): string {
  return GUIDED_TOOL_NAMES.has(tool.name)
    ? `${tool.description} Recommended guided-service entrypoint.`
    : `${tool.description} Local agent helper.`;
}

/**
 * Per-tool prerequisite hints rendered FIRST in the description so LLMs
 * pattern-matching on tool name + first sentence don't skim past them.
 *
 * Add an entry here when an operation has a state-machine prerequisite that
 * isn't enforced at the schema level. The rest of the description still
 * carries the generic stage hint, so existing test assertions on
 * `Stage: write` / `Do not call before run_guided_research_round` keep passing.
 */
const PLATFORM_TOOL_PRECONDITIONS: Readonly<Record<string, string>> = {
  run_backtest:
    "REQUIRES strategy version status === 'finalized'. If your strategy is still draft, call run_guided_research_round (it validates, persists, finalizes, and backtests in one step) instead of run_backtest. run_backtest is for re-testing an already-finalized version with a different range or config.",
  finalize_strategy_version:
    "REQUIRES strategy version status === 'draft' AND remote validation passed. Prefer run_guided_research_round which finalizes as part of the validate->persist->backtest pipeline.",
  create_strategy_version:
    'REQUIRES forkedFromVersionId pointing at the previous version when a strategy already exists. Prefer run_guided_research_round, which derives the fork target automatically.',
};

function describePlatformTool(operation: OperationDefinition): string {
  const stage = operationStage(operation);
  const stageHint =
    stage === 'destructive'
      ? 'Stage: destructive. Do not call before run_guided_research_round validates a draft.'
      : stage === 'write'
        ? 'Stage: write. Do not call before run_guided_research_round validates a draft.'
        : 'Stage: read.';
  const precondition = PLATFORM_TOOL_PRECONDITIONS[operation.name];
  return [
    precondition ? `[${precondition}]` : '',
    'Advanced automation tool.',
    operation.description,
    stageHint,
    operation.destructive ? 'Requires confirm=true.' : '',
    operation.longRunning
      ? 'May take longer; use the paired get/wait tool when needed.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Build the MCP `tools/list` payload for a given profile.
 *
 * Running servers freeze the profile at boot (see `buildMcpServer`), so the
 * env-fallback default is only used by unit tests and direct callers — it
 * does not enable runtime profile switching for an already-connected server.
 */
export function toToolList(profile: McpProfile = readProfileFromEnv()): {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}[] {
  return [
    ...orderedAgentTools(profile).map((tool) => ({
      name: tool.name,
      description: describeAgentTool(tool),
      inputSchema: tool.input_schema,
    })),
    ...platformOperationsForProfile(profile).map((operation) => ({
      name: operation.name,
      description: describePlatformTool(operation),
      inputSchema: operation.input_schema,
    })),
  ];
}

function readProfileFromEnv(): McpProfile {
  return parseMcpProfile(readEnv('TRASEQ_MCP_PROFILE') ?? DEFAULT_MCP_PROFILE);
}

export function toPromptList() {
  return [
    {
      name: GUIDED_RESEARCH_PROMPT_NAME,
      description: GUIDED_RESEARCH_PROMPT_DESCRIPTION,
      arguments: [
        {
          name: 'idea',
          description: 'The strategy idea or market thesis to research.',
          required: true,
        },
        {
          name: 'instrument',
          description: 'Optional trading instrument, such as BTCUSDT.',
          required: false,
        },
        {
          name: 'timeframe',
          description: 'Optional timeframe: 15m, 1h, 4h, or 1d.',
          required: false,
        },
      ],
    },
  ];
}

function promptArg(args: unknown, key: string): string | undefined {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return undefined;
  }
  const value = (args as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function guidedResearchPromptText(args: unknown): string {
  const idea =
    promptArg(args, 'idea') ??
    'Validate a BTCUSDT 4h strategy idea with historical research evidence.';
  const instrument = promptArg(args, 'instrument');
  const timeframe = promptArg(args, 'timeframe');
  const context = [
    instrument ? `Instrument: ${instrument}` : '',
    timeframe ? `Timeframe: ${timeframe}` : '',
  ].filter(Boolean);

  return [
    `Use the Traseq MCP server to validate this strategy idea: ${idea}`,
    context.length > 0 ? context.join('\n') : '',
    '',
    'This is an MCP tool workflow, not a repo command or web-app flow. Do not search the repository for an entry point.',
    '1. First call the MCP tool `start_research_engagement` with the strategy idea, instrument, and timeframe you have.',
    '2. Present the research assumptions and only ask for high-value missing decisions.',
    '3. Author the strategy draft externally using the capabilities and semantic guidance.',
    '4. Call the MCP tool `run_guided_research_round` with the draft. Do not create or backtest if validation fails.',
    '5. Return a service memo with verdict, what was tested, evidence, risk flags, Traseq app links, and recommended next step.',
    'If `start_research_engagement` is unavailable, say the Traseq MCP server is not connected or not enabled.',
    '',
    'Do not present a raw tool list as the primary user experience. Do not provide investment advice or live-trading instructions.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function buildMcpServer(
  client: TraseqClient,
  profile: McpProfile = readProfileFromEnv(),
): McpServer {
  const mcp = new McpServer(
    {
      name: '@traseq/agent',
      version: packageVersion(),
    },
    {
      capabilities: {
        tools: { listChanged: false },
        prompts: { listChanged: false },
        resources: { listChanged: false },
      },
      instructions: MCP_SERVICE_INSTRUCTIONS,
    },
  );

  const exposedPlatformOps = new Set(
    platformOperationsForProfile(profile).map((op) => op.name),
  );

  const { server } = mcp;

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toToolList(profile),
  }));

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: toPromptList(),
  }));

  // P1-F: read-only resources let MCP clients cache the capability spec and
  // template index by URI rather than calling get_capabilities /
  // list_system_strategies on every research turn. Capabilities alone is
  // 5–15k tokens of JSON; once the client caches it the LLM stops paying
  // for it on each round, and we keep the resource shape stable so cache
  // invalidation only fires on actual server upgrades.
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: 'traseq://capabilities',
        name: 'Traseq capability spec',
        description:
          'Full capability document: indicators, operators, node kinds, timeframes, tier limits, and the instrument universe (each instrument carries its `dataStart`). Read once and cache; stable across a server lifetime.',
        mimeType: 'application/json',
      },
      {
        uri: 'traseq://instruments',
        name: 'Traseq instrument universe',
        description:
          'Trading instruments only — same data as `capabilities.instruments`, exposed as a smaller resource for callers that just need the symbol list and `dataStart` per symbol. Use this before picking `signalInstrument.symbol` and `range.start`.',
        mimeType: 'application/json',
      },
      {
        uri: 'traseq://system-strategies',
        name: 'Traseq system strategy index',
        description:
          'List of forkable strategy templates with key, name, category, and tags. Use compose_strategy_from_template to fork one.',
        mimeType: 'application/json',
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    const fetchAndSerialize = async (): Promise<string> => {
      if (uri === 'traseq://capabilities') {
        return JSON.stringify(await client.getCapabilities(), null, 2);
      }
      if (uri === 'traseq://instruments') {
        const capabilities = (await client.getCapabilities()) as {
          instruments?: unknown;
        };
        return JSON.stringify(capabilities.instruments ?? [], null, 2);
      }
      if (uri === 'traseq://system-strategies') {
        return JSON.stringify(await client.listSystemStrategies(), null, 2);
      }
      throw new McpError(
        ErrorCode.InvalidParams,
        `Unknown resource URI: ${uri}`,
      );
    };
    try {
      const text = await fetchAndSerialize();
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text,
          },
        ],
      };
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to read resource ${uri}: ${safeErrorMessage(error)}`,
      );
    }
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const name = request.params.name;
    if (name !== GUIDED_RESEARCH_PROMPT_NAME) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown prompt: ${name}`);
    }
    return {
      description: GUIDED_RESEARCH_PROMPT_DESCRIPTION,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: guidedResearchPromptText(request.params.arguments),
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const rawArgs = request.params.arguments ?? {};
    // Normalize to a plain object exactly once so preflight/dispatch see the
    // same shape regardless of how the SDK transport boxed the call.
    const args: Record<string, unknown> =
      typeof rawArgs === 'object' && rawArgs !== null && !Array.isArray(rawArgs)
        ? (rawArgs as Record<string, unknown>)
        : {};
    const startedAt = Date.now();
    const log = (outcome: ToolCallOutcome): void => {
      emitToolCallEvent({
        event: 'tool_call',
        ts: new Date(startedAt).toISOString(),
        tool: name,
        profile,
        durationMs: Date.now() - startedAt,
        outcome,
      });
    };

    // Synchronous arg-shape preflight. Cheap, runs before agent/platform
    // dispatch so a malformed run_backtest call never reaches the API.
    const preflight = preflightToolArgs(name, args);
    if (preflight) {
      log({ kind: 'preflight_blocked', code: preflight.code });
      return preflightFailureContent(name, preflight);
    }

    const agentTool = getAgentToolDefinition(name);
    if (agentTool) {
      if (
        profile === 'guided' &&
        !GUIDED_AGENT_TOOL_NAMES.has(agentTool.name)
      ) {
        // Profile rejection throws — emit telemetry first so dashboards see it.
        log({
          kind: 'preflight_blocked',
          code: 'PROFILE_TOOL_HIDDEN',
        });
        throw new McpError(
          ErrorCode.InvalidParams,
          `Tool "${name}" is an advanced agent helper and is not available in profile "guided". Use run_guided_research_round (which composes resolve/assemble/preflight internally) or restart with --profile=full to access this helper directly.`,
        );
      }
      try {
        const result = await runAgentTool(agentTool.name, args, { client });
        log({ kind: 'success' });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        const augmentation = augmentToolError(name, error);
        log(
          augmentation.extraNextSteps.length > 0
            ? { kind: 'augmented_error', hintCode: augmentation.hintCode }
            : classifyError(error),
        );
        return {
          isError: true,
          content: [{ type: 'text', text: safeErrorMessage(error, name) }],
        };
      }
    }

    const operation = OPERATION_REGISTRY.find((item) => item.name === name);
    if (!operation) {
      log({ kind: 'runtime_error', message: `Unknown tool: ${name}` });
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
    }
    if (!exposedPlatformOps.has(operation.name)) {
      log({ kind: 'preflight_blocked', code: 'PROFILE_TOOL_HIDDEN' });
      throw new McpError(
        ErrorCode.InvalidParams,
        `Tool "${name}" is not available in profile "${profile}". Restart the MCP server with --profile=full or set TRASEQ_MCP_PROFILE=full to enable advanced platform tools.`,
      );
    }

    try {
      const result = await runPlatformTool(
        client,
        operation.name as OperationName,
        args,
      );
      log({ kind: 'success' });
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const augmentation = augmentToolError(name, error);
      log(
        augmentation.extraNextSteps.length > 0
          ? { kind: 'augmented_error', hintCode: augmentation.hintCode }
          : classifyError(error),
      );
      return {
        isError: true,
        content: [{ type: 'text', text: safeErrorMessage(error, name) }],
      };
    }
  });

  return mcp;
}

export async function startMcpServer(
  options: { profile?: McpProfile } = {},
): Promise<void> {
  const apiKey = await resolveTraseqApiKey();
  const baseUrl = readEnv('TRASEQ_BASE_URL') ?? 'https://api.traseq.com';
  const client = new TraseqClient({ apiKey, baseUrl });
  const profile = options.profile ?? readProfileFromEnv();
  const mcp = buildMcpServer(client, profile);
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
}
