import { createInterface } from 'node:readline/promises';

import { TraseqClient } from '@traseq/sdk';

import {
  DEFAULT_BASE_URL,
  listWriters,
  type ClientId,
} from '../install/index.js';
import { TRASEQ_APP_URL } from '../env.js';
import { probeTraseqMcpSetup } from '../mcp/probe.js';
import {
  DEFAULT_SECRET_REF,
  formatSecretRef,
  getDefaultSecretStore,
} from '../secrets/index.js';
import {
  runDoctorCommand,
  runInstallCommand,
  runLoginCommand,
} from './commands.js';

const SAMPLE_AGENT_PROMPT =
  'Use the Traseq MCP server. Call `start_research_engagement` with prompt "Validate a BTCUSDT 4h trend-following strategy."';

const NON_TTY_STEPS = [
  '`traseq-agent setup` is interactive. In a non-TTY shell, run these in order:',
  '  1. traseq-agent login                          # stores your API key in the OS keychain (referenced by TRASEQ_API_KEY_REF)',
  '  2. traseq-agent install --target=<client>:user # repeat for each client (claude-code, claude-desktop, codex)',
  '  3. traseq-agent doctor                         # verify everything is wired up',
  '  4. Restart your MCP client (Claude Code/Desktop/Codex) so it reloads the new server entry.',
];

interface SetupFlags {
  targets: string[];
  apiKey?: string;
  profile: 'guided' | 'full';
  nonInteractive: boolean;
}

function parseSetupFlags(argv: readonly string[]): SetupFlags {
  const flags: SetupFlags = {
    targets: [],
    profile: 'guided',
    nonInteractive: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg.startsWith('--target=')) {
      flags.targets.push(...arg.slice('--target='.length).split(','));
    } else if (arg === '--target') {
      const next = argv[i + 1];
      if (next !== undefined) {
        flags.targets.push(...next.split(','));
        i++;
      }
    } else if (arg.startsWith('--api-key=')) {
      flags.apiKey = arg.slice('--api-key='.length);
    } else if (arg === '--api-key') {
      const next = argv[i + 1];
      if (next !== undefined) {
        flags.apiKey = next;
        i++;
      }
    } else if (arg === '--profile=full') {
      flags.profile = 'full';
    } else if (arg === '--profile=guided') {
      flags.profile = 'guided';
    } else if (arg === '--non-interactive') {
      flags.nonInteractive = true;
    }
  }
  return flags;
}

async function detectAvailableTargets(): Promise<
  {
    client: ClientId;
    reason?: string;
  }[]
