#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

import { getAgentContext } from './assembler.js';
import {
  readEnv,
  requireEnv,
  TRASEQ_API_KEY_SETUP_HELP,
  TRASEQ_API_KEY_SETUP_URL,
} from './env.js';
import {
  OPERATION_REGISTRY,
  type OperationName,
} from './generated/operation-registry.js';
import { references } from './references/index.js';
import { templates } from './templates/index.js';
import {
  runPlatformTool,
  TraseqClient,
  TraseqApiError,
  formatTraseqAgentError,
} from './client/index.js';
import { asJsonObject } from './normalize.js';
import {
  AGENT_TOOL_REGISTRY,
  getAgentToolDefinition,
  runAgentTool,
  type AgentToolName,
} from './semantics/index.js';
import {
  MCP_CLIENTS,
  MCP_SCOPES,
  buildClientInstallPlan,
  formatShellCommand,
  probeTraseqMcpSetup,
  redactMcpInstallPlan,
  type McpClient,
  type McpInstallPlan,
  type McpScope,
  type ResolvedMcpClient,
} from './mcp/index.js';
import type {
  JsonObject,
  GuidedResearchRoundInput,
  ResearchEngagementInput,
  SectionName,
  ResearchStreamEvent,
  ResearchRunnerResult,
  StrategyDraftLike,
} from './types.js';

const VALID_SECTIONS = new Set<string>([
  'skill',
  'tools',
  'references',
  'templates',
]);

const REFERENCE_KEYS: Record<string, string> = {
  'domain-constants': 'domainConstants',
  'node-kinds': 'nodeKinds',
  'strategy-composition': 'strategyComposition',
  'indicator-guide': 'indicatorGuide',
  'backtest-configuration': 'backtestConfiguration',
  'results-interpretation': 'resultsInterpretation',
  'iteration-playbook': 'iterationPlaybook',
};

const REFERENCE_DESCRIPTIONS: Record<string, string> = {
  'domain-constants': 'Market fields, enums, sizing modes',
  'node-kinds': 'Signal graph node types and schemas',
  'strategy-composition': 'Syntax rules, entry/exit/risk structure',
  'indicator-guide': '60+ indicators with parameters',
  'backtest-configuration': 'Timeframe, execution, fees, slippage options',
  'results-interpretation': 'Metrics evaluation guide',
  'iteration-playbook': 'Decision tree for strategy iteration',
};

const ENV_VARS = [
  { name: 'TRASEQ_API_KEY', required: true, desc: 'Traseq API key' },
  {
    name: 'TRASEQ_BASE_URL',
    required: false,
    desc: 'Traseq API base URL',
    fallback: 'https://api.traseq.com',
  },
  {
    name: 'TRASEQ_TIMEOUT_MS',
    required: false,
    desc: 'Backtest timeout (ms)',
    fallback: '240000',
  },
  {
    name: 'TRASEQ_POLL_INTERVAL_MS',
    required: false,
    desc: 'Backtest poll interval (ms)',
    fallback: '3000',
  },
];

const args = process.argv.slice(2);
const subcommand = args[0];

