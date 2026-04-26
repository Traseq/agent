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
  const text = JSON.stringify(payload);
  process.stdout.write(
    `Content-Length: ${Buffer.byteLength(text, 'utf8')}\r\n\r\n${text}`,
  );
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
  return OPERATION_REGISTRY.map((operation) => ({
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
  }));
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
            'Use Traseq tools with a workspace-scoped TRASEQ_API_KEY. Destructive tools require confirm=true.',
        });
        return;
      case 'tools/list':
        writeResult(id, { tools: toToolList() });
        return;
      case 'tools/call': {
        const name =
          typeof request.params?.name === 'string' ? request.params.name : '';
        const args = request.params?.arguments ?? {};
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
    const headerEnd = state.buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      return;
    }

    const header = state.buffer.subarray(0, headerEnd).toString('utf8');
    const match = /content-length:\s*(\d+)/i.exec(header);
    if (!match) {
      state.buffer = state.buffer.subarray(headerEnd + 4);
      writeError(null, -32700, 'Missing Content-Length header.');
      continue;
    }

    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (state.buffer.length < bodyEnd) {
      return;
    }

    const body = state.buffer.subarray(bodyStart, bodyEnd).toString('utf8');
    state.buffer = state.buffer.subarray(bodyEnd);

    try {
      const parsed = JSON.parse(body) as JsonRpcRequest;
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
