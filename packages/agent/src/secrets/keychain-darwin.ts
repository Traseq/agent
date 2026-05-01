import { spawn, type SpawnOptions } from 'node:child_process';

import type { SecretStore, SecretStoreAvailability } from './index.js';

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function exec(
  command: string,
  args: string[],
  options: { input?: string } = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const spawnOptions: SpawnOptions = {
      stdio: ['pipe', 'pipe', 'pipe'],
    };
    const child = spawn(command, args, spawnOptions);
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
      resolve({ exitCode: exitCode ?? -1, stdout, stderr });
    });
    if (options.input !== undefined) {
      child.stdin?.write(options.input);
    }
    child.stdin?.end();
  });
}

export class DarwinKeychainStore implements SecretStore {
  readonly kind = 'keychain-darwin' as const;

  async available(): Promise<SecretStoreAvailability> {
    if (process.platform !== 'darwin') {
      return { ok: false, reason: 'Not running on macOS.' };
    }
    const result = await exec('which', ['security']);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        reason:
          'macOS `security` command not found on PATH. Run `xcode-select --install` to install command-line tools.',
      };
    }
    return { ok: true };
  }

  async set(service: string, account: string, value: string): Promise<void> {
    const result = await exec('security', [
      'add-generic-password',
      '-U',
      '-s',
      service,
      '-a',
      account,
      '-w',
      value,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to write keychain entry: ${result.stderr.trim() || result.stdout.trim()}`,
      );
    }
  }

  async get(service: string, account: string): Promise<string | undefined> {
    const result = await exec('security', [
      'find-generic-password',
      '-s',
      service,
      '-a',
      account,
      '-w',
    ]);
    if (result.exitCode === 44 || result.exitCode === 1) {
      return undefined;
    }
    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to read keychain entry: ${result.stderr.trim() || result.stdout.trim()}`,
      );
    }
    return result.stdout.replace(/\n$/, '');
  }

  async delete(service: string, account: string): Promise<void> {
    const result = await exec('security', [
      'delete-generic-password',
      '-s',
      service,
      '-a',
      account,
    ]);
    if (result.exitCode === 44) {
      return;
    }
    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to delete keychain entry: ${result.stderr.trim() || result.stdout.trim()}`,
      );
    }
  }
}