function getFlag(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index !== -1 ? args[index + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

function printUsage(): void {
  process.stderr.write(
    [
      'Usage: traseq-agent <command> [options]',
      '',
      'Commands:',
      '  context [--section <name>]                     Print knowledge context (default)',
      '  templates                                      List all strategy templates',
      '  template --id <id>                              Show template details',
      '  references                                     List all reference documents',
      '  reference --type <name>                         Show a specific reference',
      '  check-env [--probe]                             Check env vars; --probe also validates the key against the API',
      '  tools                                          List platform and agent-local tools',
      '  run --tool <name> [--input <json>]              Run a platform or agent-local tool',
      '  score --backtest-id <id>                        Score a completed backtest',
      '  score --json                                    Score from stdin JSON summary',
      '  evaluate --stdin                                Evaluate a research runner JSON result',
      '  report --stdin                                  Format a research runner JSON result as Markdown',
      '  guide --prompt "..." [--json]                    Start a guided research engagement',
      '  guide-run --prompt "..." --draft <json>          Run a guided research round and print a service memo',
      '  setup-mcp --client <client> [--write] [--probe] [--api-key <key>]',
      '                                                  Generate or install Claude/Codex MCP config (--api-key for one-shot local setup; prefer TRASEQ_API_KEY)',
      '  mcp-doctor [--client <client>] [--probe] [--api-key <key>]',
      '                                                  Print the expected MCP install plan; --probe validates the key and required scopes',
      '  mcp                                             Run the stdio MCP server',
      '  research --prompt "..." [options]               Create a tool-first research brief',
      '  research-run --prompt "..." --draft <json>      Execute a single research draft (single-round)',
      '  research-run --prompt "..." --stdin             Execute a single research draft from stdin (single-round)',
      '',
      'Research options:',
      '  --prompt <text>          Strategy brief (required)',
      '  --instrument <symbol>    Trading instrument (default: BTCUSDT)',
      '  --timeframe <tf>         15m | 1h | 4h | 1d (default: 4h)',
      '  --rounds <n>             Suggested research iterations, 1-3 (default: 3)',
      '',
      'Environment variables:',
      '  TRASEQ_API_KEY           Required for platform tools/research/score',
      '',
    ].join('\n'),
  );
}

function createPlatformClient(
  options: { apiKey?: string; baseUrl?: string } = {},
): TraseqClient {
  return new TraseqClient({
    apiKey: options.apiKey ?? requireEnv('TRASEQ_API_KEY'),
    baseUrl:
      options.baseUrl ?? readEnv('TRASEQ_BASE_URL') ?? 'https://api.traseq.com',
  });
}

const MAX_STDIN_BYTES = 5 * 1024 * 1024; // 5 MB

async function readStdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += (chunk as Buffer).length;
    if (total > MAX_STDIN_BYTES) {
      throw new Error('Stdin input exceeds 5 MB limit.');
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function parseJsonInput(raw: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      'Invalid JSON input. Ensure the value is a valid JSON object.',
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Invalid JSON input. Expected an object at the top level.');
  }

  return parsed as JsonObject;
}

async function assertRunnerSchemaVersion(input: JsonObject): Promise<void> {
  const { RUNNER_SCHEMA_VERSION } = await import('./research-runner.js');
  const schemaVersion = input.schemaVersion;
  if (schemaVersion === RUNNER_SCHEMA_VERSION) {
    return;
  }

  const got =
    schemaVersion === undefined ? 'missing' : `got ${String(schemaVersion)}`;
  process.stderr.write(
    [
      `Error: input does not look like a research-run result (${got}, expected schemaVersion=${RUNNER_SCHEMA_VERSION}).`,
      'Pipe `traseq-agent research-run` output, or pass a saved result.json from a prior run.',
      'Required top-level fields: schemaVersion, runId, status, rounds.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

function agentToolNeedsPlatformClient(
  agentToolName: AgentToolName,
  input: JsonObject,
): boolean {
  return (
    agentToolName === 'run_research_draft' ||
    agentToolName === 'start_research_engagement' ||
    agentToolName === 'run_guided_research_round' ||
    (agentToolName === 'resolve_strategy_semantics' &&
      asJsonObject(input.capabilities) === undefined)
  );
}

function optionalNumberFlag(name: string): number | undefined {
  const raw = getFlag(name);
  if (raw === undefined) {
    return undefined;
  }

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    process.stderr.write(`Error: --${name} must be a number.\n`);
    process.exit(1);
  }
  return value;
}

function buildEngagementInput(prompt: string): ResearchEngagementInput {
  const instrument = getFlag('instrument');
  const timeframe = getFlag('timeframe');
  const objective = getFlag('objective');
  const rounds = optionalNumberFlag('rounds');
  const initialBalance = optionalNumberFlag('initial-balance');
  const warmupPeriod = optionalNumberFlag('warmup-period');
  const positionStyle = getFlag('position-style');
  const maxConcurrentPositions = optionalNumberFlag('max-concurrent-positions');
  const riskTolerance = getFlag('risk-tolerance');

  const input: ResearchEngagementInput = { prompt };
  if (instrument) {
    input.instrument = instrument;
  }
  if (timeframe) {
    input.timeframe = timeframe as NonNullable<
      ResearchEngagementInput['timeframe']
    >;
  }
  if (objective) {
    input.objective = objective;
  }
  if (rounds !== undefined) {
    input.rounds = rounds;
  }
  if (initialBalance !== undefined) {
    input.initialBalance = initialBalance;
  }
  if (warmupPeriod !== undefined) {
    input.warmupPeriod = warmupPeriod;
  }
  if (positionStyle) {
    input.positionStyle = positionStyle as NonNullable<
      ResearchEngagementInput['positionStyle']
    >;
  }
  if (maxConcurrentPositions !== undefined) {
    input.maxConcurrentPositions = maxConcurrentPositions;
  }
  if (riskTolerance) {
    input.riskTolerance = riskTolerance as NonNullable<
      ResearchEngagementInput['riskTolerance']
    >;
  }

  return input;
}

// ---------------------------------------------------------------------------
// context subcommand (default)
// ---------------------------------------------------------------------------

function runContext(): void {
  const sectionArg = getFlag('section');

  if (sectionArg !== undefined && !VALID_SECTIONS.has(sectionArg)) {
    process.stderr.write(
      `Unknown section: "${sectionArg}". Valid sections: ${[...VALID_SECTIONS].join(', ')}\n`,
    );
    process.exit(1);
  }

  const sections =
    sectionArg !== undefined ? [sectionArg as SectionName] : undefined;

  process.stdout.write(getAgentContext(sections ? { sections } : undefined));
  process.stdout.write('\n');
}

// ---------------------------------------------------------------------------
// research subcommand
// ---------------------------------------------------------------------------

async function runResearchCommand(): Promise<void> {
  const { runResearch } = await import('./research.js');

  const prompt = getFlag('prompt');
  if (!prompt) {
    process.stderr.write('Error: --prompt is required for research.\n');
    process.exit(1);
  }

  const instrument = getFlag('instrument') ?? 'BTCUSDT';
  const timeframe = getFlag('timeframe') ?? '4h';
  const rounds = Number(getFlag('rounds') ?? '3');

  const emit = (event: ResearchStreamEvent): void => {
    if (event.type === 'status') {
      process.stderr.write(`[round ${event.round ?? '-'}] ${event.message}\n`);
    }
  };

  const result = await runResearch(
    { prompt, instrument, timeframe, rounds },
    emit,
  );

  process.stdout.write(JSON.stringify(result, null, 2));
  process.stdout.write('\n');
}

async function runGuideCommand(): Promise<void> {
  const { formatResearchEngagementBrief, startResearchEngagement } =
    await import('./guided-research.js');

  const prompt = getFlag('prompt');
  if (!prompt) {
    process.stderr.write('Error: --prompt is required for guide.\n');
    process.exit(1);
  }

  const brief = await startResearchEngagement(buildEngagementInput(prompt), {
    client: createPlatformClient(),
  });

  if (hasFlag('json')) {
    process.stdout.write(JSON.stringify(brief, null, 2));
  } else {
    process.stdout.write(formatResearchEngagementBrief(brief));
  }
  process.stdout.write('\n');
}

async function runGuideRunCommand(): Promise<void> {
  const { runGuidedResearchRound } = await import('./guided-research.js');

  const prompt = getFlag('prompt');
  if (!prompt) {
    process.stderr.write('Error: --prompt is required for guide-run.\n');
    process.exit(1);
  }

  if (hasFlag('json') && hasFlag('report')) {
    process.stderr.write('Error: choose either --json or --report.\n');
    process.exit(1);
  }

  const rawDraft =
    getFlag('draft') ?? (hasFlag('stdin') ? await readStdinText() : undefined);
  if (!rawDraft) {
    process.stderr.write(
      'Error: --draft <json> or --stdin is required for guide-run.\n',
    );
    process.exit(1);
  }

  const draft = parseJsonInput(rawDraft);
  const engagementInput = buildEngagementInput(prompt);
  const pollIntervalMs = optionalNumberFlag('poll-interval-ms');
  const timeoutMs = optionalNumberFlag('timeout-ms');
  const producerTimeoutMs = optionalNumberFlag('producer-timeout-ms');
  const input: GuidedResearchRoundInput = {
    ...engagementInput,
    draft: draft as unknown as StrategyDraftLike,
    ...(pollIntervalMs !== undefined ? { pollIntervalMs } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(producerTimeoutMs !== undefined ? { producerTimeoutMs } : {}),
  };

  const result = await runGuidedResearchRound(input, {
    client: createPlatformClient(),
  });

  if (hasFlag('json')) {
    process.stdout.write(JSON.stringify(result, null, 2));
  } else {
    process.stdout.write(result.report);
  }
  process.stdout.write('\n');

  if (result.status !== 'completed') {
    process.exitCode = 1;
  }
}

async function runResearchRunCommand(): Promise<void> {
  const { runResearchRunner } = await import('./research-runner.js');

  const prompt = getFlag('prompt');
  if (!prompt) {
    process.stderr.write('Error: --prompt is required for research-run.\n');
    process.exit(1);
  }

  if (getFlag('rounds') !== undefined) {
    process.stderr.write(
      'Error: research-run is single-round by design; use the SDK runResearchRunner() for multi-round research.\n',
    );
    process.exit(1);
  }

  const rawDraft =
    getFlag('draft') ?? (hasFlag('stdin') ? await readStdinText() : undefined);
  if (!rawDraft) {
    process.stderr.write(
      'Error: --draft <json> or --stdin is required for research-run.\n',
    );
    process.exit(1);
  }

  const draft = parseJsonInput(rawDraft);
  const instrument = getFlag('instrument') ?? 'BTCUSDT';
  const timeframe = getFlag('timeframe') ?? '4h';

  const result = await runResearchRunner({
    client: createPlatformClient(),
    input: {
      prompt,
      instrument,
      timeframe,
      rounds: 1,
    },
    draftProducer: () => draft as unknown as StrategyDraftLike,
  });

  process.stdout.write(JSON.stringify(result, null, 2));
  process.stdout.write('\n');

  if (result.status !== 'completed') {
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// templates subcommand
// ---------------------------------------------------------------------------

function runTemplatesCommand(): void {
  const maxId = Math.max(...templates.all.map((t) => t.id.length));
  for (const t of templates.all) {
    process.stdout.write(`${t.id.padEnd(maxId + 2)}${t.name}\n`);
  }
}

// ---------------------------------------------------------------------------
// template subcommand
// ---------------------------------------------------------------------------

function runTemplateCommand(): void {
  const id = getFlag('id');
  if (!id) {
    process.stderr.write('Error: --id is required.\n');
    process.exit(1);
  }

  const template = templates.byId(id);
  if (!template) {
    const ids = templates.all.map((t) => t.id).join(', ');
    process.stderr.write(`Unknown template: "${id}". Available: ${ids}\n`);
    process.exit(1);
  }

  process.stdout.write(JSON.stringify(template, null, 2));
  process.stdout.write('\n');
}

// ---------------------------------------------------------------------------
// references subcommand
// ---------------------------------------------------------------------------

function runReferencesCommand(): void {
  const maxKey = Math.max(
    ...Object.keys(REFERENCE_DESCRIPTIONS).map((k) => k.length),
  );
  for (const [key, desc] of Object.entries(REFERENCE_DESCRIPTIONS)) {
    process.stdout.write(`${key.padEnd(maxKey + 2)}${desc}\n`);
  }
}

// ---------------------------------------------------------------------------
// reference subcommand
// ---------------------------------------------------------------------------

function runReferenceCommand(): void {
  const type = getFlag('type');
  if (!type) {
    process.stderr.write('Error: --type is required.\n');
    process.exit(1);
  }

  const prop = REFERENCE_KEYS[type];
  if (!prop) {
    const types = Object.keys(REFERENCE_KEYS).join(', ');
    process.stderr.write(`Unknown reference: "${type}". Available: ${types}\n`);
    process.exit(1);
  }

  const content = references[prop as keyof typeof references];
  if (typeof content !== 'string') {
    process.stderr.write(`Reference "${type}" is not a string.\n`);
    process.exit(1);
  }

  process.stdout.write(content);
  process.stdout.write('\n');
}

// ---------------------------------------------------------------------------
// check-env subcommand
// ---------------------------------------------------------------------------

function describeWorkspaceContext(context: unknown): string {
  const ctx = asJsonObject(context) ?? {};
  const workspace = asJsonObject(ctx.workspace) ?? {};
  const apiKey = asJsonObject(ctx.apiKey) ?? {};
  const subscription = asJsonObject(ctx.subscription) ?? {};

  const workspaceName =
    typeof workspace.name === 'string' && workspace.name.length > 0
      ? workspace.name
      : typeof workspace.id === 'string'
        ? workspace.id
        : 'unknown';
  const tier =
    typeof subscription.plan === 'string'
      ? subscription.plan
      : typeof subscription.tier === 'string'
        ? subscription.tier
        : 'unknown';
  const scopes = Array.isArray(apiKey.scopes)
    ? apiKey.scopes.filter((s): s is string => typeof s === 'string')
    : [];

  const scopesText = scopes.length > 0 ? scopes.join(', ') : 'none reported';
  return `workspace "${workspaceName}" · tier ${tier} · scopes [${scopesText}]`;
}

async function runCheckEnvCommand(): Promise<void> {
  let allGood = true;
  for (const v of ENV_VARS) {
    const value = readEnv(v.name);
    if (value) {
      process.stdout.write(`  + ${v.name.padEnd(26)} set\n`);
    } else if (v.fallback) {
      process.stdout.write(
        `  - ${v.name.padEnd(26)} not set (default: ${v.fallback})\n`,
      );
    } else {
      process.stdout.write(`  x ${v.name.padEnd(26)} not set\n`);
      if (v.required) {
        allGood = false;
      }
    }
  }

  if (!allGood) {
    process.stderr.write(
      '\nSome required environment variables are missing.\n',
    );
    if (!readEnv('TRASEQ_API_KEY')) {
      process.stderr.write(`${TRASEQ_API_KEY_SETUP_HELP}\n`);
    }
    process.exit(1);
  }

  if (!hasFlag('probe')) {
    return;
  }

  process.stdout.write('\nProbing Traseq API ...\n');
  try {
    const client = createPlatformClient();
    const context = await client.getWorkspaceContext();
    process.stdout.write(
      `  ✓ key valid · ${describeWorkspaceContext(context)}\n`,
    );
  } catch (error) {
    if (error instanceof TraseqApiError) {
      process.stderr.write(`  ✗ key rejected (HTTP ${error.status})\n\n`);
      process.stderr.write(`${formatTraseqAgentError(error)}\n`);
      if (error.status === 401 || error.status === 403) {
        process.stderr.write(
          `\nGet or rotate a workspace API key: ${TRASEQ_API_KEY_SETUP_URL}\n`,
        );
      }
    } else {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`  ✗ probe failed: ${message}\n`);
    }
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// MCP setup / doctor subcommands
// ---------------------------------------------------------------------------

function parseMcpClientFlag(): McpClient {
  const raw = getFlag('client') ?? 'auto';
  if ((MCP_CLIENTS as readonly string[]).includes(raw)) {
    return raw as McpClient;
  }

  process.stderr.write(
    `Error: --client must be one of: ${MCP_CLIENTS.join(', ')}.\n`,
  );
  process.exit(1);
}

function parseMcpScopeFlag(): McpScope {
  const raw = getFlag('scope') ?? 'user';
  if ((MCP_SCOPES as readonly string[]).includes(raw)) {
    return raw as McpScope;
  }

  process.stderr.write(
    `Error: --scope must be one of: ${MCP_SCOPES.join(', ')}.\n`,
  );
  process.exit(1);
}

function readSecretFlag(name: string): string | undefined {
  const value = getFlag(name);
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return undefined;
  }
  // Guard against `--api-key --probe` (forgotten value); the positional
  // `getFlag` would otherwise swallow the next flag name as the secret.
  if (normalized.startsWith('--')) {
    throw new Error(
      `--${name} expects a value but got "${normalized}". Pass it as: --${name} <value>`,
    );
  }
  return normalized;
}

function resolveMcpCredentials(): {
  apiKey: string | undefined;
  apiKeyFromFlag: boolean;
  baseUrl: string | undefined;
} {
  const apiKeyFromFlag = readSecretFlag('api-key');
  return {
    apiKey: apiKeyFromFlag ?? readEnv('TRASEQ_API_KEY'),
    apiKeyFromFlag: apiKeyFromFlag !== undefined,
    baseUrl: readEnv('TRASEQ_BASE_URL'),
  };
}

function setupMcpCommandExample(input: {
  client: McpClient;
  scope: McpScope;
  write: boolean;
  probe: boolean;
  printConfig: boolean;
  claudeDesktopConfigPath?: string;
}): string {
  const args = [
    'npx',
    '-y',
    '--package',
    '@traseq/agent',
    'traseq-agent',
    'setup-mcp',
    '--client',
    input.client,
  ];

  if (input.scope !== 'user') {
    args.push('--scope', input.scope);
  }
  if (input.write) {
    args.push('--write');
  }
  if (input.probe) {
    args.push('--probe');
  }
  if (input.printConfig) {
    args.push('--print-config');
  }
  if (input.claudeDesktopConfigPath) {
    args.push('--claude-desktop-config', input.claudeDesktopConfigPath);
  }

  return formatShellCommand(args);
}

function missingMcpApiKeyHelp(command: string): string {
  return [
    'Missing TRASEQ_API_KEY for MCP setup.',
    '',
    'Create or copy a workspace API key here:',
    TRASEQ_API_KEY_SETUP_URL,
    '',
    'Set it for the current terminal, then rerun setup:',
    '```sh',
    'export TRASEQ_API_KEY="trsq_..."',
    command,
    '```',
    '',
    'Or, for a one-shot install, pass the key inline (keeps it out of `ps` argv):',
    '```sh',
    `TRASEQ_API_KEY="trsq_..." ${command}`,
    '```',
    '',
    'For future terminals, add the export line to your shell profile (~/.zshrc for zsh, ~/.bashrc for bash).',
    '',
    'Do not paste API keys into AI prompts or commit them into project config.',
  ].join('\n');
}

function warnApiKeyFlag(): void {
  process.stderr.write(
    'Note: --api-key is convenient for local setup, but the value may remain in shell history and is briefly visible to other processes via `ps`. Prefer TRASEQ_API_KEY for regular use, especially on shared hosts and CI.\n',
  );
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function commandExists(command: string): boolean {
  const pathValue = process.env.PATH ?? '';
  const isWindows = process.platform === 'win32';
  const extensions = isWindows
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean)
    : [''];

  for (const dir of pathValue.split(delimiter).filter(Boolean)) {
    for (const ext of extensions) {
      const candidate = join(dir, `${command}${ext}`);
      // On Windows, presence in PATH with a PATHEXT extension is the
      // executable contract. On Unix we additionally require the +x bit so we
      // do not falsely detect a same-named non-executable file.
      if (isWindows ? existsSync(candidate) : isExecutable(candidate)) {
        return true;
      }
    }
  }

  return false;
}

function detectedMcpClients(): Partial<Record<ResolvedMcpClient, boolean>> {
  return {
    codex: commandExists('codex'),
    'claude-code': commandExists('claude'),
  };
}

function printMcpPlan(plan: McpInstallPlan): void {
  process.stdout.write(`# Traseq MCP setup\n\n`);
  process.stdout.write(`- Client: ${plan.client}\n`);
  process.stdout.write(`- Scope: ${plan.scope}\n`);
  process.stdout.write(`- Server name: ${plan.serverName}\n`);
  if (plan.writeTarget) {
    process.stdout.write(`- Config path: ${plan.writeTarget}\n`);
  }
  process.stdout.write('\n');

  if (plan.command) {
    process.stdout.write('Install command:\n\n');
    process.stdout.write(
      `\`\`\`sh\n${formatShellCommand(plan.command)}\n\`\`\`\n\n`,
    );
  }

  if (plan.addJsonCommand) {
    process.stdout.write('Claude Code add-json alternative:\n\n');
    process.stdout.write(
      `\`\`\`sh\n${formatShellCommand(plan.addJsonCommand)}\n\`\`\`\n\n`,
    );
  }

  process.stdout.write('MCP config:\n\n');
  process.stdout.write(
    `\`\`\`json\n${JSON.stringify(plan.config, null, 2)}\n\`\`\`\n\n`,
  );

  if (plan.warnings.length > 0) {
    process.stdout.write('Warnings:\n');
    for (const warning of plan.warnings) {
      process.stdout.write(`- ${warning}\n`);
    }
    process.stdout.write('\n');
  }

  process.stdout.write('After install, try this prompt:\n\n');
  process.stdout.write(`> ${plan.nextPrompt}\n\n`);
  process.stdout.write('Next steps:\n');
  for (const step of plan.nextSteps) {
    process.stdout.write(`- ${step}\n`);
  }
}

function readJsonFile(path: string): JsonObject {
  if (!existsSync(path)) {
    return {};
  }

  const raw = readFileSync(path, 'utf8');
  try {
    return parseJsonInput(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Existing config at ${path} is not valid JSON (${reason}). Refusing to overwrite. Back up or fix the file, then re-run setup-mcp.`,
    );
  }
}

function writeClaudeDesktopConfig(plan: McpInstallPlan): void {
  if (!plan.writeTarget) {
    throw new Error(
      'Claude Desktop config path could not be detected. Use --print-config and paste the JSON manually.',
    );
  }

  const current = readJsonFile(plan.writeTarget);
  const currentServers = asJsonObject(current.mcpServers) ?? {};
  const next = {
    ...current,
    mcpServers: {
      ...currentServers,
      ...plan.config.mcpServers,
    },
  };

  mkdirSync(dirname(plan.writeTarget), { recursive: true });
  writeFileSync(plan.writeTarget, `${JSON.stringify(next, null, 2)}\n`);
}

const CLIENT_INSTALL_DOC: Partial<Record<ResolvedMcpClient, string>> = {
  codex: 'https://github.com/openai/codex',
  'claude-code': 'https://docs.claude.com/en/docs/claude-code',
};

function missingClientBinaryHelp(
  plan: McpInstallPlan,
  binary: string,
  setupCommandExample: string,
): string {
  const docUrl = CLIENT_INSTALL_DOC[plan.client];
  const printConfigCommand = setupCommandExample.replace(
    /\s--write\b/,
    ' --print-config',
  );
  const lines = [
    `Cannot run \`${binary}\`: not found on PATH.`,
    '',
    `setup-mcp --client ${plan.client} --write needs the ${plan.client} CLI to register the MCP server, but it is not installed on this machine.`,
    '',
    'Choose one of:',
    `  • Install ${plan.client}${docUrl ? ` (${docUrl})` : ''}, then re-run the same command.`,
    '  • Print the MCP JSON and paste it into the client config manually:',
    `      ${printConfigCommand}`,
    '  • Re-run setup-mcp with a different --client (e.g. claude-code, claude-desktop, or generic).',
  ];
  return lines.join('\n');
}

function assertWriteSupported(
  plan: McpInstallPlan,
  detectedClients: Partial<Record<ResolvedMcpClient, boolean>>,
  setupCommandExample: string,
): void {
  if (plan.client === 'claude-desktop' || plan.client === 'generic') {
    return;
  }
  if (!plan.command) {
    return;
  }
  if (detectedClients[plan.client]) {
    return;
  }
  const binary = plan.command[0] ?? plan.client;
  throw new Error(missingClientBinaryHelp(plan, binary, setupCommandExample));
}

function executeInstallCommand(plan: McpInstallPlan): void {
  if (!plan.command) {
    if (plan.client === 'claude-desktop') {
      writeClaudeDesktopConfig(plan);
      process.stdout.write(
        `Updated Claude Desktop MCP config: ${plan.writeTarget}\n`,
      );
      return;
    }
    throw new Error('This MCP client does not support automatic install.');
  }

  const [command, ...commandArgs] = plan.command;
  if (!command) {
    throw new Error('Install command was empty.');
  }
  const result = spawnSync(command, commandArgs, { stdio: 'inherit' });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(
        [
          `Cannot run \`${command}\`: not found on PATH.`,
          'Install the client CLI, then re-run setup-mcp; or re-run with --print-config and paste the JSON into the client config manually.',
        ].join('\n'),
      );
    }
    if (code === 'EACCES') {
      throw new Error(
        `Cannot execute \`${command}\`: permission denied. Check file permissions on the binary in PATH.`,
      );
    }
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `\`${command}\` exited with status ${result.status}. See the output above for details, or re-run with --print-config to apply the JSON manually.`,
    );
  }
}

async function printMcpProbe(
  options: {
    apiKey?: string;
    baseUrl?: string;
  } = {},
): Promise<void> {
  const client = createPlatformClient(options);
  const result = await probeTraseqMcpSetup({ client });

  process.stdout.write('\nTraseq probe:\n');
  for (const check of result.checks) {
    process.stdout.write(`  + ${check}\n`);
  }
  process.stdout.write(`  workspace: ${result.workspace}\n`);
  process.stdout.write(`  tier: ${result.tier}\n`);
  process.stdout.write(
    `  scopes: ${result.scopes.length > 0 ? result.scopes.join(', ') : 'none reported'}\n`,
  );

  if (result.missingScopes.length > 0) {
    process.stdout.write(
      `  missing guided-research scopes: ${result.missingScopes.join(', ')}\n`,
    );
  }

  process.stdout.write('\nProbe next steps:\n');
  for (const step of result.nextSteps) {
    process.stdout.write(`- ${step}\n`);
  }

  if (!result.ok) {
    process.exitCode = 1;
  }
}

async function runSetupMcpCommand(): Promise<void> {
  const client = parseMcpClientFlag();
  const scope = parseMcpScopeFlag();
  const { apiKey, apiKeyFromFlag, baseUrl } = resolveMcpCredentials();
  const write = hasFlag('write');
  const probe = hasFlag('probe');
  const inlineSecrets = write && scope !== 'project';
  const claudeDesktopConfigPath = getFlag('claude-desktop-config');
  const detectedClients = detectedMcpClients();
  const commandExample = setupMcpCommandExample({
    client,
    scope,
    write,
    probe,
    printConfig: hasFlag('print-config'),
    ...(claudeDesktopConfigPath ? { claudeDesktopConfigPath } : {}),
  });
  const plan = buildClientInstallPlan({
    client,
    scope,
    inlineSecrets,
    detectedClients,
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(claudeDesktopConfigPath ? { claudeDesktopConfigPath } : {}),
  });

  if (hasFlag('print-config')) {
    process.stdout.write(
      `${JSON.stringify(redactMcpInstallPlan(plan).config, null, 2)}\n`,
    );
    return;
  }

  // Validate credentials BEFORE touching local config. A bad key or missing
  // scope should not leave the user's MCP config half-written. Probe is also
  // independent of whether the client CLI is installed locally, so running it
  // first surfaces auth issues even when --write would later fail.
  if (probe) {
    if (!apiKey) {
      throw new Error(missingMcpApiKeyHelp(commandExample));
    }
    if (apiKeyFromFlag && !write) {
      warnApiKeyFlag();
    }
    await printMcpProbe({ apiKey, ...(baseUrl ? { baseUrl } : {}) });
    if (process.exitCode && process.exitCode !== 0) {
      // probe printed remediation already; do not proceed to install.
      return;
    }
  }

  if (write) {
    if (plan.scope !== 'project' && !apiKey) {
      throw new Error(missingMcpApiKeyHelp(commandExample));
    }
    if (apiKeyFromFlag && !probe) {
      // probe path already warned; avoid double-warning.
      warnApiKeyFlag();
    }
    if (inlineSecrets && apiKey && plan.client !== 'claude-desktop') {
      // claude/codex CLIs accept env values via argv. On shared hosts that
      // value is briefly visible to other users via `ps`. There is no
      // upstream interface to avoid this, so warn rather than block.
      process.stderr.write(
        'Note: TRASEQ_API_KEY will be passed as a command argument to the install CLI. On shared hosts, prefer dry-run + manual edit to avoid argv exposure.\n',
      );
    }
    // Refuse the spawn early when the target client CLI is not on PATH.
    // The raw ENOENT message is unactionable; this surfaces install/fallback
    // options the user actually has.
    assertWriteSupported(plan, detectedClients, commandExample);
    executeInstallCommand(plan);
    process.stdout.write('\nTraseq MCP server installed.\n\n');
    process.stdout.write(`Try this prompt:\n> ${plan.nextPrompt}\n`);
  } else {
    printMcpPlan(redactMcpInstallPlan(plan));
  }
}

async function runMcpDoctorCommand(): Promise<void> {
  const client = parseMcpClientFlag();
  const scope = parseMcpScopeFlag();
  const claudeDesktopConfigPath = getFlag('claude-desktop-config');
  const { apiKey, apiKeyFromFlag, baseUrl } = resolveMcpCredentials();
  const plan = buildClientInstallPlan({
    client,
    scope,
    detectedClients: detectedMcpClients(),
    ...(apiKey ? { apiKey } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(claudeDesktopConfigPath ? { claudeDesktopConfigPath } : {}),
  });

  printMcpPlan(redactMcpInstallPlan(plan));
  if (hasFlag('probe')) {
    if (!apiKey) {
      throw new Error(
        missingMcpApiKeyHelp(
          setupMcpCommandExample({
            client,
            scope,
            write: false,
            probe: true,
            printConfig: false,
            ...(claudeDesktopConfigPath ? { claudeDesktopConfigPath } : {}),
          }),
        ),
      );
    }
    if (apiKeyFromFlag) {
      warnApiKeyFlag();
    }
    await printMcpProbe({ apiKey, ...(baseUrl ? { baseUrl } : {}) });
  }
}

// ---------------------------------------------------------------------------
// platform tools subcommands
// ---------------------------------------------------------------------------

function runToolsCommand(): void {
  const maxName = Math.max(
    ...OPERATION_REGISTRY.map((tool) => tool.name.length),
    ...AGENT_TOOL_REGISTRY.map((tool) => tool.name.length),
  );
  for (const tool of AGENT_TOOL_REGISTRY) {
    process.stdout.write(
      `${tool.name.padEnd(maxName + 2)}local agent-tool [agent-local]\n`,
    );
  }
  for (const tool of OPERATION_REGISTRY) {
    const flags = [
      'platform',
      tool.destructive ? 'destructive' : '',
      tool.longRunning ? 'long-running' : '',
    ].filter(Boolean);
    const suffix = flags.length > 0 ? ` [${flags.join(', ')}]` : '';
    process.stdout.write(
      `${tool.name.padEnd(maxName + 2)}${tool.endpoint.method} ${tool.endpoint.path}${suffix}\n`,
    );
  }
}

async function runToolCommand(): Promise<void> {
  const toolName = getFlag('tool');
  if (!toolName) {
    process.stderr.write('Error: --tool is required.\n');
    process.exit(1);
  }

  const operation = OPERATION_REGISTRY.find((item) => item.name === toolName);
  const agentTool = getAgentToolDefinition(toolName);
  if (!operation && !agentTool) {
    process.stderr.write(
      `Unknown tool: "${toolName}". Run "traseq-agent tools" to list tools.\n`,
    );
    process.exit(1);
  }

  const rawInput =
    getFlag('input') ?? (hasFlag('stdin') ? await readStdinText() : '{}');
  const input = parseJsonInput(rawInput);
  if (agentTool) {
    const needsClient = agentToolNeedsPlatformClient(agentTool.name, input);
    if (
      agentTool.name === 'resolve_strategy_semantics' &&
      needsClient &&
      !readEnv('TRASEQ_API_KEY')
    ) {
      process.stderr.write(
        [
          'Error: resolve_strategy_semantics needs capabilities to ground candidates.',
          'Choose one of:',
          '  • Pass `capabilities` directly in --input (offline mode).',
          '  • Set TRASEQ_API_KEY so the CLI can fetch live capabilities.',
          '',
          `Get a key: ${TRASEQ_API_KEY_SETUP_URL}`,
          '',
        ].join('\n'),
      );
      process.exit(1);
    }
    const result = await runAgentTool(agentTool.name as AgentToolName, input, {
      ...(needsClient ? { client: createPlatformClient() } : {}),
    });

    process.stdout.write(JSON.stringify(result, null, 2));
    process.stdout.write('\n');
    return;
  }

  if (!operation) {
    throw new Error(`Unknown platform tool: ${toolName}`);
  }

  const result = await runPlatformTool(
    createPlatformClient(),
    operation.name as OperationName,
    input,
  );

  process.stdout.write(JSON.stringify(result, null, 2));
  process.stdout.write('\n');
}

// ---------------------------------------------------------------------------
// score subcommand
// ---------------------------------------------------------------------------

async function runScoreCommand(): Promise<void> {
  const { buildScoreBreakdown } = await import('./scoring.js');

  if (hasFlag('json')) {
    const summary = parseJsonInput(await readStdinText());
    const score = buildScoreBreakdown(summary);
    process.stdout.write(JSON.stringify({ score }, null, 2));
    process.stdout.write('\n');
    return;
  }

  const { TraseqClient } = await import('@traseq/sdk');
  const { normalizeBacktest } = await import('./normalize.js');

  const backtestId = getFlag('backtest-id');
  if (!backtestId) {
    process.stderr.write('Error: --backtest-id or --json is required.\n');
    process.exit(1);
  }

  const apiKey = requireEnv('TRASEQ_API_KEY');
  const client = new TraseqClient({
    baseUrl: readEnv('TRASEQ_BASE_URL') ?? 'https://api.traseq.com',
    apiKey,
  });

  const backtest = await client.getBacktest(backtestId);
  const normalized = normalizeBacktest(backtest);
  const score = buildScoreBreakdown(normalized.summary);

  process.stdout.write(
    JSON.stringify({ backtest: normalized, score }, null, 2),
  );
  process.stdout.write('\n');
}

async function runEvaluateCommand(): Promise<void> {
  if (!hasFlag('stdin')) {
    process.stderr.write('Error: --stdin is required for evaluate.\n');
    process.exit(1);
  }

  const { evaluateResearchResult } = await import('./evaluation.js');
  const input = parseJsonInput(await readStdinText());
  await assertRunnerSchemaVersion(input);

  const evaluation = evaluateResearchResult(
    input as unknown as ResearchRunnerResult,
  );

  process.stdout.write(JSON.stringify(evaluation, null, 2));
  process.stdout.write('\n');
}

async function runReportCommand(): Promise<void> {
  if (!hasFlag('stdin')) {
    process.stderr.write('Error: --stdin is required for report.\n');
    process.exit(1);
  }

  const { formatResearchReport } = await import('./report.js');
  const input = parseJsonInput(await readStdinText());
  await assertRunnerSchemaVersion(input);
  const report = formatResearchReport(input as unknown as ResearchRunnerResult);

  process.stdout.write(report);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (hasFlag('help') || subcommand === 'help') {
    printUsage();
    return;
  }

  switch (subcommand) {
    case 'context':
    case undefined:
      runContext();
      break;
    case 'templates':
      runTemplatesCommand();
      break;
    case 'template':
      runTemplateCommand();
      break;
    case 'references':
      runReferencesCommand();
      break;
    case 'reference':
      runReferenceCommand();
      break;
    case 'check-env':
      await runCheckEnvCommand();
      break;
    case 'tools':
      runToolsCommand();
      break;
    case 'run':
      await runToolCommand();
      break;
    case 'guide':
      await runGuideCommand();
      break;
    case 'guide-run':
      await runGuideRunCommand();
      break;
    case 'setup-mcp':
      await runSetupMcpCommand();
      break;
    case 'mcp-doctor':
      await runMcpDoctorCommand();
      break;
    case 'mcp': {
      const { startMcpServer } = await import('./mcp/index.js');
      startMcpServer();
      break;
    }
    case 'research':
      await runResearchCommand();
      break;
    case 'research-run':
      await runResearchRunCommand();
      break;
    case 'evaluate':
      await runEvaluateCommand();
      break;
    case 'report':
      await runReportCommand();
      break;
    case 'score':
      await runScoreCommand();
      break;
    default:
      process.stderr.write(`Unknown command: "${subcommand}"\n`);
      printUsage();
      process.exit(1);
  }
}

function formatFatalError(error: unknown): string {
  if (error instanceof TraseqApiError) {
    const lines = [formatTraseqAgentError(error)];
    if (error.status === 401 || error.status === 403) {
      lines.push(
        '',
        `Get or rotate a workspace API key: ${TRASEQ_API_KEY_SETUP_URL}`,
        'Run `traseq-agent check-env --probe` to verify your key end-to-end.',
      );
    }
    return lines.join('\n');
  }

  const message = error instanceof Error ? error.message : String(error);
  return `Error: ${message}`;
}

main().catch((error: unknown) => {
  process.stderr.write(`${formatFatalError(error)}\n`);
  process.exit(1);
});
