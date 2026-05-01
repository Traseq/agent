import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { buildEntry, redactEntry } from './shared.js';
import type {
  ApplyResult,
  InstallInput,
  InstallPlan,
  InstallTarget,
  InstallWriter,
  McpServerEntry,
} from './types.js';

function resolveTarget(target: InstallTarget): string {
  return target.location === '-' ? '-' : resolve(target.location);
}

function buildConfigPayload(
  serverName: string,
  entry: McpServerEntry,
): unknown {
  return {
    mcpServers: { [serverName]: entry },
  };
}

export class FileInstallWriter implements InstallWriter {
  readonly client = 'file' as const;
  readonly supportedLocations = ['stdout', 'absolute-path'] as const;

  async detect() {
    return { present: true };
  }

  plan(input: InstallInput): InstallPlan {
    const entry = buildEntry(input);
    const writeTarget = resolveTarget(input.target);
    const warnings: string[] = [];
    if (input.inline !== undefined && input.inline.length > 0) {
      warnings.push(
        'TRASEQ_API_KEY is inlined into the generated JSON. Treat the output as sensitive.',
      );
    }
    return {
      target: input.target,
      serverName: input.serverName,
      entry,
      warnings,
      ...(writeTarget !== '-' ? { writeTarget } : {}),
    };
  }

  async apply(plan: InstallPlan): Promise<ApplyResult> {
    const payload = buildConfigPayload(plan.serverName, plan.entry);
    const text = `${JSON.stringify(payload, null, 2)}\n`;
    if (!plan.writeTarget) {
      const redacted = buildConfigPayload(
        plan.serverName,
        redactEntry(plan.entry),
      );
      process.stdout.write(`${JSON.stringify(redacted, null, 2)}\n`);
      return {
        written: false,
        warnings: plan.warnings,
        followups: [
          'JSON above is redacted; pass --inline to include the raw secret on stdout (not recommended).',
        ],
      };
    }
    mkdirSync(dirname(plan.writeTarget), { recursive: true });
    writeFileSync(plan.writeTarget, text, 'utf8');
    return {
      written: true,
      writeTarget: plan.writeTarget,
      warnings: plan.warnings,
      followups: [`Wrote MCP config to ${plan.writeTarget}.`],
    };
  }

  async remove(): Promise<void> {
    // file targets are user-managed; nothing to remove.
  }
}
