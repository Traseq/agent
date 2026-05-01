import { homedir } from 'node:os';
import { join } from 'node:path';

import { TRASEQ_API_KEY_SETUP_URL } from '../env.js';

export const MCP_CLIENTS = [
  'auto',
  'codex',
  'claude-code',
  'claude-desktop',
  'generic',
] as const;

export const MCP_SCOPES = ['local', 'user', 'project'] as const;

export type McpClient = (typeof MCP_CLIENTS)[number];
export type ResolvedMcpClient = Exclude<McpClient, 'auto'>;
export type McpScope = (typeof MCP_SCOPES)[number];

export interface McpServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface McpServerConfig {
  mcpServers: Record<string, McpServerEntry>;
}

export interface McpServerConfigInput {
  serverName?: string;
  packageName?: string;
  binaryName?: string;
  scope?: McpScope;
  apiKey?: string;
  baseUrl?: string;
  inlineSecrets?: boolean;
  allowProjectSecrets?: boolean;
}

export interface McpInstallPlanInput extends McpServerConfigInput {
  client?: McpClient;
  detectedClients?: Partial<Record<ResolvedMcpClient, boolean>>;
  claudeDesktopConfigPath?: string;
}

export interface McpInstallPlan {
  client: ResolvedMcpClient;
  requestedClient: McpClient;
  scope: McpScope;
  serverName: string;
  config: McpServerConfig;
  command?: string[];
  removeCommand?: string[];
  addJsonCommand?: string[];
  writeSupported: boolean;
  writeTarget?: string;
  warnings: string[];
  nextPrompt: string;
  nextSteps: string[];
}

export interface McpProbeClient {
  getManifest(): Promise<unknown>;
  getWorkspaceContext(): Promise<unknown>;
  getUsage(): Promise<unknown>;
  getCapabilities(): Promise<unknown>;
}

export interface McpProbeResult {
  ok: boolean;
  workspace: string;
  tier: string;
  scopes: string[];
  missingScopes: string[];
  checks: string[];
  nextSteps: string[];
  raw: {
    manifest: unknown;
    workspace: unknown;
    usage: unknown;
    capabilities: unknown;
  };
}

const DEFAULT_SERVER_NAME = 'traseq';
const DEFAULT_PACKAGE_NAME = '@traseq/agent';
const DEFAULT_BINARY_NAME = 'traseq-agent';
const DEFAULT_BASE_URL = 'https://api.traseq.com';
const REDACTED_SECRET = '<redacted>';
const REQUIRED_GUIDED_SCOPES = [
  'workspace_read',
  'strategies_write',
  'backtests_read',
  'backtests_write',
];

// Single source for the post-setup copy-paste prompt. The same string is
// duplicated in user-facing docs that cannot import TS at build time —
// keep these in sync when editing:
//   - packages/agent/README.md
//   - docs/public-docs/api-reference/ai-agent-integration.mdx
//   - docs/public-docs/zh-hant/api-reference/ai-agent-integration.mdx
export const NEXT_PROMPT_DEFAULT =
  'Use the Traseq MCP server. First call the MCP tool `start_research_engagement` with prompt "Validate a BTCUSDT 4h strategy idea." Do not search the repo; if the tool is unavailable, tell me the Traseq MCP server is not connected.';
const NEXT_STEP_RESTART_GENERIC =
  'Restart or refresh your MCP client if needed.';
const NEXT_STEP_RESTART_CLAUDE_DESKTOP = 'Restart Claude Desktop completely.';
const NEXT_STEP_MERGE_CLAUDE_DESKTOP =
  'Merge this config into Claude Desktop Developer settings.';
const NEXT_STEP_COPY_GENERIC =
  'Copy the MCP JSON into your client configuration.';
