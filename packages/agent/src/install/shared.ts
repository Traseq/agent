import { formatSecretRef, type SecretRef } from '../secrets/index.js';

import { packagePin } from './version.js';
import type { InstallInput, McpServerEntry } from './types.js';

export const DEFAULT_SERVER_NAME = 'traseq';
export const DEFAULT_BASE_URL = 'https://api.traseq.com';
export const REDACTED_SECRET = '<redacted>';
export const TRASEQ_AGENT_BIN = 'traseq-agent';

export const TRASEQ_API_KEY_REF_ENV = 'TRASEQ_API_KEY_REF';
export const TRASEQ_API_KEY_ENV = 'TRASEQ_API_KEY';

export function buildEntry(input: InstallInput): McpServerEntry {
  const env: Record<string, string> = {
    TRASEQ_BASE_URL: input.baseUrl || DEFAULT_BASE_URL,
  };
  if (input.inline !== undefined && input.inline.length > 0) {
    env[TRASEQ_API_KEY_ENV] = input.inline;
  } else {
    env[TRASEQ_API_KEY_REF_ENV] = formatSecretRef(input.secretRef);
  }

  const args = [
    '-y',
    '--package',
    packagePin(input.packageVersion),
    TRASEQ_AGENT_BIN,
    'mcp',
  ];
  // Only emit `--profile=full` explicitly. The `guided` profile is the runtime
  // default, so omitting the flag keeps the entry compatible with older pinned
  // versions of @traseq/agent that do not parse `--profile`.
  if (input.profile === 'full') {
    args.push('--profile=full');
  }
  return {
    command: 'npx',
    args,
    env,
  };
}

export function redactEntry(entry: McpServerEntry): McpServerEntry {
  const redactedEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(entry.env)) {
    if (key === TRASEQ_API_KEY_ENV) {
      redactedEnv[key] = REDACTED_SECRET;
    } else {
      redactedEnv[key] = value;
    }
  }
  return { ...entry, env: redactedEnv };
}

export function summarizeSecret(
  ref: SecretRef,
  inline: string | undefined,
): string {
  if (inline !== undefined && inline.length > 0) {
    return `inline plaintext (${inline.length} chars)`;
  }
  return formatSecretRef(ref);
}
