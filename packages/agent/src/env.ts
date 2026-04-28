export const TRASEQ_API_KEY_SETUP_URL =
  'https://app.traseq.com/login?redirectTo=%2Fsettings%2Fapi-keys&entry_surface=agent_cli&entry_source=missing_traseq_api_key&cta_id=start_with_free_tier';

export const TRASEQ_API_KEY_SETUP_HELP = [
  'Missing TRASEQ_API_KEY.',
  'Start with the free tier and create a workspace API key:',
  TRASEQ_API_KEY_SETUP_URL,
  'Set it as TRASEQ_API_KEY and run `traseq-agent check-env` again.',
  'Do not paste API keys into AI prompts.',
].join('\n');

export function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function readNumberEnv(name: string): number | undefined {
  const value = readEnv(name);
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function requireEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    if (name === 'TRASEQ_API_KEY') {
      throw new Error(TRASEQ_API_KEY_SETUP_HELP);
    }

    throw new Error(`${name} is required.`);
  }

  return value;
}
