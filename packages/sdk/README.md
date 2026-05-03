# @traseq/sdk

Low-level Traseq API client, types, and signalGraph schema validation for Node.js.

## Install

```sh
npm install @traseq/sdk
```

## Quick Start

```ts
import { TraseqClient } from '@traseq/sdk';

const client = new TraseqClient({
  apiKey: process.env.TRASEQ_API_KEY!,
  timeoutMs: 30_000,
  retry: { maxAttempts: 3, baseDelayMs: 1_000 },
});

// Workspace info
const context = await client.getWorkspaceContext();
const usage = await client.getUsage();
const capabilities = await client.getCapabilities();

// Validate a strategy payload
const validation = await client.validateStrategy({
  signalGraph: {
    protocol: 'traseq.signal-graph',
    version: 2,
    nodes: [],
    strategy: { kind: 'strategy' },
  },
  settings: { positionStyle: 'single', warmupPeriod: 200 },
});

// Run a backtest and wait for completion
const { backtestId } = await client.runBacktest({
  strategyId,
  version,
  config,
});
const result = await client.waitForBacktestCompletion(backtestId, {
  intervalMs: 2_000,
  timeoutMs: 120_000,
});
```

## API Overview

### Workspace

`getManifest()` · `getHealth()` · `getWorkspaceContext()` · `getUsage()` · `getCapabilities()`

### System Strategies

`listSystemStrategies()` · `getSystemStrategy()` · `copySystemStrategy()`

### Strategies

`validateStrategy()` · `createStrategy()` · `listStrategies()` · `getStrategy()` · `updateStrategy()`

### Strategy Versions

`createStrategyVersion()` · `getStrategyVersion()` · `updateStrategyVersion()` · `finalizeStrategyVersion()` · `deleteStrategyVersion()` · `archiveStrategyVersion()` · `restoreStrategyVersion()`

### Backtests

`runBacktest()` · `listBacktests()` · `getBacktest()` · `getBacktestProgress()` · `getBacktestPricePreview()` · `setPrimaryBacktest()` · `deleteBacktest()` · `waitForBacktestCompletion()`

### Analysis Runs

`previewRobustnessAnalysis()` · `createRobustnessAnalysis()` · `listAnalysisRuns()` · `getAnalysisRun()` · `updateAnalysisRun()` · `deleteAnalysisRun()` · `waitForAnalysisRun()`

### Comparison Sets

`listComparisonSets()` · `getComparisonSet()` · `createComparisonSet()` · `updateComparisonSet()` · `deleteComparisonSet()`

### Blocks

`listBlocks()` · `getBlock()` · `createBlock()` · `updateBlock()` · `deleteBlock()` · `pinBlock()` · `unpinBlock()`

### Schema Validation

`validateStrategyDraft()` · `buildStrategyDraftJsonSchema()` · `STRATEGY_DRAFT_JSON_SCHEMA`

## Environment Variables

| Variable         | Required | Description                           |
| ---------------- | -------- | ------------------------------------- |
| `TRASEQ_API_KEY` | Yes      | Workspace-scoped API key (`trsq_...`) |

## Error Handling

All API errors throw `TraseqApiError` with `status`, `method`, `path`,
`body`, parsed `publicAgent` metadata when Traseq returns it, and helpers that
turn runtime failures into agent-facing explanations.

```ts
import { TraseqApiError, formatTraseqAgentError } from '@traseq/sdk';

try {
  await client.getStrategy('non-existent');
} catch (err) {
  if (err instanceof TraseqApiError) {
    console.error(formatTraseqAgentError(err));
  }
}
```

## See Also

- [Root README](../../README.md) — architecture overview, getting started, and usage examples
- [`@traseq/agent`](../agent/) — MCP server, CLI, strategy templates, scoring, and research workflows built on this SDK

## License

MIT
