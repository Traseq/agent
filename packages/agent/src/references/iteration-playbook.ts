export const ITERATION_PLAYBOOK_REFERENCE = `\
# Iteration Playbook

This decision tree guides you from backtest results to specific improvements.
Always change one variable at a time between iterations.

## Decision Tree

### Problem: Zero Trades
The strategy generated no entries during the backtest period.

**Diagnosis**:
1. Check warmupPeriod — is it consuming the entire data range?
2. Check entry conditions — are they too restrictive in combination?
3. Check timeframe — a 1d strategy with 5 conditions may never trigger.

**Actions** (try in order):
1. Reduce warmupPeriod to 2× longest lookback (not more).
2. Remove confirmation filters. Keep only the primary trigger.
3. Loosen thresholds (e.g., RSI < 35 instead of RSI < 25).
4. Switch to a shorter timeframe (4h → 1h) for more data points.

---

### Problem: Too Few Trades (< 10)
The strategy traded but not enough for statistical confidence.

**Actions**:
1. Same as "Zero Trades" but milder adjustments.
2. Extend the backtest date range if possible.
3. Consider: is the thesis inherently rare? (e.g., monthly divergence events)
   If so, this may be acceptable but requires longer test periods.

---

### Problem: Too Many Trades (> 500 on 4h)
The strategy is over-trading, likely generating noise-driven signals.

**Actions**:
1. Add a confirmation filter (e.g., trend agreement, volume confirmation).
2. Tighten entry thresholds (e.g., RSI cross_up 30 instead of 40).
3. Add a time_window to restrict trading hours.
4. Increase indicator lookback periods for smoother signals.

---

### Problem: Good Win Rate but Low Profit Factor (< 1.5)
Many winning trades but average win is too small relative to average loss.

**Diagnosis**: Take profits are likely too tight or stop losses too wide.

**Actions**:
1. Widen take profit target (e.g., 6% → 10%).
2. Tighten stop loss (e.g., 5% → 3%).
3. Add a trailing stop to let winners run.
4. Replace fixed take profit with a signal-based exit.

---

### Problem: Low Win Rate (< 35%) but Adequate Profit Factor (> 1.5)
Few winners but they're large enough to cover the many small losses.
This is typical of trend-following strategies.

**Diagnosis**: This may be fine! Trend-following naturally has low win rate.

**Actions**:
1. If profit factor > 2.0 — this is working. Focus on reducing drawdown.
2. Add a trend filter to avoid entries during ranging markets.
3. Tighten stop loss slightly to reduce the size of losing trades.
4. Do NOT try to increase win rate by adding filters — you'll likely
   filter out the big winners too.

---

### Problem: High Max Drawdown (> 30%)

**Actions** (by priority):
1. Reduce position sizing (e.g., percent_equity 10 → 5).
2. Add or tighten stop loss.
3. Add a state-based exit: exit when account_drawdown > threshold.
4. Reduce maxConcurrentPositions if using pyramid.
5. Add a regime filter: pause trading when volatility is extreme.

---

### Problem: High Drawdown During Specific Regimes
The strategy performs well overall but has deep drawdowns during
specific market conditions (e.g., bear markets, low volatility).

**Actions**:
1. Add a time_window filter to avoid known low-quality periods.
2. Add a volatility filter: only trade when ATR is above/below a threshold.
3. Add a trend filter: only trade with the macro trend (e.g., close > EMA_200).
4. Accept the regime weakness and document it for the user.

---

### Problem: Returns Concentrated in One Period
90%+ of the profit came from a small number of trades or one month.

**Diagnosis**: The strategy may be curve-fit to a specific regime.

**Actions**:
1. Test on a different instrument (ETHUSDT, SOLUSDT).
2. Test on a different timeframe.
3. Reduce the complexity of the strategy (simpler = less curve-fit).
4. If still concentrated after changes, the thesis may only work in
   specific conditions — document this limitation honestly.

---

### Problem: Strategy Degrades with Fees/Slippage
Returns are positive without fees but negative with realistic execution costs.

**Diagnosis**: The strategy's edge is smaller than execution costs.

**Actions**:
1. Increase holding period — fewer trades = fewer fee events.
2. Switch order roles to maker where possible (lower fees).
3. Widen entry thresholds to trade only on stronger signals.
4. Switch to a longer timeframe (fewer but higher-conviction trades).
5. If the edge is consistently < 0.2% per trade, the strategy is
   likely not viable for real trading. Consider a different thesis.

---

## Parameter Tuning Guide

### Indicator Periods
- **Shorter period** → More signals, more noise, more trades.
- **Longer period** → Fewer signals, smoother, fewer trades.
- **Guideline**: Adjust by 25-50% per iteration (e.g., EMA 50 → 75 or 30).

### Stop Loss
- **Tighter** → Higher win count, smaller average loss, but more stopped out.
- **Wider** → Fewer stops, larger average loss when hit.
- **Guideline**: Start at 2% for 4h, 1% for 1h, 0.5% for 15m.

### Take Profit
- **Tighter** → Higher win rate, smaller average win.
- **Wider** → Lower win rate, larger average win.
- **Guideline**: Take profit should be 2-3× stop loss (risk/reward ratio).

### Position Sizing
- **Larger** → Higher returns AND higher drawdowns proportionally.
- **Smaller** → Lower returns AND lower drawdowns proportionally.
- **Guideline**: Start at 5-10% of equity. Never exceed 25%.

### Warmup Period
- Should never need tuning once set correctly (2× longest lookback).
- If changing indicator lengths, update warmup accordingly.

## Iteration Tracking Template

For each iteration, record:

1. **Version**: v1, v2, v3...
2. **Change made**: What single variable was modified and why.
3. **Hypothesis**: What improvement was expected.
4. **Result**: Key metrics (return %, Sharpe, DD, trades, profit factor).
5. **Verdict**: Better / worse / neutral. Keep or revert.

After 3-5 iterations, step back and ask: Is the original thesis sound?
If no iteration has produced Sharpe > 1 and profit factor > 1.5, consider
changing the thesis entirely rather than continuing to micro-tune.
`;
