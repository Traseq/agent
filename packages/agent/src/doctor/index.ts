import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { TraseqClient } from '@traseq/sdk';

import { claudeDesktopDefaultConfigPath } from '../install/claude-desktop.js';
import type { McpServerEntry } from '../install/types.js';
import { packageVersion } from '../install/version.js';
import { probeTraseqMcpSetup, REQUIRED_GUIDED_SCOPES } from '../mcp/probe.js';
import { summarizeUsageHints } from '../usage-hints.js';
import {
  DEFAULT_SECRET_REF,
  formatSecretRef,
  getDefaultSecretStore,
  parseSecretRef,
  resolveSecretRef,
  type SecretRef,
} from '../secrets/index.js';

export type CheckStatus = 'green' | 'yellow' | 'red';

export interface DoctorCheckResult {
  id: string;
  title: string;
  status: CheckStatus;
  detail: string;
  fix?: string;
}

export interface DoctorContext {
  serverName: string;
  secretRef: SecretRef;
  apiKeyOverride?: string;
  baseUrl?: string;
  handshakeTimeoutMs: number;
}

export interface FoundEntry {
  source: string;
  serverName: string;
  entry: McpServerEntry;
}

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function exec(command: string, args: string[]): Promise<ExecResult> {
  return new Promise((resolveExec, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (exitCode) =>
      resolveExec({ exitCode: exitCode ?? -1, stdout, stderr }),
    );
  });
}

function readJsonFile<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const raw = readFileSync(path, 'utf8');
    if (raw.trim().length === 0) return undefined;
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

interface ClaudeUserConfig {
  mcpServers?: Record<string, McpServerEntry>;
  projects?: Record<string, { mcpServers?: Record<string, McpServerEntry> }>;
}

interface ProjectMcpConfig {
  mcpServers?: Record<string, McpServerEntry>;
}

export function findEntries(serverName: string): FoundEntry[] {
  const found: FoundEntry[] = [];
  const userClaudeJson = join(homedir(), '.claude.json');
  const userConfig = readJsonFile<ClaudeUserConfig>(userClaudeJson);
  if (userConfig) {
    if (userConfig.mcpServers && serverName in userConfig.mcpServers) {
      found.push({
        source: `${userClaudeJson} (user scope)`,
        serverName,
        entry: userConfig.mcpServers[serverName]!,
      });
    }
    if (userConfig.projects) {
      for (const [projectPath, project] of Object.entries(
        userConfig.projects,
      )) {
        if (project.mcpServers && serverName in project.mcpServers) {
          found.push({
            source: `${userClaudeJson} (project: ${projectPath})`,
            serverName,
            entry: project.mcpServers[serverName]!,
          });
        }
      }
    }
  }

  const projectMcpJson = join(process.cwd(), '.mcp.json');
  const projectConfig = readJsonFile<ProjectMcpConfig>(projectMcpJson);
  if (projectConfig?.mcpServers && serverName in projectConfig.mcpServers) {
    found.push({
      source: `${projectMcpJson} (project scope)`,
      serverName,
      entry: projectConfig.mcpServers[serverName]!,
    });
  }

  try {
    const desktopPath = claudeDesktopDefaultConfigPath();
    const desktopConfig = readJsonFile<ProjectMcpConfig>(desktopPath);
    if (desktopConfig?.mcpServers && serverName in desktopConfig.mcpServers) {
      found.push({
        source: `${desktopPath} (Claude Desktop)`,
        serverName,
        entry: desktopConfig.mcpServers[serverName]!,
      });
    }
  } catch {
    /* Linux without claude desktop default — skip */
  }

  return found;
}

export function classifyCommand(entry: McpServerEntry): {
  shape: 'npx' | 'absolute-path' | 'unknown';
  packageSpec?: string;
} {
  if (entry.command === 'npx') {
    const args = entry.args;
    const idx = args.indexOf('--package');
    const spec = idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
    return spec ? { shape: 'npx', packageSpec: spec } : { shape: 'npx' };
  }
  if (entry.command.startsWith('/') || /^[A-Za-z]:[\\/]/.test(entry.command)) {
    return { shape: 'absolute-path' };
  }
  return { shape: 'unknown' };
}

function parsePackageSpec(spec: string): {
  name: string;
  range?: string;
} {
  const at = spec.lastIndexOf('@');
  if (at <= 0) return { name: spec };
  return { name: spec.slice(0, at), range: spec.slice(at + 1) };
}

async function checkNodeVersion(): Promise<DoctorCheckResult> {
  const version = process.versions.node;
  const major = Number(version.split('.')[0]);
  if (Number.isFinite(major) && major >= 20) {
    return {
      id: 'node-version',
      title: 'Node.js >= 20',
      status: 'green',
      detail: `Node ${version}`,
    };
  }
  return {
    id: 'node-version',
    title: 'Node.js >= 20',
    status: 'red',
    detail: `Node ${version} is too old.`,
    fix: 'Install Node.js 20 LTS or newer.',
  };
}

