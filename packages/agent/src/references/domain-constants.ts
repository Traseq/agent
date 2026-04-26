import { DOMAIN_CONSTANTS } from '../generated/constants.js';

function formatList(items: readonly string[]): string {
  return items.map((item) => `  - \`${item}\``).join('\n');
}

export const DOMAIN_CONSTANTS_REFERENCE = `\
# Domain Constants Reference

These are the canonical domain enums supported by the Traseq engine.
Only use values listed here when composing strategies.

## Market Fields
Price and volume fields available on every candle bar.
${formatList(DOMAIN_CONSTANTS.MARKET_FIELDS)}

## State Fields
Runtime account and position state available during evaluation.
${formatList(DOMAIN_CONSTANTS.STATE_FIELDS)}

## Candlestick Patterns
Recognized candlestick pattern names for pattern nodes.
${formatList(DOMAIN_CONSTANTS.PATTERNS)}

## Timeframes
Supported bar intervals.
${formatList(DOMAIN_CONSTANTS.TIMEFRAMES)}

## Entry Sizing Modes
How entry position size is calculated.
${formatList(DOMAIN_CONSTANTS.ENTRY_SIZING_MODES)}
- \`fixed\`: Fixed quantity (e.g. 0.5 BTC)
- \`fixed_cash\`: Fixed notional amount (e.g. $1000)
- \`percent_equity\`: Percentage of current equity
- \`percent_balance\`: Percentage of initial balance

## Exit Sizing Modes
How exit position size is calculated.
${formatList(DOMAIN_CONSTANTS.EXIT_SIZING_MODES)}
- \`fixed\`: Fixed quantity to close
- \`percent_position\`: Percentage of open position (100 = close all)

## Sides
${formatList(DOMAIN_CONSTANTS.SIDES)}

## Compare Operators
Used in compare nodes: left <op> right.
${formatList(DOMAIN_CONSTANTS.COMPARE_OPS)}
- \`gt\`: greater than, \`lt\`: less than
- \`gte\`: greater than or equal, \`lte\`: less than or equal
- \`eq\`: equal, \`neq\`: not equal

## Cross Operators
Used in cross nodes: left crosses right.
${formatList(DOMAIN_CONSTANTS.CROSS_OPS)}
- \`cross_up\`: left crosses above right (was below, now above)
- \`cross_down\`: left crosses below right (was above, now below)

## Rolling Operators
Aggregation functions for rolling nodes.
${formatList(DOMAIN_CONSTANTS.ROLLING_OPERATORS)}

## Rolling Window Modes
Evaluation modes for rolling_window nodes.
${formatList(DOMAIN_CONSTANTS.ROLLING_WINDOW_MODES)}
- \`any\`: condition was true at least once in the window
- \`none\`: condition was never true in the window
- \`all\`: condition was true every bar in the window
- \`streak\`: condition was true for N consecutive bars
- \`count_gt/lt/eq\`: number of true bars compared to the node's \`value\`

## Math Operators
Arithmetic operations for math nodes.
${formatList(DOMAIN_CONSTANTS.MATH_OPERATORS)}

## Conflict Policies
Priority resolution when multiple entries conflict.
${formatList(DOMAIN_CONSTANTS.CONFLICT_POLICIES)}

## Source Editors
Metadata tags indicating how the strategy was authored.
${formatList(DOMAIN_CONSTANTS.SOURCE_EDITORS)}
`;
