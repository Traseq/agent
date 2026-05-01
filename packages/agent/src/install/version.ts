import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const PACKAGE_JSON_URL = new URL('../../package.json', import.meta.url);

interface PackageJson {
  name: string;
  version: string;
}

let cached: PackageJson | undefined;

function readPackageJson(): PackageJson {
  if (cached) {
    return cached;
  }
  const path = fileURLToPath(PACKAGE_JSON_URL);
  const raw = readFileSync(path, 'utf8');
  const parsed = JSON.parse(raw) as PackageJson;
  if (typeof parsed.name !== 'string' || typeof parsed.version !== 'string') {
    throw new Error(
      `Could not read package.json at ${path}: missing name or version field.`,
    );
  }
  cached = parsed;
  return parsed;
}

export function packageName(): string {
  return readPackageJson().name;
}

export function packageVersion(): string {
  return readPackageJson().version;
}

export function packagePin(override?: string): string {
  const pkg = readPackageJson();
  if (override && override.length > 0) {
    return `${pkg.name}@${override}`;
  }
  const [major, minor] = pkg.version.split('.');
  return `${pkg.name}@^${major}.${minor}.0`;
}
