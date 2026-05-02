import { ClaudeCodeInstallWriter } from './claude-code.js';
import { ClaudeDesktopInstallWriter } from './claude-desktop.js';
import { CodexInstallWriter } from './codex.js';
import { FileInstallWriter } from './file.js';
import { DEFAULT_SERVER_NAME } from './shared.js';
import type {
  ClientId,
  InstallInput,
  InstallTarget,
  InstallWriter,
} from './types.js';

const WRITERS: Record<ClientId, InstallWriter> = {
  'claude-code': new ClaudeCodeInstallWriter(),
  'claude-desktop': new ClaudeDesktopInstallWriter(),
  codex: new CodexInstallWriter(),
  file: new FileInstallWriter(),
};

const VALID_CLIENTS = new Set<ClientId>([
  'claude-code',
  'claude-desktop',
  'codex',
  'file',
]);

function isClientId(value: string): value is ClientId {
  return VALID_CLIENTS.has(value as ClientId);
}

export function parseTarget(input: string): InstallTarget {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error(
      'Empty install target. Use e.g. claude-code:user, claude-desktop:user, codex:user, file:./mcp.json, or file:-.',
    );
  }
  const colon = trimmed.indexOf(':');
  if (colon <= 0) {
    throw new Error(
      `Invalid install target: ${input}. Expected <client>:<location>.`,
    );
  }
  const client = trimmed.slice(0, colon);
  const location = trimmed.slice(colon + 1);
  if (!isClientId(client)) {
    throw new Error(
      `Unknown install client: ${client}. Supported: ${[...VALID_CLIENTS].join(', ')}.`,
    );
  }
  if (location.length === 0) {
    throw new Error(
      `Install target ${input} is missing a location. Try ${client}:user.`,
    );
  }
  return { client, location, raw: trimmed };
}

export function getWriter(target: InstallTarget): InstallWriter {
  return WRITERS[target.client];
}

export function listWriters(): InstallWriter[] {
  return Object.values(WRITERS);
}

export function resolveDefaultInputs(
  target: InstallTarget,
  partial: Partial<InstallInput>,
): InstallInput {
  if (!partial.secretRef && partial.inline === undefined) {
    throw new Error(
      'InstallInput requires either secretRef or inline. Caller bug.',
    );
  }
  return {
    target,
    serverName: partial.serverName ?? DEFAULT_SERVER_NAME,
    secretRef: partial.secretRef!,
    ...(partial.inline !== undefined ? { inline: partial.inline } : {}),
    ...(partial.packageVersion !== undefined
      ? { packageVersion: partial.packageVersion }
      : {}),
    ...(partial.acknowledgeShared !== undefined
      ? { acknowledgeShared: partial.acknowledgeShared }
      : {}),
    ...(partial.profile !== undefined ? { profile: partial.profile } : {}),
  };
}

export type {
  ClientId,
  InstallInput,
  InstallPlan,
  InstallTarget,
  InstallWriter,
  McpServerEntry,
  ApplyResult,
} from './types.js';
export { DEFAULT_SERVER_NAME, DEFAULT_BASE_URL } from './shared.js';
export { redactEntry, summarizeSecret } from './shared.js';
