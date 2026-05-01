import type { StrategyTemplate } from '../types.js';

export const momentumTemplate: StrategyTemplate = {
  id: 'momentum',
  name: 'MACD + ADX Momentum',
  description:
    'Enter long when MACD crosses above signal line while ADX confirms strong trending conditions (> 25). Exits on MACD bearish cross.',
  thesis:
    'MACD bullish crossovers signal momentum shifts. Filtering by ADX > 25 ensures entries only in trending markets, avoiding choppy sideways conditions that produce false MACD signals.',
  adaptationHints: [
    'Adjust MACD parameters (fast: 8-16, slow: 21-30, signal: 7-12) for sensitivity.',
    'Change ADX threshold (20-30) — lower catches more trends, higher is stricter.',
    'Add RSI > 50 as an additional momentum confirmation.',
    'Replace MACD exit with a trailing stop to capture extended trends.',
    'Add a volume filter to confirm momentum with participation.',
  ],
  draft: {
    name: 'MACD + ADX Momentum',
    description:
      'Long on MACD bullish cross when ADX > 25. Exit on MACD bearish cross.',
    signalGraph: {
      protocol: 'traseq.signal-graph',
      version: 2,
      nodes: [
        {
          id: 'macd',
          kind: 'indicator',
          indicator: 'macd',
          args: { fast_length: 12, slow_length: 26, signal_length: 9 },
          output: 'macd',
        },
        {
          id: 'macd_signal',
          kind: 'indicator',
          indicator: 'macd',
          args: { fast_length: 12, slow_length: 26, signal_length: 9 },
          output: 'signal',
        },
        {
          id: 'adx_14',
          kind: 'indicator',
          indicator: 'adx',
          args: { length: 14 },
          output: 'adx',
        },
        {
          id: 'adx_threshold',
          kind: 'const',
          value: 25,
        },
        {
          id: 'macd_bullish',
          kind: 'cross',
          op: 'cross_up',
          left: { ref: 'macd' },
          right: { ref: 'macd_signal' },
        },
        {
          id: 'trend_strong',
          kind: 'compare',
          op: 'gt',
          left: { ref: 'adx_14' },
          right: { ref: 'adx_threshold' },
        },
        {
          id: 'entry_trigger',
          kind: 'all',
          items: [{ ref: 'macd_bullish' }, { ref: 'trend_strong' }],
        },
        {
          id: 'macd_bearish',
          kind: 'cross',
          op: 'cross_down',
          left: { ref: 'macd' },
          right: { ref: 'macd_signal' },
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
            when: { ref: 'macd_bearish' },
            action: { mode: 'percent_position', value: 100 },
          },
        ],
        risk: {
          stopLoss: { mode: 'percent', value: 2 },
        },
      },
    },
    settings: {
      positionStyle: 'single',
      warmupPeriod: 60,
    },
    backtest: {
      timeframe: '4h',
      signalInstrument: { symbol: 'BTCUSDT' },
      initialBalance: 10000,
    },
  },
};