const SHARED_FOLLOWUP_STEPS = [
  'Ask your MCP client to start with `start_research_engagement` for a strategy idea.',
  'Let the client author a draft, then run `run_guided_research_round` for validation, backtest, evidence, and app links.',
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function normalizedScope(value: McpScope | undefined): McpScope {
  return value ?? 'user';
}

function normalizedServerName(value: string | undefined): string {
  return value?.trim() || DEFAULT_SERVER_NAME;
}

function normalizedPackageName(value: string | undefined): string {
  return value?.trim() || DEFAULT_PACKAGE_NAME;
}

function normalizedBinaryName(value: string | undefined): string {
  return value?.trim() || DEFAULT_BINARY_NAME;
}

function normalizedBaseUrl(value: string | undefined): string {
  return value?.trim() || DEFAULT_BASE_URL;
}

function shouldInlineSecret(input: McpServerConfigInput): boolean {
  const scope = normalizedScope(input.scope);
  if (!input.inlineSecrets || !input.apiKey) {
    return false;
  }
  if (scope === 'project' && !input.allowProjectSecrets) {
    throw new Error(
      'Project-scoped MCP config must not inline TRASEQ_API_KEY. Use ${TRASEQ_API_KEY} or pass allowProjectSecrets explicitly.',
    );
  }
  return true;
}

function buildEnv(input: McpServerConfigInput): Record<string, string> {
  return {
    TRASEQ_API_KEY: shouldInlineSecret(input)
      ? (input.apiKey as string)
      : '${TRASEQ_API_KEY}',
    TRASEQ_BASE_URL: normalizedBaseUrl(input.baseUrl),
  };
}

export function buildMcpServerConfig(
  input: McpServerConfigInput = {},
): McpServerConfig {
  const serverName = normalizedServerName(input.serverName);
  const packageName = normalizedPackageName(input.packageName);
  const binaryName = normalizedBinaryName(input.binaryName);

  return {
    mcpServers: {
      [serverName]: {
        command: 'npx',
        args: ['-y', '--package', packageName, binaryName, 'mcp'],
        env: buildEnv(input),
      },
    },
  };
}

function resolveClient(input: McpInstallPlanInput): ResolvedMcpClient {
  const requested = input.client ?? 'auto';
  if (requested !== 'auto') {
    return requested;
  }

  if (input.detectedClients?.codex) {
    return 'codex';
  }
  if (input.detectedClients?.['claude-code']) {
    return 'claude-code';
  }
  if (input.detectedClients?.['claude-desktop']) {
    return 'claude-desktop';
  }
  return 'generic';
}

function envFlags(env: Record<string, string>, style: 'codex' | 'claude') {
  return Object.entries(env).flatMap(([key, value]) =>
    style === 'codex'
      ? ['--env', `${key}=${value}`]
      : ['-e', `${key}=${value}`],
  );
}

function claudeDesktopDefaultConfigPath(): string | undefined {
  if (process.platform === 'darwin') {
    return join(
      homedir(),
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json',
    );
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    return appData
      ? join(appData, 'Claude', 'claude_desktop_config.json')
      : undefined;
  }
  return undefined;
}

export function buildClientInstallPlan(
  input: McpInstallPlanInput = {},
): McpInstallPlan {
  const client = resolveClient(input);
  const requestedClient = input.client ?? 'auto';
  const requestedScope = normalizedScope(input.scope);
  const serverName = normalizedServerName(input.serverName);
  const warnings: string[] = [];
  const nextPrompt = NEXT_PROMPT_DEFAULT;
  const genericNextSteps = [
    NEXT_STEP_RESTART_GENERIC,
    ...SHARED_FOLLOWUP_STEPS,
  ];

  if (client === 'claude-desktop') {
    return buildClaudeDesktopPlan({
      input,
      requestedClient,
      requestedScope,
      serverName,
      warnings,
      nextPrompt,
    });
  }

  const scope = requestedScope;
  const config = buildMcpServerConfig(input);
  const entry = config.mcpServers[serverName];

  if (!entry) {
    throw new Error(`Could not build MCP server entry for ${serverName}.`);
  }

  if (scope === 'project' && input.apiKey && !input.allowProjectSecrets) {
    warnings.push(
      'Project scope uses ${TRASEQ_API_KEY}; the API key is not written into shared config.',
    );
  }

  if (!input.apiKey) {
    warnings.push(
      `TRASEQ_API_KEY is not set. Create a workspace API key: ${TRASEQ_API_KEY_SETUP_URL}`,
    );
  }

  if (client === 'codex') {
    if (scope === 'project') {
      warnings.push(
        'Codex CLI MCP config is user-level; --scope project is not supported for codex.',
      );
    }
    return {
      client,
      requestedClient,
      scope,
      serverName,
      config,
      command: [
        'codex',
        'mcp',
        'add',
        serverName,
        ...envFlags(entry.env, 'codex'),
        '--',
        entry.command,
        ...entry.args,
      ],
      removeCommand: ['codex', 'mcp', 'remove', serverName],
      writeSupported: true,
      warnings,
      nextPrompt,
      nextSteps: genericNextSteps,
    };
  }

  if (client === 'claude-code') {
    const serverJson = JSON.stringify({
      type: 'stdio',
      command: entry.command,
      args: entry.args,
      env: entry.env,
    });
    return {
      client,
      requestedClient,
      scope,
      serverName,
      config,
      command: [
        'claude',
        'mcp',
        'add-json',
        '--scope',
        scope,
        serverName,
        serverJson,
      ],
      removeCommand: ['claude', 'mcp', 'remove', '--scope', scope, serverName],
      writeSupported: true,
      warnings,
      nextPrompt,
      nextSteps: genericNextSteps,
    };
  }

  return {
    client,
    requestedClient,
    scope,
    serverName,
    config,
    writeSupported: false,
    warnings,
    nextPrompt,
    nextSteps: [NEXT_STEP_COPY_GENERIC, ...genericNextSteps],
  };
}

interface ClaudeDesktopPlanInput {
  input: McpInstallPlanInput;
  requestedClient: McpClient;
  requestedScope: McpScope;
  serverName: string;
  warnings: string[];
  nextPrompt: string;
}

function buildClaudeDesktopPlan({
  input,
  requestedClient,
  requestedScope,
  serverName,
  warnings,
  nextPrompt,
}: ClaudeDesktopPlanInput): McpInstallPlan {
  // Claude Desktop only ships a user-level MCP config and does not expand
  // ${VAR} placeholders in env values. Force user scope and inline the API
  // key when one is available so the resulting config actually works.
  if (requestedScope === 'project') {
    warnings.push(
      'Claude Desktop has only a user-level config file; --scope project is not applicable and is being treated as --scope user.',
    );
  }

  if (!input.apiKey) {
    warnings.push(
      'Claude Desktop does not expand ${TRASEQ_API_KEY} in MCP env values. Set TRASEQ_API_KEY before --write, or hard-code the key in the config after install.',
    );
  } else {
    warnings.push(
      'TRASEQ_API_KEY will be inlined into the Claude Desktop config file. Anyone with read access to that file can read the key.',
    );
  }

  const desktopConfig = buildMcpServerConfig({
    ...input,
    scope: 'user',
    inlineSecrets: Boolean(input.apiKey),
  });

  const writeTarget =
    input.claudeDesktopConfigPath ?? claudeDesktopDefaultConfigPath();
  if (!writeTarget) {
    warnings.push(
      'Claude Desktop config path is only auto-detected on macOS and Windows. Use --print-config and paste the JSON manually.',
    );
  }

  return {
    client: 'claude-desktop',
    requestedClient,
    scope: 'user',
    serverName,
    config: desktopConfig,
    writeSupported: Boolean(writeTarget),
    ...(writeTarget ? { writeTarget } : {}),
    warnings,
    nextPrompt,
    nextSteps: [
      NEXT_STEP_MERGE_CLAUDE_DESKTOP,
      NEXT_STEP_RESTART_CLAUDE_DESKTOP,
      ...SHARED_FOLLOWUP_STEPS,
    ],
  };
}

function redactEnvValue(key: string, value: string): string {
  return key === 'TRASEQ_API_KEY' && value !== '${TRASEQ_API_KEY}'
    ? REDACTED_SECRET
    : value;
}

function redactCommandArg(value: string): string {
  if (value.startsWith('TRASEQ_API_KEY=')) {
    return `TRASEQ_API_KEY=${REDACTED_SECRET}`;
  }
  if (value.includes('TRASEQ_API_KEY')) {
    return value.replace(
      /"TRASEQ_API_KEY":"[^"]*"/,
      `"TRASEQ_API_KEY":"${REDACTED_SECRET}"`,
    );
  }
  return value;
}

