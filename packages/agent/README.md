# @traseq/agent

Tool-first agent kit for Traseq strategy research.

`@traseq/agent` packages the Traseq public agent API into a Node SDK wrapper,
CLI commands, MCP tools, strategy templates, reference material, and scoring
helpers. It is designed for external agents that already have a workspace-scoped
Traseq API key.

This package does not call an AI provider and does not place live orders. Your
agent is responsible for reasoning and authoring strategy payloads; Traseq
handles validation, persistence, backtests, analysis runs, comparisons, and
reusable blocks.

## Requirements

- Node.js 18 or newer.
- A Traseq API key created from the target workspace.
- API key scopes that match the operations your agent will perform.

Set these environment variables before using CLI or MCP entrypoints:

```sh
export TRASEQ_API_KEY="trsq_..."
export TRASEQ_BASE_URL="https://api.traseq.com"
```

`TRASEQ_BASE_URL` is optional and defaults to `https://api.traseq.com`.

## Install

Inside the monorepo:

```sh
pnpm --dir packages/agent build
node packages/agent/dist/cli.js check-env
```

After publishing or installing the package:

```sh
npm install @traseq/agent
traseq-agent check-env
```

## SDK

```ts
import { TraseqClient, runPlatformTool } from '@traseq/agent';

const client = new TraseqClient({
  baseUrl: process.env.TRASEQ_BASE_URL ?? 'https://api.traseq.com',
  apiKey: process.env.TRASEQ_API_KEY!,
  timeoutMs: 30_000,
  // Retries default to GET/HEAD only to avoid duplicate writes.
  retry: { maxAttempts: 3, baseDelayMs: 1_000 },
});

const context = await client.getWorkspaceContext();
const capabilities = await client.getCapabilities();

const validation = await runPlatformTool(client, 'validate_strategy', {
  signalGraph: {
    protocol: 'traseq.signal-graph',
    version: 2,
    nodes: [],
    strategy: { kind: 'strategy' },
  },
  settings: { positionStyle: 'single', warmupPeriod: 200 },
});
```

## CLI

```sh
traseq-agent context --section skill
traseq-agent tools
traseq-agent run --tool get_workspace_context
traseq-agent run --tool get_capabilities
traseq-agent score --backtest-id <backtest-id>
traseq-agent research --prompt "Research a BTCUSDT 4h trend-following strategy"
```

The `research` command creates a live, tool-first research brief. It reads
workspace context, usage, manifest, and capabilities, then returns prompts and a
recommended workflow for the external agent.

## MCP

Run the stdio MCP server:

```sh
traseq-agent-mcp
```

Example MCP server configuration:

```json
{
  "mcpServers": {
    "traseq": {
      "command": "traseq-agent-mcp",
      "env": {
        "TRASEQ_API_KEY": "trsq_...",
        "TRASEQ_BASE_URL": "https://api.traseq.com"
      }
    }
  }
}
```

The MCP server exposes the same operation registry as the CLI. Destructive tools
require `confirm: true` before the local runner will call the API.
When Traseq returns structured Public Agent errors, the server formats the
machine-readable reason, next steps, retryability, and Traseq app links for the
calling agent.

## Agent Workflow

1. `get_manifest`: discover the API contract.
2. `get_workspace_context`: confirm workspace, key scopes, role, and tier.
3. `get_usage`: check current budget and limits.
4. `get_capabilities`: load the live strategy authoring contract.
5. `validate_strategy`: repair payload issues before writes.
6. `create_strategy` or `create_strategy_version`: persist a draft.
7. `finalize_strategy_version`: lock the version for backtesting.
8. `run_backtest` and `wait_backtest`: queue and poll results.
9. `get_backtest_chart_data`, `preview_robustness_analysis`,
   `create_comparison_set`: inspect evidence and compare revisions.

## API Key Scopes

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
| `market_read`            | Reading chart data and price previews                                                        |

Write scopes require the corresponding read scope when keys are created in the
Traseq app.

## Safety

- Always call `get_capabilities` before authoring strategy payloads.
- Always call `get_usage` before write or backtest workflows so the agent can
  see current budget and hard limits.
- Always call `validate_strategy` before create, update, or finalize.
- Keep generated strategies small enough to inspect.
- Treat backtest output as research evidence, not trading advice.
- Destructive tools require `confirm: true` and should only be used after the
  user understands the impact.

## Verification

```sh
pnpm --dir packages/sdk test
pnpm --dir packages/agent test
```

## License

MIT
