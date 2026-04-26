// Knowledge layer
export { getAgentContext } from './assembler.js';
export { SKILL_CONTENT } from './skill/index.js';
export { references } from './references/index.js';
export { templates } from './templates/index.js';
export { tools } from './tools/index.js';
export {
  OPERATION_REGISTRY,
  getOperationDefinition,
} from './generated/operation-registry.js';
export {
  TraseqClient,
  TraseqApiError,
  TraseqPublicApiError,
  explainTraseqError,
  formatTraseqAgentError,
  runPlatformTool,
} from './client/index.js';
export { startMcpServer } from './mcp/index.js';

// Operational layer
export { buildScoreBreakdown } from './scoring.js';
export { analyzeRound } from './analysis.js';
export { runResearch, normalizeRequest } from './research.js';
export { fetchWithRetry, type RetryOptions } from './http.js';
export { readEnv, readNumberEnv, requireEnv } from './env.js';
export {
  normalizeDraft,
  normalizeBacktest,
  normalizeValidation,
  normalizeChange,
  isJsonObject,
  asJsonObject,
  asString,
  asNumber,
  asStringArray,
  parseJsonObject,
} from './normalize.js';

// Types
export type {
  AgentContextOptions,
  SectionName,
  StrategyTemplate,
  JsonObject,
  Timeframe,
  StrategySettings,
  BacktestConfigLike,
  StrategyDraftLike,
  ValidationSummaryLike,
  ScoreBreakdown,
  ResearchChange,
  RoundAnalysis,
  AgentStepLog,
  NormalizedBacktestResult,
  ResearchRound,
  ResearchSummary,
  AutoAgentRequest,
  AutoAgentResearchResult,
  ResearchWorkflowStep,
  ResearchStreamEvent,
  EmitResearchEvent,
  AnalyzeRoundArgs,
} from './types.js';
export type {
  FetchPolicyOptions,
  FetchRetryOptions,
  TraseqClientOptions,
  PublicManifest,
  WorkspaceContext,
  WorkspaceUsageSummary,
  CapabilityDocument,
  StrategyDraft,
  BacktestConfig,
  TraseqAgentErrorExplanation,
  TraseqPublicAgentMetadata,
  TraseqPublicApiErrorBody,
} from './client/index.js';
export type {
  OperationDefinition,
  OperationName,
} from './generated/operation-registry.js';
