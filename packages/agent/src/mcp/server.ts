import {
  TraseqClient,
  TraseqApiError,
  formatTraseqAgentError,
} from '@traseq/sdk';
import {
  OPERATION_REGISTRY,
  type OperationName,
} from '../generated/operation-registry.js';
import { readEnv, requireEnv } from '../env.js';
import { runPlatformTool } from '../client/tool-runner.js';
import {
  AGENT_TOOL_REGISTRY,
  getAgentToolDefinition,
  runAgentTool,
} from '../semantics/index.js';

const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10 MB
const GUIDED_RESEARCH_PROMPT_NAME = 'traseq_guided_research';
const GUIDED_TOOL_ORDER = [
  'start_research_engagement',
  'run_guided_research_round',
  'summarize_research_engagement',
] as const;
const MCP_SERVICE_INSTRUCTIONS = [
  'Use Traseq as a guided strategy research service, not as a raw toolbox.',
  'Default flow: call start_research_engagement first, author a strategy draft outside Traseq, then call run_guided_research_round to validate, persist after validation, backtest, evaluate evidence, and return a memo.',
  'Show users the research task, assumptions, verdict, evidence, risk flags, Traseq app links, and next step. Do not lead with raw tool names or JSON.',
  'Use lower-level platform tools only for advanced automation or when the guided tools cannot cover the requested workflow.',
  '@traseq/agent does not call an AI provider, place live orders, or provide investment advice. Historical backtests are research evidence only.',
  'Destructive platform tools require confirm=true.',
].join('\n');

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: '2.0';
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
}

function createClient(): TraseqClient {
  return new TraseqClient({
    apiKey: requireEnv('TRASEQ_API_KEY'),
    baseUrl: readEnv('TRASEQ_BASE_URL') ?? 'https://api.traseq.com',
  });
}

function writeFrame(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function writeResult(id: JsonRpcId, result: unknown): void {
  writeFrame({
    jsonrpc: '2.0',
    id,
    result,
  });
}

function writeError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): void {
  writeFrame({
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data }),
    },
  });
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof TraseqApiError) {
    return formatTraseqAgentError(error);
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unexpected error occurred.';
}

const GUIDED_TOOL_NAMES = new Set<string>(GUIDED_TOOL_ORDER);

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

function toToolList() {
  return [
    ...orderedAgentTools().map((tool) => ({
      name: tool.name,
      description: describeAgentTool(tool),
      inputSchema: tool.input_schema,
    })),
    ...OPERATION_REGISTRY.map((operation) => ({
      name: operation.name,
      description: [
        'Advanced automation tool.',
        operation.description,
        operation.destructive ? 'Requires confirm=true.' : '',
        operation.longRunning
          ? 'May take longer; use the paired get/wait tool when needed.'
          : '',
      ]
        .filter(Boolean)
        .join(' '),
      inputSchema: operation.input_schema,
    })),
  ];
}

function toPromptList() {
  return [
    {
      name: GUIDED_RESEARCH_PROMPT_NAME,
      description:
        'Start a Traseq guided strategy research engagement from a user trading idea.',
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

function guidedResearchPromptText(args: unknown): string {
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
    `Help me validate this Traseq strategy idea: ${idea}`,
    context.length > 0 ? context.join('\n') : '',
    '',
    'Use the Traseq MCP guided research flow:',
    '1. Call start_research_engagement first to read workspace context, usage, capabilities, assumptions, and decision points.',
    '2. Present the research assumptions and only ask for high-value missing decisions.',
    '3. Author the strategy draft externally using the capabilities and semantic guidance.',
    '4. Call run_guided_research_round with the draft. Do not create or backtest if validation fails.',
    '5. Return a service memo with verdict, what was tested, evidence, risk flags, Traseq app links, and recommended next step.',
    '',
    'Do not present a raw tool list as the primary user experience. Do not provide investment advice or live-trading instructions.',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

async function handleRequest(client: TraseqClient, request: JsonRpcRequest) {
  const id = request.id ?? null;
  const method = request.method;

  if (!method) {
    writeError(id, -32600, 'Invalid JSON-RPC request: missing method.');
    return;
  }

  if (method.startsWith('notifications/')) {
    return;
  }

  try {
    switch (method) {
      case 'initialize':
        writeResult(id, {
          protocolVersion:
            typeof request.params?.protocolVersion === 'string'
              ? request.params.protocolVersion
              : '2024-11-05',
          capabilities: {
            tools: {
              listChanged: false,
            },
            prompts: {
              listChanged: false,
            },
          },
          serverInfo: {
            name: '@traseq/agent',
            version: '0.1.0',
          },
          instructions: MCP_SERVICE_INSTRUCTIONS,
        });
        return;
      case 'tools/list':
        writeResult(id, { tools: toToolList() });
        return;
      case 'prompts/list':
        writeResult(id, { prompts: toPromptList() });
        return;
      case 'prompts/get': {
        const name =
          typeof request.params?.name === 'string' ? request.params.name : '';
        if (name !== GUIDED_RESEARCH_PROMPT_NAME) {
          writeError(id, -32602, `Unknown prompt: ${name}`);
          return;
        }

        writeResult(id, {
          description:
            'Start a Traseq guided strategy research engagement from a user trading idea.',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: guidedResearchPromptText(request.params?.arguments),
              },
            },
          ],
        });
        return;
      }
      case 'tools/call': {
        const name =
          typeof request.params?.name === 'string' ? request.params.name : '';
        const args = request.params?.arguments ?? {};
        const agentTool = getAgentToolDefinition(name);
        if (agentTool) {
          try {
            const result = await runAgentTool(agentTool.name, args, { client });
            writeResult(id, {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            });
          } catch (error) {
            writeResult(id, {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: safeErrorMessage(error),
                },
              ],
            });
          }
          return;
        }

        const operation = OPERATION_REGISTRY.find((item) => item.name === name);
        if (!operation) {
          writeError(id, -32602, `Unknown tool: ${name}`);
          return;
        }

        try {
          const result = await runPlatformTool(
            client,
            operation.name as OperationName,
            args,
          );
          writeResult(id, {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          });
        } catch (error) {
          writeResult(id, {
            isError: true,
            content: [
              {
                type: 'text',
                text: safeErrorMessage(error),
              },
            ],
          });
        }
        return;
      }
      default:
        writeError(id, -32601, `Method not found: ${method}`);
    }
  } catch (error) {
    writeError(id, -32603, safeErrorMessage(error));
  }
}

function processBuffer(client: TraseqClient, state: { buffer: Buffer }): void {
  for (;;) {
    const newlineIdx = state.buffer.indexOf(0x0a);
    if (newlineIdx === -1) {
      return;
    }

    const line = state.buffer.subarray(0, newlineIdx).toString('utf8').trim();
    state.buffer = state.buffer.subarray(newlineIdx + 1);

    if (line.length === 0) {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as JsonRpcRequest;
      void handleRequest(client, parsed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeError(null, -32700, message);
    }
  }
}

export function startMcpServer(): void {
  const client = createClient();
  const state = { buffer: Buffer.alloc(0) };

  process.stdin.on('data', (chunk: Buffer) => {
    state.buffer = Buffer.concat([state.buffer, chunk]);
    if (state.buffer.length > MAX_BUFFER_BYTES) {
      writeError(null, -32600, 'Buffer limit exceeded.');
      state.buffer = Buffer.alloc(0);
      return;
    }
    processBuffer(client, state);
  });
}
