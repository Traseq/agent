import { spawn } from 'node:child_process';

import { buildEntry } from './shared.js';
import type {
  ApplyResult,
  InstallInput,
  InstallPlan,
  InstallTarget,
  InstallWriter,
} from './types.js';

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function execCodexCli(args: string[]): Promise<ExecResult> {
  return new Promise((resolveExec, reject) => {
    const child = spawn('codex', args, {
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

function envFlags(env: Record<string, string>): string[] {
  return Object.entries(env).flatMap(([key, value]) => [
    '--env',
    `${key}=${value}`,
  ]);
}

function locationCheck(target: InstallTarget): string[] {
  if (target.location !== 'user') {
    return [
      `Codex MCP config is user-scoped; ignoring location \`${target.location}\` and writing to user config.`,
    ];
  }
  return [];
}

export class CodexInstallWriter implements InstallWriter {
  readonly client = 'codex' as const;
  readonly supportedLocations = ['user'] as const;

  async detect() {
    const result = await execCodexCli(['--version']);
    if (result.exitCode !== 0) {
      return {
        present: false,
        reason: '`codex` CLI not found on PATH. Install Codex first.',
      };
    }
    return { present: true };
  }

  plan(input: InstallInput): InstallPlan {
    const entry = buildEntry(input);
    const warnings = locationCheck(input.target);
    const addCommand = [
      'codex',
      'mcp',
      'add',
      input.serverName,
      ...envFlags(entry.env),
      '--',
      entry.command,
      ...entry.args,
    ];
    return {
      target: input.target,
      serverName: input.serverName,
      entry,
      warnings,
      shellCommands: [addCommand],
    };
  }

  async apply(plan: InstallPlan): Promise<ApplyResult> {
    const cmd = plan.shellCommands?.[0];
    if (!cmd) {
      throw new Error('Codex install plan has no shell command.');
    }
    const detect = await this.detect();
    if (!detect.present) {
      throw new Error(detect.reason ?? '`codex` CLI not found.');
    }
    const result = await execCodexCli(cmd.slice(1));
    if (result.exitCode !== 0) {
      throw new Error(
        `codex mcp add failed (exit ${result.exitCode}): ${
          result.stderr.trim() || result.stdout.trim()
        }`,
      );
    }
    return {
      written: true,
      warnings: plan.warnings,
      followups: ['Restart Codex if it was already running.'],
    };
  }

  async remove(input: {
    target: InstallTarget;
    serverName: string;
  }): Promise<void> {
    const detect = await this.detect();
    if (!detect.present) {
      return;
    }
    await execCodexCli(['mcp', 'remove', input.serverName]);
  }
}
