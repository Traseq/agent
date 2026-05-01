import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  McpError,
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
  operationStage,
  parseMcpProfile,
  platformOperationsForProfile,
  type McpProfile,
} from './profile.js';

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
  'Default flow: call start_research_engagement first, resolve semantics, assemble_signal_graph, preflight_strategy_draft, then run_guided_research_round to validate remotely, persist after validation, backtest, evaluate evidence, and return a memo.',
  'If start_research_engagement is not available, tell the user the Traseq MCP server is not connected or not enabled.',
  'Show users the research task, assumptions, verdict, evidence, risk flags, Traseq app links, and next step. Do not lead with raw tool names or JSON.',
  'Use lower-level platform tools only for advanced automation or when the guided tools cannot cover the requested workflow.',
  'If you need a write or destructive platform tool that is not exposed, ask the operator to enable `--profile=full`. Do not assume it is missing by accident — the server filters writes out of the default `guided` profile.',
  '@traseq/agent does not call an AI provider, place live orders, or provide investment advice. Historical backtests are research evidence only.',
  'Destructive platform tools require confirm=true.',
].join('\n');

function safeErrorMessage(error: unknown): string {
  if (error instanceof TraseqApiError) {
    return JSON.stringify(
      {
        isError: true,
        status: error.status,
        method: error.method,
        path: error.path,
        message: error.message,
        body: error.parsedBody,
        formatted: formatTraseqAgentError(error),
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

function orderedAgentTools() {
  const guided = GUIDED_TOOL_ORDER.map((name) =>
    getAgentToolDefinition(name),
  ).filter((tool) => tool !== undefined);
  const rest = AGENT_TOOL_REGISTRY.filter(
    (tool) => !GUIDED_TOOL_NAMES.has(tool.name),
  );
  return [...guided, ...rest];
}

function describeAgentTool(tool: {
  name: string;
  description: string;
}): string {
  return GUIDED_TOOL_NAMES.has(tool.name)
    ? `${tool.description} Recommended guided-service entrypoint.`
    : `${tool.description} Local agent helper.`;
}

function describePlatformTool(operation: OperationDefinition): string {
  const stage = operationStage(operation);
  const stageHint =
    stage === 'destructive'
      ? 'Stage: destructive. Do not call before run_guided_research_round validates a draft.'
      : stage === 'write'
        ? 'Stage: write. Do not call before run_guided_research_round validates a draft.'
        : 'Stage: read.';
  return [
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
    ...orderedAgentTools().map((tool) => ({
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
    const args = request.params.arguments ?? {};
    const agentTool = getAgentToolDefinition(name);
    if (agentTool) {
      try {
        const result = await runAgentTool(agentTool.name, args, { client });
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: safeErrorMessage(error) }],
        };
      }
    }

    const operation = OPERATION_REGISTRY.find((item) => item.name === name);
    if (!operation) {
      throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${name}`);
    }
    if (!exposedPlatformOps.has(operation.name)) {
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
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: safeErrorMessage(error) }],
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