export function redactMcpInstallPlan(plan: McpInstallPlan): McpInstallPlan {
  const config: McpServerConfig = {
    mcpServers: Object.fromEntries(
      Object.entries(plan.config.mcpServers).map(([name, entry]) => [
        name,
        {
          ...entry,
          env: Object.fromEntries(
            Object.entries(entry.env).map(([key, value]) => [
              key,
              redactEnvValue(key, value),
            ]),
          ),
        },
      ]),
    ),
  };

  return {
    ...plan,
    config,
    ...(plan.command
      ? { command: plan.command.map((arg) => redactCommandArg(arg)) }
      : {}),
    ...(plan.removeCommand
      ? {
          removeCommand: plan.removeCommand.map((arg) => redactCommandArg(arg)),
        }
      : {}),
    ...(plan.addJsonCommand
      ? {
          addJsonCommand: plan.addJsonCommand.map((arg) =>
            redactCommandArg(arg),
          ),
        }
      : {}),
  };
}

function readWorkspaceName(value: unknown): string {
  const root = isObject(value) ? value : {};
  const workspace = isObject(root.workspace) ? root.workspace : {};
  return (
    stringValue(workspace.name) ??
    stringValue(workspace.slug) ??
    stringValue(workspace.id) ??
    'unknown workspace'
  );
}

