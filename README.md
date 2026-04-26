# Traseq Agent

Open-source packages for building AI agents that research, author, and backtest quantitative trading strategies on the [Traseq](https://traseq.com) platform.

| Package                            | Description                                                               |
| ---------------------------------- | ------------------------------------------------------------------------- |
| [`@traseq/sdk`](packages/sdk/)     | Low-level API client, types, and signalGraph schema validation            |
| [`@traseq/agent`](packages/agent/) | MCP tools, strategy templates, scoring, and research briefs for AI agents |

## Quick Start

```sh
npm install @traseq/sdk @traseq/agent
```

```ts
import { TraseqClient } from '@traseq/sdk';

const client = new TraseqClient({
  baseUrl: 'https://api.traseq.com',
  apiKey: process.env.TRASEQ_API_KEY!,
});

const context = await client.getWorkspaceContext();
```

See each package's README for detailed usage.

## Development

```sh
pnpm install
pnpm run build
pnpm run test
```

## License

MIT
