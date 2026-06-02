export const RESULTS_INTERPRETATION_REFERENCE = `\
# Results Interpretation Reference

After a backtest completes, the \`summaryJson\` and \`resultJson\` fields contain
performance metrics. This guide explains how to interpret them.

> This guide is for interpreting historical research evidence only. The
> benchmarks and verdicts below are research comparison thresholds — not
> investment advice, performance predictions, or suitability assessments. Any
> strategy must be independently validated and stress-tested before any
> live-trading decision.

## Step 1: Sanity Check

Before analyzing metrics, verify the basics:

| Check | Red Flag | Action |
|-------|----------|--------|
| Total positions | 0 trades | Loosen entry conditions, check warmup period |
| Total positions | < 10 trades | Results are statistically unreliable. Widen date range or loosen conditions. |
| Status | "failed" | Check error message. Common: invalid strategy, missing data. |
| Max drawdown | > 80% | Excessive drawdown. Research should test smaller position sizing and risk controls. |

## Step 2: Headline Metrics

### Return %
- Total percentage gain/loss over the test period.
- **Context**: Always compare to buy-and-hold for the same instrument/period.
  A strategy returning 50% when BTC returned 200% underperformed passive holding.
- **Benchmark**: Beats buy-and-hold after fees.

### Max Drawdown
- Largest peak-to-trough equity decline during the test.
- **Benchmarks**: < 10% conservative, 10-20% moderate, 20-40% aggressive, > 40% dangerous.
- **Rule of thumb**: In live trading, expect 1.5-2× the backtest max drawdown.

### Sharpe Ratio
- Risk-adjusted return: (annualized return - risk-free rate) / annualized volatility.
- **Benchmarks**: < 0 losing money, 0-1 weak, 1-2 solid, 2-3 strong, > 3 exceptional.
- **Caution**: Sharpe penalizes upside volatility equally with downside. Use Sortino
  if the strategy has asymmetric returns.

### Profit Factor
- Gross profits / gross losses.
- **Benchmarks**: < 1.0 net loser, 1.0-1.5 marginal, 1.5-2.0 healthy, > 2.0 strong.
- **Note**: Very high profit factor (> 5) with few trades is often unreliable.

### Win Rate
- Percentage of trades that were profitable.
- **Warning**: Win rate alone is meaningless. A 90% win rate with tiny wins and
  huge losses is worse than a 40% win rate with large wins and small losses.
- **Always pair with**: Average win / average loss ratio.

### Win/Loss Ratio
- Average winning trade size / average losing trade size.
- Combined with win rate, this tells the full picture:
  - Win rate 60% + win/loss ratio 1.5 = strong (both favorable)
  - Win rate 35% + win/loss ratio 3.0 = viable trend-following (few but large wins)
  - Win rate 70% + win/loss ratio 0.3 = dangerous (many small wins, few devastating losses)

## Step 3: Risk Metrics

### Sortino Ratio
- Like Sharpe, but only penalizes downside deviation.
- **Better than Sharpe for**: Strategies with positive skew (trend-following).
- **Benchmarks**: Same scale as Sharpe but typically higher.

### Calmar Ratio
- Annualized return / max drawdown.
- **Benchmarks**: < 1 poor, 1-3 good, > 3 excellent.
- **Useful for**: Comparing strategies with different drawdown profiles.

### Average Drawdown
- Mean of all drawdown periods. More representative than max drawdown for
  typical experience.

### Recovery Factor
- Net profit / max drawdown.
- **Interpretation**: How many times the strategy recovered from its worst
  drawdown. Higher is better.

## Step 4: Trade Distribution Analysis

### Average Win vs Average Loss
- If average loss > 2× average win, the strategy needs high win rate to survive.
- Preferred: average win >= average loss (profits from both rate and magnitude).

### Consecutive Wins / Losses
- Long loss streaks test psychological resilience.
- If max consecutive losses > 10, even a profitable strategy may be hard to
  execute in practice.

### Holding Period
- Average bars per trade.
- Very short holding periods (< 3 bars) suggest the strategy is scalping and
  is highly sensitive to fees and slippage.
- Very long holding periods (> 100 bars on 4h) suggest the strategy rarely
  exits and may be acting as a "buy and hold with extra steps."

## Step 5: Regime Sensitivity

### Monthly Returns
- Look for consistency across months. A strategy that made 90% of its profit
  in one month is unreliable.
- Check if returns correlate with market regime (trending up, trending down, range).

### Drawdown Timing
- Did the worst drawdown happen during a market crash? (Expected and acceptable)
- Did it happen during a calm market? (Strategy flaw, more concerning)

## Step 6: Comparison Framework

When comparing two backtest results:

1. **Same period, same instrument**: Required for fair comparison.
2. **One variable at a time**: Only change one parameter between versions.
3. **Prioritize risk-adjusted metrics**: Sharpe > raw return.
4. **Statistical significance**: Both strategies need > 30 trades minimum.
5. **Consistency**: A strategy with steady 2% monthly return beats one with
   alternating +20% and -15% months.

## Summary Decision Matrix

| Scenario | Verdict | Next Step |
|----------|---------|-----------|
| Return > buy-and-hold, Sharpe > 1, DD < 20% | Meets first-pass research bar | Continue research: test sensitivity to fees/slippage |
| Return > buy-and-hold, Sharpe < 1 | High variance relative to return | Continue research: examine risk profile and position sizing |
| Return < buy-and-hold, Sharpe > 1 | Lower return, steadier profile | Continue research before drawing further conclusions |
| Zero trades | Signal issue | Loosen conditions, check warmup |
| < 10 trades | Insufficient data | Extend date range, loosen conditions |
| DD > 40% | Excessive drawdown | Test smaller sizing and a max-drawdown exit |
| Profit factor < 1 | Net loser in-sample | Rethink thesis, review entry/exit logic |
`;