function readTier(value: unknown): string {
  const root = isObject(value) ? value : {};
  const subscription = isObject(root.subscription) ? root.subscription : {};
  return (
    stringValue(subscription.plan) ??
    stringValue(subscription.tier) ??
    stringValue(root.subscriptionTier) ??
    'unknown'
  );
}

function readScopes(value: unknown): string[] {
  const root = isObject(value) ? value : {};
  const apiKey = isObject(root.apiKey) ? root.apiKey : {};
  return Array.isArray(apiKey.scopes)
    ? apiKey.scopes.filter(
        (scope): scope is string => typeof scope === 'string',
      )
    : [];
}

export async function probeTraseqMcpSetup(options: {
  client: McpProbeClient;
}): Promise<McpProbeResult> {
  const [manifest, workspace, usage, capabilities] = await Promise.all([
    options.client.getManifest(),
    options.client.getWorkspaceContext(),
    options.client.getUsage(),
    options.client.getCapabilities(),
  ]);
  const scopes = readScopes(workspace);
  const missingScopes = REQUIRED_GUIDED_SCOPES.filter(
    (scope) => !scopes.includes(scope),
  );

  return {
    ok: missingScopes.length === 0,
    workspace: readWorkspaceName(workspace),
    tier: readTier(workspace),
    scopes,
    missingScopes,
    checks: [
      'manifest reachable',
      'workspace context readable',
      'usage readable',
      'capabilities readable',
    ],
    nextSteps:
      missingScopes.length === 0
        ? [
            'MCP setup is ready for guided research.',
            'Ask your client to start with `start_research_engagement`.',
          ]
        : [
            `Add missing API key scopes: ${missingScopes.join(', ')}`,
            `Open API key settings: ${TRASEQ_API_KEY_SETUP_URL}`,
          ],
    raw: {
      manifest,
      workspace,
      usage,
      capabilities,
    },
  };
}

export function formatShellCommand(args: readonly string[]): string {
  return args
    .map((arg) =>
      /^[A-Za-z0-9_./:=@-]+$/.test(arg)
        ? arg
        : `'${arg.replace(/'/g, `'\\''`)}'`,
    )
    .join(' ');
}
