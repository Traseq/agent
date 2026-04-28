#!/usr/bin/env node
import { getAgentContext } from './assembler.js';
import { readEnv, requireEnv } from './env.js';
import {
  OPERATION_REGISTRY,
  type OperationName,
} from './generated/operation-registry.js';
import { references } from './references/index.js';
import { templates } from './templates/index.js';
import { runPlatformTool, TraseqClient } from './client/index.js';
import { asJsonObject } from './normalize.js';
import {
  AGENT_TOOL_REGISTRY,
  getAgentToolDefinition,
  runAgentTool,
  type AgentToolName,
} from './semantics/index.js';
import type {
  JsonObject,
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
      '  check-env                                      Check required environment variables',
      '  tools                                          List platform and agent-local tools',
      '  run --tool <name> [--input <json>]              Run a platform or agent-local tool',
      '  score --backtest-id <id>                        Score a completed backtest',
      '  score --json                                    Score from stdin JSON summary',
      '  evaluate --stdin                                Evaluate a research runner JSON result',
      '  report --stdin                                  Format a research runner JSON result as Markdown',
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

function createPlatformClient(): TraseqClient {
  return new TraseqClient({
    apiKey: requireEnv('TRASEQ_API_KEY'),
    baseUrl: readEnv('TRASEQ_BASE_URL') ?? 'https://api.traseq.com',
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
  if (schemaVersion !== undefined && schemaVersion !== RUNNER_SCHEMA_VERSION) {
    process.stderr.write(
      `Error: research runner schemaVersion mismatch (got ${String(schemaVersion)}, expected ${RUNNER_SCHEMA_VERSION}).\n`,
    );
    process.exit(1);
  }
}

function agentToolNeedsPlatformClient(
  agentToolName: AgentToolName,
  input: JsonObject,
): boolean {
  return (
    agentToolName === 'run_research_draft' ||
    (agentToolName === 'resolve_strategy_semantics' &&
      asJsonObject(input.capabilities) === undefined)
  );
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

function runCheckEnvCommand(): void {
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
    process.exit(1);
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
      runCheckEnvCommand();
      break;
    case 'tools':
      runToolsCommand();
      break;
    case 'run':
      await runToolCommand();
      break;
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

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exit(1);
});
