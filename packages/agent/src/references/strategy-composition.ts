export const STRATEGY_COMPOSITION_REFERENCE = `\
# Strategy Composition Patterns

## SignalGraph Protocol Overview

Every strategy is authored as a signalGraph v2 document:

\`\`\`json
{
  "protocol": "traseq.signal-graph",
  "version": 2,
  "nodes": [ ... ],
  "strategy": { ... }
}
\`\`\`

- **nodes**: An ordered array of computation nodes. Each has a unique \`id\` and a \`kind\`.
- **strategy**: The trading logic binding that connects nodes to entry/exit actions.

## Composition Pattern: Data → Condition → Logic → Action

A well-structured strategy follows this data flow:

1. **Data layer**: Market fields (close, volume) and indicators (ema, rsi)
2. **Condition layer**: Comparisons, crosses, patterns that produce bool signals
3. **Logic layer**: Combine conditions with all/any/not/sequence
4. **Action layer**: Strategy binding that maps combined signals to trades

Example data flow:
\`\`\`
market(close) ──┐
                ├── compare(gt) ──┐
indicator(ema) ─┘                 ├── all ── entry trigger
                                  │
indicator(rsi) ── cross(cross_up) ┘
\`\`\`

## First Draft Guidelines

When composing the first version of a strategy:

1. **Start minimal**: Use 1 primary trigger and at most 1 confirmation filter.
   More conditions = fewer trades = harder to evaluate statistically.
2. **Prefer common indicators**: EMA, RSI, MACD, ATR are well-understood and
   produce reliable signals. Exotic indicators can be added in later iterations.
3. **Ensure tradability**: The strategy must actually generate trades. A strategy
   with 5 stacked conditions will likely produce zero entries on a 4h timeframe.
4. **Use appropriate warmup**: Set warmupPeriod to at least 2× the longest
   indicator lookback. E.g., if using EMA(200), set warmupPeriod to 400+.

## Entry Composition

### Single trigger (simplest)
One condition directly triggers the entry:
\`\`\`
rsi_cross_up(30) → entry(long)
\`\`\`

### Trigger + filter
A trigger fires only when a background filter is also true:
\`\`\`
close > ema_100 (filter) AND rsi cross_up 30 (trigger) → entry(long)
\`\`\`

### Multi-phase sequence
Conditions must occur in order within a bar window:
\`\`\`
sequence.steps: [setup_condition (within 10 bars), trigger_condition] → entry(long)
\`\`\`

## Exit Composition

Every strategy should have at least one exit mechanism. In order of priority:

1. **Stop Loss** (risk rule): Protects against adverse moves. Always recommended.
   - Percent mode: exits when loss exceeds X% of entry price.

2. **Take Profit** (risk rule): Locks in gains at a target level.
   - Be careful with tight take-profits: they improve win rate but reduce
     average win size, which can hurt profit factor.

3. **Signal-based exit**: A separate bool condition triggers the exit.
   - Example: RSI < 55 (exit long when momentum fades)
   - Can be any combination of nodes, same as entry triggers.

4. **Trailing Stop** (risk rule): Follows the price with a trailing distance.
   - distancePercent: trailing distance from the best price since entry
   - activateAfterPercent: optional minimum profit % before the trail activates

Best practice: Use stop loss (always) + either take profit OR signal-based exit.

## Settings Reference

### warmupPeriod
Number of bars to skip before the strategy starts evaluating signals.
- Rule of thumb: 2× the longest indicator lookback
- Examples: EMA(100) → warmupPeriod: 200, MACD(26) → warmupPeriod: 60

### Position Style

- **single** (\`positionStyle: "single"\`): One position at a time. Simplest to
  analyze and recommended for first drafts.
- **pyramid** (\`positionStyle: "pyramid"\`, \`maxConcurrentPositions: 2-100\`):
  Multiple concurrent positions.
  Each entry trigger opens an additional position up to the limit.
- **accumulate** (\`positionStyle: "accumulate"\`): DCA-style scheduled purchases.
  Requires accumulation settings.

## Common Mistakes

1. **Dangling references**: Using \`{ ref: "some_id" }\` without defining a node
   with \`id: "some_id"\`. Always define every referenced node.

2. **Wrong output types**: Using a value node where a bool is expected (e.g.,
   putting an indicator ref directly in an \`all.items\` array). Wrap value
   comparisons in a compare or cross node first.

3. **Missing warmup**: Using EMA(200) with warmupPeriod: 0 produces garbage
   signals for the first 200 bars.

4. **Over-filtering**: Stacking 5+ conditions in the first draft. This produces
   zero trades and provides no useful feedback. Start simple, add filters in
   later iterations based on analysis.

5. **No exit mechanism**: Forgetting to include any exit. The strategy will enter
   positions but never close them, producing misleading results.

6. **Inventing field names**: Using made-up fields like \`sourceA\`, \`lhs\`, \`rhs\`,
   indicator-node \`params\`, \`conditions\`, or \`shift\` instead of the actual
   fields (\`left\`, \`right\`, \`items\`, \`args\`, \`trigger\`, \`offset\`, etc.).

7. **Referencing non-existent state**: Using \`{ ref: "entry_price" }\` as if it
   were a built-in. You must create a state node with
   \`field: "last_entry_price"\` and reference that node's ID.
`;
