export const BACKTEST_CONFIGURATION_REFERENCE = `\
# Backtest Configuration Reference

## Required Fields

Every backtest requires two fields:

| Field | Type | Example |
|-------|------|---------|
| timeframe | "15m" \\| "1h" \\| "4h" \\| "1d" | "4h" |
| signalInstrument.symbol | string | "BTCUSDT" |

## Timeframe Guidance

| Timeframe | Style | Data Density | Notes |
|-----------|-------|-------------|-------|
| 15m | Scalping / intraday | ~35,000 bars/year | Most data, most noise. Need tight stops. |
| 1h | Intraday / swing | ~8,760 bars/year | Good balance for active strategies. |
| 4h | Swing trading | ~2,190 bars/year | Standard for crypto swing strategies. Best starting point. |
| 1d | Position trading | ~365 bars/year | Least noise, fewest trades. Need longer test period. |

**Recommendation**: Start with 4h for the first backtest. Switch to 1h or 1d
in later iterations to test timeframe sensitivity.

## Initial Balance

| Field | Type | Default | Range |
|-------|------|---------|-------|
| initialBalance | number | 10,000 | 100 – 1,000,000,000 |

The initial balance affects position sizing calculations.
Use 10,000 as a standard baseline for comparable results across backtests.

## Execution Settings

### Order Roles

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| entryOrderRole | "maker" \\| "taker" | "taker" | Maker = limit order (lower fees). Taker = market order (guaranteed fill). |
| exitOrderRole | "maker" \\| "taker" | "taker" | Signal-based exits are typically taker. |
| riskOrderRole | "maker" \\| "taker" | "taker" | Stop loss and take profit are taker by nature. |

### Fee Model

The engine supports tiered maker/taker fee schedules.

\`\`\`json
{
  "feeModel": {
    "kind": "tiered_maker_taker",
    "tiers": [
      { "minCumulativeNotional": 0, "makerRate": 0.001, "takerRate": 0.001 }
    ]
  }
}
\`\`\`

Common fee presets:
- **Binance Spot baseline**: maker 0.1%, taker 0.1% (0.001)
- **Binance VIP 1**: maker 0.06%, taker 0.08%
- **Zero fees** (for initial testing): maker 0, taker 0

### Slippage Models

| Model | Fields | When to Use |
|-------|--------|-------------|
| none | \`{ kind: "none" }\` | Idealized testing (first draft). |
| fixed | \`{ kind: "fixed", unit: "bps"\\|"ticks", value: N }\` | Simple realistic testing. 5-10 bps for liquid pairs. |
| volatility_scaled | \`{ kind: "volatility_scaled", reference: "atr_pct"\\|"bar_range_pct", multiplier: N }\` | Advanced: slippage scales with market volatility. |

**Recommendation**: Use \`{ kind: "none" }\` for the first backtest to evaluate
pure signal quality. Add \`{ kind: "fixed", unit: "bps", value: 5 }\` in the
second iteration to test fee sensitivity.

## Ambiguity Resolution

When both stop loss and take profit could trigger on the same bar, the engine
needs a rule to decide which executed first.

| Mode | Description | When to Use |
|------|-------------|-------------|
| multi_resolution | Simulates all possible orderings, picks the most likely | Default. Best for realistic results. |
| pessimistic | Always assumes the worst outcome | Stress testing. Conservative estimates. |
| bar_direction | Uses the bar's direction (open vs close) to infer order | Simple heuristic. |
| distance | Chooses based on which price level is closer to open | Distance-based heuristic. |

**Recommendation**: Use \`multi_resolution\` (default) for standard backtests.
Use \`pessimistic\` when stress-testing a strategy you plan to deploy.

## Date Range

| Field | Type | Notes |
|-------|------|-------|
| range.start | integer | Starting candle index (0 = oldest available) |
| range.end | integer | Ending candle index |

If omitted, the backtest runs over all available data for the instrument/timeframe.

## Complete Configuration Example

\`\`\`json
{
  "timeframe": "4h",
  "signalInstrument": { "symbol": "BTCUSDT" },
  "initialBalance": 10000,
  "execution": {
    "entryOrderRole": "taker",
    "exitOrderRole": "taker",
    "riskOrderRole": "taker",
    "feeModel": {
      "kind": "tiered_maker_taker",
      "tiers": [
        { "minCumulativeNotional": 0, "makerRate": 0.001, "takerRate": 0.001 }
      ]
    },
    "slippage": { "kind": "fixed", "unit": "bps", "value": 5 }
  },
  "ambiguityResolution": "multi_resolution"
}
\`\`\`

## Iteration-Friendly Presets

Use these presets to structure your backtest iterations:

### Preset 1: Signal Quality (First Draft)
No fees, no slippage. Pure signal evaluation.
\`\`\`json
{
  "timeframe": "4h",
  "signalInstrument": { "symbol": "BTCUSDT" },
  "initialBalance": 10000
}
\`\`\`

### Preset 2: Market Baseline
Binance-level fees, minimal slippage.
\`\`\`json
{
  "timeframe": "4h",
  "signalInstrument": { "symbol": "BTCUSDT" },
  "initialBalance": 10000,
  "execution": {
    "feeModel": {
      "kind": "tiered_maker_taker",
      "tiers": [{ "minCumulativeNotional": 0, "makerRate": 0.001, "takerRate": 0.001 }]
    },
    "slippage": { "kind": "fixed", "unit": "bps", "value": 5 }
  }
}
\`\`\`

### Preset 3: Stress Test
Higher fees, volatility-scaled slippage, pessimistic ambiguity.
\`\`\`json
{
  "timeframe": "4h",
  "signalInstrument": { "symbol": "BTCUSDT" },
  "initialBalance": 10000,
  "execution": {
    "feeModel": {
      "kind": "tiered_maker_taker",
      "tiers": [{ "minCumulativeNotional": 0, "makerRate": 0.002, "takerRate": 0.002 }]
    },
    "slippage": { "kind": "volatility_scaled", "reference": "atr_pct", "multiplier": 0.5 }
  },
  "ambiguityResolution": "pessimistic"
}
\`\`\`
`;
