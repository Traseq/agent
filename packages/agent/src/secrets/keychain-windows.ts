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
      shell: false,
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

function targetName(service: string, account: string): string {
  return `${service}:${account}`;
}

function powershellGet(target: string): string[] {
  const script = [
    `$ErrorActionPreference='Stop'`,
    `$cred = Get-StoredCredential -Target "${target}" -ErrorAction SilentlyContinue`,
    `if (-not $cred) { exit 44 }`,
    `[System.Runtime.InteropServices.Marshal]::PtrToStringAuto([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($cred.Password)) | Write-Output`,
  ].join('; ');
  return ['-NoProfile', '-NonInteractive', '-Command', script];
}

export class WindowsKeychainStore implements SecretStore {
  readonly kind = 'keychain-windows' as const;

  async available(): Promise<SecretStoreAvailability> {
    if (process.platform !== 'win32') {
      return { ok: false, reason: 'Not running on Windows.' };
    }
    const cmdkey = await exec('cmdkey', ['/?']);
    if (cmdkey.exitCode !== 0) {
      return {
        ok: false,
        reason:
          '`cmdkey` not found. Windows Credential Manager is unavailable.',
      };
    }
    const ps = await exec('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      'if (Get-Module -ListAvailable -Name CredentialManager) { exit 0 } else { exit 1 }',
    ]);
    if (ps.exitCode !== 0) {
      return {
        ok: false,
        reason:
          'PowerShell `CredentialManager` module is required to read passwords. Install with `Install-Module -Name CredentialManager -Force` (run PowerShell as administrator).',
      };
    }
    return { ok: true };
  }

  async set(service: string, account: string, value: string): Promise<void> {
    const target = targetName(service, account);
    const result = await exec('cmdkey', [
      `/generic:${target}`,
      `/user:${account}`,
      `/pass:${value}`,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to store credential: ${result.stderr.trim() || result.stdout.trim()}`,
      );
    }
  }

  async get(service: string, account: string): Promise<string | undefined> {
    const target = targetName(service, account);
    const result = await exec('powershell', powershellGet(target));
    if (result.exitCode === 44) {
      return undefined;
    }
    if (result.exitCode !== 0) {
      throw new Error(
        `Failed to read credential: ${result.stderr.trim() || result.stdout.trim()}`,
      );
    }
    return result.stdout.replace(/\r?\n$/, '');
  }

  async delete(service: string, account: string): Promise<void> {
    const target = targetName(service, account);
    const result = await exec('cmdkey', [`/delete:${target}`]);
    if (result.exitCode !== 0) {
      const text = `${result.stdout}${result.stderr}`.toLowerCase();
      if (text.includes('cannot find') || text.includes('element not found')) {
        return;
      }
      throw new Error(
        `Failed to delete credential: ${result.stderr.trim() || result.stdout.trim()}`,
      );
    }
  }
}
