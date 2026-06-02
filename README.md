# Traseq Agent

Open-source TypeScript SDK and AI agent toolkit for building agents that research, author, and backtest quantitative trading strategies on [Traseq](https://traseq.com).

These packages provide the programmatic interface to the full Traseq strategy lifecycle — draft, validate, persist, backtest, analyze, iterate — via a typed REST client, MCP tools, or CLI commands. They ship no AI provider dependency, no live trading execution, and no heavy runtime dependencies. Your agent or LLM supplies the reasoning; Traseq handles the infrastructure.

## Features

- **Zero-dependency TypeScript SDK** — 46 typed API operations with built-in retry, timeout, and polling helpers
- **MCP server** — expose all tools to Claude Desktop, Claude Code, Cursor, or any MCP-compatible host
- **CLI** — inspect context, run individual tools, score backtests, and generate research briefs from the terminal
- **5 strategy templates** — trend-following, mean-reversion, breakout, momentum, and pattern-based — each a valid signalGraph draft ready to backtest
- **7 reference documents** — indicator guide (60+ indicators), node kinds, strategy composition rules, backtest configuration, results interpretation, iteration playbook, domain constants
- **Backtest scoring** — 6-dimensional composite score (return, Sharpe, profit factor, drawdown, consistency, activity) for consistent iteration comparison
- **Research workflow** — 7-phase recommended sequence (discover, seed, author, persist, backtest, analyze, iterate)
- **Agent context assembler** — composable skill + tools + references + templates context for LLM system prompts

## Prerequisites

1. Sign up at [traseq.com](https://traseq.com) and create a workspace
2. Go to **Settings > API Keys** and create a key with the scopes your workflow needs
3. Copy the key — it is shown only once
4. Set the environment variable:

```sh
export TRASEQ_API_KEY="trsq_..."
```

> **Security**: never paste API keys directly into AI prompts. Use environment variables or a `.env` file.

<details>
<summary>API key scopes reference</summary>

| Scope                    | Enables                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `workspace_read`         | Workspace context, usage, capabilities                                                       |
| `system_strategies_read` | Listing and reading system strategy templates                                                |
| `strategies_read`        | Reading workspace strategies and versions                                                    |
| `strategies_write`       | Validating, creating, updating, finalizing, archiving, restoring, deleting strategy versions |
| `backtests_read`         | Listing and reading backtests and progress                                                   |
| `backtests_write`        | Running, setting primary, and deleting backtests                                             |
| `analysis_runs_read`     | Listing and reading analysis runs                                                            |
| `analysis_runs_write`    | Previewing, creating, updating, and deleting robustness analysis runs                        |
| `comparison_sets_read`   | Listing and reading comparison sets                                                          |
| `comparison_sets_write`  | Creating, updating, and deleting comparison sets                                             |
| `blocks_read`            | Listing and reading reusable blocks                                                          |
| `blocks_write`           | Creating, updating, deleting, pinning, and unpinning reusable blocks                         |

Write scopes require the corresponding read scope when keys are created in the Traseq app.

</details>

## Getting Started

### Install

```sh
npm install @traseq/sdk @traseq/agent
```

Requires Node.js 20 or newer.

### SDK Client

```ts
import { TraseqClient } from '@traseq/sdk';

const client = new TraseqClient({
  baseUrl: 'https://api.traseq.com',
  apiKey: process.env.TRASEQ_API_KEY!,
});

const ctx = await client.getWorkspaceContext();
console.log(ctx.workspace.name, ctx.grantedScopes);
```

### MCP Server

The MCP server exposes all 46 platform tools to any MCP-compatible AI host. Add this to your MCP configuration:

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "traseq": {
      "command": "traseq-agent-mcp",
      "env": {
        "TRASEQ_API_KEY": "trsq_..."
      }
    }
  }
}
```

**Claude Code** (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "traseq": {
      "command": "traseq-agent-mcp",
      "env": {
        "TRASEQ_API_KEY": "trsq_..."
      }
    }
  }
}
```

Or run without installing globally:

```json
{
  "mcpServers": {
    "traseq": {
      "command": "npx",
      "args": ["-y", "@traseq/agent", "mcp"],
      "env": {
        "TRASEQ_API_KEY": "trsq_..."
      }
    }
  }
}
```

### CLI

```sh
# Verify environment and API key
traseq-agent check-env

# List all available platform tools
traseq-agent tools

# Run a single tool
traseq-agent run --tool get_workspace_context

# Generate a research brief for an external agent
traseq-agent research --prompt "Build a BTCUSDT 4h trend-following strategy"
```

## Usage Examples

### Validate a strategy draft

Call `validateStrategy` to check a signalGraph payload before persisting. The response includes structured issues with `code`, `path`, `message`, and `suggestion` for each problem.

