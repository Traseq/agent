import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const HANDSHAKE_TIMEOUT_MS = 15_000;

async function withClient(fn) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['./dist/cli.js', 'mcp'],
    env: {
      ...process.env,
      TRASEQ_API_KEY: 'test-contract-key',
      TRASEQ_BASE_URL: 'http://localhost:0',
      NODE_OPTIONS: '--import=./test/mock-cli-fetch.mjs',
    },
    cwd: new URL('..', import.meta.url),
  });
  const client = new Client({
    name: 'traseq-agent-contract-test',
    version: '0.0.0',
  });
  let connected = false;
  try {
    const connectPromise = client.connect(transport);
    const timeout = new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error('initialize timeout')),
        HANDSHAKE_TIMEOUT_MS,
      ),
    );
    await Promise.race([connectPromise, timeout]);
    connected = true;
    await fn(client);
  } finally {
    if (connected) {
      try {
        await client.close();
      } catch {
        /* noop */
      }
    }
  }
}

describe('MCP server contract', () => {
  it('completes initialize handshake via NDJSON framing', async () => {
    await withClient(async (client) => {
      const caps = client.getServerCapabilities();
      assert.ok(caps, 'server should advertise capabilities');
      assert.ok(caps.tools, 'tools capability should be present');
      assert.ok(caps.prompts, 'prompts capability should be present');
    });
  });

  it('lists tools and includes start_research_engagement', async () => {
    await withClient(async (client) => {
      const tools = await client.listTools();
      assert.ok(Array.isArray(tools.tools));
      assert.ok(
        tools.tools.some((t) => t.name === 'start_research_engagement'),
        'start_research_engagement must be listed',
      );
      assert.ok(
        tools.tools.some((t) => t.name === 'assemble_signal_graph'),
        'assemble_signal_graph must be listed',
      );
      assert.ok(
        tools.tools.some((t) => t.name === 'preflight_strategy_draft'),
        'preflight_strategy_draft must be listed',
      );
      const validate = tools.tools.find((t) => t.name === 'validate_strategy');
      assert.ok(validate, 'validate_strategy must be listed');
      assert.equal(
        validate.inputSchema.properties.signalGraph.properties.strategy.properties.entry.properties.action.properties.sizing.required.includes(
          'mode',
        ),
        true,
      );
    });
  });

  it('lists prompts and includes traseq_guided_research', async () => {
    await withClient(async (client) => {
      const prompts = await client.listPrompts();
      assert.ok(Array.isArray(prompts.prompts));
      assert.ok(
        prompts.prompts.some((p) => p.name === 'traseq_guided_research'),
        'traseq_guided_research must be listed',
      );
    });
  });

  it('returns structured JSON for platform API errors', async () => {
    await withClient(async (client) => {
      const result = await client.callTool({
        name: 'validate_strategy',
        arguments: {
          signalGraph: { protocol: 'traseq.signal-graph', version: 2 },
          settings: { positionStyle: 'single' },
        },
      });
      assert.equal(result.isError, true);
      const body = JSON.parse(result.content[0].text);
      assert.equal(body.status, 401);
      assert.equal(body.path, '/public/v1/strategies/validate');
      assert.equal(body.body.message, 'missing test key');
    });
  });
});
