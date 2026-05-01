import type { StrategyTemplate } from '../types.js';

export const breakoutTemplate: StrategyTemplate = {
  id: 'breakout',
  name: 'Donchian Channel Breakout',
  description:
    'Enter long when price breaks above the 20-bar Donchian Channel high with ATR expansion confirming volatility. Uses a trailing stop for exit.',
  thesis:
    'Significant breakouts above a recent price range signal the start of a new trend. Volatility expansion (ATR rising) confirms the breakout is real rather than a false spike.',
  adaptationHints: [
    'Adjust Donchian length (10-55) for shorter or longer range breakouts.',
    'Change ATR comparison threshold for stricter volatility confirmation.',
    'Replace Donchian with price_channel or Keltner Channel for alternatives.',
    'Add volume confirmation (volume > 1.5× VMA) for stronger breakout signals.',
    'Add ADX > 25 filter to confirm trending conditions.',
  ],
  draft: {
    name: 'Donchian Channel Breakout',
    description:
      'Long on Donchian upper channel breakout with ATR expansion confirmation.',
    signalGraph: {
      protocol: 'traseq.signal-graph',
      version: 2,
      nodes: [
        { id: 'close_price', kind: 'market', field: 'close' },
        {
          id: 'donchian_20',
          kind: 'indicator',
          indicator: 'donchian',
          args: { length: 20 },
          output: 'upper',
        },
        {
          id: 'atr_14',
          kind: 'indicator',
          indicator: 'atr',
          args: { length: 14 },
        },
        {
          id: 'atr_slow',
          kind: 'indicator',
          indicator: 'atr',
          args: { length: 50 },
        },
        {
          id: 'breakout',
          kind: 'compare',
          op: 'gt',
          left: { ref: 'close_price' },
          right: { ref: 'donchian_20' },
        },
        {
          id: 'vol_expanding',
          kind: 'compare',
          op: 'gt',
          left: { ref: 'atr_14' },
          right: { ref: 'atr_slow' },
        },
        {
          id: 'entry_trigger',
          kind: 'all',
          items: [{ ref: 'breakout' }, { ref: 'vol_expanding' }],
        },
        {
          id: 'ema_20',
          kind: 'indicator',
          indicator: 'ema',
          args: { length: 20 },
        },
        {
          id: 'exit_signal',
          kind: 'compare',
          op: 'lt',
          left: { ref: 'close_price' },
          right: { ref: 'ema_20' },
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
          stopLoss: { mode: 'percent', value: 3 },
          trailingStop: { distancePercent: 4, activateAfterPercent: 3 },
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
