import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';

import { buildEntry } from './shared.js';
import type {
  ApplyResult,
  InstallInput,
  InstallPlan,
  InstallTarget,
  InstallWriter,
  McpServerEntry,
} from './types.js';

interface ClaudeDesktopConfig {
  mcpServers?: Record<string, McpServerEntry>;
  [key: string]: unknown;
}

export function claudeDesktopDefaultConfigPath(): string {
  const os = platform();
  if (os === 'darwin') {
    return join(
      homedir(),
      'Library',
      'Application Support',
      'Claude',
      'claude_desktop_config.json',
    );
  }
  if (os === 'win32') {
    const appData = process.env.APPDATA;
    if (!appData) {
      throw new Error(
        'APPDATA env var is not set; cannot locate Claude Desktop config.',
      );
    }
    return join(appData, 'Claude', 'claude_desktop_config.json');
  }
  throw new Error(
    'Claude Desktop default config path is only known for macOS and Windows. Pass an explicit path.',
  );
}

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  const raw = readFileSync(path, 'utf8');
  if (raw.trim().length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(
      `Failed to parse Claude Desktop config at ${path}: ${
        error instanceof Error ? error.message : String(error)
      }. Resolve corruption manually before retrying.`,
    );
  }
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function resolvePath(target: InstallTarget): string {
  if (target.location === 'user') {
    return claudeDesktopDefaultConfigPath();
  }
  return target.location;
}

export class ClaudeDesktopInstallWriter implements InstallWriter {
  readonly client = 'claude-desktop' as const;
  readonly supportedLocations = ['user', 'custom-path'] as const;

  async detect() {
    try {
      const path = claudeDesktopDefaultConfigPath();
      const present = existsSync(path);
      return present
        ? { present: true }
        : {
            present: false,
            reason: `Claude Desktop config not found at ${path}.`,
          };
    } catch (error) {
      return {
        present: false,
        reason:
          error instanceof Error
            ? error.message
            : 'Could not determine Claude Desktop config path.',
      };
    }
  }

  plan(input: InstallInput): InstallPlan {
    const entry = buildEntry(input);
    const warnings: string[] = [];
    if (input.inline === undefined || input.inline.length === 0) {
      warnings.push(
        'Claude Desktop does not expand ${VAR} in env values. The MCP server resolves the secret reference itself at boot, so no plaintext key is written. The keychain entry must exist before launching Claude Desktop.',
      );
    } else {
      warnings.push(
        'TRASEQ_API_KEY is inlined into the Claude Desktop config file in plaintext.',
      );
    }
    return {
      target: input.target,
      serverName: input.serverName,
      entry,
      warnings,
      writeTarget: resolvePath(input.target),
    };
  }

  async apply(plan: InstallPlan): Promise<ApplyResult> {
    if (!plan.writeTarget) {
      throw new Error('Claude Desktop install plan has no write target.');
    }
    const existing = readJson<ClaudeDesktopConfig>(plan.writeTarget) ?? {};
    const next: ClaudeDesktopConfig = {
      ...existing,
      mcpServers: {
        ...(existing.mcpServers ?? {}),
        [plan.serverName]: plan.entry,
      },
    };
    writeJson(plan.writeTarget, next);
    return {
      written: true,
      writeTarget: plan.writeTarget,
      warnings: plan.warnings,
      followups: [
        'Restart Claude Desktop completely to pick up the new MCP server.',
      ],
    };
  }

  async remove(input: {
    target: InstallTarget;
    serverName: string;
  }): Promise<void> {
    const path = resolvePath(input.target);
    const existing = readJson<ClaudeDesktopConfig>(path);
    if (
      !existing ||
      !existing.mcpServers ||
      !(input.serverName in existing.mcpServers)
    ) {
      return;
    }
    const remaining = { ...existing.mcpServers };
    delete remaining[input.serverName];
    writeJson(path, { ...existing, mcpServers: remaining });
  }
}
