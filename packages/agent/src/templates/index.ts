import type { StrategyTemplate } from '../types.js';
import { trendFollowingTemplate } from './trend-following.js';
import { meanReversionTemplate } from './mean-reversion.js';
import { breakoutTemplate } from './breakout.js';
import { momentumTemplate } from './momentum.js';
import { patternBasedTemplate } from './pattern-based.js';

export {
  trendFollowingTemplate,
  meanReversionTemplate,
  breakoutTemplate,
  momentumTemplate,
  patternBasedTemplate,
};

const ALL_TEMPLATES: readonly StrategyTemplate[] = [
  trendFollowingTemplate,
  meanReversionTemplate,
  breakoutTemplate,
  momentumTemplate,
  patternBasedTemplate,
];

function templateToMarkdown(t: StrategyTemplate): string {
  return [
    `### ${t.name}`,
    '',
    `**ID**: \`${t.id}\``,
    `**Thesis**: ${t.thesis}`,
    '',
    t.description,
    '',
    '**Adaptation hints**:',
    ...t.adaptationHints.map((hint) => `- ${hint}`),
    '',
    '**Draft signalGraph**:',
    '```json',
    JSON.stringify(t.draft.signalGraph, null, 2),
    '```',
    '',
    '**Settings**:',
    '```json',
    JSON.stringify(t.draft.settings, null, 2),
    '```',
    '',
    '**Backtest config**:',
    '```json',
    JSON.stringify(t.draft.backtest, null, 2),
    '```',
  ].join('\n');
}

export const templates = {
  all: ALL_TEMPLATES,
  byId(id: string): StrategyTemplate | undefined {
    return ALL_TEMPLATES.find((t) => t.id === id);
  },
  asMarkdown(): string {
    return [
      '# Strategy Templates',
      '',
      'Each template is a complete, valid signalGraph strategy draft.',
      'Use as a starting point and adapt to the user\'s specific thesis.',
      '',
      ...ALL_TEMPLATES.map(templateToMarkdown),
    ].join('\n');
  },
};
