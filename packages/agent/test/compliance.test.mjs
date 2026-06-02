import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertNoInvestmentAdvice,
  findAdvicePhrases,
  InvestmentAdviceError,
} from '../dist/compliance.js';
import { buildResearchVerdict } from '../dist/index.js';
import { SKILL_CONTENT } from '../dist/skill/index.js';
import { references } from '../dist/references/index.js';

// Phrases that DO read as investment advice — each must be caught.
const ADVICE_PHRASES = [
  // English
  'I recommend you buy BTC here.',
  'You should sell this position now.',
  'Current signal: buy.',
  'This is a buy signal.',
  'This strategy is suitable for you.',
  'Suitable for conservative investors.',
  'Guaranteed profit with this setup.',
  'Low risk, high return.',
  'This is the best strategy for the market.',
  'Start earning with this strategy.',
  'Follow this strategy to grow your account.',
  'Our AI recommends the best strategy for you.',
  // Traditional Chinese
  '建議買入 BTC。',
  '建議你進場做多。',
  '這是我們的推薦策略。',
  '精選策略清單。',
  '這個策略適合你。',
  '適合保守型投資人。',
  '保證獲利。',
  '穩定獲利的策略。',
  '低風險高報酬。',
  '高勝率策略庫。',
  '必勝策略。',
  '跟單就對了。',
  '最佳策略排名。',
  '立即進場。',
  '你應該買進。',
  '跟著做就能賺。',
  'AI 推薦策略給你。',
];

// Phrases that read as research evidence / legitimate product copy / user input
// — none may be flagged. These are the false-positive traps.
const COMPLIANT_PHRASES = [
  // Our own report/skill structure
  '## Next Step',
  'Recommended next research step.',
  'Keep this candidate and move to baseline or robustness evaluation next.',
  'Continue with one targeted revision or run external robustness checks.',
  'Reject this candidate or repair the strategy before running another round.',
  'Champion round meets the first-pass research robustness bar.',
  // Honest non-advice guidance
  "Respect the user's risk tolerance. Do not suggest aggressive sizing or no stop loss.",
  'Buy-and-hold return over the same period.',
  'MACD cross_up signal line = bullish.',
  'Decide confidently which version to advance.',
  // Plan / capacity copy
  '最適合多數研究者',
  '適合嚴肅單人研究的完整歷史深度驗證',
  '結果可能不具統計顯著性。建議蒐集更多資料後再依此條件做決策。',
  '已使用 80% 的儲存結果配額。建議升級以取得更多容量。',
  // User-supplied rule descriptions (echoed verbatim — must never be flagged)
  'buy when RSI < 30 and sell when RSI > 70',
  '當 RSI 低於 30 買進，高於 70 賣出',
];

describe('findAdvicePhrases — flags investment-advice language', () => {
  for (const phrase of ADVICE_PHRASES) {
    it(`flags: ${phrase}`, () => {
      const matches = findAdvicePhrases(phrase);
      assert.ok(
        matches.length > 0,
        `expected an advice match for: ${phrase}`,
      );
    });
  }
});

describe('findAdvicePhrases — allows research / legitimate copy', () => {
  for (const phrase of COMPLIANT_PHRASES) {
    it(`allows: ${phrase}`, () => {
      const matches = findAdvicePhrases(phrase);
      assert.deepEqual(
        matches,
        [],
        `unexpected advice match for: ${phrase} -> ${JSON.stringify(matches)}`,
      );
    });
  }
});

describe('assertNoInvestmentAdvice', () => {
  it('throws InvestmentAdviceError with matches on advice prose', () => {
    let error;
    try {
      assertNoInvestmentAdvice('You should buy now.', 'unit-test');
    } catch (caught) {
      error = caught;
    }
    assert.ok(error instanceof InvestmentAdviceError);
    assert.ok(error.matches.length > 0);
    assert.match(error.message, /unit-test/);
  });

  it('does not throw on compliant prose', () => {
    assert.doesNotThrow(() =>
      assertNoInvestmentAdvice(
        'Keep this candidate and move to robustness evaluation next.',
        'unit-test',
      ),
    );
  });
});

describe('Traseq-authored copy is compliance-clean', () => {
  it('skill content carries no advice language', () => {
    assert.deepEqual(findAdvicePhrases(SKILL_CONTENT), []);
  });

  it('indicator-guide reference carries no advice language', () => {
    assert.deepEqual(findAdvicePhrases(references.indicatorGuide), []);
  });

  it('all reference docs carry no advice language', () => {
    assert.deepEqual(findAdvicePhrases(references.asMarkdown()), []);
  });

  // Every verdict branch produces summary + nextAction that must stay clean.
  const round = (confidence, n = 1) => ({ round: n, confidence });
  const base = { rounds: [], championRound: undefined, confidence: 'reject', riskFlags: [] };
  const branches = {
    'no rounds': base,
    'robust champion': {
      ...base,
      rounds: [round('robust')],
      championRound: 1,
      confidence: 'robust',
    },
    'promising champion': {
      ...base,
      rounds: [round('promising')],
      championRound: 1,
      confidence: 'promising',
    },
    'weak champion': {
      ...base,
      rounds: [round('weak')],
      championRound: 1,
      confidence: 'weak',
    },
    'reject champion': {
      ...base,
      rounds: [round('reject')],
      championRound: 1,
      confidence: 'reject',
    },
    'weak/reject across iterations': {
      ...base,
      rounds: [round('weak', 1), round('reject', 2)],
      championRound: 1,
      confidence: 'weak',
    },
  };

  for (const [name, evaluation] of Object.entries(branches)) {
    it(`verdict prose is clean: ${name}`, () => {
      const verdict = buildResearchVerdict(evaluation);
      const prose = `${verdict.summary}\n${verdict.nextAction}`;
      assert.deepEqual(
        findAdvicePhrases(prose),
        [],
        `advice language in verdict (${name}): ${prose}`,
      );
    });
  }
});
