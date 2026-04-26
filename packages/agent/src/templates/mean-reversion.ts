import type { StrategyTemplate } from '../types.js';

export const meanReversionTemplate: StrategyTemplate = {
  id: 'mean-reversion',
  name: 'Bollinger Band Mean Reversion',
  description:
    'Buy when price touches the lower Bollinger Band while RSI confirms oversold. Exits at the middle band (SMA). Uses band extremes as value zones.',
  thesis:
    'Price tends to revert to the mean after touching statistical extremes. The lower Bollinger Band combined with RSI oversold identifies high-probability reversion points.',
  adaptationHints: [
    'Adjust BB stdDev (1.5-3.0) to widen or narrow the bands.',
    'Change RSI oversold threshold (20-35) for sensitivity.',
    'Replace BB middle exit with a take-profit target for faster exits.',
    'Add a volume spike confirmation for stronger signals.',
    'Add a trend filter (close > EMA_200) to avoid mean-reversion in downtrends.',
  ],
  draft: {
    name: 'Bollinger Band Mean Reversion',
    description:
      'Long at lower Bollinger Band + RSI oversold, exit at middle band.',
    signalGraph: {
      protocol: 'traseq.signal-graph',
      version: 2,
      nodes: [
        { id: 'close_price', kind: 'market', field: 'close' },
        {
          id: 'bb',
          kind: 'indicator',
          indicator: 'bbands',
          args: { length: 20, stdDev: 2 },
        },
        {
          id: 'rsi_14',
          kind: 'indicator',
          indicator: 'rsi',
          args: { length: 14 },
        },
        {
          id: 'at_lower_band',
          kind: 'compare',
          op: 'lte',
          left: { ref: 'close_price' },
          right: { ref: 'bb' },
        },
        {
          id: 'rsi_oversold',
          kind: 'compare',
          op: 'lt',
          left: { ref: 'rsi_14' },
          right: { const: 30 },
        },
        {
          id: 'entry_trigger',
          kind: 'all',
          items: [{ ref: 'at_lower_band' }, { ref: 'rsi_oversold' }],
        },
        {
          id: 'sma_20',
          kind: 'indicator',
          indicator: 'sma',
          args: { length: 20 },
        },
        {
          id: 'exit_signal',
          kind: 'compare',
          op: 'gte',
          left: { ref: 'close_price' },
          right: { ref: 'sma_20' },
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
        },
      },
    },
    settings: {
      positionStyle: 'single',
      warmupPeriod: 50,
    },
    backtest: {
      timeframe: '4h',
      signalInstrument: { symbol: 'BTCUSDT' },
      initialBalance: 10000,
    },
  },
};
