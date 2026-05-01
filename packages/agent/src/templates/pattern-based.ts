import type { StrategyTemplate } from '../types.js';

export const patternBasedTemplate: StrategyTemplate = {
  id: 'pattern-based',
  name: 'Bullish Engulfing + Trend Confirmation',
  description:
    'Enter long on bullish engulfing candlestick pattern when price is above EMA(50) confirming an uptrend. Exits after a fixed number of bars using position_bars_since_entry.',
  thesis:
    'Bullish engulfing patterns at trend-supported levels signal strong buying pressure. Combining with a trend filter ensures the pattern occurs in a favorable macro context.',
  adaptationHints: [
    'Swap bullish_engulfing for other patterns: hammer, morning_star, piercing_line.',
    'Change EMA length (20-100) for faster/slower trend confirmation.',
    'Replace time-based exit with a signal-based exit (e.g., bearish pattern).',
    'Add a support level check (close near pivot low) for higher-quality setups.',
    'Add volume spike confirmation for the pattern bar.',
  ],
  draft: {
    name: 'Bullish Engulfing + Trend Confirmation',
    description:
      'Long on bullish engulfing pattern when price is above EMA(50). Exit after 10 bars.',
    signalGraph: {
      protocol: 'traseq.signal-graph',
      version: 2,
      nodes: [
        { id: 'close_price', kind: 'market', field: 'close' },
        {
          id: 'ema_50',
          kind: 'indicator',
          indicator: 'ema',
          args: { length: 50 },
        },
        {
          id: 'bullish_engulfing',
          kind: 'pattern',
          name: 'bullish_engulfing',
        },
        {
          id: 'trend_ok',
          kind: 'compare',
          op: 'gt',
          left: { ref: 'close_price' },
          right: { ref: 'ema_50' },
        },
        {
          id: 'entry_trigger',
          kind: 'all',
          items: [{ ref: 'bullish_engulfing' }, { ref: 'trend_ok' }],
        },
        {
          id: 'bars_held',
          kind: 'state',
          field: 'position_bars_since_entry',
        },
        {
          id: 'exit_signal',
          kind: 'compare',
          op: 'gte',
          left: { ref: 'bars_held' },
          right: { const: 10 },
        },
      ],
      strategy: {
        kind: 'strategy',
        entry: {
          kind: 'entry',
          trigger: { ref: 'entry_trigger' },
          action: {
            side: 'long',
            sizing: { mode: 'percent_equity', value: 10 },
          },
        },
        exits: [
          {
            kind: 'exit',
            when: { ref: 'exit_signal' },
            action: { mode: 'percent_position', value: 100 },
          },
        ],
        risk: {
          stopLoss: { mode: 'percent', value: 2 },
          takeProfits: [{ triggerPercent: 6, closePercent: 100 }],
        },
      },
    },
    settings: {
      positionStyle: 'single',
      warmupPeriod: 100,
    },
    backtest: {
      timeframe: '4h',
      signalInstrument: { symbol: 'BTCUSDT' },
      initialBalance: 10000,
    },
  },
};