```ts
const validation = await client.validateStrategy({
  signalGraph: {
    protocol: 'traseq.signal-graph',
    version: 2,
    nodes: [
      { id: 'close_price', kind: 'market', field: 'close' },
      {
        id: 'ema_100',
        kind: 'indicator',
        indicator: 'ema',
        args: { length: 100 },
      },
      {
        id: 'rsi_14',
        kind: 'indicator',
        indicator: 'rsi',
        args: { length: 14 },
      },
      {
        id: 'trend_ok',
        kind: 'compare',
        op: 'gt',
        left: { ref: 'close_price' },
        right: { ref: 'ema_100' },
      },
      {
        id: 'momentum_reclaim',
        kind: 'cross',
        op: 'cross_up',
        left: { ref: 'rsi_14' },
        right: { const: 45 },
      },
      {
        id: 'entry_trigger',
        kind: 'all',
        items: [{ ref: 'trend_ok' }, { ref: 'momentum_reclaim' }],
      },
    ],
    strategy: {
      kind: 'strategy',
      entry: {
        kind: 'entry',
        trigger: { ref: 'entry_trigger' },
        action: { side: 'long', sizing: { mode: 'percent_equity', value: 10 } },
      },
      risk: { stopLoss: { mode: 'percent', value: 2 } },
    },
  },
  settings: { positionStyle: 'single', warmupPeriod: 200 },
});

if (!validation.valid) {
  console.error('Issues:', validation.issues);
}
```

### Full lifecycle: create, finalize, backtest, and poll

<details>
<summary>Expand example</summary>

```ts
import { TraseqClient } from '@traseq/sdk';

const client = new TraseqClient({
  baseUrl: 'https://api.traseq.com',
  apiKey: process.env.TRASEQ_API_KEY!,
});

// 1. Create a strategy with a validated signalGraph payload
const { id: strategyId, versions } = await client.createStrategy({
  name: 'EMA Trend Follow + RSI Reclaim',
  signalGraph: validatedSignalGraph,
  settings: { positionStyle: 'single', warmupPeriod: 200 },
});

const version = versions[0].version;

// 2. Finalize the version to lock it for backtesting
await client.finalizeStrategyVersion(strategyId, { version });

// 3. Run a backtest
const { id: backtestId } = await client.runBacktest({
  strategyVersionId: `${strategyId}:${version}`,
  config: {
    timeframe: '4h',
    signalInstrument: { symbol: 'BTCUSDT' },
    initialBalance: 10_000,
  },
});

// 4. Poll until completion (handles all terminal statuses)
const result = await client.waitForBacktestCompletion(backtestId, {
  intervalMs: 3_000,
  timeoutMs: 300_000,
  onPoll: (detail) => console.log(`Status: ${detail.status}`),
});

console.log('Return:', result.summaryJson?.returnPct);
console.log('Sharpe:', result.summaryJson?.sharpeRatio);
console.log('Max Drawdown:', result.summaryJson?.maxDrawdown);
```

</details>

### Use a built-in template

Each template includes a complete signalGraph draft, thesis, and adaptation hints.

```ts
import { templates } from '@traseq/agent/templates';

const template = templates.byId('trend-following');
console.log(template.name); // 'EMA Trend Follow + RSI Reclaim'
console.log(template.thesis); // 'In a sustained uptrend, price pulls back...'

// Use the template draft directly with the API
const validation = await client.validateStrategy({
  signalGraph: template.draft.signalGraph,
  settings: template.draft.settings,
});
```

| Template ID       | Strategy                       |
| ----------------- | ------------------------------ |
| `trend-following` | EMA Trend Follow + RSI Reclaim |
| `mean-reversion`  | Bollinger-style Mean Reversion |
| `breakout`        | Breakout                       |
| `momentum`        | Momentum                       |
| `pattern-based`   | Pattern-based                  |

### Score a completed backtest

The scoring system provides a consistent basis for comparing strategy iterations within a research session. Scores are not predictions of future performance.

```ts
import { buildScoreBreakdown } from '@traseq/agent';

const backtest = await client.getBacktest(backtestId);
const score = buildScoreBreakdown(backtest.summaryJson);

console.log(`Composite score: ${score.total}`);
console.log(`Notes: ${score.notes.join('; ')}`);
// Components: returnScore, sharpeScore, profitFactorScore,
//             drawdownPenalty, consistencyScore, activityScore
```

### Generate a research brief

`runResearch` reads live workspace context and returns ready-made LLM prompts and a recommended workflow. It does not call any AI provider — your agent uses the output to drive the workflow.

```ts
import { runResearch } from '@traseq/agent/research';

const brief = await runResearch({
  prompt: 'Build a BTCUSDT 4h trend-following strategy with a 2% stop loss',
  instrument: 'BTCUSDT',
  timeframe: '4h',
  rounds: 2,
});

// brief.prompts.authoring       — system prompt for first strategy draft
// brief.prompts.revision        — system prompt for iteration after backtest
// brief.recommendedWorkflow     — 7-phase tool sequence
// brief.live.workspace          — live workspace context and scopes
// brief.live.capabilitySummary  — indicator count, node kinds, limits
```

### Dynamic tool dispatch

`runPlatformTool` dispatches any of the 46 platform operations by name. This is the same function the MCP server uses internally. Destructive operations require `confirm: true`.

