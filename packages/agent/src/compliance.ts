/**
 * Investment-advice compliance guardrail for Traseq-authored prose.
 *
 * Traseq is a backtesting / research tool: it surfaces historical evidence and
 * lets users decide. It must never read like investment advice — no strategy
 * recommendations, no buy/sell calls, no "suitable for you" / profit promises.
 *
 * This module is a defensive net that scans text we author (research verdicts,
 * report sections, static skill copy) for advice-framed language, in English
 * and Traditional Chinese.
 *
 * IMPORTANT — scope:
 *   - Run this over TRASEQ-AUTHORED prose only.
 *   - NEVER run it over user-supplied content (an echoed prompt like
 *     "buy when RSI < 30" is a legitimate rule description, not advice).
 *
 * Each rule targets advice *semantics*, not bare keywords: verbs are anchored
 * to a trade/strategy object so legitimate phrasing — "Recommended next step",
 * "建議蒐集更多資料", "適合多數研究者", "suggest aggressive sizing" — does not
 * trip the net.
 */

/** A non-action-anchored gap: stops a match from spanning sentence boundaries. */
const GAP = '[^.?!。？！\\n]';

interface AdviceRule {
  readonly code: string;
  readonly description: string;
  readonly pattern: RegExp;
}

export interface AdvicePhraseMatch {
  readonly code: string;
  readonly description: string;
  /** The exact substring that matched. */
  readonly excerpt: string;
  /** Character offset of the match within the scanned text. */
  readonly index: number;
}

// English rules. The `i` flag is safe here; Chinese rules below omit it.
const EN_RULES: readonly AdviceRule[] = [
  {
    code: 'recommend_trade',
    description: 'Recommends a buy/sell/trade action or a specific strategy.',
    pattern: new RegExp(
      `\\b(?:recommend|suggest|advis(?:e|ing))\\b${GAP}{0,40}\\b(?:buy|sell|short|long|enter|exit|trade|this strategy)\\b`,
      'i',
    ),
  },
  {
    code: 'imperative_trade',
    description: 'Tells the user they should buy/sell/use this strategy.',
    pattern: new RegExp(
      `\\byou should\\b${GAP}{0,30}\\b(?:buy|sell|short|trade|enter|exit|use this strategy)\\b`,
      'i',
    ),
  },
  {
    code: 'buy_sell_signal',
    description: 'Frames output as a buy/sell signal.',
    pattern: /\b(?:buy|sell)[\s-]signal\b|\bsignal\s*:\s*(?:buy|sell)\b/i,
  },
  {
    code: 'suitable_for',
    description:
      'Claims a strategy is suitable for the user or an investor type.',
    pattern:
      /\bsuitable for (?:you|conservative|aggressive|long[\s-]?term|investors?)\b/i,
  },
  {
    code: 'guaranteed_return',
    description: 'Promises guaranteed profit or returns.',
    pattern: new RegExp(
      `\\bguarantee(?:d|s)?\\b${GAP}{0,20}\\b(?:profit|return|gain|win)`,
      'i',
    ),
  },
  {
    code: 'low_risk_high_return',
    description: 'Markets low risk paired with high return.',
    pattern: /\blow[\s-]?risk[\s,]+high[\s-]?return/i,
  },
  {
    code: 'endorsed_strategy',
    description: 'Endorses a "best/top/winning/most profitable" strategy.',
    pattern:
      /\b(?:best|top|winning|most profitable|highest[\s-]?return)\s+strateg(?:y|ies)\b/i,
  },
  {
    code: 'profit_cta',
    description: 'Calls the user to start earning / making money.',
    pattern: /\bstart (?:earning|profiting|making money)\b/i,
  },
  {
    code: 'follow_strategy',
    description: 'Tells the user to follow/copy a strategy to profit.',
    pattern: /\bfollow this strategy\b/i,
  },
  {
    code: 'ai_picks_strategy',
    description: 'Claims the AI picks/recommends strategies for the user.',
    pattern: new RegExp(
      `\\bAI ${GAP}{0,20}\\b(?:picks?|recommends?|chooses?)${GAP}{0,20}\\bstrateg`,
      'i',
    ),
  },
];

