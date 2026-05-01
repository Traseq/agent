import type { SecretStore, SecretStoreAvailability } from './index.js';

function envKey(service: string, account: string): string {
  return `${service.toUpperCase()}_${account.toUpperCase()}`.replace(
    /[^A-Z0-9_]/g,
    '_',
  );
}

export class EnvSecretStore implements SecretStore {
  readonly kind = 'env' as const;

  async available(): Promise<SecretStoreAvailability> {
    return { ok: true };
  }

  async set(): Promise<void> {
    throw new Error(
      'EnvSecretStore is read-only. Set the value in your shell profile or use --store=keychain.',
    );
  }

  async get(service: string, account: string): Promise<string | undefined> {
    return process.env[envKey(service, account)];
  }

  async delete(): Promise<void> {
    throw new Error(
      'EnvSecretStore is read-only. Remove the value from your shell profile manually.',
    );
  }
}
