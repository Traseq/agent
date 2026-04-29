export { startMcpServer } from './server.js';
export {
  MCP_CLIENTS,
  MCP_SCOPES,
  buildClientInstallPlan,
  buildMcpServerConfig,
  formatShellCommand,
  probeTraseqMcpSetup,
  redactMcpInstallPlan,
} from './setup.js';
export type {
  McpClient,
  McpInstallPlan,
  McpInstallPlanInput,
  McpProbeClient,
  McpProbeResult,
  McpScope,
  McpServerConfig,
  McpServerConfigInput,
  McpServerEntry,
  ResolvedMcpClient,
} from './setup.js';
