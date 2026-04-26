import { getMetric } from './scoring.js';
import type { AnalyzeRoundArgs, RoundAnalysis } from './types.js';

export function analyzeRound(args: AnalyzeRoundArgs): RoundAnalysis {
  const scoreNotes = args.score.notes.join(' ');
  const summary = args.backtest.summary;
  const totalPositions = getMetric(summary, 'totalPositions');
  const weaknesses =
    totalPositions < 8
      ? ['Current round has too few trades, so the evidence is thin.']
      : [
          'Sharpen one part of the entry/exit logic without adding excess complexity.',
        ];

  return {
    thesis:
      args.score.total >= 0
        ? 'Current round produced a usable baseline with enough signal to continue refining.'
        : 'Current round did not yet produce a robust profile and needs a more disciplined revision.',
    strengths:
      scoreNotes.length > 0
        ? args.score.notes.slice(0, 3)
        : ['The round completed end-to-end and produced measurable evidence.'],
    weaknesses,
    decision:
      'Tighten one or two high-leverage conditions instead of stacking many new filters.',
    changeLog: [
      {
        category: 'other',
        title: 'Make one evidence-driven revision',
        before: 'Current strategy baseline.',
        after: 'A simpler and more targeted next revision.',
        reason:
          'The next round should improve the weak spot with the clearest evidence.',
        expectedImpact:
          'Higher interpretability and better odds of a measurable improvement.',
      },
    ],
    nextPrompt:
      'Refine the weakest part of the current strategy with a single clear adjustment.',
  };
}