> {
  const out: { client: ClientId; reason?: string }[] = [];
  for (const writer of listWriters()) {
    if (writer.client === 'file') continue;
    try {
      const detect = await writer.detect();
      if (detect.present) {
        out.push({ client: writer.client });
      } else {
        out.push({
          client: writer.client,
          reason: detect.reason ?? 'not detected',
        });
      }
    } catch (error) {
      out.push({
        client: writer.client,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return out;
}

async function promptTargetSelection(
  detected: { client: ClientId; reason?: string }[],
): Promise<string[]> {
  const present = detected.filter((entry) => !entry.reason);
  if (present.length === 0) {
    process.stderr.write(
      'No MCP clients detected on this machine. Install Codex, Claude Code, or Claude Desktop first.\n',
    );
    return [];
  }

  process.stderr.write('\nDetected MCP clients:\n');
  present.forEach((entry, index) => {
    process.stderr.write(`  ${index + 1}. ${entry.client}\n`);
  });
  detected
    .filter((entry) => entry.reason)
    .forEach((entry) => {
      process.stderr.write(`     - ${entry.client}: ${entry.reason}\n`);
    });

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await rl.question(
    `\nWhich clients should receive the Traseq MCP entry? (default: 1, comma-separated indices, or 'all'): `,
  );
  rl.close();

  const trimmed = answer.trim().toLowerCase();
  if (trimmed.length === 0 || trimmed === '1') {
    const first = present[0];
    return first ? [`${first.client}:user`] : [];
  }
  if (trimmed === 'all') {
    return present.map((entry) => `${entry.client}:user`);
  }
  const indices = trimmed
    .split(',')
    .map((piece) => Number.parseInt(piece.trim(), 10))
    .filter((value) => Number.isInteger(value) && value > 0);
  return indices
    .map((value) => present[value - 1])
    .filter((entry): entry is { client: ClientId } => entry !== undefined)
    .map((entry) => `${entry.client}:user`);
}

async function probeStoredKey(apiKey: string): Promise<{
  ok: boolean;
  reason?: string;
}> {
  try {
    const client = new TraseqClient({ apiKey, baseUrl: DEFAULT_BASE_URL });
    await probeTraseqMcpSetup({
      client: {
        getManifest: () => client.getManifest(),
        getWorkspaceContext: () => client.getWorkspaceContext(),
        getUsage: () => client.getUsage(),
        getCapabilities: () => client.getCapabilities(),
      },
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function ensureKeychainHasKey(apiKeyOverride?: string): Promise<number> {
  if (apiKeyOverride !== undefined) {
    return runLoginCommand(['--api-key', apiKeyOverride]);
  }
  const store = getDefaultSecretStore();
  const availability = await store.available();
  if (!availability.ok) {
    return runLoginCommand([]);
  }
  const existing = await store
    .get(DEFAULT_SECRET_REF.service, DEFAULT_SECRET_REF.account)
    .catch(() => undefined);
  if (existing && existing.length > 0) {
    process.stderr.write(
      `Found existing API key at ${formatSecretRef(DEFAULT_SECRET_REF)}; probing before reuse...\n`,
    );
    const probe = await probeStoredKey(existing);
    if (probe.ok) {
      process.stderr.write('Existing key is valid; reusing it.\n');
      return 0;
    }
    process.stderr.write(
      `Stored key failed probe (${probe.reason ?? 'unknown'}). Falling back to fresh login.\n`,
    );
  }
  return runLoginCommand([]);
}

export async function runSetupCommand(
  argv: readonly string[],
): Promise<number> {
  const flags = parseSetupFlags(argv);
  const interactive = !flags.nonInteractive && process.stdin.isTTY;
  if (!interactive && flags.targets.length === 0) {
    for (const line of NON_TTY_STEPS) {
      process.stderr.write(`${line}\n`);
    }
    return 1;
  }

  process.stderr.write(
    '== Traseq agent setup ==\nThis wizard probes your API key, installs MCP entries, and runs doctor.\n',
  );

  const loginCode = await ensureKeychainHasKey(flags.apiKey);
  if (loginCode !== 0) {
    process.stderr.write(
      `\nLogin step failed (exit ${loginCode}). Stopping before install.\n`,
    );
    return loginCode;
  }

  let targets = flags.targets;
  if (targets.length === 0) {
    const detected = await detectAvailableTargets();
    targets = await promptTargetSelection(detected);
  }
  if (targets.length === 0) {
    process.stderr.write(
      '\nNo install targets selected. Run `traseq-agent install --target=<client>:user` manually when ready.\n',
    );
    return 1;
  }

  for (const target of targets) {
    process.stderr.write(`\n--- Installing into ${target} ---\n`);
    const code = await runInstallCommand([
      `--target=${target}`,
      `--profile=${flags.profile}`,
    ]);
    if (code !== 0) {
      process.stderr.write(
        `Install for ${target} exited ${code}. Continue manually with \`traseq-agent install --target=${target}\`.\n`,
      );
      return code;
    }
  }

  process.stderr.write('\n--- Running doctor ---\n');
  const doctorCode = await runDoctorCommand([]);
  if (doctorCode !== 0) {
    process.stderr.write(
      '\nDoctor reported issues. See output above and run `traseq-agent doctor --json` for machine-readable details.\n',
    );
    return doctorCode;
  }

  process.stdout.write(
    `\nSetup complete. Restart your MCP client so it picks up the new server entry.\nThen ask the client:\n\n  ${SAMPLE_AGENT_PROMPT}\n\nOpen your workspace: ${TRASEQ_APP_URL}\n`,
  );
  return 0;
}
