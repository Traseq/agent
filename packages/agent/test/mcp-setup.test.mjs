import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildClientInstallPlan,
  buildMcpServerConfig,
  redactMcpInstallPlan,
} from '../dist/index.js';

function runCli(args, { env, input } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['dist/cli.js', ...args], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input ?? '');
  });
}

function runMcp(requests) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['dist/cli.js', 'mcp'], {
      cwd: new URL('..', import.meta.url),
      env: {
        ...process.env,
        TRASEQ_API_KEY: 'test-key',
        TRASEQ_BASE_URL: 'https://api.test.local',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('MCP test timed out.'));
    }, 3000);

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`MCP exited ${code}: ${stderr}`));
        return;
      }
      resolve(
        stdout
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
      );
    });

    for (const request of requests) {
      child.stdin.write(`${JSON.stringify(request)}\n`);
    }
    child.stdin.end();
  });
}

describe('MCP setup helpers', () => {
  it('builds a generic stdio MCP config', () => {
    const config = buildMcpServerConfig({
      scope: 'project',
      baseUrl: 'https://api.test.local',
    });

    assert.deepEqual(config, {
      mcpServers: {
        traseq: {
          command: 'npx',
          args: ['-y', '@traseq/agent', 'mcp'],
          env: {
            TRASEQ_API_KEY: '${TRASEQ_API_KEY}',
            TRASEQ_BASE_URL: 'https://api.test.local',
          },
        },
      },
    });
  });

  it('builds codex and claude-code install plans', () => {
    const codex = buildClientInstallPlan({
      client: 'codex',
      apiKey: 'trsq_secret',
      inlineSecrets: true,
    });
    const claude = buildClientInstallPlan({
      client: 'claude-code',
      scope: 'user',
      apiKey: 'trsq_secret',
      inlineSecrets: true,
    });

    assert.deepEqual(codex.command.slice(0, 4), [
      'codex',
      'mcp',
      'add',
      'traseq',
    ]);
    assert.ok(codex.command.includes('TRASEQ_API_KEY=trsq_secret'));
    assert.deepEqual(claude.command.slice(0, 5), [
      'claude',
      'mcp',
      'add',
      '--scope',
      'user',
    ]);
    assert.ok(claude.addJsonCommand.includes('add-json'));
  });

  it('redacts API keys from printable plans', () => {
    const plan = buildClientInstallPlan({
      client: 'codex',
      apiKey: 'trsq_secret',
      inlineSecrets: true,
    });
    const redacted = JSON.stringify(redactMcpInstallPlan(plan));

    assert.doesNotMatch(redacted, /trsq_secret/);
    assert.match(redacted, /<redacted>/);
  });

  it('refuses project-scoped inline API keys unless explicitly overridden', () => {
    assert.throws(
      () =>
        buildMcpServerConfig({
          scope: 'project',
          apiKey: 'trsq_secret',
          inlineSecrets: true,
        }),
      /Project-scoped MCP config must not inline TRASEQ_API_KEY/,
    );

    const config = buildMcpServerConfig({
      scope: 'project',
      apiKey: 'trsq_secret',
      inlineSecrets: true,
      allowProjectSecrets: true,
    });
    assert.equal(config.mcpServers.traseq.env.TRASEQ_API_KEY, 'trsq_secret');
  });

  it('claude-desktop downgrades --scope project to user and inlines the key', () => {
    const plan = buildClientInstallPlan({
      client: 'claude-desktop',
      scope: 'project',
      apiKey: 'trsq_secret',
      inlineSecrets: false,
      claudeDesktopConfigPath: '/tmp/cd.json',
    });

    assert.equal(plan.scope, 'user');
    assert.equal(
      plan.config.mcpServers.traseq.env.TRASEQ_API_KEY,
      'trsq_secret',
    );
    assert.ok(
      plan.warnings.some((w) => /scope project is not applicable/i.test(w)),
    );
  });

  it('claude-desktop without an API key warns about ${VAR} not expanding', () => {
    const plan = buildClientInstallPlan({
      client: 'claude-desktop',
      scope: 'user',
      claudeDesktopConfigPath: '/tmp/cd.json',
    });

    assert.equal(
      plan.config.mcpServers.traseq.env.TRASEQ_API_KEY,
      '${TRASEQ_API_KEY}',
    );
    assert.ok(
      plan.warnings.some((w) =>
        /does not expand \$\{TRASEQ_API_KEY\}/.test(w),
      ),
    );
  });
});