async function checkSecretStore(): Promise<DoctorCheckResult> {
  const store = getDefaultSecretStore();
  const availability = await store.available();
  if (availability.ok) {
    return {
      id: 'secret-store',
      title: 'OS keychain available',
      status: 'green',
      detail: `${store.kind} ready.`,
    };
  }
  return {
    id: 'secret-store',
    title: 'OS keychain available',
    status: 'yellow',
    detail: availability.reason ?? `${store.kind} unavailable.`,
    fix: 'Install the platform credential helper, or use --store=env to fall back to a TRASEQ_API_KEY env var.',
  };
}

async function checkSecretResolvable(
  ctx: DoctorContext,
): Promise<DoctorCheckResult> {
  if (ctx.apiKeyOverride) {
    return {
      id: 'secret-resolvable',
      title: 'TRASEQ_API_KEY resolvable',
      status: 'green',
      detail: 'Using --api-key override.',
    };
  }
  try {
    await resolveSecretRef(ctx.secretRef, { envFallback: 'TRASEQ_API_KEY' });
    return {
      id: 'secret-resolvable',
      title: 'TRASEQ_API_KEY resolvable',
      status: 'green',
      detail: `Resolved ${formatSecretRef(ctx.secretRef)}.`,
    };
  } catch (error) {
    return {
      id: 'secret-resolvable',
      title: 'TRASEQ_API_KEY resolvable',
      status: 'red',
      detail: error instanceof Error ? error.message : String(error),
      fix: 'Run `traseq-agent login` to populate the OS keychain.',
    };
  }
}

function configFilesPresentCheck(found: FoundEntry[]): DoctorCheckResult {
  if (found.length === 0) {
    return {
      id: 'config-present',
      title: 'MCP config detected',
      status: 'yellow',
      detail: 'No traseq MCP server entry found in any known client config.',
      fix: 'Run `traseq-agent install --target=claude-code:user` (or your client of choice).',
    };
  }
  return {
    id: 'config-present',
    title: 'MCP config detected',
    status: 'green',
    detail: `Found ${found.length} entr${found.length === 1 ? 'y' : 'ies'}: ${found
      .map((f) => f.source)
      .join('; ')}.`,
  };
}

function commandShapeCheck(found: FoundEntry[]): DoctorCheckResult {
  if (found.length === 0) {
    return {
      id: 'command-shape',
      title: 'Command shape',
      status: 'yellow',
      detail: 'No entries to inspect.',
    };
  }
  const issues: string[] = [];
  for (const item of found) {
    const classification = classifyCommand(item.entry);
    if (classification.shape === 'absolute-path') {
      const path = item.entry.command;
      const isStaleBin = /node_modules\/\.bin\//.test(path);
      issues.push(
        `${item.source}: absolute path${isStaleBin ? ' under node_modules/.bin/ (likely stale local install)' : ''} → ${path}`,
      );
    } else if (classification.shape === 'unknown') {
      issues.push(
        `${item.source}: unrecognized command shape → ${item.entry.command}`,
      );
    }
  }
  if (issues.length === 0) {
    return {
      id: 'command-shape',
      title: 'Command shape',
      status: 'green',
      detail: `All ${found.length} entr${found.length === 1 ? 'y is' : 'ies are'} on \`npx\`-form.`,
    };
  }
  return {
    id: 'command-shape',
    title: 'Command shape',
    status: 'red',
    detail: issues.join('\n'),
    fix: 'Run `traseq-agent install --target=<client>:<location> --force` to rewrite to npx form.',
  };
}

function absolutePathStatCheck(found: FoundEntry[]): DoctorCheckResult {
  const broken: string[] = [];
  for (const item of found) {
    const classification = classifyCommand(item.entry);
    if (classification.shape === 'absolute-path') {
      try {
        statSync(item.entry.command);
      } catch {
        broken.push(
          `${item.source}: ${item.entry.command} does not exist (ENOENT).`,
        );
      }
    }
  }
  if (broken.length === 0) {
    return {
      id: 'absolute-path-stat',
      title: 'Absolute paths exist on disk',
      status: 'green',
      detail: 'No dangling absolute path entries.',
    };
  }
  return {
    id: 'absolute-path-stat',
    title: 'Absolute paths exist on disk',
    status: 'red',
    detail: broken.join('\n'),
    fix: 'Remove the broken entry and reinstall with `traseq-agent install --target=<client>:<location> --force`.',
  };
}

