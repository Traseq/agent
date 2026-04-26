import { SKILL_CONTENT } from './skill/index.js';
import { references } from './references/index.js';
import { templates } from './templates/index.js';
import { tools } from './tools/index.js';
import type { AgentContextOptions, SectionName } from './types.js';

const DEFAULT_SECTIONS: readonly SectionName[] = [
  'skill',
  'tools',
  'references',
  'templates',
];

export function getAgentContext(options?: AgentContextOptions): string {
  const sections = options?.sections ?? DEFAULT_SECTIONS;
  const parts: string[] = [];

  for (const section of sections) {
    switch (section) {
      case 'skill':
        parts.push(SKILL_CONTENT);
        break;
      case 'tools':
        parts.push(tools.asMarkdown());
        break;
      case 'references':
        parts.push(references.asMarkdown());
        break;
      case 'templates':
        parts.push(templates.asMarkdown());
        break;
    }
  }

  return parts.join('\n\n---\n\n');
}