describe('MCP setup CLI', () => {
  it('prints codex MCP config without leaking API keys', async () => {
    const result = await runCli(
      ['setup-mcp', '--client', 'codex', '--print-config'],
      {
        env: {
          TRASEQ_API_KEY: 'trsq_secret',
          TRASEQ_BASE_URL: 'https://api.test.local',
        },
      },
    );

    assert.equal(result.code, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /trsq_secret/);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.mcpServers.traseq.command, 'npx');
    assert.deepEqual(parsed.mcpServers.traseq.args, [
      '-y',
      '@traseq/agent',
      'mcp',
    ]);
  });

  it('prints claude-code dry-run commands', async () => {
    const result = await runCli(
      ['setup-mcp', '--client', 'claude-code', '--scope', 'user'],
      {
        env: {
          TRASEQ_API_KEY: 'trsq_secret',
          TRASEQ_BASE_URL: 'https://api.test.local',
        },
      },
    );

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /claude mcp add/);
    assert.match(result.stdout, /claude mcp add-json/);
    assert.doesNotMatch(result.stdout, /trsq_secret/);
    assert.match(result.stdout, /start_research_engagement/);
  });

  it('prints claude-desktop config for a custom path', async () => {
    const result = await runCli(
      [
        'setup-mcp',
        '--client',
        'claude-desktop',
        '--claude-desktop-config',
        '/tmp/claude_desktop_config.json',
        '--print-config',
      ],
      {
        env: {
          TRASEQ_API_KEY: 'trsq_secret',
        },
      },
    );

    assert.equal(result.code, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /trsq_secret/);
    assert.equal(JSON.parse(result.stdout).mcpServers.traseq.command, 'npx');
  });

  it('probes the API in mcp-doctor', async () => {
    const result = await runCli(
      ['mcp-doctor', '--client', 'generic', '--probe'],
      {
        env: {
          NODE_OPTIONS: '--import ./test/mock-cli-fetch.mjs',
          TRASEQ_API_KEY: 'test-key',
          TRASEQ_BASE_URL: 'https://api.test.local',
        },
      },
    );

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /manifest reachable/);
    assert.match(result.stdout, /Test Workspace/);
    assert.match(result.stdout, /MCP setup is ready/);
  });

  it('refuses to overwrite a corrupt Claude Desktop config', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'traseq-mcp-corrupt-'));
    const configPath = join(dir, 'claude_desktop_config.json');
    writeFileSync(configPath, '{ this is not json');
    try {
      const result = await runCli(
        [
          'setup-mcp',
          '--client',
          'claude-desktop',
          '--claude-desktop-config',
          configPath,
          '--write',
        ],
        {
          env: {
            TRASEQ_API_KEY: 'trsq_secret',
          },
        },
      );

      assert.notEqual(result.code, 0);
      assert.match(result.stderr, /not valid JSON/);
      assert.match(result.stderr, /Refusing to overwrite/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps research and guide as distinct CLI flows', async () => {
    const result = await runCli(
      ['research', '--prompt', 'Research a BTCUSDT trend strategy.'],
      {
        env: {
          NODE_OPTIONS: '--import ./test/mock-cli-fetch.mjs',
          TRASEQ_API_KEY: 'test-key',
          TRASEQ_BASE_URL: 'https://api.test.local',
        },
      },
    );

    assert.equal(result.code, 0, result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.ok(Array.isArray(parsed.recommendedWorkflow));
    assert.ok(parsed.prompts.authoring.includes('external AI agent'));
    assert.doesNotMatch(result.stdout, /Research Engagement Brief/);
  });
});

describe('MCP protocol guidance', () => {
  it('advertises service-style instructions and prompts', async () => {
    const [initialize, prompts, prompt, tools] = await runMcp([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 2, method: 'prompts/list', params: {} },
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'prompts/get',
        params: {
          name: 'traseq_guided_research',
          arguments: {
            idea: 'Research a BTCUSDT breakout strategy.',
            instrument: 'BTCUSDT',
            timeframe: '4h',
          },
        },
      },
      { jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} },
    ]);

    assert.match(
      initialize.result.instructions,
      /start_research_engagement first/,
    );
    assert.ok(initialize.result.capabilities.prompts);
    assert.equal(prompts.result.prompts[0].name, 'traseq_guided_research');
    assert.match(
      prompt.result.messages[0].content.text,
      /run_guided_research_round/,
    );
    assert.equal(tools.result.tools[0].name, 'start_research_engagement');
    assert.ok(
      tools.result.tools.findIndex(
        (tool) => tool.name === 'start_research_engagement',
      ) < tools.result.tools.findIndex((tool) => tool.name === 'get_manifest'),
    );
  });
});
