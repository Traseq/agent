import { platform } from 'node:os';

import { DarwinKeychainStore } from './keychain-darwin.js';
import { LinuxKeychainStore } from './keychain-linux.js';
import { WindowsKeychainStore } from './keychain-windows.js';

export interface SecretStoreAvailability {
  ok: boolean;
  reason?: string;
}

export interface SecretStore {
  readonly kind:
    | 'keychain-darwin'
    | 'keychain-linux'
    | 'keychain-windows'
    | 'env';
  set(service: string, account: string, value: string): Promise<void>;
  get(service: string, account: string): Promise<string | undefined>;
  delete(service: string, account: string): Promise<void>;
  available(): Promise<SecretStoreAvailability>;
}

export type SecretRef =
  | { kind: 'keychain'; service: string; account: string }
  | { kind: 'env'; name: string }
  | { kind: 'inline'; value: string };

export const DEFAULT_SECRET_REF = {
  kind: 'keychain',
  service: 'traseq',
  account: 'api-key',
} as const satisfies SecretRef;

export function formatSecretRef(ref: SecretRef): string {
  switch (ref.kind) {
    case 'keychain':
      return `keychain:${ref.service}/${ref.account}`;
    case 'env':
      return `env:${ref.name}`;
    case 'inline':
      return 'inline:<redacted>';
  }
}

export function parseSecretRef(input: string): SecretRef {
  const trimmed = input.trim();
  if (trimmed.startsWith('keychain:')) {
    const rest = trimmed.slice('keychain:'.length);
    const slash = rest.indexOf('/');
    if (slash <= 0 || slash === rest.length - 1) {
      throw new Error(
        `Invalid keychain reference: ${input}. Expected keychain:<service>/<account>.`,
      );
    }
    return {
      kind: 'keychain',
      service: rest.slice(0, slash),
      account: rest.slice(slash + 1),
    };
  }
  if (trimmed.startsWith('env:')) {
    const name = trimmed.slice('env:'.length);
    if (name.length === 0) {
      throw new Error(`Invalid env reference: ${input}. Expected env:<NAME>.`);
    }
    return { kind: 'env', name };
  }
  if (trimmed.startsWith('inline:')) {
    return { kind: 'inline', value: trimmed.slice('inline:'.length) };
  }
  throw new Error(
    `Unsupported secret reference: ${input}. Expected keychain:<service>/<account>, env:<NAME>, or inline:<value>.`,
  );
}

export function getDefaultSecretStore(): SecretStore {
  switch (platform()) {
    case 'darwin':
      return new DarwinKeychainStore();
    case 'win32':
      return new WindowsKeychainStore();
    default:
      return new LinuxKeychainStore();
  }
}

export interface ResolveOptions {
  store?: SecretStore;
  envFallback?: string;
}

export async function resolveSecretRef(
  ref: SecretRef,
  options: ResolveOptions = {},
): Promise<string> {
  switch (ref.kind) {
    case 'inline':
      return ref.value;
    case 'env': {
      const value = process.env[ref.name];
      if (!value) {
        throw new Error(
          `Secret env var ${ref.name} is not set. Run \`traseq-agent login\` or set it in your shell.`,
        );
      }
      return value;
    }
    case 'keychain': {
      const store = options.store ?? getDefaultSecretStore();
      const availability = await store.available();
      if (!availability.ok) {
        if (options.envFallback) {
          const fallback = process.env[options.envFallback];
          if (fallback) {
            return fallback;
          }
        }
        throw new Error(
          [
            `OS keychain (${store.kind}) is not available: ${
              availability.reason ?? 'unknown'
            }.`,
            `Install the platform credential helper, or run \`traseq-agent login --store=env\` to use an environment variable instead.`,
          ].join(' '),
        );
      }
      const value = await store.get(ref.service, ref.account);
      if (!value) {
        if (options.envFallback) {
          const fallback = process.env[options.envFallback];
          if (fallback) {
            return fallback;
          }
        }
        throw new Error(
          `No secret found at keychain:${ref.service}/${ref.account}. Run \`traseq-agent login\` to create it.`,
        );
      }
      return value;
    }
  }
}

export { DarwinKeychainStore } from './keychain-darwin.js';
export { LinuxKeychainStore } from './keychain-linux.js';
export { WindowsKeychainStore } from './keychain-windows.js';
export { EnvSecretStore } from './env-store.js';