// Traditional Chinese rules.
const ZH_RULES: readonly AdviceRule[] = [
  {
    code: 'recommend_trade',
    description: '建議具體買賣/進出場/使用某策略。',
    pattern: new RegExp(
      `建議${GAP}{0,10}(?:買入|買進|賣出|做多|做空|進場|出場|加倉|減倉|使用此策略|使用這個策略)`,
    ),
  },
  {
    code: 'recommend_strategy',
    description: '推薦／精選策略。',
    pattern: new RegExp(
      `(?:推薦|精選)${GAP}{0,8}策略|策略${GAP}{0,4}(?:推薦|精選)`,
    ),
  },
  {
    code: 'suitable_for',
    description: '宣稱策略適合你或某類投資人。',
    pattern: /適合你|適合(?:長期持有|保守型|積極型|穩健型|投資人)/,
  },
  {
    code: 'buy_sell_signal',
    description: '把輸出框成買賣訊號。',
    pattern: /買賣訊號|買進訊號|賣出訊號/,
  },
  {
    code: 'guaranteed_return',
    description: '保證獲利／報酬。',
    pattern: new RegExp(`保證${GAP}{0,6}(?:獲利|報酬|賺|不賠)`),
  },
  {
    code: 'stable_profit',
    description: '穩定獲利。',
    pattern: /穩定獲利/,
  },
  {
    code: 'low_risk_high_return',
    description: '低風險高報酬。',
    pattern: /低風險高報酬/,
  },
  {
    code: 'high_winrate_strategy',
    description: '高勝率策略。',
    pattern: /高勝率策略/,
  },
  {
    code: 'guaranteed_win',
    description: '必賺／必勝策略。',
    pattern: /必賺|必勝策略/,
  },
  {
    code: 'copy_trading',
    description: '跟單／喊單。',
    pattern: /跟單|喊單/,
  },
  {
    code: 'endorsed_strategy',
    description: '最佳／最強／最賺策略。',
    pattern: new RegExp(`(?:最佳|最強|最賺)${GAP}{0,4}策略`),
  },
  {
    code: 'immediate_entry',
    description: '立即／馬上進場。',
    pattern: /(?:立即|馬上|現在)進場/,
  },
  {
    code: 'imperative_trade',
    description: '你應該買／賣／進場／使用此策略。',
    pattern: new RegExp(
      `你應該${GAP}{0,8}(?:買|賣|進場|出場|使用這個策略|使用此策略)`,
    ),
  },
  {
    code: 'follow_along',
    description: '跟著做／買／賣／操作。',
    pattern: /跟著(?:做|買|賣|操作)/,
  },
  {
    code: 'ai_picks_strategy',
    description: 'AI 推薦／幫你挑策略。',
    pattern: new RegExp(
      `AI${GAP}{0,4}推薦|AI${GAP}{0,6}(?:幫你挑|幫你選|自動找)${GAP}{0,4}策略`,
    ),
  },
];

const ALL_RULES: readonly AdviceRule[] = [...EN_RULES, ...ZH_RULES];

/**
 * Returns every investment-advice phrase found in `text`. Empty array means the
 * text reads as research evidence, not advice. Safe to call on any string; it
 * never throws.
 */
export function findAdvicePhrases(text: string): AdvicePhraseMatch[] {
  if (!text) {
    return [];
  }

  const matches: AdvicePhraseMatch[] = [];
  for (const rule of ALL_RULES) {
    const hit = rule.pattern.exec(text);
    if (hit) {
      matches.push({
        code: rule.code,
        description: rule.description,
        excerpt: hit[0],
        index: hit.index,
      });
    }
  }
  return matches.sort((a, b) => a.index - b.index);
}

export class InvestmentAdviceError extends Error {
  readonly matches: readonly AdvicePhraseMatch[];

  constructor(context: string, matches: readonly AdvicePhraseMatch[]) {
    const detail = matches.map((m) => `[${m.code}] "${m.excerpt}"`).join(', ');
    super(
      `Investment-advice language detected in ${context}: ${detail}. ` +
        'Traseq prose must frame results as research evidence, not advice.',
    );
    this.name = 'InvestmentAdviceError';
    this.matches = matches;
  }
}

/**
 * Throws {@link InvestmentAdviceError} if `text` contains advice-framed
 * language. Use as a defensive assertion over Traseq-authored prose so any
 * future edit that drifts into advice language fails loudly in tests/CI.
 *
 * Do NOT pass user-supplied content.
 */
export function assertNoInvestmentAdvice(text: string, context: string): void {
  const matches = findAdvicePhrases(text);
  if (matches.length > 0) {
    throw new InvestmentAdviceError(context, matches);
  }
}