```ts
import { TraseqClient, runPlatformTool } from '@traseq/agent';

const client = new TraseqClient({
  baseUrl: 'https://api.traseq.com',
  apiKey: process.env.TRASEQ_API_KEY!,
});

const context = await runPlatformTool(client, 'get_workspace_context');
const capabilities = await runPlatformTool(client, 'get_capabilities');

// Destructive operations require explicit confirmation
await runPlatformTool(client, 'delete_backtest', {
  backtestId: 'abc-123',
  confirm: true,
});
```

### Build a system prompt with agent context

`getAgentContext` assembles composable sections into a single string for your LLM's system prompt.

```ts
import { getAgentContext } from '@traseq/agent';

// Full context: skill guidance + tool schemas + references + templates
const systemPrompt = getAgentContext();

// Or select specific sections
const minimal = getAgentContext({ sections: ['skill', 'tools'] });
const refs = getAgentContext({ sections: ['references'] });
```

## Architecture

```
                Your AI Agent / LLM
                       |
        +--------------+--------------+
        |                             |
  MCP transport                 Direct import
  (traseq-agent-mcp)           (@traseq/agent)
        |                             |
        +-----------+-----------------+
                    |
             runPlatformTool()
                    |
             @traseq/sdk (TraseqClient)
                    |
              Traseq Public API
```

### Packages

| Package                            | Purpose                                                         | When to use                                                        |
| ---------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| [`@traseq/sdk`](packages/sdk/)     | HTTP client, types, schema validation                           | Direct API access, custom agents, building your own tooling        |
| [`@traseq/agent`](packages/agent/) | SDK + MCP server, CLI, templates, references, scoring, research | AI agent workflows, Claude/Cursor integration, research automation |

### 7-Phase Workflow

| Phase        | Key Tools                                                                         | Goal                                                    |
| ------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Discover** | `get_workspace_context`, `get_usage`, `get_capabilities`                          | Understand auth, limits, and live authoring contract    |
| **Seed**     | `list_system_strategies`, `list_blocks`                                           | Find templates and reusable blocks that match the brief |
| **Author**   | `validate_strategy`, `validate_conflicts`                                         | Draft and repair before persisting                      |
| **Persist**  | `create_strategy`, `finalize_strategy_version`                                    | Lock the version for backtesting                        |
| **Backtest** | `run_backtest`, `wait_backtest`                                                   | Run simulation and wait for terminal results            |
| **Analyze**  | `get_backtest_chart_data`, `preview_robustness_analysis`, `create_comparison_set` | Inspect evidence and stress test                        |
| **Iterate**  | `update_strategy_version`, `finalize_strategy_version`, `run_backtest`            | Focused revisions, one change at a time                 |

## Safety and Guardrails

- Always call `get_capabilities` before authoring strategy payloads — the live capabilities document is the canonical contract, not example code
- Always call `validate_strategy` before `create_strategy`, `update_strategy_version`, or `finalize_strategy_version`
- Always call `get_usage` before write or backtest workflows so the agent can check credit balance and hard limits
- Destructive tools (`delete_backtest`, `delete_strategy_version`, `delete_analysis_run`, etc.) require `confirm: true` — both the SDK and MCP server enforce this
- `@traseq/agent` does not call any AI provider and does not place live trades — it is a research and authoring interface only
- Backtest results are historical simulations. They do not predict future performance.

<details>
<summary>Full API reference (46 operations)</summary>

### Workspace

`get_manifest` · `get_health` · `get_workspace_context` · `get_usage` · `get_capabilities`

### System Strategies

`list_system_strategies` · `get_system_strategy` · `copy_system_strategy`

### Strategies

`validate_strategy` · `create_strategy` · `list_strategies` · `get_strategy` · `update_strategy` · `validate_conflicts`

### Strategy Versions

`create_strategy_version` · `get_strategy_version` · `update_strategy_version` · `finalize_strategy_version` · `delete_strategy_version` · `archive_strategy_version` · `restore_strategy_version`

### Backtests

`run_backtest` · `list_backtests` · `get_backtest` · `get_backtest_progress` · `get_backtest_chart_data` · `get_backtest_price_preview` · `set_primary_backtest` · `delete_backtest` · `wait_backtest`

### Analysis Runs

`preview_robustness_analysis` · `create_robustness_analysis` · `list_analysis_runs` · `get_analysis_run` · `update_analysis_run` · `delete_analysis_run` · `wait_analysis_run`

### Comparison Sets

`list_comparison_sets` · `get_comparison_set` · `create_comparison_set` · `update_comparison_set` · `delete_comparison_set`

### Blocks

`list_blocks` · `get_block` · `create_block` · `update_block` · `delete_block` · `pin_block` · `unpin_block`

</details>

## Documentation

- [`packages/sdk/README.md`](packages/sdk/) — SDK client detailed API docs
- [`packages/agent/README.md`](packages/agent/) — Agent kit detailed API docs
- [docs.traseq.com](https://docs.traseq.com) — Guides, tutorials, and core concepts
- [API reference](https://docs.traseq.com/api-reference/overview) — OpenAPI reference and authentication guide
- [traseq.com](https://traseq.com) — Platform

## Development

```sh
pnpm install
pnpm run build
pnpm run test
```

## License

MIT
