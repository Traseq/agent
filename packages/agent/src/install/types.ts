import type { SecretRef } from '../secrets/index.js';

export type ClientId = 'claude-code' | 'claude-desktop' | 'codex' | 'file';

export interface InstallTarget {
  readonly client: ClientId;
  readonly location: string;
  readonly raw: string;
}

export interface InstallInput {
  target: InstallTarget;
  serverName: string;
  secretRef: SecretRef;
  inline?: string;
  baseUrl: string;
  packageVersion?: string;
  acknowledgeShared?: boolean;
  /** MCP server profile to write into the client config. Defaults to 'guided'. */
  profile?: 'guided' | 'full';
}

export interface McpServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface InstallPlan {
  target: InstallTarget;
  serverName: string;
  entry: McpServerEntry;
  warnings: string[];
  writeTarget?: string;
  shellCommands?: readonly string[][];
}

export interface ApplyResult {
  written: boolean;
  writeTarget?: string;
  warnings: string[];
  followups: string[];
}

export interface InstallWriter {
  readonly client: ClientId;
  readonly supportedLocations: readonly string[];
  detect(): Promise<{ present: boolean; reason?: string }>;
  plan(input: InstallInput): InstallPlan;
  apply(plan: InstallPlan): Promise<ApplyResult>;
  remove(input: { target: InstallTarget; serverName: string }): Promise<void>;
}
