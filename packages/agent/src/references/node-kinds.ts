export const NODE_KINDS_REFERENCE = `\
# SignalGraph Node Kinds Reference

The signalGraph protocol (v2) supports 22 node kinds. Each node has an \`id\`,
a \`kind\`, and kind-specific fields. Nodes reference each other via
\`{ ref: "<node-id>" }\`.

**Field naming**: capabilities expose two related shapes — node *fields* are
the top-level configurable attributes of a node (e.g. \`field\`, \`length\`,
\`offset\`, \`op\`, \`name\`); indicator *args* live under a node's \`args\` object
and come from \`capabilities.indicators[].args\`. Multi-output indicators carry
the selector at top-level \`output\` (from \`capabilities.indicators[].output\`),
not inside \`args\`.

Nodes are divided into two categories:
- **Value nodes** produce a numeric series (used as inputs to comparisons).
- **Bool nodes** produce true/false signals (used as triggers and filters).

---

## Value Nodes

### const
A fixed numeric constant.
\`\`\`json
{ "id": "my_const", "kind": "const", "value": 50 }
\`\`\`

### market
A candle field from the price data.
- \`field\`: open | high | low | close | hl2 | hlc3 | ohlc4 | typical | median | volume
- \`timeframe\` (optional): override the backtest timeframe for multi-timeframe analysis
- \`offset\` (optional): number of bars to look back (0 = current bar)
\`\`\`json
{ "id": "close_price", "kind": "market", "field": "close" }
\`\`\`

### indicator
A technical indicator computation.
- \`indicator\`: the indicator ID from the capabilities catalog (e.g. "ema", "rsi", "macd")
- \`args\`: indicator-specific arguments from \`capabilities.indicators[].args\`
- \`args.source\` (optional): market field such as "close" or "hl2" when the indicator supports it
- \`output\` (optional/required by some indicators): selector from \`capabilities.indicators[].output\`
\`\`\`json
{ "id": "ema_100", "kind": "indicator", "indicator": "ema", "args": { "length": 100, "source": "close" } }
\`\`\`

### state
Runtime account or position state.
- \`field\`: one of the STATE_FIELDS (e.g. "position_exists", "account_balance",
  "last_entry_price", "position_bars_since_entry")
\`\`\`json
{ "id": "entry_px", "kind": "state", "field": "last_entry_price" }
\`\`\`

### rolling
Aggregate a value series over a lookback window.
- \`op\`: max | min | sum | avg
- \`source\`: { ref: "<value-node>" }
- \`period\`: number of bars
\`\`\`json
{ "id": "highest_20", "kind": "rolling", "op": "max", "source": { "ref": "close_price" }, "period": 20 }
\`\`\`

### math
Arithmetic operation on one or two values.
- \`op\`: add | sub | mul | div | abs | min | max | pow | log | sqrt
- \`args\`: array of { ref } or { const } — 1 arg for unary ops, 2 for binary ops
\`\`\`json
{ "id": "spread", "kind": "math", "op": "sub", "args": [{ "ref": "ema_20" }, { "ref": "ema_50" }] }
\`\`\`

### capture
Captures a value at the moment a condition becomes true.
- \`value\`: { ref: "<value-node>" } — the value to capture
- \`when\`: { ref: "<bool-node>" } — the triggering condition
\`\`\`json
{ "id": "entry_rsi", "kind": "capture", "value": { "ref": "rsi_14" }, "when": { "ref": "entry_trigger" } }
\`\`\`

### pivot
Detects swing highs or swing lows.
- \`pivotKind\`: "high" | "low"
- \`left\`: bars to the left for confirmation
- \`right\`: bars to the right for confirmation
- \`select\` (optional): "last" | "prev"
\`\`\`json
{ "id": "swing_low", "kind": "pivot", "pivotKind": "low", "left": 5, "right": 5, "select": "last" }
\`\`\`

### pivot_meta
Metadata about recent pivots.
- \`metric\`: "bars_since_last_pivot" | "bars_between_last_two_pivots" | "last_pivot_index"
- \`pivotKind\`: "high" | "low"
- \`left\`, \`right\`: pivot confirmation windows
\`\`\`json
{ "id": "bars_since_low", "kind": "pivot_meta", "metric": "bars_since_last_pivot", "pivotKind": "low", "left": 5, "right": 5 }
\`\`\`

---

## Bool Nodes

### compare
Compares two numeric values.
- \`op\`: gt | lt | gte | lte | eq | neq
- \`left\`: { ref } or { const }
- \`right\`: { ref } or { const }
\`\`\`json
{ "id": "trend_ok", "kind": "compare", "op": "gt", "left": { "ref": "close_price" }, "right": { "ref": "ema_100" } }
\`\`\`

### cross
Detects when one series crosses another.
- \`op\`: cross_up | cross_down
- \`left\`: { ref: "<value-node>" }
- \`right\`: { ref: "<value-node>" } or { const: number }
\`\`\`json
{ "id": "rsi_reclaim", "kind": "cross", "op": "cross_up", "left": { "ref": "rsi_14" }, "right": { "const": 30 } }
\`\`\`

### between
Checks if a value is within a range.
- \`value\`: { ref: "<value-node>" }
- \`lower\`: { ref } or { const }
- \`upper\`: { ref } or { const }
\`\`\`json
{ "id": "rsi_mid", "kind": "between", "value": { "ref": "rsi_14" }, "lower": { "const": 40 }, "upper": { "const": 60 } }
\`\`\`

### near
Checks if a value is near a target within a tolerance.
- \`left\`: { ref } or { const }
- \`right\`: { ref } or { const }
- \`tolerance\`: { mode: "absolute" | "percent", value: number }
\`\`\`json
{ "id": "near_vwap", "kind": "near", "left": { "ref": "close_price" }, "right": { "ref": "vwap" }, "tolerance": { "mode": "percent", "value": 0.5 } }
\`\`\`

### pattern
Detects a candlestick pattern.
- \`name\`: one of PATTERNS (e.g. "bullish_engulfing", "doji", "hammer")
\`\`\`json
{ "id": "bullish_engulf", "kind": "pattern", "name": "bullish_engulfing" }
\`\`\`

### all
Logical AND — all referenced conditions must be true.
- \`items\`: array of { ref: "<bool-node>" }
\`\`\`json
{ "id": "entry", "kind": "all", "items": [{ "ref": "trend_ok" }, { "ref": "momentum_ok" }] }
\`\`\`

### any
Logical OR — at least one referenced condition must be true.
- \`items\`: array of { ref: "<bool-node>" }
\`\`\`json
{ "id": "exit_signal", "kind": "any", "items": [{ "ref": "stop_hit" }, { "ref": "target_hit" }] }
\`\`\`

### not
Logical NOT — inverts a boolean condition.
- \`item\`: { ref: "<bool-node>" }
\`\`\`json
{ "id": "no_position", "kind": "not", "item": { "ref": "has_position" } }
\`\`\`

### time_window
True only during specific time-of-day or day-of-week windows.
- \`weekdays\` (optional): array of "Mon" | "Tue" | ... | "Sun"
- \`startHour\`, \`endHour\` (optional): 0-23 range
- \`timezone\` (optional): IANA timezone string
\`\`\`json
{ "id": "trading_hours", "kind": "time_window", "weekdays": ["Mon","Tue","Wed","Thu","Fri"], "startHour": 8, "endHour": 20 }
\`\`\`

### sequence
Multi-step condition: steps must fire in order.
- \`steps\`: array of { expr: { ref: "<bool-node>" }, minBars?, maxBars? }
  Each stage must become true within \`maxBars\` of the previous stage.
\`\`\`json
{ "id": "setup_then_trigger", "kind": "sequence", "steps": [
  { "expr": { "ref": "setup_condition" }, "maxBars": 10 },
  { "expr": { "ref": "trigger_condition" } }
] }
\`\`\`

### rolling_window
Evaluates a bool condition over a lookback window.
- \`expr\`: { ref: "<bool-node>" }
- \`window\`: number of bars
- \`mode\`: any | none | all | streak | count_gt | count_lt | count_eq
- \`value\` (required for count_* modes): number
\`\`\`json
{ "id": "rsi_os_3_of_5", "kind": "rolling_window", "expr": { "ref": "rsi_oversold" }, "window": 5, "mode": "count_gt", "value": 2 }
\`\`\`

### state_machine
Stateful trigger with a trigger condition, optional reset, and optional TTL.
- \`set\`: { ref: "<bool-node>" }
- \`reset\` (optional): { ref: "<bool-node>" }
- \`ttlBars\` (optional): auto-reset after N bars
\`\`\`json
{ "id": "armed_trigger", "kind": "state_machine", "set": { "ref": "setup_done" }, "reset": { "ref": "reset_condition" }, "ttlBars": 20 }
\`\`\`

### event
Detects discrete events like pivot confirmations.
- \`name\`: "pivot_confirmed"
- \`args\`: { pivotKind: "high" | "low", left: number, right: number, timeframe? }
\`\`\`json
{ "id": "new_swing_low", "kind": "event", "name": "pivot_confirmed", "args": { "pivotKind": "low", "left": 5, "right": 5 } }
\`\`\`

---

## Strategy Binding

The \`strategy\` object within the signalGraph defines how nodes map to trading actions.

\`\`\`json
{
  "strategy": {
    "kind": "strategy",
    "entry": {
      "kind": "entry",
      "trigger": { "ref": "<bool-node-id>" },
      "action": {
        "side": "long",
        "sizing": { "mode": "percent_equity", "value": 10 }
      }
    },
    "exits": [
      {
        "kind": "exit",
        "when": { "ref": "<bool-node-id>" },
        "action": { "mode": "percent_position", "value": 100 }
      }
    ],
    "risk": {
      "stopLoss": { "mode": "percent", "value": 2 },
      "takeProfits": [{ "triggerPercent": 6, "closePercent": 100 }],
      "trailingStop": { "distancePercent": 3, "activateAfterPercent": 2 }
    }
  }
}
\`\`\`

### entry.action fields
- \`side\`: "long" or "short"
- \`sizing.mode\`: one of ENTRY_SIZING_MODES
- \`sizing.value\`: numeric amount

### exits[].action fields
- \`mode\`: one of EXIT_SIZING_MODES
- \`value\`: numeric amount (100 for percent_position = close entire position)

### risk fields (all optional)
- \`stopLoss\`: { mode: "percent" | "fixed", value: number }
- \`takeProfits\`: array of { triggerPercent: number, closePercent: number }
- \`trailingStop\`: { distancePercent: number, activateAfterPercent?: number }
`;
