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

  it('lists tools and includes start_research_engagement (guided profile, slim)', async () => {
    await withClient(async (client) => {
      const tools = await client.listTools();
      assert.ok(Array.isArray(tools.tools));
      assert.ok(
        tools.tools.some((t) => t.name === 'start_research_engagement'),
        'start_research_engagement must be listed',
      );
      // P1-D: internal helpers (resolve/assemble/preflight) are intentionally
      // hidden in guided mode and reachable inside run_guided_research_round.
      const exposed = new Set(tools.tools.map((t) => t.name));
      for (const advanced of [
        'assemble_signal_graph',
        'preflight_strategy_draft',
        'resolve_strategy_semantics',
        'suggest_minimal_repairs',
      ]) {
        assert.ok(
          !exposed.has(advanced),
          `${advanced} should be hidden in guided profile (P1-D)`,
        );
      }
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

  it('lists capability + instruments + system-strategies resources (P1-F)', async () => {
    await withClient(async (client) => {
      const caps = client.getServerCapabilities();
      assert.ok(caps?.resources, 'resources capability must be advertised');
      const resources = await client.listResources();
      assert.ok(Array.isArray(resources.resources));
      const uris = new Set(resources.resources.map((r) => r.uri));
      assert.ok(uris.has('traseq://capabilities'));
      assert.ok(
        uris.has('traseq://instruments'),
        'traseq://instruments must be exposed so agents can pick a symbol and date range without hallucinating tier limits',
      );
      assert.ok(uris.has('traseq://system-strategies'));
    });
  });

  it('rejects unknown resource URIs with InvalidParams (P1-F)', async () => {
    await withClient(async (client) => {
      await assert.rejects(
        () => client.readResource({ uri: 'traseq://nonexistent' }),
        /Unknown resource URI/,
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
