import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { buildEntry } from './shared.js';
import type {
  ApplyResult,
  InstallInput,
  InstallPlan,
  InstallTarget,
  InstallWriter,
  McpServerEntry,
} from './types.js';

const PROJECT_CONFIG_FILENAME = '.mcp.json';

function userClaudeJsonPath(): string {
  return join(homedir(), '.claude.json');
}

function projectConfigPath(): string {
  return resolve(process.cwd(), PROJECT_CONFIG_FILENAME);
}

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function execClaudeCli(args: string[]): Promise<ExecResult> {
  return new Promise((resolveExec, reject) => {
    const child = spawn('claude', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      resolveExec({ exitCode: exitCode ?? -1, stdout, stderr });
    });
  });
}

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const raw = readFileSync(path, 'utf8');
    if (raw.trim().length === 0) {
      return undefined;
    }
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(
      `Failed to parse JSON at ${path}: ${
        error instanceof Error ? error.message : String(error)
      }. Resolve corruption manually before retrying.`,
    );
  }
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

interface ClaudeProjectConfig {
  mcpServers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

function applyEntryToFile(
  path: string,
  serverName: string,
  entry: McpServerEntry,
): void {
  const existing = readJson<ClaudeProjectConfig>(path) ?? {};
  const next: ClaudeProjectConfig = {
    ...existing,
    mcpServers: {
      ...(existing.mcpServers ?? {}),
      [serverName]: entry,
    },
  };
  writeJson(path, next);
}

function removeEntryFromFile(path: string, serverName: string): void {
  const existing = readJson<ClaudeProjectConfig>(path);
  if (
    !existing ||
    !existing.mcpServers ||
    !(serverName in existing.mcpServers)
  ) {
    return;
  }
  const remaining = { ...existing.mcpServers };
  delete remaining[serverName];
  const next: ClaudeProjectConfig = { ...existing, mcpServers: remaining };
  writeJson(path, next);
}

function locationConfigPath(target: InstallTarget): string {
  if (target.location === 'user') {
    return userClaudeJsonPath();
  }
  if (target.location === 'project') {
    return projectConfigPath();
  }
  throw new Error(
    `Unsupported claude-code location: ${target.location}. Use claude-code:user or claude-code:project.`,
  );
}

function projectScopeWarnings(input: InstallInput, warnings: string[]): void {
  if (input.target.location !== 'project') {
    return;
  }
  if (input.inline !== undefined && input.inline.length > 0) {
    if (!input.acknowledgeShared) {
      throw new Error(
        'Refusing to inline TRASEQ_API_KEY into a project-scoped .mcp.json. Pass --i-know-this-is-shared if you really mean it.',
      );
    }
    warnings.push(
      'TRASEQ_API_KEY is inlined into project-scoped .mcp.json — anyone with repo access can read it.',
    );
  } else {
    warnings.push(
      `Project scope writes only the secret reference. Each contributor must run \`traseq-agent login\` to populate the keychain.`,
    );
  }
}

export class ClaudeCodeInstallWriter implements InstallWriter {
  readonly client = 'claude-code' as const;
  readonly supportedLocations = ['user', 'project'] as const;

  async detect() {
    const result = await execClaudeCli(['--version']);
    if (result.exitCode !== 0) {
      return {
        present: false,
        reason: '`claude` CLI not found on PATH. Install Claude Code first.',
      };
    }
    return { present: true };
  }

  plan(input: InstallInput): InstallPlan {
    const entry = buildEntry(input);
    const warnings: string[] = [];
    projectScopeWarnings(input, warnings);

    const writeTarget = locationConfigPath(input.target);
    return {
      target: input.target,
      serverName: input.serverName,
      entry,
      warnings,
      writeTarget,
    };
  }

  async apply(plan: InstallPlan): Promise<ApplyResult> {
    if (!plan.writeTarget) {
      throw new Error('Claude Code install plan has no write target.');
    }
    applyEntryToFile(plan.writeTarget, plan.serverName, plan.entry);
    return {
      written: true,
      writeTarget: plan.writeTarget,
      warnings: plan.warnings,
      followups: [
        'Restart or reconnect Claude Code so it picks up the new MCP server.',
      ],
    };
  }

  async remove(input: {
    target: InstallTarget;
    serverName: string;
  }): Promise<void> {
    const path = locationConfigPath(input.target);
    removeEntryFromFile(path, input.serverName);
  }
}
