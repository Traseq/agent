export {
  GUIDED_RESEARCH_PROMPT_DESCRIPTION,
  GUIDED_RESEARCH_PROMPT_NAME,
  MCP_SERVICE_INSTRUCTIONS,
  guidedResearchPromptText,
  startMcpServer,
} from './server.js';
export {
  MCP_CLIENTS,
  MCP_SCOPES,
  NEXT_PROMPT_DEFAULT,
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