async function npmLatestVersion(name: string): Promise<string | undefined> {
  const result = await exec('npm', ['view', name, 'version', '--json']);
  if (result.exitCode !== 0) return undefined;
  try {
    const parsed = JSON.parse(result.stdout) as string | string[];
    return Array.isArray(parsed) ? parsed[parsed.length - 1] : parsed;
  } catch {
    return result.stdout.trim().replace(/^"|"$/g, '');
  }
}

async function npxPinCheck(found: FoundEntry[]): Promise<DoctorCheckResult> {
  const issues: string[] = [];
  let yellow = false;
  for (const item of found) {
    const classification = classifyCommand(item.entry);
    if (classification.shape !== 'npx') continue;
    const spec = classification.packageSpec;
    if (!spec) {
      issues.push(`${item.source}: npx form missing --package spec.`);
      continue;
    }
    const { name, range } = parsePackageSpec(spec);
    if (!range) {
      yellow = true;
      issues.push(
        `${item.source}: \`${name}\` is unpinned. npx may serve a cached older copy.`,
      );
      continue;
    }
    const latest = await npmLatestVersion(name);
    if (!latest) {
      issues.push(`${item.source}: could not query npm registry for ${name}.`);
      continue;
    }
    const localVersion = packageVersion();
    const localMajorMinor = localVersion.split('.').slice(0, 2).join('.');
    const latestMajorMinor = latest.split('.').slice(0, 2).join('.');
    if (localMajorMinor !== latestMajorMinor) {
      yellow = true;
      issues.push(
        `${item.source}: pinned to ${spec}, latest ${name}@${latest} (this binary is ${localVersion}). Consider \`traseq-agent upgrade\`.`,
      );
    }
  }
  if (issues.length === 0) {
    return {
      id: 'npx-pin',
      title: 'npx version pin',
      status: 'green',
      detail: 'All npx-form entries are pinned and up-to-date.',
    };
  }
  return {
    id: 'npx-pin',
    title: 'npx version pin',
    status: yellow ? 'yellow' : 'red',
    detail: issues.join('\n'),
    fix: 'Run `traseq-agent upgrade` to repin and clear the npx cache.',
  };
}

async function liveHandshakeCheck(
  found: FoundEntry[],
  ctx: DoctorContext,
): Promise<DoctorCheckResult> {
  if (found.length === 0) {
    return {
      id: 'handshake',
      title: 'MCP initialize handshake',
      status: 'yellow',
      detail: 'No entries to test.',
    };
  }
  const target = found[0]!;
  const env: Record<string, string> = {
    ...process.env,
    ...target.entry.env,
  } as Record<string, string>;
  if (ctx.apiKeyOverride) {
    env.TRASEQ_API_KEY = ctx.apiKeyOverride;
  }

  const transport = new StdioClientTransport({
    command: target.entry.command,
    args: target.entry.args,
    env,
  });
  const client = new Client({
    name: 'traseq-agent-doctor',
    version: packageVersion(),
  });

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `MCP handshake timed out after ${ctx.handshakeTimeoutMs}ms.`,
          ),
        ),
      ctx.handshakeTimeoutMs,
    );
  });

  try {
    await Promise.race([client.connect(transport), timeout]);
    if (timer) clearTimeout(timer);
    const tools = await client.listTools();
    const has = tools.tools.some((t) => t.name === 'start_research_engagement');
    await client.close();
    if (!has) {
      return {
        id: 'handshake',
        title: 'MCP initialize handshake',
        status: 'red',
        detail:
          'Initialize succeeded but `start_research_engagement` is not in tools/list. Server may be running an unexpected build.',
        fix: 'Run `traseq-agent upgrade` to repin to the current package version.',
      };
    }
    return {
      id: 'handshake',
      title: 'MCP initialize handshake',
      status: 'green',
      detail: `${target.source}: initialize OK; ${tools.tools.length} tools listed.`,
    };
  } catch (error) {
    if (timer) clearTimeout(timer);
    try {
      await client.close();
    } catch {
      /* noop */
    }
    const detail = error instanceof Error ? error.message : String(error);
    const looksLikeFraming =
      /Content-Length|unexpected token|invalid json|Unexpected end of JSON/i.test(
        detail,
      );
    return {
      id: 'handshake',
      title: 'MCP initialize handshake',
      status: 'red',
      detail: looksLikeFraming
        ? `${target.source}: framing error during initialize — ${detail}. The configured server is using LSP-style framing while Claude Code expects NDJSON. This usually means \`npx\` is serving a stale 0.1.x cache.`
        : `${target.source}: ${detail}`,
      fix: 'Run `traseq-agent upgrade` to clear the npx cache and reinstall the latest @traseq/agent.',
    };
  }
}

async function runApiProbe(ctx: DoctorContext): Promise<
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; error: string }
  | {
      kind: 'ok';
      result: Awaited<ReturnType<typeof probeTraseqMcpSetup>>;
    }
