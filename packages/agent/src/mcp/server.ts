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
import { GUIDED_TOOL_NAMES, GUIDED_TOOL_ORDER } from '../internal/literals.js';
import { packageVersion } from '../install/version.js';
import {
  DEFAULT_MCP_PROFILE,
  agentToolNamesForProfile,
  formatMcpProfileList,
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

/**
 * Static documentation surfaced via `traseq://persistence-requirements`.
 *
 * Why static rather than fetched: strategy writes accept `signalGraph +
 * settings`, while backtest fields (`backtest.signalInstrument.symbol`,
 * `execution.feeModel`, range, etc.) live outside the create/finalize payload.
 * The boundary is not obvious from the API alone — LLMs routinely mix backtest
 * config into create/finalize calls. This resource names the boundary
 * explicitly and points at the right discovery surface for each field.
 *
 * Update this when a new persistence-only requirement is added on the server.
 */
const PERSISTENCE_REQUIREMENTS_DOC = {
  description:
    'Fields enforced by Traseq strategy-write and backtest endpoints. `validate_strategy` is the write-preflight for strategy metadata (`signalGraph + settings`); backtest config remains validated by `run_backtest`. Each entry below names the field, where it belongs, and the recovery action.',
  validateChecks: ['signalGraph', 'settings'],
  validateSkips: [
    'backtest.* (entire section)',
    'meta.source.* (server-owned provenance)',
  ],
  requirements: [
    {
      field: 'backtest.signalInstrument.symbol',
      requiredAt: ['run_backtest'],
      requiredByValidate: false,
      reason:
        'Strategy create/finalize does not accept backtest config. runBacktest rejects a missing or unknown symbol.',
      discovery: 'traseq://instruments (or capabilities.instruments)',
      legalValuesShape: 'Exact symbol strings, e.g. "BTCUSDT", "BNBUSDT".',
      recovery:
        "Read traseq://instruments, set `backtest.signalInstrument.symbol` to one of the listed symbols, and confirm `range.start` is at or after the symbol's `dataStart`.",
    },
    {
      field: 'backtest.range.start / backtest.range.end',
      requiredAt: ['run_backtest'],
      requiredByValidate: false,
      reason:
        'Optional at runBacktest — when omitted, the engine covers the full available history for the instrument. When set, runBacktest accepts ISO dates ("2024-01-01"), relative durations ("1y", "6m", "30d", "2w", "ytd"), the symbolic tokens "now"/"inception", or numeric epoch (10-digit seconds or 13-digit milliseconds). Validate ignores this section entirely.',
      discovery:
        "traseq://instruments for the symbol's `dataStart` lower bound; the response\\'s runContext.resolvedRange echoes the {start, end} epoch ms the engine actually used.",
      legalValuesShape:
        "ISO date | relative duration | 'now' | 'inception' | 'ytd' | epoch seconds | epoch milliseconds. range.start must resolve to a value >= the symbol's `dataStart`. When both are set, range.start < range.end after resolution.",
      recovery:
        'Pass any supported form — runBacktest resolves it. The agent runner pre-resolves common forms client-side so persistence/preflight never see un-resolved strings (see `resolveRangePoint` in normalize). Do not pass candle indices.',
    },
    {
      field: 'backtest.execution.feeModel',
      requiredAt: ['run_backtest when config.execution is supplied'],
      requiredByValidate: false,
      reason:
        'Strategy create/finalize does not accept backtest config. runBacktest accepts `execution` as optional; when omitted, server workspace defaults provide the execution model. When supplied, the execution schema documents the legal `feeModel` shape (`kind: "tiered_maker_taker"` with `tiers`).',
      discovery:
        'traseq://capabilities → look for `backtest.execution.feeModel` schema; or fork a system strategy via compose_strategy_from_template (templates carry valid feeModels).',
      legalValuesShape:
        '{ kind: "tiered_maker_taker", tiers: [{ minCumulativeNotional: number, makerRate: 0..1, takerRate: 0..1 }, ...] }',
      recovery:
        'For guided research, prefer omitting `backtest.execution` unless you intentionally want custom fees/slippage; the server will apply workspace defaults. If you supply execution, copy the feeModel from workspace/default capability data rather than inventing rate values.',
    },
    {
      field: 'meta.source.editor',
      requiredAt: [
        'create_strategy',
        'create_strategy_version',
        'finalize_strategy_version',
      ],
      requiredByValidate: false,
      reason:
        'Server-owned provenance enum. Values vary by deployment; the local repo lists `token-flow | text-dsl | ai | runtime-strategy | signal-graph`, but other deployments expose different sets (e.g. `workspace | ai-pasta | ai-pesto`). LLMs frequently pass a guessed string like `ai` or `llm`.',
      discovery:
        'traseq://capabilities → look for the source.editor enum, or run start_research_engagement which fills meta on the server side.',
      legalValuesShape: 'Server-defined string enum (deployment-specific).',
      recovery:
        'Prefer omitting `meta.source.editor` entirely — start_research_engagement / run_guided_research_round set it correctly server-side. Only set it explicitly when the capability spec lists the value you intend to use.',
    },
  ],
  notes: [
    'create_strategy / finalize_strategy_version accept strategy metadata only: signalGraph + settings (plus name/description/version/ignoreWarnings/fork lineage as applicable). Do not pass backtest there.',
    'assemble_strategy_from_blocks(valid:true) means the recipe assembly is internally consistent; still call validate_strategy as the write-preflight before persisting.',
  ],
} as const;

export const GUIDED_RESEARCH_PROMPT_NAME = 'traseq_guided_research';
export const GUIDED_RESEARCH_PROMPT_DESCRIPTION =
  'Start a Traseq guided strategy research engagement by calling the start_research_engagement MCP tool first.';

export const MCP_SERVICE_INSTRUCTIONS = [
  'Use Traseq as a guided strategy research service, not as a raw toolbox.',
  '`Traseq research engagement` is this MCP tool workflow. When the active profile exposes start_research_engagement and the user asks to validate or research a strategy, call it first; do not search the local repo or ask the user for an entry point.',
  'Default flow: call start_research_engagement first, then follow the returned recommendedToolPath. Vague intent should start from templates, recipes, or editable blocks. Concrete or expert strategy intent should be authored directly as SG v2, then preflighted before run_guided_research_round.',
  'For strategy composition, use recipes/blocks only when they exactly preserve the user intent or when the user is exploring from templates. Do not force concrete custom logic into a recipe shape. Tokens/blocks are provenance/composition; SignalGraph v2 remains the strategy write contract.',
  'If start_research_engagement should be available for the active workflow profile but is missing, tell the user the Traseq MCP server is not connected or not enabled.',
  'Show users the research task, assumptions, verdict, evidence, risk flags, Traseq app links, and next step. Do not lead with raw tool names or JSON.',
  'Use lower-level platform tools only for advanced automation or when the recommended authoring path cannot cover the requested workflow. Existing workspace/system blocks can be inspected with list_blocks/get_block and compiled/validated with compile_block/validate_block before assembly. Always pass an explicit role for workspace/raw token blocks.',
  'Tier limits in Traseq are: research credits (USD/month), active strategy count, saved backtest count, and workspaces. Backtest period is NOT tier-limited; all tiers can run all available history. Only treat a failure as a plan/billing problem if the response carries `publicAgent.category` of `plan` or `usage`. Errors with `category: validation` are schema/parameter problems — re-read the relevant reference doc and fix the call, do not suggest the user upgrade.',
  'When validation fails, read `failure.issues` (or response body `issues`) for `code` / `path` / `severity` and fix the draft directly. Do not assume the platform is broken when validation reports issues; only escalate when issues are absent AND the response has no useful body.',
  '`validate_strategy` is the strategy write-preflight for `signalGraph + settings`; it does NOT cover `run_backtest` execution/range/cost behavior. Keep create/finalize payloads strategy-only, and send backtest config only to run_backtest or run_guided_research_round.',
  'For iterative research, prefer passing `strategyId` to run_guided_research_round and reusing the returned `nextIterationSeed` on the following round. If `forkedFromVersionId` is omitted, the runner resolves the latest ready/finalized version before writing the next draft.',
  'If you need a write or destructive platform tool that is not exposed, ask the operator to enable `--profile=full`. Do not assume it is missing by accident — non-full profiles filter writes out of tools/list.',
  '@traseq/agent does not call an AI provider, place live orders, or provide investment advice. Historical backtests are research evidence only.',
  'Destructive platform tools require confirm=true.',
  'Quick capability reference: timeframes are 15m, 1h, 4h, 1d. Market fields are open/high/low/close/hl2/hlc3/ohlc4/typical/median/volume. Operator categories: compare, cross, rolling, math, conflict policies. Patterns and indicators (~30+) are listed in the reference docs. For the authoritative current list call get_capabilities, or call start_research_engagement which dumps capabilities into the engagement context.',
  'Available instruments are Binance spot, USDT-quoted only. Each symbol has its own `dataStart` — a backtest range that begins before this date returns no candles, not a quota error, and the request is rejected with `category: validation`. Approximate set: BTCUSDT/ETHUSDT from 2017-08, XRPUSDT from 2017-11, ADAUSDT/TRXUSDT/BNBUSDT from 2018, LINKUSDT/DOGEUSDT from 2019, SOLUSDT from 2020, SUIUSDT from 2023. The authoritative list with exact dates lives in `capabilities.instruments` (read once via `traseq://capabilities`). Pass `signalInstrument.symbol` as one of those exact strings.',
  'Cacheable read-only data is exposed via MCP resources: `traseq://capabilities` (full capability spec, includes `instruments` with `dataStart`/`dataEnd`), `traseq://instruments` (instruments-only shortcut), and `traseq://system-strategies` (template index). Prefer reading these resources once per session over calling the equivalent tools on each turn — capabilities alone is large.',
  'Backtest range fields use `range.start` and `range.end`. The runBacktest endpoint accepts flexible time inputs (ISO date "2024-01-01", relative duration "1y"/"6m"/"ytd", symbolic "now"/"inception", or numeric epoch in seconds or milliseconds). The response\'s `runContext.resolvedRange` echoes the {start,end} epoch ms the engine used. The agent runner additionally resolves common forms client-side before persistence so guided rounds work uniformly. Do NOT pass `startDate/endDate` or candle indices.',
].join('\n');

const PROFILE_INSTRUCTIONS: Record<McpProfile, string> = {
  hybrid:
    'Current profile: hybrid. Lean default surface with one entry point per authoring path. For raw token-grammar inspection (materialize_token_ast / validate_token_grammar_candidate / get_token_grammar) restart with --profile=template. For SG v2 deep-dive (get_semantics) restart with --profile=authoring.',
  template:
    'Current profile: template. Token recipes, system templates, and editable blocks are exposed; direct SG v2 helpers (assemble_signal_graph / preflight_strategy_draft / suggest_minimal_repairs) are NOT. Do not advertise SG v2 paths to the user — restart with --profile=authoring or --profile=full if SG v2 is required.',
  authoring:
    'Current profile: authoring. Direct SG v2 helpers and the semantic resolver are exposed; recipe composers (compose_token_block / assemble_strategy_from_blocks) are NOT. Do not advertise recipe paths — restart with --profile=template or --profile=full if recipe composition is required.',
  reference:
    'Current profile: reference. Read-only examples, grammar, and semantics. Do NOT call composer or assembler tools (none are exposed). Use get_authoring_examples / get_token_grammar / get_token_semantics / get_semantics as reference material only.',
  full: 'Current profile: full. Every agent tool and platform operation is exposed, including write/destructive ones. Continue to call start_research_engagement first and follow its recommendedToolPath unless the user explicitly requests a different exposed authoring path. Destructive platform tools still require confirm=true.',
};

function mcpServiceInstructionsForProfile(profile: McpProfile): string {
  return `${MCP_SERVICE_INSTRUCTIONS}\n${PROFILE_INSTRUCTIONS[profile]}`;
}

/**
 * Parse a JSON string, returning `undefined` if parsing fails. Used when
 * wrapping a tool's text output into a structured envelope (with `warnings`)
 * — if the inner text isn't valid JSON we leave it as a raw string so the
 * envelope still serializes cleanly.
 */
function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Compare the caller's tool args against the tool's input_schema.properties
 * and return the list of top-level keys the schema does not declare. Returned
 * as a `warnings` field on successful tool responses so agents can audit the
 * exact keys their JSON included that the SDK / API will silently ignore.
 *
 * Why top-level only: the JSON Schemas in the operation registry routinely
 * use `additionalProperties: false` at the root, and the persistence pipeline
 * cares about whether unknown SHAPE fields landed at the wrong level. Going
 * deeper (e.g. unknown keys inside `config.signalGraph.nodes[i].args`) is
 * already handled by `preflight_strategy_draft` / `validate_strategy`, and
 * would generate noise for legitimately-passthrough sub-objects.
 */
function detectUnknownTopLevelArgs(
  args: Record<string, unknown>,
  inputSchema: Record<string, unknown> | undefined,
): readonly string[] {
  if (!inputSchema || typeof inputSchema !== 'object') return [];
  const properties = (inputSchema as { properties?: unknown }).properties;
  if (
    !properties ||
    typeof properties !== 'object' ||
    Array.isArray(properties)
  ) {
    return [];
  }
  const declared = new Set(Object.keys(properties as Record<string, unknown>));
  const additional = (inputSchema as { additionalProperties?: unknown })
    .additionalProperties;
  // When additionalProperties is true, the schema deliberately accepts extras
  // (rare in this registry, but respected when present).
  if (additional === true) return [];
  return Object.keys(args).filter((key) => !declared.has(key));
}

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
              hintCode: augmentation.hintCode,
              nextSteps: augmentation.extraNextSteps,
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
  const allowedAgentTools = agentToolNamesForProfile(profile);
  const guidedHeadOrder = GUIDED_TOOL_ORDER.flatMap((name) => {
    const tool = getAgentToolDefinition(name);
    if (!tool) return [];
    if (allowedAgentTools !== undefined && !allowedAgentTools.has(tool.name)) {
      return [];
    }
    return [tool];
  });
  if (allowedAgentTools) {
    const guidedHeadNames = new Set(guidedHeadOrder.map((tool) => tool.name));
    const tail = AGENT_TOOL_REGISTRY.filter(
      (tool) =>
        allowedAgentTools.has(tool.name) && !guidedHeadNames.has(tool.name),
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
      instructions: mcpServiceInstructionsForProfile(profile),
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
          'Full capability document: indicators, operators, node kinds, timeframes, tier limits, and the instrument universe (each instrument carries its `dataStart`). Read once and cache; stable across a server lifetime. NOTE: capabilities reports strategy authoring plus backtest execution schema. create/finalize remain strategy-only; execution.feeModel belongs to run_backtest config and can be omitted to use workspace defaults.',
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
      {
        uri: 'traseq://persistence-requirements',
        name: 'Traseq strategy-write and backtest field boundaries',
        description:
          'Strategy-write and backtest field boundaries. Read this when an LLM-authored draft mixes backtest config into create/finalize or when run_backtest rejects execution/range/instrument config. Lists each field, its discovery surface, and the recovery action.',
        mimeType: 'application/json',
      },
      {
        uri: 'traseq://tool-schemas',
        name: 'Traseq MCP tool input schemas',
        description:
          'Per-tool input JSON Schemas for every tool exposed by this MCP server in the current profile. Use to look up the legal field shape of a single tool (e.g. `run_backtest.config.range`) without enumerating the full tools/list payload. The same schemas are present on tools/list, but this resource is a smaller, cacheable read for agents that only need field-level introspection on one tool.',
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
      if (uri === 'traseq://persistence-requirements') {
        return JSON.stringify(PERSISTENCE_REQUIREMENTS_DOC, null, 2);
      }
      if (uri === 'traseq://tool-schemas') {
        const schemas = Object.fromEntries(
          toToolList(profile).map((tool) => [
            tool.name,
            {
              description: tool.description,
              inputSchema: tool.inputSchema,
            },
          ]),
        );
        return JSON.stringify(
          {
            profile,
            schemas,
            note: 'Top-level keys not declared in `inputSchema.properties` are surfaced as `unknownArgs` warnings on tool responses (when the schema does not set `additionalProperties: true`). Read the per-tool schema before passing custom metadata fields.',
          },
          null,
          2,
        );
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

    // Top-level unknown-arg detection: if the caller sent fields the tool's
    // schema does not declare (and the schema isn't `additionalProperties:
    // true`), we DO NOT reject — those fields would just be silently dropped
    // by the SDK / API. Instead we surface them in a `warnings` array on the
    // success response so agents can audit "why was my metadata not echoed
    // back?" without reverse-engineering the schema. Computed once here so
    // both agent-tool and platform-tool dispatch paths use the same list.
    const schemaForTool = toToolList(profile).find(
      (tool) => tool.name === name,
    );
    const unknownArgs = schemaForTool
      ? detectUnknownTopLevelArgs(args, schemaForTool.inputSchema)
      : [];
    const buildSuccessPayload = (resultText: string) => {
      if (unknownArgs.length === 0) {
        return { content: [{ type: 'text', text: resultText }] };
      }
      const ignoredKeysList = unknownArgs
        .map((key) => JSON.stringify(key))
        .join(', ');
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                result: safeParseJson(resultText),
                warnings: [
                  {
                    code: 'UNKNOWN_TOP_LEVEL_ARGS',
                    ignoredKeys: unknownArgs,
                    message: `${name} ignored ${unknownArgs.length} top-level arg key(s) not declared in its input schema: ${ignoredKeysList}. Read traseq://tool-schemas#${name} for the legal field list.`,
                  },
                ],
              },
              null,
              2,
            ),
          },
        ],
      };
    };

    const agentTool = getAgentToolDefinition(name);
    if (agentTool) {
      const allowedAgentTools = agentToolNamesForProfile(profile);
      if (
        allowedAgentTools !== undefined &&
        !allowedAgentTools.has(agentTool.name)
      ) {
        // Profile rejection throws — emit telemetry first so dashboards see it.
        log({
          kind: 'preflight_blocked',
          code: 'PROFILE_TOOL_HIDDEN',
        });
        throw new McpError(
          ErrorCode.InvalidParams,
          `Tool "${name}" is not available in profile "${profile}". Choose a profile that exposes this authoring path (${formatMcpProfileList()}) or restart with --profile=full for every agent helper.`,
        );
      }
      try {
        const result = await runAgentTool(agentTool.name, args, { client });
        log({ kind: 'success' });
        return buildSuccessPayload(JSON.stringify(result, null, 2));
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
        `Tool "${name}" is not available in profile "${profile}". Restart with one of: ${formatMcpProfileList()}. Write/destructive platform tools require --profile=full.`,
      );
    }

    try {
      const result = await runPlatformTool(
        client,
        operation.name as OperationName,
        args,
      );
      log({ kind: 'success' });
      return buildSuccessPayload(JSON.stringify(result, null, 2));
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
