import { TraseqApiError } from '@traseq/sdk';

import type { McpProfile } from './profile.js';

/**
 * Structured tool-call telemetry written to stderr.
 *
 * MCP stdio servers reserve stdout for the JSON-RPC protocol — anything
 * written to stdout corrupts the transport. Stderr is free for logs and
 * is the channel `claude mcp` and similar clients capture.
 *
 * One JSON line per call lets operators pipe into `jq`, ship to logging
 * sinks, or grep for specific patterns. Disabled by setting
 * `TRASEQ_MCP_TELEMETRY=off` so users on quieter clients can opt out.
 *
 * Intentionally schema-stable: adding a field is fine, renaming is not.
 * Downstream dashboards key off `event` + `tool`.
 */

export type ToolCallOutcome =
  | { kind: 'success' }
  | { kind: 'preflight_blocked'; code: string }
  | { kind: 'augmented_error'; hintCode: string | null }
  | { kind: 'api_error'; status: number; category?: string; code?: string }
  | { kind: 'runtime_error'; message: string };

export interface ToolCallEvent {
  readonly event: 'tool_call';
  readonly ts: string;
  readonly tool: string;
  readonly profile: McpProfile;
  readonly durationMs: number;
  readonly outcome: ToolCallOutcome;
}

function telemetryEnabled(): boolean {
  const value = process.env.TRASEQ_MCP_TELEMETRY;
  return value !== 'off' && value !== '0' && value !== 'false';
}

export function emitToolCallEvent(event: ToolCallEvent): void {
  if (!telemetryEnabled()) return;
  try {
    process.stderr.write(`${JSON.stringify(event)}\n`);
  } catch {
    // Telemetry must never break the tool path — swallow EPIPE / EAGAIN.
  }
}

export function classifyError(error: unknown): ToolCallOutcome {
  if (error instanceof TraseqApiError) {
    const category = error.publicAgent?.category;
    // `publicAgent.code` is the preferred public contract; fall back to the
    // body-level `errorCode` so backend i18n / domain codes still flow into
    // telemetry when the publicAgent envelope is missing.
    const code =
      error.publicAgent?.code ??
      (typeof error.parsedBody?.errorCode === 'string'
        ? error.parsedBody.errorCode
        : undefined);
    return {
      kind: 'api_error',
      status: error.status,
      ...(category !== undefined ? { category } : {}),
      ...(code !== undefined ? { code } : {}),
    };
  }
  return {
    kind: 'runtime_error',
    message: error instanceof Error ? error.message : String(error),
  };
}