> {
  let apiKey = ctx.apiKeyOverride;
  if (!apiKey) {
    try {
      apiKey = await resolveSecretRef(ctx.secretRef, {
        envFallback: 'TRASEQ_API_KEY',
      });
    } catch (error) {
      return {
        kind: 'skipped',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const baseUrl = ctx.baseUrl ?? 'https://api.traseq.com';
  const traseqClient = new TraseqClient({ apiKey, baseUrl });
  try {
    const result = await probeTraseqMcpSetup({
      client: {
        getManifest: () => traseqClient.getManifest(),
        getWorkspaceContext: () => traseqClient.getWorkspaceContext(),
        getUsage: () => traseqClient.getUsage(),
        getCapabilities: () => traseqClient.getCapabilities(),
      },
    });
    return { kind: 'ok', result };
  } catch (error) {
    return {
      kind: 'failed',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function probeCheckRow(
  outcome: Awaited<ReturnType<typeof runApiProbe>>,
): DoctorCheckResult {
  if (outcome.kind === 'skipped') {
    return {
      id: 'probe',
      title: 'API probe',
      status: 'yellow',
      detail: `Skipping probe — ${outcome.reason}`,
    };
  }
  if (outcome.kind === 'failed') {
    return {
      id: 'probe',
      title: 'API probe',
      status: 'red',
      detail: outcome.error,
      fix: 'Verify the API key, network access, and `https://api.traseq.com` reachability.',
    };
  }
  const result = outcome.result;
  if (!result.ok) {
    return {
      id: 'probe',
      title: 'API probe',
      status: 'red',
      detail: `Workspace ${result.workspace} (${result.tier}); missing scopes: ${result.missingScopes.join(', ')}.`,
      fix: `Add the missing scopes (${REQUIRED_GUIDED_SCOPES.join(', ')}) to your API key.`,
    };
  }
  return {
    id: 'probe',
    title: 'API probe',
    status: 'green',
    detail: `Workspace ${result.workspace} (${result.tier}); scopes ok.`,
  };
}

function workspaceUsageRow(
  outcome: Awaited<ReturnType<typeof runApiProbe>>,
): DoctorCheckResult | undefined {
  if (outcome.kind !== 'ok') {
    return undefined;
  }
  const status = summarizeUsageHints({
    usage: outcome.result.raw.usage,
    workspace: outcome.result.raw.workspace,
    manifest: outcome.result.raw.manifest,
  });
  if (status.level === 'ok') {
    return {
      id: 'workspace-usage',
      title: 'Workspace usage',
      status: 'green',
      detail: `Tier ${status.tier}; budget and stored-result limits have headroom.`,
    };
  }

  const firstLink = status.links[0];
  const firstStep = status.nextSteps[0];
  const detail = `${status.message}${firstStep ? ` Next: ${firstStep}` : ''}`;
  const fix = firstLink ? `${firstLink.label}: ${firstLink.href}` : undefined;

  return {
    id: 'workspace-usage',
    title: 'Workspace usage',
    // Doctor diagnoses configuration health, not policy. Even at 'exhausted'
    // we report yellow — the configuration is fine, the workspace just needs
    // cleanup or a plan upgrade.
    status: 'yellow',
    detail,
    ...(fix ? { fix } : {}),
  };
}

export async function runDoctor(
  ctx: DoctorContext,
): Promise<DoctorCheckResult[]> {
  const out: DoctorCheckResult[] = [];
  out.push(await checkNodeVersion());
  out.push(await checkSecretStore());
  out.push(await checkSecretResolvable(ctx));
  const found = findEntries(ctx.serverName);
  out.push(configFilesPresentCheck(found));
  out.push(commandShapeCheck(found));
  out.push(absolutePathStatCheck(found));
  out.push(await npxPinCheck(found));
  out.push(await liveHandshakeCheck(found, ctx));
  const probeOutcome = await runApiProbe(ctx);
  out.push(probeCheckRow(probeOutcome));
  const usageRow = workspaceUsageRow(probeOutcome);
  if (usageRow) {
    out.push(usageRow);
  }
  return out;
}

export function defaultDoctorContext(
  overrides: Partial<DoctorContext> = {},
): DoctorContext {
  return {
    serverName: overrides.serverName ?? 'traseq',
    secretRef: overrides.secretRef ?? DEFAULT_SECRET_REF,
    handshakeTimeoutMs: overrides.handshakeTimeoutMs ?? 30_000,
    ...(overrides.apiKeyOverride !== undefined
      ? { apiKeyOverride: overrides.apiKeyOverride }
      : {}),
    ...(overrides.baseUrl !== undefined ? { baseUrl: overrides.baseUrl } : {}),
  };
}

export { parseSecretRef, formatSecretRef };

// silence unused warnings for type imports referenced only by JSDoc
void platform;
