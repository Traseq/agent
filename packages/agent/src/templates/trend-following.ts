import type { StrategyTemplate } from '../types.js';

export const trendFollowingTemplate: StrategyTemplate = {
  id: 'trend-following',
  name: 'EMA Trend Follow + RSI Reclaim',
  description:
    'Buy pullbacks in an established uptrend. Uses EMA(100) as trend filter and RSI(14) crossing above 45 as the momentum reclaim trigger.',
  thesis:
    'In a sustained uptrend, price pulls back temporarily and RSI dips. When RSI reclaims mid-range while price remains above the long-term EMA, the pullback is over and the trend resumes.',
  adaptationHints: [
    'Change EMA length (50-200) for faster/slower trend detection.',
    'Adjust RSI threshold (30-50) for entry sensitivity.',
    'Add a volume confirmation filter (volume > volume MA) for stronger signals.',
    'Replace fixed exit with trailing stop for letting winners run.',
    'Add ADX > 25 filter to avoid entries during range-bound markets.',
  ],
  draft: {
    name: 'EMA Trend Follow + RSI Reclaim',
    description:
      'Long pullbacks in an uptrend when RSI reclaims 45 while price holds above EMA(100).',
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
        {
          id: 'exit_signal',
          kind: 'compare',
          op: 'lt',
          left: { ref: 'rsi_14' },
          right: { const: 55 },
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
        },
      },
    },
    settings: {
      positionStyle: 'single',
      warmupPeriod: 200,
    },
    backtest: {
      timeframe: '4h',
      signalInstrument: { symbol: 'BTCUSDT' },
      initialBalance: 10000,
    },
  },
};
