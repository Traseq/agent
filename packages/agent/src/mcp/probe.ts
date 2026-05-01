import { TRASEQ_API_KEY_SETUP_URL } from '../env.js';

export const REQUIRED_GUIDED_SCOPES = [
  'workspace_read',
  'strategies_write',
  'backtests_read',
  'backtests_write',
];

export interface McpProbeClient {
  getManifest(): Promise<unknown>;
  getWorkspaceContext(): Promise<unknown>;
  getUsage(): Promise<unknown>;
  getCapabilities(): Promise<unknown>;
}

export interface McpProbeResult {
  ok: boolean;
  workspace: string;
  tier: string;
  scopes: string[];
  missingScopes: string[];
  checks: string[];
  nextSteps: string[];
  raw: {
    manifest: unknown;
    workspace: unknown;
    usage: unknown;
    capabilities: unknown;
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readWorkspaceName(value: unknown): string {
  const root = isObject(value) ? value : {};
  const workspace = isObject(root.workspace) ? root.workspace : {};
  return (
    stringValue(workspace.name) ??
    stringValue(workspace.slug) ??
    stringValue(workspace.id) ??
    'unknown workspace'
  );
}

function readTier(value: unknown): string {
  const root = isObject(value) ? value : {};
  const subscription = isObject(root.subscription) ? root.subscription : {};
  return (
    stringValue(subscription.plan) ??
    stringValue(subscription.tier) ??
    stringValue(root.subscriptionTier) ??
    'unknown'
  );
}

function readScopes(value: unknown): string[] {
  const root = isObject(value) ? value : {};
  const apiKey = isObject(root.apiKey) ? root.apiKey : {};
  return Array.isArray(apiKey.scopes)
    ? apiKey.scopes.filter(
        (scope): scope is string => typeof scope === 'string',
      )
    : [];
}

export async function probeTraseqMcpSetup(options: {
  client: McpProbeClient;
}): Promise<McpProbeResult> {
  const [manifest, workspace, usage, capabilities] = await Promise.all([
    options.client.getManifest(),
    options.client.getWorkspaceContext(),
    options.client.getUsage(),
    options.client.getCapabilities(),
  ]);
  const scopes = readScopes(workspace);
  const missingScopes = REQUIRED_GUIDED_SCOPES.filter(
    (scope) => !scopes.includes(scope),
  );

  return {
    ok: missingScopes.length === 0,
    workspace: readWorkspaceName(workspace),
    tier: readTier(workspace),
    scopes,
    missingScopes,
    checks: [
      'manifest reachable',
      'workspace context readable',
      'usage readable',
      'capabilities readable',
    ],
    nextSteps:
      missingScopes.length === 0
        ? [
            'MCP setup is ready for guided research.',
            'Ask your client to start with `start_research_engagement`.',
          ]
        : [
            `Add missing API key scopes: ${missingScopes.join(', ')}`,
            `Open API key settings: ${TRASEQ_API_KEY_SETUP_URL}`,
          ],
    raw: {
      manifest,
      workspace,
      usage,
      capabilities,
    },
  };
}
