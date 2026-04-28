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

function toToolList() {
  return [
    ...AGENT_TOOL_REGISTRY.map((tool) => ({
      name: tool.name,
      description: `${tool.description} Local agent tool.`,
      inputSchema: tool.input_schema,
    })),
    ...OPERATION_REGISTRY.map((operation) => ({
      name: operation.name,
      description: [
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
          },
          serverInfo: {
            name: '@traseq/agent',
            version: '0.1.0',
          },
          instructions:
            'Use start_research_engagement first for service-style strategy research. @traseq/agent guides validation, backtesting, evidence review, and reporting with a workspace-scoped TRASEQ_API_KEY; it does not call an AI provider or place live orders. Destructive platform tools require confirm=true.',
        });
        return;
      case 'tools/list':
        writeResult(id, { tools: toToolList() });
        return;
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
