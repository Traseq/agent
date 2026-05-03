import type { JsonObject } from './types.js';

export interface IndicatorCapabilityShape {
  id: string;
  argNames: Set<string>;
  outputs?: Set<string>;
  hasOutput: boolean;
  outputRequired: boolean;
}

export interface IndicatorCatalog {
  byId: Map<string, IndicatorCapabilityShape>;
  hasCatalog: boolean;
}

export interface InstrumentCatalogItem extends JsonObject {
  symbol: string;
  base?: string;
  quote?: string;
  dataStart?: string;
}

export interface InstrumentCatalog {
  bySymbol: Map<string, InstrumentCatalogItem>;
  byBase: Map<string, InstrumentCatalogItem[]>;
  instruments: InstrumentCatalogItem[];
  hasCatalog: boolean;
}

export type InstrumentResolutionStatus =
  | 'resolved'
  | 'unsupported'
  | 'ambiguous'
  | 'missing_catalog';

export interface InstrumentResolution {
  input: string;
  normalizedInput: string;
  status: InstrumentResolutionStatus;
  symbol?: string;
  instrument?: InstrumentCatalogItem;
  reason: string;
  suggestions: string[];
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asJsonObject(value: unknown): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

function normalizeSymbolInput(value: unknown): string {
  return typeof value === 'string'
    ? value
        .trim()
        .toUpperCase()
        .replace(/[\s/_:-]+/gu, '')
    : '';
}

export function buildIndicatorCatalog(capabilities: unknown): IndicatorCatalog {
  const catalogObject = asJsonObject(capabilities);
  const indicators = Array.isArray(catalogObject?.indicators)
    ? (catalogObject.indicators as unknown[])
    : undefined;

  if (!indicators || indicators.length === 0) {
    return { byId: new Map(), hasCatalog: false };
  }

  const byId = new Map<string, IndicatorCapabilityShape>();
  for (const raw of indicators) {
    if (!isJsonObject(raw)) continue;
    const id = typeof raw.id === 'string' ? raw.id : undefined;
    if (!id) continue;

    const argNames = new Set<string>();
    if (Array.isArray(raw.argNames)) {
      for (const name of raw.argNames) {
        if (typeof name === 'string') argNames.add(name);
      }
    }
    if (argNames.size === 0 && Array.isArray(raw.args)) {
      for (const arg of raw.args) {
        if (isJsonObject(arg) && typeof arg.name === 'string') {
          argNames.add(arg.name);
        }
      }
    }

    const outputDescriptor = asJsonObject(raw.output);
    const outputs =
      Array.isArray(raw.outputs) &&
      raw.outputs.every((value) => typeof value === 'string')
        ? new Set(raw.outputs as string[])
        : outputDescriptor?.type === 'enum' &&
            Array.isArray(outputDescriptor.enumValues)
          ? new Set(
              (outputDescriptor.enumValues as unknown[]).filter(
                (value): value is string => typeof value === 'string',
              ),
            )
          : undefined;

    byId.set(id, {
      id,
      argNames,
      ...(outputs ? { outputs } : {}),
      hasOutput: outputDescriptor !== undefined || outputs !== undefined,
      outputRequired: outputDescriptor?.required === true,
    });
  }

  return { byId, hasCatalog: true };
}

export function buildInstrumentCatalog(
  capabilities: unknown,
): InstrumentCatalog {
  const catalogObject = asJsonObject(capabilities);
  const instruments = Array.isArray(catalogObject?.instruments)
    ? (catalogObject.instruments as unknown[])
    : [];
  const parsed: InstrumentCatalogItem[] = [];
  const bySymbol = new Map<string, InstrumentCatalogItem>();
  const byBase = new Map<string, InstrumentCatalogItem[]>();

  for (const raw of instruments) {
    if (!isJsonObject(raw) || typeof raw.symbol !== 'string') continue;
    const symbol = raw.symbol.trim().toUpperCase();
    if (!symbol) continue;
    const item: InstrumentCatalogItem = {
      ...raw,
      symbol,
      ...(typeof raw.base === 'string' ? { base: raw.base.toUpperCase() } : {}),
      ...(typeof raw.quote === 'string'
        ? { quote: raw.quote.toUpperCase() }
        : {}),
      ...(typeof raw.dataStart === 'string'
        ? { dataStart: raw.dataStart }
        : {}),
    };
    parsed.push(item);
    bySymbol.set(symbol, item);
    const base = item.base ?? symbol.replace(/USDT$/u, '');
    const existing = byBase.get(base) ?? [];
    existing.push(item);
    byBase.set(base, existing);
  }

  return {
    bySymbol,
    byBase,
    instruments: parsed,
    hasCatalog: parsed.length > 0,
  };
}

function defaultInstrumentSuggestions(catalog: InstrumentCatalog): string[] {
  const preferred = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  const suggestions = preferred.filter((symbol) =>
    catalog.bySymbol.has(symbol),
  );
  if (suggestions.length >= 3) return suggestions;
  for (const instrument of catalog.instruments) {
    if (!suggestions.includes(instrument.symbol)) {
      suggestions.push(instrument.symbol);
    }
    if (suggestions.length >= 3) break;
  }
  return suggestions;
}

export function resolveInstrument(
  input: unknown,
  capabilitiesOrCatalog: unknown,
): InstrumentResolution {
  const rawInput = typeof input === 'string' ? input.trim() : '';
  const normalizedInput = normalizeSymbolInput(rawInput);
  const catalog = isInstrumentCatalog(capabilitiesOrCatalog)
    ? capabilitiesOrCatalog
    : buildInstrumentCatalog(capabilitiesOrCatalog);

  if (!catalog.hasCatalog) {
    return {
      input: rawInput,
      normalizedInput,
      status: 'missing_catalog',
      reason:
        'No instrument catalog was supplied. Read capabilities.instruments before choosing a symbol.',
      suggestions: [],
    };
  }

  const exact = catalog.bySymbol.get(normalizedInput);
  if (exact) {
    return {
      input: rawInput,
      normalizedInput,
      status: 'resolved',
      symbol: exact.symbol,
      instrument: exact,
      reason: `Resolved exact instrument symbol ${exact.symbol}.`,
      suggestions: [],
    };
  }

  const baseMatches = catalog.byBase.get(normalizedInput) ?? [];
  if (baseMatches.length === 1) {
    const match = baseMatches[0]!;
    return {
      input: rawInput,
      normalizedInput,
      status: 'resolved',
      symbol: match.symbol,
      instrument: match,
      reason: `Resolved base asset ${normalizedInput} to ${match.symbol}.`,
      suggestions: [],
    };
  }

  if (baseMatches.length > 1) {
    return {
      input: rawInput,
      normalizedInput,
      status: 'ambiguous',
      reason: `Base asset ${normalizedInput} matches multiple supported instruments.`,
      suggestions: baseMatches.map((item) => item.symbol).slice(0, 5),
    };
  }

  const suggestions = catalog.instruments
    .filter(
      (item) =>
        item.symbol.includes(normalizedInput) ||
        (item.base ?? '').includes(normalizedInput),
    )
    .map((item) => item.symbol)
    .slice(0, 5);

  return {
    input: rawInput,
    normalizedInput,
    status: 'unsupported',
    reason:
      rawInput.length > 0
        ? `Instrument ${rawInput} is not in the supported instrument universe.`
        : 'No instrument was supplied.',
    suggestions:
      suggestions.length > 0
        ? suggestions
        : defaultInstrumentSuggestions(catalog),
  };
}

function isInstrumentCatalog(value: unknown): value is InstrumentCatalog {
  return (
    isJsonObject(value) &&
    value.bySymbol instanceof Map &&
    value.byBase instanceof Map &&
    Array.isArray(value.instruments) &&
    typeof value.hasCatalog === 'boolean'
  );
}
