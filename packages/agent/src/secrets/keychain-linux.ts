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

export class LinuxKeychainStore implements SecretStore {
  readonly kind = 'keychain-linux' as const;

  async available(): Promise<SecretStoreAvailability> {
    const result = await exec('which', ['secret-tool']);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        reason:
          '`secret-tool` not found on PATH. Install with `apt install libsecret-tools` (Debian/Ubuntu), `dnf install libsecret` (Fedora), or `pacman -S libsecret` (Arch).',
      };
    }
    return { ok: true };
  }

  async set(service: string, account: string, value: string): Promise<void> {
    const result = await exec(
      'secret-tool',
      [
        'store',
        '--label',
        `${service} ${account}`,
        'service',
        service,
        'account',
        account,
      ],
      { input: value },
    );
    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to write secret-tool entry: ${result.stderr.trim() || result.stdout.trim()}`,
      );
    }
  }

  async get(service: string, account: string): Promise<string | undefined> {
    const result = await exec('secret-tool', [
      'lookup',
      'service',
      service,
      'account',
      account,
    ]);
    if (result.exitCode !== 0) {
      const text = `${result.stdout}${result.stderr}`.toLowerCase();
      if (text.includes('no matching') || text.length === 0) {
        return undefined;
      }
      throw new Error(
        `Failed to read secret-tool entry: ${result.stderr.trim() || result.stdout.trim()}`,
      );
    }
    if (result.stdout.length === 0) {
      return undefined;
    }
    return result.stdout.replace(/\n$/, '');
  }

  async delete(service: string, account: string): Promise<void> {
    const result = await exec('secret-tool', [
      'clear',
      'service',
      service,
      'account',
      account,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to clear secret-tool entry: ${result.stderr.trim() || result.stdout.trim()}`,
      );
    }
  }
}
